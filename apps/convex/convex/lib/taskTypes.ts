// Agent-name → task-type routing. The provider router (agentCore.ts) reads
// TaskType and agentToTaskType() to pick a model class per pipeline agent.
//
// (Historical note: this file used to be the NVIDIA NIM client — NIM was
// pulled from the pipeline and every NIM-specific export was dead code. Only
// the routing helpers survived; the file is named after what it does now.)

/**
 * The task classes the model router understands. Each provider client maps a
 * task type to its own best available model (e.g. mapModelIdToOllama in
 * agentCore.ts).
 */
export type TaskType = "dispatcher" | "chat" | "code" | "reasoning" | "agent" | "research" | "factcheck";

/**
 * Map a pipeline agent name to its task type. Matching is by lowercase
 * substring, so it tolerates decorated names ("Researcher (deep)").
 *
 * The agent name is the routing key for the whole model chain: an unknown
 * name falls through to "chat", which silently lands the call on the generic
 * chat model — if you add an agent, add its spelling here.
 */
export function agentToTaskType(agentName: string): TaskType {
  const name = agentName.toLowerCase();
  // Both spellings on purpose: the pipeline names the agent "Organizer" (z),
  // and an earlier version of this map only matched "organiser" (s), which
  // silently misrouted the Organizer to the chat model every time.
  if (name.includes("dispatcher") || name.includes("organiser") || name.includes("organizer") || name.includes("summarizer")) return "dispatcher";
  if (name.includes("factcheck") || name.includes("fact.check") || name.includes("fact_check") || name.includes("verifier")) return "factcheck";
  if (name.includes("coder") || name.includes("optimiser") || name.includes("architect")) return "code";
  if (name.includes("analyser") || name.includes("planner") || name.includes("critic")) return "reasoning";
  if (name.includes("researcher") || name.includes("research") || name.includes("reportmaker") || name.includes("scout")) return "research";
  if (name.includes("tester") || name.includes("hacker") || name.includes("auditor") || name.includes("security")) return "agent";
  // KnowItAll answers questions — the chat model class is the right seat. The
  // default below would land it there anyway, but the mapping is explicit so a
  // future refactor of the fallback cannot silently misroute it.
  if (name.includes("knowitall") || name.includes("knowledge")) return "chat";
  return "chat"; // default for unknown agents
}
