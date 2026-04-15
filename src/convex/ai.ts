"use node";
import { action } from "./_generated/server";
import { v } from "convex/values";
import { vly } from "../../src/lib/vly-integrations";
import { internal } from "./_generated/api";

export const sendMessage = action({
  args: {
    conversationId: v.id("conversations"),
    content: v.string(),
    mode: v.union(v.literal("chat"), v.literal("research"), v.literal("code")),
  },
  handler: async (ctx, args) => {
    const userId = await ctx.runQuery(internal.aiHelpers.getCurrentUserId);
    if (!userId) throw new Error("Not authenticated");

    // Save user message
    await ctx.runMutation(internal.aiHelpers.saveMessage, {
      conversationId: args.conversationId,
      userId,
      role: "user",
      content: args.content,
    });

    // Get conversation history
    const history = await ctx.runQuery(internal.aiHelpers.getConversationMessages, {
      conversationId: args.conversationId,
    });

    const systemPrompts: Record<string, string> = {
      chat: `You are AgentAI, an advanced AI assistant. You communicate in a clear, helpful manner. Format responses with markdown when appropriate. Be concise but thorough.`,
      research: `You are AgentAI Research Mode. You are a deep research assistant that provides comprehensive, well-sourced analysis. Break down complex topics, cite reasoning, and provide structured reports. Use headers, bullet points, and organized sections.`,
      code: `You are AgentAI Code Mode. You are an expert software engineer and coding assistant. Write clean, well-commented code. Explain your implementations. Support all programming languages. Format all code in proper markdown code blocks with language tags.`,
    };

    const messages = [
      { role: "system" as const, content: systemPrompts[args.mode] },
      ...history.map((m: { role: string; content: string }) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      })),
    ];

    const result = await vly.ai.completion({
      model: "claude-3-5-sonnet-20241022",
      messages,
      maxTokens: 4096,
    });

    if (!result.success || !result.data) {
      throw new Error(result.error || "AI request failed");
    }

    const responseContent = result.data.choices[0]?.message?.content || "No response";
    const tokensUsed = result.data.usage?.totalTokens || 0;
    const costCents = Math.ceil((tokensUsed / 1_000_000) * 300);

    await ctx.runMutation(internal.aiHelpers.saveAssistantMessage, {
      conversationId: args.conversationId,
      userId,
      content: responseContent,
      tokensUsed,
      costCents,
    });

    return responseContent;
  },
});