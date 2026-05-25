import { httpRouter } from "convex/server";
import { auth } from "./auth";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { Id } from "./_generated/dataModel";

const http = httpRouter();

auth.addHttpRoutes(http);

// ── Decode state helper ───────────────────────────────────────────────────────
function decodeStateHttp(state: string): string | null {
  try {
    const dotIdx = state.indexOf(".");
    if (dotIdx === -1) return null;
    const userIdHex = state.slice(0, dotIdx);
    if (userIdHex.length === 0 || userIdHex.length % 2 !== 0) return null;
    const bytes: number[] = [];
    for (let i = 0; i < userIdHex.length; i += 2) {
      const byte = parseInt(userIdHex.slice(i, i + 2), 16);
      if (isNaN(byte)) return null;
      bytes.push(byte);
    }
    return new TextDecoder().decode(new Uint8Array(bytes));
  } catch { return null; }
}

// ── CORS headers ──────────────────────────────────────────────────────────────
function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

// ── SigV4 signing for Bedrock streaming ──────────────────────────────────────
function toAB(data: Uint8Array): ArrayBuffer {
  const ab = new ArrayBuffer(data.byteLength);
  new Uint8Array(ab).set(data);
  return ab;
}

async function signBedrockRequestWithPath(
  method: string, host: string, canonicalPath: string, body: string,
  accessKeyId: string, secretAccessKey: string, region: string,
): Promise<Record<string, string>> {
  const crypto = globalThis.crypto;
  const enc = new TextEncoder();
  const sha256 = async (data: string | Uint8Array): Promise<string> => {
    const encoded = typeof data === "string" ? enc.encode(data) : data;
    const hash = await crypto.subtle.digest("SHA-256", toAB(encoded));
    return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, "0")).join("");
  };
  const hmac = async (key: ArrayBuffer | Uint8Array, data: string): Promise<ArrayBuffer> => {
    const keyBuf = key instanceof Uint8Array ? toAB(key) : key;
    const k = await crypto.subtle.importKey("raw", keyBuf, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    return crypto.subtle.sign("HMAC", k, toAB(enc.encode(data)));
  };
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.substring(0, 8);
  const headers: Record<string, string> = { "content-type": "application/json", "host": host, "x-amz-date": amzDate };
  const sortedKeys = Object.keys(headers).sort();
  const canonicalHeaders = sortedKeys.map(k => `${k}:${headers[k]}\n`).join("");
  const signedHeaders = sortedKeys.join(";");
  const hashedPayload = await sha256(body);
  const canonicalRequest = [method, canonicalPath, "", canonicalHeaders, signedHeaders, hashedPayload].join("\n");
  const credentialScope = `${dateStamp}/${region}/bedrock/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, credentialScope, await sha256(canonicalRequest)].join("\n");
  const kSecret = enc.encode(`AWS4${secretAccessKey}`);
  const kDate = await hmac(kSecret, dateStamp);
  const kRegion = await hmac(kDate, region);
  const kService = await hmac(kRegion, "bedrock");
  const kSigning = await hmac(kService, "aws4_request");
  const sigBuf = await hmac(kSigning, stringToSign);
  const signature = Array.from(new Uint8Array(sigBuf)).map(b => b.toString(16).padStart(2, "0")).join("");
  return {
    "Content-Type": "application/json",
    "X-Amz-Date": amzDate,
    "Authorization": `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
}

// ── Parse Bedrock credentials (env var fallback) ──────────────────────────────
function parseBedrockCredsFromEnv(): { accessKeyId: string; secretAccessKey: string; region: string } | null {
  const raw = process.env.AWS_BEDROCK_API_KEY;
  if (!raw) return null;
  const isBase64 = /^[A-Za-z0-9+/]+=*$/.test(raw) && raw.length > 40;
  let decoded = raw;
  if (isBase64) {
    try { decoded = Buffer.from(raw, "base64").toString("utf8").replace(/^\0+/, ""); } catch { decoded = raw; }
  }
  const isStandardAWS = /^(AKIA|ASIA|AROA|AIDA)[A-Z0-9]{16}/.test(decoded);
  if (isStandardAWS) {
    const parts = decoded.split(":");
    if (parts.length < 2) return null;
    return {
      accessKeyId: parts[0],
      secretAccessKey: parts.slice(1, parts.length > 2 ? parts.length - 1 : 2).join(":"),
      region: parts.length > 2 ? parts[parts.length - 1] : "us-east-1",
    };
  }
  const colonIdx = decoded.indexOf(":");
  if (colonIdx > 0) {
    return { accessKeyId: decoded.substring(0, colonIdx), secretAccessKey: decoded.substring(colonIdx + 1), region: "us-east-1" };
  }
  return null;
}

// ── Claude Bedrock streaming ──────────────────────────────────────────────────
// Uses invoke-with-response-stream for real token-by-token streaming
async function streamClaudeWithCreds(
  creds: { accessKeyId: string; secretAccessKey: string; region: string },
  systemPrompt: string,
  messages: Array<{ role: "user" | "assistant"; content: string }>,
  onChunk: (text: string) => void,
): Promise<{ fullText: string; inputTokens: number; outputTokens: number }> {
  // Use the region stored with the credentials — IAM credentials are region-specific
  // and the SigV4 signature must match the region where Bedrock access is enabled.
  const region = creds.region || "us-east-1";
  // Cross-region inference prefix (us.) only works in us-east-1/us-west-2
  // For ap-southeast-1 and other non-US regions, use the base model ID
  const modelId = region.startsWith("us-")
    ? "us.anthropic.claude-haiku-4-5-20251001-v1:0"
    : "anthropic.claude-haiku-4-5-20251001-v1:0";
  // Use raw URL for fetch (runtime encodes : to %3A automatically)
  // Use encoded path for SigV4 canonical string (must match what AWS sees)
  const rawUrl = `https://bedrock-runtime.${region}.amazonaws.com/model/${modelId}/invoke-with-response-stream`;
  const canonicalPath = `/model/${encodeURIComponent(modelId)}/invoke-with-response-stream`;
  const host = `bedrock-runtime.${region}.amazonaws.com`;

  const requestBody = JSON.stringify({
    anthropic_version: "bedrock-2023-05-31",
    system: systemPrompt.slice(0, 8000),
    messages: messages.map(m => ({ role: m.role, content: m.content.slice(0, 4000) })),
    max_tokens: 8192,
    temperature: 0.7,
  });

  const cleanSecret = creds.secretAccessKey.replace(/^["']|["']$/g, "");
  const reqHeaders = await signBedrockRequestWithPath("POST", host, canonicalPath, requestBody, creds.accessKeyId, cleanSecret, region);

  const response = await fetch(rawUrl, { method: "POST", headers: reqHeaders, body: requestBody });
  if (!response.ok || !response.body) {
    const err = await response.text().catch(() => "");
    throw new Error(`Bedrock streaming error ${response.status}: ${err.slice(0, 200)}`);
  }

  // Bedrock streaming uses a binary framing protocol (event stream)
  // Each event is: 4-byte total length, 4-byte headers length, 4-byte CRC, headers, payload, 4-byte CRC
  const reader = response.body.getReader();
  let fullText = "";
  let inputTokens = 0;
  let outputTokens = 0;
  let bufferArr: number[] = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    // Append new bytes to buffer array
    for (let i = 0; i < value.length; i++) bufferArr.push(value[i]);

    // Process complete events from buffer
    while (bufferArr.length >= 12) {
      const totalLength = (bufferArr[0] << 24) | (bufferArr[1] << 16) | (bufferArr[2] << 8) | bufferArr[3];
      if (bufferArr.length < totalLength || totalLength < 12) break;

      const headersLength = (bufferArr[4] << 24) | (bufferArr[5] << 16) | (bufferArr[6] << 8) | bufferArr[7];
      const payloadStart = 12 + headersLength;
      const payloadEnd = totalLength - 4;

      if (payloadEnd > payloadStart && payloadEnd <= bufferArr.length) {
        const payload = new Uint8Array(bufferArr.slice(payloadStart, payloadEnd));
        try {
          const text = new TextDecoder().decode(payload);
          const event = JSON.parse(text) as { bytes?: string; type?: string };
          if (event.bytes) {
            const innerBytes = Uint8Array.from(atob(event.bytes), c => c.charCodeAt(0));
            const innerText = new TextDecoder().decode(innerBytes);
            const inner = JSON.parse(innerText) as {
              type?: string;
              delta?: { type?: string; text?: string };
              usage?: { input_tokens?: number; output_tokens?: number };
              message?: { usage?: { input_tokens?: number; output_tokens?: number } };
            };
            if (inner.type === "content_block_delta" && inner.delta?.type === "text_delta" && inner.delta.text) {
              fullText += inner.delta.text;
              onChunk(inner.delta.text);
            }
            if (inner.type === "message_delta" && inner.usage) {
              outputTokens = inner.usage.output_tokens ?? 0;
            }
            if (inner.type === "message_start" && inner.message?.usage) {
              inputTokens = inner.message.usage.input_tokens ?? 0;
            }
          }
        } catch { /* skip malformed events */ }
      }

      bufferArr = bufferArr.slice(totalLength);
    }
  }

  return { fullText, inputTokens, outputTokens };
}

// ── /stream-chat — SSE streaming for chat/study/guest modes ──────────────────
http.route({
  path: "/stream-chat",
  method: "OPTIONS",
  handler: httpAction(async () => {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }),
});

http.route({
  path: "/stream-chat",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    let body: {
      content: string;
      mode: string;
      history: Array<{ role: "user" | "assistant"; content: string }>;
      systemPrompt: string;
      userContext?: { datetime: string; timezone: string };
      token?: string;
      conversationId?: string;
      preferClaude?: boolean;
      skipUserSave?: boolean;
    };

    try {
      body = await request.json() as typeof body;
    } catch {
      return new Response("Bad request", { status: 400, headers: corsHeaders() });
    }

    const { content, mode, history, systemPrompt, userContext, token, conversationId, preferClaude, skipUserSave } = body;

    const contextHeader = userContext
      ? `\n\nCurrent date/time: ${userContext.datetime} (${userContext.timezone})\n`
      : "";
    const fullSystem = systemPrompt + contextHeader;

    const messages: Array<{ role: "user" | "assistant"; content: string }> = [
      ...history.map(m => ({ role: m.role, content: m.content.slice(0, 2000) })),
      { role: "user" as const, content },
    ];

    const encoder = new TextEncoder();
    let fullText = "";
    let usedClaude = false;

    // Load AWS credentials: DB first, then env var fallback
    const dbCreds = await ctx.runQuery(internal.admin.getAwsCredentialsInternal, {});
    const bedrockCreds = dbCreds ?? parseBedrockCredsFromEnv();
    const hasBedrock = !!bedrockCreds;

    // ── Run all AI calls BEFORE creating the stream, so ctx is still valid ──
    let streamSuccess = false;
    let geminiStreamBody = "";

    // Try Claude (non-streaming invoke first to get full text, then stream it)
    if (hasBedrock && bedrockCreds && preferClaude !== false) {
      try {
        const result = await streamClaudeWithCreds(bedrockCreds, fullSystem, messages, () => {});
        fullText = result.fullText;
        usedClaude = true;
        streamSuccess = true;
      } catch (bedrockErr) {
        console.error("Bedrock failed:", bedrockErr instanceof Error ? bedrockErr.message : String(bedrockErr));
        fullText = "";
      }
    }

    // Fallback: Gemini
    if (!streamSuccess) {
      const geminiContents = messages.map(m => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.content }],
      }));
      geminiStreamBody = JSON.stringify({
        system_instruction: { parts: [{ text: fullSystem }] },
        contents: geminiContents,
        generationConfig: { maxOutputTokens: 4096, temperature: 0.7 },
      });

      const geminiKeys = await ctx.runQuery(internal.admin.getGeminiKeysInternal, {}) as string[];
      for (let attempt = 0; attempt < geminiKeys.length && !streamSuccess; attempt++) {
        try {
          const key = geminiKeys[attempt % geminiKeys.length];
          const streamUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-lite:generateContent?key=${key}`;
          const geminiRes = await fetch(streamUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: geminiStreamBody,
          });
          if (geminiRes.status === 429 || geminiRes.status === 403) continue;
          if (geminiRes.ok) {
            const data = await geminiRes.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
            const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
            if (text) { fullText = text; streamSuccess = true; }
          }
        } catch { /* skip */ }
      }
    }

    // Final fallback: VLY
    if (!streamSuccess) {
      try {
        const vlyText = await ctx.runAction(internal.ai.vlyFallbackCompletion, {
          systemPrompt: fullSystem,
          messages,
        });
        if (vlyText) { fullText = vlyText; streamSuccess = true; }
      } catch (vlyErr) {
        console.error("VLY fallback failed:", vlyErr instanceof Error ? vlyErr.message : String(vlyErr));
      }
    }

    if (!streamSuccess || !fullText) {
      fullText = "Sorry, I couldn't generate a response. Please try again.";
    }

    // ── Save to DB NOW while ctx is still valid ──────────────────────────────
    if (token && conversationId && fullText && fullText !== "Sorry, I couldn't generate a response. Please try again.") {
      try {
        const inputCostPerMillion = usedClaude ? 1.80 : 0.60;
        const outputCostPerMillion = usedClaude ? 7.20 : 2.40;
        await ctx.runMutation(internal.aiHelpers.saveStreamedMessage, {
          conversationId: conversationId as Id<"conversations">,
          token,
          content,
          response: fullText,
          inputCostPerMillion,
          outputCostPerMillion,
          mode,
          skipUserSave,
        });
      } catch (saveErr) {
        console.error("Failed to save streamed message:", saveErr);
      }
    }

    // ── Stream thinking notes first, then answer content for UX ──────────────
    const thinkingNotes = [
      `Mode: ${mode || "chat"}`,
      "Reading conversation context",
      token && conversationId ? "Preparing saved response" : "Preparing guest response",
      "Answer stream ready",
    ];
    const words = fullText.split(/(?<=\s)|(?=\s)/);
    const transformedStream = new ReadableStream({
      async start(controller) {
        for (const note of thinkingNotes) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "thinking", chunk: `${note}\n` })}\n\n`));
          await new Promise(r => setTimeout(r, 120));
        }
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "answer_start" })}\n\n`));
        // Stream in chunks for smooth UX
        const chunkSize = 3;
        for (let i = 0; i < words.length; i += chunkSize) {
          const chunk = words.slice(i, i + chunkSize).join("");
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "answer", chunk })}\n\n`));
          // Small delay for streaming effect
          await new Promise(r => setTimeout(r, 8));
        }
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "done", done: true, fullText })}\n\n`));
        controller.close();
      },
    });

    return new Response(transformedStream, {
      status: 200,
      headers: {
        ...corsHeaders(),
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "X-Accel-Buffering": "no",
      },
    });
  }),
});

// ── GitHub OAuth callback ─────────────────────────────────────────────────────
http.route({
  path: "/github/callback",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const url = new URL(request.url);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const error = url.searchParams.get("error");

    // The frontend origin is the app URL — stored in state as a suffix after the userId
    // Fall back to the known production domain
    const origin = process.env.FRONTEND_URL ?? "https://thalamus.aphantic.skinticals.com";

    if (error || !code || !state) {
      return new Response(null, {
        status: 302,
        headers: { Location: `${origin}/portal/code?github_error=${encodeURIComponent(error ?? "cancelled")}` },
      });
    }

    try {
      const clientId = process.env.GITHUB_CLIENT_ID;
      const clientSecret = process.env.GITHUB_CLIENT_SECRET;
      if (!clientId || !clientSecret) throw new Error("GitHub OAuth not configured");

      const userId = decodeStateHttp(state);
      if (!userId) throw new Error("Invalid state. Please try connecting again.");

      // Validate the decoded userId is actually a user (not a sandbox or other table ID)
      // Convex IDs are base32-encoded and all IDs for a given table share the same format
      // We verify by attempting to look up the user
      const userCheck = await ctx.runQuery(internal.githubHelpers.getUserById, {
        userId: userId as Id<"users">,
      }).catch(() => null);
      if (!userCheck) throw new Error("Invalid user state. Please try connecting again.");

      const res = await fetch("https://github.com/login/oauth/access_token", {
        method: "POST",
        headers: { "Accept": "application/json", "Content-Type": "application/json" },
        body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code }),
      });
      const data = await res.json() as { access_token?: string; error?: string };
      if (!data.access_token) throw new Error(data.error || "Failed to get access token");

      const userRes = await fetch("https://api.github.com/user", {
        headers: { "Authorization": `Bearer ${data.access_token}`, "Accept": "application/vnd.github.v3+json" },
      });
      const ghUser = await userRes.json() as { login: string };

      await ctx.runMutation(internal.githubHelpers.saveGithubToken, {
        userId: userId as Id<"users">,
        accessToken: data.access_token,
        username: ghUser.login,
      });

      return new Response(null, {
        status: 302,
        headers: { Location: `${origin}/portal/code?github_connected=${encodeURIComponent(ghUser.login)}` },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "OAuth failed";
      return new Response(null, {
        status: 302,
        headers: { Location: `${origin}/portal/code?github_error=${encodeURIComponent(msg)}` },
      });
    }
  }),
});

export default http;
