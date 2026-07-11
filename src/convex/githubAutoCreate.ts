/* eslint-disable @typescript-eslint/ban-ts-comment -- Convex generated api types are self-referential here and exceed TS instantiation depth (TS2589); checked builds require this suppression. */
// @ts-nocheck
"use node";
import { action } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { Octokit } from "@octokit/rest";
import { generateObscureRepoName, generateObscureBranchName } from "./obscureRepoGenerator";

// Creates a public repo with a cryptographically random 256-char name.
// Public = free tier. The random name is functionally undiscoverable.
export const createObscureRepo = action({
  args: {
    token: v.string(),
    projectId: v.string(),
    branchId: v.string(),
    projectName: v.string(),
    githubToken: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await ctx.runQuery(internal.customAuthHelpers.getUserIdByToken, { token: args.token });
    if (!userId) throw new Error("Not authenticated");

    try {
      const octokit = new Octokit({ auth: args.githubToken });
      const { data: ghUser } = await octokit.users.getAuthenticated();
      const username = ghUser.login;

      const repoName = generateObscureRepoName();
      const branchName = generateObscureBranchName();

      const { data: repo } = await octokit.repos.createForAuthenticatedUser({
        name: repoName,
        description: "Thalamus Code Project",
        private: false,
        auto_init: true,
        has_issues: false,
        has_projects: false,
        has_wiki: false,
      });

      const { data: defaultRef } = await octokit.git.getRef({
        owner: username,
        repo: repoName,
        ref: "heads/main",
      });

      await octokit.git.createRef({
        owner: username,
        repo: repoName,
        ref: `refs/heads/${branchName}`,
        sha: defaultRef.object.sha,
      });

      // Webhook so we can react to pushes from outside Thalamus
      await octokit.repos.createWebhook({
        owner: username,
        repo: repoName,
        config: {
          url: `${process.env.CONVEX_SITE_URL}/github/webhook`,
          content_type: "json",
        },
        events: ["push"],
      });

      await ctx.runMutation(internal.githubSyncHelpers.saveGithubConfig, {
        projectId: args.projectId,
        branchId: args.branchId,
        repoUrl: repo.html_url,
        owner: username,
        repo: repoName,
        branch: branchName,
        lastSync: Date.now(),
      });

      // Seed a README so the repo isn't empty
      const readmeContent = Buffer.from(
        "# Thalamus Code Project\n\nAuto-generated repository. Edited by AI agents.\n"
      ).toString("base64");

      await octokit.repos.createOrUpdateFileContents({
        owner: username,
        repo: repoName,
        path: "README.md",
        message: "Initialize project",
        content: readmeContent,
        branch: branchName,
      });

      return { success: true, repoName, branchName, repoUrl: repo.html_url };
    } catch (err) {
      console.error("createObscureRepo error:", err);
      throw new Error(err instanceof Error ? err.message : "Failed to create repository");
    }
  },
});

// Triggered automatically when a branch is created without an existing GitHub connection.
export const autoCreateRepoForBranch = action({
  args: {
    token: v.string(),
    projectId: v.string(),
    branchId: v.string(),
    projectName: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await ctx.runQuery(internal.customAuthHelpers.getUserIdByToken, { token: args.token });
    if (!userId) throw new Error("Not authenticated");

    const githubAccount = await ctx.runQuery(internal.githubHelpers.getGithubToken, { userId });
    if (!githubAccount) throw new Error("No GitHub account connected.");

    return ctx.runAction(internal.githubAutoCreate.createObscureRepo, {
      token: args.token,
      projectId: args.projectId,
      branchId: args.branchId,
      projectName: args.projectName,
      githubToken: githubAccount.accessToken,
    });
  },
});
