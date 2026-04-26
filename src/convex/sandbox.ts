"use node";
import { action, internalMutation, internalQuery } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { Id } from "./_generated/dataModel";
import { Daytona } from "@daytona/sdk";

// $0.075 per hour = 0.075/3600 per second = 7.5 cents per hour
const COST_CENTS_PER_HOUR = 7.5;

function getDaytona() {
  const apiKey = process.env.DAYTONA_API_KEY;
  if (!apiKey) throw new Error("DAYTONA_API_KEY not configured");
  return new Daytona({ apiKey });
}

// Create a new sandbox
export const createSandbox = action({
  args: {
    token: v.string(),
    label: v.optional(v.string()),
    sessionId: v.optional(v.id("teamSessions")),
  },
  handler: async (ctx, args): Promise<{ sandboxDbId: string; sandboxId: string }> => {
    const userId = (await ctx.runQuery(internal.customAuthHelpers.getUserIdByToken, {
      token: args.token,
    })) as Id<"users"> | null;
    if (!userId) throw new Error("Not authenticated");

    const daytona = getDaytona();

    // Create ephemeral sandbox with 1 vCPU
    const sandbox = await daytona.create({
      language: "typescript",
      resources: { cpu: 1, memory: 2, disk: 8 },
      ephemeral: true,
      autoStopInterval: 30, // auto-stop after 30 min idle
    });

    const sandboxDbId = await ctx.runMutation(internal.sandboxHelpers.insertSandbox, {
      userId,
      sandboxId: sandbox.id,
      sessionId: args.sessionId,
      label: args.label,
      status: "running",
      createdAt: Date.now(),
    });

    return { sandboxDbId, sandboxId: sandbox.id };
  },
});

// Execute a command in a sandbox
export const executeCommand = action({
  args: {
    token: v.string(),
    sandboxDbId: v.id("sandboxes"),
    command: v.string(),
  },
  handler: async (ctx, args): Promise<{ output: string; exitCode: number }> => {
    const userId = (await ctx.runQuery(internal.customAuthHelpers.getUserIdByToken, {
      token: args.token,
    })) as Id<"users"> | null;
    if (!userId) throw new Error("Not authenticated");

    const sandboxRecord = (await ctx.runQuery(internal.sandboxHelpers.getSandbox, {
      sandboxDbId: args.sandboxDbId,
    })) as { sandboxId: string; userId: Id<"users">; createdAt: number; status: string } | null;

    if (!sandboxRecord) throw new Error("Sandbox not found");
    if (sandboxRecord.userId !== userId) throw new Error("Not authorized");
    if (sandboxRecord.status !== "running") throw new Error("Sandbox is not running");

    const daytona = getDaytona();
    const sandbox = await daytona.get(sandboxRecord.sandboxId);

    const response = await sandbox.process.executeCommand(args.command);
    const output = response.result ?? "";
    const exitCode = response.exitCode ?? 0;

    // Calculate cost so far
    const elapsedHours = (Date.now() - sandboxRecord.createdAt) / 3600000;
    const costCents = Math.round(elapsedHours * COST_CENTS_PER_HOUR * 100) / 100;

    await ctx.runMutation(internal.sandboxHelpers.updateSandboxCommand, {
      sandboxDbId: args.sandboxDbId,
      lastCommand: args.command,
      lastOutput: output.slice(0, 2000),
      costCents,
    });

    return { output, exitCode };
  },
});

// Upload a file to sandbox
export const uploadFile = action({
  args: {
    token: v.string(),
    sandboxDbId: v.id("sandboxes"),
    path: v.string(),
    content: v.string(),
  },
  handler: async (ctx, args): Promise<{ success: boolean }> => {
    const userId = (await ctx.runQuery(internal.customAuthHelpers.getUserIdByToken, {
      token: args.token,
    })) as Id<"users"> | null;
    if (!userId) throw new Error("Not authenticated");

    const sandboxRecord = (await ctx.runQuery(internal.sandboxHelpers.getSandbox, {
      sandboxDbId: args.sandboxDbId,
    })) as { sandboxId: string; userId: Id<"users">; status: string } | null;

    if (!sandboxRecord) throw new Error("Sandbox not found");
    if (sandboxRecord.userId !== userId) throw new Error("Not authorized");
    if (sandboxRecord.status !== "running") throw new Error("Sandbox is not running");

    const daytona = getDaytona();
    const sandbox = await daytona.get(sandboxRecord.sandboxId);

    const buffer = Buffer.from(args.content, "utf-8");
    await sandbox.fs.uploadFile(buffer, args.path);

    return { success: true };
  },
});

// Deploy project files from a team session into the sandbox
export const deployProjectFiles = action({
  args: {
    token: v.string(),
    sandboxDbId: v.id("sandboxes"),
    sessionId: v.id("teamSessions"),
  },
  handler: async (ctx, args): Promise<{ filesDeployed: number }> => {
    const userId = (await ctx.runQuery(internal.customAuthHelpers.getUserIdByToken, {
      token: args.token,
    })) as Id<"users"> | null;
    if (!userId) throw new Error("Not authenticated");

    const sandboxRecord = (await ctx.runQuery(internal.sandboxHelpers.getSandbox, {
      sandboxDbId: args.sandboxDbId,
    })) as { sandboxId: string; userId: Id<"users">; status: string } | null;

    if (!sandboxRecord) throw new Error("Sandbox not found");
    if (sandboxRecord.userId !== userId) throw new Error("Not authorized");
    if (sandboxRecord.status !== "running") throw new Error("Sandbox is not running");

    const files = (await ctx.runQuery(internal.agentTeamHelpers.getFiles, {
      sessionId: args.sessionId,
    })) as Array<{ filepath: string; content: string }>;

    const daytona = getDaytona();
    const sandbox = await daytona.get(sandboxRecord.sandboxId);

    // Upload all files
    for (const file of files) {
      const buffer = Buffer.from(file.content, "utf-8");
      await sandbox.fs.uploadFile(buffer, `/workspace/${file.filepath}`);
    }

    return { filesDeployed: files.length };
  },
});

// Stop and delete a sandbox
export const stopSandbox = action({
  args: {
    token: v.string(),
    sandboxDbId: v.id("sandboxes"),
  },
  handler: async (ctx, args): Promise<{ costCents: number }> => {
    const userId = (await ctx.runQuery(internal.customAuthHelpers.getUserIdByToken, {
      token: args.token,
    })) as Id<"users"> | null;
    if (!userId) throw new Error("Not authenticated");

    const sandboxRecord = (await ctx.runQuery(internal.sandboxHelpers.getSandbox, {
      sandboxDbId: args.sandboxDbId,
    })) as { sandboxId: string; userId: Id<"users">; createdAt: number; status: string } | null;

    if (!sandboxRecord) throw new Error("Sandbox not found");
    if (sandboxRecord.userId !== userId) throw new Error("Not authorized");

    const daytona = getDaytona();

    try {
      const sandbox = await daytona.get(sandboxRecord.sandboxId);
      await daytona.delete(sandbox);
    } catch {
      // Sandbox may already be gone
    }

    const elapsedHours = (Date.now() - sandboxRecord.createdAt) / 3600000;
    const costCents = Math.round(elapsedHours * COST_CENTS_PER_HOUR * 100) / 100;

    await ctx.runMutation(internal.sandboxHelpers.markSandboxStopped, {
      sandboxDbId: args.sandboxDbId,
      costCents,
      stoppedAt: Date.now(),
    });

    // Add cost to user total
    await ctx.runMutation(internal.sandboxHelpers.addUserCost, {
      userId,
      costCents,
    });

    return { costCents };
  },
});

// List user sandboxes
export const listSandboxes = action({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const userId = (await ctx.runQuery(internal.customAuthHelpers.getUserIdByToken, {
      token: args.token,
    })) as Id<"users"> | null;
    if (!userId) return [];

    return await ctx.runQuery(internal.sandboxHelpers.listUserSandboxes, { userId });
  },
});
