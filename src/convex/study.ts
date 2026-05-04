"use node";
import { action, internalMutation, internalQuery } from "./_generated/server";
// Public CRUD is in studyHelpers.ts (non-node file)
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { Id } from "./_generated/dataModel";

// Gemini keys (same pool)
const GEMINI_KEYS = [
  "AIzaSyB6LdCRxGz27Xpj-K8-EiOVBQRvl0SPzyQ",
  "AIzaSyBZHdEWGlYTpr26fVGGWBOHxn4dRKkd-9Y",
  "AIzaSyCJHWZmUwc2_HAV-KS0Q4C50aOBkvm7OwE",
  "AIzaSyCOX7-EwKrZDVh6qUeGoqT_G-D3svl6tco",
  "AIzaSyCyRPBb-rFOZD_6aKgX6cQiKOshjlXt1ho",
  "AIzaSyBDXq8Oceo1DYXDjlM2t0voCxF8wRKCAK0",
  "AIzaSyD4cuooT54P1oCkDq3kJxbRJ2Kf1A9aaXU",
  "AIzaSyAr5AlBQ2RIPiAlYZAJMVboV_0W6WZJh4g",
  "AIzaSyA6TuU_Xu635NSouv2Y9l9DuUowp5CYkzc",
  "AIzaSyDTCwP3prKrW3f2HdiZegHHVXfXZGiaHA0",
];

let keyIdx = 0;

async function callGeminiChat(
  systemPrompt: string,
  messages: Array<{ role: "user" | "model"; parts: Array<{ text: string }> }>,
  maxTokens = 4096
): Promise<{ text: string; inputTokens: number; outputTokens: number }> {
  for (let attempt = 0; attempt < GEMINI_KEYS.length; attempt++) {
    const key = GEMINI_KEYS[keyIdx % GEMINI_KEYS.length];
    keyIdx++;
    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite-preview:generateContent?key=${key}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            system_instruction: { parts: [{ text: systemPrompt }] },
            contents: messages,
            generationConfig: { maxOutputTokens: maxTokens, temperature: 0.7 },
          }),
        }
      );
      if (!response.ok) {
        if (response.status === 429 || response.status === 403) continue;
        throw new Error(`Gemini error ${response.status}`);
      }
      const data = await response.json() as {
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
        usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
      };
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) throw new Error("No response from Gemini");
      return {
        text,
        inputTokens: data.usageMetadata?.promptTokenCount ?? 0,
        outputTokens: data.usageMetadata?.candidatesTokenCount ?? 0,
      };
    } catch (err) {
      if (attempt === GEMINI_KEYS.length - 1) throw err;
    }
  }
  throw new Error("All Gemini keys exhausted");
}

// ── Process file/image with Claude Vision ─────────────────────────────────────
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

    const { vly } = await import('../lib/vly-integrations');
    const isImage = args.fileType.startsWith("image/");

    let summary = "";

    if (isImage) {
      const result = await vly.ai.completion({
        model: "claude-haiku-4-5",
        messages: [{
          role: "user",
          content: `Please analyze this image and provide a comprehensive summary of all content, text, diagrams, charts, and visual information present. Be thorough and extract all useful information for study purposes.\n\nImage data (base64, ${args.fileType}): ${args.fileDataBase64.slice(0, 80000)}`,
        }],
        maxTokens: 2000,
      });
      summary = (result.success && result.data) ? (result.data.choices[0]?.message?.content ?? "Could not process image") : "Image uploaded (could not extract text)";
    } else {
      try {
        const decoded = Buffer.from(args.fileDataBase64, "base64").toString("utf-8");
        if (decoded.length > 100) {
          summary = decoded.slice(0, 50000);
        } else {
          throw new Error("Empty or binary file");
        }
      } catch {
        const result = await vly.ai.completion({
          model: "claude-haiku-4-5",
          messages: [{
            role: "user",
            content: `Please extract and summarize all content from this file for study purposes. File name: ${args.fileName}\n\nFile content (base64): ${args.fileDataBase64.slice(0, 50000)}`,
          }],
          maxTokens: 2000,
        });
        summary = (result.success && result.data) ? (result.data.choices[0]?.message?.content ?? "Could not process file") : "File uploaded (could not extract content)";
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

    const systemPrompt = `You are a research assistant. When given a topic or query, provide a comprehensive, well-structured summary of the key information about that topic. Include definitions, key concepts, important facts, and relevant details. Format as plain text suitable for study notes.`;

    const { text } = await callGeminiChat(
      systemPrompt,
      [{ role: "user", parts: [{ text: `Research and summarize for study purposes: ${args.query}` }] }],
      3000
    );

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

    let resourceContext = "";
    if (resources.length > 0) {
      resourceContext = "\n\n## YOUR STUDY RESOURCES:\n" + resources.map((r: { title: string; content: string }, i: number) =>
        `### Resource ${i + 1}: ${r.title}\n${r.content.slice(0, 3000)}`
      ).join("\n\n---\n\n");
    }

    const systemPrompt = `You are a Study Assistant powered by Thalamus AI. You help students learn and understand topics.

${resourceContext ? `You have access to the following study resources that the user has uploaded or added:${resourceContext}\n\nWhen answering questions, prioritize information from these resources when relevant.` : "No study resources have been added yet. Answer based on your general knowledge."}

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

Be educational, clear, and thorough. If the question relates to uploaded resources, reference them specifically.`;

    const geminiMessages = history.map((m: { role: string; content: string }) => ({
      role: m.role === "assistant" ? "model" as const : "user" as const,
      parts: [{ text: m.content }],
    }));

    const { text: responseContent, inputTokens, outputTokens } = await callGeminiChat(
      systemPrompt,
      geminiMessages,
      4096
    );

    const tokensUsed = inputTokens + outputTokens;
    const inputCostCents = (inputTokens / 1_000_000) * 60;
    const outputCostCents = (outputTokens / 1_000_000) * 240;
    const costCents = Math.max(1, Math.ceil(inputCostCents + outputCostCents));

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