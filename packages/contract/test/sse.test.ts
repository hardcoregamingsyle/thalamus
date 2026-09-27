import { describe, expect, test } from "bun:test";
import {
  encodeOpenAiChunk,
  encodeSseEvent,
  encodeSseJson,
  OPENAI_SSE_DONE,
  parseSseText,
  SseStreamParser,
} from "../src/sse.js";

describe("SSE encode/parse round trip", () => {
  test("encodes and parses a single named JSON event", () => {
    const encoded = encodeSseJson("delta", { text: "hi" });
    const events = parseSseText(encoded);
    expect(events).toEqual([{ event: "delta", data: JSON.stringify({ text: "hi" }) }]);
  });

  test("round-trips the full model-server stream shape", () => {
    const deltas = ["echo", ": hello"].map((text) => encodeSseJson("delta", { text }));
    const done = encodeSseJson("done", {
      finish_reason: "stop",
      chars_in: 5,
      chars_out: 7,
      user_file_bytes: 0,
      session_file_bytes: 0,
    });
    const events = parseSseText(deltas.join("") + done);
    expect(events).toHaveLength(3);
    expect(events[0]).toEqual({ event: "delta", data: JSON.stringify({ text: "echo" }) });
    expect(events[1]).toEqual({ event: "delta", data: JSON.stringify({ text: ": hello" }) });
    expect(events[2]?.event).toBe("done");
    expect(JSON.parse(events[2]!.data)).toEqual({
      finish_reason: "stop",
      chars_in: 5,
      chars_out: 7,
      user_file_bytes: 0,
      session_file_bytes: 0,
    });
  });

  test("defaults to the 'message' event when none is given", () => {
    const events = parseSseText(encodeSseEvent(undefined, "plain"));
    expect(events).toEqual([{ event: "message", data: "plain" }]);
  });

  test("handles a payload split across arbitrary chunk boundaries", () => {
    const full = encodeSseJson("delta", { text: "chunked" }) + encodeSseJson("done", { n: 1 });
    const parser = new SseStreamParser();
    const collected: { event: string; data: string }[] = [];
    // Split at every 7th character to simulate network fragmentation.
    for (let i = 0; i < full.length; i += 7) {
      collected.push(...parser.push(full.slice(i, i + 7)));
    }
    expect(collected).toHaveLength(2);
    expect(collected[0]).toEqual({ event: "delta", data: JSON.stringify({ text: "chunked" }) });
    expect(collected[1]).toEqual({ event: "done", data: JSON.stringify({ n: 1 }) });
  });

  test("joins multiple data: lines with a newline, per the SSE spec", () => {
    const events = parseSseText("event: multi\ndata: line one\ndata: line two\n\n");
    expect(events).toEqual([{ event: "multi", data: "line one\nline two" }]);
  });

  test("encodes an OpenAI-compatible chunk stream ending in [DONE]", () => {
    const chunk = { id: "1", object: "chat.completion.chunk" as const };
    const stream = encodeOpenAiChunk(chunk) + OPENAI_SSE_DONE;
    expect(stream.startsWith(`data: ${JSON.stringify(chunk)}`)).toBe(true);
    expect(stream.endsWith(OPENAI_SSE_DONE)).toBe(true);
  });
});
