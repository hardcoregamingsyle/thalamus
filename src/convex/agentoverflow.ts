import {
  action,
  mutation,
  query,
  internalAction,
  internalMutation,
  internalQuery,
  type QueryCtx,
  type MutationCtx,
} from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { Id, Doc } from "./_generated/dataModel";
import { callModel } from "./agentCore";

// ── AgentOverflow: Stack Overflow for AI agents ──────────────────────────────
// Keys, credits, and learnings live here on the shared deployment; the corpus
// (vectors + graph) lives on the GCP VM behind AO_VM_URL / AO_INTERNAL_SECRET.
// Public HTTP endpoints are in agentoverflowHttp.ts, routed from http.ts.

export const DAILY_REFILL = 10;
// Flat 1 credit for everything, on purpose: right now the corpus is worth
// more than the revenue. Raise these two numbers when that flips.
export const COST_SEARCH = 1;
export const COST_ANSWER = 1;
export const RATE_LIMIT_PER_MIN = 60;
const MAX_ACTIVE_KEYS = 10;

// Keyless MCP (anonymous tier): try the corpus with no account at all, capped
// per client IP per day, with gold-tier answers hidden until you sign up.
export const AO_ANON_DAILY_LIMIT = 1000;
// The quota an admin-minted key advertises to the VM — effectively unlimited.
const ADMIN_UNLIMITED_QUOTA = 1_000_000_000;

// Contribution tiers: points from accepted learnings buy a bigger daily
// refill. Points per accepted learning: low=1, medium=2, gold=5. The ladder
// works both ways — points decay ~1%/day (stop teaching, start sliding) and
// trash submissions cost a point. Stored as a float; floored for display.
export const POINTS_DAILY_DECAY = 0.99;
// dailyRefill is AgentBucks-style credits/day (spent on answer synthesis).
// dailySearch is the free VM-served search allowance/day — the lurker gets
// StackOverflow parity (10k) and it climbs from there; burstPerMin caps how
// fast one key may hammer the corpus. Search quotas are pushed to the VM and
// enforced there (see syncKeysToVm), so the hot path never touches Convex.
export const CONTRIB_TIERS = [
  { name: "lurker", minPoints: 0, dailyRefill: 10, dailySearch: 10_000, burstPerMin: 120 },
  { name: "contributor", minPoints: 5, dailyRefill: 15, dailySearch: 25_000, burstPerMin: 180 },
  { name: "regular", minPoints: 15, dailyRefill: 20, dailySearch: 50_000, burstPerMin: 300 },
  { name: "veteran", minPoints: 40, dailyRefill: 30, dailySearch: 100_000, burstPerMin: 600 },
  { name: "legend", minPoints: 100, dailyRefill: 50, dailySearch: 250_000, burstPerMin: 1200 },
];

export function pointsForLearningTier(tier: string | null): number {
  if (tier === "gold") return 5;
  if (tier === "medium") return 2;
  if (tier === "low") return 1;
  return 0;
}

export function contribTierFor(points: number) {
  let current = CONTRIB_TIERS[0];
  for (const t of CONTRIB_TIERS) {
    if (points >= t.minPoints) current = t;
  }
  return current;
}

export function nextContribTier(points: number) {
  return CONTRIB_TIERS.find((t) => t.minPoints > points) ?? null;
}

// Approved tier-increase applications set users.aoCustomRefill; whichever of
// the ladder and the grant is higher wins.
export function effectiveRefill(points: number, customRefill: number | undefined): number {
  return Math.max(contribTierFor(points).dailyRefill, customRefill ?? 0);
}

// Free search allowance + burst for a user, tier-derived. A granted
// aoCustomSearchQuota (from an approved tier-increase) can only raise the
// daily figure, never lower it below the tier floor.
export function searchQuotaFor(
  points: number,
  customQuota: number | undefined,
): { dailyQuota: number; burstPerMin: number } {
  const tier = contribTierFor(points);
  return {
    dailyQuota: Math.max(tier.dailySearch, customQuota ?? 0),
    burstPerMin: tier.burstPerMin,
  };
}

// Error message constants double as machine-readable codes for the HTTP layer.
export const ERR_INSUFFICIENT = "AO_INSUFFICIENT_CREDITS";
export const ERR_RATE_LIMITED = "AO_RATE_LIMITED";
export const ERR_UNCONFIGURED = "AO_BACKEND_UNCONFIGURED";

// ── Helpers ───────────────────────────────────────────────────────────────────

async function getUserIdByToken(ctx: { db: QueryCtx["db"] }, token: string) {
  const session = await ctx.db
    .query("customSessions")
    .withIndex("by_token", (q) => q.eq("token", token))
    .first();
  if (!session || session.expiresAt < Date.now()) return null;
  return session.userId;
}

// Same alphabet/shape as userApiKeys.ts, different prefix. Drawn from the
// CSPRNG, not Math.random — these are bearer credentials, and a predictable
// generator would let key n leak key n+1. Bytes >= the largest multiple of
// the alphabet size are rejected so every character stays equally likely.
export function generateAoKey(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  const limit = 256 - (256 % chars.length);
  let key = "ao_";
  const bytes = new Uint8Array(64);
  let i = bytes.length;
  while (key.length < 35) {
    if (i >= bytes.length) {
      crypto.getRandomValues(bytes);
      i = 0;
    }
    const b = bytes[i++];
    if (b < limit) key += chars[b % chars.length];
  }
  return key;
}

// SHA-256 via SubtleCrypto — actions/httpActions only, never mutations.
export async function hashAoKey(key: string): Promise<string> {
  const enc = new TextEncoder();
  const hashBuffer = await crypto.subtle.digest("SHA-256", enc.encode(key));
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// Score → tier. Anything under 5 is trash and never touches the corpus.
export function tierForScore(score: number): string | null {
  if (score < 5) return null;
  if (score <= 7) return "low";
  if (score <= 9) return "medium";
  return "gold";
}

// Settlement: teach the corpus something good, earn a credit — one learning,
// one free query. Gold pays a bounty. Trash costs you.
export function rewardForScore(score: number): number {
  if (score <= 4) return -1;
  if (score === 10) return 3;
  return 1;
}

export function validateLearningInput(args: {
  title: string;
  problem: string;
  solution: string;
  tags: string[];
}): string | null {
  if (args.title.trim().length < 8 || args.title.length > 200)
    return "title must be 8-200 characters";
  if (args.problem.trim().length < 20 || args.problem.length > 20000)
    return "problem must be 20-20000 characters";
  if (args.solution.trim().length < 20 || args.solution.length > 20000)
    return "solution must be 20-20000 characters";
  if (args.tags.length > 5) return "at most 5 tags";
  if (args.tags.some((t) => t.trim().length === 0 || t.length > 35))
    return "tags must be 1-35 characters";
  return null;
}

export function normalizeTags(tags: string[]): string[] {
  return [...new Set(tags.map((t) => t.trim().toLowerCase()).filter((t) => t.length > 0))];
}

// Fetch against the VM corpus API. Throws ERR_UNCONFIGURED until the operator
// sets AO_VM_URL + AO_INTERNAL_SECRET in the Convex dashboard.
//
// Hard 15s timeout: a slow or hung VM (normal during bulk loads) must fail
// fast into the caller's refund path instead of pinning the action open —
// callers charge before this fetch, so "hangs forever" means "charged and
// nothing came back".
const VM_FETCH_TIMEOUT_MS = 15_000;

export async function vmFetch(path: string, body?: unknown, method = "POST"): Promise<Response> {
  const base = process.env.AO_VM_URL;
  const secret = process.env.AO_INTERNAL_SECRET;
  if (!base || !secret) throw new Error(ERR_UNCONFIGURED);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), VM_FETCH_TIMEOUT_MS);
  try {
    return await fetch(`${base.replace(/\/$/, "")}${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        "X-AO-Internal-Secret": secret,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: ctrl.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

// One aoDailyActiveUsers row per user per UTC day; writes throttled to one
// per 5 minutes, same as the thalamus DAU tracker.
export async function recordAoDau(
  ctx: MutationCtx,
  userId: Id<"users">,
  source: "site" | "api",
): Promise<void> {
  const now = Date.now();
  const dateKey = new Date(now).toISOString().slice(0, 10);
  const existing = await ctx.db
    .query("aoDailyActiveUsers")
    .withIndex("by_user_and_date", (q) => q.eq("userId", userId).eq("dateKey", dateKey))
    .unique();
  if (existing) {
    if (now - existing.lastSeenAt < 5 * 60 * 1000) return;
    await ctx.db.patch(existing._id, { lastSeenAt: now, pings: existing.pings + 1 });
  } else {
    await ctx.db.insert("aoDailyActiveUsers", {
      userId,
      dateKey,
      source,
      firstSeenAt: now,
      lastSeenAt: now,
      pings: 1,
    });
  }
}

// Site-side DAU ping — the layout fires this once per load for signed-in users.
export const pingDau = mutation({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const userId = await getUserIdByToken(ctx, args.token);
    if (!userId) return;
    await recordAoDau(ctx, userId, "site");
  },
});

async function insertLearningCore(
  ctx: MutationCtx,
  userId: Id<"users">,
  args: { title: string; problem: string; solution: string; tags: string[] },
): Promise<Id<"aoLearnings">> {
  const tags = normalizeTags(args.tags);
  const err = validateLearningInput({ ...args, tags });
  if (err) throw new Error(err);
  const learningId = await ctx.db.insert("aoLearnings", {
    userId,
    title: args.title.trim(),
    problem: args.problem.trim(),
    solution: args.solution.trim(),
    tags,
    status: "pending",
    createdAt: Date.now(),
  });
  await ctx.scheduler.runAfter(0, internal.agentoverflow.scoreLearning, { learningId });
  return learningId;
}

function learningView(l: Doc<"aoLearnings">) {
  return {
    id: l._id,
    title: l.title,
    status: l.status,
    score: l.score ?? null,
    tier: l.tier ?? null,
    scoreRationale: l.scoreRationale ?? null,
    creditsDelta: l.creditsDelta ?? null,
    createdAt: l.createdAt,
  };
}

// ── Dashboard-facing functions (custom session token auth) ───────────────────

export const createApiKey = action({
  args: { token: v.string(), name: v.string() },
  handler: async (
    ctx,
    args,
  ): Promise<{ keyId: string; fullKey: string; keyPrefix: string }> => {
    const userId = await ctx.runQuery(internal.userApiKeys.getSessionUserId, {
      token: args.token,
    });
    if (!userId) throw new Error("Unauthorized");
    if (args.name.trim().length === 0 || args.name.length > 60)
      throw new Error("Key name must be 1-60 characters");

    const fullKey = generateAoKey();
    const keyHash = await hashAoKey(fullKey);
    const keyId = "ao_" + fullKey.slice(3, 19);
    const keyPrefix = fullKey.slice(0, 12) + "...";

    await ctx.runMutation(internal.agentoverflow.insertApiKey, {
      userId,
      keyId,
      keyHash,
      keyPrefix,
      name: args.name.trim(),
    });

    return { keyId, fullKey, keyPrefix };
  },
});

export const insertApiKey = internalMutation({
  args: {
    userId: v.id("users"),
    keyId: v.string(),
    keyHash: v.string(),
    keyPrefix: v.string(),
    name: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("aoApiKeys")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .collect();
    if (existing.filter((k) => k.isActive).length >= MAX_ACTIVE_KEYS) {
      throw new Error(`At most ${MAX_ACTIVE_KEYS} active keys — revoke one first`);
    }
    // First touch of AgentOverflow: seed the free daily balance.
    const user = await ctx.db.get(args.userId);
    if (user && user.aoCredits === undefined) {
      await ctx.db.patch(args.userId, { aoCredits: DAILY_REFILL });
      await ctx.db.insert("aoCreditLedger", {
        userId: args.userId,
        delta: DAILY_REFILL,
        reason: "daily_refill",
        refId: "init",
        createdAt: Date.now(),
      });
    }
    await ctx.db.insert("aoApiKeys", {
      userId: args.userId,
      keyId: args.keyId,
      keyHash: args.keyHash,
      keyPrefix: args.keyPrefix,
      name: args.name,
      isActive: true,
      createdAt: Date.now(),
    });
  },
});

// The system user that owns every admin-minted key. Its own credit balance is
// irrelevant — admin keys bypass charging — so it just needs to exist to
// satisfy the userId foreign key.
const ADMIN_SYSTEM_EMAIL = "ao-admin@system.agentoverflow";

async function adminSystemUserId(ctx: MutationCtx): Promise<Id<"users">> {
  const existing = await ctx.db
    .query("users")
    .withIndex("email", (q) => q.eq("email", ADMIN_SYSTEM_EMAIL))
    .first();
  if (existing) return existing._id;
  return await ctx.db.insert("users", {
    name: "AgentOverflow Admin",
    email: ADMIN_SYSTEM_EMAIL,
  });
}

// Mint an admin key: unlimited requests, no credit charge, gold-tier visible.
// Called only from the admin backend (see agentoverflowAdmin.adminCreateApiKey),
// never the dashboard — MAX_ACTIVE_KEYS doesn't apply.
export const insertAdminKey = internalMutation({
  args: { keyId: v.string(), keyHash: v.string(), keyPrefix: v.string(), name: v.string() },
  handler: async (ctx, args): Promise<void> => {
    const userId = await adminSystemUserId(ctx);
    await ctx.db.insert("aoApiKeys", {
      userId,
      keyId: args.keyId,
      keyHash: args.keyHash,
      keyPrefix: args.keyPrefix,
      name: args.name,
      isActive: true,
      isAdmin: true,
      createdAt: Date.now(),
    });
  },
});

export const listApiKeys = query({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const userId = await getUserIdByToken(ctx, args.token);
    if (!userId) return [];
    const keys = await ctx.db
      .query("aoApiKeys")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .order("desc")
      .take(50);
    return keys.map((k) => ({
      keyId: k.keyId,
      keyPrefix: k.keyPrefix,
      name: k.name,
      isActive: k.isActive,
      lastUsedAt: k.lastUsedAt,
      createdAt: k.createdAt,
    }));
  },
});

export const revokeApiKey = mutation({
  args: { token: v.string(), keyId: v.string() },
  handler: async (ctx, args) => {
    const userId = await getUserIdByToken(ctx, args.token);
    if (!userId) throw new Error("Unauthorized");
    const key = await ctx.db
      .query("aoApiKeys")
      .withIndex("by_key_id", (q) => q.eq("keyId", args.keyId))
      .first();
    if (!key || key.userId !== userId) throw new Error("Key not found");
    await ctx.db.patch(key._id, { isActive: false });
  },
});

export const getAoAccount = query({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const userId = await getUserIdByToken(ctx, args.token);
    if (!userId) return null;
    const user = await ctx.db.get(userId);
    if (!user) return null;
    const ledger = await ctx.db
      .query("aoCreditLedger")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .order("desc")
      .take(50);
    const rawPoints = user.aoContribPoints ?? 0;
    const tier = contribTierFor(rawPoints);
    const next = nextContribTier(rawPoints);
    return {
      balance: user.aoCredits ?? DAILY_REFILL,
      points: Math.floor(rawPoints),
      dailyRefill: effectiveRefill(rawPoints, user.aoCustomRefill),
      rateLimit: user.aoCustomRateLimit ?? RATE_LIMIT_PER_MIN,
      tier: { name: tier.name, dailyRefill: tier.dailyRefill },
      nextTier: next
        ? {
            name: next.name,
            dailyRefill: next.dailyRefill,
            minPoints: next.minPoints,
            pointsNeeded: Math.ceil(next.minPoints - rawPoints),
          }
        : null,
      ledger: ledger.map((e) => ({ delta: e.delta, reason: e.reason, createdAt: e.createdAt })),
    };
  },
});

export const myLearnings = query({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const userId = await getUserIdByToken(ctx, args.token);
    if (!userId) return [];
    const learnings = await ctx.db
      .query("aoLearnings")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .order("desc")
      .take(100);
    return learnings.map(learningView);
  },
});

export const submitLearning = mutation({
  args: {
    token: v.string(),
    title: v.string(),
    problem: v.string(),
    solution: v.string(),
    tags: v.array(v.string()),
  },
  handler: async (ctx, args): Promise<Id<"aoLearnings">> => {
    const userId = await getUserIdByToken(ctx, args.token);
    if (!userId) throw new Error("Unauthorized");
    return await insertLearningCore(ctx, userId, args);
  },
});

// ── Tier-increase applications ────────────────────────────────────────────────
// The contribution ladder is the organic path; this is the fast lane — pitch
// your use case, the admin grants real numbers. One pending application at a
// time per user.

export const submitLimitRequest = mutation({
  args: { token: v.string(), useCase: v.string(), expectedDaily: v.string() },
  handler: async (ctx, args): Promise<Id<"aoLimitRequests">> => {
    const userId = await getUserIdByToken(ctx, args.token);
    if (!userId) throw new Error("Unauthorized");
    if (args.useCase.trim().length < 20 || args.useCase.length > 2000) {
      throw new Error("Tell us what you're building — 20-2000 characters.");
    }
    if (args.expectedDaily.trim().length < 1 || args.expectedDaily.length > 200) {
      throw new Error("Expected daily volume must be 1-200 characters.");
    }
    const existing = await ctx.db
      .query("aoLimitRequests")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    if (existing.some((r) => r.status === "pending")) {
      throw new Error("You already have a pending application.");
    }
    return await ctx.db.insert("aoLimitRequests", {
      userId,
      useCase: args.useCase.trim(),
      expectedDaily: args.expectedDaily.trim(),
      status: "pending",
      createdAt: Date.now(),
    });
  },
});

export const myLimitRequests = query({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const userId = await getUserIdByToken(ctx, args.token);
    if (!userId) return [];
    const requests = await ctx.db
      .query("aoLimitRequests")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .order("desc")
      .take(10);
    return requests.map((r) => ({
      id: r._id,
      status: r.status,
      useCase: r.useCase,
      adminNote: r.adminNote ?? null,
      grantedRefill: r.grantedRefill ?? null,
      grantedRateLimit: r.grantedRateLimit ?? null,
      createdAt: r.createdAt,
      resolvedAt: r.resolvedAt ?? null,
    }));
  },
});

// ── Internal: credits, key lookup, learnings ─────────────────────────────────

export const getKeyByHash = internalQuery({
  args: { keyHash: v.string() },
  handler: async (ctx, args) => {
    const key = await ctx.db
      .query("aoApiKeys")
      .withIndex("by_key_hash", (q) => q.eq("keyHash", args.keyHash))
      .first();
    if (!key || !key.isActive) return null;
    return {
      _id: key._id,
      keyId: key.keyId,
      userId: key.userId,
      isAdmin: key.isAdmin === true,
    };
  },
});

// Anonymous (keyless) daily metering, bucketed by client IP. Increments the
// UTC-day counter and returns how many calls remain; throws ERR_RATE_LIMITED
// once the IP is over AO_ANON_DAILY_LIMIT for the day.
export const chargeAnon = internalMutation({
  args: { ip: v.string() },
  handler: async (ctx, args): Promise<number> => {
    const day = new Date(Date.now()).toISOString().slice(0, 10);
    const existing = await ctx.db
      .query("aoAnonDaily")
      .withIndex("by_ip_day", (q) => q.eq("ip", args.ip).eq("day", day))
      .first();
    const count = (existing?.count ?? 0) + 1;
    if (count > AO_ANON_DAILY_LIMIT) throw new Error(ERR_RATE_LIMITED);
    if (existing) {
      await ctx.db.patch(existing._id, { count, updatedAt: Date.now() });
    } else {
      await ctx.db.insert("aoAnonDaily", { ip: args.ip, day, count, updatedAt: Date.now() });
    }
    return AO_ANON_DAILY_LIMIT - count;
  },
});

// Snapshot of every active key + its tier-derived search quota, for the VM
// key push. Full-table read: fine at launch scale (keys are capped at 10/user
// and users are few); if AgentOverflow ever crosses ~10k keys this needs
// cursor pagination to stay under Convex's per-query read limit.
export const activeKeysForSync = internalQuery({
  args: {},
  handler: async (ctx) => {
    const keys = await ctx.db.query("aoApiKeys").take(8000);
    const out: {
      key_hash: string;
      user_id: string;
      daily_quota: number;
      burst_per_min: number;
    }[] = [];
    const quotaByUser = new Map<string, { dailyQuota: number; burstPerMin: number }>();
    for (const key of keys) {
      if (!key.isActive) continue;
      let quota: { dailyQuota: number; burstPerMin: number };
      if (key.isAdmin === true) {
        // Admin keys advertise an unlimited quota regardless of their tier.
        quota = { dailyQuota: ADMIN_UNLIMITED_QUOTA, burstPerMin: ADMIN_UNLIMITED_QUOTA };
      } else {
        const cached = quotaByUser.get(key.userId);
        if (cached) {
          quota = cached;
        } else {
          const user = await ctx.db.get(key.userId);
          quota = searchQuotaFor(user?.aoContribPoints ?? 0, user?.aoCustomSearchQuota);
          quotaByUser.set(key.userId, quota);
        }
      }
      out.push({
        key_hash: key.keyHash,
        user_id: key.userId,
        daily_quota: quota.dailyQuota,
        burst_per_min: quota.burstPerMin,
      });
    }
    return out;
  },
});

// Push the active-key snapshot to the VM so it can authorize `ao_` bearer
// tokens locally (no Convex call on the search hot path). Run on a cron; a
// full replace on the VM side means a revoked/removed key drops out here and
// disappears there within one interval.
export const syncKeysToVm = internalAction({
  args: {},
  handler: async (ctx): Promise<{ pushed: number; active: number } | { skipped: string }> => {
    let keys;
    try {
      keys = await ctx.runQuery(internal.agentoverflow.activeKeysForSync, {});
    } catch (err) {
      return { skipped: err instanceof Error ? err.message : String(err) };
    }
    try {
      const res = await vmFetch("/internal/sync-keys", { keys });
      if (!res.ok) return { skipped: `VM sync failed: ${res.status}` };
      const body = (await res.json()) as { active_keys?: number };
      return { pushed: keys.length, active: body.active_keys ?? keys.length };
    } catch (err) {
      // ERR_UNCONFIGURED (no AO_VM_URL yet) or a network blip — the next cron
      // tick retries. Never throw: a failed push must not spam the logs as an
      // unhandled action error.
      return { skipped: err instanceof Error ? err.message : String(err) };
    }
  },
});

// Atomic charge/refund/metering. credits > 0 deducts, credits < 0 refunds,
// credits === 0 meters a free call (rate limit + usage row, no money moves —
// this is how MCP traffic stays free without becoming unlimited).
export const charge = internalMutation({
  args: {
    userId: v.id("users"),
    credits: v.number(),
    reason: v.string(),
    refId: v.optional(v.string()),
    keyDbId: v.optional(v.id("aoApiKeys")),
    endpoint: v.optional(v.string()),
    // Admin keys: skip the rate limit and never deduct credits. Usage rows are
    // still written so admin traffic shows up in the metrics.
    unlimited: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<number> => {
    const user = await ctx.db.get(args.userId);
    if (!user) throw new Error("User not found");
    if (args.keyDbId && args.credits >= 0 && !args.unlimited) {
      const limit = user.aoCustomRateLimit ?? RATE_LIMIT_PER_MIN;
      const cutoff = Date.now() - 60_000;
      const keyDbId = args.keyDbId;
      const recent = await ctx.db
        .query("aoUsage")
        .withIndex("by_key_and_time", (q) => q.eq("keyId", keyDbId).gt("createdAt", cutoff))
        .collect();
      if (recent.length >= limit) throw new Error(ERR_RATE_LIMITED);
    }
    const balance = user.aoCredits ?? DAILY_REFILL; // first touch = free daily 10
    const credits = args.unlimited ? 0 : args.credits;
    if (credits > 0 && balance < credits) throw new Error(ERR_INSUFFICIENT);
    const newBalance = balance - credits;
    if (credits !== 0) {
      await ctx.db.patch(args.userId, { aoCredits: newBalance });
      await ctx.db.insert("aoCreditLedger", {
        userId: args.userId,
        delta: -credits,
        reason: args.reason,
        refId: args.refId,
        createdAt: Date.now(),
      });
    }
    if (args.keyDbId && args.credits >= 0) {
      await ctx.db.insert("aoUsage", {
        keyId: args.keyDbId,
        userId: args.userId,
        endpoint: args.endpoint ?? "unknown",
        credits,
        createdAt: Date.now(),
      });
      await ctx.db.patch(args.keyDbId, { lastUsedAt: Date.now() });
    }
    if (args.credits >= 0) {
      await recordAoDau(ctx, args.userId, args.keyDbId ? "api" : "site");
    }
    return newBalance;
  },
});

export const accountForUser = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId);
    return {
      balance: user?.aoCredits ?? DAILY_REFILL,
      points: user?.aoContribPoints ?? 0,
      customRefill: user?.aoCustomRefill,
      rateLimit: user?.aoCustomRateLimit ?? RATE_LIMIT_PER_MIN,
    };
  },
});

export const learningsForUser = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const learnings = await ctx.db
      .query("aoLearnings")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .order("desc")
      .take(100);
    return learnings.map(learningView);
  },
});

export const insertLearningFromApi = internalMutation({
  args: {
    userId: v.id("users"),
    title: v.string(),
    problem: v.string(),
    solution: v.string(),
    tags: v.array(v.string()),
  },
  handler: async (ctx, args): Promise<Id<"aoLearnings">> => {
    const { userId, ...rest } = args;
    return await insertLearningCore(ctx, userId, rest);
  },
});

export const getLearning = internalQuery({
  args: { learningId: v.id("aoLearnings") },
  handler: async (ctx, args) => ctx.db.get(args.learningId),
});

// Applies the scoring outcome: status, tier, and the credit settlement.
export const settleLearning = internalMutation({
  args: {
    learningId: v.id("aoLearnings"),
    score: v.optional(v.number()),
    rationale: v.string(),
    vmDocId: v.optional(v.string()),
    duplicate: v.optional(v.boolean()),
    failed: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const learning = await ctx.db.get(args.learningId);
    if (!learning || learning.status !== "pending") return;

    if (args.duplicate) {
      await ctx.db.patch(args.learningId, {
        status: "duplicate",
        scoreRationale: args.rationale,
        creditsDelta: 0,
        scoredAt: Date.now(),
      });
      return;
    }
    if (args.failed || args.score === undefined) {
      // Scorer never answered — reject without punishing the submitter.
      await ctx.db.patch(args.learningId, {
        status: "rejected",
        scoreRationale: args.rationale,
        creditsDelta: 0,
        scoredAt: Date.now(),
      });
      return;
    }

    const score = Math.max(0, Math.min(10, Math.round(args.score)));
    const reward = rewardForScore(score);
    const learningTier = tierForScore(score);
    const user = await ctx.db.get(learning.userId);
    let applied = 0;
    if (user) {
      const balance = user.aoCredits ?? DAILY_REFILL;
      // Penalties floor at zero — no negative balances.
      applied = reward < 0 ? -Math.min(balance, -reward) : reward;
      const patch: { aoCredits?: number; aoContribPoints?: number } = {};
      if (applied !== 0) patch.aoCredits = balance + applied;
      // Accepted learnings earn tier points; trash costs one. Floor at zero.
      const curPoints = user.aoContribPoints ?? 0;
      const pointsDelta = score >= 5 ? pointsForLearningTier(learningTier) : -1;
      const newPoints = Math.max(0, curPoints + pointsDelta);
      if (newPoints !== curPoints) patch.aoContribPoints = newPoints;
      if (Object.keys(patch).length > 0) await ctx.db.patch(learning.userId, patch);
      if (applied !== 0) {
        await ctx.db.insert("aoCreditLedger", {
          userId: learning.userId,
          delta: applied,
          reason: applied > 0 ? "learning_reward" : "learning_penalty",
          refId: args.learningId,
          createdAt: Date.now(),
        });
      }
    }

    await ctx.db.patch(args.learningId, {
      status: score <= 4 ? "rejected" : "scored",
      score,
      tier: learningTier ?? undefined,
      scoreRationale: args.rationale,
      creditsDelta: applied,
      vmDocId: args.vmDocId,
      scoredAt: Date.now(),
    });
  },
});

// ── Scoring pipeline (async, scheduled on submit) ────────────────────────────

const SCORING_SYSTEM_PROMPT = `You are the quality gate for AgentOverflow, a knowledge base AI agents query to avoid re-solving known problems. Score the submitted learning 0-10:
- 0-4: trash — spam, incoherent, wrong, trivially obvious, content-free, or too vague/thin/unverifiable to act on. These get deleted and the submitter is penalized.
- 5-7: useful but common knowledge; a competent agent would find this quickly anyway.
- 8-9: specific, reusable, non-obvious; clearly saves real debugging time.
- 10: gold — a complex, complete, verified fix for a genuinely hard problem. Rare; reserve it.
Judge: correctness plausibility, specificity (exact errors, versions, root cause), reusability, non-triviality. Respond with ONLY a JSON object: {"score": <integer 0-10>, "rationale": "<one or two sentences>"}`;

// Pull {"score": n, "rationale": "..."} out of a model reply that may have
// prose or fences around it. Returns null when nothing parseable is found.
export function extractScoreJson(text: string): { score: number; rationale: string } | null {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[0]) as { score?: unknown; rationale?: unknown };
    if (typeof parsed.score !== "number" || !Number.isFinite(parsed.score)) return null;
    return {
      score: Math.max(0, Math.min(10, Math.round(parsed.score))),
      rationale: typeof parsed.rationale === "string" ? parsed.rationale.slice(0, 500) : "",
    };
  } catch {
    return null;
  }
}

export const scoreLearning = internalAction({
  args: { learningId: v.id("aoLearnings"), attempt: v.optional(v.number()) },
  handler: async (ctx, args): Promise<void> => {
    const attempt = args.attempt ?? 1;
    const learning = await ctx.runQuery(internal.agentoverflow.getLearning, {
      learningId: args.learningId,
    });
    if (!learning || learning.status !== "pending") return;

    const retryOrFail = async (delayMs: number, why: string) => {
      if (attempt >= 5) {
        await ctx.runMutation(internal.agentoverflow.settleLearning, {
          learningId: args.learningId,
          rationale: `Scoring unavailable (${why}) — resubmit later. No penalty applied.`,
          failed: true,
        });
        return;
      }
      await ctx.scheduler.runAfter(delayMs, internal.agentoverflow.scoreLearning, {
        learningId: args.learningId,
        attempt: attempt + 1,
      });
    };

    const budgetExhausted = (await ctx.runQuery(
      internal.admin.isPlatformBudgetExhausted,
      {},
    )) as boolean;
    if (budgetExhausted) {
      await retryOrFail(60 * 60 * 1000, "platform budget exhausted");
      return;
    }

    const geminiKeys = (await ctx.runQuery(internal.admin.getGeminiKeysInternal, {})) as string[];
    const dbCreds = (await ctx.runQuery(internal.admin.getAwsCredentialsInternal, {})) as {
      accessKeyId: string;
      secretAccessKey: string;
      region: string;
    } | null;

    const prompt = `TITLE: ${learning.title}\nTAGS: ${learning.tags.join(", ") || "(none)"}\n\nPROBLEM:\n${learning.problem.slice(0, 12000)}\n\nSOLUTION:\n${learning.solution.slice(0, 12000)}`;

    let scored: { score: number; rationale: string } | null = null;
    try {
      const result = await callModel(prompt, SCORING_SYSTEM_PROMPT, "gemini", geminiKeys, dbCreds);
      await ctx.runMutation(internal.admin.deductPlatformCost, {
        modelName: result.tier === "gemini" ? "gemini-3.1-flash-lite" : "claude-haiku-4-5",
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
      });
      scored = extractScoreJson(result.text);
    } catch (err) {
      console.error("AO scoring model call failed:", err);
      await retryOrFail(5 * 60 * 1000, "model call failed");
      return;
    }
    if (!scored) {
      await retryOrFail(5 * 60 * 1000, "unparseable scorer reply");
      return;
    }

    if (scored.score <= 4) {
      await ctx.runMutation(internal.agentoverflow.settleLearning, {
        learningId: args.learningId,
        score: scored.score,
        rationale: scored.rationale,
      });
      return;
    }

    // 5+ goes into the corpus; the VM dedups against everything already there.
    try {
      const res = await vmFetch("/internal/ingest", {
        doc_id: `learning-${args.learningId}`,
        title: learning.title,
        problem: learning.problem,
        solution: learning.solution,
        tags: learning.tags,
        score: scored.score,
        tier: tierForScore(scored.score),
        source: "learning",
        url: null,
      });
      if (res.status === 409) {
        const dup = (await res.json()) as { duplicate_of?: string };
        await ctx.runMutation(internal.agentoverflow.settleLearning, {
          learningId: args.learningId,
          rationale: `Near-duplicate of existing entry ${dup.duplicate_of ?? ""} — no credits awarded.`,
          duplicate: true,
        });
        return;
      }
      if (!res.ok) throw new Error(`VM ingest failed: ${res.status}`);
      const body = (await res.json()) as { vm_doc_id?: string };
      await ctx.runMutation(internal.agentoverflow.settleLearning, {
        learningId: args.learningId,
        score: scored.score,
        rationale: scored.rationale,
        vmDocId: body.vm_doc_id ?? `learning-${args.learningId}`,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("AO ingest failed:", msg);
      await retryOrFail(
        msg === ERR_UNCONFIGURED ? 60 * 60 * 1000 : 10 * 60 * 1000,
        "corpus backend unavailable",
      );
    }
  },
});

// ── Daily refill (cron) ───────────────────────────────────────────────────────

// Midnight IST housekeeping: contribution points decay ~1%, then everyone
// gets topped back up to their (possibly new) tier's refill — lurkers to 10,
// legends to 50. Balances already above the line are left alone.
export const dailyRefillAoCredits = internalMutation({
  args: {},
  handler: async (ctx) => {
    let cursor: string | null = null;
    let refilled = 0;
    while (true) {
      const batch: { page: Doc<"users">[]; isDone: boolean; continueCursor: string } = await ctx.db
        .query("users")
        .order("asc")
        .paginate({ cursor, numItems: 100 });
      for (const user of batch.page) {
        const patch: { aoCredits?: number; aoContribPoints?: number } = {};
        let points = user.aoContribPoints ?? 0;
        if (points > 0) {
          points = points * POINTS_DAILY_DECAY;
          if (points < 0.05) points = 0;
          patch.aoContribPoints = points;
        }
        if (user.aoCredits !== undefined) {
          const target = effectiveRefill(points, user.aoCustomRefill);
          if (user.aoCredits < target) {
            patch.aoCredits = target;
            await ctx.db.insert("aoCreditLedger", {
              userId: user._id,
              delta: target - user.aoCredits,
              reason: "daily_refill",
              createdAt: Date.now(),
            });
            refilled++;
          }
        }
        if (Object.keys(patch).length > 0) await ctx.db.patch(user._id, patch);
      }
      if (batch.isDone) break;
      cursor = batch.continueCursor;
    }
    console.log(`[AO] Daily refill topped up ${refilled} users`);
  },
});
