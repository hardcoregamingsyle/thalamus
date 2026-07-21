// SiliconFlow API client — the sole AI provider for Thalamus.
// OpenAI-compatible chat completions + image/video generation.
// API key: set SILICONFLOW_API_KEY in Convex env vars.
// Docs: https://docs.siliconflow.com

// ── Base URL & Auth ───────────────────────────────────────────────────────────
const BASE_URL = "https://api.siliconflow.com/v1";
const API_KEY = (process.env.SILICONFLOW_API_KEY ?? "").trim();

function requireKey(): string {
  if (!API_KEY) throw new Error("SILICONFLOW_API_KEY not configured — set it in the Convex dashboard.");
  return API_KEY;
}

// ── Model Catalog ─────────────────────────────────────────────────────────────
// Every non-deprecated model from our supported list, grouped by capability.
// The Dispatcher receives this catalog to make routing decisions.

export interface ModelInfo {
  id: string;                    // Full SiliconFlow model id
  name: string;                  // Human-readable name
  provider: string;              // Provider/organization
  capabilities: ModelCapability[];
  contextWindow: number;         // Max context length in tokens
  isReasoning: boolean;          // Has thinking/chain-of-thought mode
  isMoE: boolean;                // Mixture of Experts architecture
  parameterCount: string;        // e.g. "2.8T", "862B", "35B-A3B"
  activeParams?: string;         // Activated parameters for MoE models
}

export type ModelCapability = "chat" | "code" | "reasoning" | "agent" | "vision" | "tool_use" | "image" | "video" | "multilingual";

export const MODEL_CATALOG: ModelInfo[] = [
  // ── Free Promotional Frontier Flagship ───────────────────────────────────
  { id: "moonshotai/Kimi-K3",                     name: "Kimi K3 (Free Promo)",       provider: "Moonshot AI",  capabilities: ["chat","code","reasoning","agent","vision","tool_use"],     contextWindow: 1000000, isReasoning: true,  isMoE: true,  parameterCount: "2.8T" },

  // ── High-Speed Reasoning ─────────────────────────────────────────────────
  { id: "deepseek-ai/DeepSeek-V4-Flash",          name: "DeepSeek V4 Flash",           provider: "DeepSeek",     capabilities: ["chat","code","reasoning","agent","tool_use"],             contextWindow: 1000000, isReasoning: true,  isMoE: true,  parameterCount: "158B", activeParams: "13B" },

  // ── Tencent Hunyuan ──────────────────────────────────────────────────────
  { id: "tencent/Hy3",                             name: "Hy3",                         provider: "Tencent",      capabilities: ["chat","code","reasoning","agent","tool_use"],             contextWindow: 262144, isReasoning: true,  isMoE: true,  parameterCount: "300B", activeParams: "21B" },
  { id: "tencent/Hy3-preview",                     name: "Hy3 Preview",                 provider: "Tencent",      capabilities: ["chat","code","reasoning","agent","tool_use"],             contextWindow: 131072, isReasoning: true,  isMoE: true,  parameterCount: "300B", activeParams: "21B" },

  // ── Moonshot Kimi Agentic — coding & vision ──────────────────────────────
  { id: "moonshotai/Kimi-K2.7-Code",              name: "Kimi K2.7 Code",              provider: "Moonshot AI",  capabilities: ["chat","code","reasoning","agent","vision","tool_use"], contextWindow: 262144, isReasoning: true,  isMoE: true,  parameterCount: "1T",   activeParams: "32B" },
  { id: "moonshotai/Kimi-K2.6",                    name: "Kimi K2.6",                   provider: "Moonshot AI",  capabilities: ["chat","code","reasoning","agent","vision","tool_use"], contextWindow: 262144, isReasoning: true,  isMoE: true,  parameterCount: "1T",   activeParams: "32B" },

  // ── Meituan LongCat — agentic workloads ──────────────────────────────────
  { id: "meituan-longcat/LongCat-2.0",             name: "LongCat 2.0",                 provider: "Meituan",      capabilities: ["chat","code","reasoning","agent","tool_use"],             contextWindow: 131072, isReasoning: true,  isMoE: true,  parameterCount: "1.6T" },

  // ── Zhipu GLM-5 family — long-horizon agentic ────────────────────────────
  { id: "zai-org/GLM-5.2",                         name: "GLM 5.2",                     provider: "Zhipu AI",     capabilities: ["chat","code","reasoning","agent","tool_use"],             contextWindow: 1000000, isReasoning: true,  isMoE: true,  parameterCount: "744B", activeParams: "40B" },
  { id: "zai-org/GLM-5.1",                         name: "GLM 5.1",                     provider: "Zhipu AI",     capabilities: ["chat","code","reasoning","agent","tool_use"],             contextWindow: 131072, isReasoning: true,  isMoE: true,  parameterCount: "744B", activeParams: "40B" },
  { id: "zai-org/GLM-5V-Turbo",                    name: "GLM 5V Turbo",                provider: "Zhipu AI",     capabilities: ["chat","code","reasoning","agent","vision","tool_use"],  contextWindow: 204800, isReasoning: true,  isMoE: true,  parameterCount: "744B" },

  // ── Nex Agentic Thinking ─────────────────────────────────────────────────
  { id: "nex-agi/Nex-N2-Pro",                      name: "Nex N2 Pro",                  provider: "Nex AGI",      capabilities: ["chat","code","reasoning","agent","vision","tool_use"],  contextWindow: 262144, isReasoning: true,  isMoE: true,  parameterCount: "397B" },

  // ── MiniMax M3 — multimodal coding & agentic ─────────────────────────────
  { id: "MiniMaxAI/MiniMax-M3",                     name: "MiniMax M3",                  provider: "MiniMax AI",   capabilities: ["chat","code","reasoning","agent","vision","tool_use"],  contextWindow: 1000000, isReasoning: true,  isMoE: true,  parameterCount: "—" },

  // ── Qwen 3.6 — latest efficient dense & MoE ──────────────────────────────
  { id: "Qwen/Qwen3.6-35B-A3B",                    name: "Qwen 3.6 35B-A3B",            provider: "Alibaba Qwen", capabilities: ["chat","code","reasoning","agent","vision","tool_use"],  contextWindow: 262144, isReasoning: true,  isMoE: true,  parameterCount: "35B",  activeParams: "3B" },
  { id: "Qwen/Qwen3.6-27B",                         name: "Qwen 3.6 27B",                provider: "Alibaba Qwen", capabilities: ["chat","code","reasoning","agent","vision","tool_use"],  contextWindow: 262144, isReasoning: true,  isMoE: false, parameterCount: "27B" },

  // ── Qwen 3.5 — large MoE workhorses ──────────────────────────────────────
  { id: "Qwen/Qwen3.5-397B-A17B",                  name: "Qwen 3.5 397B-A17B",           provider: "Alibaba Qwen", capabilities: ["chat","code","reasoning","agent","vision","tool_use"],  contextWindow: 262144, isReasoning: true,  isMoE: true,  parameterCount: "397B", activeParams: "17B" },
  { id: "Qwen/Qwen3.5-122B-A10B",                  name: "Qwen 3.5 122B-A10B",           provider: "Alibaba Qwen", capabilities: ["chat","code","reasoning","agent","vision","tool_use"],  contextWindow: 262144, isReasoning: true,  isMoE: true,  parameterCount: "122B", activeParams: "10B" },
];

// Fast lookup helpers
export function findModel(id: string): ModelInfo | undefined {
  return MODEL_CATALOG.find(m => m.id === id);
}

export function modelsByCapability(cap: ModelCapability): ModelInfo[] {
  return MODEL_CATALOG.filter(m => m.capabilities.includes(cap));
}

// ── Default Model Choices ─────────────────────────────────────────────────────
// All models must be from the curated MODEL_CATALOG above.

// The Dispatcher model — balanced and fast for routing decisions
// The Dispatcher model — fast and smart for routing decisions
export const DISPATCHER_MODEL = "Qwen/Qwen3.5-122B-A10B";

// Default chat model — good general-purpose
export const DEFAULT_CHAT_MODEL = "Qwen/Qwen3.6-35B-A3B";

// Default code model — best for coding tasks
export const DEFAULT_CODE_MODEL = "moonshotai/Kimi-K2.7-Code";

// Default models for chat mode (fallback chain: high capability → low)
export const CHAT_FALLBACK_CHAIN = [
  "Qwen/Qwen3.5-122B-A10B",   // Strong all-rounder
  "Qwen/Qwen3.6-35B-A3B",     // Efficient mid-tier
  "Qwen/Qwen3.6-27B",         // Lightweight dense
];

// Default models for code mode (fallback chain)
export const CODE_FALLBACK_CHAIN = [
  "moonshotai/Kimi-K2.7-Code",        // Best for coding
  "moonshotai/Kimi-K2.6",             // General agentic
  "Qwen/Qwen3.5-397B-A17B",           // MoE workhorse
];

// Default models for reasoning (fallback chain)
export const REASONING_FALLBACK_CHAIN = [
  "deepseek-ai/DeepSeek-V4-Flash",     // Fast high-speed reasoning
  "nex-agi/Nex-N2-Pro",                // Adaptive thinking
  "zai-org/GLM-5.2",                   // 1M ctx long-horizon
];

// Image generation model
export const DEFAULT_IMAGE_MODEL = "black-forest-labs/FLUX.1-dev";

// Video generation model
export const DEFAULT_VIDEO_MODEL = "Wan-AI/Wan2.2-T2V-A14B";

// ── Chat Completions ─────────────────────────────────────────────────────────
// Standard OpenAI-compatible chat endpoint.

interface SiliconFlowChatResponse {
  id: string;
  choices: Array<{
    message: {
      role: string;
      content: string;
      reasoning_content?: string;
    };
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
  model: string;
}

export interface ChatResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
  model: string;
}

/**
 * Call SiliconFlow chat completions (non-streaming).
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
    max_tokens: maxTokens,
    temperature: 0.7,
    stream: false,
  });

  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), 240_000);
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
      throw new Error(`SiliconFlow ${res.status}: ${raw.slice(0, 300)}`);
    }

    const data: SiliconFlowChatResponse = JSON.parse(raw);
    const text = data.choices?.[0]?.message?.content ?? "";
    // SiliconFlow reports prompt_tokens as completion tokens and vice versa.
    // Swap them so inputTokens = what the model generated (completion) and
    // outputTokens = what we sent (prompt). https://docs.siliconflow.com
    return {
      text,
      inputTokens: data.usage?.completion_tokens ?? 0,
      outputTokens: data.usage?.prompt_tokens ?? 0,
      model: data.model ?? model,
    };
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error("SiliconFlow request timed out after 240s");
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Call SiliconFlow with simulated streaming — fetch full response, then
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
  // Fetch the full response first
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

// ── Image Generation ─────────────────────────────────────────────────────────
// POST /v1/images/generations — returns one or more image URLs.

interface SiliconFlowImageResponse {
  images: Array<{ url: string }>;
  timings?: { inference: number };
  seed?: number;
}

/**
 * Generate an image using SiliconFlow's image generation API.
 * Returns an array of image URLs.
 */
export async function generateImage(
  prompt: string,
  model: string = DEFAULT_IMAGE_MODEL,
  imageSize: string = "1024x1024",
  count: number = 1,
): Promise<string[]> {
  const apiKey = requireKey();

  const body = JSON.stringify({
    model,
    prompt,
    image_size: imageSize,
    n: count,
    output_format: "png",
  });

  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), 120_000);
  try {
    const res = await fetch(`${BASE_URL}/images/generations`, {
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
      throw new Error(`SiliconFlow image generation error ${res.status}: ${raw.slice(0, 300)}`);
    }

    const data: SiliconFlowImageResponse = JSON.parse(raw);
    return data.images?.map(img => img.url) ?? [];
  } finally {
    clearTimeout(timeout);
  }
}

// ── Video Generation ─────────────────────────────────────────────────────────
// Two-step: POST /v1/video/submit → get requestId → poll /v1/video/status.

interface VideoSubmitResponse {
  requestId: string;
}

interface VideoStatusResponse {
  status: "InQueue" | "InProgress" | "Succeed" | "Failed";
  results?: Array<{ url: string }>;
  error?: string;
}

/**
 * Generate a video using SiliconFlow's video generation API.
 * Submits the job and polls until completion.
 * Returns the video URL(s).
 */
export async function generateVideo(
  prompt: string,
  model: string = DEFAULT_VIDEO_MODEL,
  imageSize: string = "1280x720",
  maxPollTimeMs: number = 300_000,
): Promise<string[]> {
  const apiKey = requireKey();

  // Step 1: Submit the video generation request
  const submitBody = JSON.stringify({
    model,
    prompt,
    image_size: imageSize,
  });

  const ctrl = new AbortController();
  const submitTimeout = setTimeout(() => ctrl.abort(), 60_000);
  let requestId: string;
  try {
    const res = await fetch(`${BASE_URL}/video/submit`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: submitBody,
      signal: ctrl.signal,
    });
    const raw = await res.text();
    if (!res.ok) {
      throw new Error(`SiliconFlow video submit error ${res.status}: ${raw.slice(0, 300)}`);
    }
    const data: VideoSubmitResponse = JSON.parse(raw);
    requestId = data.requestId;
    if (!requestId) throw new Error("No requestId in video submit response");
  } finally {
    clearTimeout(submitTimeout);
  }

  // Step 2: Poll for status
  const pollInterval = 5000; // 5 seconds
  const startTime = Date.now();

  while (Date.now() - startTime < maxPollTimeMs) {
    await new Promise(r => setTimeout(r, pollInterval));

    try {
      const statusBody = JSON.stringify({ requestId });
      const res = await fetch(`${BASE_URL}/video/status`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKey}`,
        },
        body: statusBody,
      });
      const raw = await res.text();
      if (!res.ok) continue;

      const data: VideoStatusResponse = JSON.parse(raw);

      if (data.status === "Succeed") {
        return data.results?.map(r => r.url) ?? [];
      }
      if (data.status === "Failed") {
        throw new Error(`Video generation failed: ${data.error ?? "unknown error"}`);
      }
      // "InQueue" or "InProgress" — keep polling
    } catch (err) {
      if (err instanceof Error && err.message.includes("Video generation failed")) {
        throw err;
      }
      // Network hiccup — keep polling
    }
  }

  throw new Error(`Video generation timed out after ${maxPollTimeMs / 1000}s`);
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
  const chatModels = modelsByCapability("chat").filter(m => m.capabilities.includes("agent") || m.capabilities.includes("tool_use"));
  const codeModels = modelsByCapability("code").filter(m => m.capabilities.includes("agent"));

  const catalogSummary = chatModels.map(m => {
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

  const systemPrompt = `You are a model router. Given a task description and a list of agent names, select the BEST model for each agent from the available catalog.

Rules:
1. Fast/simple agents (Organizer, Dispatcher, Summarizer) → fast efficient model (DeepSeek-V4-Flash, Qwen3.6-35B-A3B, Qwen3.6-27B)
2. Reasoning/coding agents (Coder, Analyser, Planner, Tester, Critic) → strong agentic model (Kimi-K2.7-Code, Kimi-K2.6, Nex-N2-Pro, GLM-5.2)
3. Research agents (Researcher) → balanced large model (Qwen3.5-122B-A10B, Hy3, LongCat-2.0)
4. Security agents (Hacker) → strong reasoning model (MiniMax-M3, GLM-5.2, Nex-N2-Pro)
5. NEVER use image or video models for chat/agent roles
6. Prefer models with "agent", "tool_use", and "reasoning" capabilities for pipeline agents
7. Consider context window — tasks with many files need bigger context (GLM-5.2, Kimi-K3, MiniMax-M3 have 1M+ ctx)

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
    `## Available Chat/Agent Models`,
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
  // These are approximate per-1M-token costs in cents
  const sizeFactor = model.isMoE
    ? (model.activeParams ? parseInt(model.activeParams) / 10 : 5)
    : parseInt(model.parameterCount.replace(/[^0-9]/g, "")) / 10;

  const inputCostPerM = model.isReasoning ? sizeFactor * 0.5 : Math.max(0.5, sizeFactor * 0.15);
  const outputCostPerM = model.isReasoning ? sizeFactor * 2.0 : Math.max(2.0, sizeFactor * 0.5);

  const inputAB = (inputTokens / 1_000_000) * inputCostPerM * 1_500_000;
  const outputAB = (outputTokens / 1_000_000) * outputCostPerM * 1_500_000;
  return Math.ceil(inputAB + outputAB);
}
