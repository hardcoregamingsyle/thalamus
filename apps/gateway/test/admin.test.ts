import { describe, expect, test } from "bun:test";
import { buildTestHarness, readJson, ADMIN_TOKEN } from "./helpers.js";

const csrf = { "content-type": "application/json", "x-requested-with": "thalamus" };

describe("admin routes", () => {
  test("rejects a missing or wrong bearer token", async () => {
    const h = await buildTestHarness();
    const noAuth = await h.app.request("/api/admin/waitlist");
    expect(noAuth.status).toBe(401);

    const wrongAuth = await h.app.request("/api/admin/waitlist", {
      headers: { authorization: "Bearer nope" },
    });
    expect(wrongAuth.status).toBe(401);
  });

  test("lists the waitlist and invites an account", async () => {
    const h = await buildTestHarness();
    h.identity.registerUser("admin-test-token", {
      id: "convex-admin-1",
      email: "admin-1@example.com",
    });
    const joinRes = await h.app.request("/api/waitlist/join", {
      method: "POST",
      headers: { ...csrf, cookie: "th_session=admin-test-token" },
      body: "{}",
    });
    const joined = await readJson<{ account: { id: string } }>(joinRes);

    const listRes = await h.app.request("/api/admin/waitlist", {
      headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
    });
    expect(listRes.status).toBe(200);
    const list = await readJson<{ waitlist: { accountId: string; email: string }[] }>(listRes);
    // The admin page invites with the id from this listing, so it must be the account id.
    const row = list.waitlist.find((r) => r.email === "admin-1@example.com");
    expect(row?.accountId).toBe(joined.account.id);

    const inviteRes = await h.app.request("/api/admin/invite", {
      method: "POST",
      headers: { ...csrf, authorization: `Bearer ${ADMIN_TOKEN}` },
      body: JSON.stringify({ accountId: row?.accountId }),
    });
    expect(inviteRes.status).toBe(200);
    const invited = await readJson<{ account: { status: string } }>(inviteRes);
    expect(invited.account.status).toBe("invited");

    // The waitlist listing (which only shows un-invited rows) no longer
    // includes this account.
    const afterRes = await h.app.request("/api/admin/waitlist", {
      headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
    });
    const after = await readJson<{ waitlist: { accountId: string }[] }>(afterRes);
    expect(after.waitlist.some((r) => r.accountId === joined.account.id)).toBe(false);
  });

  test("a session whose email is in ADMIN_EMAILS (case-insensitively) is admitted", async () => {
    const h = await buildTestHarness();
    // ADMIN_EMAILS holds "Second-Admin@Example.com"; the signed-in user's
    // email differs only in case.
    h.identity.registerUser("admin-email-token", {
      id: "convex-email-admin",
      email: "second-admin@example.com",
    });

    const res = await h.app.request("/api/admin/waitlist", {
      headers: { cookie: "th_session=admin-email-token" },
    });
    expect(res.status).toBe(200);
  });

  test("a signed-in session whose email is not in ADMIN_EMAILS is rejected", async () => {
    const h = await buildTestHarness();
    h.identity.registerUser("plain-user-token", {
      id: "convex-plain",
      email: "not-an-admin@example.com",
    });

    const res = await h.app.request("/api/admin/waitlist", {
      headers: { cookie: "th_session=plain-user-token" },
    });
    expect(res.status).toBe(401);
  });

  test("invite on an unknown account is 404", async () => {
    const h = await buildTestHarness();
    const res = await h.app.request("/api/admin/invite", {
      method: "POST",
      headers: { ...csrf, authorization: `Bearer ${ADMIN_TOKEN}` },
      body: JSON.stringify({ accountId: crypto.randomUUID() }),
    });
    expect(res.status).toBe(404);
  });
});
