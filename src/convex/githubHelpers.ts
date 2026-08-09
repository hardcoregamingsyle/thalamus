import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { v } from "convex/values";

// Internal mutations/queries for GitHub OAuth
export const saveGithubToken = internalMutation({
  args: {
    userId: v.id("users"),
    accessToken: v.string(),
    username: v.string(),
    // Whatever GitHub reported in x-oauth-scopes for this token. Optional so
    // the sign-in path (which does not read the header) still compiles.
    scopes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.userId, {
      githubAccessToken: args.accessToken,
      githubUsername: args.username,
      githubConnectedAt: Date.now(),
      ...(args.scopes === undefined ? {} : { githubScopes: args.scopes }),
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
      githubScopes: undefined,
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
    const scopes = user.githubScopes
      ? user.githubScopes.split(",").map((s) => s.trim()).filter(Boolean)
      : [];
    return {
      connected: !!user.githubAccessToken,
      username: user.githubUsername ?? null,
      connectedAt: user.githubConnectedAt ?? null,
      scopes,
      // null means "unknown" — tokens saved before scopes were recorded, and
      // token types that don't send x-oauth-scopes at all. Only `false` is a
      // definite "cloud commands cannot work on this token".
      hasWorkflowScope: user.githubAccessToken
        ? (user.githubScopes ? scopes.includes("workflow") : null)
        : null,
    };
  },
});

// Note: OAuth state storage lives in customAuthHelpers (oauthStates table) —
// a duplicate store/consume pair that once lived here was never wired up and
// has been removed along with its githubOAuthStates table.

// Get GitHub token for user (internal)
export const getGithubToken = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId);
    if (!user || !user.githubAccessToken) return null;
    return {
      accessToken: user.githubAccessToken,
      username: user.githubUsername ?? "unknown",
    };
  },
});