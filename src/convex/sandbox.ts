"use node";
import { action } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { Id } from "./_generated/dataModel";

// $0.075 per hour = 7.5 cents per hour
const COST_CENTS_PER_HOUR = 7.5;
const DAYTONA_API = "https://app.daytona.io/api";
// Hardcoded fallback - same key used in agentTeam.ts
const DAYTONA_API_KEY_FALLBACK = "dtn_7f36b63fc707555bd843029875fb29caf44e4607c2b3ab29a28c73c737e450b5";

function getApiKey(): string {
  return process.env.DAYTONA_API_KEY || DAYTONA_API_KEY_FALLBACK;
}

function daytonaHeaders(apiKey: string) {
  return {
    "Authorization": `Bearer ${apiKey}`,
    "Content-Type": "application/json",
    "Accept": "application/json",
  };
}

async function daytonaFetch(path: string, options: RequestInit = {}): Promise<unknown> {
  const apiKey = getApiKey();
  const res = await fetch(`${DAYTONA_API}${path}`, {
    ...options,
    headers: { ...daytonaHeaders(apiKey), ...(options.headers as Record<string, string> || {}) },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Daytona API error ${res.status}: ${text.slice(0, 200)}`);
  }
  const text = await res.text();
  if (!text) return {};
  return JSON.parse(text);
}

interface SandboxRecord {
  sandboxId: string;
  userId: Id<"users">;
  createdAt: number;
  status: string;
}

interface DaytonaSandbox {
  id: string;
  state?: string;
}

interface DaytonaExecResponse {
  result?: string;
  exitCode?: number;
}

interface DaytonaPreviewUrl {
  url?: string;
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

    // Create sandbox via REST API (1 vCPU default)
    const sandbox = await daytonaFetch("/sandbox", {
      method: "POST",
      body: JSON.stringify({
        language: "typescript",
        envVars: { NODE_ENV: "development" },
      }),
    }) as DaytonaSandbox;

    const sandboxDbId = await ctx.runMutation(internal.sandboxHelpers.insertSandbox, {
      userId,
      sandboxId: sandbox.id,
      sessionId: args.sessionId,
      label: args.label,
      status: "running",
      createdAt: Date.now(),
    });

    return { sandboxDbId: sandboxDbId as string, sandboxId: sandbox.id };
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
    })) as SandboxRecord | null;

    if (!sandboxRecord) throw new Error("Sandbox not found");
    if (sandboxRecord.userId !== userId) throw new Error("Not authorized");
    if (sandboxRecord.status !== "running") throw new Error("Sandbox is not running");

    // Execute command via toolbox REST API
    const response = await daytonaFetch(`/toolbox/${sandboxRecord.sandboxId}/toolbox/process/execute`, {
      method: "POST",
      body: JSON.stringify({ command: args.command }),
    }) as DaytonaExecResponse;

    const output = response.result ?? "";
    const exitCode = response.exitCode ?? 0;

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

// Get preview URL for a sandbox port (default port 3000)
export const getPreviewUrl = action({
  args: {
    token: v.string(),
    sandboxDbId: v.id("sandboxes"),
    port: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<{ previewUrl: string | null }> => {
    const userId = (await ctx.runQuery(internal.customAuthHelpers.getUserIdByToken, {
      token: args.token,
    })) as Id<"users"> | null;
    if (!userId) throw new Error("Not authenticated");

    const sandboxRecord = (await ctx.runQuery(internal.sandboxHelpers.getSandbox, {
      sandboxDbId: args.sandboxDbId,
    })) as SandboxRecord | null;

    if (!sandboxRecord) throw new Error("Sandbox not found");
    if (sandboxRecord.userId !== userId) throw new Error("Not authorized");

    const port = args.port ?? 3000;
    try {
      const data = await daytonaFetch(`/sandbox/${sandboxRecord.sandboxId}/ports/${port}/preview-url`) as DaytonaPreviewUrl;
      const previewUrl = data.url ?? null;
      if (previewUrl) {
        await ctx.runMutation(internal.sandboxHelpers.updatePreviewUrl, {
          sandboxDbId: args.sandboxDbId,
          previewUrl,
        });
      }
      return { previewUrl };
    } catch {
      return { previewUrl: null };
    }
  },
});

// Auto-deploy project files and start the app
export const autoDeployAndStart = action({
  args: {
    token: v.string(),
    sandboxDbId: v.id("sandboxes"),
    sessionId: v.id("teamSessions"),
  },
  handler: async (ctx, args): Promise<{ previewUrl: string | null; deployedFiles: number }> => {
    const userId = (await ctx.runQuery(internal.customAuthHelpers.getUserIdByToken, {
      token: args.token,
    })) as Id<"users"> | null;
    if (!userId) throw new Error("Not authenticated");

    const sandboxRecord = (await ctx.runQuery(internal.sandboxHelpers.getSandbox, {
      sandboxDbId: args.sandboxDbId,
    })) as SandboxRecord | null;

    if (!sandboxRecord) throw new Error("Sandbox not found");
    if (sandboxRecord.userId !== userId) throw new Error("Not authorized");
    if (sandboxRecord.status !== "running") throw new Error("Sandbox is not running");

    const files = (await ctx.runQuery(internal.agentTeamHelpers.getFiles, {
      sessionId: args.sessionId,
    })) as Array<{ filepath: string; content: string }>;

    const apiKey = getApiKey();

    // Upload all files to /workspace/
    for (const file of files) {
      const targetPath = `/workspace/${file.filepath}`;
      const blob = new Blob([file.content], { type: "application/octet-stream" });
      const formData = new FormData();
      formData.append("file", blob, file.filepath.split("/").pop() || "file");
      try {
        await fetch(
          `${DAYTONA_API}/toolbox/${sandboxRecord.sandboxId}/toolbox/files/upload?path=${encodeURIComponent(targetPath)}`,
          {
            method: "POST",
            headers: { "Authorization": `Bearer ${apiKey}` },
            body: formData,
          }
        );
      } catch { /* skip failed uploads */ }
    }

    // Run npm install and start in background
    try {
      await fetch(`${DAYTONA_API}/toolbox/${sandboxRecord.sandboxId}/toolbox/process/execute`, {
        method: "POST",
        headers: { ...daytonaHeaders(apiKey) },
        body: JSON.stringify({ command: "cd /workspace && npm install 2>&1 | tail -5 && npm start &" }),
      });
    } catch { /* ignore start errors */ }

    // Get preview URL for port 3000
    let previewUrl: string | null = null;
    try {
      const data = await daytonaFetch(`/sandbox/${sandboxRecord.sandboxId}/ports/3000/preview-url`) as DaytonaPreviewUrl;
      previewUrl = data.url ?? null;
      if (previewUrl) {
        await ctx.runMutation(internal.sandboxHelpers.updatePreviewUrl, {
          sandboxDbId: args.sandboxDbId,
          previewUrl,
        });
      }
    } catch { /* preview URL may not be available yet */ }

    return { previewUrl, deployedFiles: files.length };
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
    })) as SandboxRecord | null;

    if (!sandboxRecord) throw new Error("Sandbox not found");
    if (sandboxRecord.userId !== userId) throw new Error("Not authorized");
    if (sandboxRecord.status !== "running") throw new Error("Sandbox is not running");

    const apiKey = getApiKey();
    const blob = new Blob([args.content], { type: "application/octet-stream" });
    const formData = new FormData();
    formData.append("file", blob, args.path.split("/").pop() || "file");

    const res = await fetch(
      `${DAYTONA_API}/toolbox/${sandboxRecord.sandboxId}/toolbox/files/upload?path=${encodeURIComponent(args.path)}`,
      {
        method: "POST",
        headers: { "Authorization": `Bearer ${apiKey}` },
        body: formData,
      }
    );
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`File upload failed ${res.status}: ${text.slice(0, 200)}`);
    }

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
    })) as SandboxRecord | null;

    if (!sandboxRecord) throw new Error("Sandbox not found");
    if (sandboxRecord.userId !== userId) throw new Error("Not authorized");
    if (sandboxRecord.status !== "running") throw new Error("Sandbox is not running");

    const files = (await ctx.runQuery(internal.agentTeamHelpers.getFiles, {
      sessionId: args.sessionId,
    })) as Array<{ filepath: string; content: string }>;

    const apiKey = getApiKey();

    for (const file of files) {
      const targetPath = `/workspace/${file.filepath}`;
      const blob = new Blob([file.content], { type: "application/octet-stream" });
      const formData = new FormData();
      formData.append("file", blob, file.filepath.split("/").pop() || "file");

      await fetch(
        `${DAYTONA_API}/toolbox/${sandboxRecord.sandboxId}/toolbox/files/upload?path=${encodeURIComponent(targetPath)}`,
        {
          method: "POST",
          headers: { "Authorization": `Bearer ${apiKey}` },
          body: formData,
        }
      );
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
    })) as SandboxRecord | null;

    if (!sandboxRecord) throw new Error("Sandbox not found");
    if (sandboxRecord.userId !== userId) throw new Error("Not authorized");

    try {
      await daytonaFetch(`/sandbox/${sandboxRecord.sandboxId}`, { method: "DELETE" });
    } catch { /* Sandbox may already be gone */ }

    const elapsedHours = (Date.now() - sandboxRecord.createdAt) / 3600000;
    const costCents = Math.round(elapsedHours * COST_CENTS_PER_HOUR * 100) / 100;

    await ctx.runMutation(internal.sandboxHelpers.markSandboxStopped, {
      sandboxDbId: args.sandboxDbId,
      costCents,
      stoppedAt: Date.now(),
    });

    await ctx.runMutation(internal.sandboxHelpers.addUserCost, {
      userId,
      costCents,
    });

    return { costCents };
  },
});

interface SandboxRow {
  _id: string;
  sandboxId: string;
  status: string;
  label?: string;
  createdAt: number;
  stoppedAt?: number;
  costCents?: number;
  lastCommand?: string;
  lastOutput?: string;
  sessionId?: string;
  previewUrl?: string;
}

// List user sandboxes
export const listSandboxes = action({
  args: { token: v.string() },
  handler: async (ctx, args): Promise<SandboxRow[]> => {
    const userId = (await ctx.runQuery(internal.customAuthHelpers.getUserIdByToken, {
      token: args.token,
    })) as Id<"users"> | null;
    if (!userId) return [];

    return (await ctx.runQuery(internal.sandboxHelpers.listUserSandboxes, { userId })) as SandboxRow[];
  },
});