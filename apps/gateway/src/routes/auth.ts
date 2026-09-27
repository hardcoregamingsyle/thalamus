// Sign-in against the shared accounts system (docs/architecture.md §4).
// customAuth:sendOtp/verifyOtp are the email-code flow; POST /api/session is
// the OAuth callback exchange (Google/GitHub redirect back with `?token=`
// to the web app, which then hands that token to the gateway here).

import { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { AppDeps } from "../types.js";
import { apiError } from "../lib/api-error.js";
import { jsonStatus } from "../lib/http.js";
import {
  createAuthCaches,
  resolveCookieSession,
  SESSION_COOKIE_NAME,
  SESSION_COOKIE_MAX_AGE_SECONDS,
} from "../lib/auth.js";

function setSessionCookie(c: import("hono").Context, token: string): void {
  setCookie(c, SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: true,
    sameSite: "Lax",
    path: "/",
    maxAge: SESSION_COOKIE_MAX_AGE_SECONDS,
  });
}

export function createAuthRoutes(deps: AppDeps): Hono {
  const app = new Hono();
  const caches = createAuthCaches();

  app.post("/auth/otp/send", async (c) => {
    const body = await c.req.json().catch(() => null);
    const email = typeof body?.email === "string" ? body.email : null;
    if (!email) return jsonStatus(c, apiError("`email` is required"), 400);
    await deps.identity.sendOtp(email);
    return c.json({ ok: true });
  });

  app.post("/auth/otp/verify", async (c) => {
    const body = await c.req.json().catch(() => null);
    const email = typeof body?.email === "string" ? body.email : null;
    const code = typeof body?.code === "string" ? body.code : null;
    if (!email || !code) return jsonStatus(c, apiError("`email` and `code` are required"), 400);

    try {
      const result = await deps.identity.verifyOtp(email, code);
      setSessionCookie(c, result.token);
      return c.json({ ok: true, isNewUser: result.isNewUser });
    } catch {
      return jsonStatus(c, apiError("invalid or expired code"), 401);
    }
  });

  app.post("/session", async (c) => {
    const body = await c.req.json().catch(() => null);
    const token = typeof body?.token === "string" ? body.token : null;
    if (!token) return jsonStatus(c, apiError("`token` is required"), 400);

    const session = await resolveCookieSession(deps.db, deps.identity, deps.clock, caches, token);
    if (!session) return jsonStatus(c, apiError("invalid session token"), 401);

    setSessionCookie(c, token);
    return c.json({ ok: true });
  });

  app.post("/auth/signout", async (c) => {
    const token = getCookie(c, SESSION_COOKIE_NAME);
    if (token) await deps.identity.signOut(token);
    deleteCookie(c, SESSION_COOKIE_NAME, { path: "/" });
    return c.json({ ok: true });
  });

  return app;
}
