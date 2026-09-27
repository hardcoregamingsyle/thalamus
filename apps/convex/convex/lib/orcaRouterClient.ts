// OrcaRouter API client — OpenAI-compatible model gateway in the pipeline
// chain, seated right after OpenCode Zen and before OpenRouter.
// Runs at https://api.orcarouter.ai/v1. Auth is a key set in the Convex
// dashboard as ORCAROUTER_API_KEY.
//
// Why this leg exists: qwen3.8-27b-free is a strong seat
// (reasoning-class, competes with paid frontier models on code), and it is
// free at this gateway — exactly the profile the chain wants high up: strong
// enough for Coder/Critic seats, cheap enough to absorb burst traffic.
//
// Request/response shape is OpenAI-compatible (chat completions, SSE
// streaming), so the implementation deliberately mirrors openrouterClient.ts:
// idle-based timeouts, throttled delta flush for UI streaming, and mid-stream
// salvage so a stalled generation still yields its partial text.

import type { ActionCtx } from "../_generated/server";

// ── Base URL ───────────────────────────────────────────────────────────────────
const BASE_URL = "https://api.orcarouter.ai/v1";

// Same timeout philosophy as the OpenRouter leg: the first byte must appear
// within FIRST_CHUNK (a provider silent for a minute is dead, not slow) and
// each chunk within IDLE (a stalled stream is a broken one). The total is
// bounded only by the chain deadline passed in.
const ORCAROUTER_FIRST_CHUNK_TIMEOUT_MS = 60_000;
const ORCAROUTER_STREAM_IDLE_TIMEOUT_MS = 60_000;

// A stalled stream that already delivered at least this much text is salvaged
// rather than failed — a truncated agent message the pipeline can act on beats
// a dead run, and the agents' own JSON-op parser tolerates a cut-off tail.
const SALVAGEABLE_STREAM_CHARS = 400;

// ── Model Catalog ─────────────────────────────────────────────────────────────
// Verified free on OrcaRouter. Treat every id here as perishable — free
// rosters rotate; an id that stops answering simply fails the leg and the
// chain falls through to OpenRouter.

export interface OrcaRouterModelInfo {
  id: string;
  name: string;
  provider: string;
  contextWindow: number;
  parameterCount: string;
  isReasoning: boolean;
}

export const ORCAROUTER_MODEL_CATALOG: OrcaRouterModelInfo[] = [
  {
    id: "qwen/qwen3.8-27b-free",
    name: "Qwen 3.8 27B (free)",
    provider: "Alibaba",
    contextWindow: 131072,
    parameterCount: "27B",
    isReasoning: true,
  },
];

export function findOrcaRouterModel(id: string): OrcaRouterModelInfo | undefined {
  return ORCAROUTER_MODEL_CATALOG.find((m) => m.id === id);
}

// ── Default Model Choices ─────────────────────────────────────────────────────
// One strong id rather than an auto-router, same reasoning as the OpenRouter
// leg's pin: an auto-router picks whatever fits the request, and production
// showed that pattern selecting weak seats for Coder. A specific strong id
// means this leg only ever answers with the strong model; if it is ever
// rotated off, the call errors and the chain falls through.
export const ORCAROUTER_DISPATCHER_MODEL = "qwen/qwen3.8-27b-free";
export const ORCAROUTER_DEFAULT_MODEL = "qwen/qwen3.8-27b-free";

// ── OpenAI-compatible Chat API ────────────────────────────────────────────────

export interface OrcaRouterChatResult {
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
 * Call OrcaRouter chat completions (streaming SSE, OpenAI-compatible).
 *
 * Mirrors callOpenRouter: `stream: true`, line-by-line parse, idle watchdogs,
 * throttled `onDelta` flush for the UI's streaming view, and salvage of a
 * partial response when the stream dies mid-generation.
 *
 * Key comes from the ORCAROUTER_API_KEY env var (Convex dashboard). When it is
 * not set the leg fails fast with ORCAROUTER_NOT_CONFIGURED and the provider
 * chain moves on without a network round-trip.
 */
export async function callOrcaRouter(
  prompt: string,
  systemPrompt: string,
  model: string = ORCAROUTER_DEFAULT_MODEL,
  maxTokens: number = 32768,
  _runQuery?: ActionCtx["runQuery"],
  deadlineMs?: number,
  onDelta?: (delta: string) => Promise<void>,
): Promise<OrcaRouterChatResult> {
  const apiKey = (process.env.ORCAROUTER_API_KEY ?? "").trim();
  if (!apiKey) {
    throw new Error("ORCAROUTER_NOT_CONFIGURED: set ORCAROUTER_API_KEY in the Convex dashboard");
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
    throw new Error("OrcaRouter: no time left in chain budget");
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
      if (!firstChunkSeen && idleMs >= ORCAROUTER_FIRST_CHUNK_TIMEOUT_MS) {
        ctrl.abort();
      } else if (firstChunkSeen && idleMs >= ORCAROUTER_STREAM_IDLE_TIMEOUT_MS) {
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
      throw new Error(`OrcaRouter ${res.status}: ${typeof errObj?.message === "string" ? errObj.message : raw.slice(0, 300)}`);
    }

    if (!res.body) {
      throw new Error("OrcaRouter: response body unavailable");
    }
    // Some endpoints answer plain JSON when they cannot stream — handle that
    // instead of assuming a text/event-stream body.
    const contentType = res.headers.get("content-type") ?? "";
    if (!contentType.includes("text/event-stream")) {
      const data = tryParseJson(await res.text()) as Record<string, unknown> | null;
      if (!data) throw new Error("OrcaRouter: unexpected non-JSON response body");
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
          throw new Error(`OrcaRouter stream error: ${typeof errObj?.message === "string" ? errObj.message : payload.slice(0, 300)}`);
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
          console.warn(`OrcaRouter stream stalled after ${text.length} chars — returning the partial response instead of failing the call`);
          return {
            text,
            inputTokens: promptTokens,
            outputTokens: completionTokens,
            model: resolvedModel,
          };
        }
        throw new Error(`OrcaRouter stream stalled — no data for too long (only ${text.trim().length} chars received)`);
      }
      throw new Error("OrcaRouter request timed out before the first chunk");
    }
    throw err;
  } finally {
    clearTimeout(totalTimer);
  }
}
