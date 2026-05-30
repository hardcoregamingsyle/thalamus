"use node";
import { action, internalAction } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { Id } from "./_generated/dataModel";

// Gemini keys are loaded from the DB (admin-managed via Admin UI → Gemini Keys tab)
async function getGeminiKeysFromDB(ctx: { runQuery: Function }): Promise<string[]> {
  try {
    const keys = await ctx.runQuery(internal.admin.getGeminiKeysInternal, {}) as string[];
    if (keys && keys.length > 0) return keys;
  } catch { /* fall through */ }
  return [];
}

let keyIndex = 0;

interface GeminiResponse {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
  };
}

// Strip markdown code fences from AI output (Gemini sometimes wraps HTML in code fences)
function stripCodeFences(text: string): string {
  return text
    .replace(/^
  return text
    .replace(/^```(?:\w+)?\n([\s\S]*?)\n```$/g, '$1')
    .replace(/^```([\s\S]*?)```$/g, '$1');
}