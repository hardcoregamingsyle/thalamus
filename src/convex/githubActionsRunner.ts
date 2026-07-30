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

const WORKFLOW_PATH = ".github/workflows/thalamus-run.yml";
const WORKFLOW_FILE = "thalamus-run.yml";

const SANDBOX_WORKFLOW_PATH = ".github/workflows/thalamus-sandbox.yml";
const SANDBOX_WORKFLOW_FILE = "thalamus-sandbox.yml";

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
          /tmp/cloudflared tunnel --url "http://localhost:\$PORT" > /tmp/tunnel.log 2>&1 &
          CLOUD_PID=\$!

          # Wait up to 60s for tunnel URL
          TUNNEL_URL=""
          for i in \$(seq 1 30); do
            TUNNEL_URL=\$(grep -oP 'https?://[a-zA-Z0-9.-]+\\.trycloudflare\\.com' /tmp/tunnel.log | head -1)
            if [ -n "\$TUNNEL_URL" ]; then break; fi
            sleep 2
          done

          # Start dev server in background
          echo "Starting: \$CMD --host 0.0.0.0 --port \$PORT"
          if echo "\$CMD" | grep -q "vite\\|dev\\|next\\|start"; then
            eval "\$CMD --host 0.0.0.0 --port \$PORT" > /tmp/devserver.log 2>&1 &
          else
            eval "\$CMD" > /tmp/devserver.log 2>&1 &
          fi
          DEV_PID=\$!

          # Report tunnel URL back to Thalamus
          if [ -n "\$TUNNEL_URL" ]; then
            echo "Tunnel URL: \$TUNNEL_URL"
            curl -sS -X POST "\${{ inputs.callback_url }}" \\
              -H 'Content-Type: application/json' \\
              -d "\$(jq -n --arg url "\$TUNNEL_URL" --arg pid "\$DEV_PID" '{tunnelUrl: \$url, status: "running", devPid: \$pid}')"
          else
            echo "No tunnel URL found — sandbox has no public endpoint"
            curl -sS -X POST "\${{ inputs.callback_url }}" \\
              -H 'Content-Type: application/json' \\
              -d '{"status":"failed","error":"tunnel-not-established"}'
          fi

          # Keep alive — wait for dev server to exit (or Actions to cancel us)
          wait \$DEV_PID 2>/dev/null || true
`;

// The command arrives through `env:`, never interpolated into the `run:` script.
// Substituting it directly would let a stray quote break the YAML and a
// deliberate one run something other than the command we queued.
const WORKFLOW_YAML = `# Managed by Thalamus. Runs one queued build command and reports the result back.
name: Thalamus Command

on:
  workflow_dispatch:
    inputs:
      command:
        description: Command to run
        required: true
      command_id:
        description: Convex id of the queued command
        required: true
      nonce:
        description: One-time token proving this result came from our dispatch
        required: true
      callback_url:
        description: Where to POST the result
        required: true
      os:
        description: Runner to execute on
        required: false
        default: ubuntu-latest

jobs:
  run:
    runs-on: \${{ inputs.os || 'ubuntu-latest' }}
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      # bash on every runner, Windows included — the Windows images ship git-bash,
      # so one script covers ubuntu, windows and macos instead of three.
      - name: Run command
        id: run
        shell: bash
        env:
          THALAMUS_CMD: \${{ inputs.command }}
        run: |
          set +e
          OUTPUT=$(bash -lc "$THALAMUS_CMD" 2>&1)
          CODE=$?
          echo "$OUTPUT"
          printf '%s' "$OUTPUT" | head -c 20000 > "$RUNNER_TEMP/thalamus-output.txt"
          echo "exit_code=$CODE" >> "$GITHUB_OUTPUT"
      - name: Report result
        if: always()
        shell: bash
        env:
          CALLBACK: \${{ inputs.callback_url }}
          COMMAND_ID: \${{ inputs.command_id }}
          NONCE: \${{ inputs.nonce }}
          EXIT_CODE: \${{ steps.run.outputs.exit_code }}
        run: |
          OUTPUT=$(cat "$RUNNER_TEMP/thalamus-output.txt" 2>/dev/null || echo "")
          jq -n --arg id "$COMMAND_ID" --arg nonce "$NONCE" --arg out "$OUTPUT" \
                --argjson code "\${EXIT_CODE:-1}" \
                '{commandId:$id, nonce:$nonce, output:$out, exitCode:$code}' \
            | curl -sS -X POST "$CALLBACK" -H 'Content-Type: application/json' --data @-
`;

type GhConfig = { owner: string; repo: string; branch: string; githubToken?: string };

// GitHub's hosted runners. The whole point of running here rather than in one
// Linux container: a branch can be built and tested on the OS it ships to.
const RUNNERS: Record<string, string> = {
  ubuntu: "ubuntu-latest",
  windows: "windows-latest",
  macos: "macos-latest",
};

async function ensureWorkflow(octokit: Octokit, cfg: GhConfig): Promise<void> {
  let existingSha: string | undefined;
  try {
    const { data } = await octokit.repos.getContent({
      owner: cfg.owner, repo: cfg.repo, path: WORKFLOW_PATH, ref: cfg.branch,
    });
    if (!Array.isArray(data) && "sha" in data) {
      // Already current — rewriting it would churn a commit on every command.
      if ("content" in data && typeof data.content === "string") {
        const current = Buffer.from(data.content, "base64").toString("utf8");
        if (current === WORKFLOW_YAML) return;
      }
      existingSha = data.sha;
    }
  } catch { /* not there yet */ }

  await octokit.repos.createOrUpdateFileContents({
    owner: cfg.owner,
    repo: cfg.repo,
    path: WORKFLOW_PATH,
    message: "ci: thalamus command runner",
    content: Buffer.from(WORKFLOW_YAML, "utf8").toString("base64"),
    branch: cfg.branch,
    ...(existingSha ? { sha: existingSha } : {}),
  });
}

export const executeBranchCommandsViaActions = internalAction({
  args: { branchId: v.string() },
  handler: async (ctx, args): Promise<void> => {
    // Resume in `finally` only on the paths that fail outright — a successful
    // dispatch must NOT resume, because the callback does that when the run ends.
    let dispatched = false;
    let pending: Array<{ _id: string; command: string }> = [];

    try {
      pending = await ctx.runMutation(internal.codeCommands.claimPendingCommands, {
        branchId: args.branchId,
      }) as Array<{ _id: string; command: string }>;
      if (!pending || pending.length === 0) return;

      const branch = await ctx.runQuery(internal.codeBranches.getBranchInternal, { branchId: args.branchId });
      if (!branch) return;

      const cfg = await ctx.runQuery(internal.githubSyncHelpers.getGithubConfigInternal, {
        projectId: branch.projectId, branchId: args.branchId,
      }) as GhConfig | null;

      if (!cfg) {
        for (const cmd of pending) {
          await ctx.runMutation(internal.codeCommands.recordCommandResult, {
            commandId: cmd._id, status: "failed", exitCode: 1,
            output: "This branch has no GitHub repo, so there is nowhere to run commands. "
              + "Connect GitHub on the project, or run the build from the desktop app, which uses your own machine.",
          });
        }
        return;
      }

      const token = cfg.githubToken || process.env.GITHUB_TOKEN;
      if (!token) {
        for (const cmd of pending) {
          await ctx.runMutation(internal.codeCommands.recordCommandResult, {
            commandId: cmd._id, status: "failed", exitCode: 1,
            output: "No GitHub token available to dispatch the command runner.",
          });
        }
        return;
      }

      const octokit = new Octokit({ auth: token });

      // Push first: the workflow checks the repo out, so whatever the agent just
      // wrote has to be on the branch before the run starts.
      await ctx.runAction(internal.githubSync.autoPushToGithub, {
        branchId: args.branchId,
        commitMessage: "build: sync before running commands",
      });
      await ensureWorkflow(octokit, cfg);

      const callbackUrl = `${process.env.CONVEX_SITE_URL}/code/command-result`;

      for (const cmd of pending) {
        const nonce = crypto.randomUUID();
        await ctx.runMutation(internal.codeCommands.setCallbackNonce, {
          commandId: cmd._id, nonce,
        });
        await octokit.actions.createWorkflowDispatch({
          owner: cfg.owner,
          repo: cfg.repo,
          workflow_id: WORKFLOW_FILE,
          ref: cfg.branch,
          inputs: {
            command: cmd.command,
            command_id: cmd._id,
            nonce,
            callback_url: callbackUrl,
            os: RUNNERS[branch.runnerOs ?? "ubuntu"] ?? RUNNERS.ubuntu,
          },
        });
        dispatched = true;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      for (const cmd of pending) {
        await ctx.runMutation(internal.codeCommands.recordCommandResult, {
          commandId: cmd._id, status: "failed", exitCode: 1,
          output: `Could not dispatch the command runner: ${msg}`,
        }).catch(() => {});
      }
    } finally {
      // Anything that did not reach a dispatch left the branch paused with no
      // one coming to wake it, so resume it here. A dispatched run resumes
      // itself through the callback.
      if (!dispatched) {
        await ctx.scheduler.runAfter(0, internal.codePipeline.runPipelineAction, { branchId: args.branchId });
      }
    }
  },
});

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

  await octokit.repos.createOrUpdateFileContents({
    owner: cfg.owner,
    repo: cfg.repo,
    path: SANDBOX_WORKFLOW_PATH,
    message: "ci: thalamus sandbox preview",
    content: Buffer.from(SANDBOX_WORKFLOW_YAML, "utf8").toString("base64"),
    branch: cfg.branch,
    ...(existingSha ? { sha: existingSha } : {}),
  });
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

    const octokit = new Octokit({ auth: token });

    try {
      await ctx.runAction(internal.githubSync.autoPushToGithub, {
        branchId: args.branchId,
        commitMessage: "build: sync before sandbox",
      });
    } catch (pushErr) {
      const msg = pushErr instanceof Error ? pushErr.message : String(pushErr);
      // If the auto-push failed because the branch doesn't exist, we create it
      // below in the workflow-fallback. If it was a rate-limit, the blob retry
      // loop already waited — an error here means we're genuinely hosed.
      if (msg.includes("secondary rate") || msg.includes("403")) {
        throw new Error(
          "GitHub is rate-limiting pushes. Wait a few minutes, then try again. "
          + "The sandbox cannot start until the branch is synced."
        );
      }
      console.error("autoPushToGithub failed, continuing:", pushErr);
    }
    await ensureSandboxWorkflowWithBranch(octokit, cfg);

    const callbackUrl = `${process.env.CONVEX_SITE_URL}/code/sandbox-callback?branchId=${encodeURIComponent(args.branchId)}`;

    const branch = await ctx.runQuery(internal.codeBranches.getBranchInternal, { branchId: args.branchId });
    const runnerOs = (branch as Record<string,unknown>)?.runnerOs ?? "ubuntu";

    await octokit.actions.createWorkflowDispatch({
      owner: cfg.owner,
      repo: cfg.repo,
      workflow_id: SANDBOX_WORKFLOW_FILE,
      ref: cfg.branch,
      inputs: {
        callback_url: callbackUrl,
        os: RUNNERS[runnerOs as string] ?? RUNNERS.ubuntu,
        start_command: args.startCommand ?? "npm run dev",
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
      branchId: args.branchId, url: null, status: "starting", runId,
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
      branchId: args.branchId, url: null, status: "stopped", runId: null,
    });
  },
});
