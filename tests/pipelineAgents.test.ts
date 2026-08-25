// The fixed team cast and the over-to hand-off resolver. The invariants that
// matter, in the order they'd break a live run:
//   1. The Research Team is exactly four agents in a pinned order — an over-to
//      that names the team (or any single member) must run them ALL, in
//      sequence. Landing on one member alone is the routing bug this suite
//      exists to refuse.
//   2. Team members are runnable phases (the pipeline drives them mid-team)
//      but are NEVER returned as hand-off targets.
//   3. Loose matching ("ResearchPlanner" → "Planner", self-hand-offs,
//      Dispatcher/User/System) must never produce a live route.
import { describe, it, expect } from "bun:test";
import {
  TEAM_AGENTS,
  RESEARCH_TEAM,
  RESEARCH_TEAM_TARGET,
  resolveHandoffTarget,
  isRunnableAgent,
  handoffDisplayName,
  nextTaskAfterPass,
} from "../src/convex/lib/pipelineAgents";

describe("the fixed cast", () => {
  it("the Research Team is the four research agents, in pinned order", () => {
    expect([...RESEARCH_TEAM]).toEqual(["ResearchPlanner", "Researcher", "ReportMaker", "FactCheck"]);
  });

  it("directly targetable teammates exclude every research member", () => {
    for (const member of RESEARCH_TEAM) {
      expect((TEAM_AGENTS as readonly string[]).includes(member)).toBe(false);
    }
  });

  it("the Analyser is a teammate — it opens every run and takes fallback routing", () => {
    expect((TEAM_AGENTS as readonly string[]).includes("Analyser")).toBe(true);
  });
});

describe("resolveHandoffTarget — the Research Team", () => {
  it("resolves the team by name, with and without decoration", () => {
    expect(resolveHandoffTarget("ResearchTeam", "Coder")).toBe(RESEARCH_TEAM_TARGET);
    expect(resolveHandoffTarget("research team", "Coder")).toBe(RESEARCH_TEAM_TARGET);
    expect(resolveHandoffTarget("the research team", "Coder")).toBe(RESEARCH_TEAM_TARGET);
    expect(resolveHandoffTarget("Research", "Coder")).toBe(RESEARCH_TEAM_TARGET);
  });

  it("a single member is upgraded to the WHOLE team — never returned directly", () => {
    for (const member of RESEARCH_TEAM) {
      const resolved = resolveHandoffTarget(member, "Coder");
      expect(resolved).toBe(RESEARCH_TEAM_TARGET);
      expect(resolved).not.toBe(member);
    }
  });

  it("a member may never be a target even for a teammate outside the team", () => {
    expect(resolveHandoffTarget("researcher", "FactCheck")).toBe(RESEARCH_TEAM_TARGET);
  });
});

describe("resolveHandoffTarget — regular teammates", () => {
  it("lands on the canonical casing", () => {
    expect(resolveHandoffTarget("coder", "Critic")).toBe("Coder");
    expect(resolveHandoffTarget("  The CRITIC!! ", "Coder")).toBe("Critic");
    expect(resolveHandoffTarget("the analyser", "Coder")).toBe("Analyser");
  });

  it("Dispatcher, User and System are not teammates", () => {
    expect(resolveHandoffTarget("Dispatcher", "Coder")).toBeUndefined();
    expect(resolveHandoffTarget("user", "Coder")).toBeUndefined();
    expect(resolveHandoffTarget("the system", "Coder")).toBeUndefined();
  });

  it("self hand-offs resolve to nothing (the fallback routes instead)", () => {
    expect(resolveHandoffTarget("Coder", "Coder")).toBeUndefined();
    expect(resolveHandoffTarget("the critic", "Critic")).toBeUndefined();
  });

  it("garbage and loose names resolve to nothing", () => {
    expect(resolveHandoffTarget("", "Coder")).toBeUndefined();
    expect(resolveHandoffTarget(undefined, "Coder")).toBeUndefined();
    expect(resolveHandoffTarget("the bug", "Coder")).toBeUndefined();
    // The landmine: planner must not catch the research planner's name.
    expect(resolveHandoffTarget("ResearchPlanner", "Coder")).toBe(RESEARCH_TEAM_TARGET);
    expect(resolveHandoffTarget("ResearchPlanner", "Coder")).not.toBe("Planner");
  });
});

describe("isRunnableAgent", () => {
  it("teammates and research members are runnable phases", () => {
    for (const a of TEAM_AGENTS) expect(isRunnableAgent(a)).toBe(true);
    for (const m of RESEARCH_TEAM) expect(isRunnableAgent(m)).toBe(true);
  });

  it("the team sentinel, Dispatcher and unknowns are not phases", () => {
    expect(isRunnableAgent(RESEARCH_TEAM_TARGET)).toBe(false);
    expect(isRunnableAgent("Dispatcher")).toBe(false);
    expect(isRunnableAgent("")).toBe(false);
    expect(isRunnableAgent("SomeFutureAgent")).toBe(false);
  });
});

describe("handoffDisplayName", () => {
  it("the team reads as prose; agents stay canonically cased", () => {
    expect(handoffDisplayName(RESEARCH_TEAM_TARGET)).toBe("the Research Team");
    expect(handoffDisplayName("Coder")).toBe("Coder");
  });
});

// The plan carry: a Critic pass mid-plan must move the cursor to the next
// task (the run walks the whole plan); a pass on the final task is the run's
// exit gate. If this helper breaks, multi-task plans silently complete at 1/N
// again — the regression this suite exists to refuse.
describe("nextTaskAfterPass", () => {
  const plan = JSON.stringify([
    { title: "Scaffold", description: "vite app" },
    { title: "Auth", description: "login form" },
    { title: "Deploy", description: "docker" },
  ]);

  it("hands back the next task mid-plan, with its cursor and the total", () => {
    expect(nextTaskAfterPass(plan, 0)).toEqual({ nextIndex: 1, title: "Auth", total: 3 });
    expect(nextTaskAfterPass(plan, 1)).toEqual({ nextIndex: 2, title: "Deploy", total: 3 });
  });

  it("returns null on the final task — the run's exit gate takes it", () => {
    expect(nextTaskAfterPass(plan, 2)).toBeNull();
  });

  it("a single (synthetic) task completes on the first pass", () => {
    expect(nextTaskAfterPass(JSON.stringify([{ title: "Only task" }]), 0)).toBeNull();
  });

  it("broken or missing plan state falls back to completion, never crashes", () => {
    expect(nextTaskAfterPass(undefined, 0)).toBeNull();
    expect(nextTaskAfterPass("not json", 0)).toBeNull();
    expect(nextTaskAfterPass("[]", 0)).toBeNull();
    expect(nextTaskAfterPass(JSON.stringify([{ title: "A" }, { description: "no title" }]), 0)).toBeNull();
  });
});
