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

    const config = await ctx.db
      .query("githubConfigs")
      .withIndex("by_branch", (q) => q.eq("branchId", args.branchId))
      .first();
    if (!config) return null;

    // Field-by-field on purpose: the row stores the OAuth token this repo was
    // created with, and returning the document wholesale handed it to the
    // browser. Never spread this document.
    return {
      projectId: config.projectId,
      branchId: config.branchId,
      repoUrl: config.repoUrl,
      owner: config.owner,
      repo: config.repo,
      branch: config.branch,
      lastSync: config.lastSync,
      // The Git Sync tab's Repo Status control. Rows from before the field
      // existed are public repos (creation hardcoded it), so false is the
      // honest default — never undefined, so the toggle can't render blank.
      isPrivate: config.isPrivate ?? false,
      sourceRepoUrl: config.sourceRepoUrl ?? null,
      sourceBranch: config.sourceBranch ?? null,
    };
  },
});
