// Pure utility module - no Convex imports, just logic
// This keeps agentTeam.ts lean for faster module loading

import type { ActionCtx } from "../_generated/server";

// Platform-wide free+unlimited switch for Thalamus AgentBucks. While true, no
// user is charged and no usage cap blocks them. AgentOverflow's aoCredits are
// a separate economy with their own switch.
export const FREE_UNLIMITED = true;

// Re-exported so study.ts can keep calling it directly from agentCore.
export { callSiliconFlow } from "./ollamaClient";

import { callSiliconFlow, DISPATCHER_MODEL, DEFAULT_CHAT_MODEL, calcAgentBucksForModel } from "./ollamaClient";
import { agentToTaskType, type TaskType } from "./taskTypes";
import { callModal, calcModalAgentBucks } from "./modalClient";
import { callOvhcloud, mapTaskToOvhModel } from "./ovhcloudClient";
import { callZen, findZenModel, ZEN_DISPATCHER_MODEL, ZEN_DEFAULT_MODEL } from "./zenClient";
import { callDeadlySignals, findDeadlySignalsModel, DEADLYSIGNALS_DISPATCHER_MODEL, DEADLYSIGNALS_DEFAULT_MODEL } from "./deadlySignalsClient";
import { callModelScope, findModelScopeModel, MODELSCOPE_DISPATCHER_MODEL, MODELSCOPE_DEFAULT_MODEL } from "./modelscopeClient";
import { dokobotSearch, dokobotRead, hasDokobotKey, type DokobotSearchItem } from "./dokobotClient";

// The only tier-ish type left: callModel returns a provider-tagged string
// ("zen:<model>", "ollama:<model>", "modal:<model>", "ovhcloud:<model>",
// "deadlysignals:<model>") that the billing helpers read.
export type ModelTier = string;
// TaskDifficulty (the return type of parseDifficultyFromPlannerOutput) now
// lives in ./agentOutputParser and is re-exported from this module at the
// bottom of the file — importers see it exactly where they used to.

/**
 * Unified model caller — provider chain: Modal → Zen → DeadlySignal → ModelScope → OVHcloud → Ollama.
 * Pass ctx for Modal DB-key access; without ctx, falls back to Zen/Deadly/ModelScope/OVHcloud/Ollama
 * (Zen and OVHcloud are anonymous; DeadlySignal and ModelScope are keyed). A
 * Dispatcher-chosen Zen, DeadlySignal or ModelScope model id is honored directly. Only the Dispatcher's model
 * is hardcoded (per provider); every other agent's model is decided by the
 * Dispatcher at runtime.
 */
export async function callModel(
  prompt: string,
  systemPrompt: string,
  modelId: string = "deepseek-ai/DeepSeek-V4-Flash",
  ..._extra: unknown[]
): Promise<{ text: string; inputTokens: number; outputTokens: number; tier: string }> {
  // Extract ctx and optional assignedModel/deadlineMs overrides from _extra
  let ctx: { runQuery: ActionCtx["runQuery"] } | undefined;
  let assignedModel: string | undefined;
  let deadlineMs: number | undefined;
  for (const arg of _extra) {
    if (arg && typeof arg === "object" && "runQuery" in (arg as Record<string,unknown>)) {
      ctx = arg as { runQuery: ActionCtx["runQuery"] };
    }
    if (arg && typeof arg === "object" && "assignedModel" in (arg as Record<string,unknown>)) {
      const maybe = (arg as Record<string,unknown>).assignedModel;
      if (typeof maybe === "string" && maybe) assignedModel = maybe;
    }
    if (arg && typeof arg === "object" && "deadlineMs" in (arg as Record<string,unknown>)) {
      const maybe = (arg as Record<string,unknown>).deadlineMs;
      if (typeof maybe === "number" && maybe > 0) deadlineMs = maybe;
    }
  }

  const taskType: TaskType = agentToTaskType(modelId);

  // One shared wall-clock budget for the WHOLE provider chain. Convex kills
  // any action at 10 minutes with a "Transient error" that no try/catch in
  // our code can see — so if Modal + Zen + DeadlySignal + ModelScope + OVHcloud
  // + Ollama retries are ever allowed to stack past that, the pipeline dies without
  // saving an error message and the user just sees nothing. 7 minutes here
  // leaves the rest of the step (billing, file ops, streaming drip-feed) room
  // to finish and any failure surfaces as a normal thrown Error the caller can
  // report.
  const deadline = Date.now() + (deadlineMs ?? 420_000);

  // Dispatcher-chosen Zen model: honor it directly and skip Modal — a Zen
  // catalog id only exists on OpenCode Zen, so Modal would just burn retries
  // on a model name it does not serve.
  if (assignedModel && findZenModel(assignedModel)) {
    try {
      const result = await callZen(prompt, systemPrompt, assignedModel, 8192, undefined, deadline);
      return { text: result.text, inputTokens: result.inputTokens, outputTokens: result.outputTokens, tier: `zen:${result.model}` };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn("Zen call failed, falling back to the provider chain:", msg);
    }
  }

  // Dispatcher-chosen DeadlySignal model: same as Zen — honor it directly.
  if (assignedModel && findDeadlySignalsModel(assignedModel)) {
    try {
      const result = await callDeadlySignals(prompt, systemPrompt, assignedModel, 8192, undefined, deadline);
      return { text: result.text, inputTokens: result.inputTokens, outputTokens: result.outputTokens, tier: `deadlysignals:${result.model}` };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn("DeadlySignal call failed, falling back to the provider chain:", msg);
    }
  }

  // Dispatcher-chosen ModelScope model: same as Zen — honor it directly.
  if (assignedModel && findModelScopeModel(assignedModel)) {
    try {
      const result = await callModelScope(prompt, systemPrompt, assignedModel, 8192, undefined, deadline);
      return { text: result.text, inputTokens: result.inputTokens, outputTokens: result.outputTokens, tier: `modelscope:${result.model}` };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn("ModelScope call failed, falling back to the provider chain:", msg);
    }
  }

  // One full pass over every seat. Returns a result, or throws the LAST
  // seat's error after logging each miss.
  const runProviderChain = async (): Promise<{ text: string; inputTokens: number; outputTokens: number; tier: string }> => {
    if (ctx) {
      // Modal first when an admin has registered an endpoint. Which endpoint is
      // decided by data (the isPrimary row comes back first), not by this code —
      // so swapping the primary model is a click in /admin, not a deploy. Falls
      // through to Zen → DeadlySignal → ModelScope → OVHcloud → Ollama when
      // nothing is registered or every endpoint errors.
      try {
        const result = await callModal(ctx, prompt, systemPrompt, 8192, 0.7, undefined, deadline);
        return { text: result.text, inputTokens: result.inputTokens, outputTokens: result.outputTokens, tier: `modal:${result.model}` };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (!msg.includes("MODAL_NOT_CONFIGURED")) {
          console.warn("Modal call failed, falling back to Zen:", msg);
        }
      }
    }

    // OpenCode Zen — free anonymous tier, no API key needed. Primary fallback
    // after Modal: DeepSeek V4 Flash free is a frontier coding seat.
    const zenModel = assignedModel && findZenModel(assignedModel)
      ? assignedModel
      : (taskType === "dispatcher" ? ZEN_DISPATCHER_MODEL : ZEN_DEFAULT_MODEL);
    try {
      const result = await callZen(prompt, systemPrompt, zenModel, 8192, undefined, deadline);
      return { text: result.text, inputTokens: result.inputTokens, outputTokens: result.outputTokens, tier: `zen:${result.model}` };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`Zen call failed, falling back to DeadlySignal:`, msg);
    }

    // DeadlySignal — keyed New API gateway (DEADLYSIGNALS_API_KEY env var).
    // Second fallback after Zen: serves frontier models (kimi-k2.5, gpt-5.x,
    // glm-5.2) when Zen is down or too slow.
    const deadlyModel = assignedModel && findDeadlySignalsModel(assignedModel)
      ? assignedModel
      : (taskType === "dispatcher" ? DEADLYSIGNALS_DISPATCHER_MODEL : DEADLYSIGNALS_DEFAULT_MODEL);
    try {
      const result = await callDeadlySignals(prompt, systemPrompt, deadlyModel, 8192, undefined, deadline);
      return { text: result.text, inputTokens: result.inputTokens, outputTokens: result.outputTokens, tier: `deadlysignals:${result.model}` };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`DeadlySignal call failed, falling back to ModelScope:`, msg);
    }

    // ModelScope — Alibaba's official free API-Inference tier (MODELSCOPE_API_KEY
    // env var, .ai host). Third fallback when Zen and Deadly are down: serves
    // DeepSeek-V4-Pro — the frontier seat every other provider in the chain fails.
    const scopeModel = assignedModel && findModelScopeModel(assignedModel)
      ? assignedModel
      : (taskType === "dispatcher" ? MODELSCOPE_DISPATCHER_MODEL : MODELSCOPE_DEFAULT_MODEL);
    try {
      const result = await callModelScope(prompt, systemPrompt, scopeModel, 8192, undefined, deadline);
      return { text: result.text, inputTokens: result.inputTokens, outputTokens: result.outputTokens, tier: `modelscope:${result.model}` };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`ModelScope call failed, falling back to OVHcloud:`, msg);
    }

    // OVHcloud — free anonymous tier, no API key needed, 2 RPM.
    // Catches requests when Zen is down before falling to Ollama.
    const ovhModel = mapTaskToOvhModel(taskType);
    try {
      const result = await callOvhcloud(prompt, systemPrompt, ovhModel, 8192, ctx?.runQuery, deadline);
      return { text: result.text, inputTokens: result.inputTokens, outputTokens: result.outputTokens, tier: `ovhcloud:${result.model}` };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`OVHcloud call failed, falling back to Ollama:`, msg);
    }

    const ollamaModel = mapModelIdToOllama(modelId);
    const result = await callSiliconFlow(prompt, systemPrompt, ollamaModel, 16384, undefined, ctx?.runQuery, deadline);
    return { text: result.text, inputTokens: result.inputTokens, outputTokens: result.outputTokens, tier: `ollama:${result.model}` };
  };

  // The free seats rate-limit TOGETHER under burst traffic (Zen 429s on shared
  // egress, ModelScope daily/per-model quotas, OVHcloud's 2 RPM) — which used
  // to surface as "no provider configured" after a few quick messages even
  // though every provider was fine a minute earlier. One backoff'd second pass
  // rides out the burst when the chain budget allows it.
  const CHAIN_RETRY_DELAY_MS = 25_000;
  try {
    return await runProviderChain();
  } catch (firstErr) {
    const budgetLeft = deadline - Date.now();
    if (budgetLeft > CHAIN_RETRY_DELAY_MS + 60_000) {
      console.warn(`Every provider seat missed; retrying the chain once in ${CHAIN_RETRY_DELAY_MS / 1000}s`);
      await new Promise((r) => setTimeout(r, CHAIN_RETRY_DELAY_MS));
      try {
        return await runProviderChain();
      } catch { /* fall through to the error below with the ORIGINAL failure */ }
    }
    const msg = firstErr instanceof Error ? firstErr.message : String(firstErr);
    if (msg.includes("not configured")) {
      throw new Error(`No AI provider configured — add Modal or Ollama keys via /admin, then a Zen/DeadlySignal/ModelScope/OVHcloud call can serve.`);
    }
    throw new Error(`All AI provider seats failed (likely rate-limited under burst — retried once). Last error: ${msg.slice(0, 300)}`);
  }
}

function mapModelIdToOllama(modelId: string): string {
  const l = modelId.toLowerCase();
  if (l.includes("dispatcher") || l.includes("organiser") || l.includes("organizer") || l.includes("summarizer")) return "gemma4:31b";
  if (l.includes("coder") || l.includes("optimiser") || l.includes("architect")) return "minimax-m3";
  if (l.includes("analyser") || l.includes("planner") || l.includes("critic") || l.includes("reasoning")) return "minimax-m3";
  if (l.includes("researchplanner") || l.includes("researcher") || l.includes("research") || l.includes("reportmaker") || l.includes("scout")) return "gpt-oss:120b";
  if (l.includes("factcheck") || l.includes("fact.check") || l.includes("fact_check")) return "minimax-m3";
  if (l.includes("tester") || l.includes("hacker") || l.includes("security")) return "minimax-m3";
  return DEFAULT_CHAT_MODEL;
}

/**
 * Calculate AgentBucks — branch on provider prefix, free tiers cost 0.
 */
export function calcAgentBucksForTier(
  tier: string,
  inputTokens: number,
  outputTokens: number,
): number {
  if (tier.startsWith("modal:")) {
    return calcModalAgentBucks(inputTokens, outputTokens);
  }
  if (tier.startsWith("ovhcloud:")) {
    return 0; // OVHcloud free anonymous tier — no cost
  }
  if (tier.startsWith("zen:")) {
    return 0; // OpenCode Zen free anonymous tier — no cost
  }
  if (tier.startsWith("deadlysignals:")) {
    return 0; // DeadlySignal keyed gateway — community/free tier, no cost
  }
  if (tier.startsWith("modelscope:")) {
    return 0; // ModelScope official free API-Inference tier — no cost
  }
  return calcAgentBucksForModel(tier.replace("ollama:", ""), inputTokens, outputTokens);
}


// How many top results to deep-read for the default `performSearch` path, and
// how much page text to keep per result. Deep-read means the agent sees the
// actual page prose, not just a SERP snippet — the whole point of the Dokobot
// integration. Bounds chosen so a single search block stays under ~10 KB even
// when all three pages fetch cleanly.
const DEFAULT_DEEP_TOP_N = 3;
const DEEP_PAGE_CHAR_BUDGET = 2500;

interface SearchProviderResult {
  items: DokobotSearchItem[];
  provider: "dokobot" | "google" | "ddg" | "none";
}

/**
 * Provider layer for the raw SERP call, in fallback order:
 *   1. Dokobot (when `DOKOBOT_API_KEY` is set) — best quality, deep-read capable.
 *   2. Google Custom Search (`GOOGLE_API_KEY` + `GOOGLE_CX`) — keyed, reliable.
 *   3. DuckDuckGo HTML — keyless last resort so a deployment with NO search
 *      keys still researches with real results instead of a dead research team
 *      (which is exactly how a pipeline run failed on 2026-08-08). Rate limits
 *      and markup drift make it best-effort only; the keyed seats above should
 *      be configured for production quality.
 * Returns an empty item list rather than throwing when everything misses.
 */
async function fetchSearchProviderResults(query: string, num: number): Promise<SearchProviderResult> {
  if (hasDokobotKey()) {
    try {
      const res = await dokobotSearch(query, num);
      if (res.items.length > 0) return { items: res.items, provider: "dokobot" };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn("Dokobot search failed, falling back to Google CSE:", msg);
    }
  }

  const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY ?? "";
  const GOOGLE_CX = process.env.GOOGLE_CX ?? "";
  if (GOOGLE_API_KEY && GOOGLE_CX) {
    try {
      const url = `https://www.googleapis.com/customsearch/v1?key=${encodeURIComponent(GOOGLE_API_KEY)}&cx=${encodeURIComponent(GOOGLE_CX)}&q=${encodeURIComponent(query)}&num=${num}`;
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json() as { items?: Array<{ title: string; snippet: string; link: string }> };
        if (data.items && data.items.length > 0) {
          return {
            items: data.items.map(it => ({ title: it.title, link: it.link, snippet: it.snippet })),
            provider: "google",
          };
        }
      }
    } catch { /* fall through */ }
  }

  try {
    const ddgItems = await duckduckgoSearch(query, num);
    if (ddgItems.length > 0) return { items: ddgItems, provider: "ddg" };
  } catch { /* fall through */ }

  return { items: [], provider: "none" };
}

// Minimal entity decode for DDG's HTML — only what shows up in titles/snippets.
function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ");
}

/**
 * Keyless SERP via DuckDuckGo's HTML endpoint. Parses the `result__a` /
 * `result__snippet` markup; result hrefs are DDG redirect links carrying the
 * real URL in the `uddg` param. Parser failures return [] (never throw) so the
 * provider chain treats markup drift like any other miss.
 */
async function duckduckgoSearch(query: string, num: number): Promise<DokobotSearchItem[]> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10_000);
  try {
    const res = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
      headers: {
        // DDG serves a bot-block page to empty/obviously-programmatic agents.
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
        "Accept": "text/html",
      },
      signal: ctrl.signal,
    });
    if (!res.ok) return [];
    const html = await res.text();

    const items: DokobotSearchItem[] = [];
    const linkRe = /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
    const snippetRe = /<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
    const snippets: string[] = [];
    for (let m = snippetRe.exec(html); m; m = snippetRe.exec(html)) {
      snippets.push(decodeHtmlEntities(m[1].replace(/<[^>]+>/g, "").trim()));
    }
    let i = 0;
    for (let m = linkRe.exec(html); m && items.length < num; m = linkRe.exec(html), i++) {
      let link = m[1];
      // "//duckduckgo.com/l/?uddg=<encoded>&rut=..." → the real destination.
      const uddg = /[?&]uddg=([^&]+)/.exec(link);
      if (uddg) {
        try { link = decodeURIComponent(uddg[1]); } catch { /* keep redirect URL */ }
      } else if (link.startsWith("//")) {
        link = `https:${link}`;
      }
      const title = decodeHtmlEntities(m[2].replace(/<[^>]+>/g, "").trim());
      if (!title || !link.startsWith("http")) continue;
      items.push({ title, link, snippet: snippets[i] ?? "" });
    }
    return items;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Deep-read `topN` result URLs. Tries Dokobot's remote-browser read first when a
 * key is set (it renders JS-heavy SPAs); silently falls through to the plain
 * HTML `performScrape` when Dokobot can't help (no extension connected, timeout,
 * encrypted payload). Results run in parallel so latency = slowest page, not sum.
 */
async function deepReadResults(items: DokobotSearchItem[], topN: number): Promise<string[]> {
  const targets = items.slice(0, topN);
  const canUseDokobotRead = hasDokobotKey();
  const readPromises = targets.map(async (item) => {
    if (canUseDokobotRead) {
      try {
        const r = await dokobotRead(item.link, 30);
        return distillPageText(r.text);
      } catch { /* fall through to plain scrape */ }
    }
    try {
      const text = await performScrape(item.link);
      return distillPageText(text);
    } catch {
      return "";
    }
  });
  return Promise.all(readPromises);
}

function distillPageText(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length <= DEEP_PAGE_CHAR_BUDGET) return trimmed;
  return trimmed.slice(0, DEEP_PAGE_CHAR_BUDGET) + "\n...[truncated]";
}

function formatSearchBlock(items: DokobotSearchItem[], pages: string[]): string {
  return items.map((r, i) => {
    const header = `[${i + 1}] ${r.title}\n${r.snippet ?? ""}\n${r.link}`.trim();
    const page = pages[i];
    if (!page) return header;
    return `${header}\n\n--- Page content ---\n${page}`;
  }).join("\n\n");
}

/**
 * Web search for agent prompts. Returns a numbered, readable block that agents
 * paste into their reasoning. Behavior:
 *   • With `DOKOBOT_API_KEY` set: Dokobot search → top-N page reads → distilled
 *     content appended under each result. This is the DEEP path — agents see
 *     the actual page prose, not just SERP snippets.
 *   • Without a Dokobot key: Google Custom Search (surface snippets only, no
 *     page reads — CSE cannot fetch page content and blind scraping every SERP
 *     result was not the previous behavior).
 *   • With neither configured: falls through to the dispatcher's model
 *     knowledge, and finally to a "[Search not available]" marker.
 *
 * The return format is preserved for backward-compat: `[N] title\nsnippet\nlink`
 * blocks separated by blank lines. When deep-read text is available, it is
 * appended under each block with a `--- Page content ---` divider — additive,
 * so downstream regex/prompts that only care about the header still work.
 *
 * The optional second arg (previously `_keys`) is unused and left for signature
 * stability. Pass `{ deep: false }` as the third arg to skip page reads (e.g.
 * from a fact-checker that only wants to sanity-check URLs).
 */
export async function performSearch(
  query: string,
  _keys?: string[],
  opts?: { deep?: boolean; topN?: number; num?: number },
): Promise<string> {
  const num = opts?.num ?? 5;
  const deep = opts?.deep !== false;
  const topN = Math.min(Math.max(opts?.topN ?? DEFAULT_DEEP_TOP_N, 0), num);

  const providerResult = await fetchSearchProviderResults(query, num);
  if (providerResult.items.length > 0) {
    const pages = deep && topN > 0 ? await deepReadResults(providerResult.items, topN) : [];
    return formatSearchBlock(providerResult.items, pages);
  }

  try {
    const { text } = await callSiliconFlow(
      `Search: "${query}"\n\nProvide a concise factual answer with key details.`,
      "You are a search assistant.",
      DISPATCHER_MODEL,
      2048,
    );
    if (text.trim().length > 20) return text;
  } catch { /* ignore */ }

  return `[Search not available — no search API configured.]`;
}

/**
 * Explicit deep-search entry point. Equivalent to `performSearch(query, undefined, {deep: true, topN})`
 * but named for callers that want to make the intent obvious. The default
 * `performSearch` is already deep, so use this only when you want a different
 * `topN` than the default (3) or the readability of the explicit name.
 */
export async function performDeepSearch(query: string, topN: number = DEFAULT_DEEP_TOP_N): Promise<string> {
  return performSearch(query, undefined, { deep: true, topN });
}

export async function performScrape(url: string): Promise<string> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; ResearchBot/1.0)",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
    });
    clearTimeout(timeout);
    if (!res.ok) return `[SCRAPE ERROR: HTTP ${res.status} for ${url}]`;
    const html = await res.text();
    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/\s{3,}/g, "\n\n")
      .trim();
    return text.length > 6000 ? text.slice(0, 6000) + "\n...[truncated]" : text;
  } catch (err) {
    return `[SCRAPE EXCEPTION: ${err instanceof Error ? err.message : String(err)}]`;
  }
}

// ── Re-exports ─────────────────────────────────────────────────────────────
// The AGENT_SYSTEM_PROMPTS record, the MODE_ADHD/adhdToTemperature/
// MODE_SYSTEM_PROMPTS trio, and the whole output-parser surface used to live
// in this file. They now live next door under lib/. Re-exporting means every
// existing `import { … } from "./lib/agentCore"` (or "./agentCore") keeps
// working unchanged — no importer has to know about the split.
export * from "./agentPrompts";
export * from "./modePrompts";
export * from "./agentOutputParser";
