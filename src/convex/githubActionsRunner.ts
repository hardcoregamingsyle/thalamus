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

import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { Octokit } from "@octokit/rest";
import crypto from "crypto";
import type { Id } from "./_generated/dataModel";

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

// Distinct error class so callers can recognize the "OAuth token lacks the
// `workflow` scope" case and surface the reconnect instruction — GitHub
// returns a bare 404 (not a helpful 403) when a token without `workflow`
// tries to write under .github/workflows/, so we can't rely on the status
// text alone to explain it to the user.
class WorkflowScopeMissingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkflowScopeMissingError";
  }
}

const WORKFLOW_SCOPE_MSG =
  "GitHub refused to write the VM worker workflow under .github/workflows/ — "
  + "this happens when the connected GitHub token was issued without the `workflow` scope. "
  + "Reconnect GitHub from the /sync page to re-authorize with the updated scopes, then retry.";

async function ensureVmWorkflow(octokit: Octokit, cfg: GhConfig): Promise<void> {
  let existingSha: string | undefined;
  try {
    const { data } = await octokit.repos.getContent({
      owner: cfg.owner, repo: cfg.repo, path: VM_WORKFLOW_PATH, ref: cfg.branch,
    });
    if (!Array.isArray(data) && "sha" in data) {
      // Already current — rewriting it would churn a commit on every boot.
      if ("content" in data && typeof data.content === "string") {
        const current = Buffer.from(data.content, "base64").toString("utf8");
        if (current === VM_WORKFLOW_YAML) return;
      }
      existingSha = data.sha;
    }
  } catch { /* not there yet */ }

  try {
    await octokit.repos.createOrUpdateFileContents({
      owner: cfg.owner,
      repo: cfg.repo,
      path: VM_WORKFLOW_PATH,
      message: "ci: thalamus vm worker",
      content: Buffer.from(VM_WORKFLOW_YAML, "utf8").toString("base64"),
      branch: cfg.branch,
      ...(existingSha ? { sha: existingSha } : {}),
    });
  } catch (err) {
    const status = (err as { status?: number } | undefined)?.status;
    if (status === 403 || status === 404) {
      throw new WorkflowScopeMissingError(WORKFLOW_SCOPE_MSG);
    }
    throw err;
  }
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
    if (aliveSince !== undefined && Date.now() - aliveSince < VM_ALIVE_WINDOW_MS) return "alive";

    const cfg = await ctx.runQuery(internal.githubSyncHelpers.getGithubConfigInternal, {
      projectId: branch.projectId, branchId: args.branchId,
    }) as GhConfig | null;
    if (!cfg) return "no-repo"; // repo not set up yet — the pipeline must fail commands with the explainer

    const token = cfg.githubToken || process.env.GITHUB_TOKEN;
    if (!token) return "no-token";

    try {
      const octokit = new Octokit({ auth: token });
      await ensureVmWorkflow(octokit, cfg);

      // The nonce is the worker's only credential to the (unauthenticated) poll
      // endpoint — a public-repo Actions job has nothing else to prove identity.
      const nonce = crypto.randomUUID();
      await ctx.runMutation(internal.codeBranches.setVmInfo, {
        branchId: args.branchId, nonce, lastSeenAt: Date.now(),
      });

      await octokit.actions.createWorkflowDispatch({
        owner: cfg.owner,
        repo: cfg.repo,
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
      if (err instanceof WorkflowScopeMissingError) return "workflow-scope-missing";
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

    const dead = status === "no-repo" || status === "no-token" || status === "dispatch-error" || status === "workflow-scope-missing";
    if (dead) {
      for (const cmd of backlog) {
        await ctx.runMutation(internal.codeCommands.recordCommandResult, {
          commandId: cmd._id,
          status: "failed",
          exitCode: 1,
          output: status === "no-repo"
            ? "This branch has no GitHub repo, so there is nowhere to run commands. Connect GitHub on the project, or run the build from the desktop app, which uses your own machine."
            : status === "no-token"
              ? "No GitHub token available to dispatch the VM worker."
              : status === "workflow-scope-missing"
                ? WORKFLOW_SCOPE_MSG
                : "Could not start the VM worker for this branch — the flow recovered and you can try running the command again.",
        });
      }
      await ctx.scheduler.runAfter(0, internal.codePipeline.runPipelineAction, { branchId: args.branchId });
    }
  },
});;

/** Ensure the sandbox workflow file exists, creating the branch if needed. */
async function ensureSandboxWorkflowWithBranch(octokit: Octokit, cfg: GhConfig): Promise<void> {
  const candidates = ["main", "master"];
  for (const attempt of [1, 2]) {
    try {
      await ensureSandboxWorkflow(octokit, cfg);
      return;
    } catch (err) {
      const httpErr = err as { status?: number } | undefined;
      if (httpErr?.status !== 404 || attempt === 2) throw err;
      // Branch doesn't exist — create it from the default branch.
      let created = false;
      for (const candidate of candidates) {
        try {
          const { data: defaultRef } = await octokit.git.getRef({ owner: cfg.owner, repo: cfg.repo, ref: `heads/${candidate}` });
          await octokit.git.createRef({ owner: cfg.owner, repo: cfg.repo, ref: `refs/heads/${cfg.branch}`, sha: defaultRef.object.sha });
          created = true;
          break;
        } catch { /* try next */ }
      }
      if (!created) throw new Error(`Cannot create branch ${cfg.branch}: no default branch found (tried ${candidates.join(", ")})`);
    }
  }
}

async function ensureSandboxWorkflow(octokit: Octokit, cfg: GhConfig): Promise<void> {
  let existingSha: string | undefined;
  try {
    const { data } = await octokit.repos.getContent({
      owner: cfg.owner, repo: cfg.repo, path: SANDBOX_WORKFLOW_PATH, ref: cfg.branch,
    });
    if (!Array.isArray(data) && "sha" in data) {
      if ("content" in data && typeof data.content === "string") {
        const current = Buffer.from(data.content, "base64").toString("utf8");
        if (current === SANDBOX_WORKFLOW_YAML) return;
      }
      existingSha = data.sha;
    }
  } catch { /* not there yet */ }

  try {
    await octokit.repos.createOrUpdateFileContents({
      owner: cfg.owner,
      repo: cfg.repo,
      path: SANDBOX_WORKFLOW_PATH,
      message: "ci: thalamus sandbox preview",
      content: Buffer.from(SANDBOX_WORKFLOW_YAML, "utf8").toString("base64"),
      branch: cfg.branch,
      ...(existingSha ? { sha: existingSha } : {}),
    });
  } catch (err) {
    // ensureSandboxWorkflowWithBranch above treats a 404 as "branch missing"
    // and re-invokes us after creating it. That fallback stays useful, so we
    // only re-tag the second-attempt 404 (existingSha would be set on rewrite,
    // and the branch definitely exists) or an outright 403 — both point to
    // the OAuth token lacking the `workflow` scope.
    const status = (err as { status?: number } | undefined)?.status;
    if (status === 403 || (status === 404 && existingSha !== undefined)) {
      throw new WorkflowScopeMissingError(WORKFLOW_SCOPE_MSG);
    }
    throw err;
  }
}

export const startSandbox = internalAction({
  args: {
    branchId: v.string(),
    projectId: v.string(),
    startCommand: v.optional(v.string()),
    port: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const cfg = await ctx.runQuery(internal.githubSyncHelpers.getGithubConfigInternal, {
      projectId: args.projectId, branchId: args.branchId,
    }) as GhConfig | null;
    if (!cfg) {
      throw new Error("No GitHub repo configured for this branch — cannot start sandbox");
    }
    const token = cfg.githubToken || process.env.GITHUB_TOKEN;
    if (!token) throw new Error("No GitHub token available");

    const branch = await ctx.runQuery(internal.codeBranches.getBranchInternal, { branchId: args.branchId });
    // A repeat click while one dispatch is already in flight would fire a
    // second workflow_dispatch, and the two runs' callbacks race to overwrite
    // sandboxUrl — the loser's tunnel is the one left dangling as "running".
    const currentStatus = (branch as Record<string, unknown>)?.sandboxStatus;
    if (currentStatus === "starting" || currentStatus === "running") {
      throw new Error("A sandbox is already starting or running for this branch.");
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
        throw new Error(
          "GitHub is rate-limiting pushes. Wait a few minutes, then try again. "
          + "The sandbox cannot start until the branch is synced."
        );
      }
      console.error("autoPushToGithub failed, continuing:", msg);
    }
    await ensureSandboxWorkflowWithBranch(octokit, cfg);

    // The nonce is the only thing standing between this endpoint and a forged
    // callback — the run POSTs from a public-repo Actions job with no other
    // credential to send. Stored now, spent (and cleared) by the one real
    // callback the dispatch below produces.
    const nonce = crypto.randomUUID();
    const callbackUrl = `${process.env.CONVEX_SITE_URL}/code/sandbox-callback`
      + `?branchId=${encodeURIComponent(args.branchId)}&nonce=${nonce}`;

    const runnerOs = (branch as Record<string,unknown>)?.runnerOs ?? "ubuntu";

    await octokit.actions.createWorkflowDispatch({
      owner: cfg.owner,
      repo: cfg.repo,
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
          owner: cfg.owner, repo: cfg.repo, workflow_id: SANDBOX_WORKFLOW_FILE,
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
      const token = cfg.githubToken || process.env.GITHUB_TOKEN;
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
