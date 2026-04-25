import { internalMutation, internalQuery } from "./_generated/server";
import { v } from "convex/values";

export const getConversationMessages = internalQuery({
  args: { conversationId: v.id("conversations") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("messages")
      .withIndex("by_conversation", (q) => q.eq("conversationId", args.conversationId))
      .order("asc")
      .take(50);
  },
});

export const saveMessage = internalMutation({
  args: {
    conversationId: v.id("conversations"),
    userId: v.id("users"),
    role: v.union(v.literal("user"), v.literal("assistant")),
    content: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("messages", {
      conversationId: args.conversationId,
      userId: args.userId,
      role: args.role,
      content: args.content,
    });
    await ctx.db.patch(args.conversationId, { lastMessageAt: Date.now() });
  },
});

export const saveAssistantMessage = internalMutation({
  args: {
    conversationId: v.id("conversations"),
    userId: v.id("users"),
    content: v.string(),
    tokensUsed: v.number(),
    costCents: v.number(),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("messages", {
      conversationId: args.conversationId,
      userId: args.userId,
      role: "assistant",
      content: args.content,
      tokensUsed: args.tokensUsed,
      costCents: args.costCents,
    });
    await ctx.db.patch(args.conversationId, { lastMessageAt: Date.now() });

    const user = await ctx.db.get(args.userId);
    if (user) {
      const current = (user as { totalUsageCents?: number }).totalUsageCents || 0;
      await ctx.db.patch(args.userId, { totalUsageCents: current + args.costCents });
    }
  },
});