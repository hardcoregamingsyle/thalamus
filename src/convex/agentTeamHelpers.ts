import { internalMutation, internalQuery, query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { Id } from "./_generated/dataModel";

function generateCustomId(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let id = "";
  for (let i = 0; i < 10; i++) id += chars[Math.floor(Math.random() * chars.length)];
  return id;
}

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
      // Track when we started running to detect stale states
      runningAt: args.status === "running" ? Date.now() : undefined,
    });
  },
});

export const getSessionMessages = internalQuery({
  args: { sessionId: v.id("teamSessions") },
  handler: async (ctx, args) => {
    // Load last 100 messages for agent context (agents only use last 20 anyway)
    const msgs = await ctx.db
      .query("agentMessages")
      .withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
      .order("desc")
      .take(100);
    return msgs.reverse();
  },
});

export const createSessionMutation = internalMutation({
  args: {
    userId: v.id("users"),
    task: v.string(),
    title: v.string(),
    sandboxType: v.optional(v.union(v.literal("daytona"), v.literal("v86"), v.literal("qemu"))),
    vmOS: v.optional(v.union(v.literal("linux"), v.literal("windows"), v.literal("macos"), v.literal("freedos"), v.literal("linux64"), v.literal("windows64"), v.literal("macos64"))),
  },
  handler: async (ctx, args): Promise<{ sessionId: Id<"teamSessions">; customId: string }> => {
    const customId = generateCustomId();
    const sessionId = await ctx.db.insert("teamSessions", {
      userId: args.userId,
      title: args.title,
      task: args.task,
      status: "idle",
      round: 0,
      loopCount: 0,
      phase: "Researcher",
      totalMessages: 1, // Start at 1 because we're saving the initial user message
      executionPhase: "planning",
      currentTaskIndex: 0,
      finalReviewCoderEnabled: false,
      customId,
      sandboxType: args.sandboxType || "daytona",
      vmOS: args.vmOS || "linux",
    });

    // Save the initial user message to agentMessages table
    await ctx.db.insert("agentMessages", {
      sessionId,
      userId: args.userId,
      agent: "User",
      content: args.task,
      round: 0,
      messageIndex: 1,
    });

    return { sessionId, customId };
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

export const listSessionsPublic = mutation({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const sessions = await ctx.db
      .query("customSessions")
      .withIndex("by_token", (q) => q.eq("token", args.token))
      .take(1);
    const session = sessions[0];
    if (!session || session.expiresAt < Date.now()) throw new Error("Not authenticated");
    return await ctx.db
      .query("teamSessions")
      .withIndex("by_user", (q) => q.eq("userId", session.userId))
      .order("desc")
      .take(50);
  },
});

export const createSessionPublic = mutation({
  args: {
    token: v.string(),
    task: v.string(),
    sandboxType: v.optional(v.union(v.literal("daytona"), v.literal("v86"), v.literal("qemu"))),
    vmOS: v.optional(v.union(v.literal("linux"), v.literal("windows"), v.literal("macos"), v.literal("freedos"), v.literal("linux64"), v.literal("windows64"), v.literal("macos64"))),
  },
  handler: async (ctx, args): Promise<{ sessionId: Id<"teamSessions">; customId: string }> => {
    const sessions = await ctx.db
      .query("customSessions")
      .withIndex("by_token", (q) => q.eq("token", args.token))
      .take(1);
    const authSession = sessions[0];
    if (!authSession || authSession.expiresAt < Date.now()) throw new Error("Not authenticated");

    const customId = generateCustomId();
    const title = args.task.slice(0, 60) || "Code Session";
    const sessionId = await ctx.db.insert("teamSessions", {
      userId: authSession.userId,
      title,
      task: args.task,
      status: "idle",
      round: 0,
      loopCount: 0,
      phase: "Researcher",
      totalMessages: 1,
      executionPhase: "planning",
      currentTaskIndex: 0,
      finalReviewCoderEnabled: false,
      customId,
      sandboxType: args.sandboxType || "daytona",
      vmOS: args.vmOS || "linux",
    });

    await ctx.db.insert("agentMessages", {
      sessionId,
      userId: authSession.userId,
      agent: "User",
      content: args.task,
      round: 0,
      messageIndex: 1,
    });

    return { sessionId, customId };
  },
});

export const continueSessionPublic = mutation({
  args: {
    token: v.string(),
    sessionId: v.id("teamSessions"),
    newTask: v.string(),
  },
  handler: async (ctx, args) => {
    const sessions = await ctx.db
      .query("customSessions")
      .withIndex("by_token", (q) => q.eq("token", args.token))
      .take(1);
    const authSession = sessions[0];
    if (!authSession || authSession.expiresAt < Date.now()) throw new Error("Not authenticated");
    const session = await ctx.db.get(args.sessionId);
    if (!session || session.userId !== authSession.userId) throw new Error("Session not found");

    const currentMessageCount = session.totalMessages ?? 0;
    await ctx.db.insert("agentMessages", {
      sessionId: args.sessionId,
      userId: authSession.userId,
      agent: "User",
      content: args.newTask,
      round: session.round,
      messageIndex: currentMessageCount + 1,
    });
    await ctx.db.patch(args.sessionId, {
      task: `${session.task}\n\n[USER FOLLOW-UP]: ${args.newTask}`,
      status: "idle",
      totalMessages: currentMessageCount + 1,
    });
  },
});

export const startBackgroundSessionPublic = mutation({
  args: { token: v.string(), sessionId: v.id("teamSessions") },
  handler: async (ctx, args) => {
    const sessions = await ctx.db
      .query("customSessions")
      .withIndex("by_token", (q) => q.eq("token", args.token))
      .take(1);
    const authSession = sessions[0];
    if (!authSession || authSession.expiresAt < Date.now()) throw new Error("Not authenticated");
    const session = await ctx.db.get(args.sessionId);
    if (!session || session.userId !== authSession.userId) throw new Error("Session not found");
    await ctx.db.patch(args.sessionId, { status: "idle" });
  },
});

export const runAgentRoundPublic = mutation({
  args: { token: v.string(), sessionId: v.id("teamSessions") },
  handler: async (ctx, args): Promise<{ agent: string; fileOpsCount: number; done: boolean }> => {
    const sessions = await ctx.db
      .query("customSessions")
      .withIndex("by_token", (q) => q.eq("token", args.token))
      .take(1);
    const authSession = sessions[0];
    if (!authSession || authSession.expiresAt < Date.now()) throw new Error("Not authenticated");
    const session = await ctx.db.get(args.sessionId);
    if (!session || session.userId !== authSession.userId) throw new Error("Session not found");

    const nextIndex = (session.totalMessages ?? 1) + 1;
    await ctx.db.insert("agentMessages", {
      sessionId: args.sessionId,
      userId: authSession.userId,
      agent: "Planner",
      content: "Code session created. The project workspace is ready for files, sandbox commands, and follow-up instructions.",
      round: session.round ?? 0,
      messageIndex: nextIndex,
    });
    await ctx.db.patch(args.sessionId, {
      status: "completed",
      phase: "Planner",
      currentAgent: undefined,
      totalMessages: nextIndex,
    });
    return { agent: "Planner", fileOpsCount: 0, done: true };
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
    // Load last 60 messages for display — enough context without causing lag
    const msgs = await ctx.db
      .query("agentMessages")
      .withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
      .order("desc")
      .take(60);
    return msgs.reverse();
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

// Lightweight metadata-only query — no file content, just paths and metadata
// Use this for the real-time file tree subscription to avoid sending MB of data
export const watchFilesMetadata = query({
  args: { sessionId: v.id("teamSessions") },
  handler: async (ctx, args) => {
    const files = await ctx.db
      .query("projectFiles")
      .withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
      .take(500);
    // Return only metadata — no content
    return files.map(f => ({ _id: f._id, filepath: f.filepath, lastModifiedBy: f.lastModifiedBy }));
  },
});

// Load a single file's content on-demand (called when user clicks a file)
export const getFileContentPublic = query({
  args: { sessionId: v.id("teamSessions"), filepath: v.string() },
  handler: async (ctx, args) => {
    const files = await ctx.db
      .query("projectFiles")
      .withIndex("by_session_and_path", (q) =>
        q.eq("sessionId", args.sessionId).eq("filepath", args.filepath)
      )
      .take(1);
    return files[0] ?? null;
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
    // TODO: Re-enable when vectorizeFile is implemented
    // await ctx.scheduler.runAfter(0, internal.agentTeam.vectorizeFile, {
    //   sessionId: args.sessionId,
    //   filepath: args.filepath,
    //   content: args.content,
    // });
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
    clearPlannerTasks: v.optional(v.boolean()),
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
      // Clear planner tasks when session completes so they don't show stale data
      ...(args.clearPlannerTasks ? { plannerTasksJson: undefined } : {}),
      // Track when we started running to detect stale states
      runningAt: args.status === "running" ? Date.now() : undefined,
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

// Append additional instructions to an in-progress session WITHOUT resetting task progress.
// Use this when the user sends a follow-up message to a running session.
export const appendTaskContext = internalMutation({
  args: {
    sessionId: v.id("teamSessions"),
    additionalContext: v.string(),
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const session = await ctx.db.get(args.sessionId);
    if (!session) throw new Error("Session not found");

    // Save the user message to agentMessages table
    const currentMessageCount = session.totalMessages ?? 0;
    await ctx.db.insert("agentMessages", {
      sessionId: args.sessionId,
      userId: args.userId,
      agent: "User",
      content: args.additionalContext,
      round: session.round,
      messageIndex: currentMessageCount + 1,
    });

    // Append the new instruction to the existing task text
    const updatedTask = session.task + "\n\n[USER FOLLOW-UP]: " + args.additionalContext;
    await ctx.db.patch(args.sessionId, {
      task: updatedTask,
      status: "idle",
      totalMessages: currentMessageCount + 1,
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

export const updateTechStack = internalMutation({
  args: {
    sessionId: v.id("teamSessions"),
    techStackJson: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.sessionId, { techStackJson: args.techStackJson });
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

export const saveGithubConfigMutation = internalMutation({
  args: {
    sessionId: v.id("teamSessions"),
    githubRepo: v.string(),
    githubBranch: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.sessionId, {
      githubRepo: args.githubRepo,
      githubBranch: args.githubBranch,
    });
  },
});

export const updateGithubSync = internalMutation({
  args: {
    sessionId: v.id("teamSessions"),
    lastSyncAt: v.number(),
    lastCommitSha: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.sessionId, {
      githubLastSyncAt: args.lastSyncAt,
      githubLastCommitSha: args.lastCommitSha,
    });
  },
});

export const getSessionByCustomId = query({
  args: { customId: v.string(), token: v.string() },
  handler: async (ctx, args) => {
    const sessions = await ctx.db
      .query("customSessions")
      .withIndex("by_token", (q) => q.eq("token", args.token))
      .take(1);
    const session = sessions[0];
    if (!session || session.expiresAt < Date.now()) return null;

    const teamSessions = await ctx.db
      .query("teamSessions")
      .withIndex("by_custom_id", (q) => q.eq("customId", args.customId))
      .take(1);
    const ts = teamSessions[0];
    if (!ts || ts.userId !== session.userId) return null;
    return ts;
  },
});

export const resetSessionLimitMutation = internalMutation({
  args: { sessionId: v.id("teamSessions") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.sessionId, {
      totalMessages: 0,
      taskMessageCount: 0,
      taskUpgradeActive: false,
      taskUpgradeMessagesLeft: 0,
      status: "idle",
    });
  },
});

export const setInfoRequest = internalMutation({
  args: {
    sessionId: v.id("teamSessions"),
    infoRequestJson: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.sessionId, {
      infoRequestJson: args.infoRequestJson,
      status: "idle", // pause execution
    });
  },
})

export const addInstructions = internalMutation({
  args: {
    sessionId: v.id("teamSessions"),
    instructionsJson: v.string(),
  },
  handler: async (ctx, args) => {
    const session = await ctx.db.get(args.sessionId);
    if (!session) return;

    // Append to existing instructions array
    let instructions: unknown[] = [];
    if (session.instructionsJson) {
      try {
        instructions = JSON.parse(session.instructionsJson) as unknown[];
      } catch {
        // If parse fails, start fresh
      }
    }

    // Parse the new instruction and add it
    try {
      const newInstruction = JSON.parse(args.instructionsJson);
      instructions.push(newInstruction);
    } catch {
      // Ignore invalid JSON
    }

    await ctx.db.patch(args.sessionId, {
      instructionsJson: JSON.stringify(instructions),
    });
  },
});

export const clearInfoRequest = internalMutation({
  args: { sessionId: v.id("teamSessions") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.sessionId, { infoRequestJson: undefined });
  },
});

// ── Branch Group mutations ────────────────────────────────────────────────────
export const createBranchGroupMutation = internalMutation({
  args: {
    userId: v.id("users"),
    groupName: v.string(),
    mainSessionId: v.id("teamSessions"),
    projectSummary: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<Id<"sessionBranchGroups">> => {
    const groupId = await ctx.db.insert("sessionBranchGroups", {
      userId: args.userId,
      groupName: args.groupName,
      mainSessionId: args.mainSessionId,
      branchSessionIds: [],
      projectSummary: args.projectSummary,
      createdAt: Date.now(),
    });
    // Mark the main session as branch 1
    await ctx.db.patch(args.mainSessionId, {
      branchGroupId: groupId,
      branchNumber: 1,
      branchName: "Main Branch",
      branchPurpose: "The primary project",
    });
    return groupId;
  },
});

export const addBranchToGroupMutation = internalMutation({
  args: {
    groupId: v.id("sessionBranchGroups"),
    branchSessionId: v.id("teamSessions"),
    branchName: v.string(),
    branchPurpose: v.string(),
    branchNumber: v.number(),
    mainSessionId: v.id("teamSessions"),
  },
  handler: async (ctx, args) => {
    const group = await ctx.db.get(args.groupId);
    if (!group) throw new Error("Branch group not found");
    await ctx.db.patch(args.groupId, {
      branchSessionIds: [...group.branchSessionIds, args.branchSessionId],
    });
    await ctx.db.patch(args.branchSessionId, {
      branchGroupId: args.groupId,
      branchNumber: args.branchNumber,
      branchName: args.branchName,
      branchPurpose: args.branchPurpose,
      parentSessionId: args.mainSessionId,
    });
  },
});

export const listBranchGroupsQuery = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("sessionBranchGroups")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .order("desc")
      .take(50);
  },
});

export const getBranchGroupQuery = internalQuery({
  args: { groupId: v.id("sessionBranchGroups") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.groupId);
  },
});

export const watchBranchGroups = query({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const sessions = await ctx.db
      .query("customSessions")
      .withIndex("by_token", (q) => q.eq("token", args.token))
      .take(1);
    const session = sessions[0];
    if (!session || session.expiresAt < Date.now()) return [];
    return await ctx.db
      .query("sessionBranchGroups")
      .withIndex("by_user", (q) => q.eq("userId", session.userId))
      .order("desc")
      .take(50);
  },
});

export const getSessionsByBranchGroup = internalQuery({
  args: { branchGroupId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("teamSessions")
      .withIndex("by_branch_group", (q) => q.eq("branchGroupId", args.branchGroupId))
      .take(20);
  },
});

export const forceIdleSession = internalMutation({
  args: {
    sessionId: v.id("teamSessions"),
    currentAgent: v.optional(v.string()),
    round: v.optional(v.number()),
    loopCount: v.optional(v.number()),
    phase: v.optional(v.string()),
    totalMessages: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.sessionId, {
      status: "idle",
      currentAgent: args.currentAgent,
      round: args.round,
      loopCount: args.loopCount,
      phase: args.phase,
      totalMessages: args.totalMessages,
      runningAt: undefined, // Clear runningAt so stale-state check never blocks future runs
    });
  },
});

// ─── NEW: True Branch System Helpers ──────────────────────────────────────────

export const updateSessionBranches = internalMutation({
  args: {
    sessionId: v.id("teamSessions"),
    currentBranch: v.string(),
    branchesJson: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.sessionId, {
      currentBranch: args.currentBranch,
      branchesJson: args.branchesJson,
    });
  },
});

export const upsertFileWithBranch = internalMutation({
  args: {
    sessionId: v.id("teamSessions"),
    userId: v.id("users"),
    filepath: v.string(),
    content: v.string(),
    agent: v.string(),
    branch: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const branch = args.branch || "main";

    // Check if file exists for this branch
    const existing = await ctx.db
      .query("projectFiles")
      .withIndex("by_session_and_branch", q =>
        q.eq("sessionId", args.sessionId).eq("branch", branch)
      )
      .filter(q => q.eq(q.field("filepath"), args.filepath))
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
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
        branch,
      });
    }
  },
});

export const deleteBranchFiles = internalMutation({
  args: {
    sessionId: v.id("teamSessions"),
    branchName: v.string(),
  },
  handler: async (ctx, args) => {
    const files = await ctx.db
      .query("projectFiles")
      .withIndex("by_session_and_branch", q =>
        q.eq("sessionId", args.sessionId).eq("branch", args.branchName)
      )
      .collect();

    for (const file of files) {
      await ctx.db.delete(file._id);
    }
  },
});

// ── Missing public stubs for TeamPortalInline compatibility ───────────────────
export const stopSessionPublic = mutation({
  args: { token: v.string(), sessionId: v.id("teamSessions") },
  handler: async (ctx, args) => {
    const sessions = await ctx.db.query("customSessions").withIndex("by_token", q => q.eq("token", args.token)).take(1);
    const auth = sessions[0];
    if (!auth || auth.expiresAt < Date.now()) throw new Error("Not authenticated");
    const session = await ctx.db.get(args.sessionId);
    if (!session || session.userId !== auth.userId) throw new Error("Not found");
    await ctx.db.patch(args.sessionId, { status: "idle", currentAgent: undefined });
  },
});

export const resetSessionLimitPublic = mutation({
  args: { token: v.string(), sessionId: v.id("teamSessions") },
  handler: async (ctx, args) => {
    const sessions = await ctx.db.query("customSessions").withIndex("by_token", q => q.eq("token", args.token)).take(1);
    const auth = sessions[0];
    if (!auth || auth.expiresAt < Date.now()) throw new Error("Not authenticated");
    const session = await ctx.db.get(args.sessionId);
    if (!session || session.userId !== auth.userId) throw new Error("Not found");
    await ctx.db.patch(args.sessionId, { totalMessages: 0, taskMessageCount: 0, taskUpgradeActive: false, taskUpgradeMessagesLeft: 0, status: "idle" });
  },
});

export const chatModeMessagePublic = mutation({
  args: { token: v.string(), sessionId: v.id("teamSessions"), content: v.string(), history: v.optional(v.array(v.object({ role: v.string(), content: v.string() }))) },
  handler: async (ctx, args) => {
    const sessions = await ctx.db.query("customSessions").withIndex("by_token", q => q.eq("token", args.token)).take(1);
    const auth = sessions[0];
    if (!auth || auth.expiresAt < Date.now()) throw new Error("Not authenticated");
    const session = await ctx.db.get(args.sessionId);
    if (!session || session.userId !== auth.userId) throw new Error("Not found");
    const count = session.totalMessages ?? 0;
    await ctx.db.insert("agentMessages", { sessionId: args.sessionId, userId: auth.userId, agent: "User", content: args.content, round: session.round ?? 0, messageIndex: count + 1 });
    await ctx.db.patch(args.sessionId, { task: `${session.task}\n\n[CHAT]: ${args.content}`, status: "idle", totalMessages: count + 1 });
    return { response: `Processing: ${args.content}`, changeMode: null as string | null };
  },
});

export const minorEditMessagePublic = mutation({
  args: { token: v.string(), sessionId: v.id("teamSessions"), content: v.string() },
  handler: async (ctx, args) => {
    const sessions = await ctx.db.query("customSessions").withIndex("by_token", q => q.eq("token", args.token)).take(1);
    const auth = sessions[0];
    if (!auth || auth.expiresAt < Date.now()) throw new Error("Not authenticated");
    const session = await ctx.db.get(args.sessionId);
    if (!session || session.userId !== auth.userId) throw new Error("Not found");
    const count = session.totalMessages ?? 0;
    await ctx.db.insert("agentMessages", { sessionId: args.sessionId, userId: auth.userId, agent: "User", content: args.content, round: session.round ?? 0, messageIndex: count + 1 });
    await ctx.db.patch(args.sessionId, { task: `${session.task}\n\n[MINOR EDIT]: ${args.content}`, status: "idle", totalMessages: count + 1 });
    return { changeMode: null as string | null };
  },
});

export const saveGithubConfigPublic = mutation({
  args: { token: v.string(), sessionId: v.id("teamSessions"), githubRepo: v.string(), githubBranch: v.string() },
  handler: async (ctx, args) => {
    const sessions = await ctx.db.query("customSessions").withIndex("by_token", q => q.eq("token", args.token)).take(1);
    const auth = sessions[0];
    if (!auth || auth.expiresAt < Date.now()) throw new Error("Not authenticated");
    const session = await ctx.db.get(args.sessionId);
    if (!session || session.userId !== auth.userId) throw new Error("Not found");
    await ctx.db.patch(args.sessionId, { githubRepo: args.githubRepo, githubBranch: args.githubBranch });
  },
});

export const syncGithubPublic = mutation({
  args: { token: v.string(), sessionId: v.id("teamSessions") },
  handler: async (ctx, args) => {
    const sessions = await ctx.db.query("customSessions").withIndex("by_token", q => q.eq("token", args.token)).take(1);
    const auth = sessions[0];
    if (!auth || auth.expiresAt < Date.now()) throw new Error("Not authenticated");
    const session = await ctx.db.get(args.sessionId);
    if (!session || session.userId !== auth.userId) throw new Error("Not found");
    return { synced: false, message: "GitHub sync requires server-side action", pushed: 0, pulled: 0, conflicts: [] as string[] };
  },
});

export const createBranchPublic = mutation({
  args: { token: v.string(), sessionId: v.id("teamSessions"), branchName: v.string(), fromBranch: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const sessions = await ctx.db.query("customSessions").withIndex("by_token", q => q.eq("token", args.token)).take(1);
    const auth = sessions[0];
    if (!auth || auth.expiresAt < Date.now()) throw new Error("Not authenticated");
    const session = await ctx.db.get(args.sessionId);
    if (!session || session.userId !== auth.userId) throw new Error("Not found");
    const branches = session.branchesJson ? JSON.parse(session.branchesJson) as string[] : ["main"];
    if (!branches.includes(args.branchName)) branches.push(args.branchName);
    await ctx.db.patch(args.sessionId, { branchesJson: JSON.stringify(branches) });
    return { success: true, branchName: args.branchName };
  },
});

export const switchBranchPublic = mutation({
  args: { token: v.string(), sessionId: v.id("teamSessions"), branchName: v.string() },
  handler: async (ctx, args) => {
    const sessions = await ctx.db.query("customSessions").withIndex("by_token", q => q.eq("token", args.token)).take(1);
    const auth = sessions[0];
    if (!auth || auth.expiresAt < Date.now()) throw new Error("Not authenticated");
    const session = await ctx.db.get(args.sessionId);
    if (!session || session.userId !== auth.userId) throw new Error("Not found");
    await ctx.db.patch(args.sessionId, { currentBranch: args.branchName });
    return { success: true, branchName: args.branchName };
  },
});

export const mergeBranchPublic = mutation({
  args: { token: v.string(), sessionId: v.id("teamSessions"), sourceBranch: v.string(), targetBranch: v.string() },
  handler: async (ctx, args) => {
    const sessions = await ctx.db.query("customSessions").withIndex("by_token", q => q.eq("token", args.token)).take(1);
    const auth = sessions[0];
    if (!auth || auth.expiresAt < Date.now()) throw new Error("Not authenticated");
    return { merged: 0, conflicts: [] as Array<{ filepath: string; sourceContent: string; targetContent: string }> };
  },
});

export const deleteBranchPublic = mutation({
  args: { token: v.string(), sessionId: v.id("teamSessions"), branchName: v.string() },
  handler: async (ctx, args) => {
    const sessions = await ctx.db.query("customSessions").withIndex("by_token", q => q.eq("token", args.token)).take(1);
    const auth = sessions[0];
    if (!auth || auth.expiresAt < Date.now()) throw new Error("Not authenticated");
    const session = await ctx.db.get(args.sessionId);
    if (!session || session.userId !== auth.userId) throw new Error("Not found");
    const branches = session.branchesJson ? (JSON.parse(session.branchesJson) as string[]).filter(b => b !== args.branchName) : ["main"];
    await ctx.db.patch(args.sessionId, { branchesJson: JSON.stringify(branches) });
    return { success: true, branchName: args.branchName };
  },
});

export const submitInfoResponsePublic = mutation({
  args: { token: v.string(), sessionId: v.id("teamSessions"), responses: v.array(v.object({ fieldId: v.string(), value: v.string() })) },
  handler: async (ctx, args) => {
    const sessions = await ctx.db.query("customSessions").withIndex("by_token", q => q.eq("token", args.token)).take(1);
    const auth = sessions[0];
    if (!auth || auth.expiresAt < Date.now()) throw new Error("Not authenticated");
    const session = await ctx.db.get(args.sessionId);
    if (!session || session.userId !== auth.userId) throw new Error("Not found");
    const count = session.totalMessages ?? 0;
    const responseText = args.responses.map(r => `${r.fieldId}: ${r.value}`).join("\n");
    await ctx.db.insert("agentMessages", { sessionId: args.sessionId, userId: auth.userId, agent: "User", content: responseText, round: session.round ?? 0, messageIndex: count + 1 });
    await ctx.db.patch(args.sessionId, { infoRequestJson: undefined, task: `${session.task}\n\n[INFO RESPONSE]: ${responseText}`, status: "idle", totalMessages: count + 1 });
  },
});

export const importFromGithubPublic = mutation({
  args: { token: v.string(), sessionId: v.id("teamSessions"), repoUrl: v.string(), branch: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const sessions = await ctx.db.query("customSessions").withIndex("by_token", q => q.eq("token", args.token)).take(1);
    const auth = sessions[0];
    if (!auth || auth.expiresAt < Date.now()) throw new Error("Not authenticated");
    return { imported: 0, message: "GitHub import requires server-side action", errors: [] as string[] };
  },
});

export const vectorizeSessionPublic = mutation({
  args: { token: v.string(), sessionId: v.id("teamSessions") },
  handler: async (ctx, args) => {
    const sessions = await ctx.db.query("customSessions").withIndex("by_token", q => q.eq("token", args.token)).take(1);
    const auth = sessions[0];
    if (!auth || auth.expiresAt < Date.now()) throw new Error("Not authenticated");
    return { vectorized: false, indexed: 0 };
  },
});