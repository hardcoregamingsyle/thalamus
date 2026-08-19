import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal, api } from "./_generated/api";
import { Id } from "./_generated/dataModel";
import { handlePushWebhook } from "./githubWebhooks";
import { callModel, calcAgentBucksForTier, FREE_UNLIMITED, MODE_ADHD, adhdToTemperature, MODE_SYSTEM_PROMPTS } from "./lib/agentCore";
import { buildStudySystemPrompt } from "./lib/studyPrompt";
import {
  aoOptions,
  aoSearch,
  aoAnswer,
  aoLearn,
  aoLearningsList,
  aoBalance,
} from "./agentoverflowHttp";
import { aoMcp, aoMcpOptions, aoMcpMethodNotAllowed } from "./agentoverflowMcp";
import { sketchfabMcp, sketchfabMcpOptions, sketchfabMcpMethodNotAllowed } from "./sketchfabMcp";
import {
  aoPublicDoc,
  aoPublicOptions,
  aoSitemapIndex,
  aoSitemapPage,
} from "./agentoverflowPublic";

const http = httpRouter();


// Decode state helper — mirrors encodeState/decodeState in github.ts. Kept as
// a separate copy because this file runs in the HTTP-action runtime, which
// can't import from a "use node" module.
// State format: hex(userId) + "." + randomHex + "." + hex(returnPath)
function decodeHexHttp(hex: string): string | null {
  if (hex.length === 0 || hex.length % 2 !== 0) return null;
  const bytes: number[] = [];
  for (let i = 0; i < hex.length; i += 2) {
    const byte = parseInt(hex.slice(i, i + 2), 16);
    if (isNaN(byte)) return null;
    bytes.push(byte);
  }
  return new TextDecoder().decode(new Uint8Array(bytes));
}

function decodeStateHttp(state: string): { userId: string; returnPath: string | null } | null {
  try {
    const [userIdHex, , pathHex] = state.split(".");
    const userId = userIdHex ? decodeHexHttp(userIdHex) : null;
    if (!userId) return null;
    const returnPath = pathHex ? decodeHexHttp(pathHex) : null;
    return { userId, returnPath };
  } catch { return null; }
}

// Only a same-site, single-leading-slash path is ever honored as a post-OAuth
// redirect target — this blocks protocol-relative ("//host/...") tricks that
// could otherwise ride in through the state param.
function safeReturnPath(path: string | null): string {
  if (path && path.startsWith("/") && !path.startsWith("//")) return path;
  return "/portal/code";
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
  temperature = 0.7,
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
    temperature,
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
      preferHighTier?: boolean;
      skipUserSave?: boolean;
    };

    try {
      body = await request.json() as typeof body;
    } catch {
      return new Response("Bad request", { status: 400, headers: corsHeaders() });
    }

    const { content, mode, history, systemPrompt, userContext, token, conversationId, preferHighTier, skipUserSave } = body;

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

    // The SERVER is authoritative for the system prompt on every recognized
    // mode — study gets the grade/board/RAG-aware builder below, every other
    // known mode gets its shared MODE_SYSTEM_PROMPTS entry (same table used by
    // ai.ts's fallback actions, so persona stays identical across paths). This
    // upgrades every client at once (web, desktop, mobile) instead of trusting
    // whatever prompt the client happened to send; an unrecognized mode still
    // falls back to the client-sent systemPrompt.
    let effectiveSystemPrompt = MODE_SYSTEM_PROMPTS[mode] ?? systemPrompt;
    if (mode === "study") {
      try {
        const [userRecord, adminMaterials, resources] = await Promise.all([
          ctx.runQuery(internal.customAuthHelpers.getUserByTokenInternal, { token: token! }) as Promise<{ studyGrade?: string; studyBoard?: string; studyLanguage?: string } | null>,
          ctx.runQuery(internal.admin.getAdminStudyMaterials, {}) as Promise<Array<{ title: string; content: string }>>,
          ctx.runQuery(internal.studyHelpers.getResourcesForUser, { userId: authedUserId }) as Promise<Array<{ title: string }>>,
        ]);

        // Vector + graph grounding over the student's uploads. Non-fatal: a
        // slow or failed lookup must never block the answer itself.
        let ragContext = "";
        let graphContext = "";
        try {
          const studyCtx = await ctx.runAction(internal.rag.getStudyContextInternal, {
            userId: authedUserId,
            query: content,
          }) as { ragContext: string; graphContext: string; hasContext: boolean };
          ragContext = studyCtx.ragContext;
          graphContext = studyCtx.graphContext;
        } catch { /* answer without grounding */ }

        effectiveSystemPrompt = buildStudySystemPrompt({
          grade: userRecord?.studyGrade,
          board: userRecord?.studyBoard,
          language: userRecord?.studyLanguage,
          ragContext,
          graphContext,
          adminContext: adminMaterials.slice(0, 2).map((m) => `[${m.title}]: ${m.content.slice(0, 800)}`).join("\n"),
          resourceTitles: resources.map((r) => r.title),
        });
      } catch (err) {
        // Profile lookup failed — fall back to the client-sent prompt.
        console.error("Study prompt build failed:", err instanceof Error ? err.message : String(err));
      }
    }

    const contextHeader = userContext
      ? `\n\nCurrent date/time: ${userContext.datetime} (${userContext.timezone})\n`
      : "";
    const fullSystem = effectiveSystemPrompt + contextHeader;
    const temperature = adhdToTemperature(MODE_ADHD[mode] ?? MODE_ADHD.chat);

    const messages: Array<{ role: "user" | "assistant"; content: string }> = [
      ...history.map(m => ({ role: m.role, content: m.content.slice(0, 2000) })),
      { role: "user" as const, content },
    ];

    const encoder = new TextEncoder();
    const sse = (payload: unknown) => encoder.encode(`data: ${JSON.stringify(payload)}\n\n`);

    // Load provider credentials up front (ctx calls must stay before the
    // stream is handed back — the transform body below only does plain fetch
    // plus the deferred DB save, mirroring Convex's documented streaming
    // pattern where the action context stays alive until the writer closes).
    const dbCreds = await ctx.runQuery(internal.admin.getAwsCredentialsInternal, {});
    const bedrockCreds = dbCreds ?? parseBedrockCredsFromEnv();
    const hasBedrock = !!bedrockCreds;
    const geminiKeys = await ctx.runQuery(internal.admin.getGeminiKeysInternal, {}) as string[];

    // True token streaming: the model call runs inside the stream body and
    // every provider delta is pushed to the SSE response the instant it
    // arrives, instead of buffering the whole answer and drip-feeding it as one
    // large block once the call finally returns.
    const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
    const writer = writable.getWriter();
    let streamClosed = false;
    const write = async (payload: unknown) => {
      if (streamClosed) return;
      try { await writer.write(sse(payload)); } catch { /* client gone */ }
    };

    const run = async () => {
      let fullText = "";
      let usedClaude = false;
      let streamSuccess = false;

      // Brief activity notes so the UI shows movement before the first token.
      const thinkingNotes = [
        `Mode: ${mode || "chat"}`,
        "Reading conversation context",
        "Reasoning\u2026",
      ];
      for (const note of thinkingNotes) {
        await write({ type: "thinking", chunk: `${note}\n` });
        await new Promise(r => setTimeout(r, 70));
      }
      await write({ type: "answer_start" });

      // 1) Bedrock Claude — true token streaming (deltas pushed as they arrive).
      if (!streamSuccess && hasBedrock && bedrockCreds && preferHighTier !== false) {
        try {
          await streamClaudeWithCreds(bedrockCreds, fullSystem, messages, (delta) => {
            fullText += delta;
            void write({ type: "answer", chunk: delta });
          }, temperature);
          usedClaude = true;
          streamSuccess = fullText.length > 0;
        } catch (bedrockErr) {
          console.error("Bedrock streaming failed:", bedrockErr instanceof Error ? bedrockErr.message : String(bedrockErr));
          fullText = "";
        }
      }

      // 2) Gemini — streamGenerateContent SSE, real deltas as they arrive.
      if (!streamSuccess) {
        const geminiContents = messages.map(m => ({
          role: m.role === "assistant" ? "model" : "user",
          parts: [{ text: m.content }],
        }));
        const geminiBody = JSON.stringify({
          system_instruction: { parts: [{ text: fullSystem }] },
          contents: geminiContents,
          generationConfig: { maxOutputTokens: 4096, temperature },
        });
        for (let attempt = 0; attempt < geminiKeys.length && !streamSuccess; attempt++) {
          try {
            const key = geminiKeys[attempt % geminiKeys.length];
            const streamUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:streamGenerateContent?alt=sse&key=${key}`;
            const geminiRes = await fetch(streamUrl, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: geminiBody,
            });
            if (geminiRes.status === 429 || geminiRes.status === 403) continue;
            if (!geminiRes.ok || !geminiRes.body) continue;
            const reader = geminiRes.body.getReader();
            const decoder = new TextDecoder();
            let buffer = "";
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              buffer += decoder.decode(value, { stream: true });
              const lines = buffer.split("\n");
              buffer = lines.pop() ?? "";
              for (const line of lines) {
                if (!line.startsWith("data: ")) continue;
                const data = line.slice(6).trim();
                if (!data || data === "[DONE]") continue;
                try {
                  const obj = JSON.parse(data) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
                  const text = obj.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
                  if (text) { fullText += text; await write({ type: "answer", chunk: text }); }
                } catch { /* skip malformed frame */ }
              }
            }
            streamSuccess = fullText.length > 0;
          } catch { /* try next key */ }
        }
      }

      // 3) VLY fallback — non-streaming, drip-feed so the UI still animates.
      if (!streamSuccess) {
        try {
          const vlyText = await ctx.runAction(internal.ai.vlyFallbackCompletion, {
            systemPrompt: fullSystem,
            messages,
          });
          if (vlyText) {
            fullText = vlyText;
            const words = fullText.split(/(?<=\s)|(?=\s)/);
            for (let i = 0; i < words.length; i += 3) {
              await write({ type: "answer", chunk: words.slice(i, i + 3).join("") });
              await new Promise(r => setTimeout(r, 8));
            }
            streamSuccess = true;
          }
        } catch (vlyErr) {
          console.error("VLY fallback failed:", vlyErr instanceof Error ? vlyErr.message : String(vlyErr));
        }
      }

      if (!streamSuccess || !fullText) {
        fullText = "Sorry, I couldn't generate a response. Please try again.";
        await write({ type: "answer", chunk: fullText });
      }

      // Process ASK-QUESTION / ASK-MCQ and JSON-format ask ops into injectable HTML.
      if (mode === "study" && fullText) {
        // Handle JSON ops format: {"op":"ask-question","question":"..."}
        fullText = fullText.replace(/\{"op":"ask-question","question":"([^"]+)"\}/g, (_, question) =>
          `<div class="thalamus-ask" data-ask='${JSON.stringify({type:"question",question})}'></div>`
        );
        // Handle JSON ops format:
        //   {"op":"ask-mcq","question":"...","options":[...],"correct":N}            single-select
        //   {"op":"ask-mcq","question":"...","options":[...],"correct":[0,2]}        multi-select (correct is an array)
        //   {"op":"ask-mcq","question":"...","options":[...],"correct":N,"multiSelect":true}  multi-select flag
        fullText = fullText.replace(/\{"op":"ask-mcq","question":"([^"]+)","options":(\[[^\]]+\]),"correct":(\d+|\[[^\]]*\])(,"multiSelect":(true|false))?\}/g, (_, question, optionsJson, correctJson, _flagKey, multiSelectRaw) => {
          try {
            const options = JSON.parse(optionsJson) as string[];
            // correct is a bare number (single) or an array of indices (multi).
            const isArray = correctJson.trim().startsWith("[");
            const correct: number | number[] = isArray
              ? (JSON.parse(correctJson) as number[])
              : parseInt(correctJson, 10);
            const multiSelect = isArray || multiSelectRaw === "true";
            return `<div class="thalamus-mcq" data-mcq='${JSON.stringify({type:"mcq",question,options,correct,multiSelect})}'></div>`;
          } catch { return `<p>[MCQ: ${question}]</p>`; }
        })
        // Flashcards op: {"op":"flashcards","cards":[{"front":"...","back":"..."},...]}
        .replace(/\{"op":"flashcards","cards":(\[[\s\S]*?\])\}/g, (_, cardsJson) => {
          try {
            const cards = JSON.parse(cardsJson) as Array<{ front: string; back: string }>;
            if (!Array.isArray(cards) || cards.length === 0) return "";
            return `<div class="thalamus-flashcards" data-flashcards='${JSON.stringify({type:"flashcards",cards})}'></div>`;
          } catch { return ""; }
        })
        // Pathway op: {"op":"pathway","title":"...","steps":[{"topic":"...","question":"...","options":[...],"correct":N|[...],"multiSelect":bool,"explain":"..."}]}
        .replace(/\{"op":"pathway","title":"([^"]*)","steps":(\[[\s\S]*?\])\}/g, (_, title, stepsJson) => {
          try {
            const steps = JSON.parse(stepsJson) as Array<{
              topic?: string; question: string; options: string[];
              correct: number | number[]; multiSelect?: boolean; explain?: string;
            }>;
            if (!Array.isArray(steps) || steps.length === 0) return "";
            return `<div class="thalamus-pathway" data-pathway='${JSON.stringify({type:"pathway",title,steps})}'></div>`;
          } catch { return ""; }
        });
      }

      // Save the completed exchange to DB now that the stream has finished.
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

      await write({ type: "done", done: true, fullText });
      streamClosed = true;
      try { await writer.close(); } catch { /* already closed */ }
    };

    // Kick off the stream but don't await it — the Response is returned now and
    // Convex keeps the action alive until the writer closes.
    void run().catch((err) => {
      console.error("Stream error:", err instanceof Error ? err.message : String(err));
      streamClosed = true;
      try { writer.close(); } catch { /* ignore */ }
    });

    return new Response(readable, {
      status: 200,
      headers: {
        ...corsHeaders(),
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "X-Accel-Buffering": "no",
        "Connection": "keep-alive",
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

    // Falls back to the known production domain if unset
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

        // The `repo` scope requested above rides along on this same token, so
        // signing in with GitHub connects repo access in the same step — save
        // it onto the user record instead of discarding it after login.
        const signInScopes = userRes.headers.get("x-oauth-scopes") ?? undefined;
        const session = await ctx.runMutation(internal.customAuthHelpers.createOAuthSession, {
          email: primary.email,
          name: ghUser.name || ghUser.login,
          githubAccessToken: data.access_token,
          githubUsername: ghUser.login,
          ...(signInScopes === undefined ? {} : { githubScopes: signInScopes }),
        });
        const sep = st.redirect.includes("?") ? "&" : "?";
        return new Response(null, {
          status: 302,
          headers: { Location: `${st.redirect}${sep}token=${encodeURIComponent(session.token)}` },
        });
      }

      const decoded = decodeStateHttp(state);
      if (!decoded) throw new Error("Invalid state. Please try connecting again.");
      const { userId } = decoded;
      const returnPath = safeReturnPath(decoded.returnPath);

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
      // GitHub reports what it ACTUALLY granted on every authenticated response.
      // Asking for `workflow` in the authorize URL does not guarantee getting it
      // — record the truth so the Git Sync tab can say "reconnecting won't help,
      // your org denies this scope" instead of looping the user through OAuth.
      const grantedScopes = userRes.headers.get("x-oauth-scopes") ?? undefined;

      await ctx.runMutation(internal.githubHelpers.saveGithubToken, {
        userId: userId as Id<"users">,
        accessToken: data.access_token,
        username: ghUser.login,
        ...(grantedScopes === undefined ? {} : { scopes: grantedScopes }),
      });

      const sep = returnPath.includes("?") ? "&" : "?";
      return new Response(null, {
        status: 302,
        headers: { Location: `${origin}${returnPath}${sep}github_connected=${encodeURIComponent(ghUser.login)}` },
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
      "http://localhost:5174", // AgentOverflow dev server
    ]);
    // AgentOverflow shares this deployment's auth — its site logs in here too.
    const aoSite = process.env.AO_FRONTEND_URL;
    if (aoSite) {
      try {
        allowed.add(new URL(aoSite).origin);
      } catch {
        // Malformed env value: skip rather than break every OAuth login.
      }
    }
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
    // login_ state prefix — see the sign-in branch in that handler. Scope
    // includes `repo` so signing in with GitHub also connects repo access —
    // no separate "connect GitHub" step and no PAT needed to import a repo.
    // `workflow` scope is required to create/update .github/workflows/thalamus-vm.yml
    // in the branch's auto-created repo, which is how cloud commands execute;
    // without it GitHub rejects the write with a bare 404 (not a clear 403).
    const params = new URLSearchParams({
      client_id: clientId,
      scope: "user:email repo workflow",
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
// Public model names are ours, not the upstream provider's. `thalamus-fast`,
// `thalamus-pro` and `thalamus-max` are what we document; the provider-shaped
// names below still resolve so anything already pointed at this endpoint keeps
// working, but nothing here should ever be echoed back to a caller.
function modelToTier(model: string | undefined): "gemini" | "haiku" | "sonnet" | "opus46" | "opus48" {
  const m = (model ?? "").toLowerCase();
  if (m.includes("max")) return "opus48";
  if (m.includes("pro")) return "sonnet";
  if (m.includes("fast") || m.includes("lite")) return "haiku";
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
    if (!FREE_UNLIMITED && key.creditsRemaining <= 0) {
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
      result = await callModel(conversation, systemPrompt, tier, geminiKeys, dbCreds ?? parseBedrockCredsFromEnv(), ctx);
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
    // Echo back what the caller asked for, never the tier — `tier` is an
    // internal provider-shaped name and returning it as `model` told every API
    // consumer exactly what we run underneath.
    const modelName = body.model ?? "thalamus-fast";
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

// ── Contextual ad request (Gravity), proxied so the API key stays server-side ─
// The browser calls THIS endpoint via fetch, which means the request carries the
// real end user's User-Agent and IP in its headers. We read those and forward
// them to Gravity as device signals — Gravity uses the device object (not our
// server's source IP) for geo/targeting/bot-filtering in server-side fetching,
// so ads fill for the actual user, not our datacenter. The Gravity key never
// leaves the server.
// Where a GitHub Actions run reports the result of a build command. It has to
// be unauthenticated — the job runs on a public repo with no secret of ours —
// so the per-command nonce carries the whole weight: single-use, issued at
// dispatch, cleared on spend. An unmatched nonce is a silent 404, because
// telling a caller which command ids exist is free reconnaissance.
http.route({
  path: "/code/command-result",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    let body: { commandId?: string; nonce?: string; output?: string; exitCode?: number };
    try {
      body = await request.json();
    } catch {
      return new Response("Bad request", { status: 400 });
    }
    if (!body.commandId || !body.nonce) {
      return new Response("Bad request", { status: 400 });
    }

    const accepted = await ctx.runMutation(internal.codeCommands.completeFromRunner, {
      commandId: body.commandId as Id<"codeCommands">,
      nonce: body.nonce,
      output: typeof body.output === "string" ? body.output : "",
      exitCode: typeof body.exitCode === "number" ? body.exitCode : 1,
    });

    return accepted
      ? new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "Content-Type": "application/json" } })
      : new Response("Not found", { status: 404 });
  }),
});

// Poll endpoint for the persistent VM worker (thalamus-vm.yml). The job loops
// every 10s: claims any queued commands (stamping a fresh one-time nonce on
// each), heartbeats so the booter never stacks a second VM over a live one,
// and asks whether to keep living. Same security model as /code/command-result
// — the endpoint is unauthenticated by necessity (public-repo Actions runner),
// so the worker's vmNonce is the whole story: a wrong or missing nonce is a
// silent 404.
//
// keepAlive rules (the idle shutdown the user asked for):
//   - work in flight (commands just claimed, or still pending/running) → alive
//   - otherwise → alive only if the branch was active recently: 300s while the
//     task is incomplete, 600s after it completed. "Active" = lastActivityAt,
//     bumped on every status change / message, so a pipeline churning through
//     steps keeps the VM warm and a pipeline parked on the user keeps it warm
//     only until the deadline passes.
http.route({
  path: "/code/vm-poll",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    let body: { branchId?: string; vmNonce?: string };
    try {
      body = await request.json();
    } catch {
      return new Response("Bad request", { status: 400 });
    }
    if (!body.branchId || !body.vmNonce) {
      return new Response("Bad request", { status: 400 });
    }

    const branch = await ctx.runQuery(internal.codeBranches.getBranchInternal, { branchId: body.branchId });
    if (!branch || branch.vmNonce !== body.vmNonce) {
      return new Response("Not found", { status: 404 });
    }

    const claimed = await ctx.runMutation(internal.codeCommands.claimPendingCommandsForVm, {
      branchId: body.branchId,
    });

    // Heartbeat — proves this worker is alive so bootVmForBranch backs off.
    await ctx.runMutation(internal.codeBranches.setVmInfo, {
      branchId: body.branchId,
      lastSeenAt: Date.now(),
    });

    const stillBusy = await ctx.runQuery(internal.codeCommands.getPendingCommands, {
      branchId: body.branchId,
    });

    let keepAlive = claimed.length > 0 || (stillBusy?.length ?? 0) > 0;
    if (!keepAlive) {
      const lastActivity = branch.lastActivityAt ?? 0;
      const idleMs = Date.now() - lastActivity;
      const windowMs = branch.status === "completed" ? 600_000 : 300_000;
      keepAlive = idleMs < windowMs;
    }

    return new Response(JSON.stringify({ keepAlive, commands: claimed }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }),
});

// Callback from the sandbox GitHub Actions workflow — reports the tunnel URL
// so Thalamus can display the preview link. Unauthenticated by necessity (a
// public-repo Actions job has no other credential to send), so the nonce in
// the query string — generated per dispatch, single-use — is what stops
// anyone who can see a branchId in a URL from posting a fake tunnel.
http.route({
  path: "/code/sandbox-callback",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    let body: { tunnelUrl?: string; status?: string; error?: string };
    try {
      body = await request.json();
    } catch {
      return new Response("Bad request", { status: 400 });
    }
    const url = new URL(request.url);
    const branchId = url.searchParams.get("branchId");
    const nonce = url.searchParams.get("nonce");
    if (!branchId || !nonce) return new Response("Missing branchId or nonce", { status: 400 });

    const accepted = await ctx.runMutation(internal.codeBranches.completeSandboxCallback, {
      branchId,
      nonce,
      url: body.status === "running" && body.tunnelUrl ? body.tunnelUrl : null,
      status: body.status === "running" && body.tunnelUrl ? "running" : "stopped",
    });

    return accepted
      ? new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "Content-Type": "application/json" } })
      : new Response("Not found", { status: 404 });
  }),
});

http.route({
  path: "/ad",
  method: "OPTIONS",
  handler: httpAction(async () => new Response(null, { status: 204, headers: corsHeaders() })),
});

http.route({
  path: "/ad",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    let body: { token?: string; messages?: Array<{ role: string; content: string }>; sessionId?: string; count?: number };
    try {
      body = await request.json();
    } catch {
      return new Response("Bad request", { status: 400, headers: corsHeaders() });
    }

    // Real end-user signals straight from the browser's request headers.
    const h = request.headers;
    const ua = h.get("user-agent") ?? undefined;
    const ip = (h.get("x-forwarded-for")?.split(",")[0].trim())
      || h.get("cf-connecting-ip")
      || h.get("x-real-ip")
      || undefined;
    const country = h.get("cf-ipcountry") ?? h.get("x-vercel-ip-country") ?? undefined;
    const device = (ua || ip || country) ? { ua, ip, country } : undefined;

    const ad = await ctx.runAction(api.gravityAds.requestAd, {
      token: body.token,
      messages: body.messages ?? [],
      sessionId: body.sessionId,
      count: body.count,
      device,
    });

    return new Response(JSON.stringify({ ad: ad ?? null }), {
      status: 200,
      headers: { "Content-Type": "application/json", ...corsHeaders() },
    });
  }),
});

// ── /ao/v1/* — AgentOverflow public API for ao_ keys ─────────────────────────
// Handlers live in agentoverflowHttp.ts; search/answer proxy to the corpus VM
// (AO_VM_URL + AO_INTERNAL_SECRET), learn feeds the async scoring pipeline.

http.route({ path: "/ao/v1/search", method: "OPTIONS", handler: aoOptions });
http.route({ path: "/ao/v1/search", method: "POST", handler: aoSearch });
http.route({ path: "/ao/v1/answer", method: "OPTIONS", handler: aoOptions });
http.route({ path: "/ao/v1/answer", method: "POST", handler: aoAnswer });
http.route({ path: "/ao/v1/learn", method: "OPTIONS", handler: aoOptions });
http.route({ path: "/ao/v1/learn", method: "POST", handler: aoLearn });
http.route({ path: "/ao/v1/learnings", method: "OPTIONS", handler: aoOptions });
http.route({ path: "/ao/v1/learnings", method: "GET", handler: aoLearningsList });
http.route({ path: "/ao/v1/balance", method: "OPTIONS", handler: aoOptions });
http.route({ path: "/ao/v1/balance", method: "GET", handler: aoBalance });

// AgentOverflow as a remote MCP server — Claude Code and friends connect
// straight to this path with an ao_ key. See agentoverflowMcp.ts.
http.route({ path: "/ao/mcp", method: "POST", handler: aoMcp });
http.route({ path: "/ao/mcp", method: "OPTIONS", handler: aoMcpOptions });
http.route({ path: "/ao/mcp", method: "GET", handler: aoMcpMethodNotAllowed });
http.route({ path: "/ao/mcp", method: "DELETE", handler: aoMcpMethodNotAllowed });

// Built-in Sketchfab 3D-model server (attached to gamedev pipeline runs).
http.route({ path: "/sketchfab/mcp", method: "POST", handler: sketchfabMcp });
http.route({ path: "/sketchfab/mcp", method: "OPTIONS", handler: sketchfabMcpOptions });
http.route({ path: "/sketchfab/mcp", method: "GET", handler: sketchfabMcpMethodNotAllowed });
http.route({ path: "/sketchfab/mcp", method: "DELETE", handler: sketchfabMcpMethodNotAllowed });

// Public SEO surface: crawlable doc payloads + sitemaps for the site's /q pages.
http.route({ path: "/ao/public/doc", method: "GET", handler: aoPublicDoc });
http.route({ path: "/ao/public/doc", method: "OPTIONS", handler: aoPublicOptions });
http.route({ path: "/ao/sitemap.xml", method: "GET", handler: aoSitemapIndex });
http.route({ pathPrefix: "/ao/sitemaps/", method: "GET", handler: aoSitemapPage });

export default http;
