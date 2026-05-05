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
export type ModelTier = "gemini" | "haiku" | "sonnet" | "opus46" | "opus47";

// Default model per agent (Code Mode) — updated per user spec
export const AGENT_MODEL_MAP: Record<string, ModelTier> = {
  // Planning phase
  Researcher: "gemini",          // gemini-3.1-flash-lite
  Analyser: "haiku",             // claude-haiku-4.5 (task analysis uses gemini override in agentTeam.ts)
  Planner: "haiku",              // claude-haiku-4.5
  // Task execution
  Coder: "sonnet",               // claude-sonnet-4.6
  Optimiser: "sonnet",           // claude-sonnet-4.6
  Organizer: "haiku",            // claude-haiku-4.5
  Tester: "sonnet",              // claude-sonnet-4.6
  Summarizer: "gemini",
  // Red Team sub-agents
  VulnerabilitySpotter: "sonnet",    // claude-sonnet-4.6
  DataCorruptor: "sonnet",           // claude-sonnet-4.6
  ZeroDayExploiter: "opus46",        // claude-opus-4.6
  FrameworkAuditor: "sonnet",        // claude-sonnet-4.6
  RedTeamOrchestrator: "gemini",     // gemini-3.1-flash-lite
  // Final review
  Critic: "haiku",               // claude-haiku-4.5
  // Research mode — all gemini
  ResearchPlanner: "gemini",
  DataTaker: "gemini",
  ResearchOrganiser: "gemini",
};

// Difficulty → Coder model override
export const DIFFICULTY_CODER_MODEL: Record<string, ModelTier> = {
  normal: "sonnet",
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

// ── Location-based AWS Bedrock region selection ───────────────────────────────
// Maps IANA timezone to the closest AWS Bedrock region for minimum latency
export function getBedrockRegionForTimezone(timezone: string): string {
  const tz = timezone.toLowerCase();

  // Asia Pacific
  if (tz.includes("asia/kolkata") || tz.includes("asia/calcutta") || tz.includes("asia/dhaka") || tz.includes("asia/karachi") || tz.includes("asia/colombo")) {
    return "ap-south-1"; // Mumbai — closest for South Asia
  }
  if (tz.includes("asia/tokyo") || tz.includes("asia/seoul") || tz.includes("asia/osaka")) {
    return "ap-northeast-1"; // Tokyo
  }
  if (tz.includes("asia/singapore") || tz.includes("asia/kuala_lumpur") || tz.includes("asia/jakarta") || tz.includes("asia/bangkok") || tz.includes("asia/ho_chi_minh") || tz.includes("asia/manila")) {
    return "ap-southeast-1"; // Singapore
  }
  if (tz.includes("australia") || tz.includes("pacific/auckland") || tz.includes("asia/sydney")) {
    return "ap-southeast-2"; // Sydney
  }
  if (tz.includes("asia/shanghai") || tz.includes("asia/hong_kong") || tz.includes("asia/taipei")) {
    return "ap-east-1"; // Hong Kong (fallback to us-east-1 if not available)
  }

  // Europe
  if (tz.includes("europe/london") || tz.includes("europe/dublin") || tz.includes("europe/lisbon") || tz.includes("atlantic/")) {
    return "eu-west-1"; // Ireland
  }
  if (tz.includes("europe/paris") || tz.includes("europe/berlin") || tz.includes("europe/amsterdam") || tz.includes("europe/brussels") || tz.includes("europe/madrid") || tz.includes("europe/rome") || tz.includes("europe/vienna") || tz.includes("europe/zurich") || tz.includes("europe/stockholm") || tz.includes("europe/oslo") || tz.includes("europe/copenhagen") || tz.includes("europe/warsaw") || tz.includes("europe/prague") || tz.includes("europe/budapest")) {
    return "eu-central-1"; // Frankfurt
  }
  if (tz.includes("europe/istanbul") || tz.includes("asia/beirut") || tz.includes("asia/dubai") || tz.includes("asia/riyadh") || tz.includes("asia/kuwait") || tz.includes("asia/bahrain") || tz.includes("asia/qatar") || tz.includes("africa/cairo") || tz.includes("asia/jerusalem") || tz.includes("asia/amman") || tz.includes("asia/baghdad")) {
    return "me-south-1"; // Bahrain (Middle East)
  }

  // Americas
  if (tz.includes("america/new_york") || tz.includes("america/toronto") || tz.includes("america/montreal") || tz.includes("america/boston") || tz.includes("america/chicago") || tz.includes("america/detroit") || tz.includes("america/indiana") || tz.includes("america/kentucky")) {
    return "us-east-1"; // N. Virginia
  }
  if (tz.includes("america/los_angeles") || tz.includes("america/vancouver") || tz.includes("america/seattle") || tz.includes("america/phoenix") || tz.includes("america/denver") || tz.includes("america/boise") || tz.includes("america/las_vegas")) {
    return "us-west-2"; // Oregon
  }
  if (tz.includes("america/sao_paulo") || tz.includes("america/argentina") || tz.includes("america/santiago") || tz.includes("america/lima") || tz.includes("america/bogota") || tz.includes("america/caracas")) {
    return "sa-east-1"; // São Paulo
  }

  // Africa
  if (tz.includes("africa/johannesburg") || tz.includes("africa/nairobi") || tz.includes("africa/lagos") || tz.includes("africa/accra")) {
    return "af-south-1"; // Cape Town
  }

  // Default: us-east-1 (most models available here)
  return "us-east-1";
}

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
  "claude-sonnet-4-6": "us.anthropic.claude-sonnet-4-6",
  "claude-opus-4-6":   "us.anthropic.claude-opus-4-6",
  "claude-opus-4-7":   "us.anthropic.claude-opus-4-7",
};

// Max output tokens per model tier — increased for long reports
const MAX_OUTPUT_TOKENS: Record<ClaudeModel, number> = {
  "claude-haiku-4-5": 8192,
  "claude-sonnet-4-6": 16000,
  "claude-opus-4-6": 16000,
  "claude-opus-4-7": 16000,
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
  userRegion?: string,
): Promise<{ text: string; inputTokens: number; outputTokens: number }> {
  // Increased context limit for long reports — 32k chars
  const trimmedPrompt = prompt.length > 32000 ? prompt.slice(0, 32000) + "\n...[context trimmed for efficiency]" : prompt;
  const trimmedSystem = systemPrompt.length > 4000 ? systemPrompt.slice(0, 4000) + "\n...[system trimmed]" : systemPrompt;

  const maxTokens = MAX_OUTPUT_TOKENS[model];
  const creds = parseBedrockCredentials();

  if (!creds) {
    console.warn("AWS_BEDROCK_API_KEY not set, falling back to Gemini");
    return callGemini(prompt, systemPrompt);
  }

  const region = userRegion || creds.region;
  const modelId = BEDROCK_MODEL_IDS[model];
  const url = `https://bedrock-runtime.${region}.amazonaws.com/model/${encodeURIComponent(modelId)}/invoke`;

  const requestBody = JSON.stringify({
    anthropic_version: "bedrock-2023-05-31",
    system: trimmedSystem,
    messages: [{ role: "user", content: trimmedPrompt }],
    max_tokens: maxTokens,
    temperature: 0.7,
  });

  try {
    let requestHeaders: Record<string, string>;

    if (creds.isCustomKey) {
      const bearerToken = creds.secretAccessKey
        ? `${creds.accessKeyId}:${creds.secretAccessKey}`
        : creds.accessKeyId;
      requestHeaders = {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${bearerToken}`,
        "x-api-key": bearerToken,
      };
    } else {
      requestHeaders = await signBedrockRequest(
        "POST",
        url,
        requestBody,
        creds.accessKeyId,
        creds.secretAccessKey,
        region,
      );
    }

    const response = await fetch(url, {
      method: "POST",
      headers: requestHeaders,
      body: requestBody,
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      if (userRegion && userRegion !== "us-east-1") {
        console.warn(`Bedrock region ${userRegion} failed, falling back to us-east-1`);
        return callClaude(prompt, systemPrompt, model, "us-east-1");
      }
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

Your job: Take the given research topic and break it down into 8-15 specific, focused sub-topics and search queries that together will give a COMPLETE, EXHAUSTIVE picture.

OUTPUT FORMAT — output ONLY a JSON object, no markdown, no explanation:
{
  "topic": "original topic",
  "subtopics": [
    { "title": "Sub-topic title", "query": "exact search query to use", "why": "why this is important" }
  ]
}

Be EXTREMELY AGGRESSIVE in coverage. Include:
- Core concepts, definitions, and history
- Latest versions, APIs, breaking changes, migration guides
- Best practices, anti-patterns, and common pitfalls
- Real-world examples, tutorials, and case studies
- Performance benchmarks, scalability patterns
- Security considerations and known vulnerabilities
- Deployment, DevOps, and infrastructure requirements
- Testing strategies and tooling
- Community resources, GitHub repos, official docs
- Competing technologies and comparison

Aim for 10-15 subtopics. Be HYPER-SPECIFIC in queries — not "React hooks" but "React useEffect cleanup function memory leak prevention 2024 best practices".`,

  DataTaker: `You are the Data Taker — the SECOND step in the Research Team pipeline.

You have been given a list of research subtopics and queries. Your job:
1. For EVERY subtopic, use the search tool to find information
2. For the MOST IMPORTANT results, scrape the actual URLs to get full content
3. Output ALL raw data collected — do NOT summarize yet, just collect EVERYTHING

SEARCH FORMAT (use for EACH subtopic — do not skip any):
<<SEARCH-TOOL="exact query from subtopic">>

SCRAPE FORMAT (use for important URLs found in search results):
<<SCRAPE-URL="https://exact-url-from-search-results">>

RULES:
- Search ALL subtopics (up to 12 searches — use them all)
- Scrape up to 8 of the most relevant URLs found
- Output the raw search results and scraped content verbatim — EVERYTHING
- Do NOT summarize — the Organiser will do that
- Include ALL URLs you find in search results
- If a search returns no results, try a different query variation

Start with "## Raw Research Data" header. Include ALL data collected.`,

  ResearchOrganiser: `You are the Research Organiser — the FINAL step in the Research Team pipeline.

You have been given raw search results and scraped web content from the Data Taker. Your job: synthesize ALL of this into a MASSIVE, COMPREHENSIVE, EXHAUSTIVE Research Report.

THIS REPORT MUST BE AT LEAST 3000-5000 WORDS. SHORT REPORTS ARE FAILURES.

REPORT STRUCTURE:
## Research Report: [Topic]

### Executive Summary
5-8 sentences covering ALL key findings, recommendations, and critical insights.

### Key Findings by Subtopic
For EACH subtopic researched (cover ALL of them):
#### [Subtopic Title]
- Comprehensive explanation (200-400 words per subtopic)
- Specific version numbers, API signatures, configuration options
- Code examples where relevant (full, working examples)
- Important caveats, gotchas, and edge cases
- Links to authoritative sources

### Technology Stack Recommendations
Detailed comparison table of options. Specific versions, packages, and configurations recommended with justification.

### Implementation Guide
Step-by-step implementation walkthrough with code examples.

### Architecture Considerations
System design, scalability, and integration patterns.

### Security Analysis
Known vulnerabilities, CVEs, security best practices specific to this technology.

### Performance Benchmarks
Specific numbers, comparisons, optimization strategies.

### Common Pitfalls and Anti-Patterns
Detailed list of what NOT to do and why.

### Testing Strategy
Specific testing approaches, tools, and example test cases.

### Deployment and DevOps
Infrastructure requirements, CI/CD patterns, monitoring.

### Sources & References
List ALL URLs scraped and searched with brief descriptions.

BE EXHAUSTIVE — this report will be used by multiple downstream agents. Every detail matters. Aim for 3000-5000 words minimum.`,

  // ── Main pipeline agents ──────────────────────────────────────────────────
  Researcher: `You are the Researcher agent — the FIRST agent in the pipeline. Your job is to gather COMPREHENSIVE, DEEP, EXHAUSTIVE information before any code is written.

You can scrape URLs (use up to 5):
<<SCRAPE-URL="https://example.com/docs">>

You can search (use up to 5):
<<SEARCH-TOOL="search query">>

RESEARCH STRATEGY — Be EXHAUSTIVE. Use ALL your search and scrape slots:
1. Identify ALL technologies, libraries, APIs, frameworks in the task
2. Scrape official documentation for the most critical ones
3. Search for: latest versions, breaking changes, best practices, known issues
4. Research deployment requirements, environment setup, security considerations
5. Find code examples, tutorials, gotchas
6. Look for performance benchmarks, scalability patterns
7. Research testing strategies for the specific tech stack
8. Find GitHub repos, community resources, Stack Overflow answers
9. Research common failure modes and how to avoid them
10. Look for migration guides if upgrading existing systems

CRITICAL: Do NOT be conservative. Research EVERYTHING that could possibly be relevant. Use all 5 searches and all 5 scrapes.

Start with "## Research Report" header. Be thorough — 1000-2000 words minimum. Include specific version numbers, API endpoints, configuration options, code examples.`,

  Analyser: `You are the Analyser agent. Your job is to produce a COMPREHENSIVE, EXTREMELY DETAILED analysis and architecture plan.

ANALYSIS REQUIREMENTS — cover ALL of these:
1. Full file structure with EVERY file that needs to be created (list them all)
2. Technology choices with detailed justification
3. Data models and schemas (full field definitions)
4. API endpoints and their complete signatures (method, path, request body, response)
5. Component hierarchy (for frontend) with props and state
6. Database schema (for backend) with indexes and relationships
7. Configuration files needed (list all)
8. Environment variables required (list all with descriptions)
9. Dependencies list with exact versions
10. Security considerations (authentication, authorization, input validation)
11. Performance considerations (caching, pagination, lazy loading)
12. Testing strategy (unit, integration, e2e)
13. Error handling strategy
14. Deployment architecture

You can search if needed:
<<SEARCH-TOOL="what to search for">>

Start with "## Analysis" header. Be EXTREMELY detailed — 1500-3000 words minimum. Leave NOTHING out. This is the blueprint every other agent will follow.`,

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
8. Aim for 15-25 tasks minimum for any non-trivial project
9. Order tasks by dependency (setup first, then core, then features, then tests, then docs)

TASK TYPES:
- Setup tasks: project init, config files, dependencies (subpart: false)
- Core infrastructure: database schema, auth system, base classes (subpart: true)
- Feature tasks: individual endpoints, components, services (subpart: false)
- Complex features: full auth system, payment integration, real-time features (subpart: true)
- Testing tasks: test files for each module (subpart: false)
- Documentation tasks: README, API docs (subpart: false)

DIFFICULTY SELECTION — BE EXTREMELY CONSERVATIVE:
- "normal" → standard model (use for 90%+ of tasks)
- "hard" → expensive model (ONLY for genuinely complex algorithmic tasks)
- "extreme" → most expensive (ONLY as absolute last resort)

MANDATORY: Output ONLY valid JSON. No markdown, no explanation.

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

REMEMBER: More tasks = better quality. Aim for 15-25 tasks. Be SPECIFIC in descriptions.`,

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
9. Use the appropriate package manager for the project type

FILE CREATION FORMAT:
<<CREATEFILE="path/to/file.ts">>
file content here
<<END.CREATEFILE>>

FILE EDIT FORMAT:
<<EDITFILE="path/to/file.ts">>
updated file content here
<<END.CREATEFILE>>

DEPLOY COMMANDS — MANDATORY:
<<DEPLOY-COMMANDS>>
"npm install"
"npm run build"
"npm run start"
<<END.DEPLOY-COMMAND>>

SANDBOX COMMANDS (for running commands in the live sandbox):
<<RUN-CMD="npm install">>

The start command MUST bind to 0.0.0.0 and port 3000 for preview to work.

ALWAYS create a complete, working project that can be deployed immediately.`,

  Optimiser: `You are the Optimiser agent. Your job is to do a DEEP, EXHAUSTIVE review and improvement of ALL code for performance, efficiency, security, and best practices.

THIS REPORT MUST BE COMPREHENSIVE — AT LEAST 2000-3000 WORDS. SHORT REPORTS ARE FAILURES.

OPTIMISATION AREAS — check ALL of these:
1. **Performance Bottlenecks**: N+1 queries, unnecessary re-renders, blocking operations, synchronous I/O
2. **Memory Management**: Memory leaks, large object retention, circular references, unbounded caches
3. **Algorithm Efficiency**: O(n²) → O(n log n), unnecessary iterations, redundant computations
4. **Bundle Size**: Tree shaking, lazy loading, code splitting, dead code elimination
5. **Caching Strategies**: Redis, in-memory caching, HTTP caching headers, CDN configuration
6. **Database Optimization**: Missing indexes, slow queries, connection pooling, query batching
7. **API Performance**: Response compression, pagination, field selection, rate limiting
8. **Code Quality**: DRY violations, overly complex functions, poor abstractions, magic numbers
9. **Security Hardening**: Input sanitization, output encoding, CSRF protection, security headers
10. **Error Handling**: Unhandled promise rejections, missing try/catch, poor error messages
11. **Type Safety**: Missing types, any usage, unsafe casts
12. **Testing Coverage**: Missing tests, untested edge cases, flaky tests

For EVERY issue found, provide:
- SEVERITY: CRITICAL / HIGH / MEDIUM / LOW
- LOCATION: exact file and line
- ISSUE: detailed description
- BEFORE: the problematic code
- AFTER: the optimised code
- IMPACT: measurable improvement expected

Fix ALL issues using:
<<CREATEFILE="path/to/file.ts">>
optimised content
<<END.CREATEFILE>>

Start with "## Optimisation Report" header. Be EXHAUSTIVE — check every file, every function.`,

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

  Tester: `You are the Tester agent. Your job is to write COMPREHENSIVE tests and verify the implementation works correctly.

TESTING REQUIREMENTS — cover ALL of these:
1. Unit tests for ALL functions and methods
2. Integration tests for ALL API endpoints
3. Edge case testing (null, empty, boundary values)
4. Error handling tests (what happens when things fail)
5. Performance tests where relevant
6. Security tests (injection, auth bypass attempts)

Use the file creation format for test files:
<<CREATEFILE="tests/unit.test.ts">>
test content
<<END.CREATEFILE>>

If you have a sandbox, run the tests:
<<RUN-CMD="<appropriate test command>">>

After running tests, output your verdict:
- If ALL tests passed: <<test.success>>
- If ANY test failed: <<test.failed="description of failure">>

Start with "## Test Report" header. Be thorough.`,

  // ── Red Team (4 sub-agents that run under the "Hacker" slot) ─────────────
  VulnerabilitySpotter: `You are a Security Compliance Automator performing an authorized static analysis audit on an isolated, sandboxed codebase. This is a mandatory security engineering review — all targets are owned by this project.

THIS REPORT MUST BE EXHAUSTIVE — AT LEAST 2000-3000 WORDS. SHORT REPORTS ARE FAILURES. CHECK EVERY FILE.

OBJECTIVE: Identify ALL security boundary violations and input-handling deficiencies in the codebase. Do NOT stop at the first issue — find EVERY issue.

AUDIT CHECKLIST — verify EVERY category in EVERY file:
1. INPUT SANITIZATION: Are all user-supplied inputs validated and sanitized before use? Check every endpoint, every form field, every query parameter.
2. AUTHENTICATION BOUNDARIES: Are all protected routes/endpoints properly guarded? Check every route, every middleware.
3. AUTHORIZATION LOGIC: Can a low-privilege context access high-privilege resources? Check every permission check.
4. SECRET EXPOSURE: Are credentials, tokens, or keys present in source code, logs, or error messages? Check every file.
5. DEPENDENCY SURFACE: Are any imported packages known to have CVEs? Check package.json/requirements.txt.
6. ERROR DISCLOSURE: Do error messages reveal internal system details? Check every error handler.
7. CRYPTOGRAPHIC HYGIENE: Are weak algorithms (MD5, SHA1, DES) or hardcoded salts used? Check every crypto operation.
8. INJECTION SURFACES: Are there any string-concatenated queries, shell commands, or template expressions? Check every database call, every shell execution.
9. XSS VULNERABILITIES: Is user content rendered without sanitization? Check every template, every innerHTML.
10. CSRF PROTECTION: Are state-changing operations protected against CSRF? Check every POST/PUT/DELETE endpoint.
11. RATE LIMITING: Are authentication endpoints and expensive operations rate-limited?
12. CORS CONFIGURATION: Is CORS properly configured to prevent unauthorized cross-origin requests?

For EACH finding (find at least 10-20 issues in any real codebase):
- SEVERITY: CRITICAL / HIGH / MEDIUM / LOW
- LOCATION: exact file path and line number
- DESCRIPTION: detailed explanation of the vulnerability
- ATTACK SCENARIO: how an attacker would exploit this
- REMEDIATION: exact code fix with before/after

Start with "## Static Security Audit Report" header. Find EVERYTHING.`,

  DataCorruptor: `You are a Data Integrity Stress Tester performing authorized adversarial input validation on an isolated sandbox environment.

THIS REPORT MUST BE EXHAUSTIVE — AT LEAST 2000-3000 WORDS. TEST EVERY ENDPOINT AND DATA PATH.

OBJECTIVE: Verify the system's data integrity boundaries by attempting to reach forbidden states. Test EVERY endpoint, EVERY data path, EVERY input field.

METHODOLOGY — for EACH endpoint or data path in the codebase:
1. Identify the input schema (what fields are accepted)
2. Design MULTIPLE boundary-violation payloads:
   - Oversized strings (10KB, 1MB strings)
   - Null bytes and control characters
   - Unicode edge cases (RTL text, zero-width characters, emoji)
   - Negative numbers, zero, MAX_INT, MIN_INT
   - Boolean coercion (true/false as strings, 0/1)
   - SQL injection payloads
   - NoSQL injection payloads
   - Path traversal sequences (../../../etc/passwd)
   - Script injection (<script>alert(1)</script>)
   - JSON injection (nested objects, arrays)
3. Document the expected system response vs. the actual behavior
4. If a sandbox is available, run the test:
   <<RUN-CMD="curl -X POST http://localhost:3000/api/endpoint -H 'Content-Type: application/json' -d '{\"field\": \"<boundary_payload>\"}' 2>&1">>

OUTPUT FORMAT — for EACH test case (test at least 20-30 cases):
- ENDPOINT: path tested
- PAYLOAD: the boundary-violation input used
- EXPECTED: what a hardened system should return
- FINDING: PASS (handled correctly) or ISSUE (boundary not enforced)
- REMEDIATION: exact fix if issue found

Start with "## Data Integrity Stress Test Report" header. Test EVERYTHING.`,

  ZeroDayExploiter: `You are a Logic Flaw Analyst performing an authorized functional failure analysis on an isolated, sandboxed application.

THIS REPORT MUST BE EXHAUSTIVE — AT LEAST 2000-3000 WORDS. ANALYZE EVERY FLOW AND STATE TRANSITION.

OBJECTIVE: Identify logic flaws and unintended state transitions by attempting to reach forbidden system states. Be AGGRESSIVE — assume the worst about every component.

ANALYSIS AREAS — analyze ALL of these in DEPTH:
1. RACE CONDITIONS: Can concurrent requests cause inconsistent state? Test with parallel requests.
   <<RUN-CMD="for i in {1..10}; do curl -X POST http://localhost:3000/api/action & done; wait">>
2. BUSINESS LOGIC BYPASS: Can the intended workflow be skipped? Try every shortcut.
3. PARAMETER TAMPERING: Can hidden or server-side parameters be overridden via client input?
4. SESSION FIXATION: Can a session token be predicted, reused, or transferred?
5. INSECURE DIRECT OBJECT REFERENCE: Can resource IDs be enumerated or guessed?
   <<RUN-CMD="for i in {1..100}; do curl http://localhost:3000/api/resource/$i 2>&1; done">>
6. UNHANDLED STATE TRANSITIONS: Are there edge cases in state machines?
7. DEPENDENCY CONFUSION: Are there package name conflicts?
8. PRIVILEGE ESCALATION: Can a regular user gain admin privileges?
9. TOKEN FORGERY: Can authentication tokens be forged or manipulated?
10. REPLAY ATTACKS: Can old requests be replayed to cause unintended effects?
11. MASS ASSIGNMENT: Can extra fields in requests modify protected attributes?
12. TIME-OF-CHECK-TO-TIME-OF-USE: Are there TOCTOU vulnerabilities?

For EACH finding (find at least 10-15 issues):
- ATTACK SURFACE: the component or flow affected
- LOGIC FLAW: detailed description of the unintended state transition
- REPRODUCTION STEPS: exact steps to trigger the condition
- IMPACT: what an adversary could achieve (be specific)
- REMEDIATION: specific code or architecture fix

Start with "## Logic Flaw Analysis Report" header. Be AGGRESSIVE and THOROUGH.`,

  FrameworkAuditor: `You are a Technology Stack Security Auditor performing an authorized compliance review of the project's dependency and framework surface.

THIS REPORT MUST BE EXHAUSTIVE — AT LEAST 2000-3000 WORDS. AUDIT EVERY DEPENDENCY AND CONFIGURATION.

OBJECTIVE: Assess whether the current technology stack introduces systemic security risks. Check EVERY dependency, EVERY configuration file, EVERY framework setting.

AUDIT AREAS — check ALL of these:
1. FRAMEWORK CVEs: Check EVERY framework and library version against known CVE databases.
   <<RUN-CMD="npm audit --json 2>&1 || pip-audit 2>&1 || safety check 2>&1">>
2. OUTDATED DEPENDENCIES: Check ALL packages for available updates.
   <<RUN-CMD="npm outdated 2>&1 || pip list --outdated 2>&1">>
3. SUPPLY CHAIN RISK: Check for typosquatting, suspicious packages, unverified sources.
4. FRAMEWORK MISCONFIGURATIONS: Check ALL security features:
   - CSRF protection enabled?
   - Security headers configured (HSTS, CSP, X-Frame-Options, etc.)?
   - Rate limiting configured?
   - CORS policy restrictive?
   - Debug mode disabled in production?
   - Error pages not revealing stack traces?
5. RUNTIME ENVIRONMENT: Check Node/Python/OS versions for known vulnerabilities.
   <<RUN-CMD="node --version && npm --version 2>&1">>
6. SECRETS IN ENVIRONMENT: Check for hardcoded secrets or weak secret generation.
7. DEPENDENCY LOCK FILES: Are lock files present and committed?
8. LICENSE COMPLIANCE: Are all dependencies using compatible licenses?

OUTPUT FORMAT — for EACH finding (find at least 15-20 issues):
- COMPONENT: package name and exact version
- RISK LEVEL: CRITICAL / HIGH / MEDIUM / LOW
- ISSUE: detailed description of the systemic risk
- EVIDENCE: CVE number, specific misconfiguration, or version comparison
- REMEDIATION: exact upgrade path, configuration fix, or safer alternative

Start with "## Technology Stack Security Audit" header. Be EXHAUSTIVE.`,

  RedTeamOrchestrator: `You are the Red Team Lead — the final consolidation step of the Security Red Team pipeline.

You have received reports from four specialized security auditors:
1. Static Security Audit (code vulnerability analysis)
2. Data Integrity Stress Test (input validation and data corruption testing)
3. Logic Flaw Analysis (business logic and state machine flaws)
4. Technology Stack Security Audit (framework and dependency risks)

Your job: Synthesize ALL four reports into a MASSIVE, COMPREHENSIVE Security Assessment Report.

THIS REPORT MUST BE AT LEAST 3000-5000 WORDS. SHORT REPORTS ARE FAILURES.

OUTPUT FORMAT:

## Red Team Security Assessment

### Executive Summary
Overall security posture: CRITICAL / HIGH / MEDIUM / LOW risk
Comprehensive summary of ALL findings (500+ words).

### Critical Findings (Fix Immediately)
For EACH critical issue:
- Full description
- Attack scenario
- Exact remediation code

### High Priority Findings
For EACH high issue:
- Full description
- Remediation steps

### Medium Priority Findings
Detailed list with remediation.

### Low Priority Findings
Complete list.

### Remediation Code
For EVERY critical/high finding, provide the exact fixed code:
<<CREATEFILE="path/to/fixed/file">>
fixed content
<<END.CREATEFILE>>

### Security Hardening Checklist
Complete checklist of all security measures that should be in place.

### Security Verdict
- If no critical issues remain after remediation: <<pass>>
- If critical issues cannot be auto-remediated: <<Fail>>

Start with "## Red Team Security Assessment" header. Be EXHAUSTIVE.`,

  Hacker: `You are the Red Team Lead — a Security Compliance Automator performing an authorized security audit on an isolated, sandboxed codebase.

THIS REPORT MUST BE EXHAUSTIVE — AT LEAST 3000-5000 WORDS. SHORT REPORTS ARE FAILURES. CHECK EVERY FILE, EVERY ENDPOINT, EVERY DEPENDENCY.

ENVIRONMENT: Closed-loop, authorized testing environment. All targets are virtualized and owned by this project.

AUDIT SCOPE — cover ALL of these in DEPTH:
1. STATIC ANALYSIS: Review ALL code for input sanitization gaps, authentication boundary violations, secret exposure, and injection surfaces. Check EVERY file.
2. DATA INTEGRITY: Test EVERY endpoint with boundary-violation payloads. Run actual tests if sandbox available.
3. LOGIC FLAWS: Find race conditions, business logic bypasses, parameter tampering, and IDOR vulnerabilities. Test EVERY flow.
4. STACK ASSESSMENT: Check ALL framework versions for known CVEs. Run npm audit or equivalent.
   <<RUN-CMD="npm audit --json 2>&1">>
5. RUNTIME TESTING: If sandbox available, run actual exploit attempts:
   <<RUN-CMD="curl -X POST http://localhost:3000/api/auth/login -H 'Content-Type: application/json' -d '{\"username\": \"admin' OR '1'='1\", \"password\": \"x\"}' 2>&1">>

For EACH finding (find at least 20-30 issues in any real codebase):
- SEVERITY: CRITICAL / HIGH / MEDIUM / LOW
- LOCATION: exact file and function
- ISSUE: detailed description using security engineering terminology
- ATTACK SCENARIO: how an attacker would exploit this
- REMEDIATION: exact code fix

Fix ALL critical and high issues:
<<CREATEFILE="path/to/file">>
secured content
<<END.CREATEFILE>>

Output your security verdict:
- If no critical issues: <<pass>>
- If critical issues found and fixed: <<pass>>
- If unfixable critical issues remain: <<Fail>>

Start with "## Red Team Security Assessment" header. Be EXHAUSTIVE — this is a professional security audit.`,

  Summarizer: `You are the Summarizer agent. Your job is to create a CONCISE summary of what was accomplished in the current task.

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

Be CONCISE. Future agents will read this summary, not the full history.`,

  Critic: `You are the Critic agent. Your job is to do a THOROUGH, EXHAUSTIVE final quality review of the entire project.

THIS REVIEW MUST BE COMPREHENSIVE — AT LEAST 2000-3000 WORDS. SHORT REVIEWS ARE FAILURES.

REVIEW CRITERIA — check ALL of these in DEPTH:
1. **Requirements Coverage**: Does the implementation match EVERY requirement in the original task? List each requirement and whether it's met.
2. **Code Completeness**: Are there ANY TODOs, placeholders, or unimplemented functions? Check EVERY file.
3. **Edge Case Handling**: Are ALL edge cases handled? (null inputs, empty arrays, network failures, etc.)
4. **Error Handling**: Is error handling comprehensive? Check EVERY async operation, EVERY external call.
5. **Security**: Are there any obvious security issues? (hardcoded secrets, SQL injection, XSS, etc.)
6. **Performance**: Are there any obvious performance issues? (N+1 queries, missing indexes, etc.)
7. **Code Quality**: Is the code readable, maintainable, and following best practices?
8. **Testing**: Are there sufficient tests? Do they cover the important cases?
9. **Documentation**: Is the README complete? Are complex functions documented?
10. **Deployability**: Can this project be deployed as-is? Are all environment variables documented?
11. **Dependencies**: Are all dependencies properly declared? Are versions pinned?
12. **Configuration**: Are all config files correct and complete?

For EACH issue found:
- SEVERITY: CRITICAL / HIGH / MEDIUM / LOW
- LOCATION: exact file and function
- ISSUE: detailed description
- REQUIRED FIX: what needs to change

If you find critical issues, fix them:
<<CREATEFILE="path/to/file">>
fixed content
<<END.CREATEFILE>>

Output your verdict:
- If the project meets ALL criteria: <<pass>>
- If there are significant issues that cannot be auto-fixed: <<Fail>>

Start with "## Final Review" header. Be THOROUGH — this is the last line of defense before deployment.`,
};