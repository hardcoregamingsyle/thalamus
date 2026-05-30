"use node";
import { action } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { Id } from "./_generated/dataModel";
import { callClaude } from "./agentCore";

// ── Gemini with Google Search Grounding ───────────────────────────────────────
interface GeminiGroundedResponse {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
}

// Strip markdown code fences from AI output (Gemini sometimes wraps HTML in code fences)
function stripCodeFences(text: string): string {
  // Remove 
}