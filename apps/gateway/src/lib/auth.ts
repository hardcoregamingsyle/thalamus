// Account resolution for both the public API (Bearer th_ key) and the
// chat-app cookie session, each cached for 60 seconds per docs/architecture.md
// §4-§5 ("A key hash cache in the Worker isolate absorbs repeat lookups;
// revocation takes effect within 60 seconds" / "validates it with
// getUserByToken, cached for 60 seconds"). The caches live for the lifetime
// of one createApp() instance — one per Worker isolate in production, one
// per test.

import { and, eq, isNull } from "drizzle-orm";
import { accounts, apiKeys } from "@thalamus/db";
import type { AppDb } from "../db-types.js";
import type { Identity, IdentityUser, Clock } from "../types.js";
import { hashApiKey } from "./api-keys.js";
import { findAccountByConvexUserId, type AccountRow } from "./accounts.js";

export const SESSION_COOKIE_NAME = "th_session";
export const SESSION_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

const CACHE_TTL_MS = 60_000;

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

export interface CookieSession {
  user: IdentityUser;
  account: AccountRow | null;
}

export interface AuthCaches {
  apiKey: Map<string, CacheEntry<AccountRow | null>>;
  cookie: Map<string, CacheEntry<CookieSession | null>>;
}

export function createAuthCaches(): AuthCaches {
  return { apiKey: new Map(), cookie: new Map() };
}

export async function resolveApiKey(
  db: AppDb,
  clock: Clock,
  caches: AuthCaches,
  rawKey: string,
): Promise<AccountRow | null> {
  const nowMs = clock.now().getTime();
  const cached = caches.apiKey.get(rawKey);
  if (cached && cached.expiresAt > nowMs) return cached.value;

  const hash = await hashApiKey(rawKey);
  const [row] = await db
    .select({ account: accounts })
    .from(apiKeys)
    .innerJoin(accounts, eq(apiKeys.accountId, accounts.id))
    .where(and(eq(apiKeys.hash, hash), isNull(apiKeys.revokedAt)))
    .limit(1);

  const value = row?.account ?? null;
  caches.apiKey.set(rawKey, { value, expiresAt: nowMs + CACHE_TTL_MS });
  return value;
}

export async function resolveCookieSession(
  db: AppDb,
  identity: Identity,
  clock: Clock,
  caches: AuthCaches,
  token: string,
): Promise<CookieSession | null> {
  const nowMs = clock.now().getTime();
  const cached = caches.cookie.get(token);
  if (cached && cached.expiresAt > nowMs) return cached.value;

  const user = await identity.getUserByToken(token);
  const value = user ? { user, account: await findAccountByConvexUserId(db, user.id) } : null;
  caches.cookie.set(token, { value, expiresAt: nowMs + CACHE_TTL_MS });
  return value;
}
