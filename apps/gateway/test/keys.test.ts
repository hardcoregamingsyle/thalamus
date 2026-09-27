import { describe, expect, test } from "bun:test";
import { buildTestHarness, createAccount, readJson, signInAs } from "./helpers.js";

const csrf = { "content-type": "application/json", "x-requested-with": "thalamus" };

describe("/api/keys (invited accounts only)", () => {
  test("a waitlisted account is forbidden", async () => {
    const h = await buildTestHarness();
    const account = await createAccount(h, { status: "waitlisted" });
    const token = signInAs(h, account);

    const res = await h.app.request("/api/keys", { headers: { cookie: `th_session=${token}` } });
    expect(res.status).toBe(403);
  });

  test("create, list, then delete a key", async () => {
    const h = await buildTestHarness();
    const account = await createAccount(h, { status: "invited" });
    const token = signInAs(h, account);
    const headers = { ...csrf, cookie: `th_session=${token}` };

    const createRes = await h.app.request("/api/keys", {
      method: "POST",
      headers,
      body: JSON.stringify({ name: "my key" }),
    });
    expect(createRes.status).toBe(200);
    const created = await readJson<{ id: string; key: string; last4: string }>(createRes);
    expect(created.key.startsWith("th_")).toBe(true);
    expect(created.last4).toBe(created.key.slice(-4));

    const listRes = await h.app.request("/api/keys", { headers: { cookie: headers.cookie } });
    const list = await readJson<{ keys: { id: string; name: string | null }[] }>(listRes);
    expect(list.keys).toHaveLength(1);
    expect(list.keys[0]?.name).toBe("my key");
    // The raw key is never returned by the list endpoint.
    expect(JSON.stringify(list)).not.toContain(created.key);

    // The freshly created key works as a bearer credential.
    const modelsRes = await h.app.request("/v1/models", {
      headers: { authorization: `Bearer ${created.key}` },
    });
    expect(modelsRes.status).toBe(200);

    const deleteRes = await h.app.request(`/api/keys/${created.id}`, { method: "DELETE", headers });
    expect(deleteRes.status).toBe(200);

    // Revocation is cached for 60s per docs/architecture.md §4; advance past
    // that before checking the key stopped working.
    h.clock.advanceMs(61_000);
    const afterDelete = await h.app.request("/v1/models", {
      headers: { authorization: `Bearer ${created.key}` },
    });
    expect(afterDelete.status).toBe(401);
  });

  test("deleting a key belonging to another account is not found", async () => {
    const h = await buildTestHarness();
    const owner = await createAccount(h, { status: "invited" });
    const other = await createAccount(h, { status: "invited" });
    const ownerToken = signInAs(h, owner);
    const otherToken = signInAs(h, other);

    const createRes = await h.app.request("/api/keys", {
      method: "POST",
      headers: { ...csrf, cookie: `th_session=${ownerToken}` },
      body: "{}",
    });
    const created = await readJson<{ id: string }>(createRes);

    const deleteRes = await h.app.request(`/api/keys/${created.id}`, {
      method: "DELETE",
      headers: { ...csrf, cookie: `th_session=${otherToken}` },
    });
    expect(deleteRes.status).toBe(404);
  });
});
