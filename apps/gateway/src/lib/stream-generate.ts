// Shared SSE relay for a runGenerateFlow instance: role-priming chunk, one
// `chat.completion.chunk` per delta, a final chunk carrying `usage`, then
// [DONE] — or, on an error the client hasn't started receiving content for
// yet, an in-band `{"error": ...}` object before [DONE] (the HTTP status is
// already committed to 200 once a stream response is returned, so a
// mid-stream error cannot be reported as a different status code). Used by
// both /v1/chat/completions and the chat app's own message/regenerate routes.

import { encodeOpenAiChunk, encodeSseJson, OPENAI_SSE_DONE } from "@thalamus/contract";
import {
  runGenerateFlow,
  type GenerateFinal,
  type RunGenerateFlowParams,
} from "./generate-flow.js";
import { buildContentChunk, buildFinalChunk, buildUsage } from "./openai-response.js";
import { SESSION_ID_HEADER } from "./constants.js";

export interface StreamGenerateOptions {
  flowParams: RunGenerateFlowParams;
  id: string;
  model: string;
  created: number;
  /** Called exactly once, after the exchange settles (success or error). */
  onSettled?: (final: GenerateFinal, replyText: string) => Promise<void> | void;
}

export function streamGenerateFlow(options: StreamGenerateOptions): Response {
  const { flowParams, id, model, created } = options;
  const encoder = new TextEncoder();
  const gen = runGenerateFlow(flowParams);
  // Reflects the session resolved *before* calling the model server: headers
  // are sent immediately, so a rare mid-flow fallback to a new session
  // (generate-flow.ts) cannot retroactively change it.
  const sessionId = flowParams.session.sessionId;
  let replyText = "";

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      controller.enqueue(
        encoder.encode(
          encodeOpenAiChunk({
            id,
            object: "chat.completion.chunk",
            created,
            model,
            choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }],
          }),
        ),
      );
    },
    async pull(controller) {
      const { value, done } = await gen.next();
      if (done) {
        const final = value;
        if (final.status === "error" && final.error) {
          controller.enqueue(
            encoder.encode(encodeSseJson(undefined, { error: final.error.body.error })),
          );
        } else {
          controller.enqueue(
            encoder.encode(
              encodeOpenAiChunk(
                buildFinalChunk(id, model, created, buildUsage(final.charsIn, final.charsOut)),
              ),
            ),
          );
        }
        controller.enqueue(encoder.encode(OPENAI_SSE_DONE));
        controller.close();
        await options.onSettled?.(final, replyText);
        return;
      }
      replyText += value.text;
      controller.enqueue(
        encoder.encode(encodeOpenAiChunk(buildContentChunk(id, model, created, value.text))),
      );
    },
    async cancel() {
      // The placeholder value below is ignored by runGenerateFlow: its own
      // `finally` block (which this triggers) always resolves the outcome
      // to "client_closed" when it wasn't reached via a normal done/error
      // event, and that same placeholder shape is what propagates back out
      // of `.return()` since nothing downstream replaces it.
      const outcome: GenerateFinal = {
        status: "client_closed",
        sessionId,
        charsIn: 0,
        charsOut: 0,
      };
      await gen.return(outcome);
      await options.onSettled?.(outcome, replyText);
    },
  });

  return new Response(stream, {
    status: 200,
    headers: { "content-type": "text/event-stream", [SESSION_ID_HEADER]: sessionId },
  });
}
