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
      // AB formula: 1 cent = 100 AB (so $1 = 10,000 AB)
      // Gemini Flash Lite: ~$0.001 per message = 0.1 cents = 10 AB per message
      const agentBucksToDeduct = Math.ceil(args.costCents * 100);
      const daily = (user as { dailyAgentBucks?: number }).dailyAgentBucks ?? 0;
      const purchased = (user as { purchasedAgentBucks?: number }).purchasedAgentBucks ?? 0;
      // Purchased credits deducted first, then daily
      let remainingDeduct = agentBucksToDeduct;
      const newPurchased = Math.max(0, purchased - remainingDeduct);
      remainingDeduct = Math.max(0, remainingDeduct - purchased);
      const newDaily = Math.max(0, daily - remainingDeduct);
      await ctx.db.patch(args.userId, {
        totalUsageCents: current + args.costCents,
        dailyAgentBucks: newDaily,
        purchasedAgentBucks: newPurchased,
      });
    }
  },
});

export const updateConversationTitle = internalMutation({
  args: { conversationId: v.id("conversations"), title: v.string() },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.conversationId, { title: args.title });
  },
});