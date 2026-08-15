// Ollama Cloud API client — the tail-end fallback in the pipeline provider chain.
// Auth: Bearer token via ollamaKeys DB table or OLLAMA_API_KEY env var.
// Docs: https://docs.ollama.com/api/chat
//
// The exported names (callSiliconFlow, DISPATCHER_MODEL, DEFAULT_CHAT_MODEL,
// calcAgentBucksForModel) intentionally keep their historical "SiliconFlow"
// spelling from an earlier provider iteration; renaming them would ripple
// through every caller. The file itself is called what it does — Ollama.

import { internal } from "../_generated/api";
import type { ActionCtx } from "../_generated/server";

// ── Base URL & Auth ───────────────────────────────────────────────────────────
const BASE_URL = "https://ollama.com";

// Retry ceiling per call — see the comment at its use site in callSiliconFlow.
const MAX_KEY_ATTEMPTS = 3;
// Per-attempt abort — sized so the whole Modal → NIM → Ollama chain fits well
// inside Convex's 10-minute action kill (see nimClient.ts for the full story).
const OLLAMA_ATTEMPT_TIMEOUT_MS = 120_000;

// Key resolution: DB table ollamaKeys first, then OLLAMA_API_KEY env fallback
function stripQuotes(s: string): string {
  s = s.trim();
  while ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    s = s.slice(1, -1).trim();
  }
  return s;
}

async function resolveAllApiKeys(runQuery?: ActionCtx["runQuery"]): Promise<string[]> {
  const keys: string[] = [];
  // First: try DB table
  if (runQuery) {
    try {
      const dbKeys = await runQuery(internal.admin.getOllamaKeysInternal, {});
      if (Array.isArray(dbKeys)) {
        for (const k of dbKeys) {
          if (typeof k === "string" && k.trim()) keys.push(stripQuotes(k));
        }
      }
    } catch { /* table might not exist yet — env fallback below */ }
  }
  // Fallback: env vars
  for (let i = 1; ; i++) {
    const name = i === 1 ? "OLLAMA_API_KEY" : `OLLAMA_API_KEY_${i}`;
    const key = (process.env[name] ?? "").trim();
    if (key) keys.push(key);
    if (i > 10) break;
  }
  return keys;
}

async function requireAllKeys(runQuery?: ActionCtx["runQuery"]): Promise<string[]> {
  const keys = await resolveAllApiKeys(runQuery);
  if (keys.length === 0) {
    throw new Error("OLLAMA_API_KEY not configured — add keys via /admin or set in the Convex dashboard.");
  }
  return keys;
}

// ── Model Catalog ─────────────────────────────────────────────────────────────
// Only models verified working on the Ollama Cloud free plan (no CC required).
// Usage is measured by GPU time — light usage is included on the free plan.
// 1 concurrent model on free.

export interface ModelInfo {
  id: string;                    // Ollama model name
  name: string;                  // Human-readable name
  provider: string;              // Provider/organization
  capabilities: ModelCapability[];
  contextWindow: number;         // Max context length in tokens (approx)
  isReasoning: boolean;          // Has thinking chain-of-thought support
  isMoE: boolean;                // Mixture of Experts architecture
  parameterCount: string;        // e.g. "120B", "31B", "20B"
  activeParams?: string;         // Activated parameters for MoE models (e.g. "13B")
  usageLevel?: number;           // 1-4, how much GPU time this model uses
}

export type ModelCapability = "chat" | "code" | "reasoning" | "agent" | "vision" | "tool_use" | "multilingual";

export const MODEL_CATALOG: ModelInfo[] = [
  // ── Frontier Models (Free Plan) ─────────────────────────────────────────
  {
    id: "gpt-oss:120b",
    name: "GPT-OSS 120B",
    provider: "OpenAI",
    capabilities: ["chat","code","reasoning","agent","tool_use","multilingual"],
    contextWindow: 131072,
    isReasoning: true,
    isMoE: true,
    parameterCount: "120B",
    usageLevel: 3,
  },
  {
    id: "gpt-oss:20b",
    name: "GPT-OSS 20B",
    provider: "OpenAI",
    capabilities: ["chat","code","reasoning","agent","tool_use","multilingual"],
    contextWindow: 131072,
    isReasoning: true,
    isMoE: true,
    parameterCount: "20B",
    usageLevel: 2,
  },
  {
    id: "gemma4:31b",
    name: "Gemma 4 31B",
    provider: "Google DeepMind",
    capabilities: ["chat","code","reasoning","agent","tool_use","multilingual"],
    contextWindow: 262144,
    isReasoning: false,
    isMoE: false,
    parameterCount: "31B",
    usageLevel: 2,
  },
  {
    id: "minimax-m3",
    name: "MiniMax M3",
    provider: "MiniMax AI",
    capabilities: ["chat","code","reasoning","agent","vision","tool_use","multilingual"],
    contextWindow: 1000000,
    isReasoning: true,
    isMoE: true,
    parameterCount: "—",
    usageLevel: 3,
  },
  {
    id: "minimax-m2.5",
    name: "MiniMax M2.5",
    provider: "MiniMax AI",
    capabilities: ["chat","code","reasoning","agent","tool_use","multilingual"],
    contextWindow: 204800,
    isReasoning: true,
    isMoE: true,
    parameterCount: "229B",
    usageLevel: 2,
  },
  {
    id: "nemotron-3-nano:30b",
    name: "Nemotron 3 Nano 30B",
    provider: "NVIDIA",
    capabilities: ["chat","code","reasoning","agent","tool_use","multilingual"],
    contextWindow: 131072,
    isReasoning: true,
    isMoE: false,
    parameterCount: "30B",
    usageLevel: 2,
  },
];

// Fast lookup helpers
export function findModel(id: string): ModelInfo | undefined {
  return MODEL_CATALOG.find(m => m.id === id);
}

// ── Default Model Choices ─────────────────────────────────────────────────────
// All models from the verified free-plan catalog above.

// The Dispatcher model — fast and smart for routing decisions
export const DISPATCHER_MODEL = "gemma4:31b";

// Default chat model — good general-purpose
export const DEFAULT_CHAT_MODEL = "gemma4:31b";

// Default code model — best for coding tasks
export const DEFAULT_CODE_MODEL = "minimax-m3";

// Default models for chat mode (fallback chain: high capability → low)
export const CHAT_FALLBACK_CHAIN = [
  "gpt-oss:120b",       // Strong all-rounder
  "gemma4:31b",         // Fast & solid
  "gpt-oss:20b",        // Lightweight
];

// Default models for code mode (fallback chain)
export const CODE_FALLBACK_CHAIN = [
  "minimax-m3",         // Best coding + agentic
  "gpt-oss:120b",       // Strong secondary
  "gemma4:31b",         // General fallback
];

// Default models for reasoning (fallback chain)
export const REASONING_FALLBACK_CHAIN = [
  "minimax-m3",         // Best reasoning on free plan
  "gpt-oss:120b",       // Strong reasoning
  "gpt-oss:20b",        // Compact reasoning
];

// No dedicated image/video generation models on Ollama Cloud free plan.
// Multimodal models (minimax-m3) can *understand* images but not generate them.

// ── Ollama Chat API ───────────────────────────────────────────────────────────
// POST https://ollama.com/api/chat
// Uses Ollama's native format, NOT OpenAI-compatible.

interface OllamaChatResponse {
  model: string;
  created_at: string;
  message: {
    role: string;
    content: string;
    thinking?: string;
  };
  done: boolean;
  done_reason?: string;
  total_duration?: number;
  prompt_eval_count?: number;
  eval_count?: number;
}

export interface ChatResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
  model: string;
}

/**
 * Call Ollama Cloud chat completions (non-streaming).
 * Uses the native Ollama API at POST /api/chat.
 * runQuery is optional — pass ctx.runQuery to read keys from DB.
 */
export async function callSiliconFlow(
  prompt: string,
  systemPrompt: string,
  model: string = DEFAULT_CHAT_MODEL,
  maxTokens: number = 32768,
  history?: Array<{ role: "user" | "assistant"; content: string }>,
  runQuery?: ActionCtx["runQuery"],
  deadlineMs?: number,
): Promise<ChatResult> {
  const apiKeys = await requireAllKeys(runQuery);

  const messages = [
    { role: "system" as const, content: systemPrompt.slice(0, 8000) },
    ...(history && history.length > 0
      ? [
          ...history.map(m => ({ role: m.role, content: m.content.slice(0, 8000) })),
          { role: "user" as const, content: prompt.slice(0, 8000) },
        ]
      : [{ role: "user" as const, content: prompt.slice(0, 8000) }]),
  ];

  const body = JSON.stringify({
    model,
    messages,
    stream: false,
    options: {
      temperature: 0.7,
      num_predict: maxTokens,
    },
  });

  let lastError: Error | null = null;

  // Cap how many keys one call retries — see the matching comment in
  // nimClient.ts's callNimAttempt for why unbounded retry count is a risk.
  const attempts = Math.min(apiKeys.length, MAX_KEY_ATTEMPTS);
  for (let k = 0; k < attempts; k++) {
    const apiKey = apiKeys[k];

    // Respect the caller's shared chain deadline — skip attempts there's no
    // time left for, never run one past the remaining budget.
    const remaining = deadlineMs === undefined ? OLLAMA_ATTEMPT_TIMEOUT_MS : deadlineMs - Date.now();
    if (remaining <= 5_000) break;

    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), Math.min(OLLAMA_ATTEMPT_TIMEOUT_MS, remaining));
    try {
      const res = await fetch(`${BASE_URL}/api/chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKey}`,
        },
        body,
        signal: ctrl.signal,
      });

      const raw = await res.text();
      if (!res.ok) {
        const msg = JSON.parse(raw);
        const err = new Error(`Ollama Cloud ${res.status} (key ${k + 1}/${attempts}): ${msg.error ?? raw.slice(0, 300)}`);
        lastError = err;
        clearTimeout(timeout);
        // Rate limited / quota exceeded — try next key
        if (res.status === 429 || res.status >= 500) continue;
        throw err; // 4xx other than rate-limit is fatal for this key
      }

      const data: OllamaChatResponse = JSON.parse(raw);
      const text = data.message?.content ?? "";
      return {
        text,
        inputTokens: data.prompt_eval_count ?? 0,
        outputTokens: data.eval_count ?? 0,
        model: data.model ?? model,
      };
    } catch (err) {
      clearTimeout(timeout);
      if (err instanceof Error && err.name === "AbortError") {
        lastError = new Error(`Ollama Cloud request timed out (key ${k + 1}/${attempts})`);
        continue; // timeout — try next key
      }
      if (err === lastError) { /* already captured the non-ok response error above */ }
      else { lastError = err instanceof Error ? err : new Error(String(err)); continue; }
      throw err;
    }
  }

  // All keys exhausted (or the shared chain deadline left no time to try any)
  throw lastError ?? new Error("Ollama Cloud request failed — keys exhausted or time budget spent");
}

/**
 * Call Ollama Cloud with simulated streaming — fetch full response, then
 * deliver to onDelta in chunks (300 chars every 80ms) for UI streaming.
 */
export async function callSiliconFlowStreaming(
  prompt: string,
  systemPrompt: string,
  model: string,
  onDelta: (text: string) => Promise<void>,
  maxTokens: number = 32768,
  history?: Array<{ role: "user" | "assistant"; content: string }>,
  runQuery?: ActionCtx["runQuery"],
): Promise<ChatResult> {
  const result = await callSiliconFlow(prompt, systemPrompt, model, maxTokens, history, runQuery);

  // Drip-feed to simulate streaming
  const chunkSize = 300;
  let sent = 0;
  while (sent < result.text.length) {
    sent = Math.min(sent + chunkSize, result.text.length);
    await onDelta(result.text.slice(0, sent));
    if (sent < result.text.length) {
      await new Promise(r => setTimeout(r, 80));
    }
  }

  return result;
}

// ── Agent Buck support (kept for backward compat) ─────────────────────────────

export function calcAgentBucksForModel(
  modelId: string,
  inputTokens: number,
  outputTokens: number,
): number {
  const model = findModel(modelId);
  if (!model) return 0;

  // Rough pricing tiers based on model type
  const sizeFactor = model.isMoE
    ? (model.activeParams ? parseInt(model.activeParams) / 10 : 5)
    : parseInt(model.parameterCount.replace(/[^0-9]/g, "")) / 10;

  const inputCostPerM = model.isReasoning ? sizeFactor * 0.5 : Math.max(0.5, sizeFactor * 0.15);
  const outputCostPerM = model.isReasoning ? sizeFactor * 2.0 : Math.max(2.0, sizeFactor * 0.5);

  const inputAB = (inputTokens / 1_000_000) * inputCostPerM * 1_500_000;
  const outputAB = (outputTokens / 1_000_000) * outputCostPerM * 1_500_000;
  return Math.ceil(inputAB + outputAB);
}
