import { describe, expect, test } from "bun:test";
import {
  buildTestHarness,
  collectStreamedContent,
  createAccount,
  readJson,
  signInAs,
} from "./helpers.js";

const csrf = { "content-type": "application/json", "x-requested-with": "thalamus" };

async function signedIn(h: Awaited<ReturnType<typeof buildTestHarness>>) {
  const account = await createAccount(h, { status: "invited" });
  const token = signInAs(h, account);
  return { account, headers: { ...csrf, cookie: `th_session=${token}` } };
}

describe("chat app conversations", () => {
  test("create, list, and fetch a conversation", async () => {
    const h = await buildTestHarness();
    const { headers } = await signedIn(h);

    const createRes = await h.app.request("/api/conversations", {
      method: "POST",
      headers,
      body: JSON.stringify({ title: "My chat" }),
    });
    expect(createRes.status).toBe(200);
    const created = await readJson<{ conversation: { id: string; title: string } }>(createRes);
    expect(created.conversation.title).toBe("My chat");

    const listRes = await h.app.request("/api/conversations", {
      headers: { cookie: headers.cookie },
    });
    const list = await readJson<{ conversations: { id: string }[] }>(listRes);
    expect(list.conversations.map((c) => c.id)).toContain(created.conversation.id);

    const getRes = await h.app.request(`/api/conversations/${created.conversation.id}`, {
      headers: { cookie: headers.cookie },
    });
    expect(getRes.status).toBe(200);
    const got = await readJson<{ messages: unknown[] }>(getRes);
    expect(got.messages).toHaveLength(0);
  });

  test("posting a message stores it and streams back an assistant reply", async () => {
    const h = await buildTestHarness();
    const { headers } = await signedIn(h);

    const createRes = await h.app.request("/api/conversations", {
      method: "POST",
      headers,
      body: "{}",
    });
    const created = await readJson<{ conversation: { id: string } }>(createRes);
    const id = created.conversation.id;

    const messageRes = await h.app.request(`/api/conversations/${id}/messages`, {
      method: "POST",
      headers,
      body: JSON.stringify({ content: "hello there" }),
    });
    expect(messageRes.status).toBe(200);
    const content = await collectStreamedContent(messageRes);
    expect(content).toBe("echo: hello there");

    const getRes = await h.app.request(`/api/conversations/${id}`, {
      headers: { cookie: headers.cookie },
    });
    const got = await readJson<{ messages: { role: string; content: string }[] }>(getRes);
    expect(got.messages).toHaveLength(2);
    expect(got.messages[0]?.role).toBe("user");
    expect(got.messages[0]?.content).toBe("hello there");
    expect(got.messages[1]?.role).toBe("assistant");
    expect(got.messages[1]?.content).toBe("echo: hello there");
  });

  test("a second message continues the same underlying model-server session", async () => {
    const h = await buildTestHarness();
    const { headers } = await signedIn(h);
    const createRes = await h.app.request("/api/conversations", {
      method: "POST",
      headers,
      body: "{}",
    });
    const created = await readJson<{ conversation: { id: string } }>(createRes);
    const id = created.conversation.id;

    const first = await h.app.request(`/api/conversations/${id}/messages`, {
      method: "POST",
      headers,
      body: JSON.stringify({ content: "first" }),
    });
    const firstSessionId = first.headers.get("x-thalamus-session-id");
    await collectStreamedContent(first);

    const second = await h.app.request(`/api/conversations/${id}/messages`, {
      method: "POST",
      headers,
      body: JSON.stringify({ content: "second" }),
    });
    expect(second.headers.get("x-thalamus-session-id")).toBe(firstSessionId);
    const secondContent = await collectStreamedContent(second);
    expect(secondContent).toBe("echo: second");
  });

  test("regenerate replaces the last assistant message", async () => {
    const h = await buildTestHarness();
    const { headers } = await signedIn(h);
    const createRes = await h.app.request("/api/conversations", {
      method: "POST",
      headers,
      body: "{}",
    });
    const created = await readJson<{ conversation: { id: string } }>(createRes);
    const id = created.conversation.id;

    await (
      await h.app.request(`/api/conversations/${id}/messages`, {
        method: "POST",
        headers,
        body: JSON.stringify({ content: "only message" }),
      })
    ).text();

    const regenRes = await h.app.request(`/api/conversations/${id}/regenerate`, {
      method: "POST",
      headers,
    });
    expect(regenRes.status).toBe(200);
    await regenRes.text();

    const getRes = await h.app.request(`/api/conversations/${id}`, {
      headers: { cookie: headers.cookie },
    });
    const got = await readJson<{ messages: { role: string; content: string }[] }>(getRes);
    // Still exactly one user + one assistant message — the regenerate
    // replaced the reply rather than appending another one.
    expect(got.messages).toHaveLength(2);
    expect(got.messages[1]?.role).toBe("assistant");
  });

  test("deleting a conversation ends its session and removes it", async () => {
    const h = await buildTestHarness();
    const { headers } = await signedIn(h);
    const createRes = await h.app.request("/api/conversations", {
      method: "POST",
      headers,
      body: "{}",
    });
    const created = await readJson<{ conversation: { id: string } }>(createRes);
    const id = created.conversation.id;

    await (
      await h.app.request(`/api/conversations/${id}/messages`, {
        method: "POST",
        headers,
        body: JSON.stringify({ content: "hi" }),
      })
    ).text();

    const deleteRes = await h.app.request(`/api/conversations/${id}`, {
      method: "DELETE",
      headers,
    });
    expect(deleteRes.status).toBe(200);

    const getRes = await h.app.request(`/api/conversations/${id}`, {
      headers: { cookie: headers.cookie },
    });
    expect(getRes.status).toBe(404);
  });

  test("POST /api/chat/warm warms the model server for a conversation", async () => {
    const h = await buildTestHarness();
    const { headers } = await signedIn(h);
    const createRes = await h.app.request("/api/conversations", {
      method: "POST",
      headers,
      body: "{}",
    });
    const created = await readJson<{ conversation: { id: string } }>(createRes);

    const warmRes = await h.app.request("/api/chat/warm", {
      method: "POST",
      headers,
      body: JSON.stringify({ conversationId: created.conversation.id }),
    });
    expect(warmRes.status).toBe(200);
    expect(h.modelServer.state.users.size).toBe(1);
  });
});
