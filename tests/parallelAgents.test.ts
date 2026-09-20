import { describe, it, expect } from "bun:test";
import {
  PARALLEL_AGENTS,
  PLANNER_SYSTEM_PROMPT,
  buildPlannerPrompt,
  buildTaskPrompt,
  normalizeAgent,
  renderCommandResults,
  renderCommandsUnavailable,
  systemPromptFor,
  type ParallelAgent,
} from "../src/convex/lib/parallelAgents";

const files = (n: number, size = 10) =>
  Array.from({ length: n }, (_, i) => ({ filepath: `src/f${i}.ts`, content: "x".repeat(size) }));

describe("normalizeAgent", () => {
  it("returns every canonical name unchanged", () => {
    for (const a of PARALLEL_AGENTS) expect(normalizeAgent(a)).toBe(a);
  });

  it("is case- and punctuation-insensitive", () => {
    expect(normalizeAgent("know it all")).toBe("KnowItAll");
    expect(normalizeAgent("CODER")).toBe("Coder");
    expect(normalizeAgent("know-it-all")).toBe("KnowItAll");
  });

  it("maps the names a model-authored plan actually writes", () => {
    expect(normalizeAgent("Planner")).toBe("Analyser");
    expect(normalizeAgent("developer")).toBe("Coder");
    expect(normalizeAgent("optimizer")).toBe("Optimiser");
    expect(normalizeAgent("organiser")).toBe("Organizer");
    expect(normalizeAgent("reviewer")).toBe("Critic");
    expect(normalizeAgent("QA")).toBe("Tester");
  });

  // An unroutable agent name must never sink a task — the plan is model output.
  it("never throws and always yields a real role", () => {
    for (const junk of ["", "   ", "???", "Gandalf", "null", "undefined"]) {
      const got = normalizeAgent(junk);
      expect(PARALLEL_AGENTS).toContain(got);
    }
    expect(normalizeAgent(undefined as unknown as string)).toBe("Coder");
    expect(normalizeAgent(null as unknown as string)).toBe("Coder");
  });
});

describe("systemPromptFor — the parallel contract", () => {
  // The whole point of this engine: no baton. A prompt that let an agent route
  // would have it naming a seat already busy with its own task.
  it("forbids every routing op, for every role", () => {
    for (const a of PARALLEL_AGENTS) {
      // Normalised: these prompts are hard-wrapped, so a literal phrase can be
      // split across a newline.
      const p = systemPromptFor(a).replace(/\s+/g, " ");
      expect(p).toContain("over-to");
      expect(p).toContain("DO NOT write");
      expect(p).toMatch(/there is no baton/i);
    }
  });

  it("never instructs an agent to hand off or name a next speaker", () => {
    for (const a of PARALLEL_AGENTS) {
      const p = systemPromptFor(a);
      expect(p).not.toMatch(/end your reply with \{"op":"over-to"/i);
      expect(p).not.toMatch(/naming who works next/i);
    }
  });

  it("names the role it is for and teaches the file grammar", () => {
    for (const a of PARALLEL_AGENTS) {
      const p = systemPromptFor(a);
      expect(p).toContain(`You are the ${a}.`);
      expect(p).toContain('<<FILE "');
      expect(p).toContain("<<END>>");
    }
  });

  // Concurrent writers to one file silently destroy each other, and nothing in
  // the runtime can detect it — the prompt is the only defence.
  it("tells every role not to write files it does not own", () => {
    for (const a of PARALLEL_AGENTS) {
      expect(systemPromptFor(a)).toMatch(/only the files your own task is about/i);
    }
  });
});

describe("buildTaskPrompt", () => {
  it("carries each dependency's report verbatim — that is the hand-off", () => {
    const p = buildTaskPrompt({
      goal: "build a game",
      title: "render the board",
      upstream: [{ title: "design the board", agent: "Analyser", result: "8x8, origin top-left" }],
      files: [],
    });
    expect(p).toContain("8x8, origin top-left");
    expect(p).toContain("design the board");
    expect(p).toContain("build a game");
    expect(p).toContain("render the board");
  });

  it("says so plainly when a task has no dependencies", () => {
    const p = buildTaskPrompt({ goal: "g", title: "t", upstream: [], files: [] });
    expect(p).toMatch(/no dependencies/i);
  });

  it("survives a dependency that recorded no result", () => {
    const p = buildTaskPrompt({
      goal: "g",
      title: "t",
      upstream: [{ title: "u", agent: "Coder" }],
      files: [],
    });
    expect(p).toContain("(no report recorded)");
  });

  it("states the project is empty rather than showing nothing", () => {
    expect(buildTaskPrompt({ goal: "g", title: "t", upstream: [], files: [] })).toMatch(/project is empty/i);
  });

  it("includes small projects whole", () => {
    const p = buildTaskPrompt({ goal: "g", title: "t", upstream: [], files: files(3) });
    for (let i = 0; i < 3; i++) expect(p).toContain(`src/f${i}.ts`);
    expect(p).not.toMatch(/too large to include/i);
  });

  // A task that blows the context ceiling fails for a reason unrelated to the
  // task, so the budget degrades to a path list instead of truncating a body.
  it("lists oversized files by path instead of blowing the budget", () => {
    const p = buildTaskPrompt({ goal: "g", title: "t", upstream: [], files: files(40, 5000) });
    expect(p).toMatch(/too large to include/i);
    expect(p.length).toBeLessThan(120_000);
  });

  it("keeps every file accounted for, inlined or listed", () => {
    const all = files(40, 5000);
    const p = buildTaskPrompt({ goal: "g", title: "t", upstream: [], files: all });
    for (const f of all) expect(p).toContain(f.filepath);
  });

  it("orders files deterministically regardless of input order", () => {
    const a = files(5);
    const p1 = buildTaskPrompt({ goal: "g", title: "t", upstream: [], files: a });
    const p2 = buildTaskPrompt({ goal: "g", title: "t", upstream: [], files: [...a].reverse() });
    expect(p1).toBe(p2);
  });
});

describe("planner prompt", () => {
  it("offers exactly the real cast as agent choices", () => {
    for (const a of PARALLEL_AGENTS) expect(PLANNER_SYSTEM_PROMPT).toContain(a);
  });

  // A plan that chains every task is a turn-wise pipeline in disguise, which is
  // the thing this engine exists to stop being.
  it("pushes for independence and file ownership", () => {
    expect(PLANNER_SYSTEM_PROMPT).toMatch(/parallel/i);
    expect(PLANNER_SYSTEM_PROMPT).toMatch(/independence/i);
    expect(PLANNER_SYSTEM_PROMPT).toMatch(/disjoint set of files/i);
    expect(PLANNER_SYSTEM_PROMPT).toMatch(/cycle/i);
  });

  it("asks for the dependency field the scheduler actually reads", () => {
    expect(PLANNER_SYSTEM_PROMPT).toContain('"dependencies"');
    expect(PLANNER_SYSTEM_PROMPT).toContain('"agent"');
    expect(PLANNER_SYSTEM_PROMPT).toContain('"id"');
  });

  it("puts the goal and the project state in front of the planner", () => {
    const p = buildPlannerPrompt("ship a parser", [{ filepath: "a.ts", content: "1" }]);
    expect(p).toContain("ship a parser");
    expect(p).toContain("a.ts");
  });
});

describe("every agent the planner may name is runnable", () => {
  it("round-trips through normalizeAgent", () => {
    for (const a of PARALLEL_AGENTS) {
      expect(normalizeAgent(a)).toBe(a as ParallelAgent);
      expect(() => systemPromptFor(normalizeAgent(a))).not.toThrow();
    }
  });
});

describe("command contract", () => {
  it("teaches every role to run commands and verify its own work", () => {
    for (const a of PARALLEL_AGENTS) {
      const p = systemPromptFor(a).replace(/\s+/g, " ");
      expect(p).toContain('{"op":"cmd"');
      expect(p).toMatch(/output comes back to you in your next turn/i);
    }
  });
});

describe("renderCommandResults", () => {
  it("is empty when nothing ran, so no empty section is pasted into a prompt", () => {
    expect(renderCommandResults([])).toBe("");
  });

  it("reports a clean exit as success", () => {
    const out = renderCommandResults([{ command: "npm test", status: "completed", exitCode: 0, output: "ok" }]);
    expect(out).toContain("npm test");
    expect(out).toContain("succeeded");
    expect(out).toContain("ok");
  });

  it("names the exact exit code on failure, not just 'failed'", () => {
    expect(renderCommandResults([{ command: "build", status: "completed", exitCode: 2, output: "boom" }]))
      .toContain("exited 2");
  });

  // A command nobody picked up is not a passing command. Saying nothing would
  // let the agent assume success and report work it never verified.
  it("says plainly when a command never finished", () => {
    const out = renderCommandResults([{ command: "npm test", status: "pending" }]);
    expect(out).toMatch(/did not finish/i);
    expect(out).toContain("pending");
  });

  it("survives a command with no output at all", () => {
    expect(renderCommandResults([{ command: "true", status: "completed", exitCode: 0 }]))
      .toContain("(no output)");
  });

  // The error is at the END of a failing build log. Head-clipping hands the
  // agent the banner and hides the failure, which reads as complete.
  it("keeps the tail of a huge log, not the head", () => {
    const output = "START-MARKER\n" + "x".repeat(50_000) + "\nERROR-AT-THE-END";
    const out = renderCommandResults([{ command: "build", status: "completed", exitCode: 1, output }]);
    expect(out).toContain("ERROR-AT-THE-END");
    expect(out).not.toContain("START-MARKER");
    expect(out.length).toBeLessThan(10_000);
  });

  it("renders every command when several ran together", () => {
    const out = renderCommandResults([
      { command: "a", status: "completed", exitCode: 0 },
      { command: "b", status: "failed", output: "nope" },
    ]);
    expect(out).toContain("$ a");
    expect(out).toContain("$ b");
    expect(out).toContain("nope");
  });
});

describe("renderCommandsUnavailable", () => {
  it("tells the agent to stop retrying and to admit what it could not verify", () => {
    const out = renderCommandsUnavailable("The executor could not be started.");
    expect(out).toContain("The executor could not be started.");
    expect(out).toMatch(/do not retry/i);
    expect(out).toMatch(/could not verify/i);
  });
});
