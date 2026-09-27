// Shared test harness: PGlite (via @thalamus/db/test-db), an in-process
// mock model server (@thalamus/mock-model-server) and a fake identity
// provider, wired the same way src/index.ts wires the production deps.

import { createTestDb, type TestDb } from "@thalamus/db/test-db";
import { accounts, apiKeys } from "@thalamus/db";
import { createMockModelServer, type MockModelServer } from "@thalamus/mock-model-server";
import { createApp } from "../src/app.js";
import { createModelServerClient } from "../src/lib/model-server-client.js";
import { createApiKeyMaterial } from "../src/lib/api-keys.js";
import type { AccountRow } from "../src/lib/accounts.js";
import type {
  AppDeps,
  Clock,
  Identity,
  IdentityUser,
  UsageEvent,
  VerifyOtpResult,
} from "../src/types.js";

export const MODEL_SERVER_SECRET = "test-model-server-secret";
export const USER_KEY_SECRET = "test-user-key-secret";
export const ADMIN_TOKEN = "test-admin-token";
// Deliberately mixed case, to exercise the case-insensitive comparison.
export const ADMIN_EMAILS = "admin@example.com,Second-Admin@Example.com";

export class FakeIdentity implements Identity {
  private usersByToken = new Map<string, IdentityUser>();
  private pendingOtps = new Map<string, string>();
  private nextUserSeq = 1;

  /** Test hook: register a signed-in user directly, bypassing OTP. */
  registerUser(token: string, user: IdentityUser): void {
    this.usersByToken.set(token, user);
  }

  async getUserByToken(token: string): Promise<IdentityUser | null> {
    return this.usersByToken.get(token) ?? null;
  }

  async sendOtp(email: string): Promise<void> {
    this.pendingOtps.set(email, "000000");
  }

  async verifyOtp(email: string, code: string): Promise<VerifyOtpResult> {
    const expected = this.pendingOtps.get(email);
    if (!expected || expected !== code) {
      throw new Error("invalid or expired code");
    }
    this.pendingOtps.delete(email);
    const token = `token-${email}`;
    const isNewUser = ![...this.usersByToken.values()].some((u) => u.email === email);
    const userId = `user-${this.nextUserSeq++}`;
    this.usersByToken.set(token, { id: userId, email });
    return { token, userId, isNewUser };
  }

  async signOut(token: string): Promise<void> {
    this.usersByToken.delete(token);
  }
}

export class MutableClock implements Clock {
  constructor(private current: Date) {}
  now(): Date {
    return this.current;
  }
  set(date: Date): void {
    this.current = date;
  }
  advanceMs(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }
}

export interface TestHarness {
  db: TestDb;
  identity: FakeIdentity;
  clock: MutableClock;
  modelServer: MockModelServer;
  usageEvents: UsageEvent[];
  deps: AppDeps;
  app: ReturnType<typeof createApp>;
}

export async function buildTestHarness(
  options: {
    perDeltaDelayMs?: number;
    userFileCapBytes?: number;
    sessionFileCapBytes?: number;
    /** Defaults to true; set false to simulate MODEL_SERVER_URL unset. */
    modelServerConfigured?: boolean;
  } = {},
): Promise<TestHarness> {
  const db = await createTestDb();

  const identity = new FakeIdentity();
  const clock = new MutableClock(new Date("2026-10-01T00:00:00Z"));
  const mockServer = createMockModelServer({
    secret: MODEL_SERVER_SECRET,
    perDeltaDelayMs: options.perDeltaDelayMs,
    userFileCapBytes: options.userFileCapBytes,
    sessionFileCapBytes: options.sessionFileCapBytes,
  });
  const usageEvents: UsageEvent[] = [];

  const deps: AppDeps = {
    db,
    identity,
    modelServer: createModelServerClient({
      baseUrl: "http://mock-model-server",
      secret: MODEL_SERVER_SECRET,
      fetchImpl: (request) => mockServer.fetch(request),
    }),
    usageSink: {
      send(event) {
        usageEvents.push(event);
      },
    },
    clock,
    config: {
      userKeySecret: USER_KEY_SECRET,
      adminToken: ADMIN_TOKEN,
      adminEmails: ADMIN_EMAILS,
      modelServerConfigured: options.modelServerConfigured ?? true,
    },
  };

  return { db, identity, clock, modelServer: mockServer, usageEvents, deps, app: createApp(deps) };
}

export async function createAccount(
  h: TestHarness,
  options: {
    status?: "waitlisted" | "invited" | "active" | "suspended";
    convexUserId?: string;
  } = {},
): Promise<AccountRow> {
  const [account] = await h.db
    .insert(accounts)
    .values({
      convexUserId: options.convexUserId ?? `convex-user-${crypto.randomUUID()}`,
      status: options.status ?? "invited",
    })
    .returning();
  if (!account) throw new Error("failed to create test account");
  return account;
}

export async function createApiKeyFor(h: TestHarness, accountId: string): Promise<string> {
  const material = await createApiKeyMaterial();
  await h.db.insert(apiKeys).values({ accountId, hash: material.hash, last4: material.last4 });
  return material.raw;
}

/** Registers `account`'s user with the fake identity and returns a cookie token for it. */
export function signInAs(h: TestHarness, account: AccountRow): string {
  const token = `token-${account.convexUserId}`;
  h.identity.registerUser(token, {
    id: account.convexUserId,
    email: `${account.convexUserId}@example.com`,
  });
  return token;
}

/** The OpenAI-shaped error envelope every /v1 error response uses. */
export interface ApiErrorJson {
  error: { code: string; message?: string; waitlist_position?: number };
}

/** `res.json()` typed as `T` instead of `unknown`, for terser assertions in tests. */
export async function readJson<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

/** Parses an OpenAI-chunk SSE response body and concatenates the delta content. */
export async function collectStreamedContent(res: Response): Promise<string> {
  const text = await res.text();
  let content = "";
  for (const block of text.split("\n\n")) {
    if (!block.startsWith("data:")) continue;
    const data = block.slice("data:".length).trim();
    if (data === "[DONE]") continue;
    const parsed = JSON.parse(data) as { choices?: { delta?: { content?: string } }[] };
    content += parsed.choices?.[0]?.delta?.content ?? "";
  }
  return content;
}
