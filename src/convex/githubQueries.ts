import { query } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";

// Get GitHub config for a branch (public query)
export const getGithubConfig = query({
  args: {
    token: v.string(),
    projectId: v.string(),
    branchId: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await ctx.runQuery(internal.customAuthHelpers.getUserIdByToken, {
      token: args.token,
    });
    if (!userId) return null;

    return await ctx.db
      .query("githubConfigs")
      .withIndex("by_branch", (q) => q.eq("branchId", args.branchId))
      .first();
  },
});
