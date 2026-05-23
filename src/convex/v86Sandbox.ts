"use node";
// V86-based sandbox execution
// Replaces Daytona with in-browser x86 VMs

import { action } from "./_generated/server";
import { v } from "convex/values";
import { Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";

// VM session management
const activeSessions = new Map<string, {
  vmId: string;
  os: "linux" | "windows" | "freedos";
  createdAt: number;
  lastActivity: number;
}>();

/**
 * Create a new VM sandbox for a session
 */
export const createV86Sandbox = action({
  args: {
    sessionId: v.id("teamSessions"),
    os: v.union(v.literal("linux"), v.literal("windows"), v.literal("freedos")),
    token: v.string(),
  },
  handler: async (ctx, args): Promise<{
    vmId: string;
    os: string;
    status: string;
  }> => {
    const userId = await ctx.runQuery(internal.customAuthHelpers.getUserIdByToken, { token: args.token });
    if (!userId) throw new Error("Not authenticated");

    const session = await ctx.runQuery(internal.agentTeamHelpers.getSession, { sessionId: args.sessionId });
    if (!session) throw new Error("Session not found");
    if ((session as { userId: Id<"users"> }).userId !== userId) throw new Error("Not authorized");

    // Generate VM ID
    const vmId = `vm_${args.sessionId}_${Date.now()}`;

    // Store VM session info
    activeSessions.set(args.sessionId, {
      vmId,
      os: args.os,
      createdAt: Date.now(),
      lastActivity: Date.now(),
    });

    // VM will be created client-side in the browser
    // This just registers the intent and returns config
    return {
      vmId,
      os: args.os,
      status: "ready",
    };
  },
});

/**
 * Execute command in VM sandbox
 * This is called from the agent pipeline
 */
export const executeV86Command = action({
  args: {
    sessionId: v.id("teamSessions"),
    command: v.string(),
    token: v.string(),
  },
  handler: async (ctx, args): Promise<{
    output: string;
    exitCode: number;
    vmId: string;
  }> => {
    const userId = await ctx.runQuery(internal.customAuthHelpers.getUserIdByToken, { token: args.token });
    if (!userId) throw new Error("Not authenticated");

    const session = await ctx.runQuery(internal.agentTeamHelpers.getSession, { sessionId: args.sessionId });
    if (!session) throw new Error("Session not found");
    if ((session as { userId: Id<"users"> }).userId !== userId) throw new Error("Not authorized");

    // Get VM session
    const vmSession = activeSessions.get(args.sessionId);
    if (!vmSession) {
      throw new Error("No VM sandbox active for this session. Create one first.");
    }

    // Update last activity
    vmSession.lastActivity = Date.now();

    // Command execution happens client-side
    // This action just validates and logs the intent
    // The actual execution will be handled by the frontend VM manager

    return {
      output: `[V86] Command queued for execution: ${args.command}`,
      exitCode: 0,
      vmId: vmSession.vmId,
    };
  },
});

/**
 * Sync project files to VM
 */
export const syncFilesToV86 = action({
  args: {
    sessionId: v.id("teamSessions"),
    token: v.string(),
  },
  handler: async (ctx, args): Promise<{ synced: number; vmId: string }> => {
    const userId = await ctx.runQuery(internal.customAuthHelpers.getUserIdByToken, { token: args.token });
    if (!userId) throw new Error("Not authenticated");

    const session = await ctx.runQuery(internal.agentTeamHelpers.getSession, { sessionId: args.sessionId });
    if (!session) throw new Error("Session not found");

    // Get project files
    const files = await ctx.runQuery(internal.agentTeamHelpers.getFiles, { sessionId: args.sessionId });

    const vmSession = activeSessions.get(args.sessionId);
    if (!vmSession) {
      throw new Error("No VM sandbox active");
    }

    // File sync happens client-side via VM manager
    return {
      synced: files.length,
      vmId: vmSession.vmId,
    };
  },
});

/**
 * Stop VM sandbox
 */
export const stopV86Sandbox = action({
  args: {
    sessionId: v.id("teamSessions"),
    token: v.string(),
  },
  handler: async (ctx, args): Promise<{ stopped: boolean }> => {
    const userId = await ctx.runQuery(internal.customAuthHelpers.getUserIdByToken, { token: args.token });
    if (!userId) throw new Error("Not authenticated");

    activeSessions.delete(args.sessionId);

    return { stopped: true };
  },
});

/**
 * Get VM status
 */
export const getV86Status = action({
  args: {
    sessionId: v.id("teamSessions"),
    token: v.string(),
  },
  handler: async (ctx, args): Promise<{
    active: boolean;
    vmId?: string;
    os?: string;
    uptime?: number;
  }> => {
    const userId = await ctx.runQuery(internal.customAuthHelpers.getUserIdByToken, { token: args.token });
    if (!userId) throw new Error("Not authenticated");

    const vmSession = activeSessions.get(args.sessionId);
    if (!vmSession) {
      return { active: false };
    }

    return {
      active: true,
      vmId: vmSession.vmId,
      os: vmSession.os,
      uptime: Date.now() - vmSession.createdAt,
    };
  },
});

// Cleanup inactive VMs (run periodically)
setInterval(() => {
  const now = Date.now();
  const timeout = 30 * 60 * 1000; // 30 minutes

  for (const [sessionId, vmSession] of activeSessions.entries()) {
    if (now - vmSession.lastActivity > timeout) {
      console.log(`Cleaning up inactive VM: ${vmSession.vmId}`);
      activeSessions.delete(sessionId);
    }
  }
}, 5 * 60 * 1000); // Check every 5 minutes
