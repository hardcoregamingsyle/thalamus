// DeadlySignal API client — New API gateway fallback for Thalamus.
// Runs a Chinese "New API" (one-api) gateway at myapi.creitingameplays.com:
// https://myapi.creitingameplays.com/v1 (OpenAI-compatible). Auth is a token
// key set in the Convex dashboard as DEADLYSIGNALS_API_KEY — system name
// "DeadlySignal API"; the site is creitingameplays.com, status at
// status.creitingameplays.com, Discord https://discord.gg/97TtUaMnHs.
//
// Model caveat: the gateway *advertises* every frontier model (kimi-k3,
// deepseek-v4-pro, qwen3.8-max, glm 5.2…) but most have no live upstream and
// 500 with "RetryProviderError"/"PaymentRequiredError" (broken Notion/.har or
// proof-of-work relays), or 524 (Cloudflare timeout) on a slow upstream. Only
// the models in DEADLYSIGNALS_MODEL_CATALOG below are verified to return
// tokens; keep it that way — the Dispatcher picks from it, so a dead model
// here means routing the whole run to a 500.

import type { ActionCtx } from "./_generated/server";

// ── Base URL ───────────────────────────────────────────────────────────────────
const BASE_URL = "https://myapi.creitingameplays.com/v1";

// Per-attempt abort — sized so the whole Modal → Zen → DeadlySignal → ModelScope
// → OVHcloud → Ollama chain fits inside Convex's 10-minute action kill.
const DEADLYSIGNALS_ATTEMPT_TIMEOUT_MS = 60_000;

// ── Model Catalog ─────────────────────────────────────────────────────────────
// Only models verified live against the gateway on 2026-08-07.

export interface DeadlySignalsModelInfo {
  id: string;
  name: string;
  provider: string;
  contextWindow: number;
  parameterCount: string;
  isReasoning: boolean;
}

export const DEADLYSIGNALS_MODEL_CATALOG: DeadlySignalsModelInfo[] = [
  {
    id: "deepseek-v4-flash",
    name: "DeepSeek V4 Flash",
    provider: "DeepSeek",
    contextWindow: 131072,
    parameterCount: "285B",
    isReasoning: true,
  },
  {
    id: "kimi-k2.5",
    name: "Kimi K2.5",
    provider: "Moonshot AI",
    contextWindow: 131072,
    parameterCount: "256B",
    isReasoning: true,
  },
  {
    id: "gpt-5",
    name: "GPT-5",
    provider: "OpenAI",
    contextWindow: 131072,
    parameterCount: "—",
    isReasoning: true,
  },
  {
    id: "gpt-5.4",
    name: "GPT-5.4",
    provider: "OpenAI",
    contextWindow: 131072,
    parameterCount: "—",
    isReasoning: true,
  },
  {
    id: "gpt-4o",
    name: "GPT-4o",
    provider: "OpenAI",
    contextWindow: 131072,
    parameterCount: "—",
    isReasoning: false,
  },
  {
    id: "z-ai/glm-5.2",
    name: "GLM 5.2",
    provider: "Zhipu AI",
    contextWindow: 131072,
    parameterCount: "72B",
    isReasoning: true,
  },
  {
    id: "gemini-2.5-flash",
    name: "Gemini 2.5 Flash",
    provider: "Google",
    contextWindow: 131072,
    parameterCount: "—",
    isReasoning: false,
  },
];

export function findDeadlySignalsModel(id: string): DeadlySignalsModelInfo | undefined {
  return DEADLYSIGNALS_MODEL_CATALOG.find(m => m.id === id);
}

// ── Default Model Choices ──────────────────────────────────────────────────────
// The Dispatcher seat is the ONLY hardcoded model — every other agent's model
// is chosen by the Dispatcher at runtime via the assignedModel override.

export const DEADLYSIGNALS_DISPATCHER_MODEL = "deepseek-v4-flash";
export const DEADLYSIGNALS_DEFAULT_MODEL = "deepseek-v4-flash";

// ── OpenAI-compatible Chat API ────────────────────────────────────────────────

export interface DeadlySignalsChatResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
  model: string;
}

/**
 * Call DeadlySignal chat completions (non-streaming).
 * Uses the OpenAI-compatible API at POST /chat/completions.
 * Key comes from the DEADLYSIGNALS_API_KEY env var (Convex dashboard).
 */
export async function callDeadlySignals(
  prompt: string,
  systemPrompt: string,
  model: string = DEADLYSIGNALS_DEFAULT_MODEL,
  maxTokens: number = 8192,
  _runQuery?: ActionCtx["runQuery"],
  deadlineMs?: number,
): Promise<DeadlySignalsChatResult> {
  const apiKey = (process.env.DEADLYSIGNALS_API_KEY ?? "").trim();
  if (!apiKey) {
    throw new Error("DEADLYSIGNALS_NOT_CONFIGURED: set DEADLYSIGNALS_API_KEY in the Convex dashboard");
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

  const remaining = deadlineMs === undefined ? DEADLYSIGNALS_ATTEMPT_TIMEOUT_MS : deadlineMs - Date.now();
  if (remaining <= 5_000) {
    throw new Error("DeadlySignal: no time left in chain budget");
  }

  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), Math.min(DEADLYSIGNALS_ATTEMPT_TIMEOUT_MS, remaining));

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
      throw new Error(`DeadlySignal ${res.status}: ${typeof errObj?.message === "string" ? errObj.message : raw.slice(0, 300)}`);
    }

    const data = JSON.parse(raw);
    const msg = data.choices?.[0]?.message;
    // Reasoning-flagged models (deepseek-v4-flash, kimi-k2.5…) can stream their
    // real answer on the "reasoning" channel when the content field comes back
    // empty (observed on the Felo/Notion relay paths). Read that too, or a
    // model that only "thinks out loud" comes back as an empty, silently
    // successful response with nothing wrong to catch.
    const text = msg?.content ?? "";
    const resolved = text && text.trim() ? text : (msg?.reasoning ?? "");
    return {
      text: resolved,
      inputTokens: data.usage?.prompt_tokens ?? 0,
      outputTokens: data.usage?.completion_tokens ?? 0,
      model: data.model ?? model,
    };
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error(`DeadlySignal request timed out`);
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

function tryParseJson(raw: string): Record<string, unknown> | null {
  try { return JSON.parse(raw); } catch { return null; }
}