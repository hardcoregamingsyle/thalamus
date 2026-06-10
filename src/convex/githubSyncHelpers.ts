// @ts-nocheck
import { internalMutation, internalQuery } from "./_generated/server";
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

export const saveGithubConfigWithToken = internalMutation({
  args: {
    projectId: v.string(),
    branchId: v.string(),
    repoUrl: v.string(),
    owner: v.string(),
    repo: v.string(),
    branch: v.string(),
    lastSync: v.number(),
    githubToken: v.string(),
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
        githubToken: args.githubToken,
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
        githubToken: args.githubToken,
      });
    }
  },
});

export const getGithubConfigInternal = internalMutation({
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

// Find all configs for a specific GitHub repo and branch
export const findConfigsByRepo = internalQuery({
  args: {
    repoFullName: v.string(),
    branch: v.string(),
  },
  handler: async (ctx, args) => {
    const [owner, repo] = args.repoFullName.split("/");
    if (!owner || !repo) return [];

    const allConfigs = await ctx.db.query("githubConfigs").collect();
    return allConfigs.filter(
      (c) => c.owner === owner && c.repo === repo && c.branch === args.branch
    );
  },
});

