"use node";
// Cloud command execution on GitHub Actions.
//
// Every branch already gets its own public GitHub repo for source control
// (githubAutoCreate.ts), and public repos get unlimited Actions minutes on
// standard runners — so the repo we were already creating is also the VM.
//
// Flow: push the branch's files, make sure the runner workflow exists, then
// dispatch one workflow run per queued command. The job runs the command and
// POSTs its output back to /code/command-result, which records the result and
// resumes the pipeline. Nothing here waits around for the run to finish — a
// Convex action would time out long before Actions gets to it.
//
// The tradeoff versus a warm sandbox is honest and worth knowing: a dispatched
// run takes roughly 20-60s to pick up a runner, where a live sandbox answers in
// seconds. What you get for it is a real, disposable machine with the whole
// toolchain, for free, with every run visible in the repo — and, because GitHub
// hosts ubuntu, windows and macos runners, a branch can be built and tested on
// the OS it actually ships to rather than on whatever the container happened
// to be. That is not something a single Linux sandbox can do at any price.

import { action, internalAction, type ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { ConvexError, v } from "convex/values";
import { Octokit } from "@octokit/rest";
import crypto from "crypto";
import type { Id } from "./_generated/dataModel";
import { sanitizeRepoName } from "./githubAutoCreate";
import { randomDigits } from "./lib/obscureRepoGenerator";
import { isSystemPath, pushFilesToRef } from "./githubPushUtils";

const VM_WORKFLOW_PATH = ".github/workflows/thalamus-vm.yml";
const VM_WORKFLOW_FILE = "thalamus-vm.yml";

const SANDBOX_WORKFLOW_PATH = ".github/workflows/thalamus-sandbox.yml";
const SANDBOX_WORKFLOW_FILE = "thalamus-sandbox.yml";

// How fresh vmLastSeenAt must be to consider the VM worker alive. The worker
// polls every 10s, so anything within this window is definitively up — a boot
// is only dispatched when the heartbeat is older than this (or absent).
const VM_ALIVE_WINDOW_MS = 90_000;

// Sandbox workflow — starts a dev server and exposes it via Cloudflare tunnel.
// Stays alive for up to 360 minutes (6h max on public repos); cancel the run
// from the Actions tab or Thalamus UI to tear it down.
const SANDBOX_WORKFLOW_YAML = `# Managed by Thalamus. Starts a dev server + Cloudflare tunnel for live preview.
name: Thalamus Sandbox

on:
  workflow_dispatch:
    inputs:
      callback_url:
        description: Where to POST the tunnel URL
        required: true
      os:
        description: Runner OS
        required: false
        default: ubuntu-latest
      start_command:
        description: Command to start the dev server
        required: false
        default: npm run dev --
      port:
        description: Port the dev server listens on
        required: false
        default: '3000'

jobs:
  sandbox:
    runs-on: \${{ inputs.os || 'ubuntu-latest' }}
    timeout-minutes: 360
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Install dependencies
        run: |
          if [ -f package.json ]; then npm install; fi

      - name: Download and install cloudflared
        run: |
          curl -sL https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 -o /tmp/cloudflared
          chmod +x /tmp/cloudflared

      - name: Start tunnel and dev server
        shell: bash
        run: |
          PORT="\${{ inputs.port }}"
          CMD="\${{ inputs.start_command }}"

          # Start cloudflared tunnel in background
          /tmp/cloudflared tunnel --url "http://localhost:$PORT" > /tmp/tunnel.log 2>&1 &
          CLOUD_PID=$!

          # Wait up to 60s for tunnel URL
          TUNNEL_URL=""
          for i in $(seq 1 30); do
            TUNNEL_URL=$(grep -oP 'https?://[a-zA-Z0-9.-]+\\.trycloudflare\\.com' /tmp/tunnel.log | head -1)
            if [ -n "$TUNNEL_URL" ]; then break; fi
            sleep 2
          done

          # Start dev server in background
          echo "Starting: $CMD --host 0.0.0.0 --port $PORT"
          if echo "$CMD" | grep -q "vite\\|dev\\|next\\|start"; then
            eval "$CMD --host 0.0.0.0 --port $PORT" > /tmp/devserver.log 2>&1 &
          else
            eval "$CMD" > /tmp/devserver.log 2>&1 &
          fi
          DEV_PID=$!

          # Report tunnel URL back to Thalamus
          if [ -n "$TUNNEL_URL" ]; then
            echo "Tunnel URL: $TUNNEL_URL"
            curl -sS -X POST "\${{ inputs.callback_url }}" \\
              -H 'Content-Type: application/json' \\
              -d "$(jq -n --arg url "$TUNNEL_URL" --arg pid "$DEV_PID" '{tunnelUrl: $url, status: "running", devPid: $pid}')"
          else
            echo "No tunnel URL found — sandbox has no public endpoint"
            curl -sS -X POST "\${{ inputs.callback_url }}" \\
              -H 'Content-Type: application/json' \\
              -d '{"status":"failed","error":"tunnel-not-established"}'
          fi

          # Keep alive — wait for dev server to exit (or Actions to cancel us)
          wait $DEV_PID 2>/dev/null || true
`;

// One persistent VM worker per branch, dispatched once per prompt (not per
// command). Loops every 10s: polls /code/vm-poll for queued commands, runs
// each in bash, POSTs the result to /code/command-result, and keeps going
// until the server says keepAlive=false (idle too long — 300s mid-task, 600s
// after completion — see VM_IDLE_INCOMPLETE_MS/VM_IDLE_DONE_MS) or until the
// run's timeout kills it. The branch ref is re-checked before every batch so
// the working tree never goes stale relative to what the agent just pushed.
const VM_WORKFLOW_YAML = `# Managed by Thalamus. Persistent VM worker — polls for queued commands.
name: Thalamus VM

on:
  workflow_dispatch:
    inputs:
      branch_id:
        description: Convex branch id
        required: true
      vm_nonce:
        description: One-time token proving this worker is ours
        required: true
      callback_base:
        description: Convex site base URL
        required: true
      os:
        description: Runner to execute on
        required: false
        default: ubuntu-latest
      branch:
        description: Git branch to track and re-sync against
        required: true

jobs:
  vm:
    runs-on: \${{ inputs.os || 'ubuntu-latest' }}
    timeout-minutes: 350
    steps:
      - uses: actions/checkout@v4
        with:
          ref: \${{ inputs.branch }}
      - uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Worker loop
        shell: bash
        env:
          BRANCH_ID: \${{ inputs.branch_id }}
          VM_NONCE: \${{ inputs.vm_nonce }}
          CALLBACK_BASE: \${{ inputs.callback_base }}
          BRANCH_REF: \${{ inputs.branch }}
        run: |
          set +e
          echo "[vm] worker started for branch $BRANCH_REF"
          while true; do
            RESP=$(curl -sS -X POST "$CALLBACK_BASE/code/vm-poll" \\
              -H 'Content-Type: application/json' \\
              -d "{\\"branchId\\":\\"$BRANCH_ID\\",\\"vmNonce\\":\\"$VM_NONCE\\"}")
            ALIVE=$(echo "$RESP" | jq -r '.keepAlive // false')
            if [ "$ALIVE" != "true" ]; then
              echo "[vm] idle deadline reached — shutting down"
              break
            fi
            N=$(echo "$RESP" | jq '.commands | length')
            if [ "$N" -gt 0 ]; then
              git fetch origin "+refs/heads/$BRANCH_REF:refs/remotes/origin/$BRANCH_REF" --quiet 2>/dev/null || git fetch origin --quiet 2>/dev/null
              git checkout -B "$BRANCH_REF" "origin/$BRANCH_REF" --quiet 2>/dev/null || true
              echo "$RESP" | jq -c '.commands[]' | while IFS= read -r C; do
                ID=$(echo "$C" | jq -r '.id')
                NONCE=$(echo "$C" | jq -r '.nonce')
                CMD=$(echo "$C" | jq -r '.command')
                echo "[vm] run: $CMD"
                OUTPUT=$(bash -lc "$CMD" 2>&1)
                CODE=$?
                printf '%s' "$OUTPUT" | head -c 20000 > "$RUNNER_TEMP/vm-out.txt"
                PAYLOAD=$(jq -n --arg id "$ID" --arg nonce "$NONCE" \\
                  --arg out "$(cat "$RUNNER_TEMP/vm-out.txt")" \\
                  --argjson code "$CODE" \\
                  '{commandId:$id, nonce:$nonce, output:$out, exitCode:$code}')
                curl -sS -X POST "$CALLBACK_BASE/code/command-result" \\
                  -H 'Content-Type: application/json' -d "$PAYLOAD" > /dev/null
              done
            fi
            sleep 10
          done
          echo "[vm] worker done"
`;

type GhConfig = { owner: string; repo: string; branch: string; githubToken?: string };

// GitHub's hosted runners. The whole point of running here rather than in one
// Linux container: a branch can be built and tested on the OS it ships to.
const RUNNERS: Record<string, string> = {
  ubuntu: "ubuntu-latest",
  windows: "windows-latest",
  macos: "macos-latest",
};

// Distinct error class for the "token lacks the `workflow` scope" case —
// GitHub returns a bare 404 (not a helpful 403) when a token without
// `workflow` tries to write under .github/workflows/, so we can't rely on the
// status text alone. Since workflows are only ever written to the platform's
// build mirror, this can only mean the platform token itself is under-scoped.
class WorkflowScopeMissingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkflowScopeMissingError";
  }
}

// The platform-owned variant of the same failure — and the one that produced
// the "I keep reconnecting and nothing changes" reports. Here the repo lives
// under the platform's integration account, so the user's GitHub connection is
// never consulted for it at all (resolveTokenForBranch deliberately ignores a
// token that cannot see the repo). Sending that user through OAuth again fixes
// nothing, forever; the only cure is the platform token itself gaining the
// workflow scope, which is an admin action on the server env, not a user one.
// Until then the desktop app's local executor is the working path.
const PLATFORM_WORKFLOW_SCOPE_MSG =
  "This branch's repo is hosted under the platform's GitHub integration, whose token cannot write "
  + "the VM worker workflow under .github/workflows/ (missing `workflow` permission). Reconnecting "
  + "your own GitHub account cannot fix a platform-hosted repo — the platform's GITHUB_TOKEN must "
  + "gain the workflow scope, which is an admin fix on the server, not something you can resolve. "
  + "Until then cloud commands cannot run; the Thalamus desktop app still runs them on your own machine.";

// Resolve the token that may act on a branch's repo.
//
// `githubConfigs.githubToken` is a SNAPSHOT taken when the branch's repo was
// created, so it is not the source of truth: a user who reconnects GitHub gets
// a fresh token on their user record while every existing branch keeps pointing
// at the old one. That is exactly how a branch ends up permanently stuck on
// "reconnect GitHub" no matter how many times the user reconnects.
//
// But the live user token is only an upgrade when the repo is THEIRS.
// `ensureRepoForBranch` falls back to the platform's GITHUB_TOKEN when no
// account is connected, and the repo is then owned by the platform account —
// the user's own token has no access to it at all. Preferring the user token
// unconditionally 404s every push and dispatch on those branches. So: use the
// connected account's live token only when it owns `cfg.owner`; otherwise keep
// the snapshot, which is the identity that created the repo in the first place.
// Where a resolved token came from. "user" = the branch owner's currently
// connected GitHub account (it owns the repo — a reconnect heals it). "platform"
// = the snapshot stored when the repo was created, or the platform's
// GITHUB_TOKEN env — repos the platform owns, where the user's own token has
// no access at all. Callers MUST consult this before telling a user to
// reconnect: on "platform" the reconnection loop can never change anything.
export type ResolvedTokenSource = "user" | "platform";

export async function resolveTokenForBranch(
  ctx: ActionCtx,
  projectId: string,
  cfg: GhConfig,
): Promise<{ token: string | undefined; source: ResolvedTokenSource }> {
  try {
    const project = await ctx.runQuery(internal.codeProjects.getProjectInternal, { projectId }) as { userId?: Id<"users"> } | null;
    if (project?.userId) {
      const account = await ctx.runQuery(internal.githubHelpers.getGithubToken, { userId: project.userId }) as { accessToken?: string; username?: string } | null;
      const ownsRepo = !!account?.username
        && account.username.toLowerCase() === cfg.owner.toLowerCase();
      if (account?.accessToken && ownsRepo) return { token: account.accessToken, source: "user" };
    }
  } catch { /* fall through to the snapshot */ }
  return { token: cfg.githubToken || process.env.GITHUB_TOKEN, source: "platform" };
}

// GitHub reports an OAuth token's granted scopes on EVERY authenticated REST
// response, in `x-oauth-scopes`. That header is the only reliable way to tell
// "your token lacks `workflow`" apart from "that branch ref doesn't exist yet"
// or "this repo isn't yours" — all three come back as a bare 404 on a write
// under .github/workflows/. Returns null when the header is absent (fine-grained
// PATs and GitHub App tokens don't send it), which callers must NOT read as
// "scope missing".
async function tokenGrantsWorkflowScope(octokit: Octokit): Promise<boolean | null> {
  try {
    const res = await octokit.request("GET /user");
    const raw = res.headers["x-oauth-scopes"];
    if (typeof raw !== "string") return null;
    return raw.split(",").map((s) => s.trim()).includes("workflow");
  } catch {
    return null;
  }
}

// Exported for githubSync.ts, which runs the push side of the same commands:
// a push written with the snapshotted token while the worker boots with the
// live token leaves a reconnected branch pushing with a dead token forever.

// Shared by the VM and sandbox workflow writers: decide what a 403/404 on a
// write under .github/workflows/ actually means, and only blame the scope when
// GitHub itself says the scope is absent.
async function classifyWorkflowWriteError(octokit: Octokit, err: unknown): Promise<Error> {
  const status = (err as { status?: number } | undefined)?.status;
  if (status === 403 || status === 404) {
    const granted = await tokenGrantsWorkflowScope(octokit);
    if (granted === false) return new WorkflowScopeMissingError(PLATFORM_WORKFLOW_SCOPE_MSG);
  }
  return err instanceof Error ? err : new Error(String(err));
}

/** Idempotently write `content` to `path` on `branch` in `owner/repo`, skipping
 *  the write when the content already matches (avoids commit churn on every
 *  boot). A write failure is put through classifyWorkflowWriteError so a
 *  genuine missing-`workflow`-scope case stays distinguishable from anything
 *  else — most commonly, from `branch` not existing yet. */
async function ensureFileOnBranch(
  octokit: Octokit, owner: string, repo: string, path: string, branch: string,
  content: string, message: string,
): Promise<void> {
  let existingSha: string | undefined;
  try {
    const { data } = await octokit.repos.getContent({ owner, repo, path, ref: branch });
    if (!Array.isArray(data) && "sha" in data) {
      if ("content" in data && typeof data.content === "string") {
        if (Buffer.from(data.content, "base64").toString("utf8") === content) return;
      }
      existingSha = data.sha;
    }
  } catch { /* not there yet, or `branch` doesn't exist — the write below surfaces which */ }

  try {
    await octokit.repos.createOrUpdateFileContents({
      owner, repo, path, message,
      content: Buffer.from(content, "utf8").toString("base64"),
      branch,
      ...(existingSha ? { sha: existingSha } : {}),
    });
  } catch (err) {
    throw await classifyWorkflowWriteError(octokit, err);
  }
}

// GitHub only enables workflow_dispatch — the API call the whole VM/sandbox
// mechanism runs on — for a workflow whose `on: workflow_dispatch` trigger it
// can resolve via the repo's DEFAULT branch. A copy that exists ONLY on the
// per-branch working repo's own branch (which githubAutoCreate.ts always makes
// a freshly generated name, never the default branch) makes
// createWorkflowDispatch 404 unconditionally, forever, no matter how many
// times the run is retried.
//
// Confirmed live against this repo, not from memory of GitHub's docs:
// dispatching a workflow present only on a feature branch 404s every single
// time; the identical dispatch call succeeds within seconds of an identical
// copy landing on the default branch too, and the run it produces still uses
// the FEATURE branch's copy (the run's head_branch was the feature branch, not
// main) — so the default-branch copy exists purely to register the trigger,
// it never executes. Both copies are required. This was true from the day this
// mechanism shipped; every "workflow-scope-missing" classification anyone saw
// on a fresh branch was this, not the token.
async function ensureWorkflowOnRepo(
  octokit: Octokit, cfg: GhConfig, path: string, yaml: string, label: string,
): Promise<void> {
  const { data: repo } = await octokit.repos.get({ owner: cfg.owner, repo: cfg.repo });
  const defaultBranch = repo.default_branch;

  await ensureFileOnBranch(
    octokit, cfg.owner, cfg.repo, path, defaultBranch, yaml,
    `ci: ${label} (register workflow_dispatch)`,
  );
  if (cfg.branch === defaultBranch) return; // one copy already covers both roles

  for (const attempt of [1, 2]) {
    try {
      await ensureFileOnBranch(octokit, cfg.owner, cfg.repo, path, cfg.branch, yaml, `ci: ${label}`);
      return;
    } catch (err) {
      if (err instanceof WorkflowScopeMissingError) throw err;
      const status = (err as { status?: number } | undefined)?.status;
      if (status !== 404 || attempt === 2) throw err;
      // The working branch's ref doesn't exist yet — a fresh branch whose
      // first push hasn't landed. Fork it from the (now known, not guessed)
      // default branch and retry once.
      try {
        const { data: defaultRef } = await octokit.git.getRef({ owner: cfg.owner, repo: cfg.repo, ref: `heads/${defaultBranch}` });
        await octokit.git.createRef({ owner: cfg.owner, repo: cfg.repo, ref: `refs/heads/${cfg.branch}`, sha: defaultRef.object.sha });
      } catch {
        throw err; // couldn't create the ref either — surface the original 404
      }
    }
  }
}

async function ensureVmWorkflowWithBranch(octokit: Octokit, cfg: GhConfig): Promise<void> {
  await ensureWorkflowOnRepo(octokit, cfg, VM_WORKFLOW_PATH, VM_WORKFLOW_YAML, "thalamus vm worker");
}

// ── Build mirror ─────────────────────────────────────────────────────────────
// The user's repo holds ONLY project code — no conversation transcript, no
// workflow files, nothing Thalamus-made (that is the product decision from
// the Git Sync redesign). Cloud command execution therefore cannot run there:
// GitHub needs a workflow file in a repo that contains the code. The answer is
// the build mirror, a platform-owned repo carrying the same project code plus
// the managed VM/sandbox workflows. Two consequences worth the indirection:
// the user's OAuth token never writes under .github/workflows/ (plain `repo`
// scope forever — the reconnect-for-workflow dance is gone for good), and the
// only token that still needs the workflow scope is the platform's own
// GITHUB_TOKEN, an admin-managed secret in one place. Mirrors are PUBLIC by
// deliberate product choice (unlimited free Actions minutes) — the tradeoff
// is recorded in schema.ts and told to the user in the Git Sync tab.
//
// Legacy platform-hosted branches predate the mirror: their repo already
// holds the system files, so the mirror fields simply point back at the repo
// itself and nothing changes for them.
export const ensureVmMirror = internalAction({
  args: { branchId: v.string() },
  handler: async (ctx, args): Promise<{ owner: string; repo: string; distinctFromUserRepo: boolean } | null> => {
    const branch = await ctx.runQuery(internal.codeBranches.getBranchInternal, { branchId: args.branchId });
    if (!branch) return null;
    const cfg = await ctx.runQuery(internal.githubSyncHelpers.getGithubConfigInternal, {
      projectId: branch.projectId, branchId: args.branchId,
    }) as (GhConfig & { repoUrl?: string; vmOwner?: string; vmRepo?: string }) | null;
    if (!cfg) {
      // No user repo — GitHub was never connected. Cloud execution must NOT
      // depend on that: the workspace's whole content is seeded from the
      // branch's Convex file store (pushFilesToRef below), so a user repo
      // was only ever a naming anchor. Provision a standalone platform-owned
      // build workspace and run commands there — the user never needs to
      // know a GitHub account exists, let alone connect one.
      const platformToken = process.env.GITHUB_TOKEN;
      if (!platformToken) {
        await ctx.runMutation(internal.codeBranches.setExecutorBlocked, {
          branchId: args.branchId,
          reason:
            "Cloud commands cannot start on this branch: the platform's GITHUB_TOKEN is not configured on the "
            + "server, so the build workspace cannot be created. "
            + "This is a platform-side configuration issue for the site admin, not anything about your GitHub connection. "
            + "The Thalamus desktop app still runs commands on your own machine.",
        }).catch(() => {});
        return null;
      }
      try {
        const octokit = new Octokit({ auth: platformToken });
        const { data: me } = await octokit.users.getAuthenticated();
        const base = sanitizeRepoName(`thalamus-vm-${args.branchId.slice(-8)}`) || "thalamus-vm";
        let vmRepo = base;
        let htmlUrl = "";
        // Same rule as user-repo creation: a name collision is cosmetic and
        // must never kill the workspace — numbered suffixes, then a random
        // tag (the base already carries the branch id, so this is belt and
        // braces for re-created branches).
        for (let attempt = 0; attempt < 8; attempt++) {
          if (attempt > 0) {
            vmRepo = attempt <= 4
              ? `${base}-${attempt + 1}`
              : `${base.slice(0, 93)}-${randomDigits(4)}`;
          }
          try {
            const { data } = await octokit.repos.createForAuthenticatedUser({
              name: vmRepo,
              description: "Thalamus build workspace (standalone)",
              private: false, auto_init: false, has_issues: false, has_projects: false, has_wiki: false,
            });
            htmlUrl = data.html_url;
            break;
          } catch (err) {
            const status = (err as { status?: number })?.status;
            if (status === 422) { continue; }
            throw err;
          }
        }
        if (!htmlUrl) throw new Error("Failed to create the build workspace repository — every name variant was taken on the platform account");

        // One branch, "main": the README creates the ref, then the branch's
        // CURRENT code lands BEFORE the workspace is trusted (saveVmMirror
        // is the trust marker — autoPush only syncs a workspace it can see).
        await octokit.repos.createOrUpdateFileContents({
          owner: me.login, repo: vmRepo, path: "README.md",
          message: "chore: init build workspace",
          content: Buffer.from("# Thalamus build workspace\n\nStandalone workspace — the branch's commands run here.\n").toString("base64"),
          branch: "main",
        });
        const files = (await ctx.runQuery(internal.codeBranches.getFilesInternal, {
          branchId: args.branchId,
        })).filter((f) => !isSystemPath(f.filepath));
        await pushFilesToRef(octokit, me.login, vmRepo, "main", files, "chore: seed build workspace");

        await ctx.runMutation(internal.githubSyncHelpers.saveVmMirror, {
          branchId: args.branchId, vmOwner: me.login, vmRepo, vmRepoUrl: htmlUrl,
          projectId: branch.projectId, branch: "main",
        });
        return { owner: me.login, repo: vmRepo, distinctFromUserRepo: true };
      } catch (err) {
        console.error("ensureVmMirror standalone create failed:", err);
        await ctx.runMutation(internal.codeBranches.setExecutorBlocked, {
          branchId: args.branchId,
          reason:
            "Cloud commands cannot start on this branch: creating the platform build workspace failed ("
            + (err instanceof Error ? err.message.slice(0, 200) : "unknown error")
            + "). This is a platform-side issue — the desktop app still runs commands on your own machine.",
        }).catch(() => {});
        return null;
      }
    }
    if (cfg.vmOwner && cfg.vmRepo) {
      const distinct = cfg.vmRepo !== cfg.repo || cfg.vmOwner !== cfg.owner;
      return { owner: cfg.vmOwner, repo: cfg.vmRepo, distinctFromUserRepo: distinct };
    }

    // A repo on the user's own account must stay code-only, so its mirror
    // lives on the platform account. Anything else (platform-hosted legacy,
    // snapshot-owned) already contains the system files — mirror = itself.
    const project = await ctx.runQuery(internal.codeProjects.getProjectInternal, { projectId: branch.projectId }) as { userId?: Id<"users"> } | null;
    let userOwnsRepo = false;
    if (project?.userId) {
      const account = await ctx.runQuery(internal.githubHelpers.getGithubToken, { userId: project.userId }) as { username?: string } | null;
      userOwnsRepo = !!account?.username && account.username.toLowerCase() === cfg.owner.toLowerCase();
    }
    if (!userOwnsRepo) {
      await ctx.runMutation(internal.githubSyncHelpers.saveVmMirror, {
        branchId: args.branchId,
        vmOwner: cfg.owner,
        vmRepo: cfg.repo,
        vmRepoUrl: cfg.repoUrl ?? `https://github.com/${cfg.owner}/${cfg.repo}`,
      });
      return { owner: cfg.owner, repo: cfg.repo, distinctFromUserRepo: false };
    }

    const platformToken = process.env.GITHUB_TOKEN;
    if (!platformToken) {
      await ctx.runMutation(internal.codeBranches.setExecutorBlocked, {
        branchId: args.branchId,
        reason:
          "Cloud commands cannot start on this branch: the platform's GITHUB_TOKEN is not configured on the "
          + "server, so the build workspace (the public mirror your code is built in) cannot be created. "
          + "This is a server-side configuration issue for the site admin, not your GitHub connection. "
          + "The Thalamus desktop app still runs commands on your own machine.",
      }).catch(() => {});
      return null;
    }

    try {
      const octokit = new Octokit({ auth: platformToken });
      const { data: me } = await octokit.users.getAuthenticated();
      const base = sanitizeRepoName(`${cfg.repo}-vm`) || "thalamus-vm";
      let vmRepo = base;
      let htmlUrl = "";
      // A name collision is cosmetic and must never kill the workspace:
      // numbered suffixes, then a random tag (re-created branches whose old
      // mirror still lingers are the usual 422 here).
      for (let attempt = 0; attempt < 8; attempt++) {
        if (attempt > 0) {
          vmRepo = attempt <= 4
            ? `${base}-${attempt + 1}`
            : `${base.slice(0, 93)}-${randomDigits(4)}`;
        }
        try {
          const { data } = await octokit.repos.createForAuthenticatedUser({
            name: vmRepo,
            description: `Thalamus build workspace - managed mirror of ${cfg.owner}/${cfg.repo}`,
            private: false,
            auto_init: false,
            has_issues: false,
            has_projects: false,
            has_wiki: false,
          });
          htmlUrl = data.html_url;
          break;
        } catch (err) {
          const status = (err as { status?: number })?.status;
          if (status === 422) { continue; }
          throw err;
        }
      }
      if (!htmlUrl) throw new Error("Failed to create the build workspace repository — every name variant was taken on the platform account");

      // Seed the default branch so workflow_dispatch registration has a home
      // (see ensureWorkflowOnRepo), then fork the working branch the worker
      // tracks from it.
      await octokit.repos.createOrUpdateFileContents({
        owner: me.login, repo: vmRepo, path: "README.md",
        message: "chore: init build workspace",
        content: Buffer.from(
          `# Thalamus build workspace\n\nManaged mirror of ${cfg.owner}/${cfg.repo}. Workflows under .github/workflows/ run this branch's commands here.${"\n"}`,
        ).toString("base64"),
        branch: "main",
      });
      const { data: mainRef } = await octokit.git.getRef({ owner: me.login, repo: vmRepo, ref: "heads/main" });
      await octokit.git.createRef({ owner: me.login, repo: vmRepo, ref: `refs/heads/${cfg.branch}`, sha: mainRef.object.sha });

      // Land the branch's CURRENT code on the mirror's working branch BEFORE
      // the mirror is trusted (saveVmMirror below is the trust marker). The
      // pipeline's autoPush only updates a mirror it can see in the config,
      // so everything written before this moment exists solely in Convex and
      // the user repo — a mirror saved without this push leaves the very
      // first worker cloning README-only code, the empty-clone bug all over
      // again. A seed failure therefore returns BEFORE saveVmMirror: the next
      // boot re-creates from scratch (name suffix absorbs the orphaned repo)
      // rather than locking a known-stale mirror into the config.
      const files = (await ctx.runQuery(internal.codeBranches.getFilesInternal, {
        branchId: args.branchId,
      })).filter((f) => !isSystemPath(f.filepath));
      await pushFilesToRef(
        octokit, me.login, vmRepo, cfg.branch, files, "chore: seed build workspace",
      );

      await ctx.runMutation(internal.githubSyncHelpers.saveVmMirror, {
        branchId: args.branchId, vmOwner: me.login, vmRepo, vmRepoUrl: htmlUrl,
      });
      return { owner: me.login, repo: vmRepo, distinctFromUserRepo: true };
    } catch (err) {
      console.error("ensureVmMirror create failed:", err);
      await ctx.runMutation(internal.codeBranches.setExecutorBlocked, {
        branchId: args.branchId,
        reason:
          "Cloud commands cannot start on this branch: creating the platform build workspace failed ("
          + (err instanceof Error ? err.message.slice(0, 200) : "unknown error")
          + "). This is a platform-side issue — the desktop app still runs commands on your own machine.",
      }).catch(() => {});
      return null;
    }
  },
});

// Where cloud commands actually run for this branch: the build mirror's
// coordinates + a token that can act on it — never the user's repo directly.
// A distinct mirror always authenticates as the platform (any user token is
// the wrong account there); a self-mirror (legacy platform-hosted) keeps the
// snapshot/platform resolution it always had.
async function resolveVmTarget(
  ctx: ActionCtx,
  branchId: string,
): Promise<{ cfg: GhConfig; owner: string; repo: string; token: string | undefined } | null> {
  const branch = await ctx.runQuery(internal.codeBranches.getBranchInternal, { branchId });
  if (!branch) return null;
  const cfg = await ctx.runQuery(internal.githubSyncHelpers.getGithubConfigInternal, {
    projectId: branch.projectId, branchId,
  }) as GhConfig | null;
  if (!cfg) return null;
  const mirror = await ctx.runAction(internal.githubActionsRunner.ensureVmMirror, { branchId });
  if (!mirror) return null;
  const token = mirror.distinctFromUserRepo
    ? process.env.GITHUB_TOKEN
    : (await resolveTokenForBranch(ctx, branch.projectId, {
        owner: mirror.owner, repo: mirror.repo, branch: cfg.branch, githubToken: cfg.githubToken,
      })).token;
  return { cfg, owner: mirror.owner, repo: mirror.repo, token };
}

// Boots the branch's VM worker unless one is already alive. Idempotent: the
// pipeline calls this on every prompt (startPipeline) and on every stop in the
// paused path (executeBranchCommandsViaActions), so a busy worker is a no-op.
// The worker heartbeats every 10s via /code/vm-poll; anything seen within
// VM_ALIVE_WINDOW_MS is live, so the only way a second VM is ever booted is
// if the first one genuinely died. Returns a status so callers that are parked
// on queued commands can fail them fast when no VM can ever come.
export const bootVmForBranch = internalAction({
  args: { branchId: v.string() },
  handler: async (ctx, args): Promise<"booted" | "alive" | "local" | "no-repo" | "no-token" | "dispatch-error" | "workflow-scope-missing"> => {
    // Local (desktop) branches run commands on the user's own machine — never boot a VM.
    const branch = await ctx.runQuery(internal.codeBranches.getBranchInternal, { branchId: args.branchId });
    if (!branch) return "local";
    if (branch.executor === "local") return "local";

    const aliveSince = (branch as Record<string, unknown> | null)?.vmLastSeenAt as number | undefined;
    if (aliveSince !== undefined && Date.now() - aliveSince < VM_ALIVE_WINDOW_MS) {
      // A live worker means the executor is definitively working — a stale
      // blocked-reason from an earlier failure would only confuse agents into
      // silence. Clear it (the mutation no-ops when already undefined).
      await ctx.runMutation(internal.codeBranches.setExecutorBlocked, {
        branchId: args.branchId, reason: null,
      }).catch(() => {});
      return "alive";
    }

    let cfg = await ctx.runQuery(internal.githubSyncHelpers.getGithubConfigInternal, {
      projectId: branch.projectId, branchId: args.branchId,
    }) as GhConfig | null;
    if (!cfg) {
      // No user repo — GitHub never connected. That must NOT block
      // execution: the workspace content comes from the branch's own file
      // store, so ensureVmMirror provisions a standalone platform-owned
      // workspace and returns a row to run against. It only fails (stamping
      // the precise reason itself) when the PLATFORM side is misconfigured —
      // never because the user didn't connect GitHub, an account they don't
      // even know exists.
      await ctx.runAction(internal.githubActionsRunner.ensureVmMirror, { branchId: args.branchId });
      cfg = await ctx.runQuery(internal.githubSyncHelpers.getGithubConfigInternal, {
        projectId: branch.projectId, branchId: args.branchId,
      }) as GhConfig | null;
      if (!cfg) return "dispatch-error";
    }

    const target = await resolveVmTarget(ctx, args.branchId);
    if (!target) {
      // ensureVmMirror already stamped the precise blocked reason (platform
      // token missing, workspace creation failed) — nothing here can proceed.
      return "dispatch-error";
    }
    const token = target.token;
    if (!token) {
      await ctx.runMutation(internal.codeBranches.setExecutorBlocked, {
        branchId: args.branchId,
        reason:
          "Cloud commands cannot be dispatched: no token can act on this branch's build workspace. "
          + "The platform's GITHUB_TOKEN is the identity used there — an admin must verify it.",
      });
      return "no-token";
    }

    // Commands run against the build mirror, not the user's repo — the same
    // working-branch name exists on both, and autoPush keeps the mirror's
    // copy current before anything queues.
    const vmCfg: GhConfig = { owner: target.owner, repo: target.repo, branch: cfg.branch, githubToken: cfg.githubToken };
    try {
      const octokit = new Octokit({ auth: token });
      await ensureVmWorkflowWithBranch(octokit, vmCfg);

      // The nonce is the worker's only credential to the (unauthenticated) poll
      // endpoint — a public-repo Actions job has nothing else to prove identity.
      const nonce = crypto.randomUUID();
      await ctx.runMutation(internal.codeBranches.setVmInfo, {
        branchId: args.branchId, nonce, lastSeenAt: Date.now(),
      });

      await octokit.actions.createWorkflowDispatch({
        owner: vmCfg.owner,
        repo: vmCfg.repo,
        workflow_id: VM_WORKFLOW_FILE,
        ref: cfg.branch,
        inputs: {
          branch_id: args.branchId,
          vm_nonce: nonce,
          callback_base: `${process.env.CONVEX_SITE_URL}`,
          os: RUNNERS[branch.runnerOs ?? "ubuntu"] ?? RUNNERS.ubuntu,
          branch: cfg.branch,
        },
      });
      // The workflow is written and a run was dispatched — commands can flow
      // again. Clear any prior blocked-reason so the agent prompt re-enables
      // the cmd op advertisement on the next runPipelineAction step.
      await ctx.runMutation(internal.codeBranches.setExecutorBlocked, {
        branchId: args.branchId, reason: null,
      });
      return "booted";
    } catch (err) {
      // A failed dispatch must not leave a stale "alive" heartbeat blocking
      // retries — clear the last-seen so the next boot attempt (next prompt,
      // next command) tries again immediately.
      await ctx.runMutation(internal.codeBranches.setVmInfo, {
        branchId: args.branchId, lastSeenAt: 0,
      }).catch(() => {});
      // Distinguish the "OAuth token lacks the `workflow` scope" case so the
      // command-result surface can tell the user to reconnect GitHub instead
      // of showing a generic "could not start" message that hides the fix.
      if (err instanceof WorkflowScopeMissingError) {
        // In the mirror era the only identity that can hit this is the
        // platform's own token — the admin-facing truth, never a user
        // reconnect instruction the architecture cannot honour.
        await ctx.runMutation(internal.codeBranches.setExecutorBlocked, {
          branchId: args.branchId,
          reason: PLATFORM_WORKFLOW_SCOPE_MSG,
        }).catch(() => {});
        return "workflow-scope-missing";
      }
      // Everything else — network flake, GitHub 5xx, repo genuinely gone — is
      // treated as retryable and must NOT set executorBlockedReason: a sticky
      // block that only a reconnect can clear is exactly the trap this path used
      // to fall into. Log the real error; the status alone hides it completely.
      console.error("bootVmForBranch dispatch failed:", err);
      return "dispatch-error";
    }
  },
});

// Kept name — preserves every existing scheduler/UI caller. Used to dispatch
// one workflow run per queued command; now it boots the persistent VM worker
// (once) and lets it sweep the queue. If a VM can never come (no repo/token),
// it fails the queued commands and resumes the pipeline, exactly like the old
// dispatch-failure path did — so a branch can't park silently forever.
export const executeBranchCommandsViaActions = internalAction({
  args: { branchId: v.string() },
  handler: async (ctx, args): Promise<void> => {
    const backlog = await ctx.runQuery(internal.codeCommands.getPendingCommands, { branchId: args.branchId }) as Array<{ _id: Id<"codeCommands"> }>;
    if (!backlog || backlog.length === 0) return;

    const status = await ctx.runAction(internal.githubActionsRunner.bootVmForBranch, { branchId: args.branchId });

    // bootVmForBranch stamps executorBlockedReason with the explanation that
    // matches the token that actually failed (user vs platform) — failing the
    // queued commands with the constant user-reconnect text here is what put
    // a platform-hosted branch into a reconnect loop the user could never
    // break out of.
    const branchAfter = await ctx.runQuery(internal.codeBranches.getBranchInternal, { branchId: args.branchId }) as { executorBlockedReason?: string } | null;
    const stampedReason = branchAfter?.executorBlockedReason;

    const dead = status === "no-repo" || status === "no-token" || status === "dispatch-error" || status === "workflow-scope-missing";
    if (dead) {
      for (const cmd of backlog) {
        await ctx.runMutation(internal.codeCommands.recordCommandResult, {
          commandId: cmd._id,
          status: "failed",
          exitCode: 1,
          // "no-repo" is unreachable since the executor self-provisions a
          // standalone workspace (kept in the union for old callers); the
          // operational dead states are the platform-side ones below.
          output: status === "no-token"
              ? "No GitHub token available to dispatch the VM worker."
              : status === "workflow-scope-missing"
                ? (stampedReason ?? PLATFORM_WORKFLOW_SCOPE_MSG)
                : "Could not start the VM worker for this branch — the flow recovered and you can try running the command again.",
        });
      }
      await ctx.scheduler.runAfter(0, internal.codePipeline.runPipelineAction, { branchId: args.branchId });
    }
  },
});;

/** Ensure the sandbox workflow file is registered (default branch) and present
 *  on the working branch, creating the working branch's ref if needed. Same
 *  two-copy requirement as ensureVmWorkflowWithBranch — see
 *  ensureWorkflowOnRepo for why. */
async function ensureSandboxWorkflowWithBranch(octokit: Octokit, cfg: GhConfig): Promise<void> {
  await ensureWorkflowOnRepo(octokit, cfg, SANDBOX_WORKFLOW_PATH, SANDBOX_WORKFLOW_YAML, "thalamus sandbox preview");
}

export const startSandbox = internalAction({
  args: {
    branchId: v.string(),
    projectId: v.string(),
    startCommand: v.optional(v.string()),
    port: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    let cfg = await ctx.runQuery(internal.githubSyncHelpers.getGithubConfigInternal, {
      projectId: args.projectId, branchId: args.branchId,
    }) as GhConfig | null;
    // ConvexError, not Error, for every throw on this path: production redacts a
    // plain Error to a bare "Server Error: Called by client", so the user (and
    // anyone debugging from a bug report) got nothing at all — not "no repo yet",
    // not "already running", not "rate-limited". Same reasoning as admin.ts.
    if (!cfg) {
      // No user repo (GitHub never connected) — the sandbox runs in the same
      // standalone platform workspace the VM executor uses; provision it here
      // rather than demanding the user connect anything.
      await ctx.runAction(internal.githubActionsRunner.ensureVmMirror, { branchId: args.branchId });
      cfg = await ctx.runQuery(internal.githubSyncHelpers.getGithubConfigInternal, {
        projectId: args.projectId, branchId: args.branchId,
      }) as GhConfig | null;
      if (!cfg) {
        throw new ConvexError(
          "The build workspace could not be created yet (a platform-side issue is stamped on this branch). "
          + "Wait a moment and retry — the desktop app runs sandboxes on your own machine in the meantime.",
        );
      }
    }
    const target = await resolveVmTarget(ctx, args.branchId);
    if (!target) {
      throw new ConvexError(
        "The build workspace for this branch could not be prepared, so the sandbox has nowhere to run. "
        + "The reason is on this branch's activity feed; the desktop app runs on your own machine instead.",
      );
    }
    const token = target.token;
    if (!token) {
      throw new ConvexError(
        `No token can act on this branch's build workspace (${target.owner}/${target.repo}). `
        + "Ask an admin to verify the platform's GITHUB_TOKEN.",
      );
    }
    const vmCfg: GhConfig = { owner: target.owner, repo: target.repo, branch: cfg.branch, githubToken: cfg.githubToken };

    const branch = await ctx.runQuery(internal.codeBranches.getBranchInternal, { branchId: args.branchId });
    // A repeat click while one dispatch is already in flight would fire a
    // second workflow_dispatch, and the two runs' callbacks race to overwrite
    // sandboxUrl — the loser's tunnel is the one left dangling as "running".
    const currentStatus = (branch as Record<string, unknown>)?.sandboxStatus;
    if (currentStatus === "starting" || currentStatus === "running") {
      throw new ConvexError("A sandbox is already starting or running for this branch. Stop it before starting another.");
    }

    const octokit = new Octokit({ auth: token });

    const pushResult = await ctx.runAction(internal.githubSync.autoPushToGithub, {
      branchId: args.branchId,
      commitMessage: "build: sync before sandbox",
    });
    if (!pushResult.success) {
      const msg = pushResult.error ?? "unknown error";
      // If the auto-push failed because the branch doesn't exist, we create it
      // below in the workflow-fallback. If it was a rate-limit, the blob retry
      // loop already waited — an error here means we're genuinely hosed.
      if (msg.includes("secondary rate") || msg.includes("403")) {
        throw new ConvexError(
          "GitHub is rate-limiting pushes. Wait a few minutes, then try again. "
          + "The sandbox cannot start until the branch is synced."
        );
      }
      console.error("autoPushToGithub failed, continuing:", msg);
    }
    await ensureSandboxWorkflowWithBranch(octokit, vmCfg);

    // The nonce is the only thing standing between this endpoint and a forged
    // callback — the run POSTs from a public-repo Actions job with no other
    // credential to send. Stored now, spent (and cleared) by the one real
    // callback the dispatch below produces.
    const nonce = crypto.randomUUID();
    const callbackUrl = `${process.env.CONVEX_SITE_URL}/code/sandbox-callback`
      + `?branchId=${encodeURIComponent(args.branchId)}&nonce=${nonce}`;

    const runnerOs = (branch as Record<string,unknown>)?.runnerOs ?? "ubuntu";

    await octokit.actions.createWorkflowDispatch({
      owner: vmCfg.owner,
      repo: vmCfg.repo,
      workflow_id: SANDBOX_WORKFLOW_FILE,
      ref: cfg.branch,
      inputs: {
        callback_url: callbackUrl,
        os: RUNNERS[runnerOs as string] ?? RUNNERS.ubuntu,
        // The trailing "--" is load-bearing: the workflow script runs
        // `eval "$CMD --host 0.0.0.0 --port $PORT"`, and without a "--"
        // separator npm swallows --host/--port as its OWN flags instead of
        // forwarding them to the dev server, so it never binds 0.0.0.0 and
        // the tunnel has nothing to reach.
        start_command: args.startCommand ?? "npm run dev --",
        port: String(args.port ?? 3000),
      },
    });

    // Poll briefly for the run ID (dispatch is async so the run may not exist yet).
    let runId: number | null = null;
    for (let i = 0; i < 10; i++) {
      await new Promise(r => setTimeout(r, 1000));
      try {
        const { data: runs } = await octokit.actions.listWorkflowRuns({
          owner: vmCfg.owner, repo: vmCfg.repo, workflow_id: SANDBOX_WORKFLOW_FILE,
          branch: cfg.branch, per_page: 1,
        });
        if (runs.total_count && runs.workflow_runs?.[0]) {
          runId = runs.workflow_runs[0].id;
          break;
        }
      } catch { /* retry */ }
    }

    await ctx.runMutation(internal.codeBranches.setSandboxInfo, {
      branchId: args.branchId, url: null, status: "starting", runId, callbackNonce: nonce,
    });
  },
});

export const stopSandbox = internalAction({
  args: {
    branchId: v.string(),
    projectId: v.string(),
  },
  handler: async (ctx, args) => {
    const branch = await ctx.runQuery(internal.codeBranches.getBranchInternal, { branchId: args.branchId });
    let runId = (branch as Record<string,unknown>)?.sandboxRunId as number | undefined;

    const cfg = await ctx.runQuery(internal.githubSyncHelpers.getGithubConfigInternal, {
      projectId: args.projectId, branchId: args.branchId,
    }) as GhConfig | null;

    if (cfg) {
      const target = await resolveVmTarget(ctx, args.branchId);
      const token = target?.token;
      if (target) Object.assign(cfg, { owner: target.owner, repo: target.repo });
      if (token) {
        const octokit = new Octokit({ auth: token });
        // If we don't have a stored run ID, try to find the active run.
        if (!runId) {
          try {
            const { data: runs } = await octokit.actions.listWorkflowRuns({
              owner: cfg.owner, repo: cfg.repo, workflow_id: SANDBOX_WORKFLOW_FILE,
              branch: cfg.branch, per_page: 5, status: "in_progress",
            });
            if (runs.workflow_runs?.[0]) runId = runs.workflow_runs[0].id;
          } catch { /* not found */ }
        }
        if (runId) {
          try {
            await octokit.actions.cancelWorkflowRun({
              owner: cfg.owner, repo: cfg.repo, run_id: runId,
            });
          } catch { /* already finished or not found */ }
        }
      }
    }

    await ctx.runMutation(internal.codeBranches.setSandboxInfo, {
      branchId: args.branchId, url: null, status: "stopped", runId: null, callbackNonce: null,
    });
  },
});

// ── Admin: platform GitHub token health ──────────────────────────────────────
// The platform's GITHUB_TOKEN owns every build workspace (the <repo>-vm
// mirrors AND the standalone thalamus-vm-* ones), and every cloud command
// dies with the same half-mystery when it goes bad — a 401 surfaces to the
// BRANCH's owner as "platform-side configuration issue", which the admin then
// cannot verify without reading Convex logs line by line. This check answers
// the only three questions that matter, live: is the env var set, does GitHub
// accept it, and do its scopes cover what the mirror needs (repo + workflow).
// Same ADMIN_TOKEN gate as every other admin action. Reports verdicts only —
// the token's value never leaves the server.
export const adminCheckPlatformGithub = action({
  args: { adminToken: v.string() },
  handler: async (_ctx, args): Promise<{
    tokenPresent: boolean;
    authenticated: boolean;
    login?: string;
    scopes?: string[] | null; // null = fine-grained PAT / app token (no scope header)
    hasRepoScope?: boolean | null;
    hasWorkflowScope?: boolean | null;
    verdict: string;
    fix?: string;
  }> => {
    if (!process.env.ADMIN_TOKEN || args.adminToken !== process.env.ADMIN_TOKEN) {
      throw new Error("Unauthorized");
    }

    const token = (process.env.GITHUB_TOKEN ?? "").trim();
    const FIX_TOKEN =
      "GitHub → platform account → Settings → Developer settings → Personal access tokens (classic) → "
      + "generate a token with the `repo` and `workflow` scopes → Convex dashboard → Settings → "
      + "Environment Variables → set GITHUB_TOKEN to the new value. Every blocked branch heals itself "
      + "on its next prompt — no redeploy needed.";

    if (!token) {
      return {
        tokenPresent: false,
        authenticated: false,
        verdict: "GITHUB_TOKEN is not set in this deployment's environment — cloud command execution is disabled platform-wide.",
        fix: FIX_TOKEN,
      };
    }

    const octokit = new Octokit({ auth: token });
    try {
      const res = await octokit.request("GET /user");
      const login = (res.data as { login?: string }).login;
      const raw = res.headers["x-oauth-scopes"];
      const scopes = typeof raw === "string"
        ? raw.split(",").map((s) => s.trim()).filter(Boolean)
        : null; // fine-grained PATs and app tokens send no scope header
      const hasRepoScope = scopes ? scopes.includes("repo") : null;
      const hasWorkflowScope = scopes ? scopes.includes("workflow") : null;

      if (hasWorkflowScope === false) {
        return {
          tokenPresent: true, authenticated: true, login, scopes, hasRepoScope, hasWorkflowScope,
          verdict: `Token authenticates as "${login}" but LACKS the workflow scope — GitHub will refuse every workflow file write (bare 404), so cloud commands cannot start.`,
          fix: FIX_TOKEN,
        };
      }
      return {
        tokenPresent: true, authenticated: true, login, scopes, hasRepoScope, hasWorkflowScope,
        verdict: hasWorkflowScope
          ? `Healthy: authenticates as "${login}" with repo + workflow scopes.`
          : `Authenticates as "${login}". No scope header (fine-grained PAT or app token) — scopes cannot be read; if builds fail with 404s under .github/workflows/, the token needs Workflows: write.`,
      };
    } catch (err) {
      const status = (err as { status?: number })?.status;
      const msg = err instanceof Error ? err.message : String(err);
      return {
        tokenPresent: true,
        authenticated: false,
        verdict: status === 401
          ? `GitHub REJECTED the configured GITHUB_TOKEN (401 Bad credentials — the token is wrong, revoked, or an expired fine-grained PAT). Cloud command execution is down platform-wide until it is replaced.`
          : `GitHub check failed (${status ?? "network"}): ${msg.slice(0, 200)}`,
        fix: FIX_TOKEN,
      };
    }
  },
});
