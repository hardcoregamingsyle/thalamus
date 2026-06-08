import { internalMutation, internalQuery, mutation } from "./_generated/server";
import { v } from "convex/values";

// Tracks the immutable GitHub repo integer ID so the same repo can't be
// re-imported under a fresh account to farm free credits.
export const getRepoFingerprint = internalQuery({
  args: { githubRepoId: v.number() },
  handler: async (ctx, args) => {
    return ctx.db
      .query("repoFingerprints")
      .withIndex("by_github_repo_id", (q) => q.eq("githubRepoId", args.githubRepoId))
      .first();
  },
});

export const upsertRepoFingerprint = internalMutation({
  args: {
    githubRepoId: v.number(),
    projectId: v.string(),
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("repoFingerprints")
      .withIndex("by_github_repo_id", (q) => q.eq("githubRepoId", args.githubRepoId))
      .first();

    if (existing) {
      // just bump lastSeen — never flip freeTierExhausted back to false
      await ctx.db.patch(existing._id, { lastSeenAt: Date.now() });
      return;
    }

    await ctx.db.insert("repoFingerprints", {
      githubRepoId: args.githubRepoId,
      projectId: args.projectId,
      userId: args.userId,
      freeTierExhausted: false,
      firstSeenAt: Date.now(),
      lastSeenAt: Date.now(),
    });
  },
});

// Structural hash: SHA-256 over sorted file paths (node_modules etc. excluded).
// Two copies of the same codebase produce identical hashes regardless of repo name.
export const getStructureFingerprint = internalQuery({
  args: { structureHash: v.string() },
  handler: async (ctx, args) => {
    return ctx.db
      .query("structureFingerprints")
      .withIndex("by_structure_hash", (q) => q.eq("structureHash", args.structureHash))
      .first();
  },
});

export const upsertStructureFingerprint = internalMutation({
  args: {
    structureHash: v.string(),
    projectId: v.string(),
    userId: v.id("users"),
    fileCount: v.number(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("structureFingerprints")
      .withIndex("by_structure_hash", (q) => q.eq("structureHash", args.structureHash))
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, { lastSeenAt: Date.now() });
      return;
    }

    await ctx.db.insert("structureFingerprints", {
      structureHash: args.structureHash,
      projectId: args.projectId,
      userId: args.userId,
      freeTierExhausted: false,
      firstSeenAt: Date.now(),
      lastSeenAt: Date.now(),
      fileCount: args.fileCount,
    });
  },
});

// Flip every fingerprint tied to a project to exhausted.
// Called explicitly (admin panel) or automatically when credits hit zero.
export const markProjectFingerprints = internalMutation({
  args: { projectId: v.string() },
  handler: async (ctx, args) => {
    const repoFps = await ctx.db
      .query("repoFingerprints")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .collect();

    for (const fp of repoFps) {
      await ctx.db.patch(fp._id, { freeTierExhausted: true });
    }

    const structFps = await ctx.db
      .query("structureFingerprints")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .collect();

    for (const fp of structFps) {
      await ctx.db.patch(fp._id, { freeTierExhausted: true });
    }
  },
});

// Admin panel endpoint — mark a project's fingerprints as exhausted so any
// future re-import of the same repo/codebase is blocked, regardless of account.
export const markProjectFreeTierExhausted = mutation({
  args: {
    token: v.string(),
    projectId: v.string(),
  },
  handler: async (ctx, args) => {
    const sessions = await ctx.db
      .query("customSessions")
      .withIndex("by_token", (q) => q.eq("token", args.token))
      .take(1);
    const session = sessions[0];
    if (!session || session.expiresAt < Date.now()) throw new Error("Not authenticated");

    const user = await ctx.db.get(session.userId);
    if (!user || user.role !== "admin") throw new Error("Admin only");

    const repoFps = await ctx.db
      .query("repoFingerprints")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .collect();
    for (const fp of repoFps) await ctx.db.patch(fp._id, { freeTierExhausted: true });

    const structFps = await ctx.db
      .query("structureFingerprints")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .collect();
    for (const fp of structFps) await ctx.db.patch(fp._id, { freeTierExhausted: true });
  },
});

// Called after credit deduction in the pipeline. Marks fingerprints exhausted
// when the user has zero balance, zero daily credits, and zero purchased credits.
export const autoMarkExhaustedIfBalanceDepleted = internalMutation({
  args: {
    userId: v.id("users"),
    projectId: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId);
    if (!user) return;

    const hasCredits =
      (user.agentBucksBalance ?? 0) > 0 ||
      (user.purchasedAgentBucks ?? 0) > 0 ||
      (user.dailyAgentBucks ?? 0) > 0;

    if (hasCredits) return;

    const repoFps = await ctx.db
      .query("repoFingerprints")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .collect();
    for (const fp of repoFps) {
      if (!fp.freeTierExhausted) await ctx.db.patch(fp._id, { freeTierExhausted: true });
    }

    const structFps = await ctx.db
      .query("structureFingerprints")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .collect();
    for (const fp of structFps) {
      if (!fp.freeTierExhausted) await ctx.db.patch(fp._id, { freeTierExhausted: true });
    }
  },
});
