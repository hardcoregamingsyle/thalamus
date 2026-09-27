import { afterEach, describe, expect, test } from "bun:test";
import { fetchMe } from "../src/lib/me.js";

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
