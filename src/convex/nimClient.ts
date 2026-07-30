// NVIDIA NIM API client — primary AI provider for Thalamus.
// Uses NVIDIA's hosted LLM APIs at integrate.api.nvidia.com.
// Auth: Bearer token via NVAPI-KEY header, keys stored in DB (nimKeys table).
// API format: OpenAI-compatible POST /v1/chat/completions.
// Docs: https://docs.api.nvidia.com/nim/reference/llm-apis

import { internal } from "./_generated/api";
import type { ActionCtx } from "./_generated/server";

// ── Base URL ───────────────────────────────────────────────────────────────────
const BASE_URL = "https://integrate.api.nvidia.com/v1";

// ── Free-available models on NVIDIA NIM (no CC required on free tier) ────────
// Many models are free to call on the NVIDIA API catalog at limited rate.
// We include the best general-purpose + coding + reasoning models.
// Model IDs use the vendor/model-name format as listed in the NIM docs.

export interface NimModelInfo {
  id: string;                    // NVIDIA NIM model ID: "vendor/name"
  name: string;                  // Human-readable name
  provider: string;              // Original provider
  capabilities: ModelCapability[];
  contextWindow: number;
  isReasoning: boolean;
  isMoE: boolean;
  parameterCount: string;
  activeParams?: string;
  usageLevel?: number;           // 1-4, how resource-heavy
  isFree: boolean;               // Available on free tier
}

export type ModelCapability = "chat" | "code" | "reasoning" | "agent" | "vision" | "tool_use" | "multilingual";

export const NIM_MODEL_CATALOG: NimModelInfo[] = [
  {
    id: "nvidia/nemotron-3-super-120b-a12b",
    name: "Nemotron 3 Super 120B",
    provider: "NVIDIA",
    capabilities: ["chat","code","reasoning","agent","tool_use","multilingual"],
    contextWindow: 131072,
    isReasoning: true,
    isMoE: true,
    parameterCount: "120B",
    activeParams: "12B",
    usageLevel: 3,
    isFree: true,
  },
  {
    id: "nvidia/nemotron-3-nano-30b-a3b",
    name: "Nemotron 3 Nano 30B",
    provider: "NVIDIA",
    capabilities: ["chat","code","reasoning","agent","tool_use","multilingual"],
    contextWindow: 131072,
    isReasoning: true,
    isMoE: true,
    parameterCount: "30B",
    activeParams: "3B",
    usageLevel: 2,
    isFree: true,
  },
  {
    id: "nvidia/llama-3.3-nemotron-super-49b-v1.5",
    name: "Llama 3.3 Nemotron Super 49B v1.5",
    provider: "NVIDIA",
    capabilities: ["chat","code","reasoning","agent","tool_use","multilingual"],
    contextWindow: 131072,
    isReasoning: true,
    isMoE: false,
    parameterCount: "49B",
    usageLevel: 2,
    isFree: true,
  },
  {
    id: "nvidia/llama-3.1-nemotron-ultra-253b-v1",
    name: "Llama 3.1 Nemotron Ultra 253B",
    provider: "NVIDIA",
    capabilities: ["chat","code","reasoning","agent","tool_use","multilingual"],
    contextWindow: 131072,
    isReasoning: true,
    isMoE: false,
    parameterCount: "253B",
    usageLevel: 4,
    isFree: true,
  },
  {
    id: "nvidia/nvidia-nemotron-nano-9b-v2",
    name: "Nemotron Nano 9B v2",
    provider: "NVIDIA",
    capabilities: ["chat","code","agent","multilingual"],
    contextWindow: 131072,
    isReasoning: false,
    isMoE: false,
    parameterCount: "9B",
    usageLevel: 1,
    isFree: true,
  },
  {
    id: "nvidia/nemotron-mini-4b-instruct",
    name: "Nemotron Mini 4B",
    provider: "NVIDIA",
    capabilities: ["chat","code","multilingual"],
    contextWindow: 32768,
    isReasoning: false,
    isMoE: false,
    parameterCount: "4B",
    usageLevel: 1,
    isFree: true,
  },
  {
    id: "meta/llama-3.3-70b-instruct",
    name: "Llama 3.3 70B Instruct",
    provider: "Meta",
    capabilities: ["chat","code","reasoning","agent","tool_use","multilingual"],
    contextWindow: 131072,
    isReasoning: false,
    isMoE: false,
    parameterCount: "70B",
    usageLevel: 2,
    isFree: true,
  },
  {
    id: "meta/llama-3.1-70b-instruct",
    name: "Llama 3.1 70B Instruct",
    provider: "Meta",
    capabilities: ["chat","code","reasoning","agent","tool_use","multilingual"],
    contextWindow: 131072,
    isReasoning: false,
    isMoE: false,
    parameterCount: "70B",
    usageLevel: 2,
    isFree: true,
  },
  {
    id: "meta/llama-3.2-3b-instruct",
    name: "Llama 3.2 3B Instruct",
    provider: "Meta",
    capabilities: ["chat","code","agent","multilingual"],
    contextWindow: 131072,
    isReasoning: false,
    isMoE: false,
    parameterCount: "3B",
    usageLevel: 1,
    isFree: true,
  },
  {
    id: "meta/llama-3.1-8b-instruct",
    name: "Llama 3.1 8B Instruct",
    provider: "Meta",
    capabilities: ["chat","code","agent","multilingual"],
    contextWindow: 131072,
    isReasoning: false,
    isMoE: false,
    parameterCount: "8B",
    usageLevel: 1,
    isFree: true,
  },
  {
    id: "deepseek-ai/deepseek-v4-pro",
    name: "DeepSeek V4 Pro",
    provider: "DeepSeek",
    capabilities: ["chat","code","reasoning","agent","tool_use","multilingual"],
    contextWindow: 131072,
    isReasoning: true,
    isMoE: true,
    parameterCount: "685B",
    activeParams: "37B",
    usageLevel: 3,
    isFree: true,
  },
  {
    id: "deepseek-ai/deepseek-v4-flash",
    name: "DeepSeek V4 Flash",
    provider: "DeepSeek",
    capabilities: ["chat","code","reasoning","agent","multilingual"],
    contextWindow: 131072,
    isReasoning: true,
    isMoE: true,
    parameterCount: "285B",
    activeParams: "21B",
    usageLevel: 2,
    isFree: true,
  },
  {
    id: "qwen/qwen3-coder-480b-a35b-instruct",
    name: "Qwen 3 Coder 480B",
    provider: "Alibaba",
    capabilities: ["code","reasoning","agent","tool_use","multilingual"],
    contextWindow: 131072,
    isReasoning: true,
    isMoE: true,
    parameterCount: "480B",
    activeParams: "35B",
    usageLevel: 3,
    isFree: true,
  },
  {
    id: "qwen/qwen3-next-80b-a3b-instruct",
    name: "Qwen 3 Next 80B",
    provider: "Alibaba",
    capabilities: ["chat","code","reasoning","agent","tool_use","multilingual"],
    contextWindow: 131072,
    isReasoning: true,
    isMoE: true,
    parameterCount: "80B",
    activeParams: "3B",
    usageLevel: 2,
    isFree: true,
  },
  {
    id: "qwen/qwen3-next-80b-a3b-thinking",
    name: "Qwen 3 Next 80B Thinking",
    provider: "Alibaba",
    capabilities: ["chat","code","reasoning","agent","multilingual"],
    contextWindow: 131072,
    isReasoning: true,
    isMoE: true,
    parameterCount: "80B",
    activeParams: "3B",
    usageLevel: 2,
    isFree: true,
  },
  {
    id: "qwen/qwq-32b",
    name: "QwQ 32B",
    provider: "Alibaba",
    capabilities: ["chat","code","reasoning","multilingual"],
    contextWindow: 131072,
    isReasoning: true,
    isMoE: false,
    parameterCount: "32B",
    usageLevel: 2,
    isFree: true,
  },
  {
    id: "moonshotai/kimi-k2-instruct",
    name: "Kimi K2 Instruct",
    provider: "Moonshot AI",
    capabilities: ["chat","code","reasoning","agent","tool_use","multilingual"],
    contextWindow: 131072,
    isReasoning: true,
    isMoE: false,
    parameterCount: "256B",
    usageLevel: 3,
    isFree: true,
  },
  {
    id: "moonshotai/kimi-k2-thinking",
    name: "Kimi K2 Thinking",
    provider: "Moonshot AI",
    capabilities: ["chat","code","reasoning","agent","multilingual"],
    contextWindow: 131072,
    isReasoning: true,
    isMoE: false,
    parameterCount: "256B",
    usageLevel: 3,
    isFree: true,
  },
  {
    id: "mistralai/mistral-nemotron",
    name: "Mistral Nemotron",
    provider: "Mistral AI",
    capabilities: ["chat","code","reasoning","agent","tool_use","multilingual"],
    contextWindow: 131072,
    isReasoning: true,
    isMoE: false,
    parameterCount: "123B",
    usageLevel: 2,
    isFree: true,
  },
  {
    id: "openai/gpt-oss-120b",
    name: "GPT-OSS 120B",
    provider: "OpenAI",
    capabilities: ["chat","code","reasoning","agent","tool_use","multilingual"],
    contextWindow: 131072,
    isReasoning: true,
    isMoE: true,
    parameterCount: "120B",
    usageLevel: 3,
    isFree: true,
  },
  {
    id: "openai/gpt-oss-20b",
    name: "GPT-OSS 20B",
    provider: "OpenAI",
    capabilities: ["chat","code","reasoning","agent","tool_use","multilingual"],
    contextWindow: 131072,
    isReasoning: true,
    isMoE: true,
    parameterCount: "20B",
    usageLevel: 2,
    isFree: true,
  },
  {
    id: "microsoft/phi-4-mini-instruct",
    name: "Phi-4 Mini Instruct",
    provider: "Microsoft",
    capabilities: ["chat","code","agent","multilingual"],
    contextWindow: 131072,
    isReasoning: false,
    isMoE: false,
    parameterCount: "3.8B",
    usageLevel: 1,
    isFree: true,
  },
  {
    id: "microsoft/phi-4-mini-flash-reasoning",
    name: "Phi-4 Mini Flash Reasoning",
    provider: "Microsoft",
    capabilities: ["chat","code","reasoning","agent","multilingual"],
    contextWindow: 131072,
    isReasoning: true,
    isMoE: false,
    parameterCount: "3.8B",
    usageLevel: 1,
    isFree: true,
  },
  {
    id: "mistralai/mixtral-8x22b-instruct",
    name: "Mixtral 8x22B Instruct",
    provider: "Mistral AI",
    capabilities: ["chat","code","agent","tool_use","multilingual"],
    contextWindow: 65536,
    isReasoning: false,
    isMoE: true,
    parameterCount: "141B",
    activeParams: "39B",
    usageLevel: 2,
    isFree: true,
  },
  {
    id: "bytedance/seed-oss-36b-instruct",
    name: "Seed-OSS 36B",
    provider: "ByteDance",
    capabilities: ["chat","code","agent","multilingual"],
    contextWindow: 131072,
    isReasoning: false,
    isMoE: false,
    parameterCount: "36B",
    usageLevel: 2,
    isFree: true,
  },
  {
    id: "z-ai/glm-5.2",
    name: "GLM 5.2",
    provider: "Zhipu AI",
    capabilities: ["chat","code","reasoning","agent","tool_use","multilingual"],
    contextWindow: 131072,
    isReasoning: true,
    isMoE: false,
    parameterCount: "72B",
    usageLevel: 2,
    isFree: true,
  },
];

// Fast lookup helpers
export function findNimModel(id: string): NimModelInfo | undefined {
  return NIM_MODEL_CATALOG.find(m => m.id === id);
}

export function nimModelsByCapability(cap: ModelCapability): NimModelInfo[] {
  return NIM_MODEL_CATALOG.filter(m => m.capabilities.includes(cap));
}

// ── Default Model Choices ─────────────────────────────────────────────────────

export const NIM_DISPATCHER_MODEL = "meta/llama-3.2-3b-instruct";

export const NIM_DEFAULT_CHAT_MODEL = "nvidia/nemotron-3-super-120b-a12b";

export const NIM_DEFAULT_CODE_MODEL = "meta/llama-3.1-8b-instruct";

export const NIM_CHAT_FALLBACK_CHAIN = [
  "nvidia/nemotron-3-super-120b-a12b",
  "meta/llama-3.3-70b-instruct",
  "nvidia/llama-3.3-nemotron-super-49b-v1.5",
  "meta/llama-3.1-8b-instruct",
];

export const NIM_CODE_FALLBACK_CHAIN = [
  "meta/llama-3.1-8b-instruct",
  "nvidia/nemotron-3-super-120b-a12b",
  "meta/llama-3.3-70b-instruct",
];

export const NIM_REASONING_FALLBACK_CHAIN = [
  "nvidia/nemotron-3-super-120b-a12b",
  "moonshotai/kimi-k2-instruct",
  "qwen/qwen3-next-80b-a3b-thinking",
];

// ── Task → Model routing (dynamic, per task type) ─────────────────────────────
// Different tasks need different model strengths.
// "dispatcher" tasks need fast cheap models.
// "chat" tasks need balanced general-purpose.
// "code" needs the strongest coding models.
// "reasoning" needs deep thinking models.
// "agent" needs tool-use-capable models.
// "research" needs large context + agent capabilities.
// "factcheck" needs broad knowledge + web-verification ability.

export type TaskType = "dispatcher" | "chat" | "code" | "reasoning" | "agent" | "research" | "factcheck";

const TASK_MODEL_MAP: Record<TaskType, string[]> = {
  dispatcher: [
    "meta/llama-3.2-3b-instruct",
    "meta/llama-3.1-8b-instruct",
    "nvidia/nemotron-mini-4b-instruct",
  ],
  chat: [
    "nvidia/nemotron-3-super-120b-a12b",
    "nvidia/llama-3.3-nemotron-super-49b-v1.5",
    "meta/llama-3.3-70b-instruct",
    "meta/llama-3.1-8b-instruct",
  ],
  code: [
    "meta/llama-3.1-8b-instruct",
    "nvidia/nemotron-3-super-120b-a12b",
    "meta/llama-3.3-70b-instruct",
    "openai/gpt-oss-120b",
    "qwen/qwq-32b",
  ],
  reasoning: [
    "nvidia/nemotron-3-super-120b-a12b",
    "moonshotai/kimi-k2-instruct",
    "moonshotai/kimi-k2-thinking",
    "qwen/qwen3-next-80b-a3b-thinking",
    "qwen/qwq-32b",
  ],
  agent: [
    "deepseek-ai/deepseek-v4-pro",
    "meta/llama-3.1-8b-instruct",
    "nvidia/nemotron-3-super-120b-a12b",
    "openai/gpt-oss-120b",
    "mistralai/mistral-nemotron",
    "moonshotai/kimi-k2-instruct",
  ],
  research: [
    "nvidia/nemotron-3-super-120b-a12b",
    "moonshotai/kimi-k2-instruct",
    "openai/gpt-oss-120b",
    "meta/llama-3.3-70b-instruct",
  ],
  factcheck: [
    "moonshotai/kimi-k2-instruct",
    "nvidia/nemotron-3-super-120b-a12b",
    "google/gemma-4-31b-it",
    "openai/gpt-oss-120b",
    "meta/llama-3.3-70b-instruct",
  ],
};

export function modelsForTask(task: TaskType): string[] {
  return TASK_MODEL_MAP[task] ?? NIM_CHAT_FALLBACK_CHAIN;
}

/**
 * Map an agent name (from the pipeline) to the right task type.
 */
export function agentToTaskType(agentName: string): TaskType {
  const name = agentName.toLowerCase();
  // Both spellings: the pipeline names the agent "Organizer" (z), this map was
  // written with "organiser" (s), so it silently missed every time.
  if (name.includes("dispatcher") || name.includes("organiser") || name.includes("organizer") || name.includes("summarizer")) return "dispatcher";
  if (name.includes("factcheck") || name.includes("fact.check") || name.includes("fact_check") || name.includes("verifier")) return "factcheck";
  if (name.includes("coder") || name.includes("optimiser") || name.includes("architect")) return "code";
  if (name.includes("analyser") || name.includes("planner") || name.includes("critic")) return "reasoning";
  if (name.includes("researcher") || name.includes("research") || name.includes("scout")) return "research";
  if (name.includes("tester") || name.includes("hacker") || name.includes("auditor") || name.includes("security")) return "agent";
  return "chat"; // default for unknown agents
}

// ── NVIDIA NIM API Call ────────────────────────────────────────────────────────

interface NimChatResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: { role: string; content: string; reasoning_content?: string };
    finish_reason: string;
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export interface NimChatResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
  model: string;
}

/**
 * Resolve NVIDIA NIM API keys from DB (nimKeys table).
 * Fallback to env var NVAPI_KEY for backward compat.
 */
function stripQuotes(s: string): string {
  s = s.trim();
  while ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    s = s.slice(1, -1).trim();
  }
  return s;
}

async function resolveNimKeys(ctx: { runQuery: ActionCtx["runQuery"] }): Promise<string[]> {
  const keys: string[] = [];
  try {
    const dbKeys = await ctx.runQuery(internal.admin.getNimKeysInternal, {});
    if (Array.isArray(dbKeys)) {
      for (const k of dbKeys) {
        if (typeof k === "string" && k.trim()) keys.push(stripQuotes(k));
      }
    }
  } catch { /* nimKeys table might not exist yet — ok */ }
  const envKey = (process.env.NVAPI_KEY ?? "").trim();
  if (envKey) keys.push(envKey);

  // Shuffle keys to distribute load (round-robin)
  for (let i = keys.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [keys[i], keys[j]] = [keys[j], keys[i]];
  }

  return Array.from(new Set(keys)); // Deduplicate
}

function parseSseResponse(raw: string, defaultModel: string): NimChatResult | null {
  if (!raw.startsWith("data: ")) return null;
  let text = "";
  let modelName = defaultModel;
  let promptTokens = 0;
  let completionTokens = 0;
  for (const line of raw.split("\n")) {
    if (!line.startsWith("data: ")) continue;
    const payload = line.slice(6).trim();
    if (payload === "[DONE]") continue;
    try {
      const chunk = JSON.parse(payload);
      const delta = chunk.choices?.[0]?.delta;
      if (delta?.content) text += delta.content;
      if (chunk.model) modelName = chunk.model;
      if (chunk.usage) {
        promptTokens = chunk.usage.prompt_tokens ?? promptTokens;
        completionTokens = chunk.usage.completion_tokens ?? completionTokens;
      }
    } catch { /* json parse skip */ }
  }
  return { text, inputTokens: promptTokens, outputTokens: completionTokens, model: modelName };
}

export async function callNim(
  ctx: { runQuery: ActionCtx["runQuery"] },
  prompt: string,
  systemPrompt: string,
  model: string = NIM_DEFAULT_CHAT_MODEL,
  maxTokens: number = 8192,
  temperature: number = 0.7,
  history?: Array<{ role: "user" | "assistant"; content: string }>,
): Promise<NimChatResult> {
  const apiKeys = await resolveNimKeys(ctx);
  if (apiKeys.length === 0) {
    throw new Error("NVIDIA_NIM_NOT_CONFIGURED: no NIM API keys in DB or NVAPI_KEY env var — add keys via /admin");
  }

  const messages = [
    { role: "system" as const, content: systemPrompt.slice(0, 8000) },
    ...(history && history.length > 0
      ? [
          ...history.map(m => ({ role: m.role, content: m.content.slice(0, 8000) })),
          { role: "user" as const, content: prompt.slice(0, 16000) },
        ]
      : [{ role: "user" as const, content: prompt.slice(0, 16000) }]),
  ];

  const body = JSON.stringify({
    model,
    messages,
    max_tokens: maxTokens,
    temperature,
    top_p: 1,
    stream: true,
  });

  let lastError: Error | null = null;

  for (let k = 0; k < apiKeys.length; k++) {
    const apiKey = apiKeys[k];

    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), 500_000);
    try {
      const res = await fetch(`${BASE_URL}/chat/completions`, {
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
        let errMsg = raw.slice(0, 500);
        try { const j = JSON.parse(raw); errMsg = j.error?.message ?? j.message ?? raw.slice(0, 300); } catch { /* raw */ }
        const err = new Error(`NVIDIA NIM ${res.status} (key ${k + 1}/${apiKeys.length}): ${errMsg}`);
        lastError = err;
        clearTimeout(timeout);
        if (res.status === 401 || res.status === 403 || res.status === 429 || res.status >= 500) continue;
        throw err;
      }

      const result = parseSseResponse(raw, model);
      if (result) return result;

      const data: NimChatResponse = JSON.parse(raw);
      const text = data.choices?.[0]?.message?.content ?? "";
      return {
        text,
        inputTokens: data.usage?.prompt_tokens ?? 0,
        outputTokens: data.usage?.completion_tokens ?? 0,
        model: data.model ?? model,
      };
    } catch (err) {
      clearTimeout(timeout);
      if (err instanceof Error && err.name === "AbortError") {
        lastError = new Error(`NIM request timed out after 500s (key ${k + 1})`);
        continue;
      }
      if (err !== lastError) lastError = err instanceof Error ? err : new Error(String(err));
      continue;
    }
  }

  throw lastError ?? new Error("NIM request failed — all keys exhausted");
}

/**
 * Streaming variant — fetches full response then drip-feeds in chunks.
 */
export async function callNimStreaming(
  ctx: { runQuery: ActionCtx["runQuery"] },
  prompt: string,
  systemPrompt: string,
  model: string,
  onDelta: (text: string) => Promise<void>,
  maxTokens: number = 8192,
  history?: Array<{ role: "user" | "assistant"; content: string }>,
): Promise<NimChatResult> {
  const result = await callNim(ctx, prompt, systemPrompt, model, maxTokens, 0.7, history);

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

// ── Model Router for Dispatcher (task-aware routing) ───────────────────────────

export function buildNimDispatchPrompt(
  task: string,
  agentNames: string[],
  fileCount: number,
  hasExistingCode: boolean,
): { systemPrompt: string; userPrompt: string } {
  const catalogSummary = NIM_MODEL_CATALOG.filter(m => m.isFree && m.capabilities.includes("agent")).map(m => {
    const tags = [
      m.isReasoning ? "reasoning" : "fast",
      m.isMoE ? `MoE(${m.parameterCount}${m.activeParams ? `, active ${m.activeParams}` : ""})` : `dense(${m.parameterCount})`,
      `${m.contextWindow.toLocaleString()}ctx`,
    ].join(" · ");
    return `- "${m.id}" (${m.name}) ${m.provider} — ${tags}`;
  }).join("\n");

  const systemPrompt = `You are a model router for NVIDIA NIM. Given a task and a list of agent names, pick the best NIM model for each agent.

Rules:
1. Fast/simple agents (Dispatcher, Organizer, Summarizer) → small efficient models (nemotron-nano-9b, phi-4-mini, llama-3.1-8b)
2. Heavy coding agents (Coder, Optimiser, Architect) → qwen3-coder-480b, deepseek-v4-pro, nemotron-3-super-120b
3. Reasoning agents (Analyser, Planner, Critic) → deepseek-v4-pro, nemotron-3-super-120b, kimi-k2-instruct
4. Research agents (Researcher, Scout, DataTaker) → nemotron-3-super-120b, llama-3.3-70b, gpt-oss-120b
5. Security/hard agents (Tester, Hacker, Auditor, RedTeam) → deepseek-v4-pro, nemotron-3-super-120b
6. Agent pipeline agents need tool_use capability — prefer models with it
7. Consider context window — huge tasks need models with 131K+ ctx

Respond ONLY with valid JSON:
{"assignments": [{"agentName": "Agent1", "modelId": "nvidia/nemotron-3-super-120b-a12b", "reasoning": "why this model"}, ...]}`;

  const userPrompt = [
    `## Task`,
    task.slice(0, 2000),
    `## Agents to Assign`,
    agentNames.join(", "),
    `## Context`,
    `Existing files: ${fileCount}${hasExistingCode ? " (has code)" : " (greenfield)"}`,
    ``,
    `## Available NVIDIA NIM Models`,
    catalogSummary,
  ].join("\n");

  return { systemPrompt, userPrompt };
}

export function parseNimDispatchAssignments(jsonText: string): Record<string, string> {
  try {
    const cleaned = jsonText.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();
    const parsed = JSON.parse(cleaned);
    if (!parsed.assignments || !Array.isArray(parsed.assignments)) return {};
    const assignments: Record<string, string> = {};
    for (const a of parsed.assignments) {
      if (a.agentName && a.modelId && findNimModel(a.modelId)) {
        assignments[a.agentName] = a.modelId;
      }
    }
    return assignments;
  } catch {
    return {};
  }
}

// ── Agent Buck pricing ─────────────────────────────────────────────────────────

export function calcNimAgentBucks(
  modelId: string,
  inputTokens: number,
  outputTokens: number,
): number {
  const model = findNimModel(modelId);
  if (!model) return 0;

  const sizeNum = model.isMoE
    ? parseInt(model.activeParams?.replace(/[^0-9]/g, "") ?? "0") || 5
    : parseInt(model.parameterCount.replace(/[^0-9]/g, "") ?? "0") || 5;

  const sizeFactor = Math.max(1, sizeNum / 5);
  const inputCostPerM = model.isReasoning ? sizeFactor * 0.5 : Math.max(0.3, sizeFactor * 0.12);
  const outputCostPerM = model.isReasoning ? sizeFactor * 2.0 : Math.max(1.0, sizeFactor * 0.4);

  const inputAB = (inputTokens / 1_000_000) * inputCostPerM * 1_500_000;
  const outputAB = (outputTokens / 1_000_000) * outputCostPerM * 1_500_000;
  return Math.ceil(inputAB + outputAB);
}