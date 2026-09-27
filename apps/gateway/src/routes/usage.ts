import { and, desc, eq, gte } from "drizzle-orm";
import { usageDaily } from "@thalamus/db";
import { createSessionHono } from "../lib/hono-app.js";
import type { AppDeps } from "../types.js";
import { createAuthCaches } from "../lib/auth.js";
import { requireSession } from "../lib/require-session.js";

function dayString(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function createUsageRoutes(deps: AppDeps) {
  const app = createSessionHono();
  const caches = createAuthCaches();
  // Applied per-route, not `app.use("*", ...)`: every route module in app.ts
  // is mounted at the same "/" prefix and merged into one flat router, so a
  // wildcard middleware here would also intercept sibling modules' routes.
  const session = requireSession(deps, caches);

  app.get("/usage", session, async (c) => {
    const { account } = c.get("session");
    if (!account) return c.json({ days: [] });

    const days = Math.min(365, Math.max(1, Number(c.req.query("days") ?? 30)));
    const since = new Date(deps.clock.now());
    since.setUTCDate(since.getUTCDate() - days);

    const rows = await deps.db
      .select()
      .from(usageDaily)
      .where(and(eq(usageDaily.accountId, account.id), gte(usageDaily.day, dayString(since))))
      .orderBy(desc(usageDaily.day));

    return c.json({
      days: rows.map((row) => ({
        day: row.day,
        model: row.model,
        requests: row.requests,
        charsIn: row.charsIn,
        charsOut: row.charsOut,
      })),
    });
  });

  return app;
}
