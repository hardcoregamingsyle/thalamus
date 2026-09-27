import { beforeEach, describe, expect, test } from "bun:test";
import { createTestDb, type TestDb } from "../src/test-db.js";
import { admitRequest, releaseLease } from "../src/index.js";
import { accounts, plans } from "../src/schema.js";

let db: TestDb;

beforeEach(async () => {
  db = await createTestDb();
});

async function insertAccount(plan: string): Promise<string> {
  const [account] = await db
    .insert(accounts)
    .values({ convexUserId: `user-${crypto.randomUUID()}`, plan })
    .returning({ id: accounts.id });
  return account!.id;
}

describe("admitRequest", () => {
  test("free-beta plan is seeded with 20 req/min, burst 20", async () => {
    const all = await db.select().from(plans);
    const freeBeta = all.find((p) => p.id === "free-beta");
    expect(freeBeta).toBeDefined();
    expect(freeBeta?.requestsPerMinute).toBe(20);
    expect(freeBeta?.burst).toBe(20);
  });

  test("admits a first request and takes the lease", async () => {
    const accountId = await insertAccount("free-beta");
    const now = new Date("2026-01-01T00:00:00Z");

    const result = await admitRequest(db, {
      accountId,
      userKey: "user-key-1",
      requestId: "req-1",
      now,
    });

    expect(result).toEqual({ status: "ok", retryAfterSeconds: null });
  });

  test("rate_limited when the bucket has no token left", async () => {
    const [plan] = await db
      .insert(plans)
      .values({ id: "tiny", requestsPerMinute: 60, burst: 1 })
      .returning();
    const accountId = await insertAccount(plan!.id);
    const now = new Date("2026-01-01T00:00:00Z");

    const first = await admitRequest(db, {
      accountId,
      userKey: "user-a",
      requestId: "req-a",
      now,
    });
    expect(first.status).toBe("ok");

    // Same instant, different user_key, so the lease is not what blocks
    // this one — only the exhausted token bucket.
    const second = await admitRequest(db, {
      accountId,
      userKey: "user-b",
      requestId: "req-b",
      now,
    });
    expect(second.status).toBe("rate_limited");
    expect(second.retryAfterSeconds).toBeGreaterThan(0);
  });

  test("the bucket refills over time", async () => {
    const [plan] = await db
      .insert(plans)
      .values({ id: "tiny-2", requestsPerMinute: 60, burst: 1 })
      .returning();
    const accountId = await insertAccount(plan!.id);
    const t0 = new Date("2026-01-01T00:00:00Z");

    const first = await admitRequest(db, {
      accountId,
      userKey: "user-a",
      requestId: "req-a",
      now: t0,
    });
    expect(first.status).toBe("ok");

    // 60 req/min = 1 token/second; one second later a token is back.
    const oneSecondLater = new Date(t0.getTime() + 1000);
    const second = await admitRequest(db, {
      accountId,
      userKey: "user-b",
      requestId: "req-b",
      now: oneSecondLater,
    });
    expect(second.status).toBe("ok");
  });

  test("lease_held when another request already holds the user's lease", async () => {
    const accountId = await insertAccount("free-beta");
    const now = new Date("2026-01-01T00:00:00Z");

    const first = await admitRequest(db, {
      accountId,
      userKey: "shared-user",
      requestId: "req-1",
      now,
    });
    expect(first.status).toBe("ok");

    const second = await admitRequest(db, {
      accountId,
      userKey: "shared-user",
      requestId: "req-2",
      now: new Date(now.getTime() + 1000),
    });
    expect(second.status).toBe("lease_held");
    // Just under the 15-minute lease, since one second has elapsed.
    expect(second.retryAfterSeconds).toBeGreaterThan(890);
    expect(second.retryAfterSeconds).toBeLessThanOrEqual(900);
  });

  test("lease_held does not spend a token that stays spent", async () => {
    const [plan] = await db
      .insert(plans)
      .values({ id: "tiny-3", requestsPerMinute: 60, burst: 2 })
      .returning();
    const accountId = await insertAccount(plan!.id);
    const now = new Date("2026-01-01T00:00:00Z");

    await admitRequest(db, { accountId, userKey: "u1", requestId: "req-1", now });
    // Blocked by u1's own lease: the token this call would have spent must
    // be refunded, leaving one token free for a different user.
    await admitRequest(db, { accountId, userKey: "u1", requestId: "req-2", now });

    const other = await admitRequest(db, {
      accountId,
      userKey: "u2",
      requestId: "req-3",
      now,
    });
    expect(other.status).toBe("ok");
  });

  test("an expired lease is taken over by a new request", async () => {
    const accountId = await insertAccount("free-beta");
    const t0 = new Date("2026-01-01T00:00:00Z");

    const first = await admitRequest(db, {
      accountId,
      userKey: "user-x",
      requestId: "req-1",
      now: t0,
    });
    expect(first.status).toBe("ok");

    const stillHeld = await admitRequest(db, {
      accountId,
      userKey: "user-x",
      requestId: "req-2",
      now: new Date(t0.getTime() + 14 * 60 * 1000),
    });
    expect(stillHeld.status).toBe("lease_held");

    const afterExpiry = await admitRequest(db, {
      accountId,
      userKey: "user-x",
      requestId: "req-2",
      now: new Date(t0.getTime() + 15 * 60 * 1000 + 1000),
    });
    expect(afterExpiry.status).toBe("ok");
  });
});

describe("releaseLease", () => {
  test("releases a lease held by the given request", async () => {
    const accountId = await insertAccount("free-beta");
    const now = new Date("2026-01-01T00:00:00Z");
    await admitRequest(db, { accountId, userKey: "user-r", requestId: "req-1", now });

    const released = await releaseLease(db, { userKey: "user-r", requestId: "req-1" });
    expect(released).toBe(true);

    const after = await admitRequest(db, {
      accountId,
      userKey: "user-r",
      requestId: "req-2",
      now,
    });
    expect(after.status).toBe("ok");
  });

  test("does not release a lease held by a different request", async () => {
    const accountId = await insertAccount("free-beta");
    const now = new Date("2026-01-01T00:00:00Z");
    await admitRequest(db, { accountId, userKey: "user-s", requestId: "req-1", now });

    const released = await releaseLease(db, { userKey: "user-s", requestId: "wrong-req" });
    expect(released).toBe(false);

    const stillHeld = await admitRequest(db, {
      accountId,
      userKey: "user-s",
      requestId: "req-2",
      now,
    });
    expect(stillHeld.status).toBe("lease_held");
  });

  test("releasing a lease that does not exist returns false", async () => {
    const released = await releaseLease(db, { userKey: "nobody", requestId: "req-1" });
    expect(released).toBe(false);
  });
});
