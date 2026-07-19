/* eslint-disable @typescript-eslint/ban-ts-comment -- Convex generated data-model types exceed TS instantiation depth (TS2589) in this module; checked builds require this suppression. */
// @ts-nocheck
import { internalMutation, internalQuery, mutation } from "./_generated/server";
import { v } from "convex/values";
import { Id } from "./_generated/dataModel";
// Free+unlimited switch lives in agentCore (the one pure module every runtime
// can import). While true, these AgentBucks deduction paths are no-ops.
import { FREE_UNLIMITED } from "./agentCore";

export const insertSandbox = internalMutation({
  args: {
    userId: v.id("users"),
    sandboxId: v.string(),
    sessionId: v.optional(v.id("teamSessions")),
    label: v.optional(v.string()),
    status: v.union(v.literal("creating"), v.literal("running"), v.literal("stopped"), v.literal("error")),
    createdAt: v.number(),
  },
  handler: async (ctx, args): Promise<Id<"sandboxes">> => {
    return await ctx.db.insert("sandboxes", {
      userId: args.userId,
      sandboxId: args.sandboxId,
      sessionId: args.sessionId,
      label: args.label,
      status: args.status,
      createdAt: args.createdAt,
    });
  },
});

export const getSandbox = internalQuery({
  args: { sandboxDbId: v.id("sandboxes") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.sandboxDbId);
  },
});

export const getSandboxBySession = internalQuery({
  args: { sessionId: v.id("teamSessions") },
  handler: async (ctx, args) => {
    const sandboxes = await ctx.db
      .query("sandboxes")
      .withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
      .order("desc")
      .take(1);
    return sandboxes[0] ?? null;
  },
});

export const updateSandboxCommand = internalMutation({
  args: {
    sandboxDbId: v.id("sandboxes"),
    lastCommand: v.string(),
    lastOutput: v.string(),
    costCents: v.number(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.sandboxDbId, {
      lastCommand: args.lastCommand,
      lastOutput: args.lastOutput,
      costCents: args.costCents,
    });
  },
});

export const markSandboxStopped = internalMutation({
  args: {
    sandboxDbId: v.id("sandboxes"),
    costCents: v.number(),
    stoppedAt: v.number(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.sandboxDbId, {
      status: "stopped",
      costCents: args.costCents,
      stoppedAt: args.stoppedAt,
    });
  },
});

/**
 * Add a credit batch with 90-day expiry.
 * Used for purchases, spin wheel wins, referral bonuses, promo codes.
 */
export const addCreditBatch = internalMutation({
  args: {
    userId: v.id("users"),
    amount: v.number(),
    source: v.string(), // "purchase" | "spin" | "referral" | "promo"
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const expiresAt = now + 90 * 24 * 60 * 60 * 1000; // 90 days
    await ctx.db.insert("creditBatches", {
      userId: args.userId,
      amount: args.amount,
      remaining: args.amount,
      expiresAt,
      source: args.source,
      createdAt: now,
    });
    // Update the denormalized purchasedAgentBucks total on the user
    const user = await ctx.db.get(args.userId);
    if (user) {
      const current = (user as { purchasedAgentBucks?: number }).purchasedAgentBucks ?? 0;
      await ctx.db.patch(args.userId, { purchasedAgentBucks: current + args.amount });
    }
  },
});

/**
 * Deduct AgentBucks from credit batches (closest expiry first), then daily credits.
 * Expired batches are skipped and cleaned up.
 */
export const deductFromBatches = internalMutation({
  args: {
    userId: v.id("users"),
    amount: v.number(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    let remaining = args.amount;

    // Get all non-expired batches for this user, ordered by expiry (closest first)
    const batches = await ctx.db
      .query("creditBatches")
      .withIndex("by_user_and_expiry", (q) => q.eq("userId", args.userId))
      .order("asc") // ascending = closest expiry first
      .take(200);

    // Filter out expired batches and clean them up
    const expiredBatches = batches.filter(b => b.expiresAt <= now);
    for (const b of expiredBatches) await ctx.db.delete(b._id);

    const activeBatches = batches.filter(b => b.expiresAt > now && b.remaining > 0);

    // Deduct from batches (closest expiry first)
    for (const batch of activeBatches) {
      if (remaining <= 0) break;
      const deduct = Math.min(batch.remaining, remaining);
      await ctx.db.patch(batch._id, { remaining: batch.remaining - deduct });
      remaining -= deduct;
    }

    // If still remaining, deduct from daily credits
    const user = await ctx.db.get(args.userId);
    if (!user) return;

    const daily = (user as { dailyAgentBucks?: number }).dailyAgentBucks ?? 0;
    const newDaily = Math.max(0, daily - remaining);

    // Recalculate total purchased from remaining batches
    const updatedBatches = await ctx.db
      .query("creditBatches")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .take(200);
    const totalPurchased = updatedBatches
      .filter(b => b.expiresAt > now)
      .reduce((sum, b) => sum + b.remaining, 0);

    await ctx.db.patch(args.userId, {
      dailyAgentBucks: newDaily,
      purchasedAgentBucks: totalPurchased,
      totalUsageCents: ((user as { totalUsageCents?: number }).totalUsageCents ?? 0) + Math.ceil(args.amount / 15000),
    });
  },
});

/**
 * Get total purchased credits (sum of non-expired batch remainders).
 */
export const getPurchasedCredits = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const now = Date.now();
    const batches = await ctx.db
      .query("creditBatches")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .take(200);
    return batches
      .filter(b => b.expiresAt > now && b.remaining > 0)
      .reduce((sum, b) => sum + b.remaining, 0);
  },
});

/**
 * Get credit batches for display (non-expired, sorted by expiry).
 */
export const getCreditBatches = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const now = Date.now();
    const batches = await ctx.db
      .query("creditBatches")
      .withIndex("by_user_and_expiry", (q) => q.eq("userId", args.userId))
      .order("asc")
      .take(50);
    return batches.filter(b => b.expiresAt > now && b.remaining > 0);
  },
});

/**
 * Public query for frontend to get credit batches.
 */
export const watchCreditBatches = mutation({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const session = await ctx.db
      .query("customSessions")
      .withIndex("by_token", (q) => q.eq("token", args.token))
      .unique();
    if (!session || session.expiresAt < Date.now()) return [];
    const now = Date.now();
    const batches = await ctx.db
      .query("creditBatches")
      .withIndex("by_user_and_expiry", (q) => q.eq("userId", session.userId))
      .order("asc")
      .take(50);
    return batches
      .filter(b => b.expiresAt > now && b.remaining > 0)
      .map(b => ({
        _id: b._id,
        amount: b.amount,
        remaining: b.remaining,
        expiresAt: b.expiresAt,
        source: b.source,
        createdAt: b.createdAt,
      }));
  },
});

export const addUserCost = internalMutation({
  args: {
    userId: v.id("users"),
    costCents: v.number(),
  },
  handler: async (ctx, args) => {
    if (FREE_UNLIMITED) return; // platform is free — no sandbox-runtime charge
    const user = await ctx.db.get(args.userId);
    if (!user) return;
    // Use new formula: costCents * 15000 = AB to deduct
    const agentBucksToDeduct = args.costCents * 15000;
    const now = Date.now();

    // Deduct from batches (closest expiry first)
    let remaining = agentBucksToDeduct;
    const batches = await ctx.db
      .query("creditBatches")
      .withIndex("by_user_and_expiry", (q) => q.eq("userId", args.userId))
      .order("asc")
      .take(200);

    const expiredBatches = batches.filter(b => b.expiresAt <= now);
    for (const b of expiredBatches) await ctx.db.delete(b._id);

    const activeBatches = batches.filter(b => b.expiresAt > now && b.remaining > 0);
    for (const batch of activeBatches) {
      if (remaining <= 0) break;
      const deduct = Math.min(batch.remaining, remaining);
      await ctx.db.patch(batch._id, { remaining: batch.remaining - deduct });
      remaining -= deduct;
    }

    // Remaining deducted from daily
    const daily = (user as { dailyAgentBucks?: number }).dailyAgentBucks ?? 0;
    const newDaily = Math.max(0, daily - remaining);

    // Recalculate total purchased
    const updatedBatches = await ctx.db
      .query("creditBatches")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .take(200);
    const totalPurchased = updatedBatches
      .filter(b => b.expiresAt > now)
      .reduce((sum, b) => sum + b.remaining, 0);

    await ctx.db.patch(args.userId, {
      totalUsageCents: ((user as { totalUsageCents?: number }).totalUsageCents ?? 0) + args.costCents,
      dailyAgentBucks: newDaily,
      purchasedAgentBucks: totalPurchased,
    });
  },
});

/**
 * Deduct AgentBucks directly (used by new cost formula).
 * Purchased credits are deducted first (closest expiry), then daily credits.
 */
export const deductAgentBucks = internalMutation({
  args: {
    userId: v.id("users"),
    agentBucksToDeduct: v.number(),
  },
  handler: async (ctx, args) => {
    if (FREE_UNLIMITED) return; // platform is free — no per-call AgentBucks charge
    const user = await ctx.db.get(args.userId);
    if (!user) return;
    const now = Date.now();
    let remaining = args.agentBucksToDeduct;

    // Deduct from batches (closest expiry first)
    const batches = await ctx.db
      .query("creditBatches")
      .withIndex("by_user_and_expiry", (q) => q.eq("userId", args.userId))
      .order("asc")
      .take(200);

    const expiredBatches = batches.filter(b => b.expiresAt <= now);
    for (const b of expiredBatches) await ctx.db.delete(b._id);

    const activeBatches = batches.filter(b => b.expiresAt > now && b.remaining > 0);
    for (const batch of activeBatches) {
      if (remaining <= 0) break;
      const deduct = Math.min(batch.remaining, remaining);
      await ctx.db.patch(batch._id, { remaining: batch.remaining - deduct });
      remaining -= deduct;
    }

    // Remaining from daily
    const daily = (user as { dailyAgentBucks?: number }).dailyAgentBucks ?? 0;
    const newDaily = Math.max(0, daily - remaining);

    // Recalculate total purchased
    const updatedBatches = await ctx.db
      .query("creditBatches")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .take(200);
    const totalPurchased = updatedBatches
      .filter(b => b.expiresAt > now)
      .reduce((sum, b) => sum + b.remaining, 0);

    await ctx.db.patch(args.userId, {
      dailyAgentBucks: newDaily,
      purchasedAgentBucks: totalPurchased,
    });
  },
});

export const addAgentBucks = internalMutation({
  args: {
    userId: v.id("users"),
    agentBucks: v.number(),
  },
  handler: async (ctx, args) => {
    // Add as a credit batch with 90-day expiry
    const now = Date.now();
    const expiresAt = now + 90 * 24 * 60 * 60 * 1000;
    await ctx.db.insert("creditBatches", {
      userId: args.userId,
      amount: args.agentBucks,
      remaining: args.agentBucks,
      expiresAt,
      source: "purchase",
      createdAt: now,
    });
    const user = await ctx.db.get(args.userId);
    if (user) {
      const current = (user as { purchasedAgentBucks?: number }).purchasedAgentBucks ?? 0;
      await ctx.db.patch(args.userId, { purchasedAgentBucks: current + args.agentBucks });
    }
  },
});

export const listUserSandboxes = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("sandboxes")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .order("desc")
      .take(20);
  },
});

export const updatePreviewUrl = internalMutation({
  args: {
    sandboxDbId: v.id("sandboxes"),
    previewUrl: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.sandboxDbId, { previewUrl: args.previewUrl });
  },
});

export const updateSandboxStatus = internalMutation({
  args: {
    sandboxDbId: v.id("sandboxes"),
    status: v.union(v.literal("creating"), v.literal("running"), v.literal("stopped"), v.literal("error")),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.sandboxDbId, { status: args.status });
  },
});

export const updateCustomDomain = internalMutation({
  args: {
    sandboxDbId: v.id("sandboxes"),
    customDomain: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.sandboxDbId, { customDomain: args.customDomain });
  },
});

export const getSandboxPublic = internalQuery({
  args: { sandboxDbId: v.id("sandboxes") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.sandboxDbId);
  },
});