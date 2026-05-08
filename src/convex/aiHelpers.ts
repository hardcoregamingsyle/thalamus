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
    // Optional: per-token breakdown for precise AB calculation
    inputTokens: v.optional(v.number()),
    outputTokens: v.optional(v.number()),
    inputCostPerMillion: v.optional(v.number()),   // USD per million input tokens
    outputCostPerMillion: v.optional(v.number()),  // USD per million output tokens
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

      // Formula: z = 1.5 * x * y
      // where x = tokens, y = costPerMillionTokens (USD), z = AB to deduct
      // Applied separately for input and output tokens
      let agentBucksToDeduct: number;
      if (
        args.inputTokens !== undefined &&
        args.outputTokens !== undefined &&
        args.inputCostPerMillion !== undefined &&
        args.outputCostPerMillion !== undefined
      ) {
        const inputAB = 1.5 * args.inputTokens * args.inputCostPerMillion;
        const outputAB = 1.5 * args.outputTokens * args.outputCostPerMillion;
        agentBucksToDeduct = Math.ceil(inputAB + outputAB);
      } else {
        // Fallback: derive from costCents (costCents * 15,000 = costDollars * 1,500,000)
        agentBucksToDeduct = Math.ceil(args.costCents * 15_000);
      }

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

export const saveStreamedMessage = internalMutation({
  args: {
    conversationId: v.id("conversations"),
    token: v.string(),
    content: v.string(),
    response: v.string(),
    inputCostPerMillion: v.number(),
    outputCostPerMillion: v.number(),
  },
  handler: async (ctx, args) => {
    // Look up user by token using customSessions table
    const sessions = await ctx.db
      .query("customSessions")
      .withIndex("by_token", (q) => q.eq("token", args.token))
      .take(1);
    const session = sessions[0];
    if (!session || session.expiresAt < Date.now()) return;
    const userId = session.userId;

    // Save user message
    await ctx.db.insert("messages", {
      conversationId: args.conversationId,
      userId,
      role: "user",
      content: args.content,
    });

    // Estimate tokens (~4 chars per token)
    const inputTokens = Math.ceil(args.content.length / 4);
    const outputTokens = Math.ceil(args.response.length / 4);
    const costCents = (inputTokens / 1_000_000) * args.inputCostPerMillion * 100
                    + (outputTokens / 1_000_000) * args.outputCostPerMillion * 100;

    // Save assistant message
    await ctx.db.insert("messages", {
      conversationId: args.conversationId,
      userId,
      role: "assistant",
      content: args.response,
      tokensUsed: inputTokens + outputTokens,
      costCents,
    });

    await ctx.db.patch(args.conversationId, { lastMessageAt: Date.now() });

    // Deduct AB
    const user = await ctx.db.get(userId);
    if (user) {
      const current = (user as { totalUsageCents?: number }).totalUsageCents || 0;
      const inputAB = 1.5 * inputTokens * args.inputCostPerMillion;
      const outputAB = 1.5 * outputTokens * args.outputCostPerMillion;
      const agentBucksToDeduct = Math.ceil(inputAB + outputAB);
      const daily = (user as { dailyAgentBucks?: number }).dailyAgentBucks ?? 0;
      const purchased = (user as { purchasedAgentBucks?: number }).purchasedAgentBucks ?? 0;
      let remainingDeduct = agentBucksToDeduct;
      const newPurchased = Math.max(0, purchased - remainingDeduct);
      remainingDeduct = Math.max(0, remainingDeduct - purchased);
      const newDaily = Math.max(0, daily - remainingDeduct);
      await ctx.db.patch(userId, {
        totalUsageCents: current + costCents,
        dailyAgentBucks: newDaily,
        purchasedAgentBucks: newPurchased,
      });
    }
  },
});