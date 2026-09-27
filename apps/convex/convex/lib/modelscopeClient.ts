// ModelScope API client — Alibaba's official free API-Inference tier.
// Runs on the INTERNATIONAL host api-inference.modelscope.ai (the domestic
// api-inference.modelscope.cn host rejects tokens minted on the .ai site —
// tokens are site-scoped). OpenAI-compatible at /v1. Auth is the user's
// "ms-…" access token from modelscope.ai/my/myaccesstoken, set in the Convex
// dashboard as MODELSCOPE_API_KEY, with MODELSCOPE_API_KEY_2 … _10 as a
// fallback pool tried in order when the primary is rate-limited or revoked.
// Free quota: ~2000 requests/day total, ~200 per model, resetting midnight
// UTC+8 — see /docs/model-service/API-Inference/limits.
//
// Model caveat: only the models in MODELSCOPE_MODEL_CATALOG below were
// verified live (2026-08-07) to return tokens from this key. Qwen3.8-Max
// (Qwen-Ambassador/Qwen3.8-Max) exists in the catalog but 403s — it needs a
// per-model access application on ModelScope. DeepSeek-V4-Pro is the frontier
// target that every other seat in the chain fails on — it works here.

import type { ActionCtx } from "../_generated/server";

// ── Base URL ───────────────────────────────────────────────────────────────────
const BASE_URL = "https://api-inference.modelscope.ai/v1";

// Per-attempt abort — sized so the whole Modal → Zen → OpenRouter → DeadlySignal
// → ModelScope → Pollinations → Ollama chain fits inside Convex's 10-minute
// action kill. Raised from 60s to 120s: the account's frontier seat is a
// reasoning model (DeepSeek-V4-Pro) asked for up to 32k tokens; a 60s abort cut
// legitimate long generations short. Still bounded by the caller's chain
// deadline, so a hung seat cannot blow the budget.
const MODELSCOPE_ATTEMPT_TIMEOUT_MS = 120_000;

// ── Model Catalog ─────────────────────────────────────────────────────────────
// Only models verified live against the .ai host on 2026-08-07.

// Models this account is KNOWN to be unable to serve. Qwen3.8-Max is in the
// ModelScope catalog and shows up on the live /v1/models listing, but this key
// gets a 403 ("your current account does not have access to this model") — it
// needs a per-model access application. Left in the Dispatcher's menu, the
// Dispatcher keeps assigning it (it reads as a strong name), the call 403s,
// and the whole provider chain falls through — which is exactly the "random"
// provider-hopping the logs show. Blocking it here keeps it out of the menu
// (and out of any assignment the Dispatcher might still try) so the chain
// doesn't burn a hop on a model that can never answer. Add any future model
// that 403s on this account to this list.
const MODEL_BLOCKLIST: string[] = ["Qwen-Ambassador/Qwen3.8-Max", "Qwen/Qwen3.8-Max"];

export interface ModelScopeModelInfo {
  id: string;
  name: string;
  provider: string;
  contextWindow: number;
  parameterCount: string;
  isReasoning: boolean;
}

export const MODELSCOPE_MODEL_CATALOG: ModelScopeModelInfo[] = [
  {
    id: "deepseek-ai/DeepSeek-V4-Pro",
    name: "DeepSeek V4 Pro",
    provider: "DeepSeek",
    contextWindow: 8192,
    parameterCount: "—",
    isReasoning: true,
  },
  {
    id: "deepseek-ai/DeepSeek-V3.2-Exp",
    name: "DeepSeek V3.2 Experimental",
    provider: "DeepSeek",
    contextWindow: 8192,
    parameterCount: "671B",
    isReasoning: true,
  },
  {
    id: "Qwen/Qwen3.5-397B-A17B",
    name: "Qwen3.5 397B",
    provider: "Alibaba",
    contextWindow: 131072,
    parameterCount: "397B",
    isReasoning: true,
  },
  {
    id: "Qwen/Qwen3.5-122B-A10B",
    name: "Qwen3.5 122B",
    provider: "Alibaba",
    contextWindow: 131072,
    parameterCount: "122B",
    isReasoning: true,
  },
  {
    id: "Qwen/Qwen3.5-35B-A3B",
    name: "Qwen3.5 35B",
    provider: "Alibaba",
    contextWindow: 131072,
    parameterCount: "35B",
    isReasoning: true,
  },
  {
    id: "Qwen/Qwen3.5-27B",
    name: "Qwen3.5 27B",
    provider: "Alibaba",
    contextWindow: 131072,
    parameterCount: "27B",
    isReasoning: true,
  },
  {
    id: "stepfun-ai/Step-3.5-Flash",
    name: "Step 3.5 Flash",
    provider: "StepFun",
    contextWindow: 131072,
    parameterCount: "—",
    isReasoning: true,
  },
  {
    id: "zai-org/GLM-5.2",
    name: "GLM 5.2",
    provider: "Zhipu AI",
    contextWindow: 131072,
    parameterCount: "72B",
    isReasoning: true,
  },
];

export function findModelScopeModel(id: string): ModelScopeModelInfo | undefined {
  if (MODEL_BLOCKLIST.includes(id)) return undefined;
  const fromCatalog = MODELSCOPE_MODEL_CATALOG.find(m => m.id === id);
  if (fromCatalog) return fromCatalog;
  // Also honor any id the live /v1/models listing reported (see
  // fetchModelScopeModelIds) — this is what lets the Dispatcher assign a model
  // that appeared on ModelScope after this file was last edited. Synthesized
  // info: the OpenAI-compatible listing carries no metadata beyond the id.
  if (liveModelIdsCache?.ids.has(id)) {
    return { id, name: id, provider: "ModelScope", contextWindow: 8192, parameterCount: "—", isReasoning: false };
  }
  return undefined;
}

// ── Live model listing ─────────────────────────────────────────────────────────
// ModelScope's OpenAI-compatible GET /v1/models needs no auth (verified live on
// both hosts). The two hosts report DIFFERENT sets — .cn lists the newest
// DeepSeek V4 models while .ai (the host that actually serves this key's calls)
// returns an incomplete older list even though V4-Pro verifiably works there —
// so the menu is the UNION of both. An id that turns out not to serve on .ai
// simply errors at call time and the provider chain falls through as usual.
//
// Cached in module scope with a TTL: the dispatch step awaits the fetch, every
// later findModelScopeModel() in the same isolate reads the warm cache. A cold
// isolate without the fetch just means an unknown-but-live id skips the
// ModelScope short-circuit — degradation, not breakage.

const LIVE_MODELS_TTL_MS = 10 * 60 * 1000;
const LIVE_MODELS_FETCH_TIMEOUT_MS = 8_000;
const LIVE_MODEL_HOSTS = [
  "https://api-inference.modelscope.ai/v1/models",
  "https://api-inference.modelscope.cn/v1/models",
];

let liveModelIdsCache: { ids: Set<string>; fetchedAt: number } | null = null;

/**
 * Fetch the live ModelScope model ids (union of both hosts), with caching.
 * Never throws: any failure falls back to the static catalog's ids, so the
 * Dispatcher always gets a usable menu.
 */
export async function fetchModelScopeModelIds(): Promise<string[]> {
  if (liveModelIdsCache && Date.now() - liveModelIdsCache.fetchedAt < LIVE_MODELS_TTL_MS) {
    return [...liveModelIdsCache.ids];
  }
  const ids = new Set<string>();
  await Promise.all(LIVE_MODEL_HOSTS.map(async (url) => {
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), LIVE_MODELS_FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(url, { signal: ctrl.signal });
      if (!res.ok) return;
      const data = await res.json() as { data?: Array<{ id?: string }> };
      for (const m of data.data ?? []) {
        if (typeof m.id === "string" && m.id && !MODEL_BLOCKLIST.includes(m.id)) ids.add(m.id);
      }
    } catch {
      // One host down is fine; both down falls through to the catalog below.
    } finally {
      clearTimeout(timeout);
    }
  }));
  if (ids.size === 0) {
    // Fall back to the catalog, with blocked models filtered out.
    return MODELSCOPE_MODEL_CATALOG.map(m => m.id).filter(id => !MODEL_BLOCKLIST.includes(id));
  }
  liveModelIdsCache = { ids, fetchedAt: Date.now() };
  return [...ids];
}

// ── Default Model Choices ──────────────────────────────────────────────────────
// DeepSeek-V4-Pro is the frontier target the rest of the chain cannot serve —
// ModelScope is the only free seat with a live upstream for it, so it is the
// Dispatcher seat. The other agents' ModelScope model is chosen by the
// Dispatcher at runtime via the assignedModel override.

export const MODELSCOPE_DISPATCHER_MODEL = "deepseek-ai/DeepSeek-V4-Pro";
export const MODELSCOPE_DEFAULT_MODEL = "Qwen/Qwen3.5-35B-A3B";

// ── OpenAI-compatible Chat API ────────────────────────────────────────────────

export interface ModelScopeChatResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
  model: string;
}

// ── Key resolution ─────────────────────────────────────────────────────────────
// MODELSCOPE_API_KEY first, then MODELSCOPE_API_KEY_2 … MODELSCOPE_API_KEY_10 —
// the same numbered-pool pattern as the Ollama leg (ollamaClient.ts), so a
// quota-exhausted or revoked primary key falls through to the next one in the
// same call instead of failing the ModelScope seat outright. All keys are set
// in the Convex dashboard.
function resolveApiKeys(): string[] {
  const keys: string[] = [];
  for (let i = 1; ; i++) {
    const name = i === 1 ? "MODELSCOPE_API_KEY" : `MODELSCOPE_API_KEY_${i}`;
    const key = (process.env[name] ?? "").trim();
    if (key) keys.push(key);
    if (i > 10) break;
  }
  return keys;
}

/**
 * Call ModelScope chat completions (non-streaming).
 * Uses the OpenAI-compatible API at POST /chat/completions on the
 * international api-inference.modelscope.ai host.
 * Key comes from the MODELSCOPE_API_KEY env var (Convex dashboard), with
 * MODELSCOPE_API_KEY_2 … _10 tried in order when a key is rate-limited,
 * quota-exhausted or revoked.
 */
export async function callModelScope(
  prompt: string,
  systemPrompt: string,
  model: string = MODELSCOPE_DEFAULT_MODEL,
  maxTokens: number = 32768,
  _runQuery?: ActionCtx["runQuery"],
  deadlineMs?: number,
): Promise<ModelScopeChatResult> {
  const apiKeys = resolveApiKeys();
  if (apiKeys.length === 0) {
    throw new Error("MODELSCOPE_NOT_CONFIGURED: set MODELSCOPE_API_KEY (and MODELSCOPE_API_KEY_2 … for fallback) in the Convex dashboard");
  }

  const messages = [
    { role: "system" as const, content: systemPrompt.slice(0, 8000) },
    { role: "user" as const, content: prompt.slice(0, 8000) },
  ];

  const body = JSON.stringify({
    model,
    messages,
    max_tokens: maxTokens,
    temperature: 0.7,
  });

  let lastError: Error | null = null;

  for (let k = 0; k < apiKeys.length; k++) {
    const apiKey = apiKeys[k];

    // Respect the caller's shared chain deadline — never run an attempt past
    // the remaining budget.
    const remaining = deadlineMs === undefined ? MODELSCOPE_ATTEMPT_TIMEOUT_MS : deadlineMs - Date.now();
    if (remaining <= 5_000) break;

    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), Math.min(MODELSCOPE_ATTEMPT_TIMEOUT_MS, remaining));

    try {
      const res = await fetch(`${BASE_URL}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body,
        signal: ctrl.signal,
      });

      const raw = await res.text();
      if (!res.ok) {
        const msg = tryParseJson(raw) as Record<string, unknown> | null;
        const errObj = msg?.error as Record<string, unknown> | undefined;
        const err = new Error(`ModelScope ${res.status} (key ${k + 1}/${apiKeys.length}): ${typeof errObj?.message === "string" ? errObj.message : raw.slice(0, 300)}`);
        lastError = err;
        clearTimeout(timeout);
        // Rate-limited, quota-exhausted (typically a 403/429) or a revoked key
        // (401) — try the next key. Any other 4xx is fatal for this call.
        if (res.status === 401 || res.status === 403 || res.status === 429 || res.status >= 500) continue;
        throw err;
      }

      const data = JSON.parse(raw);
      const msg = data.choices?.[0]?.message;
      // Reasoning models (Step-3.5-Flash, GLM-5.2…) can stream their real answer
      // on the "reasoning_content" channel when the content field comes back
      // empty — observed live on this host. Read that too, or a model that only
      // "thinks out loud" comes back as an empty, silently successful response.
      const text = msg?.content ?? "";
      const resolved = text && text.trim() ? text : (msg?.reasoning_content ?? "");
      return {
        text: resolved,
        inputTokens: data.usage?.prompt_tokens ?? 0,
        outputTokens: data.usage?.completion_tokens ?? 0,
        model: data.model ?? model,
      };
    } catch (err) {
      clearTimeout(timeout);
      if (err instanceof Error && err.name === "AbortError") {
        lastError = new Error(`ModelScope request timed out (key ${k + 1}/${apiKeys.length})`);
        continue; // timeout — try next key
      }
      // A non-ok response error was already captured above — it is the one
      // 4xx that is fatal, so re-throw it directly.
      if (err === lastError) throw err;
      lastError = err instanceof Error ? err : new Error(String(err));
      continue; // network failure — try next key
    }
  }

  // All keys exhausted (or the chain deadline left no time to try any)
  throw lastError ?? new Error("ModelScope request failed — keys exhausted or time budget spent");
}

function tryParseJson(raw: string): Record<string, unknown> | null {
  try { return JSON.parse(raw); } catch { return null; }
}
