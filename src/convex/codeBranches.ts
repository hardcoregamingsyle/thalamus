import { mutation, query, internalMutation, internalQuery } from "./_generated/server";
import { v } from "convex/values";
import { Id } from "./_generated/dataModel";

function generateBranchId(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let id = "";
  for (let i = 0; i < 10; i++) {
    id += chars[Math.floor(Math.random() * chars.length)];
  }
  return id;
}

// ── Create new branch ─────────────────────────────────────────────────────────
export const createBranch = mutation({
  args: {
    token: v.string(),
    projectId: v.string(),
    name: v.string(),
    description: v.optional(v.string()),
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
      phase: "Researcher",
      executionPhase: "planning",
      currentTaskIndex: 0,
      totalMessages: 0,
      round: 0,
      vmOs: "windows11_pro",
    });

    // Update project activity
    await ctx.db.patch(project._id, { lastActivityAt: now });

    return { branchId };
  },
});

// ── List branches for a project ───────────────────────────────────────────────
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

// ── Internal: Get branch ──────────────────────────────────────────────────────
export const getBranchInternal = internalQuery({
  args: { branchId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("codeBranches")
      .withIndex("by_branch_id", (q) => q.eq("branchId", args.branchId))
      .first();
  },
});

// ── Get single branch ─────────────────────────────────────────────────────────
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

// ── Watch branch (reactive) ───────────────────────────────────────────────────
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

// ── Internal: Get messages ────────────────────────────────────────────────────
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

// ── Internal: Get files ───────────────────────────────────────────────────────
export const getFilesInternal = internalQuery({
  args: { branchId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("codeFiles")
      .withIndex("by_branch", (q) => q.eq("branchId", args.branchId))
      .take(1000);
  },
});

// ── Watch messages (reactive) ─────────────────────────────────────────────────
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

// ── Watch files (reactive) ────────────────────────────────────────────────────
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

// ── Update branch ─────────────────────────────────────────────────────────────
export const updateBranch = mutation({
  args: {
    token: v.string(),
    branchId: v.string(),
    name: v.optional(v.string()),
    description: v.optional(v.string()),
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

    await ctx.db.patch(branch._id, updates);
  },
});

// ── Delete branch ─────────────────────────────────────────────────────────────
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

    // Delete all branch data
    const messages = await ctx.db
      .query("codeMessages")
      .withIndex("by_branch", (q) => q.eq("branchId", args.branchId))
      .collect();
    for (const msg of messages) await ctx.db.delete(msg._id);

    const files = await ctx.db
      .query("codeFiles")
      .withIndex("by_branch", (q) => q.eq("branchId", args.branchId))
      .collect();
    for (const file of files) await ctx.db.delete(file._id);

    const commands = await ctx.db
      .query("codeCommands")
      .withIndex("by_branch", (q) => q.eq("branchId", args.branchId))
      .collect();
    for (const cmd of commands) await ctx.db.delete(cmd._id);

    await ctx.db.delete(branch._id);
  },
});

// ── Internal mutations for pipeline ───────────────────────────────────────────
export const updateBranchStatus = internalMutation({
  args: {
    branchId: v.string(),
    status: v.union(v.literal("running"), v.literal("completed"), v.literal("idle"), v.literal("paused")),
    currentAgent: v.optional(v.string()),
    phase: v.optional(v.string()),
    executionPhase: v.optional(v.string()),
    round: v.optional(v.number()),
    totalMessages: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const branch = await ctx.db
      .query("codeBranches")
      .withIndex("by_branch_id", (q) => q.eq("branchId", args.branchId))
      .first();

    if (!branch) return;

    const updates: Record<string, unknown> = {
      status: args.status,
      lastActivityAt: Date.now(),
    };
    if (args.currentAgent !== undefined) updates.currentAgent = args.currentAgent;
    if (args.phase !== undefined) updates.phase = args.phase;
    if (args.executionPhase !== undefined) updates.executionPhase = args.executionPhase;
    if (args.round !== undefined) updates.round = args.round;
    if (args.totalMessages !== undefined) updates.totalMessages = args.totalMessages;

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
