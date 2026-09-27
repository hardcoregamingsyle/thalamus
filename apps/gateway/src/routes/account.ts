import { createSessionHono } from "../lib/hono-app.js";
import type { AppDeps } from "../types.js";
import { createAuthCaches } from "../lib/auth.js";
import { requireSession } from "../lib/require-session.js";
import { getWaitlistPosition, joinWaitlist } from "../lib/accounts.js";
import { isAdminEmail } from "../lib/admin.js";

export function createAccountRoutes(deps: AppDeps) {
  const app = createSessionHono();
  const caches = createAuthCaches();
  // Applied per-route (not `app.use("*", ...)`): every route module in
  // app.ts is mounted at the same "/" prefix and merged into one flat
  // router, so a wildcard middleware here would also intercept every
  // sibling module's routes (e.g. /admin/*), not just this file's own.
  const session = requireSession(deps, caches);

  app.get("/me", session, async (c) => {
    const { user, account } = c.get("session");
    const waitlistPosition = account ? await getWaitlistPosition(deps.db, user.id) : null;
    return c.json({
      user: { id: user.id, email: user.email },
      account: account ? { id: account.id, status: account.status, plan: account.plan } : null,
      waitlistPosition,
      isAdmin: isAdminEmail(user.email, deps.config.adminEmails),
    });
  });

  app.post("/waitlist/join", session, async (c) => {
    const { user } = c.get("session");
    const body = await c.req.json().catch(() => null);
    const source = typeof body?.source === "string" ? body.source : null;

    const { account, waitlistPosition } = await joinWaitlist(deps.db, {
      convexUserId: user.id,
      email: user.email,
      source,
    });

    return c.json({
      account: { id: account.id, status: account.status, plan: account.plan },
      waitlistPosition,
    });
  });

  return app;
}
