/* eslint-disable @typescript-eslint/ban-ts-comment -- Convex generated api types are self-referential here and exceed TS instantiation depth (TS2589); checked builds require this suppression. */
// @ts-nocheck
"use node";
import { internalAction } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { Octokit } from "@octokit/rest";
import { generateObscureRepoName, generateObscureBranchName } from "./obscureRepoGenerator";

// Creates a public repo with a cryptographically random 256-char name.
// Public = free tier. The random name is functionally undiscoverable.
//
// internalAction, not action: every caller reaches this through `internal.*`,
// and a public function referenced that way does not resolve at runtime. This
// file is @ts-nocheck'd, so tsc never saw the mismatch — the repo simply never
// got created and the failure was swallowed by the caller's catch.
export const createObscureRepo = internalAction({
  args: {
    projectId: v.string(),
    branchId: v.string(),
    projectName: v.string(),
    githubToken: v.string(),
  },
  handler: async (ctx, args) => {
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

      // Store the token that created the repo alongside it. Every later
      // operation — agent pushes, Actions dispatch, webhook handling — has to
      // act as the identity that owns it; falling back to the platform's
      // GITHUB_TOKEN would try to write a user-owned repo and get a 404.
      await ctx.runMutation(internal.githubSyncHelpers.saveGithubConfigWithToken, {
        projectId: args.projectId,
        branchId: args.branchId,
        repoUrl: repo.html_url,
        owner: username,
        repo: repoName,
        branch: branchName,
        lastSync: Date.now(),
        githubToken: args.githubToken,
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

      return { success: true, owner: username, repoName, branchName, repoUrl: repo.html_url };
    } catch (err) {
      console.error("createObscureRepo error:", err);
      throw new Error(err instanceof Error ? err.message : "Failed to create repository");
    }
  },
});

// The one place a branch gets its platform repo. Idempotent: a branch that
// already has a GitHub config keeps it, so the scheduled call from
// createBranch and the inline call from an import can both run without
// racing each other into two repos.
//
// Returns the owner/repo/branch actually in force, or null when there is no
// usable token — callers decide whether that is fatal.
export const ensureRepoForBranch = internalAction({
  args: {
    userId: v.id("users"),
    projectId: v.string(),
    branchId: v.string(),
    projectName: v.string(),
  },
  handler: async (ctx, args): Promise<{ owner: string; repo: string; branch: string } | null> => {
    const existing = await ctx.runQuery(internal.githubSyncHelpers.getGithubConfigInternal, {
      projectId: args.projectId,
      branchId: args.branchId,
    });
    if (existing?.owner && existing.repo) {
      return { owner: existing.owner, repo: existing.repo, branch: existing.branch };
    }

    // No connected GitHub account? Fall back to the platform's own token so
    // the repo (and the GitHub Actions VM it doubles as) still gets created —
    // just owned by the platform account instead of the user's.
    const githubAccount = await ctx.runQuery(internal.githubHelpers.getGithubToken, { userId: args.userId });
    const githubToken = githubAccount?.accessToken || process.env.GITHUB_TOKEN;
    if (!githubToken) {
      console.error("ensureRepoForBranch: no user GitHub account and no GITHUB_TOKEN configured");
      return null;
    }

    const created = await ctx.runAction(internal.githubAutoCreate.createObscureRepo, {
      projectId: args.projectId,
      branchId: args.branchId,
      projectName: args.projectName,
      githubToken,
    });

    return { owner: created.owner, repo: created.repoName, branch: created.branchName };
  },
});

// Scheduled from createProject/createBranch — resolves the session, then hands
// off to the idempotent ensure above.
export const autoCreateRepoForBranch = internalAction({
  args: {
    token: v.string(),
    projectId: v.string(),
    branchId: v.string(),
    projectName: v.string(),
  },
  handler: async (ctx, args): Promise<void> => {
    const userId = await ctx.runQuery(internal.customAuthHelpers.getUserIdByToken, { token: args.token });
    if (!userId) throw new Error("Not authenticated");

    await ctx.runAction(internal.githubAutoCreate.ensureRepoForBranch, {
      userId,
      projectId: args.projectId,
      branchId: args.branchId,
      projectName: args.projectName,
    });
  },
});
