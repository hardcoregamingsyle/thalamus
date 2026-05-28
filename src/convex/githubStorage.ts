// @ts-nocheck
"use node";
import { internalAction, internalQuery } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { Octokit } from "@octokit/rest";

/**
 * GitHub as primary storage for codebase files
 * This reduces Convex storage costs by storing all files on GitHub
 * Convex only stores metadata and recent cache
 */

// Fetch file content from GitHub
export const getFileFromGithub = internalAction({
  args: {
    branchId: v.string(),
    filepath: v.string(),
  },
  handler: async (ctx, args) => {
    try {
      const branch = await ctx.runQuery(internal.codeBranches.getBranchInternal, {
        branchId: args.branchId,
      });

      if (!branch) return null;

      const config = await ctx.runQuery(internal.githubSyncHelpers.getGithubConfig, {
        projectId: branch.projectId,
        branchId: args.branchId,
      });

      if (!config) {
        // No GitHub repo, fall back to Convex storage
        return await ctx.runQuery(internal.githubStorage.getFileFromConvex, {
          branchId: args.branchId,
          filepath: args.filepath,
        });
      }

      const octokit = new Octokit({
        auth: config.githubToken || process.env.GITHUB_TOKEN,
      });

      try {
        const { data } = await octokit.repos.getContent({
          owner: config.owner,
          repo: config.repo,
          path: args.filepath,
          ref: config.branch,
        });

        if ("content" in data) {
          const content = Buffer.from(data.content, "base64").toString("utf-8");
          return { filepath: args.filepath, content, source: "github" };
        }
      } catch (err) {
        // File not found on GitHub, check Convex
        return await ctx.runQuery(internal.githubStorage.getFileFromConvex, {
          branchId: args.branchId,
          filepath: args.filepath,
        });
      }

      return null;
    } catch (err) {
      console.error("Get file from GitHub error:", err);
      return null;
    }
  },
});

// Get file from Convex (fallback)
export const getFileFromConvex = internalQuery({
  args: {
    branchId: v.string(),
    filepath: v.string(),
  },
  handler: async (ctx, args) => {
    const file = await ctx.db
      .query("codeFiles")
      .withIndex("by_branch_and_filepath", (q) =>
        q.eq("branchId", args.branchId).eq("filepath", args.filepath)
      )
      .first();

    if (!file) return null;

    return {
      filepath: file.filepath,
      content: file.content,
      source: "convex",
    };
  },
});

// List all files (from GitHub first, Convex as fallback)
export const listFilesFromGithub = internalAction({
  args: {
    branchId: v.string(),
  },
  handler: async (ctx, args) => {
    try {
      const branch = await ctx.runQuery(internal.codeBranches.getBranchInternal, {
        branchId: args.branchId,
      });

      if (!branch) return [];

      const config = await ctx.runQuery(internal.githubSyncHelpers.getGithubConfig, {
        projectId: branch.projectId,
        branchId: args.branchId,
      });

      if (!config) {
        // No GitHub repo, use Convex storage
        return await ctx.runQuery(internal.codeBranches.getFilesInternal, {
          branchId: args.branchId,
        });
      }

      const octokit = new Octokit({
        auth: config.githubToken || process.env.GITHUB_TOKEN,
      });

      const { data: tree } = await octokit.git.getTree({
        owner: config.owner,
        repo: config.repo,
        tree_sha: config.branch,
        recursive: "true",
      });

      const files = [];

      for (const item of tree.tree) {
        if (item.type === "blob" && item.path) {
          files.push({
            filepath: item.path,
            sha: item.sha,
            source: "github",
          });
        }
      }

      return files;
    } catch (err) {
      console.error("List files from GitHub error:", err);
      // Fallback to Convex
      return await ctx.runQuery(internal.codeBranches.getFilesInternal, {
        branchId: args.branchId,
      });
    }
  },
});

// Clean up old Convex files after successful GitHub push
export const cleanupConvexFiles = internalAction({
  args: {
    branchId: v.string(),
    keepRecent: v.number(), // How many recent files to keep in Convex cache
  },
  handler: async (ctx, args) => {
    try {
      const files = await ctx.runQuery(internal.codeBranches.getFilesInternal, {
        branchId: args.branchId,
      });

      // Keep only the most recent N files in Convex
      const sorted = files.sort((a, b) => b._creationTime - a._creationTime);
      const toDelete = sorted.slice(args.keepRecent);

      for (const file of toDelete) {
        await ctx.runMutation(internal.githubStorage.deleteFileFromConvex, {
          fileId: file._id,
        });
      }

      return { deleted: toDelete.length, kept: args.keepRecent };
    } catch (err) {
      console.error("Cleanup Convex files error:", err);
      return { deleted: 0, kept: 0 };
    }
  },
});

// Delete file from Convex
export const deleteFileFromConvex = internalMutation({
  args: {
    fileId: v.id("codeFiles"),
  },
  handler: async (ctx, args) => {
    await ctx.db.delete(args.fileId);
  },
});
