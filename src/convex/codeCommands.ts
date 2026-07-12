import { mutation, query, internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";

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

// Atomically claim pending commands (pending → running) so a duplicate
// executor invocation can never run — and pay for — the same command twice.
export const claimPendingCommands = internalMutation({
  args: { branchId: v.string() },
  handler: async (ctx, args) => {
    const pending = await ctx.db
      .query("codeCommands")
      .withIndex("by_branch_and_status", (q) =>
        q.eq("branchId", args.branchId).eq("status", "pending")
      )
      .collect();
    for (const cmd of pending) {
      await ctx.db.patch(cmd._id, { status: "running" });
    }
    return pending.map((c) => ({ _id: c._id, command: c.command }));
  },
});

export const countCommands = internalQuery({
  args: { branchId: v.string() },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("codeCommands")
      .withIndex("by_branch", (q) => q.eq("branchId", args.branchId))
      .collect();
    return rows.length;
  },
});

export const getBranchSandboxId = internalQuery({
  args: { branchId: v.string() },
  handler: async (ctx, args) => {
    const b = await ctx.db
      .query("codeBranches")
      .withIndex("by_branch_id", (q) => q.eq("branchId", args.branchId))
      .first();
    return b?.sandboxId ?? null;
  },
});

export const setBranchSandboxId = internalMutation({
  args: { branchId: v.string(), sandboxId: v.string() },
  handler: async (ctx, args) => {
    const b = await ctx.db
      .query("codeBranches")
      .withIndex("by_branch_id", (q) => q.eq("branchId", args.branchId))
      .first();
    if (b) await ctx.db.patch(b._id, { sandboxId: args.sandboxId });
  },
});

// Record a command's result without the client token — the executor is trusted.
export const recordCommandResult = internalMutation({
  args: {
    commandId: v.id("codeCommands"),
    status: v.union(v.literal("completed"), v.literal("failed")),
    output: v.string(),
    exitCode: v.number(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.commandId, {
      status: args.status,
      output: args.output,
      exitCode: args.exitCode,
      completedAt: Date.now(),
    });
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
    // Verify auth (implement proper auth check)
    const sessions = await ctx.db
      .query("customSessions")
      .withIndex("by_token", (q) => q.eq("token", args.token))
      .take(1);
    const session = sessions[0];
    if (!session || session.expiresAt < Date.now()) throw new Error("Not authenticated");

    const command = await ctx.db.get(args.commandId);
    if (!command) throw new Error("Command not found");

    await ctx.db.patch(args.commandId, {
      status: "completed",
      output: args.output,
      exitCode: args.exitCode,
      completedAt: Date.now(),
    });

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

// Mark command as failed
export const failCommand = mutation({
  args: {
    token: v.string(),
    commandId: v.id("codeCommands"),
    output: v.string(),
  },
  handler: async (ctx, args) => {
    const sessions = await ctx.db
      .query("customSessions")
      .withIndex("by_token", (q) => q.eq("token", args.token))
      .take(1);
    const session = sessions[0];
    if (!session || session.expiresAt < Date.now()) throw new Error("Not authenticated");

    await ctx.db.patch(args.commandId, {
      status: "failed",
      output: args.output,
      exitCode: 1,
      completedAt: Date.now(),
    });
  },
});
