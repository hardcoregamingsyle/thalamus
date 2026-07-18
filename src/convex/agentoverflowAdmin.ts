import { action, internalMutation, mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { Doc } from "./_generated/dataModel";
import {
  contribTierFor,
  effectiveRefill,
  generateAoKey,
  hashAoKey,
  RATE_LIMIT_PER_MIN,
  vmFetch,
} from "./agentoverflow";

// ── AgentOverflow admin ───────────────────────────────────────────────────────
// Same gate as the thalamus /admin panel: the AO site logs in through
// admin:adminLogin (shared deployment, shared credentials) and passes the
// resulting ADMIN_TOKEN to everything here.

const ADMIN_TOKEN = process.env.ADMIN_TOKEN ?? "";

async function requireAdmin(_ctx: unknown, adminToken: string) {
  if (!ADMIN_TOKEN) throw new Error("ADMIN_TOKEN not configured on server");
  if (!adminToken || adminToken !== ADMIN_TOKEN) throw new Error("Unauthorized");
}

const LEARNING_STATUSES = ["pending", "scored", "rejected", "duplicate"] as const;

// Headline numbers: learnings, keys, users, credits. Scans are paginated but
// bounded — fine at current scale, revisit with counters past ~15k users.
export const adminStats = query({
  args: { adminToken: v.string() },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.adminToken);

    const byStatus: Record<string, number> = {};
    for (const status of LEARNING_STATUSES) {
      const rows = await ctx.db
        .query("aoLearnings")
        .withIndex("by_status", (q) => q.eq("status", status))
        .take(10000);
      byStatus[status] = rows.length;
    }
    const scored = await ctx.db
      .query("aoLearnings")
      .withIndex("by_status", (q) => q.eq("status", "scored"))
      .take(10000);
    const byTier = { low: 0, medium: 0, gold: 0 };
    for (const l of scored) {
      if (l.tier === "low") byTier.low++;
      else if (l.tier === "medium") byTier.medium++;
      else if (l.tier === "gold") byTier.gold++;
    }

    const keys = await ctx.db.query("aoApiKeys").take(10000);

    let aoUsers = 0;
    let creditsInCirculation = 0;
    let totalPoints = 0;
    let cursor: string | null = null;
    while (true) {
      const batch: { page: Doc<"users">[]; isDone: boolean; continueCursor: string } = await ctx.db
        .query("users")
        .order("asc")
        .paginate({ cursor, numItems: 500 });
      for (const user of batch.page) {
        if (user.aoCredits === undefined) continue;
        aoUsers++;
        creditsInCirculation += user.aoCredits;
        totalPoints += user.aoContribPoints ?? 0;
      }
      if (batch.isDone) break;
      cursor = batch.continueCursor;
    }

    return {
      learnings: {
        total: LEARNING_STATUSES.reduce((n, s) => n + byStatus[s], 0),
        pending: byStatus.pending,
        scored: byStatus.scored,
        rejected: byStatus.rejected,
        duplicate: byStatus.duplicate,
        byTier,
      },
      keys: {
        total: keys.length,
        active: keys.filter((k) => k.isActive).length,
      },
      users: {
        total: aoUsers,
        creditsInCirculation,
        totalPoints: Math.floor(totalPoints),
      },
    };
  },
});

// Per-day series for the charts: DAU (site/api split), request count, credits.
export const adminUsageSeries = query({
  args: { adminToken: v.string(), days: v.optional(v.number()) },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.adminToken);
    const numDays = Math.min(args.days ?? 30, 90);
    const now = Date.now();
    const dayMs = 24 * 60 * 60 * 1000;

    const series: {
      date: string;
      dau: number;
      dauSite: number;
      dauApi: number;
      requests: number;
      creditsSpent: number;
    }[] = [];

    for (let i = numDays - 1; i >= 0; i--) {
      const dayStart = new Date(now - i * dayMs);
      const dateKey = dayStart.toISOString().slice(0, 10);
      const startMs = Date.parse(`${dateKey}T00:00:00Z`);
      const endMs = startMs + dayMs;

      const dauRows = await ctx.db
        .query("aoDailyActiveUsers")
        .withIndex("by_date", (q) => q.eq("dateKey", dateKey))
        .take(10000);
      const usageRows = await ctx.db
        .query("aoUsage")
        .withIndex("by_creation_time", (q) => q.gte("_creationTime", startMs).lt("_creationTime", endMs))
        .take(10000);

      series.push({
        date: dateKey,
        dau: dauRows.length,
        dauSite: dauRows.filter((r) => r.source === "site").length,
        dauApi: dauRows.filter((r) => r.source === "api").length,
        requests: usageRows.length,
        creditsSpent: usageRows.reduce((n, r) => n + r.credits, 0),
      });
    }
    return series;
  },
});

// Latest learnings across all users, with submitter emails for moderation.
export const adminLearnings = query({
  args: { adminToken: v.string(), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.adminToken);
    const learnings = await ctx.db
      .query("aoLearnings")
      .order("desc")
      .take(Math.min(args.limit ?? 100, 200));
    const out = [];
    for (const l of learnings) {
      const user = await ctx.db.get(l.userId);
      out.push({
        id: l._id,
        title: l.title,
        status: l.status,
        score: l.score ?? null,
        tier: l.tier ?? null,
        scoreRationale: l.scoreRationale ?? null,
        creditsDelta: l.creditsDelta ?? null,
        userEmail: user?.email ?? "(deleted user)",
        inCorpus: l.vmDocId !== undefined,
        createdAt: l.createdAt,
      });
    }
    return out;
  },
});

// Every AO user, top contributors first.
export const adminUsers = query({
  args: { adminToken: v.string() },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.adminToken);
    const out: {
      userId: string;
      email: string;
      name: string | null;
      balance: number;
      points: number;
      tier: string;
      dailyRefill: number;
    }[] = [];
    let cursor: string | null = null;
    while (true) {
      const batch: { page: Doc<"users">[]; isDone: boolean; continueCursor: string } = await ctx.db
        .query("users")
        .order("asc")
        .paginate({ cursor, numItems: 500 });
      for (const user of batch.page) {
        if (user.aoCredits === undefined) continue;
        const points = user.aoContribPoints ?? 0;
        const tier = contribTierFor(points);
        out.push({
          userId: user._id,
          email: user.email ?? "(no email)",
          name: user.name ?? null,
          balance: user.aoCredits,
          points: Math.floor(points),
          tier: tier.name,
          dailyRefill: tier.dailyRefill,
        });
      }
      if (batch.isDone) break;
      cursor = batch.continueCursor;
    }
    out.sort((a, b) => b.points - a.points || b.balance - a.balance);
    return out.slice(0, 200);
  },
});

// Manual credit grant/deduction; lands in the ledger like everything else.
export const adminAdjustCredits = internalMutation({
  args: { userId: v.id("users"), delta: v.number() },
  handler: async (ctx, args): Promise<number> => {
    const user = await ctx.db.get(args.userId);
    if (!user) throw new Error("User not found");
    const balance = Math.max(0, (user.aoCredits ?? 0) + args.delta);
    await ctx.db.patch(args.userId, { aoCredits: balance });
    await ctx.db.insert("aoCreditLedger", {
      userId: args.userId,
      delta: args.delta,
      reason: "admin",
      createdAt: Date.now(),
    });
    return balance;
  },
});

export const adjustCredits = action({
  args: { adminToken: v.string(), userId: v.id("users"), delta: v.number() },
  handler: async (ctx, args): Promise<{ balance: number }> => {
    await requireAdmin(ctx, args.adminToken);
    const balance: number = await ctx.runMutation(internal.agentoverflowAdmin.adminAdjustCredits, {
      userId: args.userId,
      delta: args.delta,
    });
    return { balance };
  },
});

// Corpus VM health — the "is the whole read side alive" number.
export const adminCorpusHealth = action({
  args: { adminToken: v.string() },
  handler: async (
    ctx,
    args,
  ): Promise<{ ok: boolean; qdrant?: boolean; postgres?: boolean; points?: number; error?: string }> => {
    await requireAdmin(ctx, args.adminToken);
    try {
      const res = await vmFetch("/internal/health", undefined, "GET");
      if (!res.ok) return { ok: false, error: `VM returned ${res.status}` };
      return (await res.json()) as { ok: boolean; qdrant: boolean; postgres: boolean; points: number };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, error: msg === "AO_BACKEND_UNCONFIGURED" ? "VM not configured" : msg };
    }
  },
});

// Tier-increase applications: pending first, then recent history.
export const adminLimitRequests = query({
  args: { adminToken: v.string() },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.adminToken);
    const pending = await ctx.db
      .query("aoLimitRequests")
      .withIndex("by_status", (q) => q.eq("status", "pending"))
      .order("desc")
      .take(100);
    const recent = await ctx.db.query("aoLimitRequests").order("desc").take(50);
    const seen = new Set(pending.map((r) => r._id));
    const rows = [...pending, ...recent.filter((r) => !seen.has(r._id))];
    const out = [];
    for (const r of rows) {
      const user = await ctx.db.get(r.userId);
      const points = user?.aoContribPoints ?? 0;
      out.push({
        id: r._id,
        userEmail: user?.email ?? "(deleted user)",
        userTier: contribTierFor(points).name,
        currentRefill: effectiveRefill(points, user?.aoCustomRefill),
        currentRateLimit: user?.aoCustomRateLimit ?? RATE_LIMIT_PER_MIN,
        useCase: r.useCase,
        expectedDaily: r.expectedDaily,
        status: r.status,
        adminNote: r.adminNote ?? null,
        grantedRefill: r.grantedRefill ?? null,
        grantedRateLimit: r.grantedRateLimit ?? null,
        createdAt: r.createdAt,
        resolvedAt: r.resolvedAt ?? null,
      });
    }
    return out;
  },
});

// Approve with real numbers or reject with a note. Approval writes the
// overrides straight onto the user; the next refill cron honors them.
export const resolveLimitRequest = mutation({
  args: {
    adminToken: v.string(),
    requestId: v.id("aoLimitRequests"),
    approve: v.boolean(),
    dailyRefill: v.optional(v.number()),
    rateLimitPerMin: v.optional(v.number()),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.adminToken);
    const request = await ctx.db.get(args.requestId);
    if (!request || request.status !== "pending") throw new Error("Request not found or resolved");
    if (args.approve) {
      const refill =
        args.dailyRefill && args.dailyRefill > 0 ? Math.round(args.dailyRefill) : undefined;
      const rate =
        args.rateLimitPerMin && args.rateLimitPerMin > 0
          ? Math.round(args.rateLimitPerMin)
          : undefined;
      if (!refill && !rate) throw new Error("Approval needs a refill and/or rate limit to grant");
      const patch: { aoCustomRefill?: number; aoCustomRateLimit?: number } = {};
      if (refill) patch.aoCustomRefill = refill;
      if (rate) patch.aoCustomRateLimit = rate;
      await ctx.db.patch(request.userId, patch);
      await ctx.db.patch(args.requestId, {
        status: "approved",
        grantedRefill: refill,
        grantedRateLimit: rate,
        adminNote: args.note,
        resolvedAt: Date.now(),
      });
    } else {
      await ctx.db.patch(args.requestId, {
        status: "rejected",
        adminNote: args.note,
        resolvedAt: Date.now(),
      });
    }
  },
});

// Kill a key by its public keyId — abuse response without touching the user.
export const adminRevokeKey = internalMutation({
  args: { keyId: v.string() },
  handler: async (ctx, args) => {
    const key = await ctx.db
      .query("aoApiKeys")
      .withIndex("by_key_id", (q) => q.eq("keyId", args.keyId))
      .first();
    if (!key) throw new Error("Key not found");
    await ctx.db.patch(key._id, { isActive: false });
  },
});

export const revokeKey = action({
  args: { adminToken: v.string(), keyId: v.string() },
  handler: async (ctx, args): Promise<{ ok: boolean }> => {
    await requireAdmin(ctx, args.adminToken);
    await ctx.runMutation(internal.agentoverflowAdmin.adminRevokeKey, { keyId: args.keyId });
    return { ok: true };
  },
});

// Mint an admin key — unlimited requests, no credit charge, gold visible. The
// full key is returned exactly once; only its hash is ever stored.
export const createAdminKey = action({
  args: { adminToken: v.string(), name: v.string() },
  handler: async (
    ctx,
    args,
  ): Promise<{ keyId: string; fullKey: string; keyPrefix: string }> => {
    await requireAdmin(ctx, args.adminToken);
    const name = args.name.trim();
    if (name.length === 0 || name.length > 60) {
      throw new Error("Key name must be 1-60 characters");
    }
    const fullKey = generateAoKey();
    const keyHash = await hashAoKey(fullKey);
    const keyId = "ao_" + fullKey.slice(3, 19);
    const keyPrefix = fullKey.slice(0, 12) + "...";
    await ctx.runMutation(internal.agentoverflow.insertAdminKey, {
      keyId,
      keyHash,
      keyPrefix,
      name,
    });
    return { keyId, fullKey, keyPrefix };
  },
});

// The admin panel's list of live admin keys.
export const listAdminKeys = query({
  args: { adminToken: v.string() },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.adminToken);
    const keys = await ctx.db.query("aoApiKeys").take(2000);
    return keys
      .filter((k) => k.isAdmin === true && k.isActive)
      .map((k) => ({
        keyId: k.keyId,
        name: k.name,
        keyPrefix: k.keyPrefix,
        createdAt: k.createdAt,
        lastUsedAt: k.lastUsedAt,
      }));
  },
});

export const adminMarkRemoved = internalMutation({
  args: { learningId: v.id("aoLearnings") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.learningId, {
      status: "rejected",
      tier: undefined,
      vmDocId: undefined,
      scoreRationale: "Removed from the corpus by admin.",
    });
  },
});

// Moderation: pull a learning out of the corpus and mark the row.
export const deleteLearning = action({
  args: { adminToken: v.string(), learningId: v.id("aoLearnings") },
  handler: async (ctx, args): Promise<{ ok: boolean }> => {
    await requireAdmin(ctx, args.adminToken);
    const learning = await ctx.runQuery(internal.agentoverflow.getLearning, {
      learningId: args.learningId,
    });
    if (!learning) throw new Error("Learning not found");
    if (learning.vmDocId) {
      const res = await vmFetch(`/internal/item/${learning.vmDocId}`, undefined, "DELETE");
      if (!res.ok && res.status !== 404) {
        throw new Error(`VM delete failed: ${res.status}`);
      }
    }
    await ctx.runMutation(internal.agentoverflowAdmin.adminMarkRemoved, {
      learningId: args.learningId,
    });
    return { ok: true };
  },
});
