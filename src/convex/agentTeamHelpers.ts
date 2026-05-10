import { internalMutation, internalQuery, query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";

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
      totalMessages: 0,
      executionPhase: "planning",
      currentTaskIndex: 0,
      finalReviewCoderEnabled: false,
      customId,
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
  },
  handler: async (ctx, args) => {
    const session = await ctx.db.get(args.sessionId);
    if (!session) throw new Error("Session not found");
    // Append the new instruction to the existing task text
    const updatedTask = session.task + "\n\n[USER FOLLOW-UP]: " + args.additionalContext;
    await ctx.db.patch(args.sessionId, {
      task: updatedTask,
      status: "idle",
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