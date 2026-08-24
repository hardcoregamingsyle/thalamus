// Hugging Face Inference Providers router — OpenAI-compatible model gateway,
// seated after ModelScope and before Pollinations in the pipeline chain.
// Runs at https://router.huggingface.co. Auth is a free HF token set in the
// Convex dashboard as HF_TOKEN (huggingface.co/settings/tokens).
//
// Why this leg exists: ONE free token reaches 100+ open-weight models through
// a single endpoint — including the Qwen 3.8 Max-class 2.4T checkpoint, GLM,
// Kimi and DeepSeek frontier seats — routed to whichever backend provider is
// live right now. It is deliberately seated low: the included free credit is
// thin (~100K inference credits/month on a free hub account, so a handful of
// pipeline calls), and when it runs out the router answers 402 and the chain
// falls through to the anonymous tail. Strong but thin is a backstop, not a
// primary seat.
//
// Notable absence (checked 2026-08-24): Qwen/Qwen3.8-27B is NOT yet served on
// the router — its hub API record has no inferenceProviderMapping. The
// OrcaRouter leg higher in the chain already covers that model for free, so
// nothing is lost; do not add the id here until a router provider picks it up.
//
// What is NOT real (do not "fix" this file to use it): there is no un-keyed
// public pool at https://hf.space — that domain hosts individual Spaces apps,
// it serves no chat/completions route, and any snippet claiming otherwise is
// bogus. The only real endpoints are this router (keyed) and the legacy
// CPU-focused hf-inference API (small models only).
//
// Request/response shape is OpenAI-compatible (chat completions, SSE
// streaming), so the implementation deliberately mirrors openrouterClient.ts:
// idle-based timeouts, throttled delta flush for UI streaming, and mid-stream
// salvage so a stalled generation still yields its partial text.

import type { ActionCtx } from "../_generated/server";

// ── Base URL ───────────────────────────────────────────────────────────────────
const BASE_URL = "https://router.huggingface.co/v1";

// Same timeout philosophy as the other streamed legs: the first byte must
// appear within FIRST_CHUNK (a provider silent for a minute is dead, not slow)
// and each chunk within IDLE (a stalled stream is a broken one). The total is
// bounded only by the chain deadline passed in.
const HUGGINGFACE_FIRST_CHUNK_TIMEOUT_MS = 60_000;
const HUGGINGFACE_STREAM_IDLE_TIMEOUT_MS = 60_000;

// A stalled stream that already delivered at least this much text is salvaged
// rather than failed — a truncated agent message the pipeline can act on beats
// a dead run, and the agents' own JSON-op parser tolerates a cut-off tail.
const SALVAGEABLE_STREAM_CHARS = 400;

// ── Model Catalog ─────────────────────────────────────────────────────────────
// Verified live on https://router.huggingface.co/v1/models on 2026-08-24.
// Every entry is credit-metered (the router's own model list marks them all
// is_free: false) — the included monthly credit covers only a few calls, so
// treat every id here as a backstop seat: when the credit is gone the leg
// 402s and the chain falls through. Router rosters rotate; an id that stops
// answering simply fails the leg the same way.

export interface HuggingFaceModelInfo {
  id: string;
  name: string;
  provider: string;
  contextWindow: number;
  parameterCount: string;
  isReasoning: boolean;
}

export const HUGGINGFACE_MODEL_CATALOG: HuggingFaceModelInfo[] = [
  {
    id: "Qwen/Qwen3.8-2.4T-A95B",
    name: "Qwen 3.8 Max-class 2.4T",
    provider: "Alibaba",
    contextWindow: 1010000,
    parameterCount: "2.4T MoE (95B active)",
    isReasoning: true,
  },
  {
    id: "zai-org/GLM-5.2",
    name: "GLM 5.2",
    provider: "Z.ai",
    contextWindow: 1048576,
    parameterCount: "Frontier MoE",
    isReasoning: true,
  },
  {
    id: "deepseek-ai/DeepSeek-V4-Flash",
    name: "DeepSeek V4 Flash",
    provider: "DeepSeek",
    contextWindow: 1048576,
    parameterCount: "285B-class MoE",
    isReasoning: true,
  },
  {
    id: "moonshotai/Kimi-K2.7-Code",
    name: "Kimi K2.7 Code",
    provider: "Moonshot AI",
    contextWindow: 262144,
    parameterCount: "Agentic-code MoE",
    isReasoning: true,
  },
  {
    id: "Qwen/Qwen3-Coder-480B-A35B-Instruct",
    name: "Qwen 3 Coder 480B",
    provider: "Alibaba",
    contextWindow: 262144,
    parameterCount: "480B MoE (35B active)",
    isReasoning: false,
  },
  {
    id: "openai/gpt-oss-120b",
    name: "gpt-oss 120B",
    provider: "OpenAI",
    contextWindow: 131072,
    parameterCount: "117B MoE",
    isReasoning: true,
  },
];

export function findHuggingFaceModel(id: string): HuggingFaceModelInfo | undefined {
  return HUGGINGFACE_MODEL_CATALOG.find((m) => m.id === id);
}

// ── Default Model Choices ─────────────────────────────────────────────────────
// Dispatcher: calls are frequent and JSON-strict, and this leg spends a thin
// monthly credit — gpt-oss-120b is the cheapest strong seat on the router and
// the most resilient (eleven live backend providers when verified), so it
// stretches the credit furthest.
export const HUGGINGFACE_DISPATCHER_MODEL = "openai/gpt-oss-120b";
// Everything else: when every higher leg is down, the last keyed fallback
// should make its few calls count. V4-Flash is frontier-class coding at the
// lowest metered price on the router, with a 1M context.
export const HUGGINGFACE_DEFAULT_MODEL = "deepseek-ai/DeepSeek-V4-Flash";

// ── OpenAI-compatible Chat API ────────────────────────────────────────────────

export interface HuggingFaceChatResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
  model: string;
}

function tryParseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Call the Hugging Face router chat completions (streaming SSE,
 * OpenAI-compatible).
 *
 * Mirrors callOrcaRouter / callOpenRouter: `stream: true`, line-by-line parse,
 * idle watchdogs, throttled `onDelta` flush for the UI's streaming view, and
 * salvage of a partial response when the stream dies mid-generation.
 *
 * Key comes from the HF_TOKEN env var (Convex dashboard). When it is not set
 * the leg fails fast with HUGGINGFACE_NOT_CONFIGURED and the provider chain
 * moves on without a network round-trip.
 */
export async function callHuggingFace(
  prompt: string,
  systemPrompt: string,
  model: string = HUGGINGFACE_DEFAULT_MODEL,
  maxTokens: number = 32768,
  _runQuery?: ActionCtx["runQuery"],
  deadlineMs?: number,
  onDelta?: (delta: string) => Promise<void>,
): Promise<HuggingFaceChatResult> {
  const apiKey = (process.env.HF_TOKEN ?? "").trim();
  if (!apiKey) {
    throw new Error("HUGGINGFACE_NOT_CONFIGURED: set HF_TOKEN in the Convex dashboard");
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
    stream: true,
    stream_options: { include_usage: true },
  });

  const remaining = deadlineMs === undefined ? 420_000 : deadlineMs - Date.now();
  if (remaining <= 5_000) {
    throw new Error("HuggingFace: no time left in chain budget");
  }

  const ctrl = new AbortController();
  const totalTimer = setTimeout(() => ctrl.abort(), remaining);

  let lastChunkAt = Date.now();
  let firstChunkSeen = false;
  // Accumulated stream state lives out here so the catch block can salvage a
  // partial response when the stream stalls mid-generation.
  let text = "";
  let promptTokens = 0;
  let completionTokens = 0;
  let resolvedModel = model;
  let done = false;
  let idleTimer: ReturnType<typeof setTimeout> | undefined;

  const armIdleWatchdog = () => {
    if (done) return;
    idleTimer = setTimeout(() => {
      const idleMs = Date.now() - lastChunkAt;
      if (!firstChunkSeen && idleMs >= HUGGINGFACE_FIRST_CHUNK_TIMEOUT_MS) {
        ctrl.abort();
      } else if (firstChunkSeen && idleMs >= HUGGINGFACE_STREAM_IDLE_TIMEOUT_MS) {
        ctrl.abort();
      } else {
        armIdleWatchdog();
      }
    }, 10_000);
  };

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

    if (!res.ok) {
      const raw = await res.text();
      const msg = tryParseJson(raw) as Record<string, unknown> | null;
      const errObj = msg?.error as Record<string, unknown> | undefined;
      throw new Error(`HuggingFace ${res.status}: ${typeof errObj?.message === "string" ? errObj.message : raw.slice(0, 300)}`);
    }

    if (!res.body) {
      throw new Error("HuggingFace: response body unavailable");
    }
    // Some endpoints answer plain JSON when they cannot stream — handle that
    // instead of assuming a text/event-stream body.
    const contentType = res.headers.get("content-type") ?? "";
    if (!contentType.includes("text/event-stream")) {
      const data = tryParseJson(await res.text()) as Record<string, unknown> | null;
      if (!data) throw new Error("HuggingFace: unexpected non-JSON response body");
      const choice = (data.choices as Array<Record<string, unknown>> | undefined)?.[0];
      const message = choice?.message as Record<string, unknown> | undefined;
      const usage = data.usage as Record<string, unknown> | undefined;
      return {
        text: typeof message?.content === "string" ? message.content : "",
        inputTokens: typeof usage?.prompt_tokens === "number" ? usage.prompt_tokens : 0,
        outputTokens: typeof usage?.completion_tokens === "number" ? usage.completion_tokens : 0,
        model: typeof data.model === "string" && data.model ? data.model : model,
      };
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let pendingFlush = "";
    let lastFlushAt = Date.now();

    const flush = async (force: boolean) => {
      if (!onDelta || !pendingFlush) return;
      if (!force && pendingFlush.length < 64 && Date.now() - lastFlushAt < 150) return;
      const chunk = pendingFlush;
      pendingFlush = "";
      lastFlushAt = Date.now();
      try {
        await onDelta(chunk);
      } catch { /* UI streaming is best-effort — never fail the model call */ }
    };

    armIdleWatchdog();

    while (!done) {
      const { done: readerDone, value } = await reader.read();
      if (readerDone) break;
      lastChunkAt = Date.now();
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const payload = trimmed.slice(5).trim();
        if (payload === "[DONE]") {
          done = true;
          break;
        }
        let evt: Record<string, unknown>;
        try {
          evt = JSON.parse(payload) as Record<string, unknown>;
        } catch { continue; }
        if (evt.error) {
          const errObj = evt.error as Record<string, unknown>;
          throw new Error(`HuggingFace stream error: ${typeof errObj?.message === "string" ? errObj.message : payload.slice(0, 300)}`);
        }
        const choice = (evt.choices as Array<Record<string, unknown>> | undefined)?.[0];
        const delta = choice?.delta as Record<string, unknown> | undefined;
        const content = delta?.content;
        if (typeof content === "string" && content) {
          if (!firstChunkSeen) firstChunkSeen = true;
          text += content;
          pendingFlush += content;
          await flush(false);
        }
        if (typeof evt.model === "string" && evt.model) resolvedModel = evt.model;
        const usage = evt.usage as Record<string, unknown> | undefined;
        if (usage) {
          if (typeof usage.prompt_tokens === "number") promptTokens = usage.prompt_tokens;
          if (typeof usage.completion_tokens === "number") completionTokens = usage.completion_tokens;
        }
      }
    }
    clearTimeout(idleTimer);
    await flush(true);

    return {
      text,
      inputTokens: promptTokens,
      outputTokens: completionTokens,
      model: resolvedModel,
    };
  } catch (err) {
    clearTimeout(idleTimer);
    if (err instanceof Error && err.name === "AbortError") {
      if (firstChunkSeen) {
        // The stream died mid-generation. Everything already streamed is real
        // model output — throwing it away costs the whole agent call, and when
        // this is the only healthy provider that means the run dies outright.
        // Salvage anything substantial enough to be usable and let the pipeline
        // continue; only a stall with near-nothing in hand is a true failure.
        if (text.trim().length >= SALVAGEABLE_STREAM_CHARS) {
          console.warn(`HuggingFace stream stalled after ${text.length} chars — returning the partial response instead of failing the call`);
          return {
            text,
            inputTokens: promptTokens,
            outputTokens: completionTokens,
            model: resolvedModel,
          };
        }
        throw new Error(`HuggingFace stream stalled — no data for too long (only ${text.trim().length} chars received)`);
      }
      throw new Error("HuggingFace request timed out before the first chunk");
    }
    throw err;
  } finally {
    clearTimeout(totalTimer);
  }
}
