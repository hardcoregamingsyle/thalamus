import { describe, expect, test } from "bun:test";
import { readChatCompletionStream } from "../src/lib/sse-client.js";

function sseResponse(events: string[]): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const event of events) controller.enqueue(encoder.encode(event));
      controller.close();
    },
  });
  return new Response(stream, { status: 200 });
}

describe("readChatCompletionStream", () => {
  test("forwards delta text from chat.completion.chunk events, then signals done", async () => {
    const chunk = (content: string) => ({
      id: "1",
      object: "chat.completion.chunk",
      created: 0,
      model: "thalamus-sophon-1.0",
      choices: [{ index: 0, delta: { content }, finish_reason: null }],
    });
    const response = sseResponse([
      `data: ${JSON.stringify(chunk("Hel"))}\n\n`,
      `data: ${JSON.stringify(chunk("lo"))}\n\n`,
      `data: [DONE]\n\n`,
    ]);

    const deltas: string[] = [];
    let done = false;
    await readChatCompletionStream(response, {
      onDelta: (text) => deltas.push(text),
      onDone: () => {
        done = true;
      },
    });

    expect(deltas.join("")).toBe("Hello");
    expect(done).toBe(true);
  });

  test("surfaces the error body's message on a non-ok JSON response (e.g. 503 model_unavailable)", async () => {
    const response = new Response(
      JSON.stringify({
        error: { code: "model_unavailable", message: "The model is warming up." },
      }),
      { status: 503 },
    );

    const errors: string[] = [];
    await readChatCompletionStream(response, {
      onDelta: () => {},
      onError: (info) => errors.push(info.message),
    });

    expect(errors).toEqual(["The model is warming up."]);
  });

  test("falls back to a generic message when a non-ok response isn't JSON", async () => {
    const response = new Response("Service Unavailable", { status: 503 });

    const errors: string[] = [];
    await readChatCompletionStream(response, {
      onDelta: () => {},
      onError: (info) => errors.push(info.message),
    });

    expect(errors).toEqual(["Request failed (503)"]);
  });

  test("calls onError when an ok response has no body", async () => {
    const response = new Response(null, { status: 200 });
    const errors: string[] = [];
    await readChatCompletionStream(response, {
      onDelta: () => {},
      onError: (info) => errors.push(info.message),
    });
    expect(errors).toEqual(["Empty response body"]);
  });
});
