import { internalMutation, internalQuery } from "./_generated/server";
import { v } from "convex/values";

// NOTE: `freeTierExhausted` on repoFingerprints / structureFingerprints has no
// automated writer. An operator can flip it manually from the Convex dashboard;
// githubSync.ts refuses imports for any fingerprint whose flag is set.

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

