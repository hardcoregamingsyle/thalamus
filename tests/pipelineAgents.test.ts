// Which agents run, in what order. The skip-list cases are the important ones:
// a skip list that hides the agent the pipeline is about to be routed to is
// what dead-ended live runs with 'Coder is no longer part of the current plan'.
import { describe, it, expect } from "bun:test";
import {
  buildTaskPipeline,
  buildPlanningPipeline,
  expandResearchTeam,
  customAgentNames,
  DEFAULT_TASK_PIPELINE,
} from "../src/convex/lib/pipelineAgents";

describe("buildTaskPipeline", () => {
  it("keeps the dispatched agents in canonical order, not dispatch order", () => {
    expect(buildTaskPipeline(["Critic", "Coder"])).toEqual(["Coder", "Critic"]);
  });

  it("falls back to the full pipeline when nothing is dispatched", () => {
    expect(buildTaskPipeline([])).toEqual(DEFAULT_TASK_PIPELINE);
  });

  it("does not force the Critic — the Dispatcher decides", () => {
    expect(buildTaskPipeline(["Coder"])).toEqual(["Coder"]);
  });

  it("appends custom agents after the standard ones, in dispatch order", () => {
    expect(buildTaskPipeline(["Critic", "Migrator", "Coder", "Auditor"]))
      .toEqual(["Coder", "Critic", "Migrator", "Auditor"]);
  });

  // The live failure: Dispatcher runs "Critic → Coder" on a continuation with
  // Coder in the first-pass skip list. The Critic fails the task and routes
  // back to the Coder — which the skip list had removed from the pipeline, so
  // the next step found its own target missing and stopped the run outright.
  it("a skip list CAN hide the agent a Critic failure routes back to", () => {
    const withSkip = buildTaskPipeline(["Critic", "Coder"], ["Coder"]);
    expect(withSkip).toEqual(["Critic"]);
    expect(withSkip.indexOf("Coder")).toBe(-1); // the dead-end condition

    // Retiring the skip list (what the Critic-fail path now does) restores it.
    const retired = buildTaskPipeline(["Critic", "Coder"]);
    expect(retired).toContain("Coder");
  });

  it("skips are ignored once the list is empty", () => {
    expect(buildTaskPipeline(["Coder", "Critic"], [])).toEqual(["Coder", "Critic"]);
  });
});

describe("buildPlanningPipeline", () => {
  it("pulls in the whole research team when any member is dispatched", () => {
    expect(buildPlanningPipeline(["Researcher", "Planner"]))
      .toEqual(["ResearchPlanner", "Researcher", "ReportMaker", "Planner"]);
  });
});

describe("expandResearchTeam", () => {
  it("adds the missing teammates when one is present", () => {
    expect(expandResearchTeam(["Researcher"]).sort())
      .toEqual(["ReportMaker", "ResearchPlanner", "Researcher"]);
  });

  it("leaves a list with no researcher untouched", () => {
    expect(expandResearchTeam(["Coder", "Critic"])).toEqual(["Coder", "Critic"]);
  });
});

describe("customAgentNames", () => {
  it("returns only non-standard names, deduped, in order", () => {
    expect(customAgentNames(["Coder", "Migrator", "Critic", "Migrator", "Auditor"]))
      .toEqual(["Migrator", "Auditor"]);
  });

  it("returns nothing when every agent is standard", () => {
    expect(customAgentNames(["Coder", "Tester", "Critic"])).toEqual([]);
  });
});
