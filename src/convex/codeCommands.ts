import { mutation, query, internalMutation, internalQuery } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { requireSession, assertBranchOwner } from "./lib/codeAuth";

// Transcript ceiling for a single command result. A green build log can be
// megabytes; Convex documents cannot. 4000 chars is enough to see what
// happened without pasting a giant log into every branch's watchMessages
// payload (the client re-fetches all 100 messages on every change).
const COMMAND_TRANSCRIPT_MAX = 4000;

// The command executor is either the branch owner (desktop) or an
// unauthenticated public-repo Actions job (cloud, gated by a single-use
// nonce). Either way the output is untrusted text; neutralize the legacy
// `<<TAG>>` op sentinels the same way codePipeline.ts does before injecting
// command output into an agent prompt (~line 608), so nothing in a shell
// log can inject a pipeline op marker into the transcript.
function formatCommandTranscript(command: string, output: string, exitCode: number): string {
  const raw = output ?? "";
  const total = raw.length;
  const clipped = total > COMMAND_TRANSCRIPT_MAX
    ? raw.slice(0, COMMAND_TRANSCRIPT_MAX) + `\n…[truncated, ${total} chars total]`
    : raw;
  const neutralized = clipped.split("<<").join("‹‹").split(">>").join("››");
  return `## $ ${command}\n[exit ${exitCode}]\n\`\`\`\n${neutralized}\n\`\`\``;
}

// Write a visible transcript entry for one finished command and bump the
// branch's activity clock. Callers MUST have already verified that the
// command actually transitioned to a terminal state on this invocation
// (nonce spend on the runner path, prior-status check on the others) —
// this helper does not itself guard against double-posting.
//
// The transcript entry parallels codePipeline.ts's `agent: "MCP"` write
// so the UI already has a code path for non-agent tool output; a distinct
// `"Terminal"` label keeps the styling separable and can never collide
// with a real agent name.
//
// getRecentCommandResults still runs against codeCommands (unchanged), so
// the agent's next prompt continues to see the command output the same
// way it does today. This is purely an additional surface, not a move.
async function writeCommandTranscript(
  ctx: MutationCtx,
  branchId: string,
  command: string,
  output: string,
  exitCode: number,
): Promise<void> {
  await ctx.db.insert("codeMessages", {
    branchId,
    agent: "Terminal",
    content: formatCommandTranscript(command, output, exitCode),
    createdAt: Date.now(),
  });
  // Match every other message-write path — the stalled-run watchdog cron
  // in codeBranches.ts:reviveStalledBranches keys off lastActivityAt, so a
  // long-running command that finally finishes must count as activity.
  const branch = await ctx.db
    .query("codeBranches")
    .withIndex("by_branch_id", (q) => q.eq("branchId", branchId))
    .first();
  if (branch) {
    await ctx.db.patch(branch._id, { lastActivityAt: Date.now() });
  }
}

// Queue a command for execution
export const queueCommand = internalMutation({
  args: {
    branchId: v.string(),
    agent: v.string(),
    command: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("codeCommands", {
      branchId: args.branchId,
      agent: args.agent,
      command: args.command,
      status: "pending",
      createdAt: Date.now(),
    });
  },
});

// Get pending commands
// "Unfinished" commands — pending OR currently running. The pipeline's resume
// guard uses this; counting only "pending" would let a stray resume slip past
// while the executor is mid-command.
export const getPendingCommands = internalQuery({
  args: { branchId: v.string() },
  handler: async (ctx, args) => {
    const pending = await ctx.db
      .query("codeCommands")
      .withIndex("by_branch_and_status", (q) =>
        q.eq("branchId", args.branchId).eq("status", "pending")
      )
      .collect();
    const running = await ctx.db
      .query("codeCommands")
      .withIndex("by_branch_and_status", (q) =>
        q.eq("branchId", args.branchId).eq("status", "running")
      )
      .collect();
    return [...pending, ...running];
  },
});

// ── Web command execution plumbing (see sandbox.executeBranchCommands) ────────

// The most recent finished commands + their output, injected into the agent's
// next prompt so it can actually react to what its shell commands produced.
// `sinceMs` scopes results to the current resume (commands finished after the
// agent's last saved message) — without it, later agents in later rounds would
// see stale outputs (e.g. old test results) and act on them.
export const getRecentCommandResults = internalQuery({
  args: { branchId: v.string(), sinceMs: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("codeCommands")
      .withIndex("by_branch", (q) => q.eq("branchId", args.branchId))
      .order("desc")
      .take(8);
    return rows
      .filter((c) => (c.status === "completed" || c.status === "failed")
        && (args.sinceMs === undefined || (c.completedAt ?? 0) >= args.sinceMs))
      .reverse()
      .map((c) => ({ command: c.command, output: c.output ?? "", exitCode: c.exitCode ?? 0, status: c.status }));
  },
});

// Record a command's result without the client token — the executor is trusted.
// Guarded on the prior status so a race between callers (e.g. the pipeline's
// stale-timeout sweep firing while a slow runner callback is still in flight)
// cannot double-post the transcript message. Only the first caller to see the
// command in a non-terminal state actually writes the message.
export const recordCommandResult = internalMutation({
  args: {
    commandId: v.id("codeCommands"),
    status: v.union(v.literal("completed"), v.literal("failed")),
    output: v.string(),
    exitCode: v.number(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db.get(args.commandId);
    if (!existing) return;
    if (existing.status === "completed" || existing.status === "failed") return;

    await ctx.db.patch(args.commandId, {
      status: args.status,
      output: args.output,
      exitCode: args.exitCode,
      completedAt: Date.now(),
    });
    await writeCommandTranscript(ctx, existing.branchId, existing.command, args.output, args.exitCode);
  },
});

// Atomic claim for the VM worker: flips every pending command to "running",
// stamps a fresh one-time nonce on each, and returns the {id, nonce, command}
// bundle the poll endpoint hands straight to the Actions job. Single mutation
// keeps the claim and the nonce issue from racing a straggler.
export const claimPendingCommandsForVm = internalMutation({
  args: { branchId: v.string() },
  handler: async (ctx, args) => {
    const pending = await ctx.db
      .query("codeCommands")
      .withIndex("by_branch_and_status", (q) =>
        q.eq("branchId", args.branchId).eq("status", "pending")
      )
      .collect();
    const claimed: Array<{ id: string; nonce: string; command: string }> = [];
    for (const cmd of pending) {
      // Web Crypto — the same pattern customAuthHelpers uses. crypto.randomUUID()
      // from `node:crypto` is unavailable here: this file has no "use node"
      // directive and runs in the JavaScript runtime.
      const nonce = Array.from(globalThis.crypto.getRandomValues(new Uint8Array(16)))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
      await ctx.db.patch(cmd._id, { status: "running", callbackNonce: nonce });
      claimed.push({ id: cmd._id, nonce, command: cmd.command });
    }
    return claimed;
  },
});

// The GitHub Actions callback lands here. The run is on a public repo and the
// endpoint is unauthenticated by necessity, so the nonce is the whole security
// story: it is single-use, generated per dispatch, and cleared on spend — a
// replay or a guess finds nothing to match.
export const completeFromRunner = internalMutation({
  args: {
    commandId: v.id("codeCommands"),
    nonce: v.string(),
    output: v.string(),
    exitCode: v.number(),
  },
  handler: async (ctx, args): Promise<boolean> => {
    const command = await ctx.db.get(args.commandId);
    if (!command || !command.callbackNonce || command.callbackNonce !== args.nonce) return false;

    // Nonce is single-use and cleared below on this same patch, so a replay
    // (or a duplicate callback) will fail the check above and return false —
    // the transcript write beneath is guaranteed to fire at most once per
    // command from this path.
    const truncatedOutput = args.output.slice(0, 20000);
    await ctx.db.patch(args.commandId, {
      status: args.exitCode === 0 ? "completed" : "failed",
      output: truncatedOutput,
      exitCode: args.exitCode,
      completedAt: Date.now(),
      callbackNonce: undefined,
    });

    // Surface the command output live in the chat transcript — otherwise the
    // user only ever sees `[CMD: ...]` in the message stream and never the
    // actual output the agents are reacting to. writeCommandTranscript also
    // bumps lastActivityAt (the VM worker's keepAlive clock runs off that
    // clock — a long command finishing must count as activity or the worker
    // could time itself out mid-run).
    await writeCommandTranscript(ctx, command.branchId, command.command, truncatedOutput, args.exitCode);

    const stillPending = await ctx.db
      .query("codeCommands")
      .withIndex("by_branch_and_status", (q) =>
        q.eq("branchId", command.branchId).eq("status", "pending")
      )
      .first();
    const stillRunning = await ctx.db
      .query("codeCommands")
      .withIndex("by_branch_and_status", (q) =>
        q.eq("branchId", command.branchId).eq("status", "running")
      )
      .first();

    if (!stillPending && !stillRunning) {
      await ctx.scheduler.runAfter(0, internal.codePipeline.runPipelineAction, {
        branchId: command.branchId,
      });
    }
    return true;
  },
});

// Watch commands (reactive)
export const watchCommands = query({
  args: { branchId: v.string() },
  handler: async (ctx, args) => {
    const commands = await ctx.db
      .query("codeCommands")
      .withIndex("by_branch", (q) => q.eq("branchId", args.branchId))
      .order("desc")
      .take(50);
    return commands.reverse();
  },
});

// Mark command as completed
export const completeCommand = mutation({
  args: {
    token: v.string(),
    commandId: v.id("codeCommands"),
    output: v.string(),
    exitCode: v.number(),
  },
  handler: async (ctx, args) => {
    const session = await requireSession(ctx, args.token);

    const command = await ctx.db.get(args.commandId);
    if (!command) throw new Error("Command not found");
    // The command carries attacker-controlled output that gets fed into the
    // branch's next agent prompt and resumes its pipeline — only the branch
    // owner may complete it.
    await assertBranchOwner(ctx, session.userId, command.branchId);

    // Idempotent: if the desktop polling loop double-completes a command
    // (e.g. after a client reconnect), the second call is a no-op and does
    // not produce a duplicate transcript entry.
    if (command.status === "completed" || command.status === "failed") return;

    await ctx.db.patch(args.commandId, {
      status: "completed",
      output: args.output,
      exitCode: args.exitCode,
      completedAt: Date.now(),
    });
    await writeCommandTranscript(ctx, command.branchId, command.command, args.output, args.exitCode);

    // Check if all pending commands are done, if so resume pipeline
    const pending = await ctx.db
      .query("codeCommands")
      .withIndex("by_branch_and_status", (q) =>
        q.eq("branchId", command.branchId).eq("status", "pending")
      )
      .first();

    if (!pending) {
      // All queued commands for this branch have finished — resume the build pipeline.
      await ctx.scheduler.runAfter(0, internal.codePipeline.runPipelineAction, {
        branchId: command.branchId,
      });
    }
  },
});

// What the desktop app polls: the commands this branch is waiting on, for a
// branch the caller owns. The internal getPendingCommands above is the
// pipeline's own resume guard and is not reachable from a client, so the local
// executor needs its own door — owner-checked, because the reply tells the
// caller what shell commands to run and on which machine.
export const listPendingForBranch = query({
  args: { token: v.string(), branchId: v.string() },
  handler: async (ctx, args) => {
    const session = await requireSession(ctx, args.token);
    await assertBranchOwner(ctx, session.userId, args.branchId);

    const branch = await ctx.db
      .query("codeBranches")
      .withIndex("by_branch_id", (q) => q.eq("branchId", args.branchId))
      .first();
    // Only local branches are the desktop's to run. A cloud branch's queue
    // belongs to Daytona, and handing it out here would run everything twice.
    if (!branch || branch.executor !== "local") return [];

    const pending = await ctx.db
      .query("codeCommands")
      .withIndex("by_branch_and_status", (q) =>
        q.eq("branchId", args.branchId).eq("status", "pending")
      )
      .take(20);
    return pending.map((c) => ({ id: c._id, command: c.command, agent: c.agent }));
  },
});

// Run a one-off command on the branch's runner, outside the pipeline.
//
// Cloud branches dispatch to GitHub Actions; local branches are left alone
// because the desktop app is already polling listPendingForBranch and would
// otherwise run the same command twice.
export const runManualCommand = mutation({
  args: { token: v.string(), branchId: v.string(), command: v.string() },
  handler: async (ctx, args) => {
    const session = await requireSession(ctx, args.token);
    await assertBranchOwner(ctx, session.userId, args.branchId);

    const command = args.command.trim();
    if (!command) throw new Error("Command is empty");

    const branch = await ctx.db
      .query("codeBranches")
      .withIndex("by_branch_id", (q) => q.eq("branchId", args.branchId))
      .first();
    if (!branch) throw new Error("Branch not found");

    await ctx.db.insert("codeCommands", {
      branchId: args.branchId,
      agent: "You",
      command,
      status: "pending",
      createdAt: Date.now(),
    });

    if (branch.executor !== "local") {
      await ctx.scheduler.runAfter(0, internal.githubActionsRunner.executeBranchCommandsViaActions, {
        branchId: args.branchId,
      });
    }
  },
});

// Mark command as failed
export const failCommand = mutation({
  args: {
    token: v.string(),
    commandId: v.id("codeCommands"),
    output: v.string(),
  },
  handler: async (ctx, args) => {
    const session = await requireSession(ctx, args.token);

    const command = await ctx.db.get(args.commandId);
    if (!command) throw new Error("Command not found");
    await assertBranchOwner(ctx, session.userId, command.branchId);

    // Idempotent — see the matching guard in completeCommand above.
    if (command.status === "completed" || command.status === "failed") return;

    await ctx.db.patch(args.commandId, {
      status: "failed",
      output: args.output,
      exitCode: 1,
      completedAt: Date.now(),
    });
    await writeCommandTranscript(ctx, command.branchId, command.command, args.output, 1);
  },
});
