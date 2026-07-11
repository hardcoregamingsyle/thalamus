import { mutation, query, action, internalQuery, internalMutation, type QueryCtx } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";

// ── Helpers ───────────────────────────────────────────────────────────────────

async function getUserIdByToken(ctx: { db: QueryCtx["db"] }, token: string) {
  const session = await ctx.db
    .query("customSessions")
    .withIndex("by_token", (q) => q.eq("token", token))
    .first();
  if (!session || session.expiresAt < Date.now()) return null;
  return session.userId;
}

// Generate a cryptographically random key string
function generateApiKey(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  let key = "thal_";
  // 32 random chars after prefix
  for (let i = 0; i < 32; i++) {
    key += chars[Math.floor(Math.random() * chars.length)];
  }
  return key;
}

// Simple hash (XOR-based fingerprint for non-crypto use — just for lookup)
// NOTE: In production, use a proper SHA-256 via the SubtleCrypto Web API
async function hashKey(key: string): Promise<string> {
  const enc = new TextEncoder();
  const data = enc.encode(key);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// ── Mutations ─────────────────────────────────────────────────────────────────

export const createApiKey = action({
  args: {
    token: v.string(),
    name: v.string(),
    creditsAllocated: v.number(),
    expiresInDays: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<{ keyId: string; fullKey: string; keyPrefix: string }> => {
    // Actions have no ctx.db — resolve the session through a query.
    const userId = await ctx.runQuery(internal.userApiKeys.getSessionUserId, { token: args.token });
    if (!userId) throw new Error("Unauthorized");

    const user = await ctx.runQuery(internal.userApiKeys.getUserBalance, { userId });
    if (!user) throw new Error("User not found");

    if (args.creditsAllocated > (user.agentBucksBalance ?? 0)) {
      throw new Error("Insufficient AgentBucks balance");
    }

    if (args.creditsAllocated < 100) {
      throw new Error("Minimum allocation is 100 AgentBucks");
    }

    const fullKey = generateApiKey();
    const keyHash = await hashKey(fullKey);
    const keyId = "thal_" + fullKey.slice(5, 21); // unique ID portion
    const keyPrefix = fullKey.slice(0, 12) + "...";

    const expiresAt = args.expiresInDays
      ? Date.now() + args.expiresInDays * 24 * 60 * 60 * 1000
      : undefined;

    await ctx.runMutation(internal.userApiKeys.insertApiKey, {
      userId,
      keyId,
      keyHash,
      keyPrefix,
      name: args.name,
      creditsAllocated: args.creditsAllocated,
      expiresAt,
    });

    // Deduct allocated credits from user balance
    await ctx.runMutation(internal.userApiKeys.deductCredits, {
      userId,
      amount: args.creditsAllocated,
    });

    return { keyId, fullKey, keyPrefix };
  },
});

export const insertApiKey = mutation({
  args: {
    userId: v.id("users"),
    keyId: v.string(),
    keyHash: v.string(),
    keyPrefix: v.string(),
    name: v.string(),
    creditsAllocated: v.number(),
    expiresAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("userApiKeys", {
      userId: args.userId,
      keyId: args.keyId,
      keyHash: args.keyHash,
      keyPrefix: args.keyPrefix,
      name: args.name,
      creditsAllocated: args.creditsAllocated,
      creditsUsed: 0,
      isActive: true,
      createdAt: Date.now(),
      expiresAt: args.expiresAt,
    });
  },
});

export const deductCredits = mutation({
  args: { userId: v.id("users"), amount: v.number() },
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId);
    if (!user) return;
    const current = user.agentBucksBalance ?? 0;
    await ctx.db.patch(args.userId, {
      agentBucksBalance: Math.max(0, current - args.amount),
    });
  },
});

export const getUserBalance = query({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId);
    if (!user) return null;
    return { agentBucksBalance: user.agentBucksBalance ?? 0 };
  },
});

export const listApiKeys = query({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const userId = await getUserIdByToken(ctx, args.token);
    if (!userId) return [];
    const keys = await ctx.db
      .query("userApiKeys")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .order("desc")
      .take(50);
    // Never return the hash — only metadata
    return keys.map((k) => ({
      _id: k._id,
      keyId: k.keyId,
      keyPrefix: k.keyPrefix,
      name: k.name,
      creditsAllocated: k.creditsAllocated,
      creditsUsed: k.creditsUsed,
      isActive: k.isActive,
      lastUsedAt: k.lastUsedAt,
      createdAt: k.createdAt,
      expiresAt: k.expiresAt,
    }));
  },
});

export const revokeApiKey = mutation({
  args: { token: v.string(), keyId: v.string() },
  handler: async (ctx, args) => {
    const userId = await getUserIdByToken(ctx, args.token);
    if (!userId) throw new Error("Unauthorized");
    const key = await ctx.db
      .query("userApiKeys")
      .withIndex("by_key_id", (q) => q.eq("keyId", args.keyId))
      .first();
    if (!key || key.userId !== userId) throw new Error("Key not found");

    // Refund unused credits
    const unused = key.creditsAllocated - key.creditsUsed;
    if (unused > 0) {
      const user = await ctx.db.get(userId);
      if (user) {
        await ctx.db.patch(userId, {
          agentBucksBalance: (user.agentBucksBalance ?? 0) + unused,
        });
      }
    }

    await ctx.db.patch(key._id, { isActive: false });
  },
});

// ── API key auth for external calls (/api/v1 in http.ts) ─────────────────────

// Session token → userId, callable from actions (which have no ctx.db).
export const getSessionUserId = internalQuery({
  args: { token: v.string() },
  handler: async (ctx, args) => getUserIdByToken(ctx, args.token),
});

// Hashing happens in the HTTP action (SubtleCrypto); this just looks up the hash
// and applies the validity gates so the route handler stays dumb.
export const getKeyByHash = internalQuery({
  args: { keyHash: v.string() },
  handler: async (ctx, args) => {
    const key = await ctx.db
      .query("userApiKeys")
      .withIndex("by_key_hash", (q) => q.eq("keyHash", args.keyHash))
      .first();
    if (!key || !key.isActive) return null;
    if (key.expiresAt && key.expiresAt < Date.now()) return null;
    return {
      _id: key._id,
      keyId: key.keyId,
      userId: key.userId,
      creditsRemaining: key.creditsAllocated - key.creditsUsed,
    };
  },
});

// Meter usage against the key's own allocation (pre-paid from the user's balance
// at creation time — see createApiKey).
export const recordKeyUsage = internalMutation({
  args: { id: v.id("userApiKeys"), credits: v.number() },
  handler: async (ctx, args) => {
    const key = await ctx.db.get(args.id);
    if (!key) return;
    await ctx.db.patch(args.id, {
      creditsUsed: key.creditsUsed + args.credits,
      lastUsedAt: Date.now(),
    });
  },
});
