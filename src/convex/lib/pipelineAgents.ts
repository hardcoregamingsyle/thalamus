// Pure agent-team logic for the code pipeline — the fixed cast, the
// four-agent Research Team, and the `over to` hand-off resolver. No Convex
// framework imports, so it is unit-testable (see tests/pipelineAgents.test.ts)
// and shared by codePipeline.ts.
//
// The execution model this module encodes:
//   - The cast is FIXED. There is no Dispatcher-chosen roster anymore — the
//     Dispatcher lives in the background and its only job is picking which
//     MODEL each teammate runs on (see codePipeline.ts).
//   - The Analyser opens every run; from there each agent ends its turn by
//     naming the next teammate with {"op":"over-to","agent":"...", ...}.
//   - The four research agents run ONLY as the Research Team: an over-to that
//     names the team (or, as a convenience, any single member, which is
//     upgraded to the whole team) starts ResearchPlanner, and the members run
//     strictly in RESEARCH_TEAM order. No over-to may ever land on just one of
//     them — research is gathered, written and fact-checked as one job.

// Directly hand-offable teammates, in their natural order. The four research
// agents are deliberately NOT here — see RESEARCH_TEAM.
export const TEAM_AGENTS = [
  "Analyser", "Planner", "Coder", "Optimiser", "Organizer",
  "Tester", "Hacker", "Critic", "KnowItAll",
] as const;

// The Research Team — always summoned as a unit (over to "ResearchTeam") and
// always run top-to-bottom in this exact order: plan the searches, gather the
// data, write the report, verify the claims.
export const RESEARCH_TEAM = ["ResearchPlanner", "Researcher", "ReportMaker", "FactCheck"] as const;

// The canonical name an over-to uses to summon the whole team. The resolver
// returns this sentinel; the pipeline recognises it and starts the team at
// index 0 of RESEARCH_TEAM.
export const RESEARCH_TEAM_TARGET = "ResearchTeam";

// Names an agent may never hand off to: the Dispatcher is a background
// model-picker, not a teammate, and User/System are transcript roles, not
// runnable agents.
const UNHANDOFFABLE = new Set(["dispatcher", "user", "system"]);

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

// What callers write for the team (after the leading "the "/"agent " strip):
// "research team", "research team agents", "researchers", plain "research".
const TEAM_ALIASES = new Set(["researchteam", "researchteamagents", "researchers", "research"]);

/**
 * Validate an {"op":"over-to"} target into the next thing the pipeline runs.
 *
 * The parser records the raw string the model wrote; this decides whether it
 * names a real teammate (returns its CANONICAL casing), the Research Team
 * (returns RESEARCH_TEAM_TARGET), or nothing runnable (undefined — the
 * pipeline then falls back to the Analyser, the team's lead router).
 *
 * Research-team handling is the special case, and it is strict on purpose:
 * naming ANY single member ("over to the researcher") returns the TEAM
 * sentinel, never the member — a member can only run as part of the team, in
 * order. The pipeline tells the two spellings apart (a direct team name vs an
 * upgraded member name) by checking RESEARCH_TEAM membership itself when it
 * wants to note the upgrade in the transcript.
 *
 * Matching is deliberately conservative: case- and punctuation-insensitive,
 * with a leading "the "/"agent " tolerated ("over to the critic" lands on
 * Critic). No suffix/fuzzy matching beyond that — "ResearchPlanner" must NOT
 * resolve to "Planner", so anything looser than an exact normalized match is
 * worth more than convenience here.
 *
 * A target equal to the agent itself returns undefined: handing off to
 * yourself is a no-op the normal fallback already covers, and honouring it
 * would let a model loop its own seat forever.
 */
export function resolveHandoffTarget(
  rawTarget: string | undefined,
  selfName: string,
): string | undefined {
  if (!rawTarget) return undefined;
  let want = norm(rawTarget);
  if (!want) return undefined;
  if (want.startsWith("the") && want.length > 3) want = want.slice(3);
  if (want.startsWith("agent") && want.length > 5) want = want.slice(5);
  if (UNHANDOFFABLE.has(want)) return undefined;
  // The team by name.
  if (TEAM_ALIASES.has(want)) return RESEARCH_TEAM_TARGET;
  // A single research agent — upgraded to the whole team. Members never run
  // alone: the planner's keywords feed the gatherer, the gatherer's JSON feeds
  // the report, the report feeds the fact-check; landing mid-team would hand
  // downstream members context they never got.
  if (RESEARCH_TEAM.some((m) => norm(m) === want)) return RESEARCH_TEAM_TARGET;
  const hit = TEAM_AGENTS.find((a) => norm(a) === want);
  if (!hit) return undefined;
  if (norm(hit) === norm(selfName)) return undefined;
  return hit;
}

/** True when `name` is a runnable agent phase — one of the directly
 *  hand-offable teammates, or a Research Team member MID-TEAM-RUN (the
 *  pipeline drives members itself while the team is in progress; members are
 *  runnable phases even though no over-to may name them individually). */
export function isRunnableAgent(name: string): boolean {
  const want = norm(name);
  if (!want || UNHANDOFFABLE.has(want)) return false;
  return (
    TEAM_AGENTS.some((a) => norm(a) === want) ||
    RESEARCH_TEAM.some((m) => norm(m) === want)
  );
}

/** The display name for transcript/UI lines when a target is the team. */
export function handoffDisplayName(target: string): string {
  return target === RESEARCH_TEAM_TARGET ? "the Research Team" : target;
}

/** The plan's next task after a Critic pass, or null when the pass was on the
 *  FINAL task (the run's exit gate). The pass is the ONLY thing that moves
 *  the plan cursor — the plan is a checklist the pipeline carries forward,
 *  never a routing decision (movement stays with the agents' over-to
 *  hand-offs; the carry just keeps one run walking the whole plan instead of
 *  completing after task one). */
export function nextTaskAfterPass(
  plannerTasksJson: string | undefined,
  currentTaskIndex: number,
): { nextIndex: number; title: string; total: number } | null {
  let tasks: Array<{ title?: unknown }>;
  try {
    tasks = JSON.parse(plannerTasksJson || "[]");
  } catch {
    return null;
  }
  if (!Array.isArray(tasks)) return null;
  const next = tasks[currentTaskIndex + 1];
  if (!next || typeof next.title !== "string" || next.title.length === 0) return null;
  return { nextIndex: currentTaskIndex + 1, title: next.title, total: tasks.length };
}
