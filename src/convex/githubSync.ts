"use node";
import { action } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { Octokit } from "@octokit/rest";

// Clone repository and sync files to branch
export const cloneRepository = action({
  args: {
    token: v.string(),
    projectId: v.string(),
    branchId: v.string(),
    repoUrl: v.string(),
    githubToken: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await ctx.runQuery(internal.customAuthHelpers.getUserIdByToken, { token: args.token });
    if (!userId) throw new Error("Not authenticated");

    try {
      const urlMatch = args.repoUrl.match(/github\.com\/([^\/]+)\/([^\/\.]+)/);
      if (!urlMatch) throw new Error("Invalid GitHub URL");

      const [, owner, repo] = urlMatch;

      const octokit = new Octokit({
        auth: args.githubToken || process.env.GITHUB_TOKEN,
      });

      const { data: repoData } = await octokit.repos.get({ owner, repo });
      const defaultBranch = repoData.default_branch;

      const { data: tree } = await octokit.git.getTree({
        owner,
        repo,
        tree_sha: defaultBranch,
        recursive: "true",
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

      await ctx.runMutation(internal.githubSyncHelpers.saveGithubConfig, {
        projectId: args.projectId,
        branchId: args.branchId,
        repoUrl: args.repoUrl,
        owner,
        repo,
        branch: defaultBranch,
        lastSync: Date.now(),
      });

      return {
        success: true,
        filesCloned,
        repo: `${owner}/${repo}`,
        branch: defaultBranch,
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
      const config = await ctx.runMutation(internal.githubSyncHelpers.getGithubConfig, {
        projectId: args.projectId,
        branchId: args.branchId,
      });

      if (!config) throw new Error("No GitHub repository connected");

      const files = await ctx.runQuery(internal.codeBranches.getFilesInternal, {
        branchId: args.branchId,
      });

      const octokit = new Octokit({
        auth: args.githubToken || process.env.GITHUB_TOKEN,
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
      const config = await ctx.runMutation(internal.githubSyncHelpers.getGithubConfig, {
        projectId: args.projectId,
        branchId: args.branchId,
      });

      if (!config) throw new Error("No GitHub repository connected");

      const octokit = new Octokit({
        auth: args.githubToken || process.env.GITHUB_TOKEN,
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
