"use node";
import { action } from "./_generated/server";
import { v } from "convex/values";
// import Anthropic from "@anthropic-ai/sdk"; // COMMENTED OUT - will restore later
import { internal } from "./_generated/api";
import { Id } from "./_generated/dataModel";

// Gemini keys (same pool as agentTeam.ts)
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
  "AIzaSyDneLEfifQh1IXNoko3AxnTAB0NFbezKhA",
  "AIzaSyA793SBkb73ezazr70XExT8iKKzS26uqy4",
  "AIzaSyA88JXgwsL97y0JbWmO6QxMGJ0dE19vRVA",
  "AIzaSyB_Hx34iB-rxaSsENMKdUIJSEAK5rMFf0w",
  "AIzaSyDakGlolmstnXqmirkLex_z6Avl0Zn4vEs",
  "AIzaSyChZvH5fNODWZ3mJa6RXwK1PthDTjpQgfM",
  "AIzaSyBnPzwY7W3pUUlqeKYkA_c-pvjcM135038",
  "AIzaSyB2w9KntAZ7bal3d9D4CIDdvT90rXIZ2pk",
  "AIzaSyBqutBm0ydorD4tZ0SBOjjiGXdtTe8gd5s",
  "AIzaSyDMiSElpUZrnAA90zEuwF2YLggqI_-EjLA",
  "AIzaSyCfG5VQkykXL3DZctm8C80bhyWG2tdr6qk",
  "AIzaSyCJyKJ7yPhh9KOIpb3Z7VNDfjgHA8yJQr4",
  "AIzaSyC392jTpY8XbVGN358sESqj0E5FnIkYrcQ",
  "AIzaSyCBBa1hgfmfXbLsRk2hJGyIEJzo95Ko6z4",
  "AIzaSyC7grgkRNn4zE_0ZvnozWobmA7gBSDPwRs",
  "AIzaSyApiopBDIVMBVkDer8i6E_GMGEogdHynhM",
  "AIzaSyA2gJXoZTS-Ll6P6Qt6A9gSWFYI0C4s3l4",
  "AIzaSyDVP_XzW-PDLV7LjDs8i63D0YoR8MoAU78",
  "AIzaSyDkyRQ8OsenlR28zAYaCi0zfOTSWs_KnYU",
  "AIzaSyDKulyCA6UxgQP9R-xe6TWce_uP_6EJTnQ",
  "AIzaSyCUl4E8ejdI3r8p33M_i4QWfz6giVyIksI",
  "AIzaSyBECrLldG06NXGRUhS5Q9TzslQITzDDKy0",
  "AIzaSyDD3I84pRmeSqn7oSl_ButSLApsPF3sYWY",
  "AIzaSyA_nBFap_luuVeWDnyb55mVWNeDpnuV2zA",
  "AIzaSyDBaOsY9YEmpMWbsV8Hu9QNRPCMinga7Lg",
  "AIzaSyANMS3D8AxlPM5K5-i4HmPbPA8dkc0aN7A",
  "AIzaSyBMS5wcINLRNWYqynR3zZVgr4MX2_ptwtc",
  "AIzaSyDsBiJQNTZNJaj4BGyJbZfCq53-sC_BTTY",
  "AIzaSyDwZWGLK7eFJE5rL6GMJ22bIaAkSPXyiaI",
  "AIzaSyBrYwXdIzJOFXgRhUkT_kjMKnYOIwwh7DY",
  "AIzaSyB7u39uRWgz-lrnqamfQc9DatVh56XBK2M",
  "AIzaSyCTSdSLE8ysGXjNRcfz25gY5DZbeItJV-I",
  "AIzaSyDFIBN_K3FPLGS3Th--1xYgbpB3lhPL2ZI",
  "AIzaSyCcEB5QyW6JEeLgT8wq0ccHJNvLKLmqh9s",
  "AIzaSyDX3UPwaM11izKZyevMMzggJ6l0ug1MhLo",
  "AIzaSyBoz8WhcxsU-i239Oz3Syx0MshAhuTTNfI",
  "AIzaSyBHbPU7FYxN_4i-3MGZ7cCQgIAPPRzJqq4",
  "AIzaSyDrrM9MTkFjs7BChVkU4SxyZnf1Xu5Xhhs",
  "AIzaSyANGG0wzP0ITzPhqsxrdLl_lUMnYYipp1c",
  "AIzaSyBdCYps0Q2RdhQNC3uZ0By_OhmG6n-ojAI",
  "AIzaSyAi9t0GQT3xG3BGeea0dcdPc5WhvV5u1HY",
  "AIzaSyBwzVuPWWQnFu8YHdywXdhRFNSzwHne3FU",
  "AIzaSyB1hONrY0VZGR7GnqiObwV5o2Sbj5KEABc",
  "AIzaSyD3TipoUWjPPoPPYBMDtqI2u3gpkL4rjAY",
  "AIzaSyCS6BelDTp-2z5ijR0ty9YAPggMR5ZTkaY",
  "AIzaSyBabAY1FFEWcNMs0p4KE_lQb4jo1ttq2CM",
  "AIzaSyA7Ty_XryseCBotd6FEja19jhkVlanqEfQ",
  "AIzaSyDp5Fp5PF3LGpuI2leyZVLKyiP4YnuWh5U",
  "AIzaSyCxNvdLynYYtCSsRh51Pk8I534k2ryvyB0",
];

let keyIndex = 0;

interface GeminiResponse {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
  };
}

async function callGeminiChat(
  systemPrompt: string,
  messages: Array<{ role: "user" | "assistant"; content: string }>,
  maxTokens = 4096
): Promise<{ text: string; inputTokens: number; outputTokens: number }> {
  const maxRetries = GEMINI_KEYS.length;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const key = GEMINI_KEYS[keyIndex % GEMINI_KEYS.length];
    keyIndex++;
    try {
      // Convert messages to Gemini format (alternating user/model)
      const contents = messages.map((m) => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.content }],
      }));

      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite-preview:generateContent?key=${key}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            system_instruction: { parts: [{ text: systemPrompt }] },
            contents,
            generationConfig: { maxOutputTokens: maxTokens, temperature: 0.7 },
          }),
        }
      );
      if (!response.ok) {
        if (response.status === 429 || response.status === 403) continue;
        const err = await response.text();
        throw new Error(`Gemini API error ${response.status}: ${err}`);
      }
      const data = await response.json() as GeminiResponse;
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) throw new Error("No response from Gemini");
      const inputTokens = data.usageMetadata?.promptTokenCount ?? 0;
      const outputTokens = data.usageMetadata?.candidatesTokenCount ?? 0;
      return { text, inputTokens, outputTokens };
    } catch (err) {
      if (attempt === maxRetries - 1) throw err;
    }
  }
  throw new Error("All Gemini API keys exhausted");
}

export const sendMessage = action({
  args: {
    conversationId: v.id("conversations"),
    content: v.string(),
    mode: v.union(v.literal("chat"), v.literal("research"), v.literal("code")),
    token: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<string> => {
    const userId: Id<"users"> | null = await ctx.runQuery(
      internal.customAuthHelpers.getUserIdByToken,
      { token: args.token || "" }
    );
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
      chat: `You are AgentAI, an advanced AI assistant powered by AMD MI300X GPUs. 

CRITICAL: You MUST respond in clean, semantic HTML only. No markdown. No plain text. Pure HTML.

Use these HTML elements with inline Tailwind-compatible styles:
- <h1>, <h2>, <h3> for headings (use style="font-size:1.2em;font-weight:bold;margin:0.5em 0;color:#e5e7eb")
- <p> for paragraphs (use style="margin:0.5em 0;line-height:1.6;color:#d1d5db")
- <ul>, <ol>, <li> for lists (use style="margin:0.3em 0 0.3em 1.2em")
- <strong> for bold (use style="color:#f9fafb;font-weight:600")
- <em> for italic
- <code> for inline code (use style="background:#1f2937;color:#34d399;padding:0.1em 0.4em;border-radius:4px;font-family:monospace;font-size:0.85em")
- <pre><code> for code blocks (use style="background:#111827;color:#34d399;padding:1em;border-radius:8px;overflow-x:auto;display:block;margin:0.5em 0;font-family:monospace;font-size:0.8em")
- <blockquote> for quotes (use style="border-left:3px solid #374151;padding-left:1em;color:#9ca3af;margin:0.5em 0")
- <hr> for dividers (use style="border:none;border-top:1px solid #374151;margin:1em 0")
- <a> for links (use style="color:#60a5fa;text-decoration:underline")
- <table>, <tr>, <th>, <td> for tables with appropriate styles
- <div> for sections with style="margin:0.5em 0"

Be thorough, helpful, and well-structured. Use rich HTML formatting to make responses beautiful and readable.`,

      research: `You are AgentAI Research Mode — a deep research assistant powered by AMD MI300X GPUs.

CRITICAL: You MUST respond in clean, semantic HTML only. No markdown. No plain text. Pure HTML.

Structure your research reports with:
- A clear <h1> title
- <h2> section headers for major topics
- <h3> sub-section headers
- <p> for analysis paragraphs
- <ul>/<ol> for findings and bullet points
- <table> for comparisons and data
- <blockquote> for key insights
- <pre><code> for technical examples
- <strong> for key terms and important findings
- <hr> between major sections

Use these styles:
- Headings: style="font-size:1.3em;font-weight:bold;margin:0.8em 0 0.4em;color:#f9fafb"
- Paragraphs: style="margin:0.5em 0;line-height:1.7;color:#d1d5db"
- Lists: style="margin:0.3em 0 0.3em 1.5em;color:#d1d5db"
- Code: style="background:#111827;color:#34d399;padding:1em;border-radius:8px;overflow-x:auto;display:block;margin:0.5em 0;font-family:monospace;font-size:0.8em"
- Tables: style="width:100%;border-collapse:collapse;margin:0.5em 0"
- Table headers: style="background:#1f2937;padding:0.5em;text-align:left;color:#f9fafb;border:1px solid #374151"
- Table cells: style="padding:0.5em;border:1px solid #374151;color:#d1d5db"

Be comprehensive, cite reasoning, and provide structured analysis.`,

      code: `You are AgentAI Code Mode — an expert software engineer powered by AMD MI300X GPUs.

CRITICAL: You MUST respond in clean, semantic HTML only. No markdown. No plain text. Pure HTML.

For code responses:
- Use <pre><code style="background:#111827;color:#34d399;padding:1em;border-radius:8px;overflow-x:auto;display:block;margin:0.5em 0;font-family:monospace;font-size:0.8em;white-space:pre"> for ALL code blocks
- Use <code style="background:#1f2937;color:#34d399;padding:0.1em 0.4em;border-radius:4px;font-family:monospace;font-size:0.85em"> for inline code
- Use <h2> for section headers
- Use <p> for explanations
- Use <ul>/<li> for steps and bullet points
- Use <strong> for important terms

Always explain your code with clear HTML-formatted text before and after code blocks.`,
    };

    const messages: Array<{ role: "user" | "assistant"; content: string }> = history.map(
      (m: { role: string; content: string }) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      })
    );

    const { text: responseContent, inputTokens, outputTokens } = await callGeminiChat(
      systemPrompts[args.mode],
      messages,
      4096
    );

    const tokensUsed = inputTokens + outputTokens;
    // Gemini 2.0 Flash Lite pricing: $0.075/1M input, $0.30/1M output
    const inputCostCents = (inputTokens / 1_000_000) * 7.5;
    const outputCostCents = (outputTokens / 1_000_000) * 30;
    const costCents: number = Math.max(1, Math.ceil(inputCostCents + outputCostCents));

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

// ── VLY Gateway Test Action ────────────────────────────────────────────────────
export const testVlyHaiku = action({
  args: { model: v.optional(v.string()) },
  handler: async (_ctx, args): Promise<{ success: boolean; response?: string; error?: string; raw?: unknown }> => {
    const { vly } = await import('../lib/vly-integrations');
    const modelName = args.model ?? "claude-haiku-4-5";
    try {
      const result = await vly.ai.completion({
        model: modelName,
        messages: [{ role: 'user', content: 'Say hello in one sentence.' }],
        maxTokens: 100
      });
      if (result.success && result.data) {
        return { success: true, response: result.data.choices[0]?.message?.content ?? "No content", raw: result };
      }
      return { success: false, error: result.error ?? "Unknown error", raw: result };
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : String(e) };
    }
  },
});