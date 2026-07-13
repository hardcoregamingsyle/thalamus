import { httpRouter } from "convex/server";
import { auth } from "./auth";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { Id } from "./_generated/dataModel";
import { handlePushWebhook } from "./githubWebhooks";
import { callModel, calcAgentBucksForTier } from "./agentCore";

const http = httpRouter();

auth.addHttpRoutes(http);

// Decode state helper
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

// CORS headers
function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

// SigV4 signing for Bedrock streaming
// Manual implementation (like agentCore.signBedrockRequest) because the AWS SDK
// can't run in the Convex runtime. This variant differs in one crucial way: the
// caller passes the canonical path explicitly. The streaming model path contains
// ":" (e.g. ...-v1:0), which fetch sends raw but AWS canonicalizes as %3A — the
// signature must be computed over the encoded form or Bedrock rejects it.
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

// Parse Bedrock credentials (env var fallback)
// Trimmed copy of agentCore.parseBedrockCredentials. Deliberately does NOT
// support ABSK bearer tokens: the streaming endpoint here is called with SigV4
// only, which requires a real access-key/secret pair.
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

// Claude Bedrock streaming
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

  // Bedrock streaming uses AWS's binary event-stream framing, not plain SSE.
  // Each frame is: 4-byte total length, 4-byte headers length, 4-byte prelude
  // CRC, headers, payload, 4-byte message CRC (all big-endian). The payload is
  // a JSON envelope whose "bytes" field is the base64-encoded Anthropic event
  // (content_block_delta etc.) — so decoding is two-level: frame → envelope →
  // inner event. CRCs are not verified here; malformed frames are just skipped.
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

// /stream-chat — SSE streaming for chat/study/guest modes
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

    // Auth gate: this endpoint drives paid models (Bedrock/Gemini) with the
    // platform's own credentials, so it must not be an open proxy. Every real
    // client (web, mobile, desktop) sends a session token; guests use the
    // separately day-capped guestSendMessage action, not this route. Reject
    // anything without a valid, unexpired session before doing any model work.
    const authedUserId = token
      ? await ctx.runQuery(internal.customAuthHelpers.getUserIdByToken, { token })
      : null;
    if (!authedUserId) {
      return new Response("Unauthorized", { status: 401, headers: corsHeaders() });
    }
    // Stop serving once the shared platform budget is spent.
    if (await ctx.runQuery(internal.admin.isPlatformBudgetExhausted, {})) {
      return new Response("Service temporarily unavailable", { status: 503, headers: corsHeaders() });
    }

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

    // Run all AI calls BEFORE creating the stream, so ctx is still valid
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
          const streamUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent?key=${key}`;
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

    // Save to DB NOW while ctx is still valid
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

    // Stream thinking notes first, then answer content for UX
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

// GitHub webhook for push events
http.route({
  path: "/github/webhook",
  method: "POST",
  handler: handlePushWebhook,
});

// GitHub OAuth callback
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

      // Sign-in flow (as opposed to repo-connect): GitHub OAuth apps allow only
      // one callback URL, so login rides the same route with a "login_" state.
      if (state.startsWith("login_")) {
        const st = await ctx.runMutation(internal.customAuthHelpers.consumeOAuthState, { state: state.slice(6) });
        if (!st) {
          return new Response(null, {
            status: 302,
            headers: { Location: `${origin}/auth?oauth_error=${encodeURIComponent("Sign-in link expired — try again")}` },
          });
        }
        const res = await fetch("https://github.com/login/oauth/access_token", {
          method: "POST",
          headers: { "Accept": "application/json", "Content-Type": "application/json" },
          body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code }),
        });
        const data = await res.json() as { access_token?: string; error?: string };
        if (!data.access_token) throw new Error(data.error || "Failed to get access token");

        // /user.email is often null (private) — the emails endpoint gives the
        // verified primary, which is the only address we trust for login.
        const ghHeaders = { "Authorization": `Bearer ${data.access_token}`, "Accept": "application/vnd.github.v3+json" };
        const [userRes, emailsRes] = await Promise.all([
          fetch("https://api.github.com/user", { headers: ghHeaders }),
          fetch("https://api.github.com/user/emails", { headers: ghHeaders }),
        ]);
        const ghUser = await userRes.json() as { login?: string; name?: string };
        const emails = await emailsRes.json() as Array<{ email: string; primary: boolean; verified: boolean }>;
        const primary = Array.isArray(emails) ? emails.find((e) => e.primary && e.verified) ?? emails.find((e) => e.verified) : undefined;
        if (!primary) throw new Error("No verified email on this GitHub account");

        const session = await ctx.runMutation(internal.customAuthHelpers.createOAuthSession, {
          email: primary.email,
          name: ghUser.name || ghUser.login,
        });
        const sep = st.redirect.includes("?") ? "&" : "?";
        return new Response(null, {
          status: 302,
          headers: { Location: `${st.redirect}${sep}token=${encodeURIComponent(session.token)}` },
        });
      }

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

// ── OAuth sign-in: Google + GitHub ────────────────────────────────────────────
// Both flows end in a customSessions token (the app's real session system),
// delivered back to the frontend as ?token= on the validated redirect URL.

// The redirect target is attacker-controllable at initiation, so it must pass
// this allowlist or a crafted link could exfiltrate session tokens.
function oauthRedirectAllowed(redirect: string): boolean {
  try {
    const u = new URL(redirect);
    const allowed = new Set([
      process.env.FRONTEND_URL ?? "https://thalamus.aphantic.skinticals.com",
      "https://thalamus.aphantic.skinticals.com",
      "http://localhost:5173",
      "http://localhost:4173",
    ]);
    return allowed.has(u.origin);
  } catch {
    return false;
  }
}

function randomState(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)))
    .map((b) => b.toString(16).padStart(2, "0")).join("");
}

http.route({
  path: "/auth/google",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const url = new URL(request.url);
    const redirect = url.searchParams.get("redirect") ?? "";
    if (!oauthRedirectAllowed(redirect)) return new Response("Invalid redirect", { status: 400 });
    const clientId = process.env.GOOGLE_CLIENT_ID;
    if (!clientId) return new Response("Google sign-in is not configured (GOOGLE_CLIENT_ID missing)", { status: 500 });

    const state = randomState();
    await ctx.runMutation(internal.customAuthHelpers.createOAuthState, { state, redirect, provider: "google" });

    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: `${process.env.CONVEX_SITE_URL}/auth/google/callback`,
      response_type: "code",
      scope: "openid email profile",
      state,
    });
    return new Response(null, {
      status: 302,
      headers: { Location: `https://accounts.google.com/o/oauth2/v2/auth?${params}` },
    });
  }),
});

http.route({
  path: "/auth/google/callback",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const url = new URL(request.url);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const fallback = `${process.env.FRONTEND_URL ?? "https://thalamus.aphantic.skinticals.com"}/auth`;
    const fail = (msg: string, to = fallback) => new Response(null, {
      status: 302,
      headers: { Location: `${to}${to.includes("?") ? "&" : "?"}oauth_error=${encodeURIComponent(msg)}` },
    });

    if (!code || !state) return fail("Sign-in was cancelled");
    const st = await ctx.runMutation(internal.customAuthHelpers.consumeOAuthState, { state });
    if (!st || st.provider !== "google") return fail("Sign-in link expired — try again");

    try {
      const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          code,
          client_id: process.env.GOOGLE_CLIENT_ID ?? "",
          client_secret: process.env.GOOGLE_CLIENT_SECRET ?? "",
          redirect_uri: `${process.env.CONVEX_SITE_URL}/auth/google/callback`,
          grant_type: "authorization_code",
        }),
      });
      const tokenData = await tokenRes.json() as { access_token?: string; error_description?: string };
      if (!tokenData.access_token) throw new Error(tokenData.error_description || "Token exchange failed");

      const infoRes = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
        headers: { Authorization: `Bearer ${tokenData.access_token}` },
      });
      const info = await infoRes.json() as { email?: string; email_verified?: boolean; name?: string };
      if (!info.email || info.email_verified === false) throw new Error("Google account has no verified email");

      const session = await ctx.runMutation(internal.customAuthHelpers.createOAuthSession, {
        email: info.email,
        name: info.name,
      });
      const sep = st.redirect.includes("?") ? "&" : "?";
      return new Response(null, {
        status: 302,
        headers: { Location: `${st.redirect}${sep}token=${encodeURIComponent(session.token)}` },
      });
    } catch (err) {
      return fail(err instanceof Error ? err.message : "Google sign-in failed", st.redirect);
    }
  }),
});

http.route({
  path: "/auth/github",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const url = new URL(request.url);
    const redirect = url.searchParams.get("redirect") ?? "";
    if (!oauthRedirectAllowed(redirect)) return new Response("Invalid redirect", { status: 400 });
    const clientId = process.env.GITHUB_CLIENT_ID;
    if (!clientId) return new Response("GitHub sign-in is not configured (GITHUB_CLIENT_ID missing)", { status: 500 });

    const state = randomState();
    await ctx.runMutation(internal.customAuthHelpers.createOAuthState, { state, redirect, provider: "github" });

    // Rides the app's single registered callback (/github/callback) with a
    // login_ state prefix — see the sign-in branch in that handler.
    const params = new URLSearchParams({
      client_id: clientId,
      scope: "user:email",
      state: `login_${state}`,
    });
    return new Response(null, {
      status: 302,
      headers: { Location: `https://github.com/login/oauth/authorize?${params}` },
    });
  }),
});

// ── Buy Me a Coffee payment webhook ──────────────────────────────────────────
// The payment rail: BMAC takes UPI, GPay, and cards with no buyer account.
// Webhooks are authenticated: X-Signature-Sha256 is an HMAC-SHA256 of the raw
// body with the webhook secret. We verify it before
// touching anything. Buyer→account matching is by email only (BMAC can't
// thread a user id through checkout) — hence the loud "use your account
// email" warnings in the buy modal. Non-matching payments land as
// "unclaimed" in the ledger rather than vanishing.
http.route({
  path: "/bmac/webhook",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    // Secret comes from the admin-managed config (DB), env var as fallback.
    // The webhook keeps processing even while purchases are disabled in the
    // admin panel — the switch gates the buy UI, but money that already moved
    // must always be recorded and credited.
    const config = await ctx.runQuery(internal.payments.getPaymentsConfigInternal, {});
    const secret = config?.webhookSecret || process.env.BMAC_WEBHOOK_SECRET;
    if (!secret) return new Response("BMAC webhook secret not configured", { status: 500 });

    const rawBody = await request.text();
    const signatureHeader = (request.headers.get("X-Signature-Sha256") ?? request.headers.get("x-signature-sha256") ?? "").toLowerCase();

    const key = await crypto.subtle.importKey(
      "raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
    );
    const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody));
    const expected = Array.from(new Uint8Array(mac)).map((b) => b.toString(16).padStart(2, "0")).join("");
    if (!signatureHeader || signatureHeader !== expected) {
      return new Response("invalid signature", { status: 401 });
    }

    let payload: {
      type?: string;
      live_mode?: boolean;
      data?: { id?: number | string; amount?: number; currency?: string; supporter_email?: string };
    };
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return new Response("bad payload", { status: 400 });
    }

    const d = payload.data;
    if (!d?.id || typeof d.amount !== "number" || !d.supporter_email) {
      return new Response("ignored", { status: 200 });
    }

    // Convert the paid amount to USD cents, the ledger's unit. The platform
    // pegs $1 = ₹100 (see CreditModal packs), so 1 rupee == 1 cent.
    const currency = (d.currency ?? "USD").toUpperCase();
    const priceCents = Math.round(currency === "INR" ? d.amount : d.amount * 100);

    await ctx.runMutation(internal.payments.recordPayment, {
      saleId: `bmac_${d.id}`,
      email: d.supporter_email.toLowerCase().trim(),
      priceCents,
      provider: "buymeacoffee",
    });
    return new Response("ok", { status: 200 });
  }),
});

// ── /api/v1/chat/completions — OpenAI-compatible endpoint for thal_ API keys ──
// Advertised on the /api-keys page. Bearer auth against the SHA-256 key hash;
// usage is metered against the key's own pre-paid allocation (see userApiKeys).

function apiCorsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };
}

function apiError(status: number, message: string, type: string): Response {
  // OpenAI-style error envelope so client SDKs surface the message properly.
  return new Response(JSON.stringify({ error: { message, type } }), {
    status,
    headers: { "Content-Type": "application/json", ...apiCorsHeaders() },
  });
}

// Requested model string → internal tier. Accepts our tier names as well as
// familiar aliases (e.g. "gpt-4o" from generic OpenAI clients → sonnet).
function modelToTier(model: string | undefined): "gemini" | "haiku" | "sonnet" | "opus46" | "opus48" {
  const m = (model ?? "").toLowerCase();
  if (m.includes("opus")) return m.includes("4-6") || m.includes("4.6") ? "opus46" : "opus48";
  if (m.includes("sonnet") || m.includes("gpt-4")) return "sonnet";
  if (m.includes("gemini") || m.includes("flash")) return "gemini";
  return "haiku";
}

http.route({
  path: "/api/v1/chat/completions",
  method: "OPTIONS",
  handler: httpAction(async () => new Response(null, { status: 204, headers: apiCorsHeaders() })),
});

http.route({
  path: "/api/v1/chat/completions",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    // 1. Authenticate: Bearer thal_... → SHA-256 → key row
    const authHeader = request.headers.get("Authorization") ?? "";
    const rawKey = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
    if (!rawKey.startsWith("thal_")) {
      return apiError(401, "Missing or malformed API key. Pass it as: Authorization: Bearer thal_...", "invalid_request_error");
    }
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(rawKey));
    const keyHash = Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
    const key = await ctx.runQuery(internal.userApiKeys.getKeyByHash, { keyHash });
    if (!key) return apiError(401, "Invalid, revoked, or expired API key.", "invalid_request_error");
    if (key.creditsRemaining <= 0) {
      return apiError(402, "This API key has exhausted its AgentBucks allocation.", "insufficient_quota");
    }

    // 2. Parse the OpenAI-format request
    let body: {
      model?: string;
      messages?: Array<{ role: string; content: string }>;
      stream?: boolean;
    };
    try {
      body = await request.json();
    } catch {
      return apiError(400, "Request body must be valid JSON.", "invalid_request_error");
    }
    if (!Array.isArray(body.messages) || body.messages.length === 0) {
      return apiError(400, "\"messages\" must be a non-empty array.", "invalid_request_error");
    }

    const systemPrompt = body.messages
      .filter((m) => m.role === "system")
      .map((m) => m.content)
      .join("\n");
    const conversation = body.messages
      .filter((m) => m.role !== "system")
      .map((m) => `${m.role === "assistant" ? "Assistant" : "User"}: ${m.content}`)
      .join("\n\n");
    const tier = modelToTier(body.model);

    // 3. Call the model through the same routing every other surface uses
    const dbCreds = await ctx.runQuery(internal.admin.getAwsCredentialsInternal, {});
    const geminiKeys = await ctx.runQuery(internal.admin.getGeminiKeysInternal, {});
    let result: { text: string; inputTokens: number; outputTokens: number };
    try {
      result = await callModel(conversation, systemPrompt, tier, geminiKeys, dbCreds ?? parseBedrockCredsFromEnv());
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Upstream model call failed";
      return apiError(502, msg, "api_error");
    }

    // 4. Meter actual usage against the key's allocation
    const cost = calcAgentBucksForTier(tier, result.inputTokens, result.outputTokens);
    await ctx.runMutation(internal.userApiKeys.recordKeyUsage, { id: key._id, credits: cost });

    // 5. Respond in OpenAI format
    const completionId = `chatcmpl-${key.keyId.slice(5)}${Date.now().toString(36)}`;
    const created = Math.floor(Date.now() / 1000);
    const modelName = body.model ?? tier;
    const usage = {
      prompt_tokens: result.inputTokens,
      completion_tokens: result.outputTokens,
      total_tokens: result.inputTokens + result.outputTokens,
    };

    if (body.stream) {
      // SSE with the full answer as one delta chunk, then the finish chunk and
      // [DONE]. Spec-compliant for clients; incremental deltas can come later.
      const enc = new TextEncoder();
      const chunk = (payload: unknown) => enc.encode(`data: ${JSON.stringify(payload)}\n\n`);
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(chunk({
            id: completionId, object: "chat.completion.chunk", created, model: modelName,
            choices: [{ index: 0, delta: { role: "assistant", content: result.text }, finish_reason: null }],
          }));
          controller.enqueue(chunk({
            id: completionId, object: "chat.completion.chunk", created, model: modelName,
            choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
            usage,
          }));
          controller.enqueue(enc.encode("data: [DONE]\n\n"));
          controller.close();
        },
      });
      return new Response(stream, {
        headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", ...apiCorsHeaders() },
      });
    }

    return new Response(JSON.stringify({
      id: completionId,
      object: "chat.completion",
      created,
      model: modelName,
      choices: [{ index: 0, message: { role: "assistant", content: result.text }, finish_reason: "stop" }],
      usage,
    }), {
      headers: { "Content-Type": "application/json", ...apiCorsHeaders() },
    });
  }),
});

export default http;
