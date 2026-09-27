import { describe, expect, test } from "bun:test";
import { usageDaily } from "@thalamus/db";
import { buildTestHarness, createAccount, readJson, signInAs } from "./helpers.js";

describe("GET /api/usage", () => {
  test("requires sign-in", async () => {
    const h = await buildTestHarness();
    const res = await h.app.request("/api/usage");
    expect(res.status).toBe(401);
  });

  test("returns this account's daily rollups, most recent first", async () => {
    const h = await buildTestHarness();
    const account = await createAccount(h, { status: "invited" });
    const token = signInAs(h, account);

    await h.db.insert(usageDaily).values([
      {
        accountId: account.id,
        day: "2026-09-28",
        model: "thalamus-sophon-1.0",
        requests: 3,
        charsIn: 100,
        charsOut: 200,
      },
      {
        accountId: account.id,
        day: "2026-09-29",
        model: "thalamus-sophon-1.0",
        requests: 1,
        charsIn: 10,
        charsOut: 20,
      },
    ]);

    const res = await h.app.request("/api/usage?days=30", {
      headers: { cookie: `th_session=${token}` },
    });
    expect(res.status).toBe(200);
    const body = await readJson<{ days: { day: string; requests: number }[] }>(res);
    expect(body.days).toHaveLength(2);
    expect(body.days[0]?.day.slice(0, 10)).toBe("2026-09-29");
    expect(body.days[1]?.day.slice(0, 10)).toBe("2026-09-28");
  });

  test("does not return another account's usage", async () => {
    const h = await buildTestHarness();
    const account = await createAccount(h, { status: "invited" });
    const other = await createAccount(h, { status: "invited" });
    const token = signInAs(h, account);

    await h.db.insert(usageDaily).values({
      accountId: other.id,
      day: "2026-09-28",
      model: "thalamus-sophon-1.0",
      requests: 5,
      charsIn: 1,
      charsOut: 1,
    });

    const res = await h.app.request("/api/usage", { headers: { cookie: `th_session=${token}` } });
    const body = await readJson<{ days: unknown[] }>(res);
    expect(body.days).toHaveLength(0);
  });
});
