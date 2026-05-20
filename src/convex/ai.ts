"use node";
import { action, internalAction } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { Id } from "./_generated/dataModel";

// Gemini keys are loaded from the DB (admin-managed via Admin UI → Gemini Keys tab)
// No hardcoded keys in source — keys are stored securely in Convex DB
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

async function callGeminiChat(
  ctx: { runQuery: Function },
  systemPrompt: string,
  messages: Array<{ role: "user" | "assistant"; content: string }>,
  maxTokens = 4096
): Promise<{ text: string; inputTokens: number; outputTokens: number }> {
  const keys = await getGeminiKeysFromDB(ctx);
  if (keys.length === 0) throw new Error("No Gemini API keys configured. Add keys via Admin → Gemini Keys.");
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
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-lite:generateContent?key=${key}`,
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

MEDIA & FILE OUTPUT: You can output rich media directly in your responses:
- <img src="URL" alt="description" style="max-width:100%;border-radius:8px;margin:0.5em 0"> for images (use real URLs from the web)
- <audio controls style="width:100%;margin:0.5em 0"><source src="URL" type="audio/mpeg"></audio> for audio (use real URLs)
- <video controls style="width:100%;border-radius:8px;margin:0.5em 0"><source src="URL" type="video/mp4"></video> for video (use real URLs)
- <a href="data:text/plain;charset=utf-8,CONTENT" download="filename.txt" class="file-download">📄 Download filename.txt</a> for downloadable text files (encode content as URI)
- <a href="data:application/json;charset=utf-8,CONTENT" download="data.json" class="file-download">📊 Download data.json</a> for JSON files
- <a href="data:text/csv;charset=utf-8,CONTENT" download="data.csv" class="file-download">📊 Download data.csv</a> for CSV files

When asked to generate audio, video, or files: use real URLs from the web for media, or data URIs for text-based files. Always provide a download link for generated content.

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

    const contextHeader = args.userContext
      ? `\n\n## CURRENT USER CONTEXT:\n- Date/Time: ${args.userContext.datetime}\n- Timezone: ${args.userContext.timezone}${args.userContext.location ? `\n- Location: ${args.userContext.location}` : ""}\n\nAlways use this context when answering time-sensitive or location-specific questions.\n`
      : "";

    const { text: responseContent, inputTokens, outputTokens } = await callGeminiChat(
      ctx,
      systemPrompts[args.mode] + contextHeader,
      messages,
      4096
    );

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

    const prompt = `Generate a very short, concise title (3-6 words max) for a conversation that starts with this message. Output ONLY the title, no quotes, no punctuation at the end:\n\n"${args.firstMessage.slice(0, 200)}"`;
    
    let title = args.firstMessage.slice(0, 40);
    try {
      const keys = await getGeminiKeysFromDB(ctx);
      if (keys.length > 0) {
        const key = keys[Math.floor(Math.random() * keys.length)];
        const response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-lite:generateContent?key=${key}`,
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

// ── VLY Fallback Completion (internal action) ─────────────────────────────────
export const vlyFallbackCompletion = internalAction({
  args: {
    systemPrompt: v.string(),
    messages: v.array(v.object({ role: v.union(v.literal("user"), v.literal("assistant")), content: v.string() })),
  },
  handler: async (_ctx, args) => {
    const { vly } = await import('../lib/vly-integrations');
    const result = await vly.ai.completion({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: args.systemPrompt },
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

// ── Guest send message (no auth required, no DB storage) ─────────────────────
export const guestSendMessage = action({
  args: {
    content: v.string(),
    mode: v.union(v.literal("chat"), v.literal("study")),
    history: v.array(v.object({ role: v.union(v.literal("user"), v.literal("assistant")), content: v.string() })),
    userContext: v.optional(v.object({
      datetime: v.string(),
      timezone: v.string(),
    })),
  },
  handler: async (ctx, args): Promise<string> => {
    const systemPrompts: Record<string, string> = {
      chat: `You are Thalamus AI, an advanced AI assistant. Be helpful, accurate, and concise.

CRITICAL: Respond in clean semantic HTML only. No markdown. Pure HTML.
Use: <h2>, <h3>, <p>, <ul>, <ol>, <li>, <strong>, <em>, <code>, <pre><code>, <blockquote>
Headings: style="font-size:1.2em;font-weight:bold;margin:0.5em 0;color:#e5e7eb"
Paragraphs: style="margin:0.5em 0;line-height:1.6;color:#d1d5db"
Lists: style="margin:0.3em 0 0.3em 1.2em;color:#d1d5db"
Code blocks: style="background:#111827;color:#34d399;padding:1em;border-radius:8px;overflow-x:auto;display:block;margin:0.5em 0;font-family:monospace;font-size:0.8em"
Inline code: style="background:#1f2937;color:#34d399;padding:0.1em 0.4em;border-radius:4px;font-family:monospace;font-size:0.85em"`,
      study: `You are Thalamus AI Study Mode — a precision study assistant. Give dense, accurate, exam-ready information.

CRITICAL: Respond in clean semantic HTML only. No markdown. Pure HTML.
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

    const { text } = await callGeminiChat(
      ctx,
      systemPrompts[args.mode] + contextHeader,
      messages,
      2048
    );

    return text;
  },
});

export const testBedrockDirect = action({
  args: { adminToken: v.string() },
  handler: async (ctx, _args): Promise<{ success: boolean; response?: string; error?: string; region?: string; model?: string }> => {
    const creds = await ctx.runQuery(internal.admin.getAwsCredentialsInternal, {}) as { accessKeyId: string; secretAccessKey: string; region: string } | null;
    if (!creds) return { success: false, error: "No AWS credentials found in DB. Please set them in Admin → AWS Bedrock tab." };

    const { accessKeyId, secretAccessKey } = creds;
    const region = "us-east-1";
    const modelId = "us.anthropic.claude-haiku-4-5-20251001-v1:0";
    // Manually encode the path — do NOT use new URL() as it double-encodes %3A to %253A
    const encodedModelId = encodeURIComponent(modelId); // "us.anthropic.claude-haiku-4-5-20251001-v1%3A0"
    const canonicalPath = `/model/${encodedModelId}/invoke`;
    const host = `bedrock-runtime.${region}.amazonaws.com`;
    const url = `https://${host}${canonicalPath}`;

    const requestBody = JSON.stringify({
      anthropic_version: "bedrock-2023-05-31",
      system: "You are a helpful assistant.",
      messages: [{ role: "user", content: "Say hello in one sentence and confirm you are Claude Haiku 4.5 running on AWS Bedrock." }],
      max_tokens: 200,
      temperature: 0.7,
    });

    const crypto = globalThis.crypto;
    const enc = new TextEncoder();

    const sha256 = async (data: string | Uint8Array): Promise<string> => {
      const encoded = typeof data === "string" ? enc.encode(data) : data;
      const buf = encoded.buffer.slice(encoded.byteOffset, encoded.byteLength) as ArrayBuffer;
      const hash = await crypto.subtle.digest("SHA-256", buf);
      return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, "0")).join("");
    };

    const hmac = async (key: ArrayBuffer | Uint8Array, data: string): Promise<ArrayBuffer> => {
      const rawKey = key instanceof Uint8Array ? key.buffer as ArrayBuffer : key;
      const k = await crypto.subtle.importKey("raw", rawKey, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
      return crypto.subtle.sign("HMAC", k, enc.encode(data).buffer as ArrayBuffer);
    };

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
    const hashedPayload = await sha256(requestBody);
    const canonicalRequest = ["POST", canonicalPath, "", canonicalHeaders, signedHeaders, hashedPayload].join("\n");
    const algorithm = "AWS4-HMAC-SHA256";
    const credentialScope = `${dateStamp}/${region}/bedrock/aws4_request`;
    const stringToSign = [algorithm, amzDate, credentialScope, await sha256(canonicalRequest)].join("\n");
    const kSecret = enc.encode(`AWS4${secretAccessKey}`);
    const kDate = await hmac(kSecret, dateStamp);
    const kRegion = await hmac(kDate, region);
    const kService = await hmac(kRegion, "bedrock");
    const kSigning = await hmac(kService, "aws4_request");
    const sigBuf = await hmac(kSigning, stringToSign);
    const signature = Array.from(new Uint8Array(sigBuf)).map(b => b.toString(16).padStart(2, "0")).join("");
    const authorization = `${algorithm} Credential=${accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Amz-Date": amzDate,
          "Authorization": authorization,
        },
        body: requestBody,
      });

      const responseText = await response.text();
      if (!response.ok) {
        return { success: false, error: `Bedrock HTTP ${response.status}: ${responseText.slice(0, 500)}`, region, model: modelId };
      }

      const data = JSON.parse(responseText) as { content?: Array<{ type: string; text?: string }>; usage?: { input_tokens?: number; output_tokens?: number } };
      const text = data.content?.find(c => c.type === "text")?.text ?? "";
      return { success: true, response: text, region, model: modelId };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err), region, model: modelId };
    }
  },
});
