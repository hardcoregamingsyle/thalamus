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
const RATE_LIMIT_PER_MIN = 30;
const MAX_ACTIVE_KEYS = 10;

// Contribution tiers: points from accepted learnings buy a bigger daily
// refill. Points per accepted learning: low=1, medium=2, gold=5. The ladder
// works both ways — points decay ~1%/day (stop teaching, start sliding) and
// trash submissions cost a point. Stored as a float; floored for display.
export const POINTS_DAILY_DECAY = 0.99;
export const CONTRIB_TIERS = [
  { name: "lurker", minPoints: 0, dailyRefill: 10 },
  { name: "contributor", minPoints: 5, dailyRefill: 15 },
  { name: "regular", minPoints: 15, dailyRefill: 20 },
  { name: "veteran", minPoints: 40, dailyRefill: 30 },
  { name: "legend", minPoints: 100, dailyRefill: 50 },
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

// Same alphabet/shape as userApiKeys.ts, different prefix.
function generateAoKey(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  let key = "ao_";
  for (let i = 0; i < 32; i++) {
    key += chars[Math.floor(Math.random() * chars.length)];
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
export async function vmFetch(path: string, body?: unknown, method = "POST"): Promise<Response> {
  const base = process.env.AO_VM_URL;
  const secret = process.env.AO_INTERNAL_SECRET;
  if (!base || !secret) throw new Error(ERR_UNCONFIGURED);
  return fetch(`${base.replace(/\/$/, "")}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      "X-AO-Internal-Secret": secret,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
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

// The dashboard playground pays like the API does — same search, same 1 credit.
export const playgroundSearch = action({
  args: {
    token: v.string(),
    query: v.string(),
    tags: v.optional(v.array(v.string())),
    topK: v.optional(v.number()),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{ creditsCharged: number; balance: number; results: unknown[] }> => {
    const userId = await ctx.runQuery(internal.userApiKeys.getSessionUserId, {
      token: args.token,
    });
    if (!userId) throw new Error("Unauthorized");
    if (args.query.trim().length < 3) throw new Error("Query too short");

    const balance: number = await ctx.runMutation(internal.agentoverflow.charge, {
      userId,
      credits: COST_SEARCH,
      reason: "search",
      refId: "playground",
    });

    let res: Response;
    try {
      res = await vmFetch("/internal/search", {
        query: args.query.trim().slice(0, 2000),
        top_k: Math.min(Math.max(args.topK ?? 5, 1), 20),
        tags: normalizeTags(args.tags ?? []),
        expand: true,
      });
      if (!res.ok) throw new Error(`VM search failed: ${res.status}`);
    } catch (err) {
      // Search never happened — give the credit back.
      await ctx.runMutation(internal.agentoverflow.charge, {
        userId,
        credits: -COST_SEARCH,
        reason: "search",
        refId: "refund",
      });
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(msg === ERR_UNCONFIGURED ? "Corpus backend is not deployed yet" : msg);
    }

    const data = (await res.json()) as { results: unknown[] };
    return { creditsCharged: COST_SEARCH, balance, results: data.results ?? [] };
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
    return { _id: key._id, keyId: key.keyId, userId: key.userId };
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
  },
  handler: async (ctx, args): Promise<number> => {
    const user = await ctx.db.get(args.userId);
    if (!user) throw new Error("User not found");
    if (args.keyDbId && args.credits >= 0) {
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
    if (args.credits > 0 && balance < args.credits) throw new Error(ERR_INSUFFICIENT);
    const newBalance = balance - args.credits;
    if (args.credits !== 0) {
      await ctx.db.patch(args.userId, { aoCredits: newBalance });
      await ctx.db.insert("aoCreditLedger", {
        userId: args.userId,
        delta: -args.credits,
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
        credits: args.credits,
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
          const target = contribTierFor(points).dailyRefill;
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
