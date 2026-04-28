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
      chat: `You are AgentAI, an advanced AI assistant. You communicate in a clear, helpful manner. Format responses with markdown when appropriate. Be concise but thorough.`,
      research: `You are AgentAI Research Mode. You are a deep research assistant that provides comprehensive, well-sourced analysis. Break down complex topics, cite reasoning, and provide structured reports. Use headers, bullet points, and organized sections.`,
      code: `You are AgentAI Code Mode. You are an expert software engineer and coding assistant. Write clean, well-commented code. Explain your implementations. Support all programming languages. Format all code in proper markdown code blocks with language tags.`,
    };

    // --- ANTHROPIC/CLAUDE CODE COMMENTED OUT - will restore later ---
    // const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    // const messages: Array<{ role: "user" | "assistant"; content: string }> = history.map(
    //   (m: { role: string; content: string }) => ({
    //     role: m.role as "user" | "assistant",
    //     content: m.content,
    //   })
    // );
    // const response: Anthropic.Message = await client.messages.create({
    //   model: "claude-3-5-sonnet-20241022",
    //   max_tokens: 4096,
    //   system: systemPrompts[args.mode],
    //   messages,
    // });
    // const responseContent: string =
    //   response.content[0]?.type === "text" ? response.content[0].text : "No response";
    // const inputCostCents = ((response.usage?.input_tokens || 0) / 1_000_000) * 35;
    // const outputCostCents = ((response.usage?.output_tokens || 0) / 1_000_000) * 145;
    // const costCents: number = Math.ceil(inputCostCents + outputCostCents);
    // --- END ANTHROPIC CODE ---

    // Using Gemini instead
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
    // Pricing: $0.35/M input tokens, $1.45/M output tokens (in cents: 35/M input, 145/M output)
    const inputCostCents = (inputTokens / 1_000_000) * 35;
    const outputCostCents = (outputTokens / 1_000_000) * 145;
    const costCents: number = Math.ceil(inputCostCents + outputCostCents);

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