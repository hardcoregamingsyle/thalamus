import { internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";

// Generate 10 character ID
function generateId(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let id = "";
  for (let i = 0; i < 10; i++) {
    id += chars[Math.floor(Math.random() * chars.length)];
  }
  return id;
}

// Migrate old teamSessions to new code projects/branches
export const migrateOldSessions = internalMutation({
  args: {},
  handler: async (ctx) => {
    const sessions = await ctx.db.query("teamSessions").collect();

    let migratedCount = 0;
    const projectMap = new Map<string, string>(); // userId -> projectId

    for (const session of sessions) {
      // Skip if already migrated (has a corresponding branch)
      const existingBranch = await ctx.db
        .query("codeBranches")
        .withIndex("by_branch_id", (q) => q.eq("branchId", session.customId || ""))
        .first();

      if (existingBranch) continue;

      // Get or create project for this user
      let projectId = projectMap.get(session.userId);

      if (!projectId) {
        // Check if user already has a "Migrated" project
        const existingProjects = await ctx.db
          .query("codeProjects")
          .withIndex("by_user", (q) => q.eq("userId", session.userId))
          .collect();

        const migratedProject = existingProjects.find(p => p.name === "Migrated from Old System");

        if (migratedProject) {
          projectId = migratedProject.projectId;
        } else {
          // Create new project
          projectId = generateId();
          await ctx.db.insert("codeProjects", {
            userId: session.userId,
            projectId,
            name: "Migrated from Old System",
            description: "Projects migrated from the old code mode system",
            createdAt: session._creationTime,
            lastActivityAt: Date.now(),
          });
        }

        projectMap.set(session.userId, projectId);
      }

      // Create branch from session
      const branchId = session.customId || generateId();

      await ctx.db.insert("codeBranches", {
        projectId,
        branchId,
        name: session.title || "Unnamed Branch",
        description: session.task?.slice(0, 200),
        createdAt: session._creationTime,
        lastActivityAt: Date.now(),
        status: session.status,
        currentAgent: session.currentAgent,
        phase: session.phase || "Researcher",
        executionPhase: session.executionPhase || "planning",
        currentTaskIndex: session.currentTaskIndex || 0,
        totalMessages: session.totalMessages || 0,
        round: session.round || 0,
        plannerTasksJson: session.plannerTasksJson,
        currentTaskDifficulty: session.currentTaskDifficulty,
        vmOs: (session as any).vmOS || "windows11_pro",
        vmRam: (session as any).vmRam,
        vmCores: (session as any).vmCores,
      });

      // Migrate messages
      const messages = await ctx.db
        .query("agentMessages")
        .withIndex("by_session", (q) => q.eq("sessionId", session._id))
        .collect();

      for (const msg of messages) {
        await ctx.db.insert("codeMessages", {
          branchId,
          agent: msg.agent,
          content: msg.content,
          round: msg.round,
          messageIndex: msg.messageIndex,
          createdAt: msg._creationTime,
        });
      }

      // Migrate files
      const files = await ctx.db
        .query("projectFiles")
        .withIndex("by_session", (q) => q.eq("sessionId", session._id))
        .collect();

      for (const file of files) {
        await ctx.db.insert("codeFiles", {
          branchId,
          filepath: file.filepath,
          content: file.content,
          lastModifiedBy: file.lastModifiedBy || "Unknown",
          lastModifiedAt: file._creationTime,
        });
      }

      migratedCount++;
    }

    return { success: true, migratedCount };
  },
});

// Run migration (call this once)
export const runMigration = internalMutation({
  args: { confirm: v.boolean() },
  handler: async (ctx, args): Promise<{ success: boolean; migratedCount: number }> => {
    if (!args.confirm) {
      throw new Error("Migration not confirmed. Pass { confirm: true } to run.");
    }

    console.log("Starting migration...");
    const result: { success: boolean; migratedCount: number } = await ctx.runMutation(internal.codeMigration.migrateOldSessions, {});
    console.log(`Migration complete. Migrated ${result.migratedCount} sessions.`);

    return result;
  },
});
