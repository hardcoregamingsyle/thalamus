import { internalMutation, internalQuery } from "./_generated/server";
import { v } from "convex/values";
import { Id } from "./_generated/dataModel";

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

export const addUserCost = internalMutation({
  args: {
    userId: v.id("users"),
    costCents: v.number(),
  },
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId);
    if (!user) return;
    await ctx.db.patch(args.userId, {
      totalUsageCents: (user.totalUsageCents ?? 0) + args.costCents,
    });
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