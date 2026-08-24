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
    isPrivate: v.optional(v.boolean()),
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
        ...(args.isPrivate === undefined ? {} : { isPrivate: args.isPrivate }),
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
        ...(args.isPrivate === undefined ? {} : { isPrivate: args.isPrivate }),
      });
    }
  },
});

// The build mirror for a branch (see schema comment on githubConfigs): the
// platform-owned repo cloud command execution actually runs against. Written
// once by ensureVmMirror and read on every boot/sandbox path thereafter.
export const saveVmMirror = internalMutation({
  args: {
    branchId: v.string(),
    vmOwner: v.string(),
    vmRepo: v.string(),
    vmRepoUrl: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("githubConfigs")
      .withIndex("by_branch", (q) => q.eq("branchId", args.branchId))
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, {
        vmOwner: args.vmOwner,
        vmRepo: args.vmRepo,
        vmRepoUrl: args.vmRepoUrl,
      });
    }
  },
});

// The user repo's visibility, toggled from the Git Sync tab after creation.
export const setConfigPrivacy = internalMutation({
  args: {
    branchId: v.string(),
    isPrivate: v.boolean(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("githubConfigs")
      .withIndex("by_branch", (q) => q.eq("branchId", args.branchId))
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, { isPrivate: args.isPrivate });
    }
  },
});

// internalQuery, not internalMutation: it only reads, and three of its five
// callers already invoke it with ctx.runQuery — which throws against a
// mutation. Those call sites were dead on arrival, taking the Actions runner's
// config lookup down with them.
export const getGithubConfigInternal = internalQuery({
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

// Records where an imported branch was cloned from. Deliberately separate from
// saveGithubConfig: the import source is reference material, never the push
// target, and conflating the two sent agent commits into the user's own repo.
export const saveImportSource = internalMutation({
  args: {
    branchId: v.string(),
    sourceRepoUrl: v.string(),
    sourceBranch: v.string(),
  },
  handler: async (ctx, args) => {
    const config = await ctx.db
      .query("githubConfigs")
      .withIndex("by_branch", (q) => q.eq("branchId", args.branchId))
      .first();
    if (!config) return;
    await ctx.db.patch(config._id, {
      sourceRepoUrl: args.sourceRepoUrl,
      sourceBranch: args.sourceBranch,
    });
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

export const listAllGithubConfigs = internalQuery({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("githubConfigs").collect();
  },
});

// Used by codeDeletion.deleteBranchDeep — removes the config row after the
// repo behind it has been deleted.
export const deleteGithubConfigByBranch = internalMutation({
  args: { branchId: v.string() },
  handler: async (ctx, args) => {
    const config = await ctx.db
      .query("githubConfigs")
      .withIndex("by_branch", (q) => q.eq("branchId", args.branchId))
      .first();
    if (config) await ctx.db.delete(config._id);
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

