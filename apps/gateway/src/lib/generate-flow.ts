// Drives one `POST /internal/v1/generate` exchange end to end: builds the
// request, relays delta text to the caller as it arrives, and — regardless
// of how the caller consumes it (SSE relay or a buffered non-stream
// response) — commits the session, emits exactly one usage event and
// releases the user lease exactly once, via the `finally` block below. That
// block also runs if the caller abandons the generator early (`gen.return()`
// from a client-disconnect handler), which is how "client_closed" is
// produced (docs/architecture.md §5-§6).

import { eq } from "drizzle-orm";
import {
  parseSseStream,
  MODEL_SERVER_ERROR_HTTP_MAP,
  type ApiErrorBody,
  type ChatMessage,
  type GenerateDeltaEvent,
  type GenerateDoneEvent,
  type GenerateRequest,
  type ModelServerErrorCode,
} from "@thalamus/contract";
import { releaseLease, sessions } from "@thalamus/db";
import type { AppDeps } from "../types.js";
import { toModelServerMessages } from "./messages.js";
import { commitTurn, type ResolveSessionResult } from "./sessions.js";

export interface GenerateFinal {
  status: "ok" | "error" | "client_closed";
  sessionId: string;
  charsIn: number;
  charsOut: number;
  /** Present only when status is "error": the response to send the caller. */
  error?: { status: number; body: ApiErrorBody };
}

export interface RunGenerateFlowParams {
  deps: AppDeps;
  accountId: string;
  userKey: string;
  model: string;
  requestId: string;
  source: "api" | "chat";
  /** The full client-visible transcript, needed only to fall back to a
   * brand-new session on UNKNOWN_SESSION/SESSION_INCOMPATIBLE in
   * full-history (hash-matching) mode. Empty for explicit session_id mode. */
  originalMessages: ChatMessage[];
  /** True when the caller used an explicit session_id: the gateway cannot
   * fall back to a new session (it only has the new turns, not the full
   * history the model server would need), so a lost/incompatible session is
   * a client-facing error instead. */
  isExplicitSession: boolean;
  session: Extract<ResolveSessionResult, { kind: "ok" }>;
  maxOutputChars?: number;
  now: Date;
}

export type DeltaYield = { type: "delta"; text: string };

function apiErrorBody(code: string, message: string): ApiErrorBody {
  return { error: { message, type: "api_error", code } };
}

function modelServerErrorResponse(
  code: ModelServerErrorCode,
  message: string,
): {
  status: number;
  body: ApiErrorBody;
} {
  const mapping = MODEL_SERVER_ERROR_HTTP_MAP[code];
  return { status: mapping.status, body: apiErrorBody(code.toLowerCase(), message || code) };
}

interface ParsedEvent {
  kind: "delta" | "done" | "error" | "already_committed";
  text?: string;
  charsIn?: number;
  charsOut?: number;
  code?: ModelServerErrorCode;
  message?: string;
}

async function* parseModelServerEvents(response: Response): AsyncGenerator<ParsedEvent> {
  if (!response.body) return;
  for await (const raw of parseSseStream(response.body)) {
    if (raw.event === "delta") {
      const data = JSON.parse(raw.data) as GenerateDeltaEvent;
      yield { kind: "delta", text: data.text };
    } else if (raw.event === "done") {
      const data = JSON.parse(raw.data) as GenerateDoneEvent;
      yield { kind: "done", charsIn: data.chars_in, charsOut: data.chars_out };
    } else if (raw.event === "error") {
      const data = JSON.parse(raw.data) as {
        code: ModelServerErrorCode;
        message?: string;
        text?: string;
        chars_in?: number;
        chars_out?: number;
      };
      if (data.code === "ALREADY_COMMITTED") {
        yield {
          kind: "already_committed",
          text: data.text ?? "",
          charsIn: data.chars_in ?? 0,
          charsOut: data.chars_out ?? 0,
        };
      } else {
        yield { kind: "error", code: data.code, message: data.message ?? "" };
      }
    }
  }
}

export async function* runGenerateFlow(
  params: RunGenerateFlowParams,
): AsyncGenerator<DeltaYield, GenerateFinal, void> {
  const { deps } = params;
  let replyText = "";
  let final: GenerateFinal | null = null;
  let committed = false;
  let sessionId = params.session.sessionId;
  let isNew = params.session.isNew;
  const regenerate = params.session.regenerate;
  let existing = params.session.existing;
  let sentMessages = params.session.messagesToSend;

  function buildRequest(): GenerateRequest {
    return {
      request_id: params.requestId,
      model: params.model,
      user_key: params.userKey,
      session_id: sessionId,
      new_session: isNew,
      regenerate,
      messages: toModelServerMessages(sentMessages),
      max_output_chars: params.maxOutputChars ?? 16000,
      resume_token: null,
    };
  }

  try {
    let response = await deps.modelServer.generate(buildRequest());
    if (!response.ok || !response.body) {
      final = {
        status: "error",
        sessionId,
        charsIn: 0,
        charsOut: 0,
        error: {
          status: 503,
          body: apiErrorBody("upstream_unavailable", "model server unavailable"),
        },
      };
      return final;
    }

    let deltasSeen = 0;
    let retried = false;
    let iterator = parseModelServerEvents(response)[Symbol.asyncIterator]();

    for (;;) {
      const { value: event, done } = await iterator.next();
      if (done) {
        if (!final) {
          final = {
            status: "error",
            sessionId,
            charsIn: 0,
            charsOut: 0,
            error: {
              status: 500,
              body: apiErrorBody("internal_error", "model server stream ended unexpectedly"),
            },
          };
        }
        return final;
      }

      if (event.kind === "delta") {
        deltasSeen++;
        replyText += event.text ?? "";
        yield { type: "delta", text: event.text ?? "" };
        continue;
      }

      if (event.kind === "done") {
        final = {
          status: "ok",
          sessionId,
          charsIn: event.charsIn ?? 0,
          charsOut: event.charsOut ?? 0,
        };
        return final;
      }

      if (event.kind === "already_committed") {
        replyText = event.text ?? "";
        yield { type: "delta", text: replyText };
        final = {
          status: "ok",
          sessionId,
          charsIn: event.charsIn ?? 0,
          charsOut: event.charsOut ?? 0,
        };
        return final;
      }

      // event.kind === "error"
      const code = event.code as ModelServerErrorCode;

      if (code === "MEMORY_LOAD_FAILED" && !retried && deltasSeen === 0) {
        retried = true;
        response = await deps.modelServer.generate(buildRequest());
        if (!response.ok || !response.body) {
          final = {
            status: "error",
            sessionId,
            charsIn: 0,
            charsOut: 0,
            error: {
              status: 503,
              body: apiErrorBody("upstream_unavailable", "model server unavailable"),
            },
          };
          return final;
        }
        iterator = parseModelServerEvents(response)[Symbol.asyncIterator]();
        continue;
      }

      if ((code === "UNKNOWN_SESSION" || code === "SESSION_INCOMPATIBLE") && deltasSeen === 0) {
        // The session the gateway believed was current is gone or was made
        // by another model version. Best-effort mark it ended so nothing
        // else tries to reuse it.
        await deps.db
          .update(sessions)
          .set({ endedAt: params.now })
          .where(eq(sessions.id, sessionId));

        if (params.isExplicitSession) {
          final = {
            status: "error",
            sessionId,
            charsIn: 0,
            charsOut: 0,
            error: {
              status: 400,
              body: apiErrorBody(
                "invalid_request",
                "session is no longer available; retry without session_id to start a new one",
              ),
            },
          };
          return final;
        }

        // Full-history mode: the client's full transcript is available, so
        // start over with a brand-new session (docs/architecture.md §6,
        // "no match" case), retried at most once.
        if (retried) {
          final = {
            status: "error",
            sessionId,
            charsIn: 0,
            charsOut: 0,
            error: {
              status: 500,
              body: apiErrorBody(
                "internal_error",
                "could not establish a session with the model server",
              ),
            },
          };
          return final;
        }
        retried = true;
        sessionId = crypto.randomUUID();
        isNew = true;
        existing = null;
        sentMessages = params.originalMessages;
        response = await deps.modelServer.generate(buildRequest());
        if (!response.ok || !response.body) {
          final = {
            status: "error",
            sessionId,
            charsIn: 0,
            charsOut: 0,
            error: {
              status: 503,
              body: apiErrorBody("upstream_unavailable", "model server unavailable"),
            },
          };
          return final;
        }
        iterator = parseModelServerEvents(response)[Symbol.asyncIterator]();
        continue;
      }

      const mapped = modelServerErrorResponse(code, event.message ?? "");
      final = { status: "error", sessionId, charsIn: 0, charsOut: 0, error: mapped };
      return final;
    }
  } finally {
    const status = final?.status ?? "client_closed";
    if (final?.status === "ok" && !committed) {
      await commitTurn(deps.db, {
        accountId: params.accountId,
        userKey: params.userKey,
        model: params.model,
        sessionId,
        isNew,
        regenerate,
        existing,
        sentMessages,
        replyText,
        source: params.source,
        now: params.now,
      });
      committed = true;
    }
    const finishedAt = deps.clock.now();
    await deps.usageSink.send({
      requestId: params.requestId,
      accountId: params.accountId,
      model: params.model,
      charsIn: final?.charsIn ?? 0,
      charsOut: final?.charsOut ?? 0,
      durationMs: Math.max(0, finishedAt.getTime() - params.now.getTime()),
      status,
      occurredAtMs: finishedAt.getTime(),
    });
    await releaseLease(deps.db, { userKey: params.userKey, requestId: params.requestId });
  }
}

/** Fully drives a `runGenerateFlow` generator, buffering its deltas via `onDelta`. */
export async function drainToCompletion(
  gen: AsyncGenerator<DeltaYield, GenerateFinal, void>,
  onDelta: (text: string) => void,
): Promise<GenerateFinal> {
  for (;;) {
    const { value, done } = await gen.next();
    if (done) return value;
    onDelta(value.text);
  }
}
