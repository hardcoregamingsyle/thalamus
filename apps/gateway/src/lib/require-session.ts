import type { MiddlewareHandler } from "hono";
import { getCookie } from "hono/cookie";
import type { AppDeps } from "../types.js";
import type { AppEnv } from "./hono-app.js";
import { apiError } from "./api-error.js";
import { jsonStatus } from "./http.js";
import { resolveCookieSession, SESSION_COOKIE_NAME, type AuthCaches } from "./auth.js";

/** Requires the th_session cookie; sets `session` on the Hono context. */
export function requireSession(deps: AppDeps, caches: AuthCaches): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const token = getCookie(c, SESSION_COOKIE_NAME);
    if (!token) return jsonStatus(c, apiError("not signed in"), 401);

    const session = await resolveCookieSession(deps.db, deps.identity, deps.clock, caches, token);
    if (!session) return jsonStatus(c, apiError("not signed in"), 401);

    c.set("session", session);
    await next();
  };
}
