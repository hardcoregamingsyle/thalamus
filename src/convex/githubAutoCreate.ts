// @ts-nocheck
"use node";
import { action } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { Octokit } from "@octokit/rest";
import { generateObscureRepoName, generateObscureBranchName } from "./obscureRepoGenerator";

/**
 * Automatically create obscure GitHub repo for a branch
 * Repo is PUBLIC but name is so random it's impossible to find
 * This saves $4/month per project vs private repos
 */

export const createObscureRepo = action({
  args: {
    token: v.string(),
    projectId: v.string(),
    branchId: v.string(),
    projectName: v.string(),
    githubToken: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await ctx.runQuery(internal.customAuthHelpers.getUserIdByToken, {
      token: args.token,
    });
    if (!userId) throw new Error("Not authenticated");

    try {
      const octokit = new Octokit({ auth: args.githubToken });

      // Get GitHub username
      const { data: user } = await octokit.users.getAuthenticated();
      const username = user.login;

      // Generate obscure repo name (256 chars, effectively impossible to find)
      const obscureRepoName = generateObscureRepoName();

      // Create public repo (FREE)
      const { data: repo } = await octokit.repos.createForAuthenticatedUser({
        name: obscureRepoName,
        description: `Thalamus Code Project`, // Generic description
        private: false, // PUBLIC = FREE
        auto_init: true, // Create with README
        has_issues: false,
        has_projects: false,
        has_wiki: false,
      });

      // Create obscure branch name
      const obscureBranchName = generateObscureBranchName();

      // Get default branch ref
      const { data: defaultRef } = await octokit.git.getRef({
        owner: username,
        repo: obscureRepoName,
        ref: "heads/main",
      });

      // Create new obscure branch
      await octokit.git.createRef({
        owner: username,
        repo: obscureRepoName,
        ref: `refs/heads/${obscureBranchName}`,
        sha: defaultRef.object.sha,
      });

      // Configure webhook for this repo
      await octokit.repos.createWebhook({
        owner: username,
        repo: obscureRepoName,
        config: {
          url: `${process.env.CONVEX_SITE_URL}/github/webhook`,
          content_type: "json",
        },
        events: ["push"],
      });

      // Save GitHub config
      await ctx.runMutation(internal.githubSyncHelpers.saveGithubConfig, {
        projectId: args.projectId,
        branchId: args.branchId,
        repoUrl: repo.html_url,
        owner: username,
        repo: obscureRepoName,
        branch: obscureBranchName,
        lastSync: Date.now(),
      });

      // Add initial README explaining this is a Thalamus project
      const readmeContent = Buffer.from(
        `# Thalamus Code Project\n\nThis is an automatically generated repository for a Thalamus Code project.\n\nEdited by AI agents in real-time.`
      ).toString("base64");

      await octokit.repos.createOrUpdateFileContents({
        owner: username,
        repo: obscureRepoName,
        path: "README.md",
        message: "Initialize Thalamus project",
        content: readmeContent,
        branch: obscureBranchName,
      });

      return {
        success: true,
        repoName: obscureRepoName,
        branchName: obscureBranchName,
        repoUrl: repo.html_url,
        isPublic: true,
        monthlyCost: 0, // FREE!
        securityNote: "Public repo with cryptographically random name - effectively impossible to discover",
      };
    } catch (err) {
      console.error("Create obscure repo error:", err);
      throw new Error(err instanceof Error ? err.message : "Failed to create repository");
    }
  },
});

/**
 * Auto-create obscure repo when branch is created without GitHub connection
 */
export const autoCreateRepoForBranch = action({
  args: {
    token: v.string(),
    projectId: v.string(),
    branchId: v.string(),
    projectName: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await ctx.runQuery(internal.customAuthHelpers.getUserIdByToken, {
      token: args.token,
    });
    if (!userId) throw new Error("Not authenticated");

    // Check if user has GitHub token
    const githubAccount = await ctx.runQuery(internal.githubHelpers.getGithubToken, {
      userId,
    });

    if (!githubAccount) {
      throw new Error("No GitHub account connected. Please connect GitHub first.");
    }

    return await ctx.runAction(internal.githubAutoCreate.createObscureRepo, {
      token: args.token,
      projectId: args.projectId,
      branchId: args.branchId,
      projectName: args.projectName,
      githubToken: githubAccount.accessToken,
    });
  },
});
