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

// Names an agent may never hand off to: the Dispatcher is a phase, not a
// teammate, and User/System are transcript roles, not runnable agents.
const UNHANDOFFABLE = new Set(["dispatcher", "user", "system"]);

/**
 * Validate an {"op":"over-to"} target into a runnable agent name.
 *
 * The parser records the raw string the model wrote; this decides whether it
 * names a real teammate and returns that agent's CANONICAL casing, or
 * undefined (the pipeline then simply advances by the roster order).
 *
 * Matching is deliberately conservative: case- and punctuation-insensitive,
 * with a leading "the "/"agent " tolerated ("over to the critic" lands on
 * Critic). No suffix/fuzzy matching beyond that — "ResearchPlanner" must NOT
 * resolve to "Planner", so anything looser than an exact normalized match is
 * worth more than convenience here.
 *
 * A target equal to the agent itself returns undefined: handing off to
 * yourself is a no-op the normal advance already covers, and honouring it
 * would let a model loop its own seat forever.
 */
export function resolveHandoffTarget(
  rawTarget: string | undefined,
  selfName: string,
  customNames: string[] = [],
): string | undefined {
  if (!rawTarget) return undefined;
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  let want = norm(rawTarget);
  if (!want) return undefined;
  if (want.startsWith("the") && want.length > 3) want = want.slice(3);
  if (want.startsWith("agent") && want.length > 5) want = want.slice(5);
  if (UNHANDOFFABLE.has(want)) return undefined; // Dispatcher/User/System are not teammates
  // Planning AND task agents are valid hand-off targets: "this needs
  // re-planning" is a legitimate mid-execution hand-off, just as "the Coder
  // must fix this" is a legitimate mid-planning one. Deduped — the two lists
  // share the research team.
  const candidates = [...new Set([...ALL_PLANNING_AGENTS, ...ALL_TASK_AGENTS, ...customNames])];
  const hit = candidates.find((a) => norm(a) === want);
  if (!hit) return undefined;
  if (norm(hit) === norm(selfName)) return undefined;
  return hit;
}

/** True when `name` is a runnable agent (standard or custom) — used by the
 *  pipeline to decide whether an out-of-roster phase is a deliberate handoff
 *  destination (run it) or a dead end (park the run). */
export function isRunnableAgent(name: string, customNames: string[] = []): boolean {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const want = norm(name);
  if (!want || UNHANDOFFABLE.has(want)) return false;
  return [...ALL_PLANNING_AGENTS, ...ALL_TASK_AGENTS, ...customNames].some((a) => norm(a) === want);
}
