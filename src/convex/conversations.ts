import { getAuthUserId } from "@convex-dev/auth/server";
import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

export const list = query({
  args: { mode: v.optional(v.union(v.literal("chat"), v.literal("research"), v.literal("code"))) },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];

    if (args.mode) {
      return await ctx.db
        .query("conversations")
        .withIndex("by_user_and_mode", (q) => q.eq("userId", userId).eq("mode", args.mode!))
        .order("desc")
        .take(50);
    }

    return await ctx.db
      .query("conversations")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .order("desc")
      .take(50);
  },
});

export const create = mutation({
  args: {
    title: v.string(),
    mode: v.union(v.literal("chat"), v.literal("research"), v.literal("code")),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    return await ctx.db.insert("conversations", {
      userId,
      title: args.title,
      mode: args.mode,
      lastMessageAt: Date.now(),
    });
  },
});

export const rename = mutation({
  args: { id: v.id("conversations"), title: v.string() },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    const conv = await ctx.db.get(args.id);
    if (!conv || conv.userId !== userId) throw new Error("Not found");
    await ctx.db.patch(args.id, { title: args.title });
  },
});

export const remove = mutation({
  args: { id: v.id("conversations") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    const conv = await ctx.db.get(args.id);
    if (!conv || conv.userId !== userId) throw new Error("Not found");

    // Delete all messages
    const messages = await ctx.db
      .query("messages")
      .withIndex("by_conversation", (q) => q.eq("conversationId", args.id))
      .take(500);
    await Promise.all(messages.map((m) => ctx.db.delete(m._id)));
    await ctx.db.delete(args.id);
  },
});

export const getMessages = query({
  args: { conversationId: v.id("conversations") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];
    const conv = await ctx.db.get(args.conversationId);
    if (!conv || conv.userId !== userId) return [];

    return await ctx.db
      .query("messages")
      .withIndex("by_conversation", (q) => q.eq("conversationId", args.conversationId))
      .order("asc")
      .take(200);
  },
});
