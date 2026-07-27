/* eslint-disable @typescript-eslint/ban-ts-comment -- Convex generated api types are self-referential here and exceed TS instantiation depth (TS2589); checked builds require this suppression. */
// @ts-nocheck
"use node";
import { action, internalAction } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { Id } from "./_generated/dataModel";
import { Octokit } from "@octokit/rest";
import crypto from "crypto";

// The user's own OAuth-connected token beats an explicitly-passed one (there's
// no PAT-entry UI left to pass one anyway) beats the platform's fallback token.
async function resolveGithubToken(
  ctx: { runQuery: (ref: unknown, args: unknown) => Promise<unknown> },
  userId: Id<"users">,
  explicit?: string,
): Promise<string | undefined> {
  const account = await ctx.runQuery(internal.githubHelpers.getGithubToken, { userId }) as { accessToken: string } | null;
  return account?.accessToken || explicit || process.env.GITHUB_TOKEN;
}

// SHA-256 over sorted file paths, ignoring build artifacts.
// Path-only (no content) so trivial edits don't evade the fingerprint.
const IGNORE_PREFIXES = [
  "node_modules/", ".git/", "dist/", "build/", ".next/", ".nuxt/",
  ".output/", "__pycache__/", ".venv/", "venv/", ".mypy_cache/",
  ".pytest_cache/", "target/", ".gradle/",
];

function computeStructureHash(filePaths: string[]): string {
  const filtered = filePaths
    .filter((p) => !IGNORE_PREFIXES.some((pre) => p.toLowerCase().startsWith(pre)))
    .map((p) => p.toLowerCase().replace(/\\/g, "/").trim())
    .sort();
  return crypto.createHash("sha256").update(filtered.join("\n")).digest("hex");
}

// Import a GitHub repo into a Thalamus branch.
//
// The source repo is READ-ONLY here. Source control for the branch stays on
// the platform-side repo we create for it (see ensureRepoForBranch) — that is
// what agents commit to and what GitHub Actions runs commands in. Writing the
// user's own repo into githubConfigs, as this used to, pointed every
// subsequent agent push and workflow dispatch at their real repository.
export const cloneRepository = action({
  args: {
    token: v.string(),
    projectId: v.string(),
    branchId: v.string(),
    repoUrl: v.string(),
    // Which branch of the source repo to import. Defaults to its default branch.
    sourceBranch: v.optional(v.string()),
    projectName: v.optional(v.string()),
    githubToken: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = (await ctx.runQuery(internal.customAuthHelpers.getUserIdByToken, { token: args.token })) as Id<"users"> | null;
    if (!userId) throw new Error("Not authenticated");

    try {
      const urlMatch = args.repoUrl.match(/github\.com\/([^/]+)\/([^/.]+)/);
      if (!urlMatch) throw new Error("Invalid GitHub URL");

      const [, owner, repo] = urlMatch;

      const octokit = new Octokit({
        auth: await resolveGithubToken(ctx, userId, args.githubToken),
      });

      const { data: repoData } = await octokit.repos.get({ owner, repo });
      const sourceBranch = args.sourceBranch || repoData.default_branch;

      const { data: tree } = await octokit.git.getTree({
        owner,
        repo,
        tree_sha: sourceBranch,
        recursive: "true",
      });

      // Block imports from repos/codebases that already burned through free tier
      const githubRepoId: number = repoData.id;
      const repoFp = await ctx.runQuery(internal.antiEvasionDb.getRepoFingerprint, { githubRepoId });
      if (repoFp?.freeTierExhausted) {
        throw new Error("This repository's free-tier credits are exhausted. Upgrade to continue.");
      }

      const allPaths = tree.tree
        .filter((item) => item.type === "blob" && item.path)
        .map((item) => item.path as string);

      const structureHash = computeStructureHash(allPaths);
      const structFp = await ctx.runQuery(internal.antiEvasionDb.getStructureFingerprint, { structureHash });
      if (structFp?.freeTierExhausted) {
        throw new Error("This codebase's free-tier credits are exhausted. Upgrade to continue.");
      }

      // Record fingerprints — safe to call on subsequent imports (upsert)
      await ctx.runMutation(internal.antiEvasionDb.upsertRepoFingerprint, {
        githubRepoId,
        projectId: args.projectId,
        userId,
      });
      await ctx.runMutation(internal.antiEvasionDb.upsertStructureFingerprint, {
        structureHash,
        projectId: args.projectId,
        userId,
        fileCount: allPaths.length,
      });

      let filesCloned = 0;

      for (const item of tree.tree) {
        if (item.type === "blob" && item.path && item.sha) {
          try {
            const { data: blob } = await octokit.git.getBlob({
              owner,
              repo,
              file_sha: item.sha,
            });

            const content = Buffer.from(blob.content, "base64").toString("utf-8");

            await ctx.runMutation(internal.codeBranches.upsertFile, {
              branchId: args.branchId,
              filepath: item.path,
              content,
              agent: "GitHub Clone",
            });

            filesCloned++;
          } catch (err) {
            console.error(`Failed to clone ${item.path}:`, err);
          }
        }
      }

      // Give the branch its own platform repo (idempotent) and record where
      // the code came from. Only after this does the branch have somewhere to
      // push to and somewhere for Actions to run.
      const platform = await ctx.runAction(internal.githubAutoCreate.ensureRepoForBranch, {
        userId,
        projectId: args.projectId,
        branchId: args.branchId,
        projectName: args.projectName || repo,
      });

      await ctx.runMutation(internal.githubSyncHelpers.saveImportSource, {
        branchId: args.branchId,
        sourceRepoUrl: args.repoUrl,
        sourceBranch,
      });

      // Seed the platform repo with what we just imported, so source control
      // and the Actions runner start from the real code rather than an empty
      // README. Non-fatal: the files are already in Convex either way.
      if (platform) {
        await ctx.runAction(internal.githubSync.autoPushToGithub, {
          branchId: args.branchId,
          commitMessage: `Import ${owner}/${repo}@${sourceBranch}`,
        });
      }

      return {
        success: true,
        filesCloned,
        source: `${owner}/${repo}`,
        sourceBranch,
        repo: platform ? `${platform.owner}/${platform.repo}` : null,
        branch: platform?.branch ?? null,
      };
    } catch (err) {
      console.error("Clone error:", err);
      throw new Error(err instanceof Error ? err.message : "Failed to clone repository");
    }
  },
});

// Push changes back to GitHub
export const pushToGithub = action({
  args: {
    token: v.string(),
    projectId: v.string(),
    branchId: v.string(),
    commitMessage: v.string(),
    githubToken: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await ctx.runQuery(internal.customAuthHelpers.getUserIdByToken, { token: args.token });
    if (!userId) throw new Error("Not authenticated");

    try {
      const config = await ctx.runQuery(internal.githubSyncHelpers.getGithubConfigInternal, {
        projectId: args.projectId,
        branchId: args.branchId,
      });

      if (!config) throw new Error("No GitHub repository connected");

      const files = await ctx.runQuery(internal.codeBranches.getFilesInternal, {
        branchId: args.branchId,
      });

      const octokit = new Octokit({
        auth: await resolveGithubToken(ctx, userId, args.githubToken),
      });

      const { data: refData } = await octokit.git.getRef({
        owner: config.owner,
        repo: config.repo,
        ref: `heads/${config.branch}`,
      });

      const latestCommitSha = refData.object.sha;

      const { data: commitData } = await octokit.git.getCommit({
        owner: config.owner,
        repo: config.repo,
        commit_sha: latestCommitSha,
      });

      const baseTreeSha = commitData.tree.sha;

      const tree = await Promise.all(
        files.map(async (file) => {
          const { data: blob } = await octokit.git.createBlob({
            owner: config.owner,
            repo: config.repo,
            content: Buffer.from(file.content).toString("base64"),
            encoding: "base64",
          });

          return {
            path: file.filepath,
            mode: "100644" as const,
            type: "blob" as const,
            sha: blob.sha,
          };
        })
      );

      const { data: newTree } = await octokit.git.createTree({
        owner: config.owner,
        repo: config.repo,
        tree,
        base_tree: baseTreeSha,
      });

      const { data: newCommit } = await octokit.git.createCommit({
        owner: config.owner,
        repo: config.repo,
        message: args.commitMessage || "Update from Thalamus AI",
        tree: newTree.sha,
        parents: [latestCommitSha],
      });

      await octokit.git.updateRef({
        owner: config.owner,
        repo: config.repo,
        ref: `heads/${config.branch}`,
        sha: newCommit.sha,
      });

      await ctx.runMutation(internal.githubSyncHelpers.updateLastSync, {
        projectId: args.projectId,
        branchId: args.branchId,
      });

      return {
        success: true,
        commitSha: newCommit.sha,
        filesUpdated: files.length,
      };
    } catch (err) {
      console.error("Push error:", err);
      throw new Error(err instanceof Error ? err.message : "Failed to push to GitHub");
    }
  },
});

// Auto-push to GitHub (internal, no auth check)
export const autoPushToGithub = internalAction({
  args: {
    branchId: v.string(),
    commitMessage: v.string(),
  },
  handler: async (ctx, args) => {
    try {
      const branch = await ctx.runQuery(internal.codeBranches.getBranchInternal, {
        branchId: args.branchId,
      });

      if (!branch) return;

      const config = await ctx.runQuery(internal.githubSyncHelpers.getGithubConfigInternal, {
        projectId: branch.projectId,
        branchId: args.branchId,
      });

      if (!config) return; // No GitHub repo connected, skip push

      const files = await ctx.runQuery(internal.codeBranches.getFilesInternal, {
        branchId: args.branchId,
      });

      const octokit = new Octokit({
        auth: config.githubToken || process.env.GITHUB_TOKEN,
      });

      const { data: refData } = await octokit.git.getRef({
        owner: config.owner,
        repo: config.repo,
        ref: `heads/${config.branch}`,
      });

      const latestCommitSha = refData.object.sha;

      const { data: commitData } = await octokit.git.getCommit({
        owner: config.owner,
        repo: config.repo,
        commit_sha: latestCommitSha,
      });

      const baseTreeSha = commitData.tree.sha;

      const tree = await Promise.all(
        files.map(async (file) => {
          const { data: blob } = await octokit.git.createBlob({
            owner: config.owner,
            repo: config.repo,
            content: Buffer.from(file.content).toString("base64"),
            encoding: "base64",
          });

          return {
            path: file.filepath,
            mode: "100644" as const,
            type: "blob" as const,
            sha: blob.sha,
          };
        })
      );

      const { data: newTree } = await octokit.git.createTree({
        owner: config.owner,
        repo: config.repo,
        tree,
        base_tree: baseTreeSha,
      });

      const { data: newCommit } = await octokit.git.createCommit({
        owner: config.owner,
        repo: config.repo,
        message: args.commitMessage || "Update from Thalamus AI",
        tree: newTree.sha,
        parents: [latestCommitSha],
      });

      await octokit.git.updateRef({
        owner: config.owner,
        repo: config.repo,
        ref: `heads/${config.branch}`,
        sha: newCommit.sha,
      });

      await ctx.runMutation(internal.githubSyncHelpers.updateLastSync, {
        projectId: branch.projectId,
        branchId: args.branchId,
      });
    } catch (err) {
      console.error("Auto-push error:", err);
      // Silent fail - don't block pipeline
    }
  },
});

// Pull latest changes from GitHub
export const pullFromGithub = action({
  args: {
    token: v.string(),
    projectId: v.string(),
    branchId: v.string(),
    githubToken: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await ctx.runQuery(internal.customAuthHelpers.getUserIdByToken, { token: args.token });
    if (!userId) throw new Error("Not authenticated");

    try {
      const config = await ctx.runQuery(internal.githubSyncHelpers.getGithubConfigInternal, {
        projectId: args.projectId,
        branchId: args.branchId,
      });

      if (!config) throw new Error("No GitHub repository connected");

      const octokit = new Octokit({
        auth: await resolveGithubToken(ctx, userId, args.githubToken),
      });

      const { data: tree } = await octokit.git.getTree({
        owner: config.owner,
        repo: config.repo,
        tree_sha: config.branch,
        recursive: "true",
      });

      let filesPulled = 0;

      for (const item of tree.tree) {
        if (item.type === "blob" && item.path && item.sha) {
          try {
            const { data: blob } = await octokit.git.getBlob({
              owner: config.owner,
              repo: config.repo,
              file_sha: item.sha,
            });

            const content = Buffer.from(blob.content, "base64").toString("utf-8");

            await ctx.runMutation(internal.codeBranches.upsertFile, {
              branchId: args.branchId,
              filepath: item.path,
              content,
              agent: "GitHub Pull",
            });

            filesPulled++;
          } catch (err) {
            console.error(`Failed to pull ${item.path}:`, err);
          }
        }
      }

      await ctx.runMutation(internal.githubSyncHelpers.updateLastSync, {
        projectId: args.projectId,
        branchId: args.branchId,
      });

      return {
        success: true,
        filesPulled,
      };
    } catch (err) {
      console.error("Pull error:", err);
      throw new Error(err instanceof Error ? err.message : "Failed to pull from GitHub");
    }
  },
});
