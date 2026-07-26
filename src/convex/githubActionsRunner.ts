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
// seconds. What you get for it is a real, disposable Ubuntu VM with the whole
// toolchain, at no cost, with the run history visible in the repo.

import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { Octokit } from "@octokit/rest";

const WORKFLOW_PATH = ".github/workflows/thalamus-run.yml";
const WORKFLOW_FILE = "thalamus-run.yml";

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

jobs:
  run:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - name: Run command
        id: run
        env:
          THALAMUS_CMD: \${{ inputs.command }}
        run: |
          set +e
          OUTPUT=$(bash -lc "$THALAMUS_CMD" 2>&1)
          CODE=$?
          echo "$OUTPUT"
          echo "$OUTPUT" | head -c 20000 > /tmp/thalamus-output.txt
          echo "exit_code=$CODE" >> "$GITHUB_OUTPUT"
      - name: Report result
        if: always()
        env:
          CALLBACK: \${{ inputs.callback_url }}
          COMMAND_ID: \${{ inputs.command_id }}
          NONCE: \${{ inputs.nonce }}
          EXIT_CODE: \${{ steps.run.outputs.exit_code }}
        run: |
          OUTPUT=$(cat /tmp/thalamus-output.txt 2>/dev/null || echo "")
          jq -n --arg id "$COMMAND_ID" --arg nonce "$NONCE" --arg out "$OUTPUT" \\
                --argjson code "\${EXIT_CODE:-1}" \\
                '{commandId:$id, nonce:$nonce, output:$out, exitCode:$code}' \\
            | curl -sS -X POST "$CALLBACK" -H 'Content-Type: application/json' --data @-
`;

type GhConfig = { owner: string; repo: string; branch: string; githubToken?: string };

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
