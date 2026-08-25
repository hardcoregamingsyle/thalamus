// Guards the Claude Code-style verbose transcript. The invariants that
// matter, in the order the user would notice them breaking:
//   1. Hand-offs ([OVER TO: …], ⇄ …) parse into handoff markers with BOTH the
//      target and the reason — the one line that must never render as plain
//      text again.
//   2. Every pipeline marker ([CMD: …], [FILE CREATED: …], verdicts, …)
//      becomes its typed block; unknown [ … ] text stays prose.
//   3. The live stream never shows raw JSON — the growing "message" string is
//      extracted from the partial doc, escapes decoded, ops cut off.
import { describe, it, expect } from "bun:test";
import {
  classifySystemLine,
  extractStreamingMessage,
  segmentVerboseContent,
  streamVisibleText,
  stripOpsForStreaming,
  type VerboseMarker,
} from "../src/lib/verboseTranscript";

/** Collect the markers out of a segmented message, dropping prose. */
function markersOf(content: string): VerboseMarker[] {
  return segmentVerboseContent(content).flatMap((s) => (s.type === "marker" ? [s.marker] : []));
}

describe("segmentVerboseContent — hand-offs", () => {
  it("parses OVER TO with a reason into a handoff with target + reason", () => {
    const [m] = markersOf("I'll hand this off now.\n\n[OVER TO: Coder — fix the login form validation]");
    expect(m.kind).toBe("handoff");
    expect(m.detail).toBe("Coder");
    expect(m.secondary).toBe("fix the login form validation");
  });

  it("parses OVER TO without a reason", () => {
    const [m] = markersOf("[OVER TO: Tester]");
    expect(m.kind).toBe("handoff");
    expect(m.detail).toBe("Tester");
    expect(m.secondary).toBeUndefined();
  });

  it("keeps the reason's own em dashes after the first split", () => {
    const [m] = markersOf("[OVER TO: Research Team — need sources — recent ones]");
    expect(m.detail).toBe("Research Team");
    expect(m.secondary).toBe("need sources — recent ones");
  });

  it("maps an invalid OVER TO to a warning, not a handoff", () => {
    const [m] = markersOf("[OVER TO: invalid — no agent named]");
    expect(m.kind).toBe("warning");
    expect(m.detail).toBe("invalid — no agent named");
  });

  it("recognises DISPATCH REQUESTED in both stamped shapes", () => {
    const [a] = markersOf("[DISPATCH REQUESTED — handed off to the Dispatcher]: the login form crashes on submit");
    expect(a.kind).toBe("dispatch");
    expect(a.detail).toBe("the login form crashes on submit");
    const [b] = markersOf("[DISPATCH REQUESTED: needs a build team]");
    expect(b.kind).toBe("dispatch");
    expect(b.detail).toBe("needs a build team");
    const [c] = markersOf("[DISPATCH REQUESTED]");
    expect(c.kind).toBe("dispatch");
    expect(c.detail).toBeUndefined();
  });
});

describe("segmentVerboseContent — activity markers", () => {
  it("parses the file ops", () => {
    expect(markersOf("[FILE CREATED: src/App.tsx]")[0].kind).toBe("file-create");
    expect(markersOf("[FILE EDITED: src/App.tsx]")[0].kind).toBe("file-edit");
    expect(markersOf("[FILE DELETED: src/old.ts]")[0].kind).toBe("file-delete");
    expect(markersOf("[FILE CREATED: src/App.tsx]")[0].detail).toBe("src/App.tsx");
  });

  it("parses CMD with the full command as detail", () => {
    const [m] = markersOf('[CMD: npm install && npm run build]');
    expect(m.kind).toBe("cmd");
    expect(m.detail).toBe("npm install && npm run build");
  });

  it("parses the read-world markers and their legacy spellings", () => {
    expect(markersOf("[SEARCHING: react hooks docs]")[0]).toMatchObject({ kind: "search", detail: "react hooks docs" });
    expect(markersOf("[SEARCH: react hooks docs]")[0].kind).toBe("search");
    expect(markersOf("[SCRAPING: https://example.com/docs]")[0]).toMatchObject({ kind: "scrape" });
    expect(markersOf("[SCRAPE: https://example.com]")[0].kind).toBe("scrape");
    expect(markersOf("[RESEARCHING: vite plugin ecosystem]")[0].kind).toBe("research");
    expect(markersOf("[MCP: github/create_issue]")[0]).toMatchObject({ kind: "mcp", detail: "github/create_issue" });
  });

  it("parses verdicts with normalised detail", () => {
    expect(markersOf("[TEST: PASSED ✓]")[0]).toMatchObject({ kind: "test-pass", detail: "passed" });
    expect(markersOf("[TEST: FAILED - 2 suites red]")[0]).toMatchObject({ kind: "test-fail", detail: "failed — 2 suites red" });
    expect(markersOf("[TEST: FAILED — legacy reason]")[0].detail).toBe("failed — legacy reason");
    expect(markersOf("[SECURITY: PASSED ✓]")[0]).toMatchObject({ kind: "security-pass", detail: "passed" });
    expect(markersOf("[SECURITY: FAILED]")[0]).toMatchObject({ kind: "security-fail", detail: "failed" });
  });

  it("parses the remaining utility markers", () => {
    expect(markersOf("[DEPLOY COMMANDS SET: 3 command(s)]")[0]).toMatchObject({ kind: "deploy" });
    expect(markersOf("[DEPLOY COMMANDS]")[0].kind).toBe("deploy");
    expect(markersOf("[API KEY REQUIRED: OPENAI_API_KEY]")[0]).toMatchObject({ kind: "key-request", detail: "OPENAI_API_KEY" });
    expect(markersOf("[INFO REQUESTED: Which database?]")[0].kind).toBe("info");
    expect(markersOf("[INSTRUCTIONS PROVIDED: Setup guide]")[0].kind).toBe("info");
    expect(markersOf("[CHANGE MODE: code]")[0]).toMatchObject({ kind: "mode", detail: "code" });
    expect(markersOf("[CONTINUE]")[0].kind).toBe("continue");
    expect(markersOf("[MALFORMED OP — not executed]")[0].kind).toBe("malformed");
    expect(markersOf("[RETRY 2]")[0]).toMatchObject({ kind: "retry", detail: "#2" });
  });

  it("preserves prose around markers, in order", () => {
    const segs = segmentVerboseContent("Creating the file now.\n\n[FILE CREATED: src/a.ts]\n\nDone with that step.");
    expect(segs.map((s) => s.type)).toEqual(["prose", "marker", "prose"]);
    expect(segs[0].type === "prose" && segs[0].text).toContain("Creating the file now.");
    expect(segs[2].type === "prose" && segs[2].text).toContain("Done with that step.");
  });

  it("leaves unknown [ … ] text as prose", () => {
    const segs = segmentVerboseContent("Use the [TABLE] layout here, arrays like arr[0] too.");
    expect(segs).toHaveLength(1);
    expect(segs[0].type).toBe("prose");
  });

  it("parses several markers separated by prose", () => {
    const ms = markersOf("Plan made.\n\n[CMD: npm test]\n\n[TEST: PASSED ✓]\n\n[OVER TO: Critic — gate check]");
    expect(ms.map((m) => m.kind)).toEqual(["cmd", "test-pass", "handoff"]);
  });
});

describe("classifySystemLine — the run's narration", () => {
  it("parses a ⇄ hand-off line with both ends and the reason", () => {
    const m = classifySystemLine("⇄ Analyser handed over to Coder — fix the login form validation");
    expect(m).toMatchObject({ kind: "handoff", fromAgent: "Analyser", detail: "Coder", secondary: "fix the login form validation" });
  });

  it("parses a ⇄ hand-off line without a reason", () => {
    const m = classifySystemLine("⇄ Tester handed over to the Research Team");
    expect(m).toMatchObject({ kind: "handoff", fromAgent: "Tester", detail: "the Research Team" });
  });

  it("routes a member summon to the WHOLE Research Team, never the member", () => {
    const m = classifySystemLine(
      '⇄ Planner called for "Researcher" — research runs as one team, so the whole Research Team takes it, in order (ResearchPlanner → Researcher → ReportMaker → FactCheck).',
    );
    expect(m).not.toBeNull();
    expect(m?.kind).toBe("handoff");
    expect(m?.fromAgent).toBe("Planner");
    expect(m?.detail).toBe("the Research Team");
    expect(m?.secondary).toContain("research runs as one team");
  });

  it("parses completion with and without the trailing reason", () => {
    expect(classifySystemLine("✔ Run complete — the question was answered.")).toMatchObject({
      kind: "complete",
      detail: "the question was answered.",
    });
    expect(classifySystemLine("✔ Run complete")?.detail).toBeUndefined();
  });

  it("parses the silent re-route line", () => {
    const m = classifySystemLine("[ROUTING] Coder named no next teammate — the Analyser takes over routing.");
    expect(m).toMatchObject({ kind: "route", detail: "Coder named no next teammate — the Analyser takes over routing." });
  });

  it("parses warnings, holds and stops", () => {
    expect(classifySystemLine("⚠️ 2 commands timed out waiting for a result.")?.kind).toBe("warning");
    expect(classifySystemLine("⏳ Rate limited. Holding this run…")?.kind).toBe("hold");
    expect(classifySystemLine('Run stopped: "Old agent" is not an agent on the team.')?.kind).toBe("warning");
  });

  it("returns null for non-routing text", () => {
    expect(classifySystemLine("Some unrecognised system note.")).toBeNull();
  });
});

describe("extractStreamingMessage — live JSON-doc streams", () => {
  it("extracts the message from a complete doc and cuts the ops off", () => {
    const raw = '{"message": "Here is the plan.", "ops": [{"op": "cmd", "command": "ls"}]}';
    expect(extractStreamingMessage(raw)).toBe("Here is the plan.");
  });

  it("extracts the growing message from a partial doc", () => {
    expect(extractStreamingMessage('{"message": "I will create th')).toBe("I will create th");
  });

  it("decodes escapes as the string grows", () => {
    expect(extractStreamingMessage('{"message": "line one\\nline two \\"quoted\\""')).toBe(
      'line one\nline two "quoted"',
    );
    expect(extractStreamingMessage('{"message": "unicode \\u0041B"')).toBe("unicode AB");
  });

  it("holds back a truncated escape at the drip edge", () => {
    expect(extractStreamingMessage('{"message": "waiting\\')).toBe("waiting");
    expect(extractStreamingMessage('{"message": "half \\u00')).toBe("half ");
  });

  it("uses the review field too (Critic)", () => {
    expect(extractStreamingMessage('{"review": "looks good", "ops": []}')).toBe("looks good");
  });

  it("finds the message when ops come first in the doc", () => {
    const raw = '{"ops": [{"op": "cmd"}], "message": "late message"}';
    expect(extractStreamingMessage(raw)).toBe("late message");
  });

  it("returns empty — not raw JSON — for a doc with no message yet", () => {
    expect(extractStreamingMessage('{"ops": [{"op": "cr')).toBe("");
  });

  it("returns null for plain-text streams", () => {
    expect(extractStreamingMessage("Just prose, no doc here.")).toBeNull();
  });
});

describe("streamVisibleText — what the bubble types out", () => {
  it("shows the extracted message for doc streams", () => {
    expect(streamVisibleText('{"message": "typing **this** out", "ops": []}')).toBe("typing **this** out");
  });

  it("strips op blocks from plain-text streams", () => {
    const raw = "Answer text.\n\n```json\n{\"op\": \"cmd\", \"command\": \"ls\"}\n```";
    expect(streamVisibleText(raw)).toBe("Answer text.\n\n");
    expect(streamVisibleText('Text with {"op": "search", "query": "x"} inline.')).toBe("Text with  inline.");
  });

  it("stripOpsForStreaming behaves identically to the old chat helper", () => {
    expect(stripOpsForStreaming("a\n```json\n{}\n```\nb")).toBe("a\n\nb");
  });
});
