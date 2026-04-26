import { internalMutation, internalQuery } from "./_generated/server";
import { v } from "convex/values";
import { Id } from "./_generated/dataModel";

export const saveAgentMessage = internalMutation({
  args: {
    sessionId: v.id("teamSessions"),
    userId: v.id("users"),
    agent: v.string(),
    content: v.string(),
    round: v.optional(v.number()),
    messageIndex: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("agentMessages", {
      sessionId: args.sessionId,
      userId: args.userId,
      agent: args.agent,
      content: args.content,
      round: args.round,
      messageIndex: args.messageIndex,
    });
  },
});

export const updateSessionStatus = internalMutation({
  args: {
    sessionId: v.id("teamSessions"),
    status: v.union(v.literal("running"), v.literal("completed"), v.literal("idle")),
    currentAgent: v.optional(v.string()),
    round: v.optional(v.number()),
    loopCount: v.optional(v.number()),
    phase: v.optional(v.string()),
    totalMessages: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.sessionId, {
      status: args.status,
      currentAgent: args.currentAgent,
      round: args.round,
      loopCount: args.loopCount,
      phase: args.phase,
      totalMessages: args.totalMessages,
    });
  },
});

export const getSessionMessages = internalQuery({
  args: { sessionId: v.id("teamSessions") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("agentMessages")
      .withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
      .order("asc")
      .take(200);
  },
});

export const createSessionMutation = internalMutation({
  args: {
    userId: v.id("users"),
    task: v.string(),
    title: v.string(),
  },
  handler: async (ctx, args): Promise<Id<"teamSessions">> => {
    return await ctx.db.insert("teamSessions", {
      userId: args.userId,
      title: args.title,
      task: args.task,
      status: "idle",
      round: 0,
      loopCount: 0,
      phase: "Analyser",
      totalMessages: 0,
    });
  },
});

export const getSession = internalQuery({
  args: { sessionId: v.id("teamSessions") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.sessionId);
  },
});

export const listSessionsQuery = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("teamSessions")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .order("desc")
      .take(50);
  },
});

// File operations
export const upsertFile = internalMutation({
  args: {
    sessionId: v.id("teamSessions"),
    userId: v.id("users"),
    filepath: v.string(),
    content: v.string(),
    agent: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("projectFiles")
      .withIndex("by_session_and_path", (q) =>
        q.eq("sessionId", args.sessionId).eq("filepath", args.filepath)
      )
      .take(1);
    if (existing.length > 0) {
      await ctx.db.patch(existing[0]._id, {
        content: args.content,
        lastModifiedBy: args.agent,
      });
    } else {
      await ctx.db.insert("projectFiles", {
        sessionId: args.sessionId,
        userId: args.userId,
        filepath: args.filepath,
        content: args.content,
        lastModifiedBy: args.agent,
      });
    }
  },
});

export const deleteFile = internalMutation({
  args: {
    sessionId: v.id("teamSessions"),
    filepath: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("projectFiles")
      .withIndex("by_session_and_path", (q) =>
        q.eq("sessionId", args.sessionId).eq("filepath", args.filepath)
      )
      .take(1);
    if (existing.length > 0) {
      await ctx.db.delete(existing[0]._id);
    }
  },
});

export const getFiles = internalQuery({
  args: { sessionId: v.id("teamSessions") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("projectFiles")
      .withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
      .take(500);
  },
});

export const getFileByPath = internalQuery({
  args: { sessionId: v.id("teamSessions"), filepath: v.string() },
  handler: async (ctx, args) => {
    const files = await ctx.db
      .query("projectFiles")
      .withIndex("by_session_and_path", (q) =>
        q.eq("sessionId", args.sessionId).eq("filepath", args.filepath)
      )
      .take(1);
    return files[0] || null;
  },
});

export const resetSessionForNewTask = internalMutation({
  args: {
    sessionId: v.id("teamSessions"),
    newTask: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.sessionId, {
      task: args.newTask,
      title: args.newTask.slice(0, 60),
      status: "idle",
      currentAgent: undefined,
      round: 0,
      loopCount: 0,
      phase: "Analyser",
      totalMessages: 0,
    });
  },
});