/* eslint-disable @typescript-eslint/ban-ts-comment -- Convex generated api types are self-referential here and exceed TS instantiation depth (TS2589); checked builds require this suppression. */
// @ts-nocheck
"use node";
import { action, internalAction } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { Octokit } from "@octokit/rest";
import { generateObscureRepoName, generateObscureBranchName } from "./lib/obscureRepoGenerator";

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
        auto_init: false,
        has_issues: false,
        has_projects: false,
        has_wiki: false,
      });

      // No auto_init means main is unborn — create an initial commit so the
      // ref exists, then fork the feature branch from it.
      const readmeContent = Buffer.from(
        "# Thalamus Code Project\n\nAuto-generated repository. Edited by AI agents.\n"
      ).toString("base64");

      const { data: created } = await octokit.repos.createOrUpdateFileContents({
        owner: username,
        repo: repoName,
        path: "README.md",
        message: "Initialize project",
        content: readmeContent,
        branch: "main",
      });

      await octokit.git.createRef({
        owner: username,
        repo: repoName,
        ref: `refs/heads/${branchName}`,
        sha: created.commit.sha,
      });

      // Webhook so we can react to pushes from outside Thalamus. Non-fatal:
      // it's a nice-to-have (reacting to external pushes), not something the
      // repo needs to be usable, and a permissions hiccup here used to take
      // the entire repo-creation attempt down with it — the repo would exist
      // on GitHub but saveGithubConfigWithToken below would never run, so
      // Thalamus would have no record of it and just fail the branch silently.
      try {
        await octokit.repos.createWebhook({
          owner: username,
          repo: repoName,
          config: {
            url: `${process.env.CONVEX_SITE_URL}/github/webhook`,
            content_type: "json",
          },
          events: ["push"],
        });
      } catch (webhookErr) {
        console.error("createWebhook failed, continuing without it:", webhookErr);
      }

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
// Returns the owner/repo/branch actually in force, or null on failure.
// Every failure path used to end in a bare console.error and a null return —
// invisible from a fire-and-forget scheduled action, so "no repo" and
// "briefly still creating one" looked identical to the user forever. Now the
// reason is written onto the branch (repoSetupError) so the UI can show it
// and offer a retry, instead of spinning "Preparing this branch" forever.
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
      const msg = "No GitHub account connected, and no platform GITHUB_TOKEN configured — "
        + "connect GitHub on this account, or ask an admin to set GITHUB_TOKEN.";
      await ctx.runMutation(internal.codeBranches.setRepoSetupError, { branchId: args.branchId, error: msg });
      return null;
    }

    try {
      const created = await ctx.runAction(internal.githubAutoCreate.createObscureRepo, {
        projectId: args.projectId,
        branchId: args.branchId,
        projectName: args.projectName,
        githubToken,
      });
      await ctx.runMutation(internal.codeBranches.setRepoSetupError, { branchId: args.branchId, error: null });
      return { owner: created.owner, repo: created.repoName, branch: created.branchName };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await ctx.runMutation(internal.codeBranches.setRepoSetupError, { branchId: args.branchId, error: msg });
      return null;
    }
  },
});

// Public retry entry point — the UI calls this when repoSetupError is set,
// e.g. after the user connects GitHub or an admin sets GITHUB_TOKEN. Reuses
// the same idempotent ensure, so it's safe even if creation actually
// succeeded moments after the error was last shown.
export const retryRepoSetup = action({
  args: {
    token: v.string(),
    projectId: v.string(),
    branchId: v.string(),
    projectName: v.string(),
  },
  handler: async (ctx, args): Promise<{ owner: string; repo: string; branch: string }> => {
    const userId = await ctx.runQuery(internal.customAuthHelpers.getUserIdByToken, { token: args.token });
    if (!userId) throw new Error("Not authenticated");

    const result = await ctx.runAction(internal.githubAutoCreate.ensureRepoForBranch, {
      userId,
      projectId: args.projectId,
      branchId: args.branchId,
      projectName: args.projectName,
    });
    if (!result) {
      const branch = await ctx.runQuery(internal.codeBranches.getBranchInternal, { branchId: args.branchId });
      throw new Error((branch as { repoSetupError?: string } | null)?.repoSetupError ?? "Failed to set up the repository");
    }
    return result;
  },
});

// Repairs every active branch that doesn't already have a platform repo —
// mainly the backlog of branches created while GITHUB_TOKEN was unset or a
// token was missing. Idempotent — skips branches that already have a config
// (ensureRepoForBranch checks this internally too), so it's safe to run
// repeatedly. Exposed as adminRepairOrphanRepos below; not scheduled anywhere
// on its own since a fixed forward path shouldn't need a recurring sweep.
export const createReposForOrphanBranches = internalAction({
  args: {},
  handler: async (ctx): Promise<{ created: number; skipped: number; errors: string[] }> => {
    const allBranches = await ctx.runQuery(internal.codeBranches.listAllBranchesInternal);
    const errors: string[] = [];
    let created = 0;
    let skipped = 0;

    for (const branch of allBranches) {
      const existing = await ctx.runQuery(internal.githubSyncHelpers.getGithubConfigInternal, {
        projectId: branch.projectId,
        branchId: branch.branchId,
      });
      if (existing?.owner && existing.repo) {
        skipped++;
        continue;
      }

      const project = await ctx.runQuery(internal.codeProjects.getProjectInternal, {
        projectId: branch.projectId,
      });
      if (!project) {
        errors.push(`No project found for branch ${branch.branchId}`);
        continue;
      }

      try {
        const result = await ctx.runAction(internal.githubAutoCreate.ensureRepoForBranch, {
          userId: project.userId,
          projectId: branch.projectId,
          branchId: branch.branchId,
          projectName: project.name,
        });
        if (result) {
          created++;
        } else {
          const refreshed = await ctx.runQuery(internal.codeBranches.getBranchInternal, { branchId: branch.branchId });
          errors.push(`Branch ${branch.branchId} (${branch.name}): ${(refreshed as { repoSetupError?: string } | null)?.repoSetupError ?? "unknown error"}`);
        }
      } catch (err) {
        errors.push(`Branch ${branch.branchId} (${branch.name}): ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    return { created, skipped, errors };
  },
});

// Admin-panel entry point for the repair sweep above — same ADMIN_TOKEN gate
// every other /admin action uses.
export const adminRepairOrphanRepos = action({
  args: { adminToken: v.string() },
  handler: async (ctx, args): Promise<{ created: number; skipped: number; errors: string[] }> => {
    if (!process.env.ADMIN_TOKEN || args.adminToken !== process.env.ADMIN_TOKEN) {
      throw new Error("Unauthorized");
    }
    return ctx.runAction(internal.githubAutoCreate.createReposForOrphanBranches, {});
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
