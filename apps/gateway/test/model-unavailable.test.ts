// Model server not configured (docs task brief §"Model server not
// configured"): every generation endpoint returns 503 model_unavailable
// once MODEL_SERVER_URL is empty/unset, but only after auth and the
// waitlist check — a waitlisted account still gets its 403.

import { describe, expect, test } from "bun:test";
import {
  buildTestHarness,
  createAccount,
  createApiKeyFor,
  readJson,
  signInAs,
  type ApiErrorJson,
} from "./helpers.js";

const csrf = { "content-type": "application/json", "x-requested-with": "thalamus" };

describe("model server not configured", () => {
  test("POST /v1/chat/completions returns 503 model_unavailable", async () => {
    const h = await buildTestHarness({ modelServerConfigured: false });
    const account = await createAccount(h, { status: "invited" });
    const key = await createApiKeyFor(h, account.id);

    const res = await h.app.request("/v1/chat/completions", {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({
        model: "thalamus-sophon-1.0",
        messages: [{ role: "user", content: "hi" }],
      }),
    });
    expect(res.status).toBe(503);
    const body = await readJson<ApiErrorJson>(res);
    expect(body.error.code).toBe("model_unavailable");
    expect(body.error.message).toBe("The model is not available yet.");
  });

  test("a waitlisted account still gets 403, not 503", async () => {
    const h = await buildTestHarness({ modelServerConfigured: false });
    const account = await createAccount(h, { status: "waitlisted" });
    const key = await createApiKeyFor(h, account.id);

    const res = await h.app.request("/v1/chat/completions", {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({
        model: "thalamus-sophon-1.0",
        messages: [{ role: "user", content: "hi" }],
      }),
    });
    expect(res.status).toBe(403);
    const body = await readJson<ApiErrorJson>(res);
    expect(body.error.code).toBe("waitlisted");
  });

  test("an invalid key still gets 401, not 503", async () => {
    const h = await buildTestHarness({ modelServerConfigured: false });
    const res = await h.app.request("/v1/chat/completions", {
      method: "POST",
      headers: { authorization: "Bearer th_not-a-real-key", "content-type": "application/json" },
      body: JSON.stringify({
        model: "thalamus-sophon-1.0",
        messages: [{ role: "user", content: "hi" }],
      }),
    });
    expect(res.status).toBe(401);
  });

  test("GET /v1/models keeps listing thalamus-sophon-1.0", async () => {
    const h = await buildTestHarness({ modelServerConfigured: false });
    const account = await createAccount(h, { status: "invited" });
    const key = await createApiKeyFor(h, account.id);

    const res = await h.app.request("/v1/models", { headers: { authorization: `Bearer ${key}` } });
    expect(res.status).toBe(200);
    const body = await readJson<{ data: { id: string }[] }>(res);
    expect(body.data.map((m) => m.id)).toEqual(["thalamus-sophon-1.0"]);
  });

  test("chat app message/regenerate/warm each return 503 model_unavailable", async () => {
    const h = await buildTestHarness({ modelServerConfigured: false });
    const account = await createAccount(h, { status: "invited" });
    const token = signInAs(h, account);
    const headers = { ...csrf, cookie: `th_session=${token}` };

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
      body: JSON.stringify({ content: "hi" }),
    });
    expect(messageRes.status).toBe(503);
    expect((await readJson<ApiErrorJson>(messageRes)).error.code).toBe("model_unavailable");

    const regenRes = await h.app.request(`/api/conversations/${id}/regenerate`, {
      method: "POST",
      headers,
    });
    expect(regenRes.status).toBe(503);
    expect((await readJson<ApiErrorJson>(regenRes)).error.code).toBe("model_unavailable");

    const warmRes = await h.app.request("/api/chat/warm", {
      method: "POST",
      headers,
      body: JSON.stringify({ conversationId: id }),
    });
    expect(warmRes.status).toBe(503);
    expect((await readJson<ApiErrorJson>(warmRes)).error.code).toBe("model_unavailable");
  });

  test("a waitlisted account's chat-app request still gets 403, not 503", async () => {
    const h = await buildTestHarness({ modelServerConfigured: false });
    const account = await createAccount(h, { status: "waitlisted" });
    const token = signInAs(h, account);
    const headers = { ...csrf, cookie: `th_session=${token}` };

    const res = await h.app.request("/api/chat/warm", {
      method: "POST",
      headers,
      body: JSON.stringify({ conversationId: crypto.randomUUID() }),
    });
    expect(res.status).toBe(403);
  });
});
