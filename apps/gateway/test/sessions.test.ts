import { describe, expect, test } from "bun:test";
import {
  buildTestHarness,
  createAccount,
  createApiKeyFor,
  readJson,
  type ApiErrorJson,
} from "./helpers.js";

async function chat(
  h: Awaited<ReturnType<typeof buildTestHarness>>,
  key: string,
  messages: { role: string; content: string }[],
  extra: Record<string, unknown> = {},
): Promise<{ status: number; sessionId: string | null; content: string }> {
  const res = await h.app.request("/v1/chat/completions", {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({ model: "thalamus-sophon-1.0", messages, ...extra }),
  });
  const sessionId = res.headers.get("x-thalamus-session-id");
  const body = (await res.json()) as {
    choices?: { message: { content: string } }[];
    error?: unknown;
  };
  return { status: res.status, sessionId, content: body.choices?.[0]?.message.content ?? "" };
}

describe("full-history session resolution", () => {
  test("continue: a new user message after the last assistant reply extends the same session", async () => {
    const h = await buildTestHarness();
    const account = await createAccount(h, { status: "invited" });
    const key = await createApiKeyFor(h, account.id);

    const first = await chat(h, key, [{ role: "user", content: "first" }]);
    expect(first.status).toBe(200);
    expect(first.content).toBe("echo: first");

    const second = await chat(h, key, [
      { role: "user", content: "first" },
      { role: "assistant", content: first.content },
      { role: "user", content: "second" },
    ]);
    expect(second.status).toBe(200);
    expect(second.sessionId).toBe(first.sessionId);
    expect(second.content).toBe("echo: second");
  });

  test("regenerate: resending the same prefix with no new user message replays the same turn", async () => {
    const h = await buildTestHarness();
    const account = await createAccount(h, { status: "invited" });
    const key = await createApiKeyFor(h, account.id);

    const first = await chat(h, key, [{ role: "user", content: "only message" }]);
    expect(first.status).toBe(200);

    // Same array the first call was made with, unchanged: nothing new was
    // added, so this is a regenerate rather than a fresh session.
    const regenerated = await chat(h, key, [{ role: "user", content: "only message" }]);
    expect(regenerated.status).toBe(200);
    expect(regenerated.sessionId).toBe(first.sessionId);
    expect(regenerated.content).toBe("echo: only message");
  });

  test("edit: changing an earlier message starts a brand-new session", async () => {
    const h = await buildTestHarness();
    const account = await createAccount(h, { status: "invited" });
    const key = await createApiKeyFor(h, account.id);

    const first = await chat(h, key, [{ role: "user", content: "original" }]);
    const second = await chat(h, key, [
      { role: "user", content: "original" },
      { role: "assistant", content: first.content },
      { role: "user", content: "follow up" },
    ]);

    const edited = await chat(h, key, [{ role: "user", content: "edited from scratch" }]);
    expect(edited.status).toBe(200);
    expect(edited.sessionId).not.toBe(first.sessionId);
    expect(edited.sessionId).not.toBe(second.sessionId);
  });

  test("explicit session_id: messages are forwarded as new turns only", async () => {
    const h = await buildTestHarness();
    const account = await createAccount(h, { status: "invited" });
    const key = await createApiKeyFor(h, account.id);

    const first = await chat(h, key, [{ role: "user", content: "hello" }]);
    expect(first.sessionId).toBeTruthy();

    const second = await chat(h, key, [{ role: "user", content: "just this" }], {
      session_id: first.sessionId,
    });
    expect(second.status).toBe(200);
    expect(second.sessionId).toBe(first.sessionId);
    expect(second.content).toBe("echo: just this");
  });

  test("explicit session_id via the X-Thalamus-Session-Id header", async () => {
    const h = await buildTestHarness();
    const account = await createAccount(h, { status: "invited" });
    const key = await createApiKeyFor(h, account.id);

    const first = await chat(h, key, [{ role: "user", content: "hello" }]);

    const res = await h.app.request("/v1/chat/completions", {
      method: "POST",
      headers: {
        authorization: `Bearer ${key}`,
        "content-type": "application/json",
        "x-thalamus-session-id": first.sessionId as string,
      },
      body: JSON.stringify({
        model: "thalamus-sophon-1.0",
        messages: [{ role: "user", content: "via header" }],
      }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("x-thalamus-session-id")).toBe(first.sessionId);
  });

  test("unknown explicit session_id is a 400 invalid_request", async () => {
    const h = await buildTestHarness();
    const account = await createAccount(h, { status: "invited" });
    const key = await createApiKeyFor(h, account.id);

    const res = await h.app.request("/v1/chat/completions", {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({
        model: "thalamus-sophon-1.0",
        messages: [{ role: "user", content: "hi" }],
        session_id: crypto.randomUUID(),
      }),
    });
    expect(res.status).toBe(400);
    const body = await readJson<ApiErrorJson>(res);
    expect(body.error.code).toBe("invalid_request");
  });

  test("different OpenAI `user` values get independent sessions", async () => {
    const h = await buildTestHarness();
    const account = await createAccount(h, { status: "invited" });
    const key = await createApiKeyFor(h, account.id);

    const a = await chat(h, key, [{ role: "user", content: "hi" }], { user: "alice" });
    const b = await chat(h, key, [{ role: "user", content: "hi" }], { user: "bob" });
    expect(a.sessionId).not.toBe(b.sessionId);
  });
});
