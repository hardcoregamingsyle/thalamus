"use node";
import { action, internalAction, type ActionCtx } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { Id, Doc } from "./_generated/dataModel";
import { Octokit } from "@octokit/rest";
import crypto from "crypto";

import { resolveTokenForBranch } from "./githubActionsRunner";

// Row shape used by every internal.githubSyncHelpers.getGithubConfigInternal
// call in this file — kept as a narrow local alias so the self-referential
// api-object chain doesn't hit TS2589.
type GithubConfig = Doc<"githubConfigs">;
type CodeFile = { filepath: string; content: string };

// The user's own OAuth-connected token beats an explicitly-passed one (there's
// no PAT-entry UI left to pass one anyway) beats the platform's fallback token.
async function resolveGithubToken(
  ctx: ActionCtx,
  userId: Id<"users">,
  explicit?: string,
): Promise<string | undefined> {
  const account: { accessToken?: string } | null = await ctx.runQuery(internal.githubHelpers.getGithubToken, { userId });
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
  handler: async (ctx, args): Promise<{
    success: boolean;
    filesCloned: number;
    source: string;
    sourceBranch: string;
    repo: string | null;
    branch: string | null;
    pushWarning: string | null;
  }> => {
    const userId: Id<"users"> | null = await ctx.runQuery(internal.customAuthHelpers.getUserIdByToken, { token: args.token });
    if (!userId) throw new Error("Not authenticated");

    try {
      // Repo segment must stop at the next "/" (or end of string), not the
      // first ".": the old pattern truncated any repo name containing a dot
      // (e.g. "my.project" → "my") and 404'd on the wrong name. A trailing
      // ".git" is stripped separately since that's a real suffix, not part
      // of the name.
      const urlMatch = args.repoUrl.match(/github\.com\/([^/\s]+)\/([^/\s]+)/);
      if (!urlMatch) throw new Error("Invalid GitHub URL");

      const owner = urlMatch[1];
      const repo = urlMatch[2].replace(/\.git$/, "");

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
      const repoFp: { freeTierExhausted?: boolean } | null = await ctx.runQuery(internal.antiEvasionDb.getRepoFingerprint, { githubRepoId });
      if (repoFp?.freeTierExhausted) {
        throw new Error("This repository's free-tier credits are exhausted. Upgrade to continue.");
      }

      const allPaths = tree.tree
        .filter((item) => item.type === "blob" && item.path)
        .map((item) => item.path as string);

      const structureHash = computeStructureHash(allPaths);
      const structFp: { freeTierExhausted?: boolean } | null = await ctx.runQuery(internal.antiEvasionDb.getStructureFingerprint, { structureHash });
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
      const platform: { owner: string; repo: string; branch: string } | null = await ctx.runAction(internal.githubAutoCreate.ensureRepoForBranch, {
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
      // README. Non-fatal: the files are already in Convex either way, and
      // pushWarning below is how the caller learns this step didn't land.
      let pushWarning: string | null = null;
      if (platform) {
        const pushResult: { success: boolean; error?: string } = await ctx.runAction(internal.githubSync.autoPushToGithub, {
          branchId: args.branchId,
          commitMessage: `Import ${owner}/${repo}@${sourceBranch}`,
        });
        if (!pushResult.success) {
          pushWarning = pushResult.error ?? "Failed to push imported files to the platform repo";
        }
      }

      return {
        success: true,
        filesCloned,
        source: `${owner}/${repo}`,
        sourceBranch,
        repo: platform ? `${platform.owner}/${platform.repo}` : null,
        branch: platform?.branch ?? null,
        pushWarning,
      };
    } catch (err) {
      console.error("Clone error:", err);
      throw new Error(err instanceof Error ? err.message : "Failed to clone repository");
    }
  },
});

// Push changes back to GitHub
// Resolve the repo's ACTUAL default branch — syncs land on the default
// branch, never on the obscure working branch. Repos created by
// createObscureRepo have the obscure branch as their default (so behavior
// there is unchanged); user-created repos default to main, which is what a
// manual sync should update.
async function resolveDefaultBranch(
  octokit: Octokit,
  owner: string,
  repo: string,
  fallback: string,
): Promise<string> {
  try {
    const { data } = await octokit.repos.get({ owner, repo });
    return data.default_branch || fallback;
  } catch {
    return fallback;
  }
}

export const pushToGithub = action({
  args: {
    token: v.string(),
    projectId: v.string(),
    branchId: v.string(),
    commitMessage: v.string(),
    githubToken: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<{ success: boolean; commitSha: string; filesUpdated: number }> => {
    const userId: Id<"users"> | null = await ctx.runQuery(internal.customAuthHelpers.getUserIdByToken, { token: args.token });
    if (!userId) throw new Error("Not authenticated");

    try {
      const config: GithubConfig | null = await ctx.runQuery(internal.githubSyncHelpers.getGithubConfigInternal, {
        projectId: args.projectId,
        branchId: args.branchId,
      });

      if (!config) throw new Error("No GitHub repository connected");

      const files: CodeFile[] = await ctx.runQuery(internal.codeBranches.getFilesInternal, {
        branchId: args.branchId,
      });

      const octokit = new Octokit({
        auth: await resolveGithubToken(ctx, userId, args.githubToken),
      });

      const defaultBranch = await resolveDefaultBranch(octokit, config.owner, config.repo, config.branch);

      const { data: refData } = await octokit.git.getRef({
        owner: config.owner,
        repo: config.repo,
        ref: `heads/${defaultBranch}`,
      });

      const latestCommitSha = refData.object.sha;

      const { data: commitData } = await octokit.git.getCommit({
        owner: config.owner,
        repo: config.repo,
        commit_sha: latestCommitSha,
      });

const baseTreeSha = commitData.tree.sha;

      // Sequential blob creation with spacing + retry on 403 rate limits.
      const tree: Array<{ path: string; mode: "100644"; type: "blob"; sha: string }> = [];
      for (const file of files) {
        let lastErr: unknown;
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            const { data: blob } = await octokit.git.createBlob({
              owner: config.owner,
              repo: config.repo,
              content: Buffer.from(file.content).toString("base64"),
              encoding: "base64",
            });
            tree.push({ path: file.filepath, mode: "100644" as const, type: "blob" as const, sha: blob.sha });
            lastErr = undefined;
            break;
          } catch (err: unknown) {
            lastErr = err;
            const resp = (err as { response?: { status?: number; headers?: Record<string, string> } })?.response;
            if (resp?.status === 403) {
              const retryAfter = parseInt(String(resp?.headers?.["retry-after"] ?? "5"), 10);
              await new Promise((r) => setTimeout(r, Math.min(retryAfter * 1000, 15000)));
            } else {
              break;
            }
          }
        }
        if (lastErr) throw lastErr;
        await new Promise((r) => setTimeout(r, 200));
      }

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
        ref: `heads/${defaultBranch}`,
        sha: newCommit.sha,
      });

      await ctx.runMutation(internal.githubSyncHelpers.updateLastSync, {
        projectId: args.projectId,
        branchId: args.branchId,
      });

      return { success: true, commitSha: newCommit.sha, filesUpdated: files.length };
    } catch (err) {
      console.error("Push error:", err);
      throw new Error(err instanceof Error ? err.message : "Failed to push to GitHub");
    }
  },
});

// Auto-push to GitHub (internal, no auth check).
//
// Returns a result instead of throwing — this used to swallow every error
// with just a console.error, which made it silently invisible to callers
// that specifically need to know it failed (startSandbox's rate-limit
// detection was written to catch a throw that could never happen, so that
// whole code path was dead). Callers that genuinely don't care (the main
// pipeline, which schedules this fire-and-forget) just ignore the return
// value, same as they ignored the old void.
export const autoPushToGithub = internalAction({
  args: {
    branchId: v.string(),
    commitMessage: v.string(),
  },
  handler: async (ctx, args): Promise<{ success: boolean; error?: string }> => {
    try {
      const branch: { projectId: string } | null = await ctx.runQuery(internal.codeBranches.getBranchInternal, {
        branchId: args.branchId,
      });

      if (!branch) return { success: false, error: "Branch not found" };

      const config: GithubConfig | null = await ctx.runQuery(internal.githubSyncHelpers.getGithubConfigInternal, {
        projectId: branch.projectId,
        branchId: args.branchId,
      });

      if (!config) return { success: true }; // No GitHub repo connected yet — nothing to push, not an error

      const files: CodeFile[] = await ctx.runQuery(internal.codeBranches.getFilesInternal, {
        branchId: args.branchId,
      });

      // Same identity the VM worker uses: the connected account's live token
      // when it owns the repo, else the snapshot, else the platform fallback.
      // A push written with the snapshotted token while command execution
      // resolves live leaves a branch that was reconnected pushing with a
      // dead token — files silently never reach the clone commands run on.
      const octokit = new Octokit({
        auth: await resolveTokenForBranch(ctx, branch.projectId, {
          owner: config.owner,
          repo: config.repo,
          branch: config.branch,
          githubToken: config.githubToken ?? undefined,
        }),
      });

      const defaultBranch = await resolveDefaultBranch(octokit, config.owner, config.repo, config.branch);

      const { data: refData } = await octokit.git.getRef({
        owner: config.owner,
        repo: config.repo,
        ref: `heads/${defaultBranch}`,
      });

      const latestCommitSha = refData.object.sha;

      const { data: commitData } = await octokit.git.getCommit({
        owner: config.owner,
        repo: config.repo,
        commit_sha: latestCommitSha,
      });

      const baseTreeSha = commitData.tree.sha;

      // Sequential blob creation with spacing to avoid GitHub secondary rate limits.
      // Retries individual blobs on 403 with Retry-After backoff (up to 3 tries).
      const tree: Array<{ path: string; mode: "100644"; type: "blob"; sha: string }> = [];
      for (const file of files) {
        let lastErr: unknown;
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            const { data: blob } = await octokit.git.createBlob({
              owner: config.owner,
              repo: config.repo,
              content: Buffer.from(file.content).toString("base64"),
              encoding: "base64",
            });
            tree.push({ path: file.filepath, mode: "100644" as const, type: "blob" as const, sha: blob.sha });
            lastErr = undefined;
            break;
          } catch (err: unknown) {
            lastErr = err;
            const resp = (err as { response?: { status?: number; headers?: Record<string, string> } })?.response;
            if (resp?.status === 403) {
              const retryAfter = parseInt(String(resp?.headers?.["retry-after"] ?? "5"), 10);
              const waitMs = Math.min((retryAfter || 5) * 1000, 15000);
              console.error(`GitHub secondary rate limit on blob, waiting ${waitMs}ms (attempt ${attempt + 1}/3)`);
              await new Promise((r) => setTimeout(r, waitMs));
            } else {
              // Non-rate-limit error — no point retrying.
              break;
            }
          }
        }
        if (lastErr) {
          console.error(`Failed to create blob for ${file.filepath} after retries:`, lastErr);
          throw lastErr;
        }
        // 200ms gap between blobs keeps burst well under secondary rate limits.
        await new Promise((r) => setTimeout(r, 200));
      }

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
        ref: `heads/${defaultBranch}`,
        sha: newCommit.sha,
      });

      await ctx.runMutation(internal.githubSyncHelpers.updateLastSync, {
        projectId: branch.projectId,
        branchId: args.branchId,
      });
      return { success: true };
    } catch (err) {
      console.error("Auto-push error:", err);
      // Never throw — the pipeline schedules this fire-and-forget and must
      // not block on a push failure. Callers that care check the return value.
      return { success: false, error: err instanceof Error ? err.message : String(err) };
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
  handler: async (ctx, args): Promise<{ success: boolean; filesPulled: number }> => {
    const userId: Id<"users"> | null = await ctx.runQuery(internal.customAuthHelpers.getUserIdByToken, { token: args.token });
    if (!userId) throw new Error("Not authenticated");
    const authToken = await resolveGithubToken(ctx, userId, args.githubToken);
    return doPull(ctx, args.projectId, args.branchId, authToken);
  },
});

// Internal entry for the pipeline's pre-run sync: no session token, so the
// identity is the project owner (the account the repo was created under).
export const pullForPipeline = internalAction({
  args: {
    projectId: v.string(),
    branchId: v.string(),
  },
  handler: async (ctx, args): Promise<{ success: boolean; filesPulled: number }> => {
    const project: { userId: Id<"users"> } | null = await ctx.runQuery(internal.codeProjects.getProjectInternal, {
      projectId: args.projectId,
    });
    if (!project) throw new Error("Project not found");
    const authToken = await resolveGithubToken(ctx, project.userId);
    return doPull(ctx, args.projectId, args.branchId, authToken);
  },
});

async function doPull(
  ctx: ActionCtx,
  projectId: string,
  branchId: string,
  authToken: string | undefined,
): Promise<{ success: boolean; filesPulled: number }> {
  try {
    const config: GithubConfig | null = await ctx.runQuery(internal.githubSyncHelpers.getGithubConfigInternal, {
      projectId,
      branchId,
    });

    if (!config) throw new Error("No GitHub repository connected");

    const octokit = new Octokit({
      auth: authToken,
    });

    const defaultBranch = await resolveDefaultBranch(octokit, config.owner, config.repo, config.branch);

    const { data: tree } = await octokit.git.getTree({
      owner: config.owner,
      repo: config.repo,
      tree_sha: defaultBranch,
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
            branchId,
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
      projectId,
      branchId,
    });

    return {
      success: true,
      filesPulled,
    };
  } catch (err) {
    console.error("Pull error:", err);
    throw new Error(err instanceof Error ? err.message : "Failed to pull from GitHub");
  }
}
