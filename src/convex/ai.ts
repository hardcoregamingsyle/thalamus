"use node";
import { action } from "./_generated/server";
import { v } from "convex/values";
import Anthropic from "@anthropic-ai/sdk";
import { internal } from "./_generated/api";
import { Id } from "./_generated/dataModel";

export const sendMessage = action({
  args: {
    conversationId: v.id("conversations"),
    content: v.string(),
    mode: v.union(v.literal("chat"), v.literal("research"), v.literal("code")),
  },
  handler: async (ctx, args): Promise<string> => {
    const userId: Id<"users"> | null = await ctx.runQuery(internal.aiHelpers.getCurrentUserId);
    if (!userId) throw new Error("Not authenticated");

    await ctx.runMutation(internal.aiHelpers.saveMessage, {
      conversationId: args.conversationId,
      userId,
      role: "user",
      content: args.content,
    });

    const history: Array<{ role: string; content: string }> = await ctx.runQuery(
      internal.aiHelpers.getConversationMessages,
      { conversationId: args.conversationId }
    );

    const systemPrompts: Record<string, string> = {
      chat: `You are AgentAI, an advanced AI assistant. You communicate in a clear, helpful manner. Format responses with markdown when appropriate. Be concise but thorough.`,
      research: `You are AgentAI Research Mode. You are a deep research assistant that provides comprehensive, well-sourced analysis. Break down complex topics, cite reasoning, and provide structured reports. Use headers, bullet points, and organized sections.`,
      code: `You are AgentAI Code Mode. You are an expert software engineer and coding assistant. Write clean, well-commented code. Explain your implementations. Support all programming languages. Format all code in proper markdown code blocks with language tags.`,
    };

    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    const messages: Array<{ role: "user" | "assistant"; content: string }> = history.map(
      (m: { role: string; content: string }) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      })
    );

    const response: Anthropic.Message = await client.messages.create({
      model: "claude-3-5-sonnet-20241022",
      max_tokens: 4096,
      system: systemPrompts[args.mode],
      messages,
    });

    const responseContent: string =
      response.content[0]?.type === "text" ? response.content[0].text : "No response";
    const tokensUsed: number =
      (response.usage?.input_tokens || 0) + (response.usage?.output_tokens || 0);
    const costCents: number = Math.ceil((tokensUsed / 1_000_000) * 900);

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