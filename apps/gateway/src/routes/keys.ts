import { and, eq } from "drizzle-orm";
import { apiKeys } from "@thalamus/db";
import { createSessionHono } from "../lib/hono-app.js";
import type { AppDeps } from "../types.js";
import { createAuthCaches } from "../lib/auth.js";
import { requireSession } from "../lib/require-session.js";
import { requireInvitedAccount } from "../lib/require-invited.js";
import { apiError } from "../lib/api-error.js";
import { jsonStatus } from "../lib/http.js";
import { createApiKeyMaterial } from "../lib/api-keys.js";

export function createKeysRoutes(deps: AppDeps) {
  const app = createSessionHono();
  const caches = createAuthCaches();
  // Applied per-route, not `app.use("*", ...)`: every route module in app.ts
  // is mounted at the same "/" prefix and merged into one flat router, so a
  // wildcard middleware here would also intercept sibling modules' routes.
  const guard = [requireSession(deps, caches), requireInvitedAccount] as const;

  app.get("/keys", ...guard, async (c) => {
    const { account } = c.get("session");
    const rows = await deps.db
      .select({
        id: apiKeys.id,
        last4: apiKeys.last4,
        name: apiKeys.name,
        createdAt: apiKeys.createdAt,
        revokedAt: apiKeys.revokedAt,
      })
      .from(apiKeys)
      .where(eq(apiKeys.accountId, account!.id));
    return c.json({ keys: rows });
  });

  app.post("/keys", ...guard, async (c) => {
    const { account } = c.get("session");
    const body = await c.req.json().catch(() => null);
    const name = typeof body?.name === "string" ? body.name : null;

    const material = await createApiKeyMaterial();
    const [row] = await deps.db
      .insert(apiKeys)
      .values({ accountId: account!.id, hash: material.hash, last4: material.last4, name })
      .returning({ id: apiKeys.id, createdAt: apiKeys.createdAt });
    if (!row) throw new Error("failed to create API key");

    return c.json({
      id: row.id,
      name,
      last4: material.last4,
      createdAt: row.createdAt,
      key: material.raw,
    });
  });

  app.delete("/keys/:id", ...guard, async (c) => {
    const { account } = c.get("session");
    const id = c.req.param("id");

    const [revoked] = await deps.db
      .update(apiKeys)
      .set({ revokedAt: deps.clock.now() })
      .where(and(eq(apiKeys.id, id), eq(apiKeys.accountId, account!.id)))
      .returning({ id: apiKeys.id });

    if (!revoked) return jsonStatus(c, apiError("key not found"), 404);
    return c.json({ ok: true });
  });

  return app;
}
