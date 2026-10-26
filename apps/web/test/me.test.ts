import { afterEach, describe, expect, test } from "bun:test";
import { fetchMe } from "../src/lib/me.js";
import type { MeResponse } from "../src/lib/types.js";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("fetchMe", () => {
  test("returns the parsed /api/me body on a 200", async () => {
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          user: { id: "u1", email: "a@example.com", name: null, image: null },
          account: { status: "invited" },
          waitlistPosition: null,
          isAdmin: false,
        }),
        { status: 200 },
      )) as unknown as typeof fetch;

    const result = await fetchMe();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.user?.email).toBe("a@example.com");
      expect(result.data.isAdmin).toBe(false);
    }
  });

  test("fails to signed-out on a non-ok response", async () => {
    globalThis.fetch = (async () => new Response(null, { status: 401 })) as unknown as typeof fetch;
    const result = await fetchMe();
    expect(result.ok).toBe(false);
  });

  test("fails to signed-out on a network error rather than throwing", async () => {
    globalThis.fetch = (async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch;
    const result = await fetchMe();
    expect(result.ok).toBe(false);
  });
});

describe("account request lifetime", () => {
  function accountResponse(id: string): MeResponse {
    return {
      user: { id, email: `${id}@example.com` },
      account: { id: `account-${id}`, status: "waitlisted", plan: "early-access" },
      waitlistPosition: 1,
      isAdmin: false,
    };
  }

  function deferredResponse() {
    let resolve!: (value: Response) => void;
    const promise = new Promise<Response>((done) => {
      resolve = done;
    });
    return { promise, resolve };
  }

  test("simultaneous reads share one request without retaining settled account data", async () => {
    const response = deferredResponse();
    let requests = 0;
    globalThis.fetch = (async () => {
      requests += 1;
      return requests === 1 ? response.promise : Response.json(accountResponse("next"));
    }) as unknown as typeof fetch;
    const first = fetchMe();
    const second = fetchMe();
    expect(requests).toBe(1);
    response.resolve(Response.json(accountResponse("first")));
    const results = await Promise.all([first, second]);
    expect(results[0]).toEqual(results[1]);
    const next = await fetchMe();
    expect(requests).toBe(2);
    expect(next).toEqual({ ok: true, data: accountResponse("next") });
  });

  test("a fresh reload bypasses an older read and remains shared until it settles", async () => {
    const old = deferredResponse();
    const fresh = deferredResponse();
    let requests = 0;
    globalThis.fetch = (async () =>
      ++requests === 1 ? old.promise : fresh.promise) as unknown as typeof fetch;
    const initial = fetchMe();
    const reloaded = fetchMe({ refresh: true });
    expect(requests).toBe(2);
    old.resolve(Response.json(accountResponse("old")));
    await initial;
    const shared = fetchMe();
    expect(requests).toBe(2);
    fresh.resolve(Response.json(accountResponse("fresh")));
    const [one, two] = await Promise.all([reloaded, shared]);
    expect(one).toEqual(two);
    expect(one).toEqual({ ok: true, data: accountResponse("fresh") });
  });
});
