import { mutation, query, internalMutation, internalQuery } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";

function generateBranchId(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let id = "";
  for (let i = 0; i < 10; i++) {
    id += chars[Math.floor(Math.random() * chars.length)];
  }
  return id;
}

// Create new branch
export const createBranch = mutation({
  args: {
    token: v.string(),
    projectId: v.string(),
    name: v.string(),
    description: v.optional(v.string()),
    // Imports create the repo themselves once the files are in place, so they
    // opt out here rather than race the scheduled creation.
    autoCreateRepo: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const sessions = await ctx.db
      .query("customSessions")
      .withIndex("by_token", (q) => q.eq("token", args.token))
      .take(1);
    const session = sessions[0];
    if (!session || session.expiresAt < Date.now()) throw new Error("Not authenticated");

    // Verify project ownership
    const project = await ctx.db
      .query("codeProjects")
      .withIndex("by_project_id", (q) => q.eq("projectId", args.projectId))
      .first();

    if (!project || project.userId !== session.userId) throw new Error("Project not found");

    let branchId = generateBranchId();
    let existing = await ctx.db
      .query("codeBranches")
      .withIndex("by_branch_id", (q) => q.eq("branchId", branchId))
      .first();

    while (existing) {
      branchId = generateBranchId();
      existing = await ctx.db
        .query("codeBranches")
        .withIndex("by_branch_id", (q) => q.eq("branchId", branchId))
        .first();
    }

    const now = Date.now();
    await ctx.db.insert("codeBranches", {
      projectId: args.projectId,
      branchId,
      name: args.name,
      description: args.description,
      createdAt: now,
      lastActivityAt: now,
      status: "idle",
      phase: "Dispatcher",
      executionPhase: "dispatching",
      currentTaskIndex: 0,
      totalMessages: 0,
      round: 0,
      vmOs: "windows11_pro",
    });

    // Update project activity
    await ctx.db.patch(project._id, { lastActivityAt: now });

    // Auto-create obscure GitHub repo in background (don't block branch creation)
    if (args.autoCreateRepo !== false) {
      await ctx.scheduler.runAfter(0, internal.githubAutoCreate.autoCreateRepoForBranch, {
        token: args.token,
        projectId: args.projectId,
        branchId,
        projectName: project.name,
      });
    }

    return { branchId };
  },
});

// List branches for a project
export const listBranches = query({
  args: { token: v.string(), projectId: v.string() },
  handler: async (ctx, args) => {
    const sessions = await ctx.db
      .query("customSessions")
      .withIndex("by_token", (q) => q.eq("token", args.token))
      .take(1);
    const session = sessions[0];
    if (!session || session.expiresAt < Date.now()) return [];

    const project = await ctx.db
      .query("codeProjects")
      .withIndex("by_project_id", (q) => q.eq("projectId", args.projectId))
      .first();

    if (!project || project.userId !== session.userId) return [];

    const branches = await ctx.db
      .query("codeBranches")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .collect();

    return branches.sort((a, b) => b.lastActivityAt - a.lastActivityAt);
  },
});

// Internal: list all branches (no auth — migration/admin use only)
export const listAllBranchesInternal = internalQuery({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("codeBranches").collect();
  },
});

// Internal: Get branch
export const getBranchInternal = internalQuery({
  args: { branchId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("codeBranches")
      .withIndex("by_branch_id", (q) => q.eq("branchId", args.branchId))
      .first();
  },
});

// Get single branch
export const getBranch = query({
  args: { token: v.string(), branchId: v.string() },
  handler: async (ctx, args) => {
    const sessions = await ctx.db
      .query("customSessions")
      .withIndex("by_token", (q) => q.eq("token", args.token))
      .take(1);
    const session = sessions[0];
    if (!session || session.expiresAt < Date.now()) return null;

    const branch = await ctx.db
      .query("codeBranches")
      .withIndex("by_branch_id", (q) => q.eq("branchId", args.branchId))
      .first();

    if (!branch) return null;

    // Verify ownership
    const project = await ctx.db
      .query("codeProjects")
      .withIndex("by_project_id", (q) => q.eq("projectId", branch.projectId))
      .first();

    if (!project || project.userId !== session.userId) return null;

    return branch;
  },
});

// Watch branch (reactive)
export const watchBranch = query({
  args: { branchId: v.string() },
  handler: async (ctx, args) => {
    const branch = await ctx.db
      .query("codeBranches")
      .withIndex("by_branch_id", (q) => q.eq("branchId", args.branchId))
      .first();
    return branch;
  },
});

// Internal: Get messages
export const getMessagesInternal = internalQuery({
  args: { branchId: v.string() },
  handler: async (ctx, args) => {
    const messages = await ctx.db
      .query("codeMessages")
      .withIndex("by_branch", (q) => q.eq("branchId", args.branchId))
      .order("desc")
      .take(100);
    return messages.reverse();
  },
});

// Internal: the branch's ENTIRE conversation in index order — the durable
// source for the .thalamus/conversation.jsonl that ships with every push.
// getMessagesInternal only returns the latest 100, which is all the pipeline
// needs for context; the transcript needs everything, so this paginates.
export const getConversationLogInternal = internalQuery({
  args: { branchId: v.string() },
  handler: async (ctx, args) => {
    const messages: Array<{
      agent: string;
      content: string;
      round?: number | null;
      messageIndex?: number | null;
      createdAt: number;
    }> = [];
    let cursor: string | null = null;
    do {
      const page = await ctx.db
        .query("codeMessages")
        .withIndex("by_branch_and_index", (q) => q.eq("branchId", args.branchId))
        .order("asc")
        .paginate({ numItems: 500, cursor: cursor ?? null });
      messages.push(...page.page);
      cursor = page.isDone ? null : page.continueCursor;
    } while (cursor);
    return messages;
  },
});

// Internal: Get files
export const getFilesInternal = internalQuery({
  args: { branchId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("codeFiles")
      .withIndex("by_branch", (q) => q.eq("branchId", args.branchId))
      .take(1000);
  },
});

// Watch messages (reactive)
export const watchMessages = query({
  args: { branchId: v.string() },
  handler: async (ctx, args) => {
    const messages = await ctx.db
      .query("codeMessages")
      .withIndex("by_branch", (q) => q.eq("branchId", args.branchId))
      .order("desc")
      .take(100);
    return messages.reverse();
  },
});

// Watch files (reactive)
export const watchFiles = query({
  args: { branchId: v.string() },
  handler: async (ctx, args) => {
    const files = await ctx.db
      .query("codeFiles")
      .withIndex("by_branch", (q) => q.eq("branchId", args.branchId))
      .take(1000);
    return files;
  },
});

// Update branch
export const updateBranch = mutation({
  args: {
    token: v.string(),
    branchId: v.string(),
    name: v.optional(v.string()),
    description: v.optional(v.string()),
    // Which hosted runner this branch's commands build on. The whole point of
    // running on GitHub's runners rather than one container: a branch can be
    // built and tested on the OS it actually ships to.
    runnerOs: v.optional(v.union(v.literal("ubuntu"), v.literal("windows"), v.literal("macos"))),
  },
  handler: async (ctx, args) => {
    const sessions = await ctx.db
      .query("customSessions")
      .withIndex("by_token", (q) => q.eq("token", args.token))
      .take(1);
    const session = sessions[0];
    if (!session || session.expiresAt < Date.now()) throw new Error("Not authenticated");

    const branch = await ctx.db
      .query("codeBranches")
      .withIndex("by_branch_id", (q) => q.eq("branchId", args.branchId))
      .first();

    if (!branch) throw new Error("Branch not found");

    const project = await ctx.db
      .query("codeProjects")
      .withIndex("by_project_id", (q) => q.eq("projectId", branch.projectId))
      .first();

    if (!project || project.userId !== session.userId) throw new Error("Not authorized");

    const updates: Record<string, unknown> = { lastActivityAt: Date.now() };
    if (args.name !== undefined) updates.name = args.name;
    if (args.description !== undefined) updates.description = args.description;
    if (args.runnerOs !== undefined) updates.runnerOs = args.runnerOs;

    await ctx.db.patch(branch._id, updates);
  },
});

// Delete branch — auth + ownership check here, the actual teardown (GitHub
// repo, chunked row deletion) runs in codeDeletion.deleteBranchDeep. The old
// version collected every child row into one mutation, which blew Convex's
// ~1MB atomic mutation limit on any real branch and failed wholesale — delete
// appeared to work in the UI and removed nothing.
export const deleteBranch = mutation({
  args: { token: v.string(), branchId: v.string() },
  handler: async (ctx, args) => {
    const sessions = await ctx.db
      .query("customSessions")
      .withIndex("by_token", (q) => q.eq("token", args.token))
      .take(1);
    const session = sessions[0];
    if (!session || session.expiresAt < Date.now()) throw new Error("Not authenticated");

    const branch = await ctx.db
      .query("codeBranches")
      .withIndex("by_branch_id", (q) => q.eq("branchId", args.branchId))
      .first();

    if (!branch) throw new Error("Branch not found");

    const project = await ctx.db
      .query("codeProjects")
      .withIndex("by_project_id", (q) => q.eq("projectId", branch.projectId))
      .first();

    if (!project || project.userId !== session.userId) throw new Error("Not authorized");

    await ctx.scheduler.runAfter(0, internal.codeDeletion.deleteBranchDeep, {
      branchId: args.branchId,
      projectId: branch.projectId,
      userId: session.userId,
    });
  },
});

// Used by codeDeletion.deleteBranchDeep to remove child rows in chunks so no
// single mutation can exceed Convex's limits on a large branch.
export const deleteBranchRowsChunk = internalMutation({
  args: {
    branchId: v.string(),
    table: v.union(
      v.literal("codeMessages"),
      v.literal("codeFiles"),
      v.literal("codeCommands"),
      v.literal("codeApiKeyRequests"),
    ),
  },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query(args.table)
      .withIndex("by_branch", (q) => q.eq("branchId", args.branchId))
      .take(20);
    for (const row of rows) await ctx.db.delete(row._id);
    return rows.length;
  },
});

export const deleteBranchRecord = internalMutation({
  args: { branchId: v.string() },
  handler: async (ctx, args) => {
    const branch = await ctx.db
      .query("codeBranches")
      .withIndex("by_branch_id", (q) => q.eq("branchId", args.branchId))
      .first();
    if (branch) await ctx.db.delete(branch._id);
  },
});

export const listBranchesInternal = internalQuery({
  args: { projectId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("codeBranches")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .collect();
  },
});

// Internal mutations for pipeline
export const updateBranchStatus = internalMutation({
  args: {
    branchId: v.string(),
    // Optional so callers can patch just a flag (e.g. clearing stopRequested)
    // without forcing a status transition.
    status: v.optional(v.union(v.literal("running"), v.literal("completed"), v.literal("idle"), v.literal("paused"))),
    currentAgent: v.optional(v.string()),
    phase: v.optional(v.string()),
    executionPhase: v.optional(v.string()),
    round: v.optional(v.number()),
    totalMessages: v.optional(v.number()),
    currentTaskIndex: v.optional(v.number()),
    currentTaskDifficulty: v.optional(v.string()),
    criticRetryCount: v.optional(v.number()),
    mcpRoundCount: v.optional(v.number()),
    stopRequested: v.optional(v.boolean()),
    executor: v.optional(v.union(v.literal("cloud"), v.literal("local"))),
    // How many times this run has been parked waiting for model capacity.
    // Set by runPipelineAction's transient-error path; reset to 0 whenever a
    // step completes, so the allowance is per-stall, not per-run.
    providerBackoffCount: v.optional(v.number()),
    // One-shot "this invocation is a rate-limit resume, don't re-dispatch"
    // marker — see the field's schema comment.
    skipDispatchOnResume: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const branch = await ctx.db
      .query("codeBranches")
      .withIndex("by_branch_id", (q) => q.eq("branchId", args.branchId))
      .first();

    if (!branch) return;

    const updates: Record<string, unknown> = {
      lastActivityAt: Date.now(),
    };
    if (args.status !== undefined) updates.status = args.status;
    if (args.currentAgent !== undefined) updates.currentAgent = args.currentAgent;
    if (args.phase !== undefined) updates.phase = args.phase;
    if (args.executionPhase !== undefined) updates.executionPhase = args.executionPhase;
    if (args.round !== undefined) updates.round = args.round;
    if (args.totalMessages !== undefined) updates.totalMessages = args.totalMessages;
    if (args.currentTaskIndex !== undefined) updates.currentTaskIndex = args.currentTaskIndex;
    if (args.currentTaskDifficulty !== undefined) updates.currentTaskDifficulty = args.currentTaskDifficulty;
    if (args.criticRetryCount !== undefined) updates.criticRetryCount = args.criticRetryCount;
    if (args.mcpRoundCount !== undefined) updates.mcpRoundCount = args.mcpRoundCount;
    if (args.stopRequested !== undefined) updates.stopRequested = args.stopRequested;
    if (args.executor !== undefined) updates.executor = args.executor;
    if (args.providerBackoffCount !== undefined) {
      updates.providerBackoffCount = args.providerBackoffCount;
    } else if (
      branch.providerBackoffCount &&
      args.totalMessages !== undefined &&
      args.totalMessages > (branch.totalMessages ?? 0)
    ) {
      // Clear the stall counter only on REAL progress — a new message landed,
      // so a model call succeeded. Resetting on any status write would be wrong:
      // the pipeline writes status at the start of a step, before the model call
      // that may stall again, which would pin the backoff at attempt 1 forever
      // and turn the bounded retry into an endless loop.
      updates.providerBackoffCount = 0;
    }
    if (args.skipDispatchOnResume !== undefined) updates.skipDispatchOnResume = args.skipDispatchOnResume;

    // A finished branch must not keep a cloud sandbox running (~$54/month
    // each). Tear it down and clear the reference — a later re-run simply
    // creates a fresh one lazily.

    await ctx.db.patch(branch._id, updates);
  },
});

export const saveMessage = internalMutation({
  args: {
    branchId: v.string(),
    agent: v.string(),
    content: v.string(),
    round: v.optional(v.number()),
    messageIndex: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("codeMessages", {
      branchId: args.branchId,
      agent: args.agent,
      content: args.content,
      round: args.round,
      messageIndex: args.messageIndex,
      createdAt: Date.now(),
    });
  },
});

export const upsertFile = internalMutation({
  args: {
    branchId: v.string(),
    filepath: v.string(),
    content: v.string(),
    agent: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("codeFiles")
      .withIndex("by_branch_and_path", (q) =>
        q.eq("branchId", args.branchId).eq("filepath", args.filepath)
      )
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        content: args.content,
        lastModifiedBy: args.agent,
        lastModifiedAt: Date.now(),
      });
    } else {
      await ctx.db.insert("codeFiles", {
        branchId: args.branchId,
        filepath: args.filepath,
        content: args.content,
        lastModifiedBy: args.agent,
        lastModifiedAt: Date.now(),
      });
    }
  },
});

export const updatePlannerTasks = internalMutation({
  args: {
    branchId: v.string(),
    plannerTasksJson: v.string(),
  },
  handler: async (ctx, args) => {
    const branch = await ctx.db
      .query("codeBranches")
      .withIndex("by_branch_id", (q) => q.eq("branchId", args.branchId))
      .first();

    if (branch) {
      await ctx.db.patch(branch._id, {
        plannerTasksJson: args.plannerTasksJson,
      });
    }
  },
});

// Delete file by branch + path (agent-facing)
export const deleteFileByPath = internalMutation({
  args: { branchId: v.string(), filepath: v.string() },
  handler: async (ctx, args) => {
    const file = await ctx.db
      .query("codeFiles")
      .withIndex("by_branch", (q) => q.eq("branchId", args.branchId))
      .filter((q) => q.eq(q.field("filepath"), args.filepath))
      .first();
    if (file) await ctx.db.delete(file._id);
  },
});

// Streaming content — written frequently during agent generation
// The pipeline calls this every ~500 chars of new output so the UI can show
// real-time token streaming while the agent is mid-response.
export const setStreamingContent = internalMutation({
  args: {
    branchId: v.string(),
    content: v.string(),
    agentName: v.string(),
  },
  handler: async (ctx, args) => {
    const branch = await ctx.db
      .query("codeBranches")
      .withIndex("by_branch_id", (q) => q.eq("branchId", args.branchId))
      .first();
    if (!branch) return;
    await ctx.db.patch(branch._id, {
      streamingContent: args.content,
      streamingAgent: args.agentName,
      streamingAt: Date.now(),
    });
  },
});

// Store the Dispatcher's chosen agent list for this branch
export const setDispatchedAgents = internalMutation({
  args: {
    branchId: v.string(),
    agentsJson: v.string(),
    // The Dispatcher's per-agent model tier map ({agent: tier}), if it assigned one.
  },
  handler: async (ctx, args) => {
    const branch = await ctx.db
      .query("codeBranches")
      .withIndex("by_branch_id", (q) => q.eq("branchId", args.branchId))
      .first();
    if (!branch) return;
    await ctx.db.patch(branch._id, {
      dispatchedAgentsJson: args.agentsJson,
    });
  },
});

export const setDispatchedModels = internalMutation({
  args: {
    branchId: v.string(),
    modelsJson: v.string(),
  },
  handler: async (ctx, args) => {
    const branch = await ctx.db
      .query("codeBranches")
      .withIndex("by_branch_id", (q) => q.eq("branchId", args.branchId))
      .first();
    if (!branch) return;
    await ctx.db.patch(branch._id, {
      dispatchedModelsJson: args.modelsJson,
    });
  },
});

export const setSandboxInfo = internalMutation({
  args: {
    branchId: v.string(),
    url: v.optional(v.union(v.string(), v.null())),
    status: v.optional(v.union(v.literal("idle"), v.literal("starting"), v.literal("running"), v.literal("stopped"))),
    runId: v.optional(v.union(v.number(), v.null())),
    callbackNonce: v.optional(v.union(v.string(), v.null())),
  },
  handler: async (ctx, args) => {
    const branch = await ctx.db
      .query("codeBranches")
      .withIndex("by_branch_id", (q) => q.eq("branchId", args.branchId))
      .first();
    if (!branch) return;
    const patch: Record<string, unknown> = {};
    if (args.url !== undefined) patch.sandboxUrl = args.url ?? undefined;
    if (args.status !== undefined) patch.sandboxStatus = args.status;
    if (args.runId !== undefined) patch.sandboxRunId = args.runId ?? undefined;
    if (args.callbackNonce !== undefined) patch.sandboxCallbackNonce = args.callbackNonce ?? undefined;
    await ctx.db.patch(branch._id, patch);
  },
});

// VM worker heartbeat + credential. The poll endpoint refreshes vmLastSeenAt
// on every request and the booter checks it before dispatching a second VM, so
// two workflow runs can never be alive for the same branch.
export const setVmInfo = internalMutation({
  args: {
    branchId: v.string(),
    nonce: v.optional(v.union(v.string(), v.null())),
    lastSeenAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const branch = await ctx.db
      .query("codeBranches")
      .withIndex("by_branch_id", (q) => q.eq("branchId", args.branchId))
      .first();
    if (!branch) return;
    const patch: Record<string, unknown> = {};
    if (args.nonce !== undefined) patch.vmNonce = args.nonce ?? undefined;
    if (args.lastSeenAt !== undefined) patch.vmLastSeenAt = args.lastSeenAt;
    await ctx.db.patch(branch._id, patch);
  },
});

// Records that the cloud executor cannot run commands on this branch at all
// (e.g. connected GitHub token missing the `workflow` scope, no repo, no
// token). Written by githubActionsRunner from the natural failure and success
// points — the pipeline reads it to strip the {"op":"cmd"} advertisement from
// the agent prompt so agents don't waste rounds emitting commands that can
// never run. Pass null (or empty string) to clear.
export const setExecutorBlocked = internalMutation({
  args: { branchId: v.string(), reason: v.union(v.string(), v.null()) },
  handler: async (ctx, args) => {
    const branch = await ctx.db
      .query("codeBranches")
      .withIndex("by_branch_id", (q) => q.eq("branchId", args.branchId))
      .first();
    if (!branch) return;
    const next = args.reason && args.reason.length > 0 ? args.reason : undefined;
    // Avoid a needless patch (and Convex write) when nothing actually changes —
    // this is called on every successful VM boot heartbeat's neighbourhood.
    if (branch.executorBlockedReason === next) return;
    await ctx.db.patch(branch._id, { executorBlockedReason: next });
  },
});

// Records why a branch has no platform repo yet — cleared as soon as one is
// successfully created. Read by SandboxView so a token/permission failure
// shows up as a message with a retry button instead of an endless spinner.
export const setRepoSetupError = internalMutation({
  args: { branchId: v.string(), error: v.union(v.string(), v.null()) },
  handler: async (ctx, args) => {
    const branch = await ctx.db
      .query("codeBranches")
      .withIndex("by_branch_id", (q) => q.eq("branchId", args.branchId))
      .first();
    if (!branch) return;
    await ctx.db.patch(branch._id, { repoSetupError: args.error ?? undefined });
  },
});

// The GitHub Actions sandbox run POSTs here with no other credential to
// prove it's genuine — the nonce (single-use, generated per dispatch,
// cleared on spend) is the whole security story. Mirrors
// codeCommands.completeFromRunner.
export const completeSandboxCallback = internalMutation({
  args: {
    branchId: v.string(),
    nonce: v.string(),
    url: v.optional(v.union(v.string(), v.null())),
    status: v.union(v.literal("running"), v.literal("stopped")),
  },
  handler: async (ctx, args): Promise<boolean> => {
    const branch = await ctx.db
      .query("codeBranches")
      .withIndex("by_branch_id", (q) => q.eq("branchId", args.branchId))
      .first();
    if (!branch || !branch.sandboxCallbackNonce || branch.sandboxCallbackNonce !== args.nonce) return false;

    await ctx.db.patch(branch._id, {
      sandboxUrl: args.url ?? undefined,
      sandboxStatus: args.status,
      sandboxCallbackNonce: undefined,
    });
    return true;
  },
});

// Clear streaming content (called after message is saved to DB)
export const clearStreamingContent = internalMutation({
  args: { branchId: v.string() },
  handler: async (ctx, args) => {
    const branch = await ctx.db
      .query("codeBranches")
      .withIndex("by_branch_id", (q) => q.eq("branchId", args.branchId))
      .first();
    if (!branch) return;
    await ctx.db.patch(branch._id, {
      streamingContent: undefined,
      streamingAgent: undefined,
      streamingAt: undefined,
    });
  },
});

// ── Watchdog: recover branches whose pipeline was hard-killed mid-step ───────
//
// Convex hard-kills an internalAction at its 600s maximum duration. The kill
// throws inside the action process itself and no try/catch in runPipelineAction
// can observe it — so a branch mid-agent, mid-tool-call or mid-model-call is
// left at status "running" (currentAgent still set) with no scheduled
// continuation. The UI shows an eternal "thinking" spinner and nothing is
// actually running. This cron sweeps for those and reschedules the pipeline.
//
// STALE_MS derivation: Convex's action limit is 600s (10 min). Add slack for
// scheduling latency and the shared 7-minute model-call deadline used inside
// callModel, plus a little for two-provider fallbacks, and we land at 12 min —
// comfortably past any healthy long step, early enough that a user isn't
// staring at a dead spinner for an hour.
const STALE_MS = 12 * 60 * 1000;

// Two automatic restarts without progress means restarting isn't helping —
// most likely a deterministic crash on the same step. Stop looping (and stop
// burning provider quota) and put the branch back to idle so the user can
// try a different approach.
const MAX_REVIVES = 2;

export const sweepStalledBranches = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    // No status/activity index exists on codeBranches; this cron runs at
    // 5-minute maintenance frequency and only "running" branches matter,
    // so a full scan with an in-memory filter is acceptable at the current
    // table size. If codeBranches grows enough that this hurts, add a
    // compound index on (status, lastActivityAt).
    const all = await ctx.db.query("codeBranches").collect();
    const stale = all.filter(
      (b) => b.status === "running" && now - b.lastActivityAt > STALE_MS,
    );

    let revived = 0;
    let terminated = 0;
    let skipped = 0;

    for (const branch of stale) {
      // Legitimately parked? A queued or in-flight command means the VM
      // executor (or the desktop app) is still working — completeFromRunner
      // / completeCommand reschedule the pipeline once nothing is
      // outstanding. An open API-key request means the pipeline is waiting
      // on the user, and fulfillApiKeyRequest reschedules when the key
      // arrives. In either case DO NOT touch the branch — the existing
      // resume paths handle it correctly.
      const pendingCommand = await ctx.db
        .query("codeCommands")
        .withIndex("by_branch_and_status", (q) =>
          q.eq("branchId", branch.branchId).eq("status", "pending"),
        )
        .first();
      const runningCommand = await ctx.db
        .query("codeCommands")
        .withIndex("by_branch_and_status", (q) =>
          q.eq("branchId", branch.branchId).eq("status", "running"),
        )
        .first();
      const openKeyRequest = await ctx.db
        .query("codeApiKeyRequests")
        .withIndex("by_branch_and_status", (q) =>
          q.eq("branchId", branch.branchId).eq("status", "pending"),
        )
        .first();
      if (pendingCommand || runningCommand || openKeyRequest) {
        skipped++;
        continue;
      }

      // Progress signal: totalMessages only advances when a full agent
      // step lands and is persisted via updateBranchStatus. If it has
      // moved past the baseline captured on the previous revive, the
      // previous revive actually did work — treat this as a fresh
      // incident and reset the counter. Otherwise the revive changed
      // nothing and it counts against the cap.
      const currentMessages = branch.totalMessages ?? 0;
      const baseline = branch.reviveBaselineMessages;
      const effectiveRevives =
        baseline !== undefined && currentMessages > baseline
          ? 0
          : branch.reviveCount ?? 0;

      if (effectiveRevives >= MAX_REVIVES) {
        // Cap hit. The status union is running | completed | idle |
        // paused — no "failed" literal — so we settle on "idle": the
        // pipeline is not doing anything, the UI already handles that
        // state, and the user can restart with a new message. Reset
        // the watchdog fields so the next attempt gets a fresh budget.
        await ctx.db.insert("codeMessages", {
          branchId: branch.branchId,
          agent: "System",
          content:
            `⚠️ Pipeline was restarted ${MAX_REVIVES} times after Convex's 600s action limit killed each run, but the branch made no progress between restarts. Giving up automatic recovery — send another message to try again, and consider a smaller change or a different model if this keeps happening.`,
          createdAt: now,
        });
        await ctx.db.patch(branch._id, {
          status: "idle",
          currentAgent: undefined,
          streamingContent: undefined,
          streamingAgent: undefined,
          streamingAt: undefined,
          lastActivityAt: now,
          reviveCount: 0,
          reviveBaselineMessages: undefined,
        });
        terminated++;
        continue;
      }

      // Revive: transcript entry so the user can see what happened,
      // bump lastActivityAt (otherwise the next sweep tick could re-
      // fire before runPipelineAction has bumped it itself), record
      // the new revive count and progress baseline, then reschedule
      // the pipeline. runPipelineAction resumes from persisted branch
      // state (round / phase / currentTaskIndex / executionPhase).
      await ctx.db.insert("codeMessages", {
        branchId: branch.branchId,
        agent: "System",
        content:
          "⚠️ Pipeline stopped unexpectedly (likely Convex's 600s action limit). Resuming from the last saved step.",
        createdAt: now,
      });
      await ctx.db.patch(branch._id, {
        lastActivityAt: now,
        reviveCount: effectiveRevives + 1,
        reviveBaselineMessages: currentMessages,
      });
      await ctx.scheduler.runAfter(0, internal.codePipeline.runPipelineAction, {
        branchId: branch.branchId,
      });
      revived++;
    }

    return { revived, terminated, skipped, scanned: stale.length };
  },
});

// ── Watchdog: recover branches parked "paused" on a command that will never
// answer ──────────────────────────────────────────────────────────────────
//
// A different stall class than the sweep above. "paused" is the pipeline's
// correct, deliberate state while a queued command's result is genuinely in
// flight — runPipelineAction already knows how to notice when that wait has
// gone stale (STALE_COMMAND_MS, 15 min: the VM worker never booted, the
// runner crashed, GitHub silently dropped the dispatched run) and self-heal
// by failing the command and continuing. The problem is WHEN that check runs:
// only when something re-invokes runPipelineAction, and for a "paused" branch
// nothing does except a fresh user message or the command's own callback —
// which, in the stuck case, never arrives. A user retrying before the
// 15-minute mark got pure silence on every attempt, because
// runPipelineAction's own gate just re-parks quietly and returns.
//
// The fix is not to duplicate the staleness math here — it's to make sure
// runPipelineAction gets invoked periodically for every paused branch so ITS
// existing check actually runs. Re-invoking is safe for every legitimate
// "paused" case too: a live in-flight command, or an open API-key request
// both just cause a harmless re-park (the pipeline already relies on this —
// see the "spurious extra invocation" comment above the pending-commands
// check in runPipelineAction).
export const sweepPausedBranches = internalMutation({
  args: {},
  handler: async (ctx) => {
    // No status index on codeBranches (same tradeoff as sweepStalledBranches
    // above); acceptable at this table size for a 5-minute maintenance sweep.
    const all = await ctx.db.query("codeBranches").collect();
    const paused = all.filter((b) => b.status === "paused");
    for (const branch of paused) {
      await ctx.scheduler.runAfter(0, internal.codePipeline.runPipelineAction, {
        branchId: branch.branchId,
      });
    }
    return { checked: paused.length };
  },
});
