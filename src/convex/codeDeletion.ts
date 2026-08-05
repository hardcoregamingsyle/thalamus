/* eslint-disable @typescript-eslint/ban-ts-comment -- Convex generated api types are self-referential here and exceed TS instantiation depth (TS2589); checked builds require this suppression. */
// @ts-nocheck
"use node";
import { internalAction } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { Octokit } from "@octokit/rest";

// Deep deletion for branches and projects, in an action instead of the old
// single-mutation approach. Two reasons:
//
// 1. The old deleteBranch/deleteProject collected EVERY child row (messages,
//    files, commands) into one mutation. Convex mutations are atomic and
//    capped at ~1MB of reads — a branch with a normal transcript blew that,
//    the whole mutation failed wholesale, and "delete" silently deleted
//    nothing. Rows are now removed in chunks of ROW_CHUNK, one mutation per
//    chunk, so any size succeeds.
// 2. The GitHub repo behind a branch is real infrastructure and was never
//    torn down. It survives as a live URL anyone can keep working in. Repo
//    deletion needs a network call (Octokit) plus the token that owns the
//    repo, which lives in githubConfigs — an action is the right place.

const ROW_CHUNK = 20;

// Best-effort: delete the GitHub repo a branch pushed to. Returns a warning
// string when it couldn't (bad/missing token scope, repo gone already, ...) —
// never throws, so DB cleanup always runs.
async function deleteGithubRepo(
  ctx: Parameters<Parameters<typeof internalAction>[0]["handler"]>[0],
  owner: string | undefined,
  repo: string | undefined,
  configToken: string | undefined,
  userId: string | undefined,
): Promise<string | null> {
  if (!owner || !repo) return null;

  let token = configToken;
  if (!token && userId) {
    try {
      const account = await ctx.runQuery(internal.githubHelpers.getGithubToken, { userId });
      token = account?.accessToken;
    } catch { /* fall through to env fallback */ }
  }
  if (!token) token = process.env.GITHUB_TOKEN;
  if (!token) return `no token available to delete repo github.com/${owner}/${repo}`;

  try {
    const octokit = new Octokit({ auth: token });
    await octokit.repos.delete({ owner, repo });
    return null;
  } catch (err) {
    return `repo delete failed for github.com/${owner}/${repo} (${err instanceof Error ? err.message : String(err)})`;
  }
}

async function deleteBranchChildRows(ctx, branchId: string) {
  for (const table of ["codeMessages", "codeFiles", "codeCommands", "codeApiKeyRequests"]) {
    let deleted = ROW_CHUNK;
    while (deleted === ROW_CHUNK) {
      deleted = await ctx.runMutation(internal.codeBranches.deleteBranchRowsChunk, { branchId, table });
    }
  }
}

export const deleteBranchDeep = internalAction({
  args: {
    branchId: v.string(),
    projectId: v.string(),
    userId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // 1. Tear down the GitHub repo + its config row (best-effort).
    try {
      const config = await ctx.runQuery(internal.githubSyncHelpers.getGithubConfigInternal, {
        projectId: args.projectId,
        branchId: args.branchId,
      });
      if (config) {
        const warning = await deleteGithubRepo(ctx, config.owner, config.repo, config.githubToken ?? undefined, args.userId);
        if (warning) console.error(`[deleteBranchDeep] branch ${args.branchId}: ${warning}`);
        await ctx.runMutation(internal.githubSyncHelpers.deleteGithubConfigByBranch, { branchId: args.branchId });
      }
    } catch (err) {
      console.error(`[deleteBranchDeep] branch ${args.branchId} GitHub teardown failed:`, err);
    }

    // 2. Chunk-delete all child rows, then the branch record itself.
    await deleteBranchChildRows(ctx, args.branchId);
    await ctx.runMutation(internal.codeBranches.deleteBranchRecord, { branchId: args.branchId });
  },
});

export const deleteProjectDeep = internalAction({
  args: {
    projectId: v.string(),
    userId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const branches = await ctx.runQuery(internal.codeBranches.listBranchesInternal, { projectId: args.projectId });
    for (const br of branches) {
      try {
        await ctx.runAction(internal.codeDeletion.deleteBranchDeep, {
          branchId: br.branchId,
          projectId: args.projectId,
          userId: args.userId,
        });
      } catch (err) {
        console.error(`[deleteProjectDeep] branch ${br.branchId} failed:`, err);
      }
    }

    // Chunk-delete the project's API keys, then the project record.
    let deleted = ROW_CHUNK;
    while (deleted === ROW_CHUNK) {
      deleted = await ctx.runMutation(internal.codeProjects.deleteApiKeysChunk, { projectId: args.projectId });
    }
    await ctx.runMutation(internal.codeProjects.deleteProjectRecord, { projectId: args.projectId });
  },
});
