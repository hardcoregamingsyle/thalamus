import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { Id } from "./_generated/dataModel";

function makeId(len = 10): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let out = "";
  for (let i = 0; i < len; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

async function uniqueProjectId(ctx: any): Promise<string> {
  let id = makeId();
  while (await ctx.db.query("codeProjects").withIndex("by_project_id", (q: any) => q.eq("projectId", id)).first()) {
    id = makeId();
  }
  return id;
}

export const createProject = mutation({
  args: {
    token: v.string(),
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

    const projectId = await uniqueProjectId(ctx);
    const now = Date.now();

    const projectDbId = await ctx.db.insert("codeProjects", {
      userId: session.userId,
      projectId,
      name: args.name,
      description: args.description,
      createdAt: now,
      lastActivityAt: now,
    });

    // every project starts with a main branch
    const branchId = makeId();
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

export const getProject = query({
  args: { token: v.string(), projectId: v.string() },
  handler: async (ctx, args) => {
    const sessions = await ctx.db
      .query("customSessions")
      .withIndex("by_token", (q) => q.eq("token", args.token))
      .take(1);
    const session = sessions[0];
    if (!session || session.expiresAt < Date.now()) return null;

    const proj = await ctx.db
      .query("codeProjects")
      .withIndex("by_project_id", (q) => q.eq("projectId", args.projectId))
      .first();

    if (!proj || proj.userId !== session.userId) return null;
    return proj;
  },
});

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

    const proj = await ctx.db
      .query("codeProjects")
      .withIndex("by_project_id", (q) => q.eq("projectId", args.projectId))
      .first();
    if (!proj || proj.userId !== session.userId) throw new Error("Project not found");

    const updates: Record<string, unknown> = { lastActivityAt: Date.now() };
    if (args.name !== undefined) updates.name = args.name;
    if (args.description !== undefined) updates.description = args.description;

    await ctx.db.patch(proj._id, updates);
  },
});

export const deleteProject = mutation({
  args: { token: v.string(), projectId: v.string() },
  handler: async (ctx, args) => {
    const sessions = await ctx.db
      .query("customSessions")
      .withIndex("by_token", (q) => q.eq("token", args.token))
      .take(1);
    const session = sessions[0];
    if (!session || session.expiresAt < Date.now()) throw new Error("Not authenticated");

    const proj = await ctx.db
      .query("codeProjects")
      .withIndex("by_project_id", (q) => q.eq("projectId", args.projectId))
      .first();
    if (!proj || proj.userId !== session.userId) throw new Error("Project not found");

    const branches = await ctx.db
      .query("codeBranches")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .collect();

    for (const br of branches) {
      const [msgs, files, cmds] = await Promise.all([
        ctx.db.query("codeMessages").withIndex("by_branch", (q) => q.eq("branchId", br.branchId)).collect(),
        ctx.db.query("codeFiles").withIndex("by_branch", (q) => q.eq("branchId", br.branchId)).collect(),
        ctx.db.query("codeCommands").withIndex("by_branch", (q) => q.eq("branchId", br.branchId)).collect(),
      ]);
      for (const row of [...msgs, ...files, ...cmds]) await ctx.db.delete(row._id);
      await ctx.db.delete(br._id);
    }

    const keys = await ctx.db
      .query("codeApiKeys")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .collect();
    for (const k of keys) await ctx.db.delete(k._id);

    await ctx.db.delete(proj._id);
  },
});
