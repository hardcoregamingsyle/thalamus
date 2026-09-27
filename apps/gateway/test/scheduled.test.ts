import { describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { admitRequest, sessions } from "@thalamus/db";
import { buildTestHarness, createAccount } from "./helpers.js";
import { sweepIdleSessions } from "../src/scheduled.js";

async function insertSession(
  h: Awaited<ReturnType<typeof buildTestHarness>>,
  params: { accountId: string; userKey: string; lastActivityAt: Date; source?: "api" | "chat" },
) {
  await h.db.insert(sessions).values({
    id: crypto.randomUUID(),
    accountId: params.accountId,
    userKey: params.userKey,
    model: "thalamus-sophon-1.0",
    headHash: "h",
    prevHash: null,
    source: params.source ?? "api",
    turns: 1,
    lastActivityAt: params.lastActivityAt,
  });
}

describe("idle session sweep", () => {
  test("ends an API session idle more than 30 minutes", async () => {
    const h = await buildTestHarness();
    const account = await createAccount(h);
    const idleSince = new Date(h.clock.now().getTime() - 31 * 60 * 1000);
    await insertSession(h, {
      accountId: account.id,
      userKey: "user-key-1",
      lastActivityAt: idleSince,
    });

    const result = await sweepIdleSessions({
      db: h.db,
      modelServer: h.deps.modelServer,
      clock: h.clock,
    });
    expect(result.ended).toBe(1);
    expect(result.skipped).toBe(0);

    const [row] = await h.db.select().from(sessions).where(eq(sessions.userKey, "user-key-1"));
    expect(row?.endedAt).not.toBeNull();
  });

  test("leaves a session idle less than 30 minutes alone", async () => {
    const h = await buildTestHarness();
    const account = await createAccount(h);
    const recentlyActive = new Date(h.clock.now().getTime() - 10 * 60 * 1000);
    await insertSession(h, {
      accountId: account.id,
      userKey: "user-key-2",
      lastActivityAt: recentlyActive,
    });

    const result = await sweepIdleSessions({
      db: h.db,
      modelServer: h.deps.modelServer,
      clock: h.clock,
    });
    expect(result.ended).toBe(0);

    const [row] = await h.db.select().from(sessions).where(eq(sessions.userKey, "user-key-2"));
    expect(row?.endedAt).toBeNull();
  });

  test("does not end a chat-source session", async () => {
    const h = await buildTestHarness();
    const account = await createAccount(h);
    const idleSince = new Date(h.clock.now().getTime() - 60 * 60 * 1000);
    await insertSession(h, {
      accountId: account.id,
      userKey: "user-key-3",
      lastActivityAt: idleSince,
      source: "chat",
    });

    const result = await sweepIdleSessions({
      db: h.db,
      modelServer: h.deps.modelServer,
      clock: h.clock,
    });
    expect(result.ended).toBe(0);
  });

  test("skips a session whose lease is currently held", async () => {
    const h = await buildTestHarness();
    const account = await createAccount(h);
    const idleSince = new Date(h.clock.now().getTime() - 60 * 60 * 1000);
    await insertSession(h, {
      accountId: account.id,
      userKey: "user-key-4",
      lastActivityAt: idleSince,
    });

    await admitRequest(h.db, {
      accountId: account.id,
      userKey: "user-key-4",
      requestId: "in-flight-request",
      now: h.clock.now(),
    });

    const result = await sweepIdleSessions({
      db: h.db,
      modelServer: h.deps.modelServer,
      clock: h.clock,
    });
    expect(result.ended).toBe(0);
    expect(result.skipped).toBe(1);

    const [row] = await h.db.select().from(sessions).where(eq(sessions.userKey, "user-key-4"));
    expect(row?.endedAt).toBeNull();
  });
});
