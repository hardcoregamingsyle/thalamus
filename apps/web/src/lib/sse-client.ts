// Minimal browser-side reader for the SSE stream that /api/conversations/:id
// messages and /regenerate return (chat.completion.chunk events, then
// [DONE]). Deliberately small and local rather than pulling in
// @thalamus/contract's SSE parser, which is written for the gateway's own
// request/response cycle, not a browser ReadableStream consumer.
import type { ChatCompletionChunk } from "./types";

/** The gateway's two error envelopes: `apiError()` sends `{error: string}`;
 * `modelUnavailableBody()` (and a mid-stream error frame) send
 * `{error: {message, code}}`. Callers only ever see this normalized shape. */
export interface StreamErrorInfo {
  message: string;
  code?: string;
  /**
   * "request": the gateway rejected the call before returning a stream
   * (model_unavailable, rate_limited, lease_held, …) — conversations.ts
   * runs those checks *before* it inserts the user's message, so nothing
   * was saved and the same request can be retried verbatim.
   * "stream": the HTTP response was already a 200 stream (the user message
   * was saved) and the failure arrived as an in-band `{"error": ...}`
   * frame instead — retrying a `message` send as-is would duplicate that
   * saved message, so the caller should retry as a `regenerate` instead.
   */
  stage: "request" | "stream";
}

export interface StreamHandlers {
  onDelta: (text: string) => void;
  onDone?: () => void;
  /** The read was aborted (the Stop button's AbortController) — not an error. */
  onAbort?: () => void;
  onError?: (info: StreamErrorInfo) => void;
}

function isAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === "AbortError";
}

async function readErrorBody(response: Response, fallback: string): Promise<StreamErrorInfo> {
  try {
    const body = (await response.clone().json()) as { error?: unknown };
    const err = body?.error;
    if (typeof err === "string") return { message: err, stage: "request" };
    if (err && typeof err === "object") {
      const { message, code } = err as { message?: unknown; code?: unknown };
      if (typeof message === "string") {
        return { message, code: typeof code === "string" ? code : undefined, stage: "request" };
      }
    }
  } catch {
    // Not a JSON body — keep the fallback message.
  }
  return { message: fallback, stage: "request" };
}

export async function readChatCompletionStream(
  response: Response,
  handlers: StreamHandlers,
): Promise<void> {
  if (!response.ok) {
    // Generation endpoints return a JSON error body (e.g. 503
    // {error:{code:"model_unavailable", message}}, or a plain
    // {error:"rate limit exceeded"}) rather than a stream when they reject
    // the request before ever calling the model — surface it as a status,
    // not a raw HTTP failure.
    handlers.onError?.(await readErrorBody(response, `Request failed (${response.status})`));
    return;
  }
  if (!response.body) {
    handlers.onError?.({ message: "Empty response body", stage: "request" });
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let boundary: number;
      while ((boundary = buffer.indexOf("\n\n")) !== -1) {
        const block = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);

        for (const line of block.split("\n")) {
          if (!line.startsWith("data:")) continue;
          const data = line.slice("data:".length).replace(/^ /, "");
          if (data === "[DONE]") {
            handlers.onDone?.();
            return;
          }

          let parsed: unknown;
          try {
            parsed = JSON.parse(data);
          } catch {
            // Not a JSON data line — skip it rather than aborting a stream
            // that's otherwise fine.
            continue;
          }

          // A mid-stream failure (generate-flow.ts) is relayed as an in-band
          // `{"error": {...}}` object — the HTTP status is already committed
          // to 200 by the time this can happen, so it can't be a different
          // status code. It is *not* shaped like a chat.completion.chunk.
          const errorField = (parsed as { error?: unknown }).error;
          if (errorField && typeof errorField === "object") {
            const { message, code } = errorField as { message?: unknown; code?: unknown };
            handlers.onError?.({
              message: typeof message === "string" ? message : "Something went wrong.",
              code: typeof code === "string" ? code : undefined,
              stage: "stream",
            });
            return;
          }

          const chunk = parsed as ChatCompletionChunk;
          const delta = chunk.choices?.[0]?.delta?.content;
          if (delta) handlers.onDelta(delta);
        }
      }
    }
    handlers.onDone?.();
  } catch (err) {
    if (isAbortError(err)) {
      handlers.onAbort?.();
    } else {
      handlers.onError?.({ message: "Connection lost while streaming.", stage: "stream" });
    }
  } finally {
    reader.releaseLock();
  }
}
