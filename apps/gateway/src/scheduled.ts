// The idle-session sweep (docs/architecture.md §6, "Session end"): every 5
// minutes, end API sessions idle more than 30 minutes, under the per-user
// write lease so an idle sweep can never race a request that just resumed
// the same session.

import { and, eq, isNull, lt } from "drizzle-orm";
import { admitRequest, releaseLease, sessions } from "@thalamus/db";
import type { AppDb } from "./db-types.js";
import type { Clock, ModelServerClient } from "./types.js";

const IDLE_THRESHOLD_MS = 30 * 60 * 1000;

export interface ScheduledDeps {
  db: AppDb;
  modelServer: ModelServerClient;
  clock: Clock;
}

export interface SweepResult {
  ended: number;
  skipped: number;
}

export async function sweepIdleSessions(deps: ScheduledDeps): Promise<SweepResult> {
  const now = deps.clock.now();
  const cutoff = new Date(now.getTime() - IDLE_THRESHOLD_MS);

  const idle = await deps.db
    .select()
    .from(sessions)
    .where(
      and(
        eq(sessions.source, "api"),
        isNull(sessions.endedAt),
        lt(sessions.lastActivityAt, cutoff),
      ),
    );

  let ended = 0;
  let skipped = 0;

  for (const session of idle) {
    const requestId = crypto.randomUUID();
    const admit = await admitRequest(deps.db, {
      accountId: session.accountId,
      userKey: session.userKey,
      requestId,
      now,
    });

    if (admit.status !== "ok") {
      // A generate call is in flight for this user right now; leave the
      // session for the next sweep rather than race it.
      skipped++;
      continue;
    }

    try {
      await deps.modelServer.endSession(session.id);
      await deps.db.update(sessions).set({ endedAt: now }).where(eq(sessions.id, session.id));
      ended++;
    } finally {
      await releaseLease(deps.db, { userKey: session.userKey, requestId });
    }
  }

  return { ended, skipped };
}
