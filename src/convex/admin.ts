import { query, mutation, internalMutation, internalQuery } from "./_generated/server";
import { v } from "convex/values";
import { Id } from "./_generated/dataModel";
// ── Admin auth helper ─────────────────────────────────────────────────────────
const ADMIN_TOKEN = "Aphantic*123";

async function requireAdmin(_ctx: unknown, adminToken: string) {
  if (adminToken !== ADMIN_TOKEN) throw new Error("Unauthorized");
}

// ── Promo Codes ───────────────────────────────────────────────────────────────
export const listPromoCodes = query({
  args: { adminToken: v.string() },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.adminToken);
    return await ctx.db.query("promoCodes").order("desc").take(200);
  },
});

export const createPromoCode = mutation({
  args: {
    adminToken: v.string(),
    code: v.string(),
    purchasedCredits: v.optional(v.number()),
    spins: v.optional(v.number()),
    expiresAt: v.number(),
    maxUses: v.optional(v.number()),
    createdBy: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.adminToken);
    const existing = await ctx.db.query("promoCodes").withIndex("by_code", q => q.eq("code", args.code)).take(1);
    if (existing.length > 0) throw new Error("Promo code already exists");
    await ctx.db.insert("promoCodes", {
      code: args.code.toUpperCase().trim(),
      purchasedCredits: args.purchasedCredits,
      spins: args.spins,
      expiresAt: args.expiresAt,
      maxUses: args.maxUses,
      usedCount: 0,
      createdAt: Date.now(),
      createdBy: args.createdBy,
    });
  },
});

export const deletePromoCode = mutation({
  args: { adminToken: v.string(), id: v.id("promoCodes") },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.adminToken);
    await ctx.db.delete(args.id);
  },
});

// ── Users ─────────────────────────────────────────────────────────────────────
export const listUsers = query({
  args: { adminToken: v.string() },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.adminToken);
    const users = await ctx.db.query("users").take(500);
    return users.map(u => ({
      _id: u._id,
      email: u.email,
      name: u.name,
      dailyAgentBucks: (u as { dailyAgentBucks?: number }).dailyAgentBucks ?? 0,
      purchasedAgentBucks: (u as { purchasedAgentBucks?: number }).purchasedAgentBucks ?? 0,
      isBanned: (u as { isBanned?: boolean }).isBanned ?? false,
      warningCount: (u as { warningCount?: number }).warningCount ?? 0,
      _creationTime: u._creationTime,
    }));
  },
});

export const getUserCreditBatches = query({
  args: { adminToken: v.string(), userId: v.id("users") },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.adminToken);
    return await ctx.db.query("creditBatches").withIndex("by_user", q => q.eq("userId", args.userId)).take(50);
  },
});

export const setDailyAllowance = mutation({
  args: { adminToken: v.string(), userId: v.id("users"), dailyAgentBucks: v.number() },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.adminToken);
    await ctx.db.patch(args.userId, { dailyAgentBucks: args.dailyAgentBucks } as never);
  },
});

export const addPurchasedCredits = mutation({
  args: { adminToken: v.string(), userId: v.id("users"), amount: v.number(), note: v.optional(v.string()) },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.adminToken);
    const user = await ctx.db.get(args.userId);
    if (!user) throw new Error("User not found");
    const current = (user as { purchasedAgentBucks?: number }).purchasedAgentBucks ?? 0;
    await ctx.db.patch(args.userId, { purchasedAgentBucks: current + args.amount } as never);
    await ctx.db.insert("creditBatches", {
      userId: args.userId,
      amount: args.amount,
      remaining: args.amount,
      expiresAt: Date.now() + 90 * 24 * 60 * 60 * 1000,
      source: args.note ?? "admin",
      createdAt: Date.now(),
    });
  },
});

// ── Suggestions ───────────────────────────────────────────────────────────────
export const listSuggestions = query({
  args: { adminToken: v.string() },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.adminToken);
    return await ctx.db.query("suggestions").order("desc").take(200);
  },
});

export const updateSuggestionStatus = mutation({
  args: { adminToken: v.string(), id: v.id("suggestions"), status: v.string(), adminNote: v.optional(v.string()) },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.adminToken);
    await ctx.db.patch(args.id, { status: args.status, adminNote: args.adminNote });
  },
});

export const deleteSuggestion = mutation({
  args: { adminToken: v.string(), id: v.id("suggestions") },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.adminToken);
    await ctx.db.delete(args.id);
  },
});

// ── Model Pricing ─────────────────────────────────────────────────────────────
export const listModelPricing = query({
  args: { adminToken: v.string() },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.adminToken);
    return await ctx.db.query("modelPricing").take(50);
  },
});

export const upsertModelPricing = mutation({
  args: {
    adminToken: v.string(),
    modelId: v.string(),
    displayName: v.string(),
    inputCentsPerMillion: v.number(),
    outputCentsPerMillion: v.number(),
    abMultiplier: v.number(),
    isActive: v.boolean(),
    updatedBy: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.adminToken);
    const existing = await ctx.db.query("modelPricing").withIndex("by_model", q => q.eq("modelId", args.modelId)).take(1);
    if (existing.length > 0) {
      await ctx.db.patch(existing[0]._id, {
        displayName: args.displayName,
        inputCentsPerMillion: args.inputCentsPerMillion,
        outputCentsPerMillion: args.outputCentsPerMillion,
        abMultiplier: args.abMultiplier,
        isActive: args.isActive,
        updatedAt: Date.now(),
        updatedBy: args.updatedBy,
      });
    } else {
      await ctx.db.insert("modelPricing", {
        modelId: args.modelId,
        displayName: args.displayName,
        inputCentsPerMillion: args.inputCentsPerMillion,
        outputCentsPerMillion: args.outputCentsPerMillion,
        abMultiplier: args.abMultiplier,
        isActive: args.isActive,
        updatedAt: Date.now(),
        updatedBy: args.updatedBy,
      });
    }
  },
});

// ── Submit suggestion (public — no auth required) ─────────────────────────────
export const submitSuggestion = mutation({
  args: {
    userId: v.optional(v.id("users")),
    userEmail: v.optional(v.string()),
    sessionId: v.optional(v.id("teamSessions")),
    title: v.string(),
    description: v.string(),
    files: v.optional(v.array(v.object({
      name: v.string(),
      content: v.string(),
      size: v.number(),
    }))),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("suggestions", {
      userId: args.userId,
      userEmail: args.userEmail,
      sessionId: args.sessionId,
      title: args.title,
      description: args.description,
      files: args.files,
      status: "new",
      createdAt: Date.now(),
    });
  },
});

// ── Platform Budget ───────────────────────────────────────────────────────────

// Cost per million tokens in dollars (8 decimal precision)
const PLATFORM_PRICING: Record<string, { input: number; output: number }> = {
  // Gemini pricing (Flash Lite)
  "gemini-3.1-flash-lite-preview": { input: 0.60, output: 2.40 },
  // Claude pricing via AWS Bedrock
  "claude-haiku-4-5":  { input: 1.80,  output: 7.20 },
  "claude-sonnet-4-6": { input: 5.40,  output: 26.50 },
  "claude-opus-4-6":   { input: 7.44,  output: 42.00 },
  "claude-opus-4-8":   { input: 12.00, output: 60.00 },
};

const BUDGET_THRESHOLD = 5.0; // disable at $5 remaining

export function calcPlatformCost(modelName: string, inputTokens: number, outputTokens: number): number {
  const pricing = PLATFORM_PRICING[modelName];
  if (!pricing) return 0;
  return parseFloat(
    ((inputTokens / 1_000_000) * pricing.input + (outputTokens / 1_000_000) * pricing.output).toFixed(8)
  );
}

export const getPlatformBudget = query({
  args: { adminToken: v.string() },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.adminToken);
    const budgets = await ctx.db.query("platformBudget").take(1);
    if (budgets.length === 0) return { totalDollars: 0, spentDollars: 0, isDisabled: false, remaining: 0 };
    const b = budgets[0];
    return {
      _id: b._id,
      totalDollars: b.totalDollars,
      spentDollars: b.spentDollars,
      isDisabled: b.isDisabled,
      remaining: parseFloat((b.totalDollars - b.spentDollars).toFixed(8)),
    };
  },
});

export const setPlatformBudget = mutation({
  args: { adminToken: v.string(), totalDollars: v.number(), operation: v.optional(v.union(v.literal("add"), v.literal("set"), v.literal("subtract"))) },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.adminToken);
    const operation = args.operation ?? "add"; // default to "add" for backward compatibility
    const budgets = await ctx.db.query("platformBudget").take(1);

    if (budgets.length === 0) {
      // First time: create with the given amount
      const isDisabled = args.totalDollars < BUDGET_THRESHOLD;
      await ctx.db.insert("platformBudget", {
        totalDollars: Math.max(0, args.totalDollars),
        spentDollars: 0,
        isDisabled,
        updatedAt: Date.now(),
      });
    } else {
      const b = budgets[0];
      let newTotal: number;

      if (operation === "set") {
        // Set absolute value
        newTotal = Math.max(0, args.totalDollars);
      } else if (operation === "subtract") {
        // Subtract from existing total
        newTotal = Math.max(0, parseFloat((b.totalDollars - args.totalDollars).toFixed(8)));
      } else {
        // Add to existing total (default behavior)
        newTotal = parseFloat((b.totalDollars + args.totalDollars).toFixed(8));
      }

      const remaining = newTotal - b.spentDollars;
      await ctx.db.patch(b._id, {
        totalDollars: newTotal,
        isDisabled: remaining < BUDGET_THRESHOLD,
        updatedAt: Date.now(),
      });
    }
  },
});

export const resetPlatformSpend = mutation({
  args: { adminToken: v.string() },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.adminToken);
    const budgets = await ctx.db.query("platformBudget").take(1);
    if (budgets.length === 0) return;
    const b = budgets[0];
    const remaining = b.totalDollars - 0;
    await ctx.db.patch(b._id, {
      spentDollars: 0,
      isDisabled: remaining < BUDGET_THRESHOLD,
      updatedAt: Date.now(),
    });
  },
});

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

// ── DAU Tracking ──────────────────────────────────────────────────────────────

/** Called from the frontend on app load / page focus. Upserts a DAU record for today. */
export const trackDailyActivity = mutation({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    if (!args.token || args.token.length < 32) return;

    const session = await ctx.db
      .query("customSessions")
      .withIndex("by_token", (q) => q.eq("token", args.token))
      .unique();
    if (!session || session.expiresAt < Date.now()) return;

    const userId = session.userId;

    const now = Date.now();
    const dateKey = new Date(now).toISOString().slice(0, 10); // "YYYY-MM-DD" UTC

    const existing = await ctx.db
      .query("dailyActiveUsers")
      .withIndex("by_user_and_date", q => q.eq("userId", userId).eq("dateKey", dateKey))
      .unique();

    if (existing) {
      // Throttle: only update if last ping was > 5 minutes ago to avoid excessive writes
      if (now - existing.lastSeenAt < 5 * 60 * 1000) return;
      await ctx.db.patch(existing._id, {
        lastSeenAt: now,
        sessionCount: existing.sessionCount + 1,
      });
    } else {
      await ctx.db.insert("dailyActiveUsers", {
        userId,
        dateKey,
        firstSeenAt: now,
        lastSeenAt: now,
        sessionCount: 1,
      });
    }
  },
});

/** Admin: get DAU counts for the last N days */
export const getDauStats = query({
  args: { adminToken: v.string(), days: v.optional(v.number()) },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.adminToken);
    const numDays = args.days ?? 30;
    const now = Date.now();

    // Build date keys for the last N days
    const dateKeys: string[] = [];
    for (let i = 0; i < numDays; i++) {
      const d = new Date(now - i * 24 * 60 * 60 * 1000);
      dateKeys.push(d.toISOString().slice(0, 10));
    }

    // Fetch records for each day
    const results: { date: string; dau: number }[] = [];
    for (const dateKey of dateKeys) {
      const records = await ctx.db
        .query("dailyActiveUsers")
        .withIndex("by_date", q => q.eq("dateKey", dateKey))
        .take(10000);
      results.push({ date: dateKey, dau: records.length });
    }

    return results.reverse(); // oldest first
  },
});

/** Admin: get today's DAU count (real-time) */
export const getTodayDau = query({
  args: { adminToken: v.string() },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.adminToken);
    const dateKey = new Date().toISOString().slice(0, 10);
    const records = await ctx.db
      .query("dailyActiveUsers")
      .withIndex("by_date", q => q.eq("dateKey", dateKey))
      .take(10000);
    return records.length;
  },
});

// ── Admin Study Materials ─────────────────────────────────────────────────────

export const listAdminStudyMaterials = query({
  args: { adminToken: v.string() },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.adminToken);
    return await ctx.db.query("adminStudyMaterials").order("desc").take(100);
  },
});

export const addAdminStudyMaterial = mutation({
  args: {
    adminToken: v.string(),
    title: v.string(),
    content: v.string(),
    mode: v.optional(v.string()),
    fileName: v.optional(v.string()),
    fileType: v.optional(v.string()),
    uploadedBy: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.adminToken);
    await ctx.db.insert("adminStudyMaterials", {
      title: args.title,
      content: args.content,
      mode: args.mode,
      fileName: args.fileName,
      fileType: args.fileType,
      uploadedBy: args.uploadedBy,
      createdAt: Date.now(),
    });
  },
});

export const deleteAdminStudyMaterial = mutation({
  args: { adminToken: v.string(), id: v.id("adminStudyMaterials") },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.adminToken);
    await ctx.db.delete(args.id);
  },
});

// Internal query for study mode to fetch admin materials
export const getAdminStudyMaterials = internalQuery({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("adminStudyMaterials").order("desc").take(20);
  },
});

// ── AWS Bedrock Credentials ───────────────────────────────────────────────────

export const getAwsCredentials = query({
  args: { adminToken: v.string() },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.adminToken);
    const creds = await ctx.db.query("awsCredentials").take(1);
    if (creds.length === 0) return null;
    return {
      accessKeyId: creds[0].accessKeyId,
      secretAccessKey: creds[0].secretAccessKey,
      region: creds[0].region,
      updatedAt: creds[0].updatedAt,
    };
  },
});

export const saveAwsCredentials = mutation({
  args: {
    adminToken: v.string(),
    accessKeyId: v.string(),
    secretAccessKey: v.string(),
    region: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.adminToken);
    const region = args.region || "us-east-1";
    const existing = await ctx.db.query("awsCredentials").take(1);
    if (existing.length > 0) {
      await ctx.db.patch(existing[0]._id, {
        accessKeyId: args.accessKeyId,
        secretAccessKey: args.secretAccessKey,
        region,
        updatedAt: Date.now(),
        updatedBy: "admin",
      });
    } else {
      await ctx.db.insert("awsCredentials", {
        accessKeyId: args.accessKeyId,
        secretAccessKey: args.secretAccessKey,
        region,
        updatedAt: Date.now(),
        updatedBy: "admin",
      });
    }
  },
});

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

// ── Gemini API Keys ───────────────────────────────────────────────────────────

export const getGeminiKeys = query({
  args: { adminToken: v.string() },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.adminToken);
    const record = await ctx.db.query("geminiKeys").take(1);
    if (record.length === 0) return null;
    return {
      count: record[0].keys.length,
      updatedAt: record[0].updatedAt,
      // Return masked keys for display
      maskedKeys: record[0].keys.map(k => k.slice(0, 8) + "..." + k.slice(-4)),
    };
  },
});

export const saveGeminiKeys = mutation({
  args: {
    adminToken: v.string(),
    keys: v.array(v.string()),
    append: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.adminToken);
    const existing = await ctx.db.query("geminiKeys").take(1);
    let finalKeys = args.keys;
    if (args.append && existing.length > 0) {
      // Merge: existing keys + new keys, deduplicated
      const existingSet = new Set(existing[0].keys);
      for (const k of args.keys) existingSet.add(k);
      finalKeys = Array.from(existingSet);
    }
    if (existing.length > 0) {
      await ctx.db.patch(existing[0]._id, {
        keys: finalKeys,
        updatedAt: Date.now(),
        updatedBy: "admin",
      });
    } else {
      await ctx.db.insert("geminiKeys", {
        keys: finalKeys,
        updatedAt: Date.now(),
        updatedBy: "admin",
      });
    }
  },
});

export const getGeminiKeysInternal = internalQuery({
  args: {},
  handler: async (ctx) => {
    const record = await ctx.db.query("geminiKeys").take(1);
    if (record.length === 0) return [];
    return record[0].keys;
  },
});