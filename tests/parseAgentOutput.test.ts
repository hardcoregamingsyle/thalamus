// Tests for parseAgentOutput — the <<TAG>> marker parser that turns an agent's
// text into file writes, commands, and search ops. The regressions guarded here
// are the ones that broke a live Code-mode run: commands with embedded double
// quotes getting silently dropped, and a file block that got cut off at the
// token limit (no closing tag) needing to be detectable so it isn't lost.
import { describe, it, expect } from "bun:test";
import { parseAgentOutput } from "../src/convex/lib/agentCore";

describe("parseAgentOutput — commands", () => {
  it("parses a RUN-CMD that contains double quotes", () => {
    const out = `<<RUN-CMD="node -e 'console.log("ok")' 2>&1">>`;
    const parsed = parseAgentOutput(out);
    expect(parsed.cmdOps.map((c) => c.command)).toEqual([`node -e 'console.log("ok")' 2>&1`]);
  });

  it("parses a command with a >> redirect inside it", () => {
    const out = `<<RUN-CMD="echo hi >> log.txt">>`;
    expect(parseAgentOutput(out).cmdOps.map((c) => c.command)).toEqual(["echo hi >> log.txt"]);
  });

  it("parses multiple commands on separate lines", () => {
    const out = `<<RUN-CMD="npm install">>\n<<RUN-CMD="npm test">>`;
    expect(parseAgentOutput(out).cmdOps.map((c) => c.command)).toEqual(["npm install", "npm test"]);
  });

  it("parses a multi-line command value (no [^\"]+ newline regression)", () => {
    const out = `<<RUN-CMD="line1\nline2">>`;
    expect(parseAgentOutput(out).cmdOps.map((c) => c.command)).toEqual(["line1\nline2"]);
  });
});

describe("parseAgentOutput — files", () => {
  it("parses a create-file block", () => {
    const out = `<<CREATEFILE="src/a.ts">>export const x = 1;<<END.CREATEFILE>>`;
    expect(parseAgentOutput(out).fileOps).toEqual([
      { type: "create", filepath: "src/a.ts", content: "export const x = 1;" },
    ]);
  });

  it("does NOT invent a file from an unclosed (truncated) block", () => {
    // No <<END.CREATEFILE>> — the file was cut off at the token limit. It must
    // not parse as a (broken, half-written) file; the pipeline's continuation
    // loop stitches it instead.
    const out = `<<CREATEFILE="src/big.ts">>export const partial = `;
    expect(parseAgentOutput(out).fileOps).toEqual([]);
  });

  it("parses a file whose content documents the marker syntax as ONE file", () => {
    // A doc that mentions <<CREATEFILE="..."> inside its body must still parse as
    // a single complete file (non-greedy match to the real close), and its
    // content is preserved verbatim.
    const out = `<<CREATEFILE="docs/markers.md">>To create a file emit <<CREATEFILE="path">> then content.<<END.CREATEFILE>>`;
    const parsed = parseAgentOutput(out);
    expect(parsed.fileOps).toHaveLength(1);
    expect(parsed.fileOps[0].filepath).toBe("docs/markers.md");
    expect(parsed.fileOps[0].content).toContain(`emit <<CREATEFILE="path">> then content.`);
  });
});

describe("parseAgentOutput — leftover sentinels never reach the transcript", () => {
  // A live Code-mode run showed raw <<END.CREATEFILE>> and <<END.MCP-CALL>>
  // sitting in the visible message. Every handler matches a COMPLETE pair, so
  // a half-emitted marker matched nothing and was printed verbatim — including
  // on the desktop app, which does no stripping of its own.
  it("neutralises an orphan END.CREATEFILE with no opener", () => {
    const parsed = parseAgentOutput("Here is the page.<<END.CREATEFILE>>");
    expect(parsed.cleanContent).not.toContain("<<");
    expect(parsed.cleanContent).not.toContain(">>");
  });

  it("neutralises an END.MCP-CALL whose opener was malformed", () => {
    // mcpParse.ts owns MCP blocks and requires server= and tool=; a near-miss
    // opener leaves the closer behind, and parseAgentOutput has no MCP rule.
    const parsed = parseAgentOutput(`<<MCP-CALL server='x'>>do a thing<<END.MCP-CALL>>`);
    expect(parsed.cleanContent).not.toContain("<<END.MCP-CALL>>");
  });

  it("leaves a complete file block alone, marker syntax in its body included", () => {
    // The sweep must not damage content that a real handler already consumed.
    const out = `<<CREATEFILE="docs/m.md">>emit <<CREATEFILE="path">> to write.<<END.CREATEFILE>>`;
    const parsed = parseAgentOutput(out);
    expect(parsed.fileOps).toHaveLength(1);
    expect(parsed.fileOps[0].content).toContain(`emit <<CREATEFILE="path">> to write.`);
    expect(parsed.cleanContent).toContain("[FILE CREATED: docs/m.md]");
  });

  it("still turns a well-formed RUN-CMD into its placeholder, not a sentinel", () => {
    const parsed = parseAgentOutput(`<<RUN-CMD="ls -la">>`);
    expect(parsed.cmdOps.map((c) => c.command)).toEqual(["ls -la"]);
    expect(parsed.cleanContent).not.toContain("<<");
  });
});

describe("parseAgentOutput — JSON ops", () => {
  it("runs an op that follows an unterminated op (no bailout on truncation)", () => {
    // The regression this guards: findJsonOps used to `break` out of the whole
    // scan the first time it hit a JSON op with no closing brace (output cut off
    // mid-create-file at the token limit). Every LATER op in the same message —
    // most damagingly the `cmd` op that would have actually run — was silently
    // dropped. The fix skips just the broken op and keeps scanning.
    const out = `Some text. {"op":"create-file","path":"src/main.ts","content":"const x = 1;"\nthen it got cut off... {"op":"cmd","command":"npm install"}`;
    const parsed = parseAgentOutput(out);
    expect(parsed.fileOps).toEqual([]);
    expect(parsed.cmdOps.map((c) => c.command)).toEqual(["npm install"]);
  });

  it("keeps parsing ops between two unparseable blobs", () => {
    const out = `{"op":"delete-file","path":"a.ts"} {"op":"edit-file","path":"b.ts","content":"{" {"op":"cmd","command":"npm test"}`;
    const parsed = parseAgentOutput(out);
    expect(parsed.fileOps).toHaveLength(1);
    expect(parsed.fileOps[0].type).toBe("delete");
    expect(parsed.cmdOps.map((c) => c.command)).toEqual(["npm test"]);
  });
});

describe("parseAgentOutput — LLM special-token wrappers", () => {
  // A live production run showed DeepSeek-family markers like
  // `<｜｜DSML｜｜op>…</｜｜DSML｜｜op>` (fullwidth pipe, U+FF5C) wrapping real
  // ops. Left in place they (a) leaked verbatim into the visible transcript
  // and (b) sometimes hid the JSON op inside them from the parser. OpenAI
  // control tokens (`<|im_start|>`, `<|eot_id|>`, `<|channel|>`) show up the
  // same way from other model families.
  it("strips fullwidth-pipe DSML wrappers from cleanContent", () => {
    const out = `<｜｜DSML｜｜op>hello</｜｜DSML｜｜op>`;
    const parsed = parseAgentOutput(out);
    expect(parsed.cleanContent).not.toContain("DSML");
    expect(parsed.cleanContent).not.toContain("｜");
    expect(parsed.cleanContent.trim()).toBe("hello");
  });

  it("strips ASCII-pipe control tokens (OpenAI family) from cleanContent", () => {
    const out = `<|im_start|>user\n<|channel|>final<|eot_id|>`;
    const parsed = parseAgentOutput(out);
    expect(parsed.cleanContent).not.toContain("<|");
    expect(parsed.cleanContent).not.toContain("|>");
    expect(parsed.cleanContent).toContain("user");
    expect(parsed.cleanContent).toContain("final");
  });

  it("parses a JSON op wrapped inside DSML tokens", () => {
    // Wrapping an op used to prevent the JSON scanner from operating on it in
    // some cases; stripping before op extraction restores the op.
    const out = `<｜｜DSML｜｜op>{"op":"cmd","command":"pwd && echo OK"}</｜｜DSML｜｜op>`;
    const parsed = parseAgentOutput(out);
    expect(parsed.cmdOps.map((c) => c.command)).toEqual(["pwd && echo OK"]);
    expect(parsed.cleanContent).not.toContain("DSML");
    expect(parsed.cleanContent).toContain("[CMD: pwd && echo OK]");
  });

  it("does NOT damage ordinary code containing '<', '|', and '||'", () => {
    // The regex requires a pipe IMMEDIATELY after `<` or `</` and rejects
    // whitespace and other angle brackets in the body — so `x < y`, `a || b`
    // and typical HTML/JSX tags are untouched. This test is the false-positive
    // guard the wrapper stripper has to pass.
    const code = `function f() { if (a || b) { return x < y; } }\n<div class="ok">|pipe|</div>\n<https://example.com>`;
    const parsed = parseAgentOutput(code);
    expect(parsed.cleanContent).toContain("if (a || b)");
    expect(parsed.cleanContent).toContain("return x < y;");
    expect(parsed.cleanContent).toContain(`<div class="ok">|pipe|</div>`);
    expect(parsed.cleanContent).toContain(`<https://example.com>`);
  });
});

describe("parseAgentOutput — malformed JSON ops are surfaced, not dropped", () => {
  // Real production output: a create-file with unescaped double quotes inside
  // the content string. JSON.parse fails, the op used to be silently dropped,
  // no file got written, and the agent got no feedback so it repeated the same
  // mistake forever. malformedOps captures the excerpt so the caller can echo
  // it back to the agent, and cleanContent shows a visible in-place marker.
  it("captures a malformed create-file with unescaped quotes", () => {
    const out = `{"op":"create-file","path":"scripts/B737.gd","content":"extends "res://scripts/Aircraft.gd"\n## Boeing 737-800"}`;
    const parsed = parseAgentOutput(out);
    expect(parsed.fileOps).toEqual([]);
    expect(parsed.malformedOps).toHaveLength(1);
    expect(parsed.malformedOps[0]).toContain(`"op":"create-file"`);
    expect(parsed.malformedOps[0].length).toBeLessThanOrEqual(200);
    expect(parsed.cleanContent).toContain("[MALFORMED OP");
  });

  it("still parses a well-formed op that sits alongside a malformed one", () => {
    const out = `{"op":"create-file","path":"a.gd","content":"extends "bad"\n"} {"op":"cmd","command":"godot --version"}`;
    const parsed = parseAgentOutput(out);
    // Malformed create-file surfaced, well-formed cmd survives.
    expect(parsed.fileOps).toEqual([]);
    expect(parsed.malformedOps.length).toBeGreaterThanOrEqual(1);
    expect(parsed.cmdOps.map((c) => c.command)).toEqual(["godot --version"]);
    expect(parsed.cleanContent).toContain("[MALFORMED OP");
    expect(parsed.cleanContent).toContain("[CMD: godot --version]");
  });

  it("does not touch malformedOps when every op parses cleanly", () => {
    const out = `{"op":"cmd","command":"ls"} {"op":"delete-file","path":"a.ts"}`;
    const parsed = parseAgentOutput(out);
    expect(parsed.malformedOps).toEqual([]);
    expect(parsed.cmdOps.map((c) => c.command)).toEqual(["ls"]);
    expect(parsed.fileOps).toEqual([{ type: "delete", filepath: "a.ts" }]);
    expect(parsed.cleanContent).not.toContain("[MALFORMED");
  });
});
