"use node";
import { action, internalAction, type ActionCtx } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { Id } from "./_generated/dataModel";
import { performSearch, FREE_UNLIMITED, callSiliconFlow, callOpenAIFailover, callAgentRouter, agentRouterModelForTier, AGENTROUTER_PRIMARY, OPENAI_PRIMARY, PRIMARY_PROVIDER } from "./agentCore";

// Gemini keys are loaded from the DB (admin-managed via Admin UI)
async function getGeminiKeysFromDB(ctx: { runQuery: ActionCtx["runQuery"] }): Promise<string[]> {
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
  let result = text.trim();
  result = result.replace(/^```[a-zA-Z]*\n/, "");
  result = result.replace(/\n```$/, "");
  result = result.replace(/^```\n?/, "");
  result = result.replace(/\n?```$/, "");
  return result.trim();
}

// SigV4 helpers
function toArrayBuffer(data: Uint8Array): ArrayBuffer {
  const ab = new ArrayBuffer(data.byteLength);
  new Uint8Array(ab).set(data);
  return ab;
}

async function sha256Hex(data: string | Uint8Array): Promise<string> {
  const enc = new TextEncoder();
  const encoded = typeof data === "string" ? enc.encode(data) : data;
  const hash = await globalThis.crypto.subtle.digest("SHA-256", toArrayBuffer(encoded));
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, "0")).join("");
}

async function hmacSha256(key: ArrayBuffer | Uint8Array, data: string): Promise<ArrayBuffer> {
  const enc = new TextEncoder();
  const keyBuf = key instanceof Uint8Array ? toArrayBuffer(key) : key;
  const k = await globalThis.crypto.subtle.importKey("raw", keyBuf, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return globalThis.crypto.subtle.sign("HMAC", k, toArrayBuffer(enc.encode(data)));
}

async function signBedrockHeaders(
  method: string,
  host: string,
  canonicalPath: string,
  body: string,
  accessKeyId: string,
  secretAccessKey: string,
  region: string,
): Promise<Record<string, string>> {
  const enc = new TextEncoder();
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.substring(0, 8);

  const hdrs: Record<string, string> = {
    "content-type": "application/json",
    "host": host,
    "x-amz-date": amzDate,
  };
  const sortedKeys = Object.keys(hdrs).sort();
  const canonicalHeaders = sortedKeys.map(k => `${k}:${hdrs[k]}\n`).join("");
  const signedHeaders = sortedKeys.join(";");
  const hashedPayload = await sha256Hex(body);
  const canonicalRequest = [method, canonicalPath, "", canonicalHeaders, signedHeaders, hashedPayload].join("\n");
  const algorithm = "AWS4-HMAC-SHA256";
  const credentialScope = `${dateStamp}/${region}/bedrock/aws4_request`;
  const stringToSign = [algorithm, amzDate, credentialScope, await sha256Hex(canonicalRequest)].join("\n");
  const kSecret = enc.encode(`AWS4${secretAccessKey}`);
  const kDate = await hmacSha256(kSecret, dateStamp);
  const kRegion = await hmacSha256(kDate, region);
  const kService = await hmacSha256(kRegion, "bedrock");
  const kSigning = await hmacSha256(kService, "aws4_request");
  const sigBuf = await hmacSha256(kSigning, stringToSign);
  const signature = Array.from(new Uint8Array(sigBuf)).map(b => b.toString(16).padStart(2, "0")).join("");
  const authorization = `${algorithm} Credential=${accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return {
    "Content-Type": "application/json",
    "X-Amz-Date": amzDate,
    "Authorization": authorization,
  };
}

// Bedrock model ID mapping
const BEDROCK_MODEL_IDS: Record<string, string> = {
  "claude-haiku-4-5":  "us.anthropic.claude-haiku-4-5-20251001-v1:0",
  "claude-sonnet-4-6": "us.anthropic.claude-sonnet-4-6-20251101-v1:0",
  "claude-opus-4-6":   "us.anthropic.claude-opus-4-6-20251101-v1:0",
  "claude-opus-4-8":   "us.anthropic.claude-opus-4-8-20260101-v1:0",
};

const BEDROCK_MAX_TOKENS: Record<string, number> = {
  "claude-haiku-4-5":  8192,
  "claude-sonnet-4-6": 16000,
  "claude-opus-4-6":   16000,
  "claude-opus-4-8":   16000,
};

// Bedrock Claude call
async function callBedrockClaude(
  ctx: { runQuery: ActionCtx["runQuery"] },
  systemPrompt: string,
  messages: Array<{ role: "user" | "assistant"; content: string }>,
  maxTokens = 4096,
  modelName = "claude-haiku-4-5",
): Promise<{ text: string; inputTokens: number; outputTokens: number }> {
  const creds = await ctx.runQuery(internal.admin.getAwsCredentialsInternal, {}) as { accessKeyId: string; secretAccessKey: string; region: string } | null;
  if (!creds) throw new Error("No AWS credentials configured");

  const { accessKeyId } = creds;
  const secretAccessKey = creds.secretAccessKey.replace(/^["']|["']$/g, "");
  const region = "us-east-1";
  const modelId = BEDROCK_MODEL_IDS[modelName] ?? BEDROCK_MODEL_IDS["claude-haiku-4-5"];
  const effectiveMaxTokens = Math.min(maxTokens, BEDROCK_MAX_TOKENS[modelName] ?? 8192);
  const host = `bedrock-runtime.${region}.amazonaws.com`;
  const rawUrl = `https://${host}/model/${modelId}/invoke`;
  const canonicalPath = `/model/${encodeURIComponent(modelId)}/invoke`;

  const requestBody = JSON.stringify({
    anthropic_version: "bedrock-2023-05-31",
    system: systemPrompt,
    messages,
    max_tokens: effectiveMaxTokens,
    temperature: 0.7,
  });

  const headers = await signBedrockHeaders("POST", host, canonicalPath, requestBody, accessKeyId, secretAccessKey, region);

  const response = await fetch(rawUrl, { method: "POST", headers, body: requestBody });
  if (!response.ok) {
    const errText = await response.text().catch(() => "");
    throw new Error(`Bedrock HTTP ${response.status}: ${errText.slice(0, 300)}`);
  }

  const data = await response.json() as {
    content?: Array<{ type: string; text?: string }>;
    usage?: { input_tokens?: number; output_tokens?: number };
  };
  const text = data.content?.find(c => c.type === "text")?.text ?? "";
  const inputTokens = data.usage?.input_tokens ?? 0;
  const outputTokens = data.usage?.output_tokens ?? 0;
  return { text, inputTokens, outputTokens };
}

// Gemini chat call
async function callGeminiChat(
  ctx: { runQuery: ActionCtx["runQuery"] },
  systemPrompt: string,
  messages: Array<{ role: "user" | "assistant"; content: string }>,
  maxTokens = 4096
): Promise<{ text: string; inputTokens: number; outputTokens: number }> {
  const keys = await getGeminiKeysFromDB(ctx);
  if (keys.length === 0) throw new Error("No Gemini API keys configured. Add keys via Admin.");
  const maxRetries = keys.length;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const key = keys[keyIndex % keys.length];
    keyIndex++;
    try {
      const contents = messages.map((m) => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.content }],
      }));

      const response = await fetch(
        // 2.5-flash (GA), not flash-lite — real chat quality on the free tier.
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${key}`,
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
      const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!rawText) throw new Error("No response from Gemini");
      const inputTokens = data.usageMetadata?.promptTokenCount ?? 0;
      const outputTokens = data.usageMetadata?.candidatesTokenCount ?? 0;
      return { text: stripCodeFences(rawText), inputTokens, outputTokens };
    } catch (err) {
      if (attempt === maxRetries - 1) throw err;
    }
  }
  throw new Error("All Gemini API keys exhausted");
}

// Primary AI call: Bedrock first, Gemini fallback
async function callAI(
  ctx: { runQuery: ActionCtx["runQuery"] },
  systemPrompt: string,
  messages: Array<{ role: "user" | "assistant"; content: string }>,
  maxTokens = 4096,
  modelName = "claude-haiku-4-5",
): Promise<{ text: string; inputTokens: number; outputTokens: number; provider: string }> {
  // An OpenAI-compatible provider (DeepSeek / SambaNova / Cerebras / Groq)
  // as configured primary: serve chat straight from it with the full turn history.
  // On error OR an empty 200, degrade to Gemini rather than hard-failing the chat
  // request (chat surfaces degrade; only the pipeline treats the flag as absolute).
  if (OPENAI_PRIMARY) {
    try {
      const result = await callOpenAIFailover("", systemPrompt, "sonnet", maxTokens, messages);
      if (result.text && result.text.trim()) return { ...result, provider: PRIMARY_PROVIDER };
      console.warn(`${PRIMARY_PROVIDER} returned empty for chat, trying Gemini`);
    } catch (oaiErr) {
      console.warn(`${PRIMARY_PROVIDER} (primary) failed for chat, trying Gemini:`, oaiErr instanceof Error ? oaiErr.message : String(oaiErr));
    }
    const result = await callGeminiChat(ctx, systemPrompt, messages, maxTokens);
    return { ...result, provider: "gemini" };
  }
  // AgentRouter as configured primary (AWS Bedrock budget out): serve chat straight
  // from it, passing the full turn history. AR has no haiku — map onto its catalog.
  // On error OR an empty 200, skip the dead Bedrock leg (a 120s timeout) and try
  // Gemini directly before giving up.
  if (AGENTROUTER_PRIMARY) {
    try {
      const result = await callAgentRouter("", systemPrompt, agentRouterModelForTier("sonnet"), maxTokens, messages);
      if (result.text && result.text.trim()) return { ...result, provider: "agentrouter" };
      console.warn("AgentRouter returned empty for chat, trying Gemini");
    } catch (arErr) {
      console.warn("AgentRouter (primary) failed for chat, trying Gemini:", arErr instanceof Error ? arErr.message : String(arErr));
    }
    const result = await callGeminiChat(ctx, systemPrompt, messages, maxTokens);
    return { ...result, provider: "gemini" };
  }
  try {
    const result = await callBedrockClaude(ctx, systemPrompt, messages, maxTokens, modelName);
    return { ...result, provider: "bedrock" };
  } catch (bedrockErr) {
    console.warn("Bedrock failed, falling back to Gemini:", bedrockErr instanceof Error ? bedrockErr.message : String(bedrockErr));
    try {
      const result = await callGeminiChat(ctx, systemPrompt, messages, maxTokens);
      return { ...result, provider: "gemini" };
    } catch (geminiErr) {
      console.warn("Gemini failed:", geminiErr instanceof Error ? geminiErr.message : String(geminiErr));
      throw geminiErr;
    }
  }
}

export const sendMessage = action({
  args: {
    conversationId: v.id("conversations"),
    content: v.string(),
    mode: v.union(v.literal("chat"), v.literal("research"), v.literal("code")),
    token: v.optional(v.string()),
    model: v.optional(v.string()),
    skipUserSave: v.optional(v.boolean()),
    userContext: v.optional(v.object({
      datetime: v.string(),
      timezone: v.string(),
      location: v.optional(v.string()),
    })),
  },
  handler: async (ctx, args): Promise<string> => {
    const userId: Id<"users"> | null = await ctx.runQuery(
      internal.customAuthHelpers.getUserIdByToken,
      { token: args.token || "" }
    );
    if (!userId) throw new Error("Not authenticated");

    // Ownership gate: the conversation must belong to the caller before we read
    // its history or append to it (prevents cross-tenant read/inject via IDOR).
    const owns = await ctx.runQuery(internal.aiHelpers.isConversationOwner, {
      conversationId: args.conversationId,
      userId,
    });
    if (!owns) throw new Error("Conversation not found");

    if (!args.skipUserSave) {
      await ctx.runMutation(internal.aiHelpers.saveMessage, {
        conversationId: args.conversationId,
        userId,
        role: "user",
        content: args.content,
      });
    }

    const history: Array<{ role: string; content: string }> = await ctx.runQuery(
      internal.aiHelpers.getConversationMessages,
      { conversationId: args.conversationId }
    );

    const systemPrompts: Record<string, string> = {
      chat: `You are Thalamus AI, an advanced AI assistant by Aphantic Corporations.

CRITICAL: Respond in clean, semantic HTML only. No markdown. No plain text. Pure HTML. Do NOT wrap output in backticks or code fences.

Use these HTML elements with inline styles:
- <h1>, <h2>, <h3> for headings (style="font-size:1.2em;font-weight:bold;margin:0.5em 0;color:#e5e7eb")
- <p> for paragraphs (style="margin:0.5em 0;line-height:1.6;color:#d1d5db")
- <ul>, <ol>, <li> for lists (style="margin:0.3em 0 0.3em 1.2em")
- <strong> for bold (style="color:#f9fafb;font-weight:600")
- <em> for italic
- <code> for inline code (style="background:#1f2937;color:#34d399;padding:0.1em 0.4em;border-radius:4px;font-family:monospace;font-size:0.85em")
- <pre><code> for code blocks (style="background:#111827;color:#34d399;padding:1em;border-radius:8px;overflow-x:auto;display:block;margin:0.5em 0;font-family:monospace;font-size:0.8em")
- <blockquote> for quotes (style="border-left:3px solid #374151;padding-left:1em;color:#9ca3af;margin:0.5em 0")
- <hr> for dividers (style="border:none;border-top:1px solid #374151;margin:1em 0")
- <a> for links (style="color:#60a5fa;text-decoration:underline")
- <table>, <tr>, <th>, <td> for tables
- <div> for sections with style="margin:0.5em 0"

## WEB SEARCH TOOL
You have access to a web search tool. When the user asks about current events, recent news, real-time data, or ANYTHING you are not 100% certain about from your training data, you MUST use the search tool.

To search, include this EXACT syntax anywhere in your response:
<<SEARCH-TOOL="your search query here">>

Examples of when you MUST search:
- Current events, news, or anything time-sensitive
- Game updates, seasons, patches, changelogs
- Recent releases, launches, or announcements
- Sports scores, standings, results
- Stock prices, crypto, market data
- Weather, live status of services
- Any question where the answer may have changed since your training

You can use up to 3 searches per response. After you emit search tags, the system will execute the searches and ask you to provide a final answer with the results. Do NOT say "I cannot search" — you CAN search. Always search when uncertain.

Be thorough, helpful, and well-structured. Use rich HTML formatting.`,

      research: `You are Thalamus AI Research Mode — a deep research assistant by Aphantic Corporations.

CRITICAL: Respond in clean, semantic HTML only. No markdown. No plain text. Pure HTML. Do NOT wrap output in backticks or code fences.

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

## WEB SEARCH TOOL
You have access to a web search tool. For research queries you MUST use the search tool to gather real data.

To search, include this EXACT syntax anywhere in your response:
<<SEARCH-TOOL="your search query here">>

Use up to 3 searches per response to gather comprehensive information. After you emit search tags, the system will execute the searches and ask you to produce your final research report with the results. Do NOT say "I cannot search" — you CAN search. Always search.

Be comprehensive, cite reasoning, and provide structured analysis.`,

      code: `You are Thalamus AI Code Mode — an expert software engineer by Aphantic Corporations.

CRITICAL: Respond in clean, semantic HTML only. No markdown. No plain text. Pure HTML. Do NOT wrap output in backticks or code fences.

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

    const contextHeader = args.userContext
      ? `\n\n## CURRENT USER CONTEXT:\n- Date/Time: ${args.userContext.datetime}\n- Timezone: ${args.userContext.timezone}${args.userContext.location ? `\n- Location: ${args.userContext.location}` : ""}\n\nAlways use this context when answering time-sensitive or location-specific questions.\n`
      : "";

    const modelName = args.model ?? "claude-haiku-4-5";
    let { text: responseContent, inputTokens, outputTokens } = await callAI(
      ctx,
      systemPrompts[args.mode] + contextHeader,
      messages,
      4096,
      modelName,
    );

    // --- Search tool loop: detect <<SEARCH-TOOL="...">> tags and execute searches ---
    const searchPattern = /<<SEARCH-TOOL="([^"]+)">>/g;
    const searchMatches = [...responseContent.matchAll(searchPattern)];

    if (searchMatches.length > 0) {
      // Execute searches (max 3)
      const geminiKeys = await getGeminiKeysFromDB(ctx);
      const searchResults: Array<{ query: string; result: string }> = [];
      for (const match of searchMatches.slice(0, 3)) {
        const query = match[1];
        try {
          const result = await performSearch(query, geminiKeys.length > 0 ? geminiKeys : undefined);
          searchResults.push({ query, result: result.slice(0, 3000) });
        } catch {
          searchResults.push({ query, result: "[Search failed — no results available]" });
        }
      }

      // Build search context and re-call AI for final answer
      const searchContext = searchResults
        .map((r, i) => `[SEARCH RESULT ${i + 1} for "${r.query}"]:\n${r.result}`)
        .join("\n\n---\n\n");

      const followUpMessages: Array<{ role: "user" | "assistant"; content: string }> = [
        ...messages,
        { role: "assistant", content: responseContent },
        { role: "user", content: `Here are the search results you requested:\n\n${searchContext}\n\nNow provide your final, complete answer to the user using these search results. Respond in HTML only. Do NOT emit any more <<SEARCH-TOOL>> tags.` },
      ];

      const followUp = await callAI(
        ctx,
        systemPrompts[args.mode] + contextHeader,
        followUpMessages,
        4096,
        modelName,
      );

      responseContent = followUp.text;
      inputTokens += followUp.inputTokens;
      outputTokens += followUp.outputTokens;
    }
    // --- End search tool loop ---

    const tokensUsed = inputTokens + outputTokens;
    const inputCostCents = (inputTokens / 1_000_000) * 60;
    const outputCostCents = (outputTokens / 1_000_000) * 240;
    const costCents: number = inputCostCents + outputCostCents;

    await ctx.runMutation(internal.aiHelpers.saveAssistantMessage, {
      conversationId: args.conversationId,
      userId,
      content: responseContent,
      tokensUsed,
      costCents,
      inputTokens,
      outputTokens,
      inputCostPerMillion: 0.60,
      outputCostPerMillion: 2.40,
    });

    return responseContent;
  },
});

export const generateConversationTitle = action({
  args: { firstMessage: v.string(), conversationId: v.id("conversations"), token: v.string() },
  handler: async (ctx, args): Promise<string> => {
    const userId = (await ctx.runQuery(internal.customAuthHelpers.getUserIdByToken, { token: args.token })) as Id<"users"> | null;
    if (!userId) throw new Error("Not authenticated");

    // Only the owner may retitle a conversation.
    const owns = await ctx.runQuery(internal.aiHelpers.isConversationOwner, {
      conversationId: args.conversationId,
      userId,
    });
    if (!owns) throw new Error("Conversation not found");

    const prompt = `Generate a very short, concise title (3-6 words max) for a conversation that starts with this message. Output ONLY the title, no quotes, no punctuation at the end:\n\n"${args.firstMessage.slice(0, 200)}"`;
    
    let title = args.firstMessage.slice(0, 40);
    try {
      const keys = await getGeminiKeysFromDB(ctx);
      if (keys.length > 0) {
        const key = keys[Math.floor(Math.random() * keys.length)];
        const response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent?key=${key}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              contents: [{ role: "user", parts: [{ text: prompt }] }],
              generationConfig: { temperature: 0.3, maxOutputTokens: 20 },
            }),
          }
        );
        if (response.ok) {
          const data = await response.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
          const generated = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
          if (generated && generated.length > 0 && generated.length < 80) {
            title = generated;
          }
        }
      }
    } catch { /* fallback to truncated message */ }

    await ctx.runMutation(internal.aiHelpers.updateConversationTitle, {
      conversationId: args.conversationId,
      title,
    });

    return title;
  },
});

export const testVlyHaiku = action({
  args: { model: v.optional(v.string()) },
  handler: async (_ctx, args): Promise<{ success: boolean; response?: string; error?: string; raw?: unknown }> => {
    const { vly } = await import("../lib/vly-integrations");
    const modelName = args.model ?? "claude-haiku-4-5";
    try {
      const result = await vly.ai.completion({
        model: modelName,
        messages: [{ role: "user", content: "Say hello in one sentence." }],
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

export const vlyFallbackCompletion = internalAction({
  args: {
    systemPrompt: v.string(),
    messages: v.array(v.object({ role: v.union(v.literal("user"), v.literal("assistant")), content: v.string() })),
  },
  handler: async (_ctx, args) => {
    const { vly } = await import("../lib/vly-integrations");
    const result = await vly.ai.completion({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: args.systemPrompt },
        ...args.messages,
      ],
      maxTokens: 2048,
    });
    if (result.success && result.data) {
      return result.data.choices[0]?.message?.content ?? "";
    }
    return "";
  },
});

// Guest free-prompt daily cap — mirrors GUEST_LIMIT in src/pages/Portal.tsx and
// GUEST_DAILY_LIMIT in aiHelpers.ts. Kept as a local literal because this file
// runs in the Node runtime ("use node") and can't share the DB helpers' module.
const GUEST_DAILY_LIMIT = 3;

export const guestSendMessage = action({
  args: {
    content: v.string(),
    mode: v.union(v.literal("chat"), v.literal("study")),
    history: v.array(v.object({ role: v.union(v.literal("user"), v.literal("assistant")), content: v.string() })),
    userContext: v.optional(v.object({
      datetime: v.string(),
      timezone: v.string(),
    })),
    guestId: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<string> => {
    // Server-side enforcement of the guest daily prompt cap. Keyed by a
    // persistent client guestId + the current UTC day, so closing the tab (the
    // old sessionStorage bug) no longer grants a fresh set of free prompts.
    if (args.guestId && !FREE_UNLIMITED) {
      const used: number = await ctx.runQuery(internal.aiHelpers.getGuestUsageCount, { guestId: args.guestId });
      if (used >= GUEST_DAILY_LIMIT) throw new Error("GUEST_LIMIT_REACHED");
    }

    const systemPrompts: Record<string, string> = {
      chat: `You are Thalamus AI, an advanced AI assistant by Aphantic Corporations. Be helpful, accurate, and concise.

CRITICAL: Respond in clean semantic HTML only. No markdown. Pure HTML. Do NOT wrap output in backticks or code fences.
Use: <h2>, <h3>, <p>, <ul>, <ol>, <li>, <strong>, <em>, <code>, <pre><code>, <blockquote>
Headings: style="font-size:1.2em;font-weight:bold;margin:0.5em 0;color:#e5e7eb"
Paragraphs: style="margin:0.5em 0;line-height:1.6;color:#d1d5db"
Lists: style="margin:0.3em 0 0.3em 1.2em;color:#d1d5db"
Code blocks: style="background:#111827;color:#34d399;padding:1em;border-radius:8px;overflow-x:auto;display:block;margin:0.5em 0;font-family:monospace;font-size:0.8em"
Inline code: style="background:#1f2937;color:#34d399;padding:0.1em 0.4em;border-radius:4px;font-family:monospace;font-size:0.85em"`,
      study: `You are Thalamus AI Study Mode — a precision study assistant. Give dense, accurate, exam-ready information.

CRITICAL: Respond in clean semantic HTML only. No markdown. Pure HTML. Do NOT wrap output in backticks or code fences.
Use: <h2>, <h3>, <p>, <ul>, <ol>, <li>, <strong>, <blockquote>
Headings: style="font-size:1.1em;font-weight:bold;margin:0.5em 0 0.3em;color:#e5e7eb;border-left:3px solid #6366f1;padding-left:0.6em"
Sub-headings: style="font-size:0.95em;font-weight:bold;margin:0.5em 0 0.2em;color:#c4b5fd"
Lists: style="margin:0.2em 0 0.2em 1em;color:#d1d5db;font-size:0.9em"
Key facts: style="border-left:3px solid #f59e0b;padding:0.4em 0.8em;color:#fcd34d;margin:0.5em 0;background:#1c1a0e;border-radius:0 6px 6px 0;font-size:0.85em"`,
    };

    const contextHeader = args.userContext
      ? `\n\nCurrent date/time: ${args.userContext.datetime} (${args.userContext.timezone})\n`
      : "";

    const messages = [
      ...args.history,
      { role: "user" as const, content: args.content },
    ];

    const { text } = await callAI(
      ctx,
      systemPrompts[args.mode] + contextHeader,
      messages,
      2048
    );

    // Count this prompt against the daily cap only after a successful generation.
    if (args.guestId) {
      await ctx.runMutation(internal.aiHelpers.incrementGuestUsage, { guestId: args.guestId });
    }

    return text;
  },
});

export const testBedrockDirect = action({
  args: { adminToken: v.string(), model: v.optional(v.string()) },
  handler: async (ctx, args): Promise<{ success: boolean; response?: string; error?: string; region?: string; model?: string }> => {
    const modelName = args.model ?? "claude-haiku-4-5";
    const modelId = BEDROCK_MODEL_IDS[modelName] ?? BEDROCK_MODEL_IDS["claude-haiku-4-5"];
    try {
      const result = await callBedrockClaude(
        ctx,
        "You are a helpful assistant.",
        [{ role: "user", content: `Say hello in one sentence and confirm you are ${modelName} running on AWS Bedrock.` }],
        200,
        modelName,
      );
      return { success: true, response: result.text, region: "us-east-1", model: modelId };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err), region: "us-east-1", model: modelId };
    }
  },
});
