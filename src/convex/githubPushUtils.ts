"use node";
// Shared Git ref-push machinery for githubSync.ts (user-repo + mirror pushes)
// and githubActionsRunner.ts (seeding a fresh build mirror). Kept in its own
// leaf module because those two files already import each other — a helper in
// either one would close an ESM cycle.

import type { Octokit } from "@octokit/rest";

// Paths Thalamus itself owns — never the user's project code. They are
// filtered on the way OUT (a push of the branch's file store must not put
// them on the user's repo; the mirror's copies are written only by the
// runner's ensureWorkflowOnRepo, never by a tree push) and on the way IN (a
// pull from a legacy repo that still contains them must not reintroduce them
// into the branch's file store, where agents would read them as project code).
const SYSTEM_DIR_PREFIXES = [".thalamus/"];
const SYSTEM_EXACT_PATHS = new Set([
  ".github/workflows/thalamus-vm.yml",
  ".github/workflows/thalamus-sandbox.yml",
]);

export function isSystemPath(path: string): boolean {
  const p = normalizeGitPath(path);
  if (SYSTEM_EXACT_PATHS.has(p)) return true;
  return SYSTEM_DIR_PREFIXES.some((pre) => p.startsWith(pre));
}

// GitHub's git/trees API rejects any tree path that starts with a slash
// ("tree.path cannot start with a slash"), and an absolute /home/<user>/...
// path is meaningless against the repo root. The output parser already
// normalizes agent-emitted paths, but this is the last line of defense: a
// path that somehow reaches the push still gets made repo-relative so a
// single bad path can't fail the whole push and leave the VM working on an
// empty clone.
export function normalizeGitPath(raw: string): string {
  let p = (raw ?? "").trim();
  p = p.replace(/\\/g, "/").replace(/^\.\//, "");
  p = p.replace(/^\/home\/[^/]+\//, "");
  if (p.startsWith("/")) p = p.slice(1);
  p = p.split("/").filter(Boolean).join("/");
  return p;
}

// Exact paths the pre-mirror era wrote into user repos — pruned from the
// user repo on every push so "code-only" is true for old repos too, not just
// ones created after the decision. The build mirror never passes this list:
// its workflow files are real and needed.
export const LEGACY_SYSTEM_PATHS = [
  ".thalamus/conversation.jsonl",
  ".github/workflows/thalamus-vm.yml",
  ".github/workflows/thalamus-sandbox.yml",
];

/** Commit `files` onto `branch` of `owner/repo` as a single commit and move
 *  the ref. Only the paths in `files` are touched (base_tree preserves the
 *  rest), so on the build mirror the managed workflow files survive every
 *  code push. `prunePaths` (exact git paths present in the base tree) are
 *  deleted in the same commit — the legacy-system-file cleanup for the user
 *  repo. Returns the new commit sha.
 *
 *  Sequential blob creation with 200ms spacing keeps bursts under GitHub's
 *  secondary rate limits; individual blobs retry a 403 up to 3 times using
 *  the Retry-After header (capped at 15s). A non-rate-limit failure aborts
 *  the whole push — partial trees are worse than none. */
export async function pushFilesToRef(
  octokit: Octokit,
  owner: string,
  repo: string,
  branch: string,
  files: Array<{ filepath: string; content: string }>,
  message: string,
  prunePaths?: string[],
): Promise<string> {
  const { data: refData } = await octokit.git.getRef({
    owner,
    repo,
    ref: `heads/${branch}`,
  });
  const latestCommitSha = refData.object.sha;

  const { data: commitData } = await octokit.git.getCommit({
    owner,
    repo,
    commit_sha: latestCommitSha,
  });
  const baseTreeSha = commitData.tree.sha;

  const tree: Array<{ path: string; mode: "100644"; type: "blob"; sha: string | null }> = [];
  // Dedup by normalized path: the store can briefly hold a legacy "/src/x"
  // row next to a corrected "src/x" row, and both normalize to "src/x" — a
  // duplicate tree path that GitHub rejects. Keep only the first.
  const seenTreePaths = new Set<string>();
  for (const file of files) {
    const normPath = normalizeGitPath(file.filepath);
    if (!normPath || seenTreePaths.has(normPath)) continue;
    seenTreePaths.add(normPath);
    let lastErr: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const { data: blob } = await octokit.git.createBlob({
          owner,
          repo,
          content: Buffer.from(file.content).toString("base64"),
          encoding: "base64",
        });
        tree.push({ path: normPath, mode: "100644" as const, type: "blob" as const, sha: blob.sha });
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

  // Deletions ride the same commit: only paths actually IN the base tree get
  // a null-sha entry (a delete of an absent path is at best a no-op and at
  // worst a 422 — checking first keeps both cases clean).
  if (prunePaths && prunePaths.length > 0) {
    try {
      const { data: baseTree } = await octokit.git.getTree({
        owner,
        repo,
        tree_sha: baseTreeSha,
        recursive: "true",
      });
      const present = new Set(
        baseTree.tree.filter((t) => t.type === "blob" && t.path).map((t) => t.path as string),
      );
      for (const p of prunePaths) {
        if (present.has(p)) tree.push({ path: p, mode: "100644", type: "blob", sha: null });
      }
    } catch (err) {
      // Pruning is best-effort hygiene, never a reason to fail the sync of
      // the actual code — the files simply get pruned on a later push.
      console.error("pushFilesToRef: prune-path scan failed, skipping deletions:", err);
    }
  }

  const { data: newTree } = await octokit.git.createTree({
    owner,
    repo,
    tree,
    base_tree: baseTreeSha,
  });

  const { data: newCommit } = await octokit.git.createCommit({
    owner,
    repo,
    message: message || "Update from Thalamus AI",
    tree: newTree.sha,
    parents: [latestCommitSha],
  });

  await octokit.git.updateRef({
    owner,
    repo,
    ref: `heads/${branch}`,
    sha: newCommit.sha,
  });

  return newCommit.sha;
}
