import { query, mutation, internalMutation, internalQuery } from "./_generated/server";
import { v } from "convex/values";
import { Id } from "./_generated/dataModel";

// ── Admin auth helper ─────────────────────────────────────────────────────────
const ADMIN_TOKEN = "Aphantic*123";

async function requireAdmin(_ctx: unknown, adminToken: string) {
  if (adminToken !== ADMIN_TOKEN) throw new Error("Unauthorized");
}

// ── Promo Codes ───────────────────────────────────────────────────────────────
export const listPromoCodes = query({
  args: { adminToken: v.string() },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.adminToken);
    return await ctx.db.query("promoCodes").order("desc").take(200);
  },
});

export const createPromoCode = mutation({
  args: {
    adminToken: v.string(),
    code: v.string(),
    purchasedCredits: v.optional(v.number()),
    spins: v.optional(v.number()),
    expiresAt: v.number(),
    maxUses: v.optional(v.number()),
    createdBy: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.adminToken);
    const existing = await ctx.db.query("promoCodes").withIndex("by_code", q => q.eq("code", args.code)).take(1);
    if (existing.length > 0) throw new Error("Promo code already exists");
    await ctx.db.insert("promoCodes", {
      code: args.code.toUpperCase().trim(),
      purchasedCredits: args.purchasedCredits,
      spins: args.spins,
      expiresAt: args.expiresAt,
      maxUses: args.maxUses,
      usedCount: 0,
      createdAt: Date.now(),
      createdBy: args.createdBy,
    });
  },
});

export const deletePromoCode = mutation({
  args: { adminToken: v.string(), id: v.id("promoCodes") },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.adminToken);
    await ctx.db.delete(args.id);
  },
});

// ── Users ─────────────────────────────────────────────────────────────────────
export const listUsers = query({
  args: { adminToken: v.string() },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.adminToken);
    const users = await ctx.db.query("users").take(500);
    return users.map(u => ({
      _id: u._id,
      email: u.email,
      name: u.name,
      dailyAgentBucks: (u as { dailyAgentBucks?: number }).dailyAgentBucks ?? 0,
      purchasedAgentBucks: (u as { purchasedAgentBucks?: number }).purchasedAgentBucks ?? 0,
      isBanned: (u as { isBanned?: boolean }).isBanned ?? false,
      warningCount: (u as { warningCount?: number }).warningCount ?? 0,
      _creationTime: u._creationTime,
    }));
  },
});

export const getUserCreditBatches = query({
  args: { adminToken: v.string(), userId: v.id("users") },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.adminToken);
    return await ctx.db.query("creditBatches").withIndex("by_user", q => q.eq("userId", args.userId)).take(50);
  },
});

export const setDailyAllowance = mutation({
  args: { adminToken: v.string(), userId: v.id("users"), dailyAgentBucks: v.number() },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.adminToken);
    await ctx.db.patch(args.userId, { dailyAgentBucks: args.dailyAgentBucks } as never);
  },
});

export const addPurchasedCredits = mutation({
  args: { adminToken: v.string(), userId: v.id("users"), amount: v.number(), note: v.optional(v.string()) },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.adminToken);
    const user = await ctx.db.get(args.userId);
    if (!user) throw new Error("User not found");
    const current = (user as { purchasedAgentBucks?: number }).purchasedAgentBucks ?? 0;
    await ctx.db.patch(args.userId, { purchasedAgentBucks: current + args.amount } as never);
    await ctx.db.insert("creditBatches", {
      userId: args.userId,
      amount: args.amount,
      remaining: args.amount,
      expiresAt: Date.now() + 90 * 24 * 60 * 60 * 1000,
      source: args.note ?? "admin",
      createdAt: Date.now(),
    });
  },
});

// ── Suggestions ───────────────────────────────────────────────────────────────
export const listSuggestions = query({
  args: { adminToken: v.string() },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.adminToken);
    return await ctx.db.query("suggestions").order("desc").take(200);
  },
});

export const updateSuggestionStatus = mutation({
  args: { adminToken: v.string(), id: v.id("suggestions"), status: v.string(), adminNote: v.optional(v.string()) },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.adminToken);
    await ctx.db.patch(args.id, { status: args.status, adminNote: args.adminNote });
  },
});

export const deleteSuggestion = mutation({
  args: { adminToken: v.string(), id: v.id("suggestions") },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.adminToken);
    await ctx.db.delete(args.id);
  },
});

// ── Model Pricing ─────────────────────────────────────────────────────────────
export const listModelPricing = query({
  args: { adminToken: v.string() },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.adminToken);
    return await ctx.db.query("modelPricing").take(50);
  },
});

export const upsertModelPricing = mutation({
  args: {
    adminToken: v.string(),
    modelId: v.string(),
    displayName: v.string(),
    inputCentsPerMillion: v.number(),
    outputCentsPerMillion: v.number(),
    abMultiplier: v.number(),
    isActive: v.boolean(),
    updatedBy: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.adminToken);
    const existing = await ctx.db.query("modelPricing").withIndex("by_model", q => q.eq("modelId", args.modelId)).take(1);
    if (existing.length > 0) {
      await ctx.db.patch(existing[0]._id, {
        displayName: args.displayName,
        inputCentsPerMillion: args.inputCentsPerMillion,
        outputCentsPerMillion: args.outputCentsPerMillion,
        abMultiplier: args.abMultiplier,
        isActive: args.isActive,
        updatedAt: Date.now(),
        updatedBy: args.updatedBy,
      });
    } else {
      await ctx.db.insert("modelPricing", {
        modelId: args.modelId,
        displayName: args.displayName,
        inputCentsPerMillion: args.inputCentsPerMillion,
        outputCentsPerMillion: args.outputCentsPerMillion,
        abMultiplier: args.abMultiplier,
        isActive: args.isActive,
        updatedAt: Date.now(),
        updatedBy: args.updatedBy,
      });
    }
  },
});

// ── Submit suggestion (public — no auth required) ─────────────────────────────
export const submitSuggestion = mutation({
  args: {
    userId: v.optional(v.id("users")),
    userEmail: v.optional(v.string()),
    sessionId: v.optional(v.id("teamSessions")),
    title: v.string(),
    description: v.string(),
    files: v.optional(v.array(v.object({
      name: v.string(),
      content: v.string(),
      size: v.number(),
    }))),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("suggestions", {
      userId: args.userId,
      userEmail: args.userEmail,
      sessionId: args.sessionId,
      title: args.title,
      description: args.description,
      files: args.files,
      status: "new",
      createdAt: Date.now(),
    });
  },
});

// ── Platform Budget ───────────────────────────────────────────────────────────

// Cost per million tokens in dollars (8 decimal precision)
const PLATFORM_PRICING: Record<string, { input: number; output: number }> = {
  "claude-haiku-4-5":  { input: 1,  output: 5  },
  "claude-sonnet-4-6": { input: 3,  output: 15 },
  "claude-opus-4-6":   { input: 5,  output: 25 },
  "claude-opus-4-7":   { input: 7,  output: 34 },
};

const BUDGET_THRESHOLD = 5.0; // disable at $5 remaining

export function calcPlatformCost(modelName: string, inputTokens: number, outputTokens: number): number {
  const pricing = PLATFORM_PRICING[modelName];
  if (!pricing) return 0;
  return parseFloat(
    ((inputTokens / 1_000_000) * pricing.input + (outputTokens / 1_000_000) * pricing.output).toFixed(8)
  );
}

export const getPlatformBudget = query({
  args: { adminToken: v.string() },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.adminToken);
    const budgets = await ctx.db.query("platformBudget").take(1);
    if (budgets.length === 0) return { totalDollars: 0, spentDollars: 0, isDisabled: false, remaining: 0 };
    const b = budgets[0];
    return {
      _id: b._id,
      totalDollars: b.totalDollars,
      spentDollars: b.spentDollars,
      isDisabled: b.isDisabled,
      remaining: parseFloat((b.totalDollars - b.spentDollars).toFixed(8)),
    };
  },
});

export const setPlatformBudget = mutation({
  args: { adminToken: v.string(), totalDollars: v.number() },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.adminToken);
    const budgets = await ctx.db.query("platformBudget").take(1);
    const remaining = args.totalDollars - (budgets[0]?.spentDollars ?? 0);
    const isDisabled = remaining < BUDGET_THRESHOLD;
    if (budgets.length === 0) {
      await ctx.db.insert("platformBudget", {
        totalDollars: args.totalDollars,
        spentDollars: 0,
        isDisabled,
        updatedAt: Date.now(),
      });
    } else {
      await ctx.db.patch(budgets[0]._id, {
        totalDollars: args.totalDollars,
        isDisabled,
        updatedAt: Date.now(),
      });
    }
  },
});

export const resetPlatformSpend = mutation({
  args: { adminToken: v.string() },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.adminToken);
    const budgets = await ctx.db.query("platformBudget").take(1);
    if (budgets.length === 0) return;
    const b = budgets[0];
    const remaining = b.totalDollars - 0;
    await ctx.db.patch(b._id, {
      spentDollars: 0,
      isDisabled: remaining < BUDGET_THRESHOLD,
      updatedAt: Date.now(),
    });
  },
});

// Internal: deduct cost from platform budget after a model call
export const deductPlatformCost = internalMutation({
  args: { modelName: v.string(), inputTokens: v.number(), outputTokens: v.number() },
  handler: async (ctx, args) => {
    const cost = calcPlatformCost(args.modelName, args.inputTokens, args.outputTokens);
    if (cost <= 0) return;
    const budgets = await ctx.db.query("platformBudget").take(1);
    if (budgets.length === 0) return; // no budget set, allow
    const b = budgets[0];
    const newSpent = parseFloat((b.spentDollars + cost).toFixed(8));
    const remaining = b.totalDollars - newSpent;
    await ctx.db.patch(b._id, {
      spentDollars: newSpent,
      isDisabled: remaining < BUDGET_THRESHOLD,
      updatedAt: Date.now(),
    });
  },
});

// Internal: check if platform budget allows more requests
export const isPlatformBudgetExhausted = internalQuery({
  args: {},
  handler: async (ctx) => {
    const budgets = await ctx.db.query("platformBudget").take(1);
    if (budgets.length === 0) return false; // no budget set = allow
    return budgets[0].isDisabled;
  },
});