// A full, deterministic implementation of docs/model-server.md, usable
// in-process (for gateway tests) or as a standalone CLI (src/cli.ts).
//
// Output is deterministic: the reply is always `echo: <last user text>`,
// streamed as several delta events. Tests control timing and failure paths
// through options and the `X-Mock-*` headers documented below — neither is
// part of the real model-server contract, which this mock otherwise follows
// exactly.

import {
  createInMemoryNonceStore,
  encodeSseJson,
  verifySignature,
  type GenerateDoneEvent,
  type GenerateRequest,
  type ModelServerErrorCode,
  type ModelServerMessage,
  type NonceStore,
} from "@thalamus/contract";

export interface StoredSession {
  sessionId: string;
  userKey: string;
  model: string;
  transcript: ModelServerMessage[];
  lastCommittedRequestId: string | null;
  lastCommittedText: string | null;
  lastCommittedCharsIn: number;
  lastCommittedCharsOut: number;
  /** Bytes counted toward `sessionFileCapBytes`. */
  bytes: number;
  ended: boolean;
}

export interface StoredUser {
  userKey: string;
  /** Bytes counted toward `userFileCapBytes`. */
  bytes: number;
  sessionIds: Set<string>;
  warmedAt: number | null;
  deleted: boolean;
}

export interface MockModelServerState {
  sessions: Map<string, StoredSession>;
  users: Map<string, StoredUser>;
}

export interface MockModelServerOptions {
  secret: string;
  nonceStore?: NonceStore;
  /** Delay before each delta event, in milliseconds. Defaults to 0. */
  perDeltaDelayMs?: number;
  /** Defaults to the real 64 MiB limit; tests pass a tiny value instead. */
  userFileCapBytes?: number;
  /** Defaults to the real 8 MiB limit; tests pass a tiny value instead. */
  sessionFileCapBytes?: number;
}

export interface MockModelServer {
  fetch(request: Request): Promise<Response>;
  state: MockModelServerState;
}

const DEFAULT_USER_FILE_CAP_BYTES = 64 * 1024 * 1024;
const DEFAULT_SESSION_FILE_CAP_BYTES = 8 * 1024 * 1024;

/** `X-Mock-Inject-Failure: before_done` or `after:<N delta events>`. */
const FAILURE_HEADER = "x-mock-inject-failure";
/** Optional error code to use with the header above; defaults to INTERNAL_ERROR. */
const FAILURE_CODE_HEADER = "x-mock-inject-failure-code";

function chunkText(text: string, size = 5): string[] {
  if (text.length === 0) return [""];
  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += size) {
    chunks.push(text.slice(i, i + size));
  }
  return chunks;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function sleep(ms: number): Promise<void> {
  return ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();
}

export function createMockModelServer(options: MockModelServerOptions): MockModelServer {
  const nonceStore = options.nonceStore ?? createInMemoryNonceStore();
  const perDeltaDelayMs = options.perDeltaDelayMs ?? 0;
  const userFileCapBytes = options.userFileCapBytes ?? DEFAULT_USER_FILE_CAP_BYTES;
  const sessionFileCapBytes = options.sessionFileCapBytes ?? DEFAULT_SESSION_FILE_CAP_BYTES;

  const state: MockModelServerState = {
    sessions: new Map(),
    users: new Map(),
  };

  function getOrCreateUser(userKey: string): StoredUser {
    let user = state.users.get(userKey);
    if (!user) {
      user = { userKey, bytes: 0, sessionIds: new Set(), warmedAt: null, deleted: false };
      state.users.set(userKey, user);
    }
    user.deleted = false;
    return user;
  }

  function lastUserText(transcript: ModelServerMessage[]): string {
    for (let i = transcript.length - 1; i >= 0; i--) {
      const message = transcript[i];
      if (message && message.role === "user") return message.content;
    }
    return "";
  }

  async function verifyOrRespond(request: Request, body: string): Promise<Response | null> {
    const header = request.headers.get("x-thalamus-signature");
    const result = await verifySignature({ header, body, secret: options.secret, nonceStore });
    if (result.ok) return null;
    return jsonResponse({ error: { code: "invalid_signature", reason: result.reason } }, 401);
  }

  async function handleGenerate(request: Request, body: string): Promise<Response> {
    const authFailure = await verifyOrRespond(request, body);
    if (authFailure) return authFailure;

    const payload = JSON.parse(body) as GenerateRequest;
    const existing = state.sessions.get(payload.session_id);

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const encoder = new TextEncoder();
        const emit = (event: string, data: unknown) => {
          controller.enqueue(encoder.encode(encodeSseJson(event, data)));
        };

        // The commit rule: a repeat of an already-committed request_id
        // returns the stored reply, per docs/model-server.md.
        if (existing && existing.lastCommittedRequestId === payload.request_id) {
          emit("error", {
            code: "ALREADY_COMMITTED",
            message: existing.lastCommittedText ?? "",
            text: existing.lastCommittedText ?? "",
            chars_in: existing.lastCommittedCharsIn,
            chars_out: existing.lastCommittedCharsOut,
          });
          controller.close();
          return;
        }

        let session = existing;

        if (payload.new_session) {
          session = {
            sessionId: payload.session_id,
            userKey: payload.user_key,
            model: payload.model,
            transcript: [...payload.messages],
            lastCommittedRequestId: null,
            lastCommittedText: null,
            lastCommittedCharsIn: 0,
            lastCommittedCharsOut: 0,
            bytes: 0,
            ended: false,
          };
        } else {
          if (!session) {
            const code: ModelServerErrorCode = "UNKNOWN_SESSION";
            emit("error", { code, message: "no session with this id" });
            controller.close();
            return;
          }
          if (session.model !== payload.model) {
            const code: ModelServerErrorCode = "SESSION_INCOMPATIBLE";
            emit("error", { code, message: "session was made by another model version" });
            controller.close();
            return;
          }
          if (payload.regenerate) {
            const last = session.transcript[session.transcript.length - 1];
            if (last && last.role === "assistant") session.transcript.pop();
          } else {
            session.transcript.push(...payload.messages);
          }
        }

        const activeSession = session;
        const replyText = `echo: ${lastUserText(activeSession.transcript)}`;
        const charsIn = payload.messages.reduce((sum, m) => sum + m.content.length, 0);
        const charsOut = replyText.length;

        const user = getOrCreateUser(payload.user_key);
        const projectedUserBytes = user.bytes + charsIn + charsOut;
        const projectedSessionBytes = activeSession.bytes + charsIn + charsOut;
        if (projectedUserBytes > userFileCapBytes || projectedSessionBytes > sessionFileCapBytes) {
          const code: ModelServerErrorCode = "FILE_CAP_REACHED";
          emit("error", { code, message: "memory cap reached" });
          controller.close();
          return;
        }

        const failureSpec = request.headers.get(FAILURE_HEADER);
        const failureCode = (request.headers.get(FAILURE_CODE_HEADER) ??
          "INTERNAL_ERROR") as ModelServerErrorCode;
        const failAfterDeltas =
          failureSpec === "before_done"
            ? 0
            : failureSpec?.startsWith("after:")
              ? Number(failureSpec.slice("after:".length))
              : null;

        const chunks = chunkText(replyText);
        for (let i = 0; i < chunks.length; i++) {
          if (failAfterDeltas !== null && i >= failAfterDeltas) {
            emit("error", { code: failureCode, message: "injected failure" });
            controller.close();
            return;
          }
          await sleep(perDeltaDelayMs);
          emit("delta", { text: chunks[i] });
        }

        // Commit: the session is saved only now that `done` is about to be sent.
        activeSession.transcript.push({ role: "assistant", content: replyText });
        activeSession.lastCommittedRequestId = payload.request_id;
        activeSession.lastCommittedText = replyText;
        activeSession.lastCommittedCharsIn = charsIn;
        activeSession.lastCommittedCharsOut = charsOut;
        activeSession.bytes = projectedSessionBytes;
        user.bytes = projectedUserBytes;
        user.sessionIds.add(activeSession.sessionId);
        state.sessions.set(activeSession.sessionId, activeSession);

        const done: GenerateDoneEvent = {
          finish_reason: "stop",
          chars_in: charsIn,
          chars_out: charsOut,
          user_file_bytes: user.bytes,
          session_file_bytes: activeSession.bytes,
        };
        emit("done", done);
        controller.close();
      },
    });

    return new Response(stream, {
      headers: { "content-type": "text/event-stream" },
    });
  }

  async function handleSessionEnd(
    request: Request,
    body: string,
    sessionId: string,
  ): Promise<Response> {
    const authFailure = await verifyOrRespond(request, body);
    if (authFailure) return authFailure;

    const session = state.sessions.get(sessionId);
    if (!session) return jsonResponse({ error: { code: "UNKNOWN_SESSION" } }, 404);

    session.ended = true;
    return jsonResponse({ ok: true });
  }

  async function handleWarm(request: Request, body: string): Promise<Response> {
    const authFailure = await verifyOrRespond(request, body);
    if (authFailure) return authFailure;

    const { user_key: userKey } = JSON.parse(body) as { user_key: string };
    const user = getOrCreateUser(userKey);
    user.warmedAt = Date.now();
    return jsonResponse({ ok: true });
  }

  async function handleDeleteUser(
    request: Request,
    body: string,
    userKey: string,
  ): Promise<Response> {
    const authFailure = await verifyOrRespond(request, body);
    if (authFailure) return authFailure;

    const user = state.users.get(userKey);
    if (user) {
      for (const sessionId of user.sessionIds) state.sessions.delete(sessionId);
      state.users.delete(userKey);
    }
    return jsonResponse({ ok: true });
  }

  async function handleHealthz(request: Request, body: string): Promise<Response> {
    const authFailure = await verifyOrRespond(request, body);
    if (authFailure) return authFailure;
    return jsonResponse({ ok: true });
  }

  return {
    state,
    async fetch(request: Request): Promise<Response> {
      const url = new URL(request.url);
      const body = await request.text();

      if (request.method === "POST" && url.pathname === "/internal/v1/generate") {
        return handleGenerate(request, body);
      }

      const endMatch = /^\/internal\/v1\/sessions\/([^/]+)\/end$/.exec(url.pathname);
      if (request.method === "POST" && endMatch) {
        return handleSessionEnd(request, body, decodeURIComponent(endMatch[1] as string));
      }

      if (request.method === "POST" && url.pathname === "/internal/v1/warm") {
        return handleWarm(request, body);
      }

      const userMatch = /^\/internal\/v1\/users\/([^/]+)$/.exec(url.pathname);
      if (request.method === "DELETE" && userMatch) {
        return handleDeleteUser(request, body, decodeURIComponent(userMatch[1] as string));
      }

      if (request.method === "GET" && url.pathname === "/internal/healthz") {
        return handleHealthz(request, body);
      }

      return jsonResponse({ error: { code: "not_found" } }, 404);
    },
  };
}
