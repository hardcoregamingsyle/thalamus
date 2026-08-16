// Curated, strength-ranked model menu for the Dispatcher's per-agent model
// assignment. This replaces the old approach of dumping ModelScope's raw
// /v1/models listing at the Dispatcher: that listing carried no strength
// signal (so the Dispatcher could not tell DeepSeek-V4-Pro from a 30B nano
// model and guessed), and a pick that was unservable made the whole provider
// chain fall through to the OpenRouter `openrouter/free` auto-router — which
// is exactly how a weak `nemotron-3-nano-30b` got chosen for Coder in
// production.
//
// Instead, every model offered here is one of the verified ids from a provider
// catalog, grouped into tiers by how strong it is. The Dispatcher is told to
// give FRONTIER seats to the critical writers/reviewers, STANDARD to the
// mid-size workers, and LIGHT only to trivial roles. The ids are exact catalog
// ids, so a chosen assignment always short-circuits to the right provider
// (findZenModel / findOpenRouterModel / findDeadlySignalsModel /
// findModelScopeModel / findPollinationsModel all recognise them).

export interface MenuTier {
  label: string;
  note: string;
  // Provider-qualified so the Dispatcher can see the source, but the string
  // shown is the bare catalog id (the exact id callModel expects).
  ids: string[];
}

// FRONTIER — strongest seats: give these to Coder, Analyser, Critic, Planner.
const FRONTIER = [
  "deepseek-ai/DeepSeek-V4-Pro",              // ModelScope — frontier DeepSeek
  "Qwen/Qwen3.5-397B-A17B",                   // ModelScope — 397B MoE
  "nvidia/nemotron-3-ultra-550b-a55b:free",   // OpenRouter — 550B reasoning
  "deepseek-v4-flash",                        // DeadlySignal — 285B reasoning
  "kimi-k2.5",                                // DeadlySignal — 256B reasoning
  "gpt-5",                                    // DeadlySignal
  "gpt-5.4",                                  // DeadlySignal
  "deepseek-v4-flash-free",                   // Zen — the primary coding seat
];

// STANDARD — solid mid-size: Planner, Tester, Researcher, Optimiser, FactCheck.
const STANDARD = [
  "openai/gpt-oss-120b:free",                 // OpenRouter — 120B
  "qwen/qwen3-coder:free",                    // OpenRouter — coder-specialised
  "meta-llama/llama-3.3-70b-instruct:free",   // OpenRouter — 70B
  "Qwen/Qwen3.5-122B-A10B",                   // ModelScope — 122B
  "z-ai/glm-5.2",                             // DeadlySignal — 72B reasoning
  "Qwen/Qwen3.5-35B-A3B",                     // ModelScope — 35B
];

// LIGHT — small/fast: Organizer, ResearchPlanner, and similar lightweight roles.
const LIGHT = [
  "stepfun-ai/Step-3.5-Flash",                // ModelScope
  "Qwen/Qwen3.5-27B",                         // ModelScope
  "north-mini-code-free",                     // Zen
  "mimo-v2.5-free",                           // Zen
  "openai-fast",                              // Pollinations — 20B
];

export const DISPATCHER_MODEL_MENU: MenuTier[] = [
  { label: "FRONTIER", note: "Coder, Analyser, Critic, Planner", ids: FRONTIER },
  { label: "STANDARD", note: "Tester, Researcher, Optimiser, FactCheck", ids: STANDARD },
  { label: "LIGHT", note: "Organizer, ResearchPlanner, minor roles", ids: LIGHT },
];

/** Render the menu as the block appended to the Dispatcher prompt. */
export function buildDispatcherModelMenu(): string {
  const lines = ["## Live model menu (assign from these EXACT ids)"];
  for (const tier of DISPATCHER_MODEL_MENU) {
    lines.push(`\n[${tier.label}] — ${tier.note}`);
    for (const id of tier.ids) lines.push(`- ${id}`);
  }
  lines.push(
    "\nPick by tier: FRONTIER for the agents that write and gate the code (Coder, Analyser, Critic, Planner), STANDARD for the mid-size workers, LIGHT only for trivial roles. Use the exact ids — never invent one.",
  );
  return lines.join("\n");
}
