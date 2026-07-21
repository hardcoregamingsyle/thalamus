// Ollama Cloud API client — sole AI provider for Thalamus.
// Replaces the SiliconFlow implementation. Uses Ollama's native API directly.
// Auth: Bearer token via OLLAMA_API_KEY env var.
// Docs: https://docs.ollama.com/api/chat

// ── Base URL & Auth ───────────────────────────────────────────────────────────
const BASE_URL = "https://ollama.com";
const API_KEY = (process.env.OLLAMA_API_KEY ?? "").trim();

function requireKey(): string {
  if (!API_KEY) throw new Error("OLLAMA_API_KEY not configured — set it in the Convex dashboard.");
  return API_KEY;
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

export function modelsByCapability(cap: ModelCapability): ModelInfo[] {
  return MODEL_CATALOG.filter(m => m.capabilities.includes(cap));
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
 */
export async function callSiliconFlow(
  prompt: string,
  systemPrompt: string,
  model: string = DEFAULT_CHAT_MODEL,
  maxTokens: number = 16384,
  history?: Array<{ role: "user" | "assistant"; content: string }>,
): Promise<ChatResult> {
  const apiKey = requireKey();

  const messages = [
    { role: "system" as const, content: systemPrompt.slice(0, 32000) },
    ...(history && history.length > 0
      ? [
          ...history.map(m => ({ role: m.role, content: m.content.slice(0, 48000) })),
          { role: "user" as const, content: prompt.slice(0, 48000) },
        ]
      : [{ role: "user" as const, content: prompt.slice(0, 48000) }]),
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

  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), 300_000);
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
      throw new Error(`Ollama Cloud ${res.status}: ${msg.error ?? raw.slice(0, 300)}`);
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
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error("Ollama Cloud request timed out after 300s");
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
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
  maxTokens: number = 16384,
  history?: Array<{ role: "user" | "assistant"; content: string }>,
): Promise<ChatResult> {
  const result = await callSiliconFlow(prompt, systemPrompt, model, maxTokens, history);

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

// ── Image Generation (stub — not available on Ollama Cloud free plan) ─────────
// Multimodal models like minimax-m3 can understand images but not generate them.
// If image generation is needed, we'd need a separate provider.

export async function generateImage(
  _prompt: string,
  _model?: string,
  _imageSize?: string,
  _count?: number,
): Promise<string[]> {
  throw new Error("Image generation is not available on Ollama Cloud free plan. Consider adding a dedicated image generation provider.");
}

// ── Video Generation (stub — not available on Ollama Cloud free plan) ─────────

export async function generateVideo(
  _prompt: string,
  _model?: string,
  _imageSize?: string,
  _maxPollTimeMs?: number,
): Promise<string[]> {
  throw new Error("Video generation is not available on Ollama Cloud free plan. Consider adding a dedicated video generation provider.");
}

// ── Model Router ──────────────────────────────────────────────────────────────
// Tools for the Dispatcher to pick the right model for each agent.

export interface AgentModelAssignment {
  agentName: string;
  modelId: string;
  reasoning: string;
}

/**
 * Build a model selection prompt for the Dispatcher.
 * Given a task description and a list of agent names, returns a system prompt
 * that instructs the dispatcher to pick the best model for each agent.
 */
export function buildDispatchPrompt(
  task: string,
  agentNames: string[],
  fileCount: number,
  hasExistingCode: boolean,
): { systemPrompt: string; userPrompt: string } {
  const agentModels = modelsByCapability("agent").filter(m => m.capabilities.includes("tool_use"));
  const codeModels = modelsByCapability("code").filter(m => m.capabilities.includes("agent"));

  const catalogSummary = agentModels.map(m => {
    const tags = [
      m.isReasoning ? "reasoning" : "fast",
      m.isMoE ? `MoE(${m.parameterCount})` : `dense(${m.parameterCount})`,
      `${m.contextWindow.toLocaleString()}ctx`,
      m.capabilities.filter(c => c !== "chat").join(","),
    ].filter(Boolean).join(" · ");
    return `- "${m.id}" (${m.name}) ${m.provider} — ${tags}`;
  }).join("\n");

  const codeCatalogSummary = codeModels.map(m => {
    const tags = [
      m.isReasoning ? "reasoning" : "fast",
      m.isMoE ? `MoE(${m.parameterCount})` : `dense(${m.parameterCount})`,
      `${m.contextWindow.toLocaleString()}ctx`,
    ].filter(Boolean).join(" · ");
    return `- "${m.id}" (${m.name}) ${m.provider} — ${tags}`;
  }).join("\n");

  const systemPrompt = `You are a model router for a coding assistant. Given a task description and a list of agent names, select the BEST model for each agent from the available catalog.

Rules:
1. Fast/simple agents (Organizer, Dispatcher, Summarizer) → fast efficient model (gemma4:31b, gpt-oss:20b)
2. Reasoning/coding agents (Coder, Analyser, Planner, Tester, Critic) → strong agentic model (minimax-m3, gpt-oss:120b)
3. Research agents (Researcher) → balanced large model (gpt-oss:120b, minimax-m3)
4. Security agents (Hacker) → strong model (minimax-m3, gpt-oss:120b)
5. Prefer models with "agent", "tool_use", and "reasoning" capabilities for pipeline agents
6. Consider context window — tasks with many files need bigger context (minimax-m3 has 1M ctx)

Respond ONLY with valid JSON:
{"assignments": [{"agentName": "Agent1", "modelId": "...", "reasoning": "why this model"}, ...]}`;

  const userPrompt = [
    `## Task`,
    task.slice(0, 2000),
    `## Agents to Assign`,
    agentNames.join(", "),
    `## Context`,
    `Existing files: ${fileCount}${hasExistingCode ? " (has code)" : " (greenfield)"}`,
    ``,
    `## Available Agent Models`,
    catalogSummary,
    ``,
    `## Available Code Models`,
    codeCatalogSummary,
  ].join("\n");

  return { systemPrompt, userPrompt };
}

/**
 * Parse the Dispatcher's model assignment response.
 */
export function parseDispatchAssignments(jsonText: string): Record<string, string> {
  try {
    const cleaned = jsonText.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();
    const parsed = JSON.parse(cleaned);
    if (!parsed.assignments || !Array.isArray(parsed.assignments)) {
      return {};
    }
    const assignments: Record<string, string> = {};
    for (const a of parsed.assignments) {
      if (a.agentName && a.modelId && findModel(a.modelId)) {
        assignments[a.agentName] = a.modelId;
      }
    }
    return assignments;
  } catch {
    return {};
  }
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
