import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";

export const list = query({
  args: {
    mode: v.optional(v.union(v.literal("chat"), v.literal("research"), v.literal("code"))),
    token: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    if (!args.token) return [];
    const sessions = await ctx.db
      .query("customSessions")
      .withIndex("by_token", (q) => q.eq("token", args.token!))
      .take(1);
    const session = sessions[0];
    if (!session || session.expiresAt < Date.now()) return [];
    const userId = session.userId;

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
    token: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    if (!args.token) throw new Error("Not authenticated");
    const sessions = await ctx.db
      .query("customSessions")
      .withIndex("by_token", (q) => q.eq("token", args.token!))
      .take(1);
    const session = sessions[0];
    if (!session || session.expiresAt < Date.now()) throw new Error("Not authenticated");

    return await ctx.db.insert("conversations", {
      userId: session.userId,
      title: args.title,
      mode: args.mode,
      lastMessageAt: Date.now(),
    });
  },
});

export const rename = mutation({
  args: { id: v.id("conversations"), title: v.string(), token: v.optional(v.string()) },
  handler: async (ctx, args) => {
    if (!args.token) throw new Error("Not authenticated");
    const sessions = await ctx.db
      .query("customSessions")
      .withIndex("by_token", (q) => q.eq("token", args.token!))
      .take(1);
    const session = sessions[0];
    if (!session || session.expiresAt < Date.now()) throw new Error("Not authenticated");
    const conv = await ctx.db.get(args.id);
    if (!conv || conv.userId !== session.userId) throw new Error("Not found");
    await ctx.db.patch(args.id, { title: args.title });
  },
});

export const remove = mutation({
  args: { id: v.id("conversations"), token: v.optional(v.string()) },
  handler: async (ctx, args) => {
    if (!args.token) throw new Error("Not authenticated");
    const sessions = await ctx.db
      .query("customSessions")
      .withIndex("by_token", (q) => q.eq("token", args.token!))
      .take(1);
    const session = sessions[0];
    if (!session || session.expiresAt < Date.now()) throw new Error("Not authenticated");
    const conv = await ctx.db.get(args.id);
    if (!conv || conv.userId !== session.userId) throw new Error("Not found");

    const messages = await ctx.db
      .query("messages")
      .withIndex("by_conversation", (q) => q.eq("conversationId", args.id))
      .take(500);
    await Promise.all(messages.map((m) => ctx.db.delete(m._id)));
    await ctx.db.delete(args.id);
  },
});

export const getMessages = query({
  args: { conversationId: v.id("conversations"), token: v.optional(v.string()) },
  handler: async (ctx, args) => {
    if (!args.token) return [];
    const sessions = await ctx.db
      .query("customSessions")
      .withIndex("by_token", (q) => q.eq("token", args.token!))
      .take(1);
    const session = sessions[0];
    if (!session || session.expiresAt < Date.now()) return [];
    const conv = await ctx.db.get(args.conversationId);
    if (!conv || conv.userId !== session.userId) return [];

    return await ctx.db
      .query("messages")
      .withIndex("by_conversation", (q) => q.eq("conversationId", args.conversationId))
      .order("asc")
      .take(200);
  },
});