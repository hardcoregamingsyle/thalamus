import { describe, expect, test } from "bun:test";
import {
  buildTestHarness,
  createAccount,
  createApiKeyFor,
  readJson,
  type ApiErrorJson,
} from "./helpers.js";

interface ChatCompletionJson {
  object: string;
  choices: { message: { content: string } }[];
  usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
}

describe("GET /v1/models", () => {
  test("requires auth", async () => {
    const h = await buildTestHarness();
    const res = await h.app.request("/v1/models");
    expect(res.status).toBe(401);
  });

  test("lists the one served model", async () => {
    const h = await buildTestHarness();
    const account = await createAccount(h, { status: "invited" });
    const key = await createApiKeyFor(h, account.id);

    const res = await h.app.request("/v1/models", { headers: { authorization: `Bearer ${key}` } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { id: string }[] };
    expect(body.data.map((m) => m.id)).toEqual(["thalamus-sophon-1.0"]);
  });
});

describe("POST /v1/chat/completions", () => {
  test("rejects an invalid key", async () => {
    const h = await buildTestHarness();
    const res = await h.app.request("/v1/chat/completions", {
      method: "POST",
      headers: { authorization: "Bearer th_not-a-real-key", "content-type": "application/json" },
      body: JSON.stringify({
        model: "thalamus-sophon-1.0",
        messages: [{ role: "user", content: "hi" }],
      }),
    });
    expect(res.status).toBe(401);
    const body = await readJson<ApiErrorJson>(res);
    expect(body.error.code).toBe("invalid_api_key");
  });

  test("waitlisted account gets 403 with waitlist_position", async () => {
    const h = await buildTestHarness();
    const account = await createAccount(h, { status: "waitlisted" });
    const key = await createApiKeyFor(h, account.id);

    // Simulate having joined the waitlist (a real waitlisted account would
    // have a waitlist row from POST /api/waitlist/join).
    const { waitlist } = await import("@thalamus/db");
    await h.db
      .insert(waitlist)
      .values({ email: "w@example.com", convexUserId: account.convexUserId, position: 7 });

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
    expect(body.error.waitlist_position).toBe(7);
  });

  test("unknown model is 404", async () => {
    const h = await buildTestHarness();
    const account = await createAccount(h, { status: "invited" });
    const key = await createApiKeyFor(h, account.id);

    const res = await h.app.request("/v1/chat/completions", {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({ model: "gpt-4", messages: [{ role: "user", content: "hi" }] }),
    });
    expect(res.status).toBe(404);
    const body = await readJson<ApiErrorJson>(res);
    expect(body.error.code).toBe("model_not_found");
  });

  test("non-streaming completion echoes via the mock model server", async () => {
    const h = await buildTestHarness();
    const account = await createAccount(h, { status: "invited" });
    const key = await createApiKeyFor(h, account.id);

    const res = await h.app.request("/v1/chat/completions", {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({
        model: "thalamus-sophon-1.0",
        messages: [{ role: "user", content: "hello world" }],
      }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("x-thalamus-session-id")).toBeTruthy();
    const body = await readJson<ChatCompletionJson>(res);
    expect(body.object).toBe("chat.completion");
    expect(body.choices[0]?.message.content).toBe("echo: hello world");
    expect(body.usage.completion_tokens).toBe(Math.ceil("echo: hello world".length / 4));

    expect(h.usageEvents).toHaveLength(1);
    expect(h.usageEvents[0]?.status).toBe("ok");
    expect(h.usageEvents[0]?.charsOut).toBe("echo: hello world".length);
  });

  test("streaming completion emits OpenAI-shaped chunks and [DONE]", async () => {
    const h = await buildTestHarness();
    const account = await createAccount(h, { status: "invited" });
    const key = await createApiKeyFor(h, account.id);

    const res = await h.app.request("/v1/chat/completions", {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({
        model: "thalamus-sophon-1.0",
        messages: [{ role: "user", content: "stream please" }],
        stream: true,
      }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");

    const text = await res.text();
    expect(text.endsWith("data: [DONE]\n\n")).toBe(true);
    const dataLines = text
      .split("\n\n")
      .filter((block) => block.startsWith("data:"))
      .map((block) => block.slice("data:".length).trim());
    expect(dataLines[dataLines.length - 1]).toBe("[DONE]");

    const chunks = dataLines.slice(0, -1).map((line) => JSON.parse(line));
    expect(chunks[0].choices[0].delta.role).toBe("assistant");
    const joined = chunks
      .slice(1, -1)
      .map((c) => c.choices[0].delta.content ?? "")
      .join("");
    expect(joined).toBe("echo: stream please");
    const last = chunks[chunks.length - 1];
    expect(last.choices[0].finish_reason).toBe("stop");
    expect(last.usage).toBeDefined();

    expect(h.usageEvents).toHaveLength(1);
    expect(h.usageEvents[0]?.status).toBe("ok");
  });

  test("rate limit exceeded returns 429 with Retry-After", async () => {
    const h = await buildTestHarness();
    const { plans } = await import("@thalamus/db");
    const [plan] = await h.db
      .insert(plans)
      .values({ id: "tiny", requestsPerMinute: 60, burst: 1 })
      .returning();
    const { accounts } = await import("@thalamus/db");
    const [account] = await h.db
      .insert(accounts)
      .values({ convexUserId: "u-rate", status: "invited", plan: plan!.id })
      .returning();
    const key = await createApiKeyFor(h, account!.id);

    const makeReq = (user: string) =>
      h.app.request("/v1/chat/completions", {
        method: "POST",
        headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
        body: JSON.stringify({
          model: "thalamus-sophon-1.0",
          messages: [{ role: "user", content: "hi" }],
          user,
        }),
      });

    const first = await makeReq("end-user-a");
    expect(first.status).toBe(200);
    const second = await makeReq("end-user-b");
    expect(second.status).toBe(429);
    expect(second.headers.get("retry-after")).toBeTruthy();
  });

  test("lease_held returns 409 for a concurrent same user_key request", async () => {
    const h = await buildTestHarness({ perDeltaDelayMs: 20 });
    const account = await createAccount(h, { status: "invited" });
    const key = await createApiKeyFor(h, account.id);

    const makeReq = () =>
      h.app.request("/v1/chat/completions", {
        method: "POST",
        headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
        body: JSON.stringify({
          model: "thalamus-sophon-1.0",
          messages: [{ role: "user", content: "hi" }],
          user: "same-end-user",
          stream: true,
        }),
      });

    const firstPromise = makeReq();
    await new Promise((resolve) => setTimeout(resolve, 5));
    const second = await makeReq();
    expect(second.status).toBe(409);

    const first = await firstPromise;
    expect(first.status).toBe(200);
    await first.text();
  });
});
