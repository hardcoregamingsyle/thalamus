import { query, action, internalMutation, internalQuery } from "./_generated/server";
import { v } from "convex/values";

// ── Admin login: password + security questions ────────────────────────────────
// Only salted SHA-256 hashes live in this (public) repo — never the values.
// On success the server hands back ADMIN_TOKEN, which every admin function
// already validates; the browser never sees the token until the credentials
// check out server-side.
const ADMIN_TOKEN = process.env.ADMIN_TOKEN ?? "";
const ADMIN_LOGIN_SALT = "thalamus-admin-v1:";
const ADMIN_PASSWORD_HASH = "6e8740158bf41841b9246adb492c7470b682559e5a6e178ee73dc960e04e9893";
const ADMIN_ANSWER_HASHES = [
  "0373b30607fc80acfdbd70987ff92a94b022de7877ace680d1f39be85e2beac2", // q1: favourite Roblox game
  "1de146172e124ebf5bd16e5ac49b8f60f832fa667095f61c867bb23700513978", // q2: crush name
  "09ef9530fa5dfe658171f1367cd8b60e9b800ff7689dbcc76b08d7cdcf5e49c4", // q3: greatest enemy of all time
];

async function sha256Salted(value: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(ADMIN_LOGIN_SALT + value));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export const adminLogin = action({
  args: {
    password: v.string(),
    answer1: v.string(),
    answer2: v.string(),
    answer3: v.string(),
  },
  handler: async (_ctx, args): Promise<{ token: string }> => {
    if (!ADMIN_TOKEN) throw new Error("ADMIN_TOKEN not configured on server");
    // Password is case-sensitive; answers are case/whitespace-insensitive.
    const checks = await Promise.all([
      sha256Salted(args.password),
      sha256Salted(args.answer1.toLowerCase().trim()),
      sha256Salted(args.answer2.toLowerCase().trim()),
      sha256Salted(args.answer3.toLowerCase().trim()),
    ]);
    const ok =
      checks[0] === ADMIN_PASSWORD_HASH &&
      checks[1] === ADMIN_ANSWER_HASHES[0] &&
      checks[2] === ADMIN_ANSWER_HASHES[1] &&
      checks[3] === ADMIN_ANSWER_HASHES[2];
    // One generic error regardless of which field failed — no oracle.
    if (!ok) throw new Error("Invalid credentials");
    return { token: ADMIN_TOKEN };
  },
});

// Used by the frontend login form to validate the token without exposing it in
// the client bundle. Returns true/false — never exposes the token value.
export const verifyAdminToken = query({
  args: { token: v.string() },
  handler: async (_ctx, args) => {
    if (!ADMIN_TOKEN) return false;
    return args.token === ADMIN_TOKEN;
  },
});

// Platform Budget
// Cost per million tokens in dollars (8 decimal precision)
const PLATFORM_PRICING: Record<string, { input: number; output: number }> = {
  // Gemini pricing (Flash Lite)
  "gemini-3.1-flash-lite": { input: 0.60, output: 2.40 },
  // Claude pricing via AWS Bedrock
  "claude-haiku-4-5":  { input: 1.80,  output: 7.20 },
  "claude-sonnet-4-6": { input: 5.40,  output: 26.50 },
  "claude-opus-4-6":   { input: 7.44,  output: 42.00 },
  "claude-opus-4-8":   { input: 12.00, output: 60.00 },
};

const BUDGET_THRESHOLD = 5.0; // disable at $5 remaining

export function calcPlatformCost(modelName: string, inputTokens: number, outputTokens: number): number {
  // Names arrive provider-prefixed ("nim:qwen/...", "ollama:gemma4:31b"). Anything
  // not in the table costs us nothing to serve — the current providers are free
  // tiers — so it contributes 0 on purpose rather than by accident.
  const pricing = PLATFORM_PRICING[modelName] ?? PLATFORM_PRICING[modelName.split(":").slice(1).join(":")];
  if (!pricing) return 0;
  return parseFloat(
    ((inputTokens / 1_000_000) * pricing.input + (outputTokens / 1_000_000) * pricing.output).toFixed(8)
  );
}

// Internal: deduct cost from platform budget after a model call
export const deductPlatformCost = internalMutation({
  args: { modelName: v.string(), inputTokens: v.number(), outputTokens: v.number() },
  handler: async (ctx, args) => {
    const cost = calcPlatformCost(args.modelName, args.inputTokens, args.outputTokens);

    // Log for debugging
    console.log(`💰 Platform cost deduction: ${args.modelName} | ${args.inputTokens} in / ${args.outputTokens} out → $${cost.toFixed(6)}`);

    if (cost <= 0) {
      console.warn(`⚠️ Zero cost for model ${args.modelName} - check PLATFORM_PRICING config`);
      return;
    }

    const budgets = await ctx.db.query("platformBudget").take(1);
    if (budgets.length === 0) {
      console.warn("⚠️ No platform budget configured - cost not tracked");
      return; // no budget set, allow
    }

    const b = budgets[0];
    const newSpent = parseFloat((b.spentDollars + cost).toFixed(8));
    const remaining = b.totalDollars - newSpent;

    console.log(`💳 Budget updated: $${b.spentDollars.toFixed(2)} → $${newSpent.toFixed(2)} (remaining: $${remaining.toFixed(2)})`);

    await ctx.db.patch(b._id, {
      spentDollars: newSpent,
      isDisabled: remaining < BUDGET_THRESHOLD,
      updatedAt: Date.now(),
    });
  },
});

// Internal: check if platform budget allows more requests
export const isPlatformBudgetExhausted = internalQuery({
  args: {},
  handler: async (ctx) => {
    const budgets = await ctx.db.query("platformBudget").take(1);
    if (budgets.length === 0) return false; // no budget set = allow
    return budgets[0].isDisabled;
  },
});

// AWS Bedrock Credentials
export const getAwsCredentialsInternal = internalQuery({
  args: {},
  handler: async (ctx) => {
    const creds = await ctx.db.query("awsCredentials").take(1);
    if (creds.length === 0) return null;
    return {
      accessKeyId: creds[0].accessKeyId,
      secretAccessKey: creds[0].secretAccessKey,
      region: creds[0].region,
    };
  },
});

// Gemini API Keys
export const getGeminiKeysInternal = internalQuery({
  args: {},
  handler: async (ctx) => {
    const record = await ctx.db.query("geminiKeys").take(1);
    if (record.length === 0) return [];
    return record[0].keys;
  },
});

// —— Ollama Cloud API Keys ——

export const getOllamaKeysInternal = internalQuery({
  args: {},
  handler: async (ctx) => {
    const record = await ctx.db.query("ollamaKeys").take(1);
    if (record.length === 0) return [];
    return record[0].keys;
  },
});

// —— Modal endpoints ——
// Multi-row, unlike the key pools above: each row is a full endpoint (URL +
// model + optional key), so pointing at a new self-hosted model is a row, not a
// deploy. Exactly one row is primary and the runtime tries it first.

// Runtime read: enabled rows only, primary first. Ordering here means the client
// just iterates the array — same shape as the key-pool rotation.
export const getModalEndpointsInternal = internalQuery({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("modalEndpoints").take(50);
    return rows
      .filter((r) => r.isEnabled)
      .sort((a, b) => (b.isPrimary ? 1 : 0) - (a.isPrimary ? 1 : 0) || a.createdAt - b.createdAt)
      .map((r) => ({ name: r.name, baseUrl: r.baseUrl, apiKey: r.apiKey, modelId: r.modelId }));
  },
});
