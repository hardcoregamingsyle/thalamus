"use node";
import { action, internalAction, type ActionCtx } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { Id } from "./_generated/dataModel";
import {
  callModel,
  performSearch,
  FREE_UNLIMITED,
  MODE_ADHD,
  adhdToTemperature,
  MODE_SYSTEM_PROMPTS,
} from "./lib/agentCore";
import { buildStudySystemPrompt } from "./lib/studyPrompt";
import {
  buildClaudeUserContent,
  buildGeminiUserParts,
  normalizeAiAttachments,
  type AiInputAttachment,
  type ClaudeContentPart,
} from "./lib/aiAttachments";
import { callOpenRouter } from "./lib/openrouterClient";

// Gemini keys are loaded from the DB (admin-managed via Admin UI)
async function getGeminiKeysFromDB(ctx: { runQuery: ActionCtx["runQuery"] }): Promise<string[]> {
  try {
    const keys = await ctx.runQuery(internal.admin.getGeminiKeysInternal, {}) as string[];
    if (keys && keys.length > 0) return keys;
  } catch { /* fall through */ }
  return [];
}

let keyIndex = 0;

async function withInlineAttachmentBytes(
  attachments: AiInputAttachment[],
): Promise<AiInputAttachment[]> {
  return await Promise.all(
    attachments.map(async (attachment) => {
      if (attachment.dataBase64 || !attachment.url) return attachment;
      const response = await fetch(attachment.url);
      if (!response.ok) throw new Error(`Could not read ${attachment.name}`);
      return {
        ...attachment,
        dataBase64: Buffer.from(await response.arrayBuffer()).toString("base64"),
      };
    }),
  );
}

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
  temperature = 0.7,
  attachments?: AiInputAttachment[],
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
  const nativeAttachments = normalizeAiAttachments(attachments);
  const bedrockMessages: Array<{
    role: "user" | "assistant";
    content: string | ClaudeContentPart[];
  }> = messages.map((message, index) => ({
    role: message.role,
    content:
      nativeAttachments.length > 0 && index === messages.length - 1
        ? buildClaudeUserContent(message.content, nativeAttachments)
        : message.content,
  }));

  const requestBody = JSON.stringify({
    anthropic_version: "bedrock-2023-05-31",
    system: systemPrompt,
    messages: bedrockMessages,
    max_tokens: effectiveMaxTokens,
    temperature,
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
  maxTokens = 4096,
  temperature = 0.7,
  attachments?: AiInputAttachment[],
): Promise<{ text: string; inputTokens: number; outputTokens: number }> {
  const keys = await getGeminiKeysFromDB(ctx);
  if (keys.length === 0) throw new Error("No Gemini API keys configured. Add keys via Admin.");
  const maxRetries = keys.length;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const key = keys[keyIndex % keys.length];
    keyIndex++;
    try {
      const nativeAttachments = normalizeAiAttachments(attachments);
      const contents = messages.map((message, index) => ({
        role: message.role === "assistant" ? "model" : "user",
        parts:
          nativeAttachments.length > 0 && index === messages.length - 1
            ? buildGeminiUserParts(message.content, nativeAttachments)
            : [{ text: message.content }],
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
            generationConfig: { maxOutputTokens: maxTokens, temperature },
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

// Primary AI call. URL-backed files go to OpenRouter first in their original
// stored form; provider-specific inline adapters are created server-side only
// if that direct file route fails.
async function callAI(
  ctx: ActionCtx,
  systemPrompt: string,
  messages: Array<{ role: "user" | "assistant"; content: string }>,
  maxTokens = 4096,
  modelName = "claude-haiku-4-5",
  temperature = 0.7,
  attachments?: AiInputAttachment[],
  skipPrimaryProviders = false,
): Promise<{
  text: string;
  inputTokens: number;
  outputTokens: number;
  provider: string;
}> {
  const nativeAttachments = normalizeAiAttachments(attachments);
  const prompt = messages
    .map(
      (message) =>
        `${message.role === "assistant" ? "Assistant" : "Human"}: ${message.content}`,
    )
    .join("\n\n");

  if (skipPrimaryProviders) {
    if (nativeAttachments.length > 0) {
      throw new Error(
        "The preceding stream exhausted all attachment providers",
      );
    }
    const routed = await callModel(prompt, systemPrompt, "KnowItAll", ctx, {
      deadlineMs: 150_000,
    });
    if (!routed.text.trim()) {
      throw new Error("Unified provider router returned no answer");
    }
    return { ...routed, provider: routed.tier };
  }

  const attemptedOriginalFileRoute = nativeAttachments.some(
    (attachment) => attachment.url,
  );

  if (attemptedOriginalFileRoute) {
    try {
      const routed = await callOpenRouter(
        prompt,
        systemPrompt,
        "openrouter/free",
        maxTokens,
        undefined,
        Date.now() + 150_000,
        undefined,
        nativeAttachments,
      );
      if (!routed.text.trim()) {
        throw new Error("Attachment-capable provider returned no answer");
      }
      return { ...routed, provider: `openrouter:${routed.model}` };
    } catch (openRouterErr) {
      console.warn(
        "Original-file provider route failed, preparing server-side adapters:",
        openRouterErr instanceof Error
          ? openRouterErr.message
          : String(openRouterErr),
      );
    }
  }

  let providerAttachments = nativeAttachments;
  if (providerAttachments.some((attachment) => !attachment.dataBase64)) {
    providerAttachments = await withInlineAttachmentBytes(providerAttachments);
  }

  try {
    const result = await callBedrockClaude(
      ctx,
      systemPrompt,
      messages,
      maxTokens,
      modelName,
      temperature,
      providerAttachments,
    );
    return { ...result, provider: "bedrock" };
  } catch (bedrockErr) {
    console.warn(
      "Bedrock failed, falling back to Gemini:",
      bedrockErr instanceof Error ? bedrockErr.message : String(bedrockErr),
    );
    try {
      const result = await callGeminiChat(
        ctx,
        systemPrompt,
        messages,
        maxTokens,
        temperature,
        providerAttachments,
      );
      return { ...result, provider: "gemini" };
    } catch (geminiErr) {
      console.warn(
        "Gemini failed, falling back to the unified provider router:",
        geminiErr instanceof Error ? geminiErr.message : String(geminiErr),
      );

      if (nativeAttachments.length > 0) {
        if (attemptedOriginalFileRoute) {
          throw new Error("All attachment-capable providers failed");
        }
        const routed = await callOpenRouter(
          prompt,
          systemPrompt,
          "openrouter/free",
          maxTokens,
          undefined,
          Date.now() + 150_000,
          undefined,
          nativeAttachments,
        );
        if (!routed.text.trim()) {
          throw new Error("Attachment-capable provider returned no answer");
        }
        return { ...routed, provider: `openrouter:${routed.model}` };
      }

      const routed = await callModel(prompt, systemPrompt, "KnowItAll", ctx, {
        deadlineMs: 150_000,
      });
      if (!routed.text.trim()) {
        throw new Error("Unified provider router returned no answer");
      }
      return { ...routed, provider: routed.tier };
    }
  }
}

export const sendMessage = action({
  args: {
    conversationId: v.id("conversations"),
    content: v.string(),
    mode: v.union(v.literal("chat"), v.literal("research"), v.literal("code"), v.literal("study"), v.literal("designing"), v.literal("strategising"), v.literal("creative-writing"), v.literal("marketing"), v.literal("idea-generation"), v.literal("naming")),
    token: v.optional(v.string()),
    model: v.optional(v.string()),
    skipUserSave: v.optional(v.boolean()),
    skipPrimaryProviders: v.optional(v.boolean()),
    attachmentIds: v.optional(v.array(v.id("aiAttachments"))),
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

    const attachments = args.attachmentIds?.length
      ? await ctx.runQuery(internal.aiFiles.resolveForUser, {
          attachmentIds: args.attachmentIds,
          userId,
        })
      : [];

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

    // study mode has its own dedicated builder (grade/board/RAG-aware),
    // reused as-is from the http.ts /stream-chat path — not part of the
    // shared MODE_SYSTEM_PROMPTS table by design.
    const systemPrompt = args.mode === "study"
      ? buildStudySystemPrompt()
      : (MODE_SYSTEM_PROMPTS[args.mode] ?? MODE_SYSTEM_PROMPTS.chat);

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
    const adhd = MODE_ADHD[args.mode] ?? MODE_ADHD.chat;
    const temperature = adhdToTemperature(adhd);
    let { text: responseContent, inputTokens, outputTokens } = await callAI(
      ctx,
      systemPrompt + contextHeader,
      messages,
      4096,
      modelName,
      temperature,
      attachments,
      args.skipPrimaryProviders,
    );

    // --- Search tool loop: detect {"op":"search","query":"..."} JSON ops (and
    // legacy <<SEARCH-TOOL="...">> tags with Unicode bracket variants) and
    // execute searches ---
    const searchPattern = /(?:<<|‹‹|«|‹)SEARCH-TOOL="([^"]+)"(?:>>|››|»|›)/g;
    const jsonSearchPattern = /"op":"search","query":"([^"]*(?:\\.[^"]*)*)"/g;
    const searchMatches = [
      ...responseContent.matchAll(searchPattern),
      ...responseContent.matchAll(jsonSearchPattern),
    ];

    if (searchMatches.length > 0) {
      // Execute searches (max 15)
      const geminiKeys = await getGeminiKeysFromDB(ctx);
      const searchResults: Array<{ query: string; result: string }> = [];
      for (const match of searchMatches.slice(0, 15)) {
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
        { role: "user", content: `Here are the search results you requested:\n\n${searchContext}\n\nNow provide your final, complete answer to the user using these search results. Respond in HTML only. Do NOT emit any more search ops.` },
      ];

      const followUp = await callAI(
        ctx,
        systemPrompt + contextHeader,
        followUpMessages,
        4096,
        modelName,
        temperature,
        undefined,
        args.skipPrimaryProviders,
      );

      responseContent = followUp.text;
      inputTokens += followUp.inputTokens;
      outputTokens += followUp.outputTokens;
    }
    // --- End search tool loop ---

    // --- FactCheck phase (research mode only): verify every claim against web sources ---
    if (args.mode === "research") {
      const factCheckSystemPrompt = `You are a Fact Checker. Your ONLY job is to rigorously verify every factual claim in the research report below against real web sources.

RULES:
- For EACH factual claim, determine: CORRECT / INCORRECT / UNCERTAIN
- For INCORRECT claims: provide the corrected information with source
- For UNCERTAIN claims: search to verify
- Do NOT change the HTML formatting — keep the same structure
- Output the CORRECTED report with any errors fixed
- If everything is correct, output the original report unchanged

SEARCH TOOL: Use {"op":"search","query":"your query"} to search for claims you need to verify. Use up to 5 searches.`;

      let factCheckMessages: Array<{ role: "user" | "assistant"; content: string }> = [
        ...messages,
        { role: "assistant", content: responseContent },
        { role: "user", content: "Fact-check the above research report. Verify EVERY factual claim against web sources. If you need to search, use {\"op\":\"search\",\"query\":\"...\"} ops. Then provide the corrected report in HTML." },
      ];

      const factCheckResult = await callAI(
        ctx,
        factCheckSystemPrompt,
        factCheckMessages,
        4096,
        modelName,
        0.7,
        undefined,
        args.skipPrimaryProviders,
      );
      let factCheckText = factCheckResult.text;
      inputTokens += factCheckResult.inputTokens;
      outputTokens += factCheckResult.outputTokens;

      // Check if fact-checker requested searches
      const fcSearchPattern = /(?:<<|‹‹|«|‹)SEARCH-TOOL="([^"]+)"(?:>>|››|»|›)/g;
      const fcJsonSearchPattern = /"op":"search","query":"([^"]*(?:\\.[^"]*)*)"/g;
      const fcSearchMatches = [
        ...factCheckText.matchAll(fcSearchPattern),
        ...factCheckText.matchAll(fcJsonSearchPattern),
      ];
      if (fcSearchMatches.length > 0) {
        const fcSearchResults: Array<{ query: string; result: string }> = [];
        for (const match of fcSearchMatches.slice(0, 5)) {
          const query = match[1];
          try {
            const fcResult = await performSearch(query, undefined);
            fcSearchResults.push({ query, result: fcResult.slice(0, 3000) });
          } catch {
            fcSearchResults.push({ query, result: "[Search failed]" });
          }
        }

        const fcSearchContext = fcSearchResults
          .map((r, i) => `[SEARCH RESULT ${i + 1} for "${r.query}"]:\n${r.result}`)
          .join("\n\n---\n\n");

        factCheckMessages = [
          ...factCheckMessages,
          { role: "assistant", content: factCheckText },
          { role: "user", content: `Here are the search results you requested:\n\n${fcSearchContext}\n\nNow provide your FINAL verified report with ALL corrections applied. Output the complete corrected HTML report.` },
        ];

        const fcFinal = await callAI(
          ctx,
          factCheckSystemPrompt,
          factCheckMessages,
          4096,
          modelName,
          0.7,
          undefined,
          args.skipPrimaryProviders,
        );
        factCheckText = fcFinal.text;
        inputTokens += fcFinal.inputTokens;
        outputTokens += fcFinal.outputTokens;
      }

      responseContent = factCheckText;
    }
    // --- End FactCheck phase ---

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

export const vlyFallbackCompletion = internalAction({
  args: {
    systemPrompt: v.string(),
    messages: v.array(v.object({ role: v.union(v.literal("user"), v.literal("assistant")), content: v.string() })),
  },
  handler: async (_ctx, args) => {
    const { vly } = await import("./lib/vlyIntegrations");
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
    mode: v.union(v.literal("chat"), v.literal("research"), v.literal("code"), v.literal("study"), v.literal("designing"), v.literal("strategising"), v.literal("creative-writing"), v.literal("marketing"), v.literal("idea-generation"), v.literal("naming")),
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

    const systemPrompt = args.mode === "study"
      ? buildStudySystemPrompt()
      : (MODE_SYSTEM_PROMPTS[args.mode] ?? MODE_SYSTEM_PROMPTS.chat);

    const contextHeader = args.userContext
      ? `\n\nCurrent date/time: ${args.userContext.datetime} (${args.userContext.timezone})\n`
      : "";

    const messages = [
      ...args.history,
      { role: "user" as const, content: args.content },
    ];

    const adhd = MODE_ADHD[args.mode] ?? MODE_ADHD.chat;
    const temperature = adhdToTemperature(adhd);
    const { text } = await callAI(
      ctx,
      systemPrompt + contextHeader,
      messages,
      2048,
      "claude-haiku-4-5",
      temperature,
    );

    // Count this prompt against the daily cap only after a successful generation.
    if (args.guestId) {
      await ctx.runMutation(internal.aiHelpers.incrementGuestUsage, { guestId: args.guestId });
    }

    return text;
  },
});

