import { internalMutation } from "./_generated/server";
import { v } from "convex/values";

export const saveGithubConfig = internalMutation({
  args: {
    projectId: v.string(),
    branchId: v.string(),
    repoUrl: v.string(),
    owner: v.string(),
    repo: v.string(),
    branch: v.string(),
    lastSync: v.number(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("githubConfigs")
      .withIndex("by_branch", (q) => q.eq("branchId", args.branchId))
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        repoUrl: args.repoUrl,
        owner: args.owner,
        repo: args.repo,
        branch: args.branch,
        lastSync: args.lastSync,
      });
    } else {
      await ctx.db.insert("githubConfigs", {
        projectId: args.projectId,
        branchId: args.branchId,
        repoUrl: args.repoUrl,
        owner: args.owner,
        repo: args.repo,
        branch: args.branch,
        lastSync: args.lastSync,
      });
    }
  },
});

export const getGithubConfig = internalMutation({
  args: {
    projectId: v.string(),
    branchId: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("githubConfigs")
      .withIndex("by_branch", (q) => q.eq("branchId", args.branchId))
      .first();
  },
});

export const updateLastSync = internalMutation({
  args: {
    projectId: v.string(),
    branchId: v.string(),
  },
  handler: async (ctx, args) => {
    const config = await ctx.db
      .query("githubConfigs")
      .withIndex("by_branch", (q) => q.eq("branchId", args.branchId))
      .first();

    if (config) {
      await ctx.db.patch(config._id, {
        lastSync: Date.now(),
      });
    }
  },
});
