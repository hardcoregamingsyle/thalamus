import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { Id } from "./_generated/dataModel";

// Generate 10 character ID (uppercase letters and numbers only)
function generateProjectId(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let id = "";
  for (let i = 0; i < 10; i++) {
    id += chars[Math.floor(Math.random() * chars.length)];
  }
  return id;
}

// ── Create new project ────────────────────────────────────────────────────────
export const createProject = mutation({
  args: {
    token: v.string(),
    name: v.string(),
    description: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // Authenticate
    const sessions = await ctx.db
      .query("customSessions")
      .withIndex("by_token", (q) => q.eq("token", args.token))
      .take(1);
    const session = sessions[0];
    if (!session || session.expiresAt < Date.now()) throw new Error("Not authenticated");

    // Generate unique project ID
    let projectId = generateProjectId();
    let existing = await ctx.db
      .query("codeProjects")
      .withIndex("by_project_id", (q) => q.eq("projectId", projectId))
      .first();

    while (existing) {
      projectId = generateProjectId();
      existing = await ctx.db
        .query("codeProjects")
        .withIndex("by_project_id", (q) => q.eq("projectId", projectId))
        .first();
    }

    const now = Date.now();
    const projectDbId = await ctx.db.insert("codeProjects", {
      userId: session.userId,
      projectId,
      name: args.name,
      description: args.description,
      createdAt: now,
      lastActivityAt: now,
    });

    // Auto-create main branch
    const branchId = generateProjectId();
    await ctx.db.insert("codeBranches", {
      projectId,
      branchId,
      name: "main",
      description: "Main branch",
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

    return { projectId, branchId, projectDbId };
  },
});

// ── List projects ─────────────────────────────────────────────────────────────
export const listProjects = query({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const sessions = await ctx.db
      .query("customSessions")
      .withIndex("by_token", (q) => q.eq("token", args.token))
      .take(1);
    const session = sessions[0];
    if (!session || session.expiresAt < Date.now()) return [];

    const projects = await ctx.db
      .query("codeProjects")
      .withIndex("by_user", (q) => q.eq("userId", session.userId))
      .collect();

    return projects.sort((a, b) => b.lastActivityAt - a.lastActivityAt);
  },
});

// ── Get single project ────────────────────────────────────────────────────────
export const getProject = query({
  args: { token: v.string(), projectId: v.string() },
  handler: async (ctx, args) => {
    const sessions = await ctx.db
      .query("customSessions")
      .withIndex("by_token", (q) => q.eq("token", args.token))
      .take(1);
    const session = sessions[0];
    if (!session || session.expiresAt < Date.now()) return null;

    const project = await ctx.db
      .query("codeProjects")
      .withIndex("by_project_id", (q) => q.eq("projectId", args.projectId))
      .first();

    if (!project || project.userId !== session.userId) return null;
    return project;
  },
});

// ── Update project ────────────────────────────────────────────────────────────
export const updateProject = mutation({
  args: {
    token: v.string(),
    projectId: v.string(),
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

    const project = await ctx.db
      .query("codeProjects")
      .withIndex("by_project_id", (q) => q.eq("projectId", args.projectId))
      .first();

    if (!project || project.userId !== session.userId) throw new Error("Project not found");

    const updates: Record<string, unknown> = { lastActivityAt: Date.now() };
    if (args.name !== undefined) updates.name = args.name;
    if (args.description !== undefined) updates.description = args.description;

    await ctx.db.patch(project._id, updates);
  },
});

// ── Delete project ────────────────────────────────────────────────────────────
export const deleteProject = mutation({
  args: { token: v.string(), projectId: v.string() },
  handler: async (ctx, args) => {
    const sessions = await ctx.db
      .query("customSessions")
      .withIndex("by_token", (q) => q.eq("token", args.token))
      .take(1);
    const session = sessions[0];
    if (!session || session.expiresAt < Date.now()) throw new Error("Not authenticated");

    const project = await ctx.db
      .query("codeProjects")
      .withIndex("by_project_id", (q) => q.eq("projectId", args.projectId))
      .first();

    if (!project || project.userId !== session.userId) throw new Error("Project not found");

    // Delete all branches
    const branches = await ctx.db
      .query("codeBranches")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .collect();

    for (const branch of branches) {
      // Delete branch data
      const messages = await ctx.db
        .query("codeMessages")
        .withIndex("by_branch", (q) => q.eq("branchId", branch.branchId))
        .collect();
      for (const msg of messages) await ctx.db.delete(msg._id);

      const files = await ctx.db
        .query("codeFiles")
        .withIndex("by_branch", (q) => q.eq("branchId", branch.branchId))
        .collect();
      for (const file of files) await ctx.db.delete(file._id);

      const commands = await ctx.db
        .query("codeCommands")
        .withIndex("by_branch", (q) => q.eq("branchId", branch.branchId))
        .collect();
      for (const cmd of commands) await ctx.db.delete(cmd._id);

      await ctx.db.delete(branch._id);
    }

    // Delete API keys
    const apiKeys = await ctx.db
      .query("codeApiKeys")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .collect();
    for (const key of apiKeys) await ctx.db.delete(key._id);

    // Delete project
    await ctx.db.delete(project._id);
  },
});
