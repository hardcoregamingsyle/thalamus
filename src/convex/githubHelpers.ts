import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { v } from "convex/values";

// ── Internal mutations/queries for GitHub OAuth ───────────────────────────────

export const saveGithubToken = internalMutation({
  args: {
    userId: v.id("users"),
    accessToken: v.string(),
    username: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.userId, {
      githubAccessToken: args.accessToken,
      githubUsername: args.username,
      githubConnectedAt: Date.now(),
    });
  },
});

export const getUserById = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.userId);
  },
});

export const disconnectGithub = mutation({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const sessions = await ctx.db
      .query("customSessions")
      .withIndex("by_token", (q) => q.eq("token", args.token))
      .take(1);
    const session = sessions[0];
    if (!session || session.expiresAt < Date.now()) throw new Error("Not authenticated");
    await ctx.db.patch(session.userId, {
      githubAccessToken: undefined,
      githubUsername: undefined,
      githubConnectedAt: undefined,
    });
  },
});

export const getGithubStatus = query({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const sessions = await ctx.db
      .query("customSessions")
      .withIndex("by_token", (q) => q.eq("token", args.token))
      .take(1);
    const session = sessions[0];
    if (!session || session.expiresAt < Date.now()) return null;
    const user = await ctx.db.get(session.userId);
    if (!user) return null;
    return {
      connected: !!user.githubAccessToken,
      username: user.githubUsername ?? null,
      connectedAt: user.githubConnectedAt ?? null,
    };
  },
});

// ── OAuth state store ─────────────────────────────────────────────────────────
export const storeOAuthState = internalMutation({
  args: {
    state: v.string(),
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("githubOAuthStates", {
      state: args.state,
      userId: args.userId,
      expiresAt: Date.now() + 10 * 60 * 1000, // 10 minutes
    });
  },
});

export const consumeOAuthState = internalMutation({
  args: { state: v.string() },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("githubOAuthStates")
      .withIndex("by_state", (q) => q.eq("state", args.state))
      .take(1);
    const row = rows[0];
    if (!row) return null;
    await ctx.db.delete(row._id);
    if (row.expiresAt < Date.now()) return null;
    return row.userId;
  },
});