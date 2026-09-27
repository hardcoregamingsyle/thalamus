import { Hono } from "hono";
import { asc, eq, isNull } from "drizzle-orm";
import { accounts, waitlist } from "@thalamus/db";
import type { AppDeps } from "../types.js";
import { apiError } from "../lib/api-error.js";
import { jsonStatus } from "../lib/http.js";
import { createAuthCaches } from "../lib/auth.js";
import { isAdminRequest } from "../lib/admin.js";

export function createAdminRoutes(deps: AppDeps): Hono {
  const app = new Hono();
  const caches = createAuthCaches();

  app.use("/admin/*", async (c, next) => {
    if (!(await isAdminRequest(c, deps, caches))) {
      return jsonStatus(c, apiError("unauthorized"), 401);
    }
    await next();
  });

  app.get("/admin/waitlist", async (c) => {
    const rows = await deps.db
      .select({
        accountId: accounts.id,
        email: waitlist.email,
        position: waitlist.position,
        createdAt: waitlist.createdAt,
      })
      .from(waitlist)
      .innerJoin(accounts, eq(accounts.convexUserId, waitlist.convexUserId))
      .where(isNull(waitlist.invitedAt))
      .orderBy(asc(waitlist.position));
    return c.json({ waitlist: rows });
  });

  app.post("/admin/invite", async (c) => {
    const body = await c.req.json().catch(() => null);
    const accountId = typeof body?.accountId === "string" ? body.accountId : null;
    if (!accountId) return jsonStatus(c, apiError("`accountId` is required"), 400);

    const [account] = await deps.db
      .update(accounts)
      .set({ status: "invited", updatedAt: deps.clock.now() })
      .where(eq(accounts.id, accountId))
      .returning();
    if (!account) return jsonStatus(c, apiError("account not found"), 404);

    await deps.db
      .update(waitlist)
      .set({ invitedAt: deps.clock.now() })
      .where(eq(waitlist.convexUserId, account.convexUserId));

    return c.json({ account: { id: account.id, status: account.status } });
  });

  return app;
}
