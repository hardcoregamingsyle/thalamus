// Minimal browser-side reader for the SSE stream that /api/conversations/:id
// messages and /regenerate return (chat.completion.chunk events, then
// [DONE]). Deliberately small and local rather than pulling in
// @thalamus/contract's SSE parser, which is written for the gateway's own
// request/response cycle, not a browser ReadableStream consumer.
import type { ChatCompletionChunk } from "./types";

export interface StreamHandlers {
  onDelta: (text: string) => void;
  onDone?: () => void;
  onError?: (message: string) => void;
}

export async function readChatCompletionStream(
  response: Response,
  handlers: StreamHandlers,
): Promise<void> {
  if (!response.ok) {
    // Generation endpoints return a JSON error body (e.g. 503
    // {error:{code:"model_unavailable", message}}) rather than a stream —
    // surface its message so a model outage reads as a calm status, not a
    // raw HTTP failure.
    let message = `Request failed (${response.status})`;
    try {
      const body = (await response.clone().json()) as { error?: { message?: string } };
      if (body?.error?.message) message = body.error.message;
    } catch {
      // Not a JSON body — keep the generic message.
    }
    handlers.onError?.(message);
    return;
  }
  if (!response.body) {
    handlers.onError?.("Empty response body");
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
          try {
            const chunk = JSON.parse(data) as ChatCompletionChunk;
            const delta = chunk.choices[0]?.delta.content;
            if (delta) handlers.onDelta(delta);
          } catch {
            // Not a JSON data line (or a shape we don't expect) — skip it
            // rather than aborting a stream that's otherwise fine.
          }
        }
      }
    }
    handlers.onDone?.();
  } finally {
    reader.releaseLock();
  }
}
