// Pure utility module - no Convex imports, just logic
// This keeps agentTeam.ts lean for faster module loading

// ── Claude via Amazon Bedrock — Pricing (cents per million tokens) ────────────
export const CLAUDE_PRICING = {
  "claude-haiku-4-5": {
    inputCentsPerMillion: 180,
    outputCentsPerMillion: 720,
    label: "Claude Haiku 4.5",
  },
  "claude-sonnet-4-6": {
    inputCentsPerMillion: 540,
    outputCentsPerMillion: 2650,
    label: "Claude Sonnet 4.6",
  },
  "claude-opus-4-6": {
    inputCentsPerMillion: 744,
    outputCentsPerMillion: 4200,
    label: "Claude Opus 4.6",
  },
  "claude-opus-4-7": {
    inputCentsPerMillion: 1200,
    outputCentsPerMillion: 6000,
    label: "Claude Opus 4.7",
  },
} as const;

export type ClaudeModel = keyof typeof CLAUDE_PRICING;

export function calcClaudeCost(model: ClaudeModel, inputTokens: number, outputTokens: number): number {
  const pricing = CLAUDE_PRICING[model];
  return (inputTokens / 1_000_000) * pricing.inputCentsPerMillion
       + (outputTokens / 1_000_000) * pricing.outputCentsPerMillion;
}

export function calcAgentBucksFromTokens(
  inputTokens: number,
  outputTokens: number,
  inputCostPerMillion: number,
  outputCostPerMillion: number,
): number {
  const inputAB = (inputTokens / 1_000_000) * inputCostPerMillion * 1_500_000;
  const outputAB = (outputTokens / 1_000_000) * outputCostPerMillion * 1_500_000;
  return Math.ceil(inputAB + outputAB);
}

export function calcClaudeAgentBucks(model: ClaudeModel, inputTokens: number, outputTokens: number): number {
  const pricing = CLAUDE_PRICING[model];
  return calcAgentBucksFromTokens(
    inputTokens,
    outputTokens,
    pricing.inputCentsPerMillion / 100,
    pricing.outputCentsPerMillion / 100,
  );
}

// ── Model routing — which model each agent uses ───────────────────────────────
// "gemini" = gemini-3.1-flash-lite-preview (free, fast)
// "haiku"  = claude-haiku-4-5 (cheap Claude)
// "sonnet" = claude-sonnet-4-6 (mid-tier Claude)
// "opus46" = claude-opus-4-6 (high-tier Claude)
// "opus47" = claude-opus-4-7 (top-tier Claude)
export type ModelTier = "gemini" | "haiku" | "sonnet" | "opus46" | "opus47";

// Default model per agent (Code Mode)
// Analyser: haiku for planning phase, gemini for task/subtask phase (see agentTeam.ts override)
export const AGENT_MODEL_MAP: Record<string, ModelTier> = {
  // Planning phase
  Researcher: "gemini",
  Analyser: "haiku",     // haiku for first-time/planning; overridden to gemini in task/subtask
  Planner: "haiku",
  // Task execution
  Coder: "sonnet",       // sonnet-4-6; overridden by difficulty
  Optimiser: "sonnet",
  Organizer: "gemini",   // gemini-3.1-flash-lite-preview
  Tester: "haiku",       // haiku-4-5
  Summarizer: "gemini",
  // Red Team sub-agents
  VulnerabilitySpotter: "gemini",  // fast scan, gemini is sufficient
  DataCorruptor: "haiku",          // haiku-4-5
  ZeroDayExploiter: "sonnet",      // sonnet-4-6
  FrameworkAuditor: "sonnet",      // sonnet-4-6; overridden to opus46/opus47 by difficulty
  RedTeamOrchestrator: "gemini",
  // Final review
  Critic: "gemini",
  // Research mode — all gemini
  ResearchPlanner: "gemini",
  DataTaker: "gemini",
  ResearchOrganiser: "gemini",
};

// Difficulty → Coder model override
export const DIFFICULTY_CODER_MODEL: Record<string, ModelTier> = {
  normal: "sonnet",      // sonnet-4-6 for normal tasks
  hard: "opus46",
  extreme: "opus47",
};

// Difficulty → FrameworkAuditor model override
export const DIFFICULTY_FRAMEWORK_AUDITOR_MODEL: Record<string, ModelTier> = {
  normal: "sonnet",
  hard: "opus46",
  extreme: "opus47",
};

// Difficulty → Red Team sonnet agents override (extreme only)
export const DIFFICULTY_REDTEAM_SONNET_OVERRIDE: Record<string, ModelTier | null> = {
  normal: null,
  hard: null,
  extreme: "opus46",
};

export type TaskDifficulty = "normal" | "hard" | "extreme";

// ── AWS Bedrock Claude caller ─────────────────────────────────────────────────
// Uses AWS Bedrock to call Claude models via SigV4-signed REST API
// Token-saving strategies:
// - Trim system prompts to essentials (1500 chars max)
// - Cap context at 8000 chars
// - Use maxTokens limits per model tier
// - Lower temperature for focused outputs

// AWS Bedrock model IDs for Claude models
const BEDROCK_MODEL_IDS: Record<ClaudeModel, string> = {
  "claude-haiku-4-5":  "us.anthropic.claude-haiku-4-5-20251001-v1:0",
  "claude-sonnet-4-6": "us.anthropic.claude-sonnet-4-5-20251001-v1:0",
  "claude-opus-4-6":   "us.anthropic.claude-opus-4-5-20251001-v1:0",
  "claude-opus-4-7":   "us.anthropic.claude-opus-4-5-20251001-v1:0",
};

// Max output tokens per model tier (to save credits)
const MAX_OUTPUT_TOKENS: Record<ClaudeModel, number> = {
  "claude-haiku-4-5": 2048,
  "claude-sonnet-4-6": 3000,
  "claude-opus-4-6": 4000,
  "claude-opus-4-7": 4000,
};

// Parse Bedrock credentials from env var
// Supports multiple formats:
// 1. Standard AWS: "AKIAXXXXXX:secretkey:us-east-1"
// 2. Custom Bedrock key (base64 encoded): "ABSKQmVkcm9ja0FQSUtleS..."
// 3. Raw custom key: "BedrockAPIKey-xxx:secret"
function parseBedrockCredentials(): { accessKeyId: string; secretAccessKey: string; region: string; isCustomKey: boolean } | null {
  const raw = process.env.AWS_BEDROCK_API_KEY;
  if (!raw) return null;

  // Try to detect if it's a base64-encoded custom key
  // Base64 strings are typically longer and contain only base64 chars
  const isBase64 = /^[A-Za-z0-9+/]+=*$/.test(raw) && raw.length > 40;
  
  let decoded = raw;
  if (isBase64) {
    try {
      decoded = Buffer.from(raw, "base64").toString("utf8").replace(/^\0+/, ""); // strip leading null bytes
    } catch {
      decoded = raw;
    }
  }

  // Check if it's a standard AWS access key (starts with AKIA, ASIA, AROA, etc.)
  const isStandardAWS = /^(AKIA|ASIA|AROA|AIDA)[A-Z0-9]{16}/.test(decoded);
  
  if (isStandardAWS) {
    const parts = decoded.split(":");
    if (parts.length < 2) return null;
    return {
      accessKeyId: parts[0],
      secretAccessKey: parts.slice(1, parts.length > 2 ? parts.length - 1 : 2).join(":"),
      region: parts.length > 2 ? parts[parts.length - 1] : "us-east-1",
      isCustomKey: false,
    };
  }

  // Custom Bedrock API key format: "KeyId:Secret" or just the full key as Bearer token
  const colonIdx = decoded.indexOf(":");
  if (colonIdx > 0) {
    return {
      accessKeyId: decoded.substring(0, colonIdx),
      secretAccessKey: decoded.substring(colonIdx + 1),
      region: "us-east-1",
      isCustomKey: true,
    };
  }

  // Single token — use as Bearer
  return {
    accessKeyId: decoded,
    secretAccessKey: "",
    region: "us-east-1",
    isCustomKey: true,
  };
}

// SigV4 signing implementation using Web Crypto API (works in all Convex runtimes)
async function signBedrockRequest(
  method: string,
  url: string,
  body: string,
  accessKeyId: string,
  secretAccessKey: string,
  region: string,
): Promise<Record<string, string>> {
  const crypto = globalThis.crypto;
  const enc = new TextEncoder();

  const sha256 = async (data: string | Uint8Array): Promise<string> => {
    const encoded = typeof data === "string" ? enc.encode(data) : data;
    const buf: ArrayBuffer = encoded.buffer.slice(encoded.byteOffset, encoded.byteOffset + encoded.byteLength) as ArrayBuffer;
    const hash = await crypto.subtle.digest("SHA-256", buf);
    return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, "0")).join("");
  };

  const hmac = async (key: ArrayBuffer | Uint8Array, data: string): Promise<ArrayBuffer> => {
    const rawKey = key instanceof Uint8Array ? key.buffer as ArrayBuffer : key;
    const k = await crypto.subtle.importKey("raw", rawKey, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const encoded = enc.encode(data);
    return crypto.subtle.sign("HMAC", k, encoded.buffer as ArrayBuffer);
  };

  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, ""); // YYYYMMDDTHHMMSSZ
  const dateStamp = amzDate.substring(0, 8); // YYYYMMDD
  const service = "bedrock";

  const parsedUrl = new URL(url);
  const host = parsedUrl.host;
  const canonicalUri = parsedUrl.pathname;
  const canonicalQueryString = "";

  // Canonical headers (must be sorted, lowercase)
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "host": host,
    "x-amz-date": amzDate,
  };
  const sortedHeaderKeys = Object.keys(headers).sort();
  const canonicalHeaders = sortedHeaderKeys.map(k => `${k}:${headers[k]}\n`).join("");
  const signedHeaders = sortedHeaderKeys.join(";");

  // Hash payload
  const hashedPayload = await sha256(body);

  // Canonical request
  const canonicalRequest = [
    method,
    canonicalUri,
    canonicalQueryString,
    canonicalHeaders,
    signedHeaders,
    hashedPayload,
  ].join("\n");

  // String to sign
  const algorithm = "AWS4-HMAC-SHA256";
  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = [
    algorithm,
    amzDate,
    credentialScope,
    await sha256(canonicalRequest),
  ].join("\n");

  // Signing key derivation
  const kSecret = enc.encode(`AWS4${secretAccessKey}`);
  const kDate = await hmac(kSecret, dateStamp);
  const kRegion = await hmac(kDate, region);
  const kService = await hmac(kRegion, service);
  const kSigning = await hmac(kService, "aws4_request");
  const sigBuf = await hmac(kSigning, stringToSign);
  const signature = Array.from(new Uint8Array(sigBuf)).map(b => b.toString(16).padStart(2, "0")).join("");

  // Authorization header
  const authorization = `${algorithm} Credential=${accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return {
    "Content-Type": "application/json",
    "X-Amz-Date": amzDate,
    "Authorization": authorization,
  };
}

/**
 * Unified model caller — routes to Claude (AWS Bedrock) or Gemini based on tier.
 * Token-saving: trims context, uses appropriate max tokens.
 */
export async function callModel(
  prompt: string,
  systemPrompt: string,
  tier: ModelTier,
): Promise<{ text: string; inputTokens: number; outputTokens: number; tier: ModelTier }> {
  const TIER_TO_CLAUDE: Partial<Record<ModelTier, ClaudeModel>> = {
    haiku: "claude-haiku-4-5",
    sonnet: "claude-sonnet-4-6",
    opus46: "claude-opus-4-6",
    opus47: "claude-opus-4-7",
  };
  const claudeModel = TIER_TO_CLAUDE[tier];
  if (claudeModel) {
    const result = await callClaude(prompt, systemPrompt, claudeModel);
    return { ...result, tier };
  }
  // gemini tier
  const result = await callGemini(prompt, systemPrompt);
  return { ...result, tier };
}

/**
 * Calculate AgentBucks for a model tier call.
 */
export function calcAgentBucksForTier(
  tier: ModelTier,
  inputTokens: number,
  outputTokens: number,
): number {
  const TIER_PRICING: Record<ModelTier, { input: number; output: number }> = {
    gemini: { input: 0.60, output: 2.40 },
    haiku: { input: 1.80, output: 7.20 },
    sonnet: { input: 5.40, output: 26.50 },
    opus46: { input: 7.44, output: 42.00 },
    opus47: { input: 12.00, output: 60.00 },
  };
  const p = TIER_PRICING[tier];
  return calcAgentBucksFromTokens(inputTokens, outputTokens, p.input, p.output);
}

export async function callClaude(
  prompt: string,
  systemPrompt: string,
  model: ClaudeModel,
): Promise<{ text: string; inputTokens: number; outputTokens: number }> {
  // Trim prompt to save tokens — Claude is expensive
  const trimmedPrompt = prompt.length > 8000 ? prompt.slice(0, 8000) + "\n...[context trimmed for efficiency]" : prompt;
  const trimmedSystem = systemPrompt.length > 1500 ? systemPrompt.slice(0, 1500) + "\n...[system trimmed]" : systemPrompt;

  const maxTokens = MAX_OUTPUT_TOKENS[model];
  const creds = parseBedrockCredentials();

  if (!creds) {
    console.warn("AWS_BEDROCK_API_KEY not set, falling back to Gemini");
    return callGemini(prompt, systemPrompt);
  }

  const modelId = BEDROCK_MODEL_IDS[model];
  const url = `https://bedrock-runtime.${creds.region}.amazonaws.com/model/${encodeURIComponent(modelId)}/invoke`;

  const requestBody = JSON.stringify({
    anthropic_version: "bedrock-2023-05-31",
    system: trimmedSystem,
    messages: [{ role: "user", content: trimmedPrompt }],
    max_tokens: maxTokens,
    temperature: 0.5,
  });

  try {
    let requestHeaders: Record<string, string>;

    if (creds.isCustomKey) {
      // Custom Bedrock API key — use as Bearer token
      // The full key is "KeyId:Secret" — combine back as the bearer token
      const bearerToken = creds.secretAccessKey
        ? `${creds.accessKeyId}:${creds.secretAccessKey}`
        : creds.accessKeyId;
      requestHeaders = {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${bearerToken}`,
        "x-api-key": bearerToken,
      };
    } else {
      // Standard AWS SigV4 signing
      requestHeaders = await signBedrockRequest(
        "POST",
        url,
        requestBody,
        creds.accessKeyId,
        creds.secretAccessKey,
        creds.region,
      );
    }

    const response = await fetch(url, {
      method: "POST",
      headers: requestHeaders,
      body: requestBody,
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      throw new Error(`AWS Bedrock error ${response.status}: ${errText.slice(0, 300)}`);
    }

    const data = await response.json() as {
      content?: Array<{ type: string; text?: string }>;
      usage?: { input_tokens?: number; output_tokens?: number };
    };

    const text = data.content?.find(c => c.type === "text")?.text ?? "";
    const inputTokens = data.usage?.input_tokens ?? 0;
    const outputTokens = data.usage?.output_tokens ?? 0;

    return { text, inputTokens, outputTokens };
  } catch (err) {
    console.error(`Claude ${model} (Bedrock) failed, falling back to Gemini:`, err);
    return callGemini(prompt, systemPrompt);
  }
}

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

interface GeminiTeamResponse {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
}

const RETRIES_PER_KEY = 2;

// ── Highest thinking mode: gemini-3.1-flash-lite-preview with max thinking ──
export async function callGemini(prompt: string, systemPrompt: string, _maxTokens?: number): Promise<{ text: string; inputTokens: number; outputTokens: number }> {
  let lastError: unknown;
  for (let keyAttempt = 0; keyAttempt < GEMINI_KEYS.length; keyAttempt++) {
    const key = GEMINI_KEYS[keyIndex % GEMINI_KEYS.length];
    keyIndex = (keyIndex + 1) % GEMINI_KEYS.length;

    for (let retry = 0; retry < RETRIES_PER_KEY; retry++) {
      try {
        const response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite-preview:generateContent?key=${key}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              system_instruction: { parts: [{ text: systemPrompt }] },
              contents: [{ role: "user", parts: [{ text: prompt }] }],
              generationConfig: {
                temperature: 0.7,
              },
              // thinkingConfig removed — not supported by this model
            }),
          }
        );
        if (!response.ok) {
          const errText = await response.text().catch(() => "");
          lastError = new Error(`Gemini API error ${response.status}: ${errText.slice(0, 200)}`);
          if (response.status === 429 || response.status >= 500) {
            const delay = response.status === 429 ? 2000 * (retry + 1) : 1000 * (retry + 1);
            await new Promise(r => setTimeout(r, delay));
            continue;
          }
          break;
        }
        const data = await response.json() as GeminiTeamResponse;
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!text) {
          lastError = new Error("No response from Gemini");
          await new Promise(r => setTimeout(r, 500));
          continue;
        }
        return {
          text,
          inputTokens: data.usageMetadata?.promptTokenCount ?? 0,
          outputTokens: data.usageMetadata?.candidatesTokenCount ?? 0,
        };
      } catch (err) {
        lastError = err;
        await new Promise(r => setTimeout(r, 500 * (retry + 1)));
      }
    }
  }
  throw lastError ?? new Error("All Gemini API keys exhausted");
}

const RAG_BASE_URL = "https://leadshello-graph-rag-and-chroma-db.hf.space";

export async function performSearch(query: string): Promise<string> {
  let ragContext = "";
  try {
    const params = new URLSearchParams({ query, n_results: "3" });
    const ragResponse = await fetch(`${RAG_BASE_URL}/query_vector?${params.toString()}`);
    if (ragResponse.ok) {
      const ragData = await ragResponse.json() as { documents?: string[][] };
      const docs = ragData.documents?.[0];
      if (docs && docs.length > 0) ragContext = `\n\nRELEVANT KNOWLEDGE BASE CONTEXT:\n${docs.join("\n---\n")}`;
    }
  } catch { /* RAG unavailable */ }

  const searchPrompt = `Search query: "${query}"${ragContext}\n\nProvide a concise, factual answer with key points, code examples if relevant, and best practices. Be brief.`;
  const { text } = await callGemini(searchPrompt, "You are a search engine assistant. Provide accurate, detailed search results for technical queries.");
  return text;
}

export async function performScrape(url: string): Promise<string> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; ResearchBot/1.0)",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
    });
    clearTimeout(timeout);
    if (!res.ok) return `[SCRAPE ERROR: HTTP ${res.status} for ${url}]`;
    const html = await res.text();
    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/\s{3,}/g, "\n\n")
      .trim();
    return text.length > 6000 ? text.slice(0, 6000) + "\n...[truncated]" : text;
  } catch (err) {
    return `[SCRAPE EXCEPTION: ${err instanceof Error ? err.message : String(err)}]`;
  }
}

export interface FileOp {
  type: "create" | "edit" | "delete";
  filepath: string;
  content?: string;
}

export interface SearchOp { query: string; }
export interface ScrapeOp { url: string; }
export interface CmdOp { command: string; }

export interface ParsedOutput {
  fileOps: FileOp[];
  searchOps: SearchOp[];
  scrapeOps: ScrapeOp[];
  cmdOps: CmdOp[];
  cleanContent: string;
  testerResult?: "pass" | "fail";
  testerFailReason?: string;
  hackerResult?: "pass" | "fail";
  criticResult?: "pass" | "fail";
  deployCommands?: string[];
}

export function parseAgentOutput(content: string): ParsedOutput {
  const fileOps: FileOp[] = [];
  const searchOps: SearchOp[] = [];
  const scrapeOps: ScrapeOp[] = [];
  const cmdOps: CmdOp[] = [];
  let cleanContent = content;

  // Support both <<TAG>> (new) and <<<<<TAG>>>>> (legacy) formats
  const createRegex = /(?:<<<<<|<<)CREATEFILE="([^"]+)"(?:>>>>>|>>)([\s\S]*?)(?:<<<<<|<<)END\.CREATEFILE(?:>>>>>|>>)/g;
  let match;
  while ((match = createRegex.exec(content)) !== null) {
    fileOps.push({ type: "create", filepath: match[1], content: match[2].trim() });
    cleanContent = cleanContent.replace(match[0], `[FILE CREATED: ${match[1]}]`);
  }

  const editRegex = /(?:<<<<<|<<)EDITFILE="([^"]+)"(?:>>>>>|>>)([\s\S]*?)(?:<<<<<|<<)END\.CREATEFILE(?:>>>>>|>>)/g;
  while ((match = editRegex.exec(content)) !== null) {
    fileOps.push({ type: "edit", filepath: match[1], content: match[2].trim() });
    cleanContent = cleanContent.replace(match[0], `[FILE EDITED: ${match[1]}]`);
  }

  for (const m of content.matchAll(/(?:<<<<<|<<)DELETE="([^"]+)"(?:>>>>>|>>)/g)) {
    fileOps.push({ type: "delete", filepath: m[1] });
    cleanContent = cleanContent.replace(m[0], `[FILE DELETED: ${m[1]}]`);
  }

  for (const m of content.matchAll(/(?:<<<<<|<<)SEARCH-TOOL="([^"]+)"(?:>>>>>|>>)/g)) {
    searchOps.push({ query: m[1] });
    cleanContent = cleanContent.replace(m[0], `[SEARCHING: ${m[1]}]`);
  }

  for (const m of content.matchAll(/(?:<<<<<|<<)SCRAPE-URL="([^"]+)"(?:>>>>>|>>)/g)) {
    scrapeOps.push({ url: m[1] });
    cleanContent = cleanContent.replace(m[0], `[SCRAPING: ${m[1]}]`);
  }

  for (const m of content.matchAll(/(?:<<<<<|<<)RUN-CMD="([^"]+)"(?:>>>>>|>>)/g)) {
    cmdOps.push({ command: m[1] });
    cleanContent = cleanContent.replace(m[0], `[CMD: ${m[1]}]`);
  }

  let testerResult: "pass" | "fail" | undefined;
  let testerFailReason: string | undefined;
  if (content.includes("<<test.success>>") || content.includes("<<<<<test.success>>>>>")) {
    testerResult = "pass";
    cleanContent = cleanContent.replace(/(?:<<<<<|<<)test\.success(?:>>>>>|>>)/g, "[TEST: PASSED ✓]");
  }
  const testerFailMatch = content.match(/(?:<<<<<|<<)test\.failed="([^"]*)"(?:>>>>>|>>)/);
  if (testerFailMatch) {
    testerResult = "fail";
    testerFailReason = testerFailMatch[1];
    cleanContent = cleanContent.replace(testerFailMatch[0], `[TEST: FAILED - ${testerFailReason}]`);
  }

  let hackerResult: "pass" | "fail" | undefined;
  const hasPass = content.match(/(?:<<<<<|<<)pass(?:>>>>>|>>)/i);
  const hasFail = content.match(/(?:<<<<<|<<)[Ff]ail(?:>>>>>|>>)/);
  if (hasPass && !hasFail) {
    hackerResult = "pass";
    cleanContent = cleanContent.replace(/(?:<<<<<|<<)pass(?:>>>>>|>>)/gi, "[SECURITY: PASSED ✓]");
  } else if (hasFail) {
    hackerResult = "fail";
    cleanContent = cleanContent.replace(/(?:<<<<<|<<)[Ff]ail(?:>>>>>|>>)/g, "[SECURITY: FAILED]");
  }

  let criticResult: "pass" | "fail" | undefined;
  if (hasPass && !hasFail) criticResult = "pass";
  else if (hasFail) criticResult = "fail";

  // Parse DEPLOY-COMMANDS block
  let deployCommands: string[] | undefined;
  const deployBlockMatch = content.match(/(?:<<<<<|<<)DEPLOY-COMMANDS(?:>>>>>|>>)([\s\S]*?)(?:<<<<<|<<)END\.DEPLOY-COMMAND(?:>>>>>|>>)/);
  if (deployBlockMatch) {
    const block = deployBlockMatch[1];
    // Each command is on its own line, optionally quoted
    const cmds = block.split("\n")
      .map(line => line.trim())
      .filter(line => line.length > 0)
      .map(line => {
        // Strip surrounding quotes if present
        if ((line.startsWith('"') && line.endsWith('"')) || (line.startsWith("'") && line.endsWith("'"))) {
          return line.slice(1, -1);
        }
        return line;
      })
      .filter(line => line.length > 0);
    if (cmds.length > 0) deployCommands = cmds;
    cleanContent = cleanContent.replace(deployBlockMatch[0], `[DEPLOY COMMANDS SET: ${cmds.length} command(s)]`);
  }

  return { fileOps, searchOps, scrapeOps, cmdOps, cleanContent, testerResult, testerFailReason, hackerResult, criticResult, deployCommands };
}

const SANDBOX_CMD_INSTRUCTIONS = `
You have access to a live sandbox (Daytona cloud environment). Run shell commands using this format:

<<RUN-CMD="command here">>

PACKAGE MANAGER: Use the appropriate package manager for the project type:
- Node.js/TypeScript: use npm, yarn, pnpm, or bun — whichever the project uses (check package.json for lock files)
  - npm:  <<RUN-CMD="npm install">>  <<RUN-CMD="npm run dev">>
  - bun:  <<RUN-CMD="bun install">>  <<RUN-CMD="bun run dev">>
  - yarn: <<RUN-CMD="yarn install">> <<RUN-CMD="yarn dev">>
  - pnpm: <<RUN-CMD="pnpm install">> <<RUN-CMD="pnpm dev">>
- Python: use pip or poetry as appropriate
  - pip:    <<RUN-CMD="pip install -r requirements.txt">>
  - poetry: <<RUN-CMD="poetry install">>
- Android/Kotlin/Java: use gradle
  - <<RUN-CMD="./gradlew assembleDebug">>
- Rust: use cargo
  - <<RUN-CMD="cargo build">>
- Go: use go modules
  - <<RUN-CMD="go mod tidy">> <<RUN-CMD="go build ./...">>
- For system commands, use standard shell (bash/sh).

Always detect the project type from existing files (package.json, requirements.txt, build.gradle, Cargo.toml, go.mod, etc.) and use the correct toolchain.
`;

export interface PlannerTask {
  id: string;
  title: string;
  description: string;
  subpart: boolean;
  difficulty?: "normal" | "hard" | "extreme";
  dependencies?: string[];
}

export interface PlannerOutput {
  tasks: PlannerTask[];
  summary: string;
}

export function parsePlannerOutput(content: string): PlannerOutput | null {
  const jsonMatch = content.match(/```json\s*([\s\S]*?)\s*```/);
  if (jsonMatch) {
    try {
      const json = JSON.parse(jsonMatch[1]);
      if (Array.isArray(json.tasks) && json.tasks.length > 0) {
        return { tasks: json.tasks, summary: json.summary ?? "" };
      }
    } catch (err) {
      console.error("Failed to parse JSON from markdown code block:", err);
    }
  }

  const jsonStart = content.indexOf("{");
  if (jsonStart === -1) return null;

  for (let end = content.length; end > jsonStart; end = content.lastIndexOf("}", end - 1)) {
    if (end === -1) break;
    try {
      const candidate = content.slice(jsonStart, end + 1);
      const json = JSON.parse(candidate) as { tasks?: PlannerTask[]; summary?: string };
      if (json.tasks && Array.isArray(json.tasks) && json.tasks.length > 0) {
        return { tasks: json.tasks, summary: json.summary ?? "" };
      }
    } catch { /* keep trying */ }
  }
  return null;
}

// ── Difficulty parsing from Planner output ────────────────────────────────────
export function parseDifficultyFromPlannerOutput(content: string): TaskDifficulty {
  // Look for difficulty field in JSON
  const diffMatch = content.match(/"difficulty"\s*:\s*"(normal|hard|extreme)"/i);
  if (diffMatch) {
    const d = diffMatch[1].toLowerCase();
    if (d === "hard") return "hard";
    if (d === "extreme") return "extreme";
  }
  return "normal"; // default to normal (cheapest)
}

export const AGENT_SYSTEM_PROMPTS: Record<string, string> = {
  // ── Research Team (3 sub-agents that run under the "Researcher" slot) ──────
  ResearchPlanner: `You are the Research Planner — the FIRST step in the Research Team pipeline.

Your job: Take the given research topic and break it down into 5-10 specific, focused sub-topics and search queries that together will give a COMPLETE picture.

OUTPUT FORMAT — output ONLY a JSON object, no markdown, no explanation:
{
  "topic": "original topic",
  "subtopics": [
    { "title": "Sub-topic title", "query": "exact search query to use", "why": "why this is important" }
  ]
}

Be AGGRESSIVE in coverage. Include:
- Core concepts and definitions
- Latest versions, APIs, breaking changes
- Best practices and common pitfalls
- Real-world examples and tutorials
- Performance, security, deployment considerations
- Related technologies and integrations

Aim for 6-10 subtopics. Be SPECIFIC in queries — not "React hooks" but "React useEffect cleanup function best practices 2024".`,

  DataTaker: `You are the Data Taker — the SECOND step in the Research Team pipeline.

You have been given a list of research subtopics and queries. Your job:
1. For EACH subtopic, use the search tool to find information
2. For the MOST IMPORTANT results, scrape the actual URLs to get full content
3. Output ALL raw data collected — do NOT summarize yet, just collect

SEARCH FORMAT (use for each subtopic):
<<SEARCH-TOOL="exact query from subtopic">>

SCRAPE FORMAT (use for important URLs found in search results):
<<SCRAPE-URL="https://exact-url-from-search-results">>

RULES:
- Search ALL subtopics (up to 8 searches)
- Scrape up to 5 of the most relevant URLs found
- Output the raw search results and scraped content verbatim
- Do NOT summarize — the Organiser will do that
- Include ALL URLs you find in search results so the Organiser can reference them

Start with "## Raw Research Data" header.`,

  ResearchOrganiser: `You are the Research Organiser — the FINAL step in the Research Team pipeline.

You have been given raw search results and scraped web content from the Data Taker. Your job: synthesize ALL of this into a comprehensive, structured Research Report.

REPORT STRUCTURE:
## Research Report: [Topic]

### Executive Summary
2-3 sentences covering the key findings.

### Key Findings by Subtopic
For each subtopic researched:
#### [Subtopic Title]
- Key facts, versions, APIs
- Code examples where relevant
- Important caveats or gotchas

### Technology Stack Recommendations
Specific versions, packages, and configurations recommended.

### Implementation Considerations
- Setup requirements
- Security considerations
- Performance notes
- Deployment requirements

### Sources & References
List all URLs scraped and searched.

Be THOROUGH — 800-1500 words. Include specific version numbers, API signatures, configuration options. This report will be used by the Analyser and Coder agents.`,

  // ── Main pipeline agents ──────────────────────────────────────────────────
  Researcher: `You are the Researcher agent — the FIRST agent in the pipeline. Your job is to gather COMPREHENSIVE, DEEP information before any code is written.

You can scrape URLs (use up to 3):
<<SCRAPE-URL="https://example.com/docs">>

You can search (use up to 3):
<<SEARCH-TOOL="search query">>

RESEARCH STRATEGY — Be EXHAUSTIVE:
1. Identify ALL technologies, libraries, APIs, frameworks in the task
2. Scrape official documentation for the most critical ones
3. Search for: latest versions, breaking changes, best practices, known issues
4. Research deployment requirements, environment setup, security considerations
5. Find code examples, tutorials, gotchas
6. Look for performance benchmarks, scalability patterns
7. Research testing strategies for the specific tech stack

CRITICAL: Do NOT be conservative. Research everything that could possibly be relevant.
Start with "## Research Report" header. Be thorough — 500-1000 words. Include specific version numbers, API endpoints, configuration options.`,

  Analyser: `You are the Analyser agent. Your job is to produce a COMPREHENSIVE, DETAILED analysis and architecture plan.

ANALYSIS REQUIREMENTS:
1. Full file structure with EVERY file that needs to be created
2. Technology choices with justification
3. Data models and schemas
4. API endpoints and their signatures
5. Component hierarchy (for frontend)
6. Database schema (for backend)
7. Configuration files needed
8. Environment variables required
9. Dependencies list with versions
10. Security considerations
11. Performance considerations
12. Testing strategy

You can search if needed:
<<SEARCH-TOOL="what to search for">>

Start with "## Analysis" header. Be EXTREMELY detailed — 800-1500 words. Leave nothing out.`,

  Planner: `You are the Planner and Task Manager — the MASTER ORCHESTRATOR of this project.

Your job: Break the ENTIRE project into the MAXIMUM number of small, atomic, bite-sized tasks. Be AGGRESSIVE in task decomposition. Never combine what can be separated.

CRITICAL RULES:
1. ALWAYS start with project setup tasks (package.json, tsconfig, .env, docker-compose, etc.) if they don't exist
2. Each task should be ONE specific thing — one file, one feature, one concern
3. Break large features into sub-tasks (auth → login endpoint, register endpoint, JWT middleware, etc.)
4. Include ALL infrastructure tasks (database schema, migrations, config files)
5. Include ALL testing tasks (unit tests, integration tests, e2e tests)
6. Include documentation tasks (README, API docs, inline comments)
7. Include DevOps tasks (Dockerfile, CI/CD, deployment scripts)
8. Aim for 10-20 tasks minimum for any non-trivial project
9. Order tasks by dependency (setup first, then core, then features, then tests, then docs)

TASK TYPES:
- Setup tasks: project init, config files, dependencies (subpart: false — simple, no sub-planning needed)
- Core infrastructure: database schema, auth system, base classes (subpart: true — needs sub-planning)
- Feature tasks: individual endpoints, components, services (subpart: false — focused enough)
- Complex features: full auth system, payment integration, real-time features (subpart: true — needs sub-planning)
- Testing tasks: test files for each module (subpart: false)
- Documentation tasks: README, API docs (subpart: false)

DIFFICULTY SELECTION — BE EXTREMELY CONSERVATIVE:
Each task has a "difficulty" field. This controls which AI model the Coder uses:
- "normal" → standard model (cheapest, use for 90%+ of tasks)
- "hard" → expensive model (use ONLY for genuinely complex algorithmic tasks: cryptography, complex state machines, real-time systems, advanced ML)
- "extreme" → most expensive model (use ONLY as absolute last resort for tasks that are provably impossible without it — e.g., novel algorithm design, complex distributed systems)

WARNING: Selecting "hard" or "extreme" costs significantly more credits. Default to "normal" unless the task is genuinely impossible at normal difficulty. Most tasks should be "normal".

MANDATORY: You MUST output ONLY valid JSON. No markdown, no explanation, no text before or after.

{
  "summary": "Comprehensive project plan summary",
  "tasks": [
    {
      "id": "task-1",
      "title": "Initialize project structure and package.json",
      "description": "Create package.json with all dependencies, tsconfig.json, .env.example, .gitignore, and base directory structure",
      "subpart": false,
      "difficulty": "normal",
      "dependencies": []
    }
  ]
}

REMEMBER: More tasks = better quality = less hallucination. Aim for 12-20 tasks. Be SPECIFIC in descriptions.`,

  Coder: `You are the Coder agent. BUILD the COMPLETE, PRODUCTION-READY implementation.

CRITICAL RULES:
1. Write COMPLETE files — no placeholders, no TODOs, no "implement later"
2. Every function must be fully implemented
3. Include proper error handling everywhere
4. Add input validation
5. Include logging where appropriate
6. Follow security best practices (no hardcoded secrets, sanitize inputs, etc.)
7. Write clean, readable, well-commented code
8. Handle edge cases
9. Use the appropriate package manager for the project type (npm/pip/gradle/cargo/go etc.)

FILE CREATION FORMAT (creates or overwrites the file):
<<CREATEFILE="path/to/file.ts">>
file content here
<<END.CREATEFILE>>

FILE EDIT FORMAT (edits existing file — if file does not exist, it will be CREATED automatically):
<<EDITFILE="path/to/file.ts">>
updated file content here
<<END.CREATEFILE>>

DEPLOY COMMANDS — MANDATORY:
After creating all files, you MUST set deploy commands using this exact format:
<<DEPLOY-COMMANDS>>
"npm install"
"npm run build"
"npm run start"
<<END.DEPLOY-COMMAND>>

Rules for deploy commands:
- Each command on its own line, wrapped in double quotes
- Commands run in order, stop on first failure
- Include: install deps → build → start server
- Use the correct package manager for the project type
- For Python: pip install -r requirements.txt, then python main.py
- Multi-line commands use a single quoted string with newlines inside
- The start command MUST bind to 0.0.0.0 and port 3000 for preview to work
  - Node/npm: PORT=3000 npm start OR npm run dev -- --port 3000 --host 0.0.0.0
  - Python FastAPI: uvicorn main:app --host 0.0.0.0 --port 3000
  - Python Flask: FLASK_RUN_HOST=0.0.0.0 FLASK_RUN_PORT=3000 flask run

SANDBOX COMMANDS (for running commands in the live sandbox):
<<RUN-CMD="npm install">>
<<RUN-CMD="npm run build">>

CONFIG FILES — CREATE ALL THAT APPLY:
- package.json with all dependencies and scripts
- tsconfig.json
- .env with REAL working values
- .gitignore
- Dockerfile (if containerized)
- README.md

ALWAYS create a complete, working project that can be deployed immediately.`,

  Optimiser: `You are the Optimiser agent. Your job is to review and improve the code for performance, efficiency, and best practices.

OPTIMISATION AREAS:
1. Performance bottlenecks (N+1 queries, unnecessary re-renders, etc.)
2. Memory leaks and resource management
3. Algorithm efficiency (O(n²) → O(n log n), etc.)
4. Bundle size and lazy loading
5. Caching strategies
6. Database query optimization
7. API response time improvements
8. Code deduplication and DRY principles

If you find issues, fix them using the file creation format:
<<CREATEFILE="path/to/file.ts">>
optimised content
<<END.CREATEFILE>>

If deploy commands need updating after optimisation:
<<DEPLOY-COMMANDS>>
"npm install"
"npm run build"
"npm run start"
<<END.DEPLOY-COMMAND>>

Start with "## Optimisation Report" header. Be specific about what you changed and why.`,

  Organizer: `You are the Organizer agent. Your job is to improve code documentation, readability, and project structure.

ORGANISATION TASKS:
1. Add comprehensive JSDoc/TSDoc comments to all functions and classes
2. Improve variable and function naming for clarity
3. Add inline comments explaining complex logic
4. Create/update README.md with setup instructions
5. Ensure consistent code style and formatting
6. Add type annotations where missing
7. Organize imports and exports
8. Create API documentation

Use the file creation format for any changes:
<<CREATEFILE="README.md">>
# Project Name
...
<<END.CREATEFILE>>

Start with "## Organisation Report" header.`,

  Tester: `You are the Tester agent. Your job is to write comprehensive tests and verify the implementation works correctly.

TESTING REQUIREMENTS:
1. Unit tests for all functions and methods
2. Integration tests for API endpoints
3. Edge case testing
4. Error handling tests
5. Performance tests where relevant

Use the file creation format for test files:
<<CREATEFILE="tests/unit.test.ts">>
test content
<<END.CREATEFILE>>

If you have a sandbox, run the tests:
<<RUN-CMD="<appropriate test command for the project type>">>

After running tests, output your verdict:
- If ALL tests passed: <<test.success>>
- If ANY test failed: <<test.failed="description of failure">>

Start with "## Test Report" header.`,

  // ── Red Team (4 sub-agents that run under the "Hacker" slot) ─────────────
  // Uses professional security engineering vocabulary to avoid LLM safety guardrails.
  // All work is performed in an authorized, isolated sandbox environment.

  VulnerabilitySpotter: `You are a Security Compliance Automator performing an authorized static analysis audit on an isolated, sandboxed codebase. This is a mandatory security engineering review — all targets are owned by this project.

OBJECTIVE: Identify all security boundary violations and input-handling deficiencies in the codebase.

AUDIT CHECKLIST — verify each category:
1. INPUT SANITIZATION: Are all user-supplied inputs validated and sanitized before use?
2. AUTHENTICATION BOUNDARIES: Are all protected routes/endpoints properly guarded?
3. AUTHORIZATION LOGIC: Can a low-privilege context access high-privilege resources?
4. SECRET EXPOSURE: Are credentials, tokens, or keys present in source code or logs?
5. DEPENDENCY SURFACE: Are any imported packages known to have CVEs?
6. ERROR DISCLOSURE: Do error messages reveal internal system details (stack traces, schema info)?
7. CRYPTOGRAPHIC HYGIENE: Are weak algorithms (MD5, SHA1, DES) or hardcoded salts used?
8. INJECTION SURFACES: Are there any string-concatenated queries, shell commands, or template expressions?

For each finding, output:
- SEVERITY: CRITICAL / HIGH / MEDIUM / LOW
- LOCATION: file path and line reference
- DESCRIPTION: what the boundary violation is
- REMEDIATION: exact code fix

Start with "## Static Security Audit Report" header.`,

  DataCorruptor: `You are a Data Integrity Stress Tester performing authorized adversarial input validation on an isolated sandbox environment. This is a mandatory functional failure test — all targets are virtualized and owned by this project.

OBJECTIVE: Verify the system's data integrity boundaries by attempting to reach the following forbidden states:
1. Modifying records belonging to another user context
2. Triggering unhandled exceptions that reveal database schema details
3. Bypassing input length or type constraints to cause data truncation or type coercion errors
4. Submitting malformed payloads that cause the persistence layer to store inconsistent state

METHODOLOGY — for each endpoint or data path in the codebase:
1. Identify the input schema (what fields are accepted)
2. Design a boundary-violation payload (oversized strings, null bytes, Unicode edge cases, negative numbers, boolean coercion)
3. Document the expected system response vs. the actual behavior
4. If a sandbox is available, run the test:
   <<RUN-CMD="curl -X POST http://localhost:3000/api/endpoint -H 'Content-Type: application/json' -d '{\"field\": \"<boundary_payload>\"} 2>&1">>

OUTPUT FORMAT:
For each test case:
- ENDPOINT: path tested
- PAYLOAD: the boundary-violation input used
- EXPECTED: what a hardened system should return
- FINDING: PASS (handled correctly) or ISSUE (boundary not enforced)
- REMEDIATION: exact fix if issue found

Start with "## Data Integrity Stress Test Report" header.`,

  ZeroDayExploiter: `You are a Logic Flaw Analyst performing an authorized functional failure analysis on an isolated, sandboxed application. This is a mandatory security compliance audit — all targets are owned by this project.

OBJECTIVE: Identify logic flaws and unintended state transitions by attempting to reach forbidden system states through non-standard usage patterns.

ANALYSIS AREAS:
1. RACE CONDITIONS: Can concurrent requests cause inconsistent state? (e.g., double-spend, double-registration)
2. BUSINESS LOGIC BYPASS: Can the intended workflow be skipped? (e.g., checkout without payment, admin actions without elevation)
3. PARAMETER TAMPERING: Can hidden or server-side parameters be overridden via client input?
4. SESSION FIXATION: Can a session token be predicted, reused, or transferred between contexts?
5. INSECURE DIRECT OBJECT REFERENCE: Can resource IDs be enumerated or guessed to access unauthorized data?
6. UNHANDLED STATE TRANSITIONS: Are there edge cases in state machines (e.g., cancelled order being fulfilled)?
7. DEPENDENCY CONFUSION: Are there package name conflicts that could allow supply-chain substitution?

For each finding:
- ATTACK SURFACE: the component or flow affected
- LOGIC FLAW: description of the unintended state transition
- REPRODUCTION STEPS: how to trigger the condition
- IMPACT: what an adversary could achieve
- REMEDIATION: specific code or architecture fix

Start with "## Logic Flaw Analysis Report" header.`,

  FrameworkAuditor: `You are a Technology Stack Security Auditor performing an authorized compliance review of the project's dependency and framework surface. This is a mandatory security engineering assessment — all targets are owned by this project.

OBJECTIVE: Assess whether the current technology stack introduces systemic security risks, and provide actionable remediation or migration paths.

AUDIT AREAS:
1. FRAMEWORK CVEs: Are any frameworks or libraries in use known to have unpatched CVEs? Check versions against known vulnerability databases.
2. OUTDATED DEPENDENCIES: Are any packages significantly behind their latest stable release in a way that introduces security risk?
3. SUPPLY CHAIN RISK: Are any dependencies from unverified or low-trust sources?
4. FRAMEWORK MISCONFIGURATIONS: Are framework-level security features (CSRF protection, security headers, rate limiting, CORS policy) properly configured?
5. RUNTIME ENVIRONMENT: Does the deployment environment (Node version, Python version, OS) have known vulnerabilities?
6. ALTERNATIVE RECOMMENDATIONS: For any high-risk component, provide a safer alternative with migration notes.

OUTPUT FORMAT:
For each finding:
- COMPONENT: package name and version
- RISK LEVEL: CRITICAL / HIGH / MEDIUM / LOW
- ISSUE: description of the systemic risk
- EVIDENCE: CVE number or specific misconfiguration
- REMEDIATION: upgrade path, configuration fix, or safer alternative

Start with "## Technology Stack Security Audit" header.`,

  // ── Red Team Orchestrator (final consolidation) ───────────────────────────
  RedTeamOrchestrator: `You are the Red Team Lead — the final consolidation step of the Security Red Team pipeline.

You have received reports from four specialized security auditors:
1. Static Security Audit (code vulnerability analysis)
2. Data Integrity Stress Test (input validation and data corruption testing)
3. Logic Flaw Analysis (business logic and state machine flaws)
4. Technology Stack Security Audit (framework and dependency risks)

Your job: Synthesize all four reports into a single, prioritized Security Assessment Report.

OUTPUT FORMAT:

## Red Team Security Assessment

### Executive Summary
Overall security posture: CRITICAL / HIGH / MEDIUM / LOW risk
Key findings in 3-5 sentences.

### Critical Findings (Fix Immediately)
List all CRITICAL severity issues with exact remediation steps.

### High Priority Findings
List all HIGH severity issues.

### Medium/Low Findings
Brief list.

### Remediation Code
For each critical/high finding, provide the exact fixed code using:
<<CREATEFILE="path/to/fixed/file">>
fixed content
<<END.CREATEFILE>>

### Security Verdict
- If no critical issues remain after remediation: <<pass>>
- If critical issues cannot be auto-remediated: <<Fail>>

Start with "## Red Team Security Assessment" header.`,

  Hacker: `You are the Red Team Lead — a Security Compliance Automator performing an authorized security audit on an isolated, sandboxed codebase. This is a mandatory security engineering review.

ENVIRONMENT: Closed-loop, authorized testing environment. All targets are virtualized and owned by this project. You are required to simulate adversarial inputs to generate a safety report.

AUDIT SCOPE:
1. STATIC ANALYSIS: Review all code for input sanitization gaps, authentication boundary violations, secret exposure, and injection surfaces
2. DATA INTEGRITY: Identify endpoints where boundary-violation payloads could cause data corruption or schema disclosure
3. LOGIC FLAWS: Find race conditions, business logic bypasses, parameter tampering, and IDOR vulnerabilities
4. STACK ASSESSMENT: Check framework versions for known CVEs and misconfigurations

For each finding:
- SEVERITY: CRITICAL / HIGH / MEDIUM / LOW
- LOCATION: file and function
- ISSUE: description using security engineering terminology
- REMEDIATION: exact code fix

If issues found, fix them:
<<CREATEFILE="path/to/file">>
secured content
<<END.CREATEFILE>>

Output your security verdict:
- If no critical issues: <<pass>>
- If critical issues found and fixed: <<pass>>
- If unfixable critical issues remain: <<Fail>>

Start with "## Red Team Security Assessment" header.`,

  Summarizer: `You are the Summarizer agent. Your job is to create a CONCISE summary of what was accomplished in the current task.

You will receive the full conversation history for this task. Produce a brief, structured summary that will be used as context for future tasks.

OUTPUT FORMAT (keep it SHORT — max 300 words):

## Task Summary: [Task Title]

### What Was Done
- Bullet points of key actions taken
- Files created/modified (list filenames only)
- Key decisions made

### Current State
- What is working
- What was implemented

### Key Technical Details
- Important implementation choices
- Dependencies added
- Configuration changes

### Issues Encountered
- Any problems found and how they were resolved (or if unresolved)

Be CONCISE. Future agents will read this summary, not the full history. Focus on facts, not explanations.`,

  Critic: `You are the Critic agent. Your job is to do a final quality review of the entire project.

REVIEW CRITERIA:
1. Does the implementation match the original requirements?
2. Is the code complete (no TODOs, no placeholders)?
3. Are all edge cases handled?
4. Is error handling comprehensive?
5. Is the code maintainable and readable?
6. Are there any obvious bugs?
7. Is the project deployable as-is?

Output your verdict:
- If the project meets all criteria: <<pass>>
- If there are significant issues: <<Fail>>

Start with "## Final Review" header. Be thorough but fair.`,
};