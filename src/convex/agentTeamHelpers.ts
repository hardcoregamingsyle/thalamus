import { internalMutation, internalQuery, query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";

export const saveAgentMessage = internalMutation({
  args: {
    sessionId: v.id("teamSessions"),
    userId: v.id("users"),
    agent: v.string(),
    content: v.string(),
    round: v.optional(v.number()),
    messageIndex: v.optional(v.number()),
    modelUsed: v.optional(v.string()),
    agentBucksDeducted: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("agentMessages", {
      sessionId: args.sessionId,
      userId: args.userId,
      agent: args.agent,
      content: args.content,
      round: args.round,
      messageIndex: args.messageIndex,
      modelUsed: args.modelUsed,
      agentBucksDeducted: args.agentBucksDeducted,
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
      phase: "Researcher",
      totalMessages: 0,
      executionPhase: "planning",
      currentTaskIndex: 0,
      finalReviewCoderEnabled: false,
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

export const updateStreamingOutput = internalMutation({
  args: {
    sessionId: v.id("teamSessions"),
    currentAgentOutput: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.sessionId, {
      currentAgentOutput: args.currentAgentOutput,
    });
  },
});

// Public reactive query — frontend subscribes to this for live updates
export const watchSession = query({
  args: { sessionId: v.id("teamSessions") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.sessionId);
  },
});

export const watchMessages = query({
  args: { sessionId: v.id("teamSessions") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("agentMessages")
      .withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
      .order("asc")
      .take(200);
  },
});

export const watchFiles = query({
  args: { sessionId: v.id("teamSessions") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("projectFiles")
      .withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
      .take(500);
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
    // Auto-vectorize this file into RAG in the background (non-blocking)
    await ctx.scheduler.runAfter(0, internal.agentTeam.vectorizeFile, {
      sessionId: args.sessionId,
      filepath: args.filepath,
      content: args.content,
    });
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

export const updatePlannerTasks = internalMutation({
  args: {
    sessionId: v.id("teamSessions"),
    plannerTasksJson: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.sessionId, {
      plannerTasksJson: args.plannerTasksJson,
    });
  },
});

export const updateSessionFull = internalMutation({
  args: {
    sessionId: v.id("teamSessions"),
    status: v.union(v.literal("running"), v.literal("completed"), v.literal("idle")),
    currentAgent: v.optional(v.string()),
    loopCount: v.optional(v.number()),
    phase: v.optional(v.string()),
    totalMessages: v.optional(v.number()),
    executionPhase: v.optional(v.string()),
    currentTaskIndex: v.optional(v.number()),
    finalReviewCoderEnabled: v.optional(v.boolean()),
    taskMessageCount: v.optional(v.number()),
    taskUpgradeActive: v.optional(v.boolean()),
    taskUpgradeMessagesLeft: v.optional(v.number()),
    unfixableTasksJson: v.optional(v.string()),
    manualUpgradeEnabled: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.sessionId, {
      status: args.status,
      currentAgent: args.currentAgent,
      loopCount: args.loopCount,
      phase: args.phase,
      totalMessages: args.totalMessages,
      executionPhase: args.executionPhase,
      currentTaskIndex: args.currentTaskIndex,
      finalReviewCoderEnabled: args.finalReviewCoderEnabled,
      taskMessageCount: args.taskMessageCount,
      taskUpgradeActive: args.taskUpgradeActive,
      taskUpgradeMessagesLeft: args.taskUpgradeMessagesLeft,
      unfixableTasksJson: args.unfixableTasksJson,
      manualUpgradeEnabled: args.manualUpgradeEnabled,
    });
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
      phase: "Researcher",
      totalMessages: 0,
      executionPhase: "planning",
      currentTaskIndex: 0,
      plannerTasksJson: undefined,
      finalReviewCoderEnabled: false,
    });
  },
});

export const updateDeployCommands = internalMutation({
  args: {
    sessionId: v.id("teamSessions"),
    deployCommandsJson: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.sessionId, {
      deployCommandsJson: args.deployCommandsJson,
    });
  },
});

export const upsertProjectFile = internalMutation({
  args: {
    sessionId: v.id("teamSessions"),
    userId: v.id("users"),
    filepath: v.string(),
    content: v.string(),
    lastModifiedBy: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("projectFiles")
      .withIndex("by_session_and_path", (q) =>
        q.eq("sessionId", args.sessionId).eq("filepath", args.filepath)
      )
      .take(1);
    if (existing[0]) {
      await ctx.db.patch(existing[0]._id, {
        content: args.content,
        lastModifiedBy: args.lastModifiedBy,
      });
    } else {
      await ctx.db.insert("projectFiles", {
        sessionId: args.sessionId,
        userId: args.userId,
        filepath: args.filepath,
        content: args.content,
        lastModifiedBy: args.lastModifiedBy,
      });
    }
  },
});

export const updateTaskSummaries = internalMutation({
  args: {
    sessionId: v.id("teamSessions"),
    taskSummariesJson: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.sessionId, { taskSummariesJson: args.taskSummariesJson });
  },
});

export const updateTaskDifficulty = internalMutation({
  args: {
    sessionId: v.id("teamSessions"),
    difficulty: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.sessionId, { currentTaskDifficulty: args.difficulty });
  },
});

// ── Public file operation mutations (called from frontend) ────────────────────
export const deleteFilePublic = mutation({
  args: {
    sessionId: v.id("teamSessions"),
    filepath: v.string(),
    token: v.string(),
  },
  handler: async (ctx, args) => {
    // Delete single file or all files with this path prefix (folder)
    const allFiles = await ctx.db
      .query("projectFiles")
      .withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
      .take(500);
    const toDelete = allFiles.filter(f =>
      f.filepath === args.filepath || f.filepath.startsWith(args.filepath + "/")
    );
    for (const f of toDelete) await ctx.db.delete(f._id);
  },
});

export const renameFilePublic = mutation({
  args: {
    sessionId: v.id("teamSessions"),
    oldPath: v.string(),
    newPath: v.string(),
    token: v.string(),
  },
  handler: async (ctx, args) => {
    const allFiles = await ctx.db
      .query("projectFiles")
      .withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
      .take(500);
    // Rename single file or all files under a folder
    const toRename = allFiles.filter(f =>
      f.filepath === args.oldPath || f.filepath.startsWith(args.oldPath + "/")
    );
    for (const f of toRename) {
      const newFilepath = f.filepath === args.oldPath
        ? args.newPath
        : args.newPath + f.filepath.slice(args.oldPath.length);
      await ctx.db.patch(f._id, { filepath: newFilepath, lastModifiedBy: "user" });
    }
  },
});

export const createFilePublic = mutation({
  args: {
    sessionId: v.id("teamSessions"),
    filepath: v.string(),
    content: v.optional(v.string()),
    token: v.string(),
  },
  handler: async (ctx, args) => {
    // Get userId from session
    const session = await ctx.db.get(args.sessionId);
    if (!session) throw new Error("Session not found");
    const userId = session.userId as Id<"users">;
    const existing = await ctx.db
      .query("projectFiles")
      .withIndex("by_session_and_path", (q) =>
        q.eq("sessionId", args.sessionId).eq("filepath", args.filepath)
      )
      .take(1);
    if (existing.length > 0) {
      await ctx.db.patch(existing[0]._id, { content: args.content ?? "", lastModifiedBy: "user" });
    } else {
      await ctx.db.insert("projectFiles", {
        sessionId: args.sessionId,
        userId,
        filepath: args.filepath,
        content: args.content ?? "",
        lastModifiedBy: "user",
      });
    }
  },
});

export const duplicateFilePublic = mutation({
  args: {
    sessionId: v.id("teamSessions"),
    sourcePath: v.string(),
    destPath: v.string(),
    token: v.string(),
  },
  handler: async (ctx, args) => {
    const session = await ctx.db.get(args.sessionId);
    if (!session) throw new Error("Session not found");
    const userId = session.userId as Id<"users">;
    const allFiles = await ctx.db
      .query("projectFiles")
      .withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
      .take(500);
    const toCopy = allFiles.filter(f =>
      f.filepath === args.sourcePath || f.filepath.startsWith(args.sourcePath + "/")
    );
    for (const f of toCopy) {
      const newFilepath = f.filepath === args.sourcePath
        ? args.destPath
        : args.destPath + f.filepath.slice(args.sourcePath.length);
      const destExists = allFiles.find(x => x.filepath === newFilepath);
      if (destExists) {
        await ctx.db.patch(destExists._id, { content: f.content, lastModifiedBy: "user" });
      } else {
        await ctx.db.insert("projectFiles", {
          sessionId: args.sessionId,
          userId,
          filepath: newFilepath,
          content: f.content,
          lastModifiedBy: "user",
        });
      }
    }
  },
});

export const setManualUpgrade = mutation({
  args: {
    sessionId: v.id("teamSessions"),
    enabled: v.boolean(),
    token: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.sessionId, { manualUpgradeEnabled: args.enabled });
  },
});

// Force upgrade: activates the Modal Upgrade immediately (no rejection needed)
export const forceActivateUpgrade = mutation({
  args: {
    sessionId: v.id("teamSessions"),
    token: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.sessionId, {
      taskUpgradeActive: true,
      taskUpgradeMessagesLeft: 30,
      manualUpgradeEnabled: false,
    });
  },
});