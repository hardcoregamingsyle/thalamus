"use node";
import { action, internalAction } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { Octokit } from "@octokit/rest";
import type { Id } from "./_generated/dataModel";
import { generateReadableRepoName, generateObscureBranchName, randomDigits } from "./lib/obscureRepoGenerator";

// Shape of the value ensureRepoForBranch's caller (createObscureRepo) returns.
// Duplicated locally so the self-referential internal.githubAutoCreate.*
// chain doesn't blow past TS instantiation depth.
type CreatedRepo = {
  success: boolean;
  owner: string;
  repoName: string;
  branchName: string;
  repoUrl: string;
};

type GithubConfigRow = {
  owner?: string;
  repo?: string;
  branch: string;
} | null;

// GitHub repo names: lowercase letters, digits, hyphens, underscores; no
// leading/trailing hyphen, max 100 chars. The Thalamus branch name is the
// default, so anything a user types gets normalized instead of rejected.
export function sanitizeRepoName(name: string): string {
  const cleaned = name
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^[-_]+/, "")
    .replace(/[-_]+$/, "");
  if (!cleaned) return "";
  return cleaned.length > 100 ? cleaned.slice(0, 100) : cleaned;
}

// Creates a public repo under the CALLER'S OWN GitHub account — the user sees
// this repo on their profile, so the name should read like a project, not like
// a token. Named after the branch the user gave inside Thalamus when one is
// requested (the Git Sync create box, and the default for the auto-create
// path); without a usable name it falls back to a readable three-word +
// six-digit name (e.g. "ancient-autumn-azure-482913"). Public = free tier;
// collisions on a requested name get a -2, -3, ... suffix instead of failing.
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
    requestedName: v.optional(v.string()),
    // The Git Sync tab's Repo Status choice. Defaults public (free unlimited
    // Actions minutes); a private repo is created when the user asks for one.
    isPrivate: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<CreatedRepo> => {
    try {
      const octokit = new Octokit({ auth: args.githubToken });
      const { data: ghUser } = await octokit.users.getAuthenticated();
      const username = ghUser.login;

      const branchName = generateObscureBranchName();
      const requestedName = args.requestedName ? sanitizeRepoName(args.requestedName) : "";
      let repoName = requestedName || generateReadableRepoName();

      // A 422 from createForAuthenticatedUser is almost always "name already
      // exists on this account". Honour the requested name first (plain, then
      // -2 … -5); when even those are taken — the common case being many
      // branches all named "main" fighting over the same five names — fall
      // back to a random digit tag. A name collision is a cosmetic problem
      // and must never be able to kill the branch's repository: the branch
      // gets its repo as <name>-<tag> and the user sees the real URL in the
      // Git Sync tab. The readable default is collision-safe by construction,
      // so a 422 there is not retried.
      let repo: { html_url: string } | null = null;
      const tried: string[] = [];
      for (let attempt = 0; attempt < 8 && !repo; attempt++) {
        if (attempt > 0 && requestedName) {
          repoName = attempt <= 4
            ? `${requestedName}-${attempt + 1}`
            // 93 + hyphen + 4 digits stays under GitHub's 100-char repo cap.
            : `${requestedName.slice(0, 93)}-${randomDigits(4)}`;
        }
        tried.push(repoName);
        try {
          const { data } = await octokit.repos.createForAuthenticatedUser({
            name: repoName,
            description: "Thalamus Code Project",
            private: args.isPrivate ?? false,
            auto_init: false,
            has_issues: false,
            has_projects: false,
            has_wiki: false,
          });
          repo = data;
        } catch (err) {
          const status =
            (err as { status?: number; response?: { status?: number } })?.status ??
            (err as { response?: { status?: number } })?.response?.status;
          if (status === 422 && requestedName) {
            continue;
          }
          throw err;
        }
      }
      if (!repo) {
        throw new Error(
          `Could not create the repository on ${username}'s GitHub account — every name variant was taken (${tried.join(", ")}). `
          + `Pick a different repo name in this branch's Git Sync tab and sync again.`,
        );
      }

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

      // Octokit types the initial commit's sha as optional even though it is
      // always present on a successful createOrUpdateFileContents — assert
      // rather than silently pass undefined as the ref target, which GitHub
      // would 422 with a cryptic message.
      const initialSha = created.commit.sha;
      if (!initialSha) {
        throw new Error("GitHub returned no SHA for the initial commit");
      }
      await octokit.git.createRef({
        owner: username,
        repo: repoName,
        ref: `refs/heads/${branchName}`,
        sha: initialSha,
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
        ...(args.isPrivate === undefined ? {} : { isPrivate: args.isPrivate }),
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
    requestedName: v.optional(v.string()),
    isPrivate: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<{ owner: string; repo: string; branch: string } | null> => {
    const existing: GithubConfigRow = await ctx.runQuery(internal.githubSyncHelpers.getGithubConfigInternal, {
      projectId: args.projectId,
      branchId: args.branchId,
    });
    if (existing?.owner && existing.repo) {
      return { owner: existing.owner, repo: existing.repo, branch: existing.branch };
    }

    // Name the repo after the branch the user gave it inside Thalamus. The
    // scheduled auto-create path passes no name, so resolve it here; callers
    // like createRepoWithName (Git Sync tab) pass their own.
    let requestedName = args.requestedName ?? "";
    if (!requestedName) {
      const branchRow: { name?: string } | null = await ctx.runQuery(internal.codeBranches.getBranchInternal, { branchId: args.branchId });
      requestedName = branchRow?.name ?? "";
    }

    // No connected GitHub account? The repo must live on the USER's personal
    // account (that is the account the sync operates against), so there is no
    // platform-token fallback here: without a user token the repo is not
    // created and the UI is told to connect GitHub and retry.
    const githubAccount: { accessToken?: string } | null = await ctx.runQuery(internal.githubHelpers.getGithubToken, { userId: args.userId });
    const githubToken = githubAccount?.accessToken;
    if (!githubToken) {
      const msg = "No GitHub account connected — connect GitHub on this account to create the project repository, then retry.";
      await ctx.runMutation(internal.codeBranches.setRepoSetupError, { branchId: args.branchId, error: msg });
      return null;
    }

    try {
      const created: CreatedRepo = await ctx.runAction(internal.githubAutoCreate.createObscureRepo, {
        projectId: args.projectId,
        branchId: args.branchId,
        projectName: args.projectName,
        githubToken,
        requestedName,
        ...(args.isPrivate === undefined ? {} : { isPrivate: args.isPrivate }),
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
    const userId: Id<"users"> | null = await ctx.runQuery(internal.customAuthHelpers.getUserIdByToken, { token: args.token });
    if (!userId) throw new Error("Not authenticated");

    const result: { owner: string; repo: string; branch: string } | null = await ctx.runAction(internal.githubAutoCreate.ensureRepoForBranch, {
      userId,
      projectId: args.projectId,
      branchId: args.branchId,
      projectName: args.projectName,
    });
    if (!result) {
      const branch: { repoSetupError?: string } | null = await ctx.runQuery(internal.codeBranches.getBranchInternal, { branchId: args.branchId });
      throw new Error(branch?.repoSetupError ?? "Failed to set up the repository");
    }
    return result;
  },
});

// Public entry point for the Git Sync tab: create this branch's repository
// with an explicit name (normalized server-side) on the user's OWN GitHub
// account, then push the project files and the conversation transcript so the
// repo is never an empty shell. Idempotent via ensureRepoForBranch — a branch
// that already has a repo keeps it and just gets its files re-synced.
export const createRepoWithName = action({
  args: {
    token: v.string(),
    projectId: v.string(),
    branchId: v.string(),
    repoName: v.string(),
    // Repo Status from the Git Sync tab: true = Private, false = Public.
    isPrivate: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<{ owner: string; repo: string; branch: string; repoUrl: string }> => {
    const userId: Id<"users"> | null = await ctx.runQuery(internal.customAuthHelpers.getUserIdByToken, { token: args.token });
    if (!userId) throw new Error("Not authenticated");

    const project: { name?: string } | null = await ctx.runQuery(internal.codeProjects.getProjectInternal, { projectId: args.projectId });
    const result: { owner: string; repo: string; branch: string } | null = await ctx.runAction(internal.githubAutoCreate.ensureRepoForBranch, {
      userId,
      projectId: args.projectId,
      branchId: args.branchId,
      projectName: project?.name ?? "",
      requestedName: args.repoName,
      ...(args.isPrivate === undefined ? {} : { isPrivate: args.isPrivate }),
    });
    if (!result) {
      const branch: { repoSetupError?: string } | null = await ctx.runQuery(internal.codeBranches.getBranchInternal, { branchId: args.branchId });
      throw new Error(branch?.repoSetupError ?? "Failed to create the repository");
    }

    // The repo exists now — land the code immediately instead of leaving an
    // empty shell waiting for the first pipeline push. Code only: the chat
    // transcript and workflow files are system data and never go to the
    // user's repo (they live in Convex and on the platform's build mirror).
    await ctx.runAction(internal.githubSync.autoPushToGithub, {
      branchId: args.branchId,
      commitMessage: "chore: initial sync after repository creation",
    });

    return {
      owner: result.owner,
      repo: result.repo,
      branch: result.branch,
      repoUrl: `https://github.com/${result.owner}/${result.repo}`,
    };
  },
});


// Flip an existing repo between Private and Public — the Git Sync tab's Repo
// Status control after the repo exists. Uses the connected account's token
// (the repo is on their account), validates the session, then mirrors the
// choice into githubConfigs so the UI reflects it on the next read.
export const setRepoVisibility = action({
  args: {
    token: v.string(),
    projectId: v.string(),
    branchId: v.string(),
    isPrivate: v.boolean(),
  },
  handler: async (ctx, args): Promise<{ isPrivate: boolean }> => {
    const userId: Id<"users"> | null = await ctx.runQuery(internal.customAuthHelpers.getUserIdByToken, { token: args.token });
    if (!userId) throw new Error("Not authenticated");

    const cfg: { owner?: string; repo?: string } | null = await ctx.runQuery(internal.githubSyncHelpers.getGithubConfigInternal, {
      projectId: args.projectId,
      branchId: args.branchId,
    });
    if (!cfg?.owner || !cfg.repo) throw new Error("This branch has no repository yet");

    const account: { accessToken?: string } | null = await ctx.runQuery(internal.githubHelpers.getGithubToken, { userId });
    if (!account?.accessToken) throw new Error("Connect GitHub to change repository visibility");

    const octokit = new Octokit({ auth: account.accessToken });
    try {
      await octokit.repos.update({ owner: cfg.owner, repo: cfg.repo, private: args.isPrivate });
    } catch (err) {
      throw new Error(err instanceof Error ? err.message : "Failed to update repository visibility");
    }
    await ctx.runMutation(internal.githubSyncHelpers.setConfigPrivacy, {
      branchId: args.branchId,
      isPrivate: args.isPrivate,
    });
    return { isPrivate: args.isPrivate };
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
    const allBranches: Array<{ branchId: string; projectId: string; name: string }> = await ctx.runQuery(internal.codeBranches.listAllBranchesInternal);
    const errors: string[] = [];
    let created = 0;
    let skipped = 0;

    for (const branch of allBranches) {
      const existing: GithubConfigRow = await ctx.runQuery(internal.githubSyncHelpers.getGithubConfigInternal, {
        projectId: branch.projectId,
        branchId: branch.branchId,
      });
      if (existing?.owner && existing.repo) {
        skipped++;
        continue;
      }

      const project: { userId: Id<"users">; name: string } | null = await ctx.runQuery(internal.codeProjects.getProjectInternal, {
        projectId: branch.projectId,
      });
      if (!project) {
        errors.push(`No project found for branch ${branch.branchId}`);
        continue;
      }

      try {
        const result: { owner: string; repo: string; branch: string } | null = await ctx.runAction(internal.githubAutoCreate.ensureRepoForBranch, {
          userId: project.userId,
          projectId: branch.projectId,
          branchId: branch.branchId,
          projectName: project.name,
        });
        if (result) {
          created++;
        } else {
          const refreshed: { repoSetupError?: string } | null = await ctx.runQuery(internal.codeBranches.getBranchInternal, { branchId: branch.branchId });
          errors.push(`Branch ${branch.branchId} (${branch.name}): ${refreshed?.repoSetupError ?? "unknown error"}`);
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
    const userId: Id<"users"> | null = await ctx.runQuery(internal.customAuthHelpers.getUserIdByToken, { token: args.token });
    if (!userId) throw new Error("Not authenticated");

    await ctx.runAction(internal.githubAutoCreate.ensureRepoForBranch, {
      userId,
      projectId: args.projectId,
      branchId: args.branchId,
      projectName: args.projectName,
    });
  },
});
