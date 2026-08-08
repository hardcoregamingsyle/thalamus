// ModelScope API client — Alibaba's official free API-Inference tier.
// Runs on the INTERNATIONAL host api-inference.modelscope.ai (the domestic
// api-inference.modelscope.cn host rejects tokens minted on the .ai site —
// tokens are site-scoped). OpenAI-compatible at /v1. Auth is the user's
// "ms-…" access token from modelscope.ai/my/myaccesstoken, set in the Convex
// dashboard as MODELSCOPE_API_KEY. Free quota: ~2000 requests/day total,
// ~200 per model, resetting midnight UTC+8 — see /docs/model-service/API-
// Inference/limits.
//
// Model caveat: only the models in MODELSCOPE_MODEL_CATALOG below were
// verified live (2026-08-07) to return tokens from this key. Qwen3.8-Max
// (Qwen-Ambassador/Qwen3.8-Max) exists in the catalog but 403s — it needs a
// per-model access application on ModelScope. DeepSeek-V4-Pro is the frontier
// target that every other seat in the chain fails on — it works here.

import type { ActionCtx } from "../_generated/server";

// ── Base URL ───────────────────────────────────────────────────────────────────
const BASE_URL = "https://api-inference.modelscope.ai/v1";

// Per-attempt abort — sized so the whole Modal → Zen → DeadlySignal → ModelScope
// → OVHcloud → Ollama chain fits inside Convex's 10-minute action kill.
const MODELSCOPE_ATTEMPT_TIMEOUT_MS = 60_000;

// ── Model Catalog ─────────────────────────────────────────────────────────────
// Only models verified live against the .ai host on 2026-08-07.

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
        if (typeof m.id === "string" && m.id) ids.add(m.id);
      }
    } catch {
      // One host down is fine; both down falls through to the catalog below.
    } finally {
      clearTimeout(timeout);
    }
  }));
  if (ids.size === 0) {
    return MODELSCOPE_MODEL_CATALOG.map(m => m.id);
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

/**
 * Call ModelScope chat completions (non-streaming).
 * Uses the OpenAI-compatible API at POST /chat/completions on the
 * international api-inference.modelscope.ai host.
 * Key comes from the MODELSCOPE_API_KEY env var (Convex dashboard).
 */
export async function callModelScope(
  prompt: string,
  systemPrompt: string,
  model: string = MODELSCOPE_DEFAULT_MODEL,
  maxTokens: number = 8192,
  _runQuery?: ActionCtx["runQuery"],
  deadlineMs?: number,
): Promise<ModelScopeChatResult> {
  const apiKey = (process.env.MODELSCOPE_API_KEY ?? "").trim();
  if (!apiKey) {
    throw new Error("MODELSCOPE_NOT_CONFIGURED: set MODELSCOPE_API_KEY in the Convex dashboard");
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

  const remaining = deadlineMs === undefined ? MODELSCOPE_ATTEMPT_TIMEOUT_MS : deadlineMs - Date.now();
  if (remaining <= 5_000) {
    throw new Error("ModelScope: no time left in chain budget");
  }

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
      throw new Error(`ModelScope ${res.status}: ${typeof errObj?.message === "string" ? errObj.message : raw.slice(0, 300)}`);
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
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error(`ModelScope request timed out`);
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

function tryParseJson(raw: string): Record<string, unknown> | null {
  try { return JSON.parse(raw); } catch { return null; }
}
