import { describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { usageDaily, usageEvents } from "@thalamus/db";
import { buildTestHarness, createAccount } from "./helpers.js";
import { processUsageBatch, processUsageEvent } from "../src/queue.js";
import type { UsageEvent } from "../src/types.js";

function makeEvent(overrides: Partial<UsageEvent> = {}, accountId: string): UsageEvent {
  return {
    requestId: crypto.randomUUID(),
    accountId,
    model: "thalamus-sophon-1.0",
    charsIn: 10,
    charsOut: 20,
    durationMs: 5,
    status: "ok",
    occurredAtMs: Date.parse("2026-10-01T00:00:00Z"),
    ...overrides,
  };
}

describe("usage queue consumer", () => {
  test("inserts usage_events and increments usage_daily", async () => {
    const h = await buildTestHarness();
    const account = await createAccount(h);
    const event = makeEvent({}, account.id);

    await processUsageEvent({ db: h.db }, event);

    const [row] = await h.db
      .select()
      .from(usageEvents)
      .where(eq(usageEvents.requestId, event.requestId));
    expect(row?.charsIn).toBe(10);
    expect(row?.charsOut).toBe(20);

    const [daily] = await h.db
      .select()
      .from(usageDaily)
      .where(eq(usageDaily.accountId, account.id));
    expect(daily?.requests).toBe(1);
    expect(daily?.charsIn).toBe(10);
    expect(daily?.charsOut).toBe(20);
  });

  test("a repeat delivery of the same request_id is idempotent", async () => {
    const h = await buildTestHarness();
    const account = await createAccount(h);
    const event = makeEvent({}, account.id);

    await processUsageEvent({ db: h.db }, event);
    await processUsageEvent({ db: h.db }, event);

    const rows = await h.db
      .select()
      .from(usageEvents)
      .where(eq(usageEvents.requestId, event.requestId));
    expect(rows).toHaveLength(1);

    const [daily] = await h.db
      .select()
      .from(usageDaily)
      .where(eq(usageDaily.accountId, account.id));
    expect(daily?.requests).toBe(1);
  });

  test("two different requests on the same day accumulate", async () => {
    const h = await buildTestHarness();
    const account = await createAccount(h);
    await processUsageEvent({ db: h.db }, makeEvent({ charsIn: 5, charsOut: 5 }, account.id));
    await processUsageEvent({ db: h.db }, makeEvent({ charsIn: 7, charsOut: 3 }, account.id));

    const [daily] = await h.db
      .select()
      .from(usageDaily)
      .where(eq(usageDaily.accountId, account.id));
    expect(daily?.requests).toBe(2);
    expect(daily?.charsIn).toBe(12);
    expect(daily?.charsOut).toBe(8);
  });

  test("processUsageBatch acks each message and tolerates a bad one via retry", async () => {
    const h = await buildTestHarness();
    const account = await createAccount(h);
    const acked: string[] = [];
    const retried: string[] = [];

    const good = makeEvent({ requestId: "ok-1" }, account.id);
    // accountId that doesn't exist violates the FK and should be retried, not acked.
    const bad = makeEvent({ requestId: "bad-1", accountId: crypto.randomUUID() }, account.id);

    await processUsageBatch({ db: h.db }, [
      {
        body: good,
        ack: () => acked.push(good.requestId),
        retry: () => retried.push(good.requestId),
      },
      { body: bad, ack: () => acked.push(bad.requestId), retry: () => retried.push(bad.requestId) },
    ]);

    expect(acked).toEqual(["ok-1"]);
    expect(retried).toEqual(["bad-1"]);
  });
});
