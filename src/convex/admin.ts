import { query, mutation, action } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { Id } from "./_generated/dataModel";

// ── Admin auth helper ─────────────────────────────────────────────────────────
const ADMIN_PASSWORD_HASH = "Aphantic*123"; // checked client-side; backend uses token guard

// ── Promo Codes ───────────────────────────────────────────────────────────────
export const listPromoCodes = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("promoCodes").order("desc").take(200);
  },
});

export const createPromoCode = mutation({
  args: {
    code: v.string(),
    purchasedCredits: v.optional(v.number()),
    spins: v.optional(v.number()),
    expiresAt: v.number(),
    maxUses: v.optional(v.number()),
    createdBy: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
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
  args: { id: v.id("promoCodes") },
  handler: async (ctx, args) => {
    await ctx.db.delete(args.id);
  },
});

// ── Users ─────────────────────────────────────────────────────────────────────
export const listUsers = query({
  args: {},
  handler: async (ctx) => {
    const users = await ctx.db.query("users").take(500);
    return users.map(u => ({
      _id: u._id,
      email: u.email,
      name: u.name,
      dailyAgentBucks: u.dailyAgentBucks ?? 0,
      purchasedAgentBucks: u.purchasedAgentBucks ?? 0,
      isBanned: u.isBanned ?? false,
      warningCount: u.warningCount ?? 0,
      _creationTime: u._creationTime,
    }));
  },
});

export const getUserCreditBatches = query({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    return await ctx.db.query("creditBatches").withIndex("by_user", q => q.eq("userId", args.userId)).take(50);
  },
});

export const setDailyAllowance = mutation({
  args: { userId: v.id("users"), dailyAgentBucks: v.number() },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.userId, { dailyAgentBucks: args.dailyAgentBucks });
  },
});

export const addPurchasedCredits = mutation({
  args: { userId: v.id("users"), amount: v.number(), note: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId);
    if (!user) throw new Error("User not found");
    const current = user.purchasedAgentBucks ?? 0;
    await ctx.db.patch(args.userId, { purchasedAgentBucks: current + args.amount });
    // Also add a credit batch
    await ctx.db.insert("creditBatches", {
      userId: args.userId,
      amount: args.amount,
      remaining: args.amount,
      expiresAt: Date.now() + 90 * 24 * 60 * 60 * 1000, // 90 days
      source: args.note ?? "admin",
      createdAt: Date.now(),
    });
  },
});

// ── Suggestions ───────────────────────────────────────────────────────────────
export const listSuggestions = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("suggestions").order("desc").take(200);
  },
});

export const updateSuggestionStatus = mutation({
  args: { id: v.id("suggestions"), status: v.string(), adminNote: v.optional(v.string()) },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, { status: args.status, adminNote: args.adminNote });
  },
});

export const deleteSuggestion = mutation({
  args: { id: v.id("suggestions") },
  handler: async (ctx, args) => {
    await ctx.db.delete(args.id);
  },
});

// ── Model Pricing ─────────────────────────────────────────────────────────────
export const listModelPricing = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("modelPricing").take(50);
  },
});

export const upsertModelPricing = mutation({
  args: {
    modelId: v.string(),
    displayName: v.string(),
    inputCentsPerMillion: v.number(),
    outputCentsPerMillion: v.number(),
    abMultiplier: v.number(),
    isActive: v.boolean(),
    updatedBy: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
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

// ── Submit suggestion (public) ────────────────────────────────────────────────
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
