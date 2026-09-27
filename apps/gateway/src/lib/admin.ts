// Admin resolution (docs task brief §"Admin"): a request is admin if it
// carries Bearer ADMIN_TOKEN (constant-time compare) OR its th_session
// user's email (case-insensitive) is in ADMIN_EMAILS (comma-separated).

import type { Context } from "hono";
import { getCookie } from "hono/cookie";
import type { AppDeps } from "../types.js";
import { constantTimeEqual } from "./crypto.js";
import { resolveCookieSession, SESSION_COOKIE_NAME, type AuthCaches } from "./auth.js";

/** Case-insensitive membership check against a comma-separated email list. */
export function isAdminEmail(email: string | null, adminEmailsCsv: string): boolean {
  if (!email) return false;
  const normalized = email.trim().toLowerCase();
  if (!normalized) return false;
  return adminEmailsCsv
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .includes(normalized);
}

function hasValidAdminBearer(c: Context, deps: AppDeps): boolean {
  const header = c.req.header("authorization");
  const match = header ? /^Bearer\s+(.+)$/i.exec(header) : null;
  return Boolean(match && constantTimeEqual(match[1] as string, deps.config.adminToken));
}

/** True if this request authenticates as an admin, by either path above. */
export async function isAdminRequest(
  c: Context,
  deps: AppDeps,
  caches: AuthCaches,
): Promise<boolean> {
  if (hasValidAdminBearer(c, deps)) return true;

  const cookie = getCookie(c, SESSION_COOKIE_NAME);
  if (!cookie) return false;
  const session = await resolveCookieSession(deps.db, deps.identity, deps.clock, caches, cookie);
  return isAdminEmail(session?.user.email ?? null, deps.config.adminEmails);
}
