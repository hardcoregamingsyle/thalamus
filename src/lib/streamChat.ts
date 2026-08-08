// Canonical SSE streaming helper for the /stream-chat HTTP action.
// Both Portal.tsx (desktop) and MobilePortal.tsx (mobile) call this instead of
// hand-rolling the fetch + getReader + TextDecoder + data-line parse loop.
// Callers wrap onChunk in requestAnimationFrame batching when needed; this
// helper only parses the stream and dispatches the three lifecycle callbacks.

import { convexSiteUrl } from "@/lib/convexUrls";

export interface StreamChatHandlers {
  /** Called with each cumulative answer chunk as it arrives. */
  onChunk?: (accumulated: string) => void;
  /** Called with each thinking-panel chunk (raw, not accumulated). */
  onThinking?: (chunk: string) => void;
  /** Called once when the server signals the model has started answering. */
  onAnswerStart?: () => void;
  /** Called with the server's final fullText when the `done` frame arrives. */
  onDone?: (fullText: string) => void;
}

/**
 * POST the payload to `/stream-chat` and drive the SSE parse loop until the
 * stream closes. Returns the final accumulated answer text (already the
 * `fullText` from the `done` frame if the server sent one, otherwise the sum
 * of the answer chunks).
 *
 * `siteUrl` is optional — omit it and the helper resolves the `.convex.site`
 * origin via convexSiteUrl(); pass one only when a caller already has it.
 */
export async function streamChat(
  siteUrlOrPayload: string | object,
  payloadOrHandlers?: object | StreamChatHandlers,
  handlersMaybe?: StreamChatHandlers,
): Promise<string> {
  // Overload: (payload, handlers?) or (siteUrl, payload, handlers?).
  let siteUrl: string;
  let payload: object;
  let handlers: StreamChatHandlers;
  if (typeof siteUrlOrPayload === "string") {
    siteUrl = siteUrlOrPayload;
    payload = (payloadOrHandlers ?? {}) as object;
    handlers = handlersMaybe ?? {};
  } else {
    siteUrl = convexSiteUrl();
    payload = siteUrlOrPayload;
    handlers = (payloadOrHandlers ?? {}) as StreamChatHandlers;
  }

  const response = await fetch(`${siteUrl}/stream-chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok || !response.body) throw new Error("Stream failed");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let accumulated = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const jsonStr = line.slice(6).trim();
      if (!jsonStr) continue;
      try {
        const parsed = JSON.parse(jsonStr) as { type?: string; chunk?: string; done?: boolean; fullText?: string };
        if (parsed.type === "thinking" && parsed.chunk) {
          handlers.onThinking?.(parsed.chunk);
        }
        if (parsed.type === "answer_start") {
          handlers.onAnswerStart?.();
        }
        if ((!parsed.type || parsed.type === "answer") && parsed.chunk) {
          accumulated += parsed.chunk;
          handlers.onChunk?.(accumulated);
        }
        if (parsed.done && parsed.fullText) {
          accumulated = parsed.fullText;
          handlers.onDone?.(parsed.fullText);
        }
      } catch { /* skip malformed line */ }
    }
  }
  return accumulated;
}
