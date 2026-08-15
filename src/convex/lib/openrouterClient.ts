// OpenRouter API client — keyed free-model gateway in the pipeline chain,
// inserted between OpenCode Zen and DeadlySignal.
// Runs at https://openrouter.ai/api/v1 (OpenAI-compatible). Auth is a key set
// in the Convex dashboard as OPENROUTER_API_KEY (sk-or-v1-…; free models need a
// key even though they cost $0 — a $0-balance account is fine).
//
// Free-model caveat: the `:free` roster rotates constantly (DeepSeek, Gemini
// and Mistral free variants were pulled during 2026). The defaults below use
// OpenRouter's own `openrouter/free` auto-router, which picks a free model that
// fits the request and keeps working as individual models rotate out. The
// catalog only feeds the Dispatcher short-circuit (findOpenRouterModel) — an id
// that has since gone paid simply stops short-circuiting and the chain falls
// through as usual.
// Free-tier limits: 20 requests/minute per free model; $0-balance accounts get
// 50 requests/day on free models — burst traffic lands on the next chain leg.
// Docs: https://openrouter.ai/docs

import type { ActionCtx } from "../_generated/server";

// ── Base URL ───────────────────────────────────────────────────────────────────
const BASE_URL = "https://openrouter.ai/api/v1";

// Per-attempt abort — sized so the whole Modal → Zen → OpenRouter → DeadlySignal
// → ModelScope → Ollama chain fits inside Convex's 10-minute action kill.
const OPENROUTER_ATTEMPT_TIMEOUT_MS = 60_000;

// ── Model Catalog ─────────────────────────────────────────────────────────────
// Verified free ($0 prompt AND completion) on OpenRouter, snapshot Aug 2026.
// Treat every id here as perishable — the roster is documented to rotate.

export interface OpenRouterModelInfo {
  id: string;
  name: string;
  provider: string;
  contextWindow: number;
  parameterCount: string;
  isReasoning: boolean;
}

export const OPENROUTER_MODEL_CATALOG: OpenRouterModelInfo[] = [
  {
    id: "openrouter/free",
    name: "Auto-router (free)",
    provider: "OpenRouter",
    contextWindow: 128000,
    parameterCount: "—",
    isReasoning: false,
  },
  {
    id: "qwen/qwen3-coder:free",
    name: "Qwen3 Coder (free)",
    provider: "Alibaba",
    contextWindow: 131072,
    parameterCount: "—",
    isReasoning: true,
  },
  {
    id: "openai/gpt-oss-120b:free",
    name: "GPT-OSS 120B (free)",
    provider: "OpenAI",
    contextWindow: 131072,
    parameterCount: "120B",
    isReasoning: false,
  },
  {
    id: "meta-llama/llama-3.3-70b-instruct:free",
    name: "Llama 3.3 70B (free)",
    provider: "Meta",
    contextWindow: 131072,
    parameterCount: "70B",
    isReasoning: false,
  },
  {
    id: "nvidia/nemotron-3-ultra-550b-a55b:free",
    name: "Nemotron 3 Ultra (free)",
    provider: "NVIDIA",
    contextWindow: 131072,
    parameterCount: "550B",
    isReasoning: true,
  },
];

export function findOpenRouterModel(id: string): OpenRouterModelInfo | undefined {
  return OPENROUTER_MODEL_CATALOG.find(m => m.id === id);
}

// ── Default Model Choices ─────────────────────────────────────────────────────
// The Dispatcher seat is the ONLY hardcoded model — every other agent's model
// is chosen by the Dispatcher at runtime via the assignedModel override.
// `openrouter/free` is the auto-router: OpenRouter picks a live free model that
// fits the request, so a `:free` id going paid cannot take the leg down.

export const OPENROUTER_DISPATCHER_MODEL = "openrouter/free";
export const OPENROUTER_DEFAULT_MODEL = "openrouter/free";

// ── OpenAI-compatible Chat API ────────────────────────────────────────────────

export interface OpenRouterChatResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
  model: string;
}

/**
 * Call OpenRouter chat completions (non-streaming).
 * Uses the OpenAI-compatible API at POST /chat/completions.
 * Key comes from the OPENROUTER_API_KEY env var (Convex dashboard).
 */
export async function callOpenRouter(
  prompt: string,
  systemPrompt: string,
  model: string = OPENROUTER_DEFAULT_MODEL,
  maxTokens: number = 32768,
  _runQuery?: ActionCtx["runQuery"],
  deadlineMs?: number,
): Promise<OpenRouterChatResult> {
  const apiKey = (process.env.OPENROUTER_API_KEY ?? "").trim();
  if (!apiKey) {
    throw new Error("OPENROUTER_NOT_CONFIGURED: set OPENROUTER_API_KEY in the Convex dashboard");
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

  const remaining = deadlineMs === undefined ? OPENROUTER_ATTEMPT_TIMEOUT_MS : deadlineMs - Date.now();
  if (remaining <= 5_000) {
    throw new Error("OpenRouter: no time left in chain budget");
  }

  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), Math.min(OPENROUTER_ATTEMPT_TIMEOUT_MS, remaining));

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
      throw new Error(`OpenRouter ${res.status}: ${typeof errObj?.message === "string" ? errObj.message : raw.slice(0, 300)}`);
    }

    const data = JSON.parse(raw);
    const text = data.choices?.[0]?.message?.content ?? "";
    return {
      text,
      inputTokens: data.usage?.prompt_tokens ?? 0,
      outputTokens: data.usage?.completion_tokens ?? 0,
      model: data.model ?? model,
    };
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error(`OpenRouter request timed out`);
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

function tryParseJson(raw: string): Record<string, unknown> | null {
  try { return JSON.parse(raw); } catch { return null; }
}
