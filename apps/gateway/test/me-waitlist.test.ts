import { describe, expect, test } from "bun:test";
import { buildTestHarness, createAccount, readJson, signInAs } from "./helpers.js";

const csrf = { "content-type": "application/json", "x-requested-with": "thalamus" };

describe("GET /api/me", () => {
  test("a signed-in user with no account yet gets account: null", async () => {
    const h = await buildTestHarness();
    h.identity.registerUser("tok", { id: "convex-1", email: "new@example.com" });

    const res = await h.app.request("/api/me", { headers: { cookie: "th_session=tok" } });
    expect(res.status).toBe(200);
    const body = await readJson<{ account: unknown; user: { email: string }; isAdmin: boolean }>(
      res,
    );
    expect(body.account).toBeNull();
    expect(body.user.email).toBe("new@example.com");
    expect(body.isAdmin).toBe(false);
  });

  test("isAdmin is true when the signed-in email is in ADMIN_EMAILS, case-insensitively", async () => {
    const h = await buildTestHarness();
    // ADMIN_EMAILS holds "admin@example.com".
    h.identity.registerUser("admin-tok", { id: "convex-admin-me", email: "ADMIN@example.com" });

    const res = await h.app.request("/api/me", { headers: { cookie: "th_session=admin-tok" } });
    const body = await readJson<{ isAdmin: boolean }>(res);
    expect(body.isAdmin).toBe(true);
  });

  test("an existing account reports its status and plan", async () => {
    const h = await buildTestHarness();
    const account = await createAccount(h, { status: "invited", convexUserId: "convex-2" });
    const token = signInAs(h, account);

    const res = await h.app.request("/api/me", { headers: { cookie: `th_session=${token}` } });
    const body = await readJson<{ account: { status: string; plan: string } }>(res);
    expect(body.account.status).toBe("invited");
    expect(body.account.plan).toBe("free-beta");
  });
});

describe("POST /api/waitlist/join", () => {
  test("creates an account and a waitlist row, and is idempotent", async () => {
    const h = await buildTestHarness();
    h.identity.registerUser("tok2", { id: "convex-3", email: "joiner@example.com" });
    const headers = { ...csrf, cookie: "th_session=tok2" };

    const first = await h.app.request("/api/waitlist/join", {
      method: "POST",
      headers,
      body: "{}",
    });
    expect(first.status).toBe(200);
    const firstBody = await readJson<{ account: { status: string }; waitlistPosition: number }>(
      first,
    );
    expect(firstBody.account.status).toBe("waitlisted");
    expect(firstBody.waitlistPosition).toBe(1);

    const second = await h.app.request("/api/waitlist/join", {
      method: "POST",
      headers,
      body: "{}",
    });
    const secondBody = await readJson<{ waitlistPosition: number }>(second);
    expect(secondBody.waitlistPosition).toBe(1);
  });

  test("positions increment across different users", async () => {
    const h = await buildTestHarness();
    h.identity.registerUser("tok-a", { id: "convex-a", email: "a@example.com" });
    h.identity.registerUser("tok-b", { id: "convex-b", email: "b@example.com" });

    const a = await h.app.request("/api/waitlist/join", {
      method: "POST",
      headers: { ...csrf, cookie: "th_session=tok-a" },
      body: "{}",
    });
    const b = await h.app.request("/api/waitlist/join", {
      method: "POST",
      headers: { ...csrf, cookie: "th_session=tok-b" },
      body: "{}",
    });
    const aBody = await readJson<{ waitlistPosition: number }>(a);
    const bBody = await readJson<{ waitlistPosition: number }>(b);
    expect(bBody.waitlistPosition).toBe(aBody.waitlistPosition + 1);
  });
});
