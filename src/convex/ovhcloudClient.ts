// OVHcloud AI Endpoints client — secondary fallback for Thalamus.
// NIM is primary; OVHcloud catches requests when NIM is down, before Ollama.
// Anonymous tier: no API key needed, 2 RPM per IP.
// Authenticated tier: 400 RPM with OVHcloud API token.
// API format: OpenAI-compatible POST /v1/chat/completions.
// Docs: https://www.ovhcloud.com/en/public-cloud/ai-endpoints/

import type { ActionCtx } from "./_generated/server";

// ── Base URL ───────────────────────────────────────────────────────────────────
const BASE_URL = "https://oai.endpoints.kepler.ai.cloud.ovh.net/v1";

// Per-attempt abort — sized so the whole Modal → NIM → OVHcloud → Ollama chain
// fits inside Convex's 10-minute action kill.
const OVHCLOUD_ATTEMPT_TIMEOUT_MS = 60_000;

// ── Model Catalog ─────────────────────────────────────────────────────────────
// Models verified working on OVHcloud AI Endpoints free tier.
// No API key required for anonymous tier (2 RPM).

export interface OvhModelInfo {
  id: string;
  name: string;
  provider: string;
  contextWindow: number;
  parameterCount: string;
}

export const OVHCLOUD_MODEL_CATALOG: OvhModelInfo[] = [
  {
    id: "gpt-oss-120b",
    name: "GPT-OSS 120B",
    provider: "Open Source",
    contextWindow: 131072,
    parameterCount: "120B",
  },
  {
    id: "Qwen3-Coder-30B-A3B-Instruct",
    name: "Qwen3 Coder 30B",
    provider: "Alibaba",
    contextWindow: 262144,
    parameterCount: "30B",
  },
  {
    id: "Meta-Llama-3_3-70B-Instruct",
    name: "Llama 3.3 70B",
    provider: "Meta",
    contextWindow: 131072,
    parameterCount: "70B",
  },
  {
    id: "Qwen3.5-397B-A17B",
    name: "Qwen3.5 397B",
    provider: "Alibaba",
    contextWindow: 131072,
    parameterCount: "397B",
  },
  {
    id: "Mistral-Nemo-Instruct-2407",
    name: "Mistral Nemo",
    provider: "Mistral AI",
    contextWindow: 128000,
    parameterCount: "12B",
  },
];

// ── Default Model Choices ─────────────────────────────────────────────────────

export const OVHCLOUD_DEFAULT_MODEL = "gpt-oss-120b";
export const OVHCLOUD_CODE_MODEL = "Qwen3-Coder-30B-A3B-Instruct";

// ── Map task types to OVHcloud models ─────────────────────────────────────────

export function mapTaskToOvhModel(taskType: string): string {
  switch (taskType) {
    case "code": return OVHCLOUD_CODE_MODEL;
    case "reasoning": return "gpt-oss-120b";
    case "dispatcher": return "Meta-Llama-3_3-70B-Instruct";
    default: return OVHCLOUD_DEFAULT_MODEL;
  }
}

// ── OpenAI-compatible Chat API ────────────────────────────────────────────────

export interface OvhChatResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
  model: string;
}

/**
 * Call OVHcloud AI Endpoints chat completions (non-streaming).
 * Uses the OpenAI-compatible API at POST /v1/chat/completions.
 * No API key needed for anonymous tier.
 */
export async function callOvhcloud(
  prompt: string,
  systemPrompt: string,
  model: string = OVHCLOUD_DEFAULT_MODEL,
  maxTokens: number = 8192,
  _runQuery?: ActionCtx["runQuery"],
  deadlineMs?: number,
): Promise<OvhChatResult> {
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

  const remaining = deadlineMs === undefined ? OVHCLOUD_ATTEMPT_TIMEOUT_MS : deadlineMs - Date.now();
  if (remaining <= 5_000) {
    throw new Error("OVHcloud: no time left in chain budget");
  }

  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), Math.min(OVHCLOUD_ATTEMPT_TIMEOUT_MS, remaining));

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
      throw new Error(`OVHcloud ${res.status}: ${typeof errObj?.message === "string" ? errObj.message : raw.slice(0, 300)}`);
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
      throw new Error(`OVHcloud request timed out`);
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

function tryParseJson(raw: string): Record<string, unknown> | null {
  try { return JSON.parse(raw); } catch { return null; }
}
