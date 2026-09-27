import { describe, expect, test } from "bun:test";
import { signRequest, parseSseText, type GenerateRequest } from "@thalamus/contract";
import { createMockModelServer } from "../src/server.js";

const SECRET = "test-secret";

async function signedRequest(
  method: string,
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<Request> {
  const bodyText = body === undefined ? "" : JSON.stringify(body);
  const signature = await signRequest({ secret: SECRET, body: bodyText });
  return new Request(`http://mock${path}`, {
    method,
    headers: { "x-thalamus-signature": signature, ...headers },
    body: bodyText === "" ? undefined : bodyText,
  });
}

function baseGenerateRequest(overrides: Partial<GenerateRequest> = {}): GenerateRequest {
  return {
    request_id: crypto.randomUUID(),
    model: "thalamus-sophon-1.0",
    user_key: "user-key-1",
    session_id: crypto.randomUUID(),
    new_session: true,
    regenerate: false,
    messages: [{ role: "user", content: "hello there" }],
    max_output_chars: 16000,
    resume_token: null,
    ...overrides,
  };
}

async function collectSse(response: Response): Promise<{ event: string; data: string }[]> {
  const text = await response.text();
  return parseSseText(text);
}

describe("mock model server", () => {
  test("rejects a request with no signature", async () => {
    const server = createMockModelServer({ secret: SECRET });
    const response = await server.fetch(
      new Request("http://mock/internal/healthz", { method: "GET" }),
    );
    expect(response.status).toBe(401);
  });

  test("healthz", async () => {
    const server = createMockModelServer({ secret: SECRET });
    const response = await server.fetch(await signedRequest("GET", "/internal/healthz", undefined));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
  });

  test("generate streams a deterministic echo and commits on done", async () => {
    const server = createMockModelServer({ secret: SECRET });
    const req = baseGenerateRequest({ messages: [{ role: "user", content: "hello world" }] });
    const response = await server.fetch(await signedRequest("POST", "/internal/v1/generate", req));
    const events = await collectSse(response);

    const deltas = events.filter((e) => e.event === "delta");
    expect(deltas.length).toBeGreaterThan(1);
    const joined = deltas.map((e) => JSON.parse(e.data).text).join("");
    expect(joined).toBe("echo: hello world");

    const done = events[events.length - 1];
    expect(done?.event).toBe("done");
    const doneData = JSON.parse(done!.data);
    expect(doneData.finish_reason).toBe("stop");
    expect(doneData.chars_out).toBe("echo: hello world".length);

    const session = server.state.sessions.get(req.session_id);
    expect(session?.lastCommittedRequestId).toBe(req.request_id);
    expect(session?.transcript.at(-1)).toEqual({ role: "assistant", content: "echo: hello world" });
  });

  test("a repeat request_id returns ALREADY_COMMITTED with the stored text", async () => {
    const server = createMockModelServer({ secret: SECRET });
    const req = baseGenerateRequest();
    await collectSse(await server.fetch(await signedRequest("POST", "/internal/v1/generate", req)));

    const replay = await collectSse(
      await server.fetch(await signedRequest("POST", "/internal/v1/generate", req)),
    );
    expect(replay).toHaveLength(1);
    expect(replay[0]?.event).toBe("error");
    const data = JSON.parse(replay[0]!.data);
    expect(data.code).toBe("ALREADY_COMMITTED");
    expect(data.text).toBe("echo: hello there");
  });

  test("UNKNOWN_SESSION when the session_id has no record", async () => {
    const server = createMockModelServer({ secret: SECRET });
    const req = baseGenerateRequest({ new_session: false });
    const events = await collectSse(
      await server.fetch(await signedRequest("POST", "/internal/v1/generate", req)),
    );
    expect(events).toHaveLength(1);
    expect(JSON.parse(events[0]!.data).code).toBe("UNKNOWN_SESSION");
  });

  test("SESSION_INCOMPATIBLE when the model version does not match", async () => {
    const server = createMockModelServer({ secret: SECRET });
    const sessionId = crypto.randomUUID();
    await collectSse(
      await server.fetch(
        await signedRequest(
          "POST",
          "/internal/v1/generate",
          baseGenerateRequest({ session_id: sessionId, model: "thalamus-sophon-1.0" }),
        ),
      ),
    );

    const events = await collectSse(
      await server.fetch(
        await signedRequest(
          "POST",
          "/internal/v1/generate",
          baseGenerateRequest({
            session_id: sessionId,
            new_session: false,
            model: "thalamus-sophon-2.0",
            messages: [{ role: "user", content: "again" }],
          }),
        ),
      ),
    );
    expect(events).toHaveLength(1);
    expect(JSON.parse(events[0]!.data).code).toBe("SESSION_INCOMPATIBLE");
  });

  test("regenerate replays the last turn without appending new messages", async () => {
    const server = createMockModelServer({ secret: SECRET });
    const sessionId = crypto.randomUUID();
    await collectSse(
      await server.fetch(
        await signedRequest(
          "POST",
          "/internal/v1/generate",
          baseGenerateRequest({
            session_id: sessionId,
            messages: [{ role: "user", content: "first message" }],
          }),
        ),
      ),
    );

    const events = await collectSse(
      await server.fetch(
        await signedRequest(
          "POST",
          "/internal/v1/generate",
          baseGenerateRequest({
            session_id: sessionId,
            new_session: false,
            regenerate: true,
            messages: [],
            request_id: crypto.randomUUID(),
          }),
        ),
      ),
    );

    const done = events[events.length - 1];
    expect(done?.event).toBe("done");
    const session = server.state.sessions.get(sessionId);
    // Still exactly one user + one assistant message: the regenerate
    // replaced the assistant reply rather than appending to it.
    expect(session?.transcript).toHaveLength(2);
    expect(session?.transcript.at(-1)).toEqual({
      role: "assistant",
      content: "echo: first message",
    });
  });

  test("FILE_CAP_REACHED when the configured tiny cap is exceeded", async () => {
    const server = createMockModelServer({ secret: SECRET, sessionFileCapBytes: 5 });
    const req = baseGenerateRequest({ messages: [{ role: "user", content: "this is long" }] });
    const events = await collectSse(
      await server.fetch(await signedRequest("POST", "/internal/v1/generate", req)),
    );
    expect(events).toHaveLength(1);
    expect(JSON.parse(events[0]!.data).code).toBe("FILE_CAP_REACHED");

    // Nothing was committed.
    expect(server.state.sessions.has(req.session_id)).toBe(false);
  });

  test("fail before done: no deltas, no commit, and a retry succeeds", async () => {
    const server = createMockModelServer({ secret: SECRET });
    const req = baseGenerateRequest();
    const failed = await collectSse(
      await server.fetch(
        await signedRequest("POST", "/internal/v1/generate", req, {
          "x-mock-inject-failure": "before_done",
        }),
      ),
    );
    expect(failed).toHaveLength(1);
    expect(failed[0]?.event).toBe("error");
    expect(server.state.sessions.has(req.session_id)).toBe(false);

    const retried = await collectSse(
      await server.fetch(await signedRequest("POST", "/internal/v1/generate", req)),
    );
    expect(retried[retried.length - 1]?.event).toBe("done");
    expect(server.state.sessions.get(req.session_id)?.lastCommittedRequestId).toBe(req.request_id);
  });

  test("fail after N deltas: streams N deltas then errors, without committing", async () => {
    const server = createMockModelServer({ secret: SECRET });
    const req = baseGenerateRequest({ messages: [{ role: "user", content: "a longer message" }] });
    const events = await collectSse(
      await server.fetch(
        await signedRequest("POST", "/internal/v1/generate", req, {
          "x-mock-inject-failure": "after:2",
        }),
      ),
    );
    const deltas = events.filter((e) => e.event === "delta");
    expect(deltas).toHaveLength(2);
    expect(events[events.length - 1]?.event).toBe("error");
    expect(server.state.sessions.has(req.session_id)).toBe(false);
  });

  test("per-delta delay is honored", async () => {
    const server = createMockModelServer({ secret: SECRET, perDeltaDelayMs: 20 });
    const req = baseGenerateRequest({ messages: [{ role: "user", content: "hello world" }] });
    const start = performance.now();
    await collectSse(await server.fetch(await signedRequest("POST", "/internal/v1/generate", req)));
    expect(performance.now() - start).toBeGreaterThanOrEqual(20);
  });

  test("warm marks a user as warmed", async () => {
    const server = createMockModelServer({ secret: SECRET });
    const response = await server.fetch(
      await signedRequest("POST", "/internal/v1/warm", { user_key: "user-1" }),
    );
    expect(response.status).toBe(200);
    expect(server.state.users.get("user-1")?.warmedAt).not.toBeNull();
  });

  test("session end marks the session ended", async () => {
    const server = createMockModelServer({ secret: SECRET });
    const req = baseGenerateRequest();
    await collectSse(await server.fetch(await signedRequest("POST", "/internal/v1/generate", req)));

    const response = await server.fetch(
      await signedRequest("POST", `/internal/v1/sessions/${req.session_id}/end`, {}),
    );
    expect(response.status).toBe(200);
    expect(server.state.sessions.get(req.session_id)?.ended).toBe(true);
  });

  test("session end on an unknown session returns 404", async () => {
    const server = createMockModelServer({ secret: SECRET });
    const response = await server.fetch(
      await signedRequest("POST", `/internal/v1/sessions/${crypto.randomUUID()}/end`, {}),
    );
    expect(response.status).toBe(404);
  });

  test("delete user erases the user and all of their sessions, idempotently", async () => {
    const server = createMockModelServer({ secret: SECRET });
    const req = baseGenerateRequest({ user_key: "user-to-delete" });
    await collectSse(await server.fetch(await signedRequest("POST", "/internal/v1/generate", req)));

    const first = await server.fetch(
      await signedRequest("DELETE", "/internal/v1/users/user-to-delete", {}),
    );
    expect(first.status).toBe(200);
    expect(server.state.users.has("user-to-delete")).toBe(false);
    expect(server.state.sessions.has(req.session_id)).toBe(false);

    const second = await server.fetch(
      await signedRequest("DELETE", "/internal/v1/users/user-to-delete", {}),
    );
    expect(second.status).toBe(200);
  });
});
