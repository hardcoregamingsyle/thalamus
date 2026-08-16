// Pure agent-list logic for the code pipeline — which agents run, in what
// order, for a given Dispatcher decision. No Convex framework imports, so it
// is unit-testable (see tests/pipelineAgents.test.ts) and shared by
// codePipeline.ts.

// All known agents in their natural order.
// Researcher is a three-agent team: ResearchPlanner → Researcher (data gatherer) → ReportMaker.
// KnowItAll answers questions directly and can hand back to the Dispatcher via
// {"op":"dispatch"} — it is a task-phase agent (a question dispatch runs the
// task pipeline with just KnowItAll in it).
export const ALL_PLANNING_AGENTS = ["ResearchPlanner", "Researcher", "ReportMaker", "FactCheck", "Analyser", "Planner"] as const;
export const ALL_TASK_AGENTS     = ["ResearchPlanner", "Researcher", "ReportMaker", "FactCheck", "Analyser", "Coder", "Optimiser", "Organizer", "Tester", "Hacker", "Critic", "KnowItAll"] as const;

// The full fallback pipelines (used when no Dispatcher output exists)
export const DEFAULT_PLANNING_PIPELINE = ["ResearchPlanner", "Researcher", "ReportMaker", "FactCheck", "Analyser", "Planner"];
export const DEFAULT_TASK_PIPELINE     = ["ResearchPlanner", "Researcher", "ReportMaker", "FactCheck", "Analyser", "Coder", "Optimiser", "Organizer", "Tester", "Hacker", "Critic"];

/** Ensure the research team is always included as a group. */
export function expandResearchTeam(agents: string[]): string[] {
  const hasAny = agents.some(a => a === "ResearchPlanner" || a === "Researcher" || a === "ReportMaker");
  if (!hasAny) return agents;
  const set = new Set(agents);
  set.add("ResearchPlanner");
  set.add("Researcher");
  set.add("ReportMaker");
  return [...set];
}

// Dispatcher-defined agents: anything in the dispatched list that is not a
// standard agent is a custom agent (declared in customAgentsJson with its own
// system prompt). They run after the standard agents, in dispatch order.
export function customAgentNames(dispatched: string[]): string[] {
  const standard = new Set<string>([...ALL_PLANNING_AGENTS, ...ALL_TASK_AGENTS]);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const a of dispatched) {
    if (!standard.has(a) && a && !seen.has(a)) {
      seen.add(a);
      out.push(a);
    }
  }
  return out;
}

/** Build the actual planning pipeline from the Dispatcher's chosen agent list.
 *  `skip` (the Dispatcher's first-iteration skip list, honored while
 *  skipActive) drops those agents for this pass — a continuation run that
 *  picks up where a stopped run got to. */
export function buildPlanningPipeline(dispatched: string[], skip: string[] = []): string[] {
  if (!dispatched || dispatched.length === 0) return DEFAULT_PLANNING_PIPELINE;
  const skipSet = new Set(skip);
  return [
    ...ALL_PLANNING_AGENTS.filter(a => expandResearchTeam(dispatched).includes(a) && !skipSet.has(a)),
    ...customAgentNames(dispatched).filter(a => !skipSet.has(a)),
  ];
}

/** Build the actual task pipeline from the Dispatcher's chosen agent list.
 *  Coder is always guaranteed to appear (enforced at dispatch time); the
 *  Critic is NOT forced — the Dispatcher decides whether verification is
 *  needed for this task. Custom agents are appended in dispatch order.
 *  `skip` (the Dispatcher's first-iteration skip list, honored while
 *  skipActive) drops those agents for this pass. */
export function buildTaskPipeline(dispatched: string[], skip: string[] = []): string[] {
  if (!dispatched || dispatched.length === 0) return DEFAULT_TASK_PIPELINE;
  const skipSet = new Set(skip);
  return [
    ...ALL_TASK_AGENTS.filter(a => expandResearchTeam(dispatched).includes(a) && !skipSet.has(a)),
    ...customAgentNames(dispatched).filter(a => !skipSet.has(a)),
  ];
}
