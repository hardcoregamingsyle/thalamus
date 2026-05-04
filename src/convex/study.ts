"use node";
import { action, internalMutation, internalQuery } from "./_generated/server";
// Public CRUD is in studyHelpers.ts (non-node file)
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { Id } from "./_generated/dataModel";
import { callClaude, performSearch } from "./agentCore";

// ── Process file/image with Claude Vision via Bedrock ─────────────────────────
export const processFileResource = action({
  args: {
    token: v.string(),
    fileName: v.string(),
    fileType: v.string(),
    fileDataBase64: v.string(),
  },
  handler: async (ctx, args): Promise<{ resourceId: string; summary: string }> => {
    const userId = (await ctx.runQuery(internal.customAuthHelpers.getUserIdByToken, { token: args.token })) as Id<"users"> | null;
    if (!userId) throw new Error("Not authenticated");

    const isImage = args.fileType.startsWith("image/");
    let summary = "";

    if (isImage) {
      // Try Bedrock first, fallback to VLY
      try {
        const prompt = `Please analyze this image and provide a comprehensive summary of all content, text, diagrams, charts, and visual information present. Be thorough and extract all useful information for study purposes.\n\nImage data (base64, ${args.fileType}): ${args.fileDataBase64.slice(0, 80000)}`;
        const result = await callClaude(prompt, "You are a study assistant that extracts and summarizes content from images and files.", "claude-haiku-4-5");
        summary = result.text;
      } catch {
        // Fallback to VLY
        const { vly } = await import('../lib/vly-integrations');
        const result = await vly.ai.completion({
          model: "claude-haiku-4-5",
          messages: [{ role: "user", content: `Please analyze this image and provide a comprehensive summary of all content, text, diagrams, charts, and visual information present. Be thorough and extract all useful information for study purposes.\n\nImage data (base64, ${args.fileType}): ${args.fileDataBase64.slice(0, 80000)}` }],
          maxTokens: 2000,
        });
        summary = (result.success && result.data) ? (result.data.choices[0]?.message?.content ?? "Could not process image") : "Image uploaded (could not extract text)";
      }
    } else {
      // Try to decode as text first
      try {
        const decoded = Buffer.from(args.fileDataBase64, "base64").toString("utf-8");
        if (decoded.length > 100 && decoded.split("").filter(c => c.charCodeAt(0) > 31 && c.charCodeAt(0) < 127).length / decoded.length > 0.8) {
          summary = decoded.slice(0, 50000);
        } else {
          throw new Error("Binary file");
        }
      } catch {
        // Use Claude to extract content
        try {
          const prompt = `Please extract and summarize all content from this file for study purposes. File name: ${args.fileName}\n\nFile content (base64): ${args.fileDataBase64.slice(0, 50000)}`;
          const result = await callClaude(prompt, "You are a study assistant that extracts and summarizes content from files.", "claude-haiku-4-5");
          summary = result.text;
        } catch {
          const { vly } = await import('../lib/vly-integrations');
          const result = await vly.ai.completion({
            model: "claude-haiku-4-5",
            messages: [{ role: "user", content: `Please extract and summarize all content from this file for study purposes. File name: ${args.fileName}\n\nFile content (base64): ${args.fileDataBase64.slice(0, 50000)}` }],
            maxTokens: 2000,
          });
          summary = (result.success && result.data) ? (result.data.choices[0]?.message?.content ?? "Could not process file") : "File uploaded (could not extract content)";
        }
      }
    }

    const resourceId = await ctx.runMutation(internal.studyHelpers.insertResource, {
      userId,
      title: args.fileName,
      content: summary,
      sourceType: isImage ? "image" : "file",
      fileName: args.fileName,
      fileType: args.fileType,
    });

    return { resourceId: resourceId as string, summary: summary.slice(0, 200) };
  },
});

// ── AI web search and add resource ───────────────────────────────────────────
export const searchAndAddResource = action({
  args: { token: v.string(), query: v.string() },
  handler: async (ctx, args): Promise<{ resourceId: string; title: string; summary: string }> => {
    const userId = (await ctx.runQuery(internal.customAuthHelpers.getUserIdByToken, { token: args.token })) as Id<"users"> | null;
    if (!userId) throw new Error("Not authenticated");

    const systemPrompt = `You are a research assistant. When given a topic or query, provide a comprehensive, well-structured summary of the key information about that topic. Include definitions, key concepts, important facts, and relevant details. Format as plain text suitable for study notes. Be accurate and thorough.`;

    // Use Claude Haiku via Bedrock as primary, fallback to VLY
    let text = "";
    try {
      const result = await callClaude(
        `Research and summarize for study purposes: ${args.query}`,
        systemPrompt,
        "claude-haiku-4-5"
      );
      text = result.text;
    } catch {
      const { vly } = await import('../lib/vly-integrations');
      const result = await vly.ai.completion({
        model: "claude-haiku-4-5",
        messages: [{ role: "user", content: `Research and summarize for study purposes: ${args.query}` }],
        maxTokens: 3000,
      });
      text = (result.success && result.data) ? (result.data.choices[0]?.message?.content ?? "Could not research topic") : "Research failed";
    }

    const title = args.query.slice(0, 100);
    const resourceId = await ctx.runMutation(internal.studyHelpers.insertResource, {
      userId,
      title,
      content: text,
      sourceType: "web",
    });

    return { resourceId: resourceId as string, title, summary: text.slice(0, 200) };
  },
});

// ── Send study message ────────────────────────────────────────────────────────
export const sendStudyMessage = action({
  args: {
    conversationId: v.id("conversations"),
    content: v.string(),
    token: v.string(),
  },
  handler: async (ctx, args): Promise<string> => {
    const userId = (await ctx.runQuery(internal.customAuthHelpers.getUserIdByToken, { token: args.token })) as Id<"users"> | null;
    if (!userId) throw new Error("Not authenticated");

    await ctx.runMutation(internal.aiHelpers.saveMessage, {
      conversationId: args.conversationId,
      userId,
      role: "user",
      content: args.content,
    });

    const history = await ctx.runQuery(internal.aiHelpers.getConversationMessages, {
      conversationId: args.conversationId,
    }) as Array<{ role: string; content: string }>;

    const resources = await ctx.runQuery(internal.studyHelpers.getResourcesForUser, { userId });

    // Always do a live web search for fresh info
    let liveSearchResults = "";
    try {
      liveSearchResults = await performSearch(args.content);
    } catch {
      liveSearchResults = "";
    }

    let resourceContext = "";
    if (resources.length > 0) {
      resourceContext = "\n\n## YOUR STUDY RESOURCES:\n" + resources.map((r: { title: string; content: string }, i: number) =>
        `### Resource ${i + 1}: ${r.title}\n${r.content.slice(0, 2000)}`
      ).join("\n\n---\n\n");
    }

    const systemPrompt = `You are a Study Assistant powered by Thalamus AI. You help students learn and understand topics accurately.

IMPORTANT: Always use the live search results provided below as your PRIMARY source of information. They contain the most up-to-date and accurate data. Do NOT rely on your training data when live search results are available.

${liveSearchResults ? `## LIVE SEARCH RESULTS (use these as primary source):\n${liveSearchResults}` : ""}
${resourceContext ? `\n${resourceContext}` : ""}

When answering:
1. Prioritize the live search results above all else
2. Use uploaded resources as supplementary context
3. If neither has the answer, use general knowledge but clearly state it
4. Never make up or guess information

RESPONSE FORMAT: Respond in clean, semantic HTML only. No markdown. No plain text. Pure HTML.

Use these HTML elements:
- <h2>, <h3> for section headers (style="font-size:1.2em;font-weight:bold;margin:0.6em 0 0.3em;color:#e5e7eb")
- <p> for paragraphs (style="margin:0.4em 0;line-height:1.6;color:#d1d5db")
- <ul>, <ol>, <li> for lists (style="margin:0.3em 0 0.3em 1.2em;color:#d1d5db")
- <strong> for key terms (style="color:#f9fafb;font-weight:600")
- <blockquote> for important notes (style="border-left:3px solid #6366f1;padding-left:1em;color:#a5b4fc;margin:0.5em 0;background:#1e1b4b;border-radius:0 8px 8px 0;padding:0.5em 1em")
- <code> for inline code (style="background:#1f2937;color:#34d399;padding:0.1em 0.4em;border-radius:4px;font-family:monospace;font-size:0.85em")
- <pre><code> for code blocks
- <table> for comparisons

Be educational, clear, and accurate.`;

    // Build conversation context for Claude
    const conversationContext = history.slice(-10).map((m: { role: string; content: string }) =>
      `${m.role === "user" ? "Human" : "Assistant"}: ${m.content.slice(0, 800)}`
    ).join("\n\n");

    const fullPrompt = conversationContext
      ? `${conversationContext}\n\nHuman: ${args.content}`
      : args.content;

    // Use Claude Haiku via Bedrock as primary, fallback to VLY
    let responseContent = "";
    let inputTokens = 0;
    let outputTokens = 0;

    try {
      const result = await callClaude(fullPrompt, systemPrompt, "claude-haiku-4-5");
      responseContent = result.text;
      inputTokens = result.inputTokens;
      outputTokens = result.outputTokens;
    } catch {
      // Fallback to VLY
      const { vly } = await import('../lib/vly-integrations');
      const result = await vly.ai.completion({
        model: "claude-haiku-4-5",
        messages: [{ role: "user", content: systemPrompt + "\n\n" + fullPrompt }],
        maxTokens: 4096,
      });
      responseContent = (result.success && result.data) ? (result.data.choices[0]?.message?.content ?? "No response") : "Failed to get response";
    }

    // Haiku 4.5 pricing: $1/$5 per million tokens (in dollars) = 100/500 cents per million
    const inputCostCents = (inputTokens / 1_000_000) * 100;
    const outputCostCents = (outputTokens / 1_000_000) * 500;
    const costCents = Math.max(1, Math.ceil(inputCostCents + outputCostCents));

    await ctx.runMutation(internal.aiHelpers.saveAssistantMessage, {
      conversationId: args.conversationId,
      userId,
      content: responseContent,
      tokensUsed: inputTokens + outputTokens,
      costCents,
    });

    return responseContent;
  },
});