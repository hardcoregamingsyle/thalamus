import { httpRouter } from "convex/server";
import { auth } from "./auth";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { Id } from "./_generated/dataModel";

const http = httpRouter();

auth.addHttpRoutes(http);

// ── Gemini key pool (same as ai.ts) ──────────────────────────────────────────
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
];
let keyIdx = 0;

function nextGeminiKey() {
  const k = GEMINI_KEYS[keyIdx % GEMINI_KEYS.length];
  keyIdx++;
  return k;
}

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
  } catch {
    return null;
  }
}

// ── CORS headers helper ───────────────────────────────────────────────────────
function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

// ── /stream-chat — SSE streaming for chat/study/guest modes ──────────────────
// POST body: { content, mode, history, systemPrompt, userContext?, token?, conversationId? }
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
    };

    try {
      body = await request.json() as typeof body;
    } catch {
      return new Response("Bad request", { status: 400, headers: corsHeaders() });
    }

    const { content, history, systemPrompt, userContext, token, conversationId } = body;

    // Build Gemini messages
    const contextHeader = userContext
      ? `\n\nCurrent date/time: ${userContext.datetime} (${userContext.timezone})\n`
      : "";

    const fullSystem = systemPrompt + contextHeader;

    const geminiContents = [
      ...history.map(m => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.content.slice(0, 2000) }],
      })),
      { role: "user", parts: [{ text: content }] },
    ];

    // Try Gemini streaming
    const key = nextGeminiKey();
    const streamUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite-preview:streamGenerateContent?key=${key}&alt=sse`;

    let geminiRes: Response;
    try {
      geminiRes = await fetch(streamUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: fullSystem }] },
          contents: geminiContents,
          generationConfig: { maxOutputTokens: 4096, temperature: 0.7 },
        }),
      });
    } catch {
      return new Response("data: [ERROR]\n\n", {
        status: 200,
        headers: { ...corsHeaders(), "Content-Type": "text/event-stream", "Cache-Control": "no-cache" },
      });
    }

    if (!geminiRes.ok || !geminiRes.body) {
      return new Response("data: [ERROR]\n\n", {
        status: 200,
        headers: { ...corsHeaders(), "Content-Type": "text/event-stream", "Cache-Control": "no-cache" },
      });
    }

    // Transform Gemini SSE → our SSE (extract text chunks)
    const encoder = new TextEncoder();
    let fullText = "";

    const transformedStream = new ReadableStream({
      async start(controller) {
        const reader = geminiRes.body!.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() ?? "";

            for (const line of lines) {
              if (!line.startsWith("data: ")) continue;
              const jsonStr = line.slice(6).trim();
              if (!jsonStr || jsonStr === "[DONE]") continue;
              try {
                const parsed = JSON.parse(jsonStr) as {
                  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
                };
                const chunk = parsed.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
                if (chunk) {
                  fullText += chunk;
                  // Send chunk as SSE
                  controller.enqueue(encoder.encode(`data: ${JSON.stringify({ chunk })}\n\n`));
                }
              } catch { /* skip malformed */ }
            }
          }
        } catch { /* stream ended */ }

        // Send done signal
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ done: true, fullText })}\n\n`));
        controller.close();

        // Fire-and-forget: save to DB if authenticated
        if (token && conversationId) {
          try {
            await ctx.runMutation(internal.aiHelpers.saveStreamedMessage, {
              conversationId: conversationId as Id<"conversations">,
              token,
              content,
              response: fullText,
              // Gemini Flash Lite pricing
              inputCostPerMillion: 0.60,
              outputCostPerMillion: 2.40,
            });
          } catch { /* non-critical */ }
        }
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

    const origin = "https://thalamus.aphantic.skinticals.com";

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