// OpenCode Zen client — free anonymous AI provider for Thalamus.
// Runs at https://opencode.ai/zen/v1 (OpenAI-compatible), no API key, no signup.
// Free models verified live (all respond 200 without auth):
//   deepseek-v4-flash-free, nemotron-3-ultra-free, north-mini-code-free,
//   mimo-v2.5-free, laguna-s-2.1-free, longcat-2.0-free, big-pickle
// (ling-3.0-flash-free is listed but returns HTTP 400 — excluded.)
// Docs: https://opencode.ai/zen

import type { ActionCtx } from "./_generated/server";

// ── Base URL ───────────────────────────────────────────────────────────────────
const BASE_URL = "https://opencode.ai/zen/v1";

// Per-attempt abort — sized so the whole Modal → NIM → Zen → OVHcloud → Ollama
// chain fits inside Convex's 10-minute action kill.
const ZEN_ATTEMPT_TIMEOUT_MS = 60_000;

// ── Model Catalog ─────────────────────────────────────────────────────────────
// Only models verified working anonymously (no key) on OpenCode Zen.

export interface ZenModelInfo {
  id: string;
  name: string;
  provider: string;
  contextWindow: number;
  parameterCount: string;
  isReasoning: boolean;
}

export const ZEN_MODEL_CATALOG: ZenModelInfo[] = [
  {
    id: "deepseek-v4-flash-free",
    name: "DeepSeek V4 Flash (free)",
    provider: "DeepSeek",
    contextWindow: 128000,
    parameterCount: "—",
    isReasoning: true,
  },
  {
    id: "nemotron-3-ultra-free",
    name: "Nemotron 3 Ultra (free)",
    provider: "NVIDIA",
    contextWindow: 131072,
    parameterCount: "—",
    isReasoning: true,
  },
  {
    id: "north-mini-code-free",
    name: "North Mini Code (free)",
    provider: "OpenAI",
    contextWindow: 128000,
    parameterCount: "—",
    isReasoning: true,
  },
  {
    id: "mimo-v2.5-free",
    name: "MiMo V2.5 (free)",
    provider: "Xiaomi",
    contextWindow: 128000,
    parameterCount: "—",
    isReasoning: true,
  },
  {
    id: "laguna-s-2.1-free",
    name: "Laguna S 2.1 (free)",
    provider: "Inclusion AI",
    contextWindow: 128000,
    parameterCount: "—",
    isReasoning: false,
  },
  {
    id: "longcat-2.0-free",
    name: "LongCat 2.0 (free)",
    provider: "Meituan",
    contextWindow: 128000,
    parameterCount: "—",
    isReasoning: true,
  },
  {
    id: "big-pickle",
    name: "Big Pickle (free)",
    provider: "OpenAI",
    contextWindow: 128000,
    parameterCount: "—",
    isReasoning: true,
  },
];

export function findZenModel(id: string): ZenModelInfo | undefined {
  return ZEN_MODEL_CATALOG.find(m => m.id === id);
}

// ── Default Model Choices ─────────────────────────────────────────────────────
// The Dispatcher seat is the ONLY hardcoded model — every other agent's model
// is chosen by the Dispatcher at runtime via the assignedModel override.

export const ZEN_DISPATCHER_MODEL = "deepseek-v4-flash-free";
export const ZEN_DEFAULT_MODEL = "deepseek-v4-flash-free";

// ── OpenAI-compatible Chat API ────────────────────────────────────────────────

export interface ZenChatResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
  model: string;
}

/**
 * Call OpenCode Zen chat completions (non-streaming).
 * Uses the OpenAI-compatible API at POST /chat/completions.
 * No API key needed — anonymous free tier.
 */
export async function callZen(
  prompt: string,
  systemPrompt: string,
  model: string = ZEN_DEFAULT_MODEL,
  maxTokens: number = 8192,
  _runQuery?: ActionCtx["runQuery"],
  deadlineMs?: number,
): Promise<ZenChatResult> {
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

  const remaining = deadlineMs === undefined ? ZEN_ATTEMPT_TIMEOUT_MS : deadlineMs - Date.now();
  if (remaining <= 5_000) {
    throw new Error("Zen: no time left in chain budget");
  }

  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), Math.min(ZEN_ATTEMPT_TIMEOUT_MS, remaining));

  try {
    const res = await fetch(`${BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body,
      signal: ctrl.signal,
    });

    const raw = await res.text();
    if (!res.ok) {
      const msg = tryParseJson(raw) as Record<string, unknown> | null;
      const errObj = msg?.error as Record<string, unknown> | undefined;
      throw new Error(`Zen ${res.status}: ${typeof errObj?.message === "string" ? errObj.message : raw.slice(0, 300)}`);
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
      throw new Error(`Zen request timed out`);
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

function tryParseJson(raw: string): Record<string, unknown> | null {
  try { return JSON.parse(raw); } catch { return null; }
}
