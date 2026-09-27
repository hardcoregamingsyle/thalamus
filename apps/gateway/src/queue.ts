// The usage-metering consumer (docs/architecture.md §8): idempotent insert
// into usage_events (unique on request_id) and, only when that insert
// actually happened, an increment of usage_daily. Retried deliveries of the
// same request_id are therefore harmless. Usage lives only in Postgres
// (usage_events + usage_daily); there is no separate dashboard-only copy.

import { sql } from "drizzle-orm";
import { usageDaily, usageEvents } from "@thalamus/db";
import type { AppDb } from "./db-types.js";
import type { UsageEvent } from "./types.js";

export interface QueueDeps {
  db: AppDb;
}

function dayString(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export async function processUsageEvent(deps: QueueDeps, event: UsageEvent): Promise<void> {
  const [inserted] = await deps.db
    .insert(usageEvents)
    .values({
      requestId: event.requestId,
      accountId: event.accountId,
      model: event.model,
      charsIn: event.charsIn,
      charsOut: event.charsOut,
      durationMs: event.durationMs,
      status: event.status,
      createdAt: new Date(event.occurredAtMs),
    })
    .onConflictDoNothing({ target: usageEvents.requestId })
    .returning({ requestId: usageEvents.requestId });

  if (inserted) {
    const day = dayString(event.occurredAtMs);
    await deps.db
      .insert(usageDaily)
      .values({
        accountId: event.accountId,
        day,
        model: event.model,
        requests: 1,
        charsIn: event.charsIn,
        charsOut: event.charsOut,
      })
      .onConflictDoUpdate({
        target: [usageDaily.accountId, usageDaily.day, usageDaily.model],
        set: {
          requests: sql`${usageDaily.requests} + 1`,
          charsIn: sql`${usageDaily.charsIn} + ${event.charsIn}`,
          charsOut: sql`${usageDaily.charsOut} + ${event.charsOut}`,
        },
      });
  }
}

/** `export function queue()` in src/index.ts calls this per Cloudflare Queue batch. */
export async function processUsageBatch(
  deps: QueueDeps,
  messages: readonly { body: UsageEvent; ack: () => void; retry: () => void }[],
): Promise<void> {
  for (const message of messages) {
    try {
      await processUsageEvent(deps, message.body);
      message.ack();
    } catch {
      message.retry();
    }
  }
}
