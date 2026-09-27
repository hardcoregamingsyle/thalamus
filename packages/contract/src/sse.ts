// Server-Sent Events encode/parse helpers shared by the gateway (relaying
// the model server's stream, and emitting OpenAI-shaped chunks to clients)
// and the mock model server (emitting the docs/model-server.md stream).

export interface SseEvent {
  /** Defaults to "message" per the SSE spec when no `event:` line is sent. */
  event: string;
  data: string;
}

/** Encodes one named SSE event with a raw string payload. */
export function encodeSseEvent(event: string | undefined, data: string): string {
  const eventLine = event ? `event: ${event}\n` : "";
  const dataLines = data
    .split("\n")
    .map((line) => `data: ${line}`)
    .join("\n");
  return `${eventLine}${dataLines}\n\n`;
}

/** Encodes one named SSE event with a JSON-serialized payload. */
export function encodeSseJson(event: string | undefined, data: unknown): string {
  return encodeSseEvent(event, JSON.stringify(data));
}

/** The OpenAI streaming convention: an unnamed event carrying one JSON chunk. */
export function encodeOpenAiChunk(chunk: unknown): string {
  return encodeSseJson(undefined, chunk);
}

/** The sentinel that ends an OpenAI-compatible stream. */
export const OPENAI_SSE_DONE = "data: [DONE]\n\n";

function parseSseBlock(raw: string): SseEvent | null {
  let event = "message";
  const dataLines: string[] = [];
  for (const line of raw.split("\n")) {
    if (line.startsWith("event:")) {
      event = line.slice("event:".length).replace(/^ /, "");
    } else if (line.startsWith("data:")) {
      dataLines.push(line.slice("data:".length).replace(/^ /, ""));
    }
    // Other field names (id:, retry:, comments starting with ':') are not
    // used by this contract and are ignored.
  }
  if (dataLines.length === 0) return null;
  return { event, data: dataLines.join("\n") };
}

/**
 * Incremental SSE parser: feed it text chunks as they arrive over the wire
 * (which may split a single event across calls, or bundle several) and get
 * back the complete events each push yields.
 */
export class SseStreamParser {
  private buffer = "";

  push(chunk: string): SseEvent[] {
    this.buffer += chunk;
    const events: SseEvent[] = [];
    let boundary: number;
    // Event blocks are separated by a blank line; tolerate either the plain
    // "\n\n" line ending or a stray "\r\n\r\n".
    while ((boundary = this.buffer.search(/\n\r?\n/)) !== -1) {
      const raw = this.buffer.slice(0, boundary);
      const match = /\n\r?\n/.exec(this.buffer.slice(boundary))!;
      this.buffer = this.buffer.slice(boundary + match[0].length);
      const parsed = parseSseBlock(raw);
      if (parsed) events.push(parsed);
    }
    return events;
  }
}

/** Parses a full SSE payload at once (tests, or already-buffered bodies). */
export function parseSseText(text: string): SseEvent[] {
  const parser = new SseStreamParser();
  // Ensure a trailing boundary so a final event without a trailing blank
  // line is still flushed.
  return parser.push(text.endsWith("\n\n") ? text : `${text}\n\n`);
}

/** Parses a `ReadableStream<Uint8Array>` (e.g. a fetch response body) as SSE. */
export async function* parseSseStream(
  stream: ReadableStream<Uint8Array>,
): AsyncGenerator<SseEvent, void, void> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  const parser = new SseStreamParser();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      for (const event of parser.push(decoder.decode(value, { stream: true }))) {
        yield event;
      }
    }
  } finally {
    reader.releaseLock();
  }
}
