// OpenRouter API client — keyed free-model gateway in the pipeline chain,
// inserted between OpenCode Zen and DeadlySignal.
// Runs at https://openrouter.ai/api/v1 (OpenAI-compatible). Auth is a key set
// in the Convex dashboard as OPENROUTER_API_KEY (sk-or-v1-…; free models need a
// key even though they cost $0 — a $0-balance account is fine).
//
// Free-model caveat: the `:free` roster rotates constantly (DeepSeek, Gemini
// and Mistral free variants were pulled during 2026). The defaults are pinned
// to a specific STRONG free model (nemotron-3-ultra-550b) rather than the
// `openrouter/free` auto-router: production logs showed the auto-router
// selecting weak 30B seats (nemotron-3-nano-30b) for Coder. If the pinned id
// is ever rotated off the free roster it stops answering and the chain falls
// through to the next leg (DeadlySignal) — preferable to silently serving a
// weak model. The catalog feeds the Dispatcher short-circuit
// (findOpenRouterModel) — an id that has since gone paid simply stops
// short-circuiting and the chain falls through as usual.
// Free-tier limits: 20 requests/minute per free model; $0-balance accounts get
// 50 requests/day on free models — burst traffic lands on the next chain leg.
// Docs: https://openrouter.ai/docs

import type { ActionCtx } from "../_generated/server";

// ── Base URL ───────────────────────────────────────────────────────────────────
const BASE_URL = "https://openrouter.ai/api/v1";

// Streaming timeouts. The old hard 60s per-attempt cap killed slow-but-alive
// free models (the leg surfaced as "OpenRouter request timed out" while the
// upstream was still generating). With SSE the connection stays open while
// tokens flow: the first byte must appear within FIRST_CHUNK (a provider that
// answers nothing in a minute is dead, not slow) and each chunk must arrive
// within IDLE (a stalled stream is a broken one). The total is bounded only by
// the chain deadline passed in, so a model that keeps producing keeps the leg.
const OPENROUTER_FIRST_CHUNK_TIMEOUT_MS = 60_000;
const OPENROUTER_STREAM_IDLE_TIMEOUT_MS = 60_000;

// A stalled stream that already delivered at least this much text is salvaged
// rather than failed — a truncated agent message the pipeline can act on beats
// a dead run, and the agents' own JSON-op parser tolerates a cut-off tail.
const SALVAGEABLE_STREAM_CHARS = 400;

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

// Pointed at specific STRONG free models rather than the `openrouter/free`
// auto-router. The auto-router picks whatever free model currently fits the
// request, and production logs showed it selecting weak 30B seats (e.g.
// nemotron-3-nano-30b) for Coder. A specific strong id means the OpenRouter
// leg only answers with a strong model; if that model is ever rotated off the
// free roster the call 403s/404s and the chain falls through to the next leg
// (DeadlySignal has frontier seats), which is preferable to silently serving
// a weak model.
export const OPENROUTER_DISPATCHER_MODEL = "nvidia/nemotron-3-ultra-550b-a55b:free";
export const OPENROUTER_DEFAULT_MODEL = "nvidia/nemotron-3-ultra-550b-a55b:free";

// ── OpenAI-compatible Chat API ────────────────────────────────────────────────

export interface OpenRouterChatResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
  model: string;
}

/**
 * Call OpenRouter chat completions (streaming SSE, OpenAI-compatible).
 *
 * The request uses `stream: true` and the response is parsed line by line.
 * Two things follow from streaming:
 *
 * 1. The connection stays open as long as tokens flow — a slow free model no
 *    longer hits a fixed per-attempt cap and dies as "request timed out".
 *    Timeouts are now idle-based: silence before the first chunk or between
 *    chunks aborts; the total is bounded by the chain deadline, not a constant.
 * 2. Each delta can be delivered to the caller via `onDelta`, so the pipeline
 *    can write real tokens to the branch's streamingContent as they arrive.
 *    Deltas are throttled (a flush at least every 150ms, or when 64+ chars
 *    queue up) so the DB write rate stays sane for slow streams.
 *
 * Key comes from the OPENROUTER_API_KEY env var (Convex dashboard).
 */
export async function callOpenRouter(
  prompt: string,
  systemPrompt: string,
  model: string = OPENROUTER_DEFAULT_MODEL,
  maxTokens: number = 32768,
  _runQuery?: ActionCtx["runQuery"],
  deadlineMs?: number,
  onDelta?: (delta: string) => Promise<void>,
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
    stream: true,
    stream_options: { include_usage: true },
  });

  const remaining = deadlineMs === undefined ? 420_000 : deadlineMs - Date.now();
  if (remaining <= 5_000) {
    throw new Error("OpenRouter: no time left in chain budget");
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
      if (!firstChunkSeen && idleMs >= OPENROUTER_FIRST_CHUNK_TIMEOUT_MS) {
        ctrl.abort();
      } else if (firstChunkSeen && idleMs >= OPENROUTER_STREAM_IDLE_TIMEOUT_MS) {
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
      throw new Error(`OpenRouter ${res.status}: ${typeof errObj?.message === "string" ? errObj.message : raw.slice(0, 300)}`);
    }

    // Some endpoints answer plain JSON when they cannot stream — handle that
    // instead of assuming a text/event-stream body.
    const contentType = res.headers.get("content-type") ?? "";
    if (!res.body) {
      throw new Error("OpenRouter: response body unavailable");
    }
    if (!contentType.includes("text/event-stream")) {
      const data = tryParseJson(await res.text()) as Record<string, unknown> | null;
      if (!data) throw new Error("OpenRouter: unexpected non-JSON response body");
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
          throw new Error(`OpenRouter stream error: ${typeof errObj?.message === "string" ? errObj.message : payload.slice(0, 300)}`);
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
          console.warn(`OpenRouter stream stalled after ${text.length} chars — returning the partial response instead of failing the call`);
          return {
            text,
            inputTokens: promptTokens,
            outputTokens: completionTokens,
            model: resolvedModel,
          };
        }
        throw new Error(`OpenRouter stream stalled — no data for too long (only ${text.trim().length} chars received)`);
      }
      throw new Error(`OpenRouter request timed out`);
    }
    throw err;
  } finally {
    clearTimeout(totalTimer);
    clearTimeout(idleTimer);
  }
}

function tryParseJson(raw: string): Record<string, unknown> | null {
  try { return JSON.parse(raw); } catch { return null; }
}
