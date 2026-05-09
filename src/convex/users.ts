import { getAuthUserId } from "@convex-dev/auth/server";
import { mutation, query, QueryCtx } from "./_generated/server";
import { v } from "convex/values";

/**
 * Get the current signed in user. Returns null if the user is not signed in.
 * Usage: const signedInUser = await ctx.runQuery(api.authHelpers.currentUser);
 * THIS FUNCTION IS READ-ONLY. DO NOT MODIFY.
 */
export const currentUser = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);

    if (user === null) {
      return null;
    }

    return user;
  },
});

/**
 * Use this function internally to get the current user data. Remember to handle the null user case.
 * @param ctx
 * @returns
 */
export const getCurrentUser = async (ctx: QueryCtx) => {
  const userId = await getAuthUserId(ctx);
  if (userId === null) {
    return null;
  }
  return await ctx.db.get(userId);
};

export const completeOnboarding = mutation({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    // Find session by token
    const session = await ctx.db
      .query("customSessions")
      .withIndex("by_token", q => q.eq("token", args.token))
      .unique();
    if (!session) throw new Error("Invalid session");
    await ctx.db.patch(session.userId, { hasOnboarded: true });
    return { success: true };
  },
});