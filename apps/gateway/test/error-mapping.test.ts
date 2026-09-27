import { describe, expect, test } from "bun:test";
import {
  buildTestHarness,
  createAccount,
  createApiKeyFor,
  MODEL_SERVER_SECRET,
  readJson,
  type ApiErrorJson,
} from "./helpers.js";
import { createModelServerClient } from "../src/lib/model-server-client.js";

/** Rebuilds a Request with extra headers, reading the body out explicitly
 * first rather than relying on the Request constructor to clone another
 * Request's body. */
async function withExtraHeaders(request: Request, extra: Record<string, string>): Promise<Request> {
  const bodyText = await request.text();
  const headers = new Headers(request.headers);
  for (const [key, value] of Object.entries(extra)) headers.set(key, value);
  return new Request(request.url, { method: request.method, headers, body: bodyText || undefined });
}

function injectFailure(
  h: Awaited<ReturnType<typeof buildTestHarness>>,
  spec: string,
  code?: string,
): void {
  h.deps.modelServer = createModelServerClient({
    baseUrl: "http://mock-model-server",
    secret: MODEL_SERVER_SECRET,
    fetchImpl: async (request) => {
      const extra: Record<string, string> = { "x-mock-inject-failure": spec };
      if (code) extra["x-mock-inject-failure-code"] = code;
      return h.modelServer.fetch(await withExtraHeaders(request, extra));
    },
  });
}

async function postChat(h: Awaited<ReturnType<typeof buildTestHarness>>, key: string) {
  return h.app.request("/v1/chat/completions", {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({
      model: "thalamus-sophon-1.0",
      messages: [{ role: "user", content: "hi" }],
    }),
  });
}

describe("model-server error mapping (non-streaming)", () => {
  const cases: { code: string; status: number }[] = [
    { code: "MODEL_CAPACITY_EXCEEDED", status: 503 },
    { code: "MEMORY_SAVE_FAILED", status: 502 },
    { code: "FILE_CAP_REACHED", status: 413 },
    { code: "INTERNAL_ERROR", status: 500 },
  ];

  for (const { code, status } of cases) {
    test(`${code} maps to HTTP ${status}`, async () => {
      const h = await buildTestHarness();
      const account = await createAccount(h, { status: "invited" });
      const key = await createApiKeyFor(h, account.id);
      injectFailure(h, "before_done", code);

      const res = await postChat(h, key);
      expect(res.status).toBe(status);
      const body = await readJson<ApiErrorJson>(res);
      expect(body.error.code).toBe(code.toLowerCase());

      expect(h.usageEvents).toHaveLength(1);
      expect(h.usageEvents[0]?.status).toBe("error");
    });
  }

  test("MEMORY_LOAD_FAILED is retried once and succeeds if the retry works", async () => {
    const h = await buildTestHarness();
    const account = await createAccount(h, { status: "invited" });
    const key = await createApiKeyFor(h, account.id);

    let calls = 0;
    h.deps.modelServer = createModelServerClient({
      baseUrl: "http://mock-model-server",
      secret: MODEL_SERVER_SECRET,
      fetchImpl: async (request) => {
        calls++;
        const extra: Record<string, string> =
          calls === 1
            ? {
                "x-mock-inject-failure": "before_done",
                "x-mock-inject-failure-code": "MEMORY_LOAD_FAILED",
              }
            : {};
        return h.modelServer.fetch(await withExtraHeaders(request, extra));
      },
    });

    const res = await postChat(h, key);
    expect(res.status).toBe(200);
    expect(calls).toBe(2);
    expect(h.usageEvents).toHaveLength(1);
    expect(h.usageEvents[0]?.status).toBe("ok");
  });

  test("the lease is released after an error, so an immediate retry does not see lease_held", async () => {
    const h = await buildTestHarness();
    const account = await createAccount(h, { status: "invited" });
    const key = await createApiKeyFor(h, account.id);
    injectFailure(h, "before_done", "INTERNAL_ERROR");

    const first = await postChat(h, key);
    expect(first.status).toBe(500);

    // No failure injected this time: a stale, un-released lease would make
    // this 409 instead.
    h.deps.modelServer = createModelServerClient({
      baseUrl: "http://mock-model-server",
      secret: MODEL_SERVER_SECRET,
      fetchImpl: (request) => h.modelServer.fetch(request),
    });
    const second = await postChat(h, key);
    expect(second.status).toBe(200);
  });

  test("a mid-stream error after some deltas is reported in-band and still metered", async () => {
    const h = await buildTestHarness();
    const account = await createAccount(h, { status: "invited" });
    const key = await createApiKeyFor(h, account.id);
    injectFailure(h, "after:1", "INTERNAL_ERROR");

    const res = await h.app.request("/v1/chat/completions", {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({
        model: "thalamus-sophon-1.0",
        messages: [{ role: "user", content: "a longer message here" }],
        stream: true,
      }),
    });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain('"error"');
    expect(text.endsWith("data: [DONE]\n\n")).toBe(true);

    expect(h.usageEvents).toHaveLength(1);
    expect(h.usageEvents[0]?.status).toBe("error");
  });

  test("aborting the stream mid-generation releases the lease and is metered as client_closed", async () => {
    const h = await buildTestHarness({ perDeltaDelayMs: 30 });
    const account = await createAccount(h, { status: "invited" });
    const key = await createApiKeyFor(h, account.id);

    const res = await h.app.request("/v1/chat/completions", {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({
        model: "thalamus-sophon-1.0",
        messages: [{ role: "user", content: "a message long enough to have several delta chunks" }],
        stream: true,
        user: "abort-user",
      }),
    });
    expect(res.status).toBe(200);

    const reader = res.body!.getReader();
    await reader.read(); // the role-priming chunk
    await reader.read(); // at least one content chunk
    await reader.cancel();

    // Give the stream's cancel handler a moment to finish its async cleanup.
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(h.usageEvents).toHaveLength(1);
    expect(h.usageEvents[0]?.status).toBe("client_closed");

    // The lease was released: a fresh request for the same end user succeeds
    // immediately instead of hitting lease_held.
    const second = await h.app.request("/v1/chat/completions", {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({
        model: "thalamus-sophon-1.0",
        messages: [{ role: "user", content: "hi again" }],
        user: "abort-user",
      }),
    });
    expect(second.status).toBe(200);
  });
});
