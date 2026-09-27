// Account resolution for the public /v1/* API: an API key, or (for the
// console playground) the chat-app cookie session (docs/architecture.md §5
// step 1: "Resolve the API key (or the chat-app cookie) to an account.").

import type { Context } from "hono";
import { getCookie } from "hono/cookie";
import type { ApiErrorCode } from "@thalamus/contract";
import type { AppDeps } from "../types.js";
import {
  resolveApiKey,
  resolveCookieSession,
  type AuthCaches,
  SESSION_COOKIE_NAME,
} from "./auth.js";
import type { AccountRow } from "./accounts.js";

export type V1AuthResult =
  { ok: true; account: AccountRow } | { ok: false; code: ApiErrorCode; message: string };

export async function resolveV1Account(
  c: Context,
  deps: AppDeps,
  caches: AuthCaches,
): Promise<V1AuthResult> {
  const authHeader = c.req.header("authorization");
  if (authHeader) {
    const match = /^Bearer\s+(.+)$/i.exec(authHeader);
    if (!match)
      return { ok: false, code: "invalid_api_key", message: "malformed Authorization header" };
    const account = await resolveApiKey(deps.db, deps.clock, caches, match[1] as string);
    if (!account) return { ok: false, code: "invalid_api_key", message: "invalid API key" };
    return { ok: true, account };
  }

  const cookie = getCookie(c, SESSION_COOKIE_NAME);
  if (cookie) {
    const session = await resolveCookieSession(deps.db, deps.identity, deps.clock, caches, cookie);
    if (!session || !session.account) {
      return { ok: false, code: "invalid_api_key", message: "not signed in" };
    }
    return { ok: true, account: session.account };
  }

  return { ok: false, code: "invalid_api_key", message: "missing Authorization header" };
}
