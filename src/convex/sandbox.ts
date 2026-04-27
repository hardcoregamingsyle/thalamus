"use node";
import { action } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { Id } from "./_generated/dataModel";

// $0.075 per hour = 7.5 cents per hour
const COST_CENTS_PER_HOUR = 7.5;
const DAYTONA_API = "https://app.daytona.io/api";
// Hardcoded API key (primary)
const DAYTONA_API_KEY = "dtn_7f36b63fc707555bd843029875fb29caf44e4607c2b3ab29a28c73c737e450b5";

function getApiKey(): string {
  return process.env.DAYTONA_API_KEY || DAYTONA_API_KEY;
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

// Check sandbox status via Daytona API and wake it if not running.
// Returns true if sandbox is running (or was successfully started), false otherwise.
async function checkAndWakeSandbox(sandboxId: string): Promise<{ running: boolean; error?: string }> {
  const apiKey = getApiKey();
  try {
    // Check current status
    const res = await fetch(`${DAYTONA_API}/sandbox/${sandboxId}`, {
      headers: daytonaHeaders(apiKey),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { running: false, error: `Status check failed: ${res.status} ${text.slice(0, 100)}` };
    }
    const data = await res.json() as DaytonaSandbox;
    const state = (data.state ?? "").toLowerCase();

    if (state === "running" || state === "started") {
      return { running: true };
    }

    // Sandbox is not running — attempt to start it
    const startRes = await fetch(`${DAYTONA_API}/sandbox/${sandboxId}/start`, {
      method: "POST",
      headers: daytonaHeaders(apiKey),
    });
    if (!startRes.ok) {
      const startText = await startRes.text().catch(() => "");
      return { running: false, error: `Failed to start sandbox: ${startRes.status} ${startText.slice(0, 100)}` };
    }

    // Wait up to 30 seconds for sandbox to become ready
    for (let i = 0; i < 10; i++) {
      await new Promise(r => setTimeout(r, 3000));
      try {
        const pollRes = await fetch(`${DAYTONA_API}/sandbox/${sandboxId}`, {
          headers: daytonaHeaders(apiKey),
        });
        if (pollRes.ok) {
          const pollData = await pollRes.json() as DaytonaSandbox;
          const pollState = (pollData.state ?? "").toLowerCase();
          if (pollState === "running" || pollState === "started") {
            return { running: true };
          }
        }
      } catch { /* keep polling */ }
    }

    return { running: false, error: "Sandbox did not become ready within 30 seconds" };
  } catch (err) {
    return { running: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// Execute a command with sandbox wake-up retry logic
async function executeCommandWithRetry(sandboxId: string, command: string): Promise<{ output: string; exitCode: number }> {
  const apiKey = getApiKey();
  const wrappedCommand = command.startsWith("cd ") ? command : `cd /home/daytona && ${command}`;

  const doExecute = async (): Promise<{ output: string; exitCode: number; status: number }> => {
    const res = await fetch(`${DAYTONA_API}/toolbox/${sandboxId}/toolbox/process/execute`, {
      method: "POST",
      headers: daytonaHeaders(apiKey),
      body: JSON.stringify({ command: wrappedCommand }),
    });
    const status = res.status;
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { output: `[SANDBOX ERROR ${status}: ${text.slice(0, 200)}]`, exitCode: 1, status };
    }
    const data = await res.json() as DaytonaExecResponse;
    return { output: data.result ?? "", exitCode: data.exitCode ?? 0, status };
  };

  // First attempt
  const first = await doExecute();
  if (first.status !== 400 || !first.output.includes("not running")) {
    return { output: first.output, exitCode: first.exitCode };
  }

  // 400 "Sandbox is not running" — try to wake it
  const wake = await checkAndWakeSandbox(sandboxId);
  if (!wake.running) {
    return {
      output: `[SANDBOX WAKE FAILED: ${wake.error ?? "unknown error"}. Please restart the sandbox manually.]`,
      exitCode: 1,
    };
  }

  // Retry after wake
  const retry = await doExecute();
  return { output: retry.output, exitCode: retry.exitCode };
}

// Unified file write: tries multipart upload API first, falls back to base64 shell command
async function writeFileToSandbox(sandboxId: string, apiKey: string, filepath: string, content: string): Promise<{ ok: boolean; method?: string; error?: string }> {
  const absolutePath = `/home/daytona/${filepath}`;

  // Method 1: Daytona multipart upload API (files[i].path + files[i].file)
  const boundary = `----FormBoundary${Date.now()}`;
  const contentBytes = Buffer.from(content, "utf8");
  const parts: Buffer[] = [];
  parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="files[0].path"\r\n\r\n${absolutePath}\r\n`));
  const filename = filepath.split("/").pop() || "file";
  parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="files[0].file"; filename="${filename}"\r\nContent-Type: application/octet-stream\r\n\r\n`));
  parts.push(contentBytes);
  parts.push(Buffer.from(`\r\n--${boundary}--\r\n`));
  const body = Buffer.concat(parts);

  try {
    const res = await fetch(`${DAYTONA_API}/toolbox/${sandboxId}/toolbox/files/upload`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": `multipart/form-data; boundary=${boundary}` },
      body,
    });
    if (res.ok) return { ok: true, method: "multipart" };
    const errText = await res.text().catch(() => "");
    const uploadErr = `Upload API ${res.status}: ${errText.slice(0, 100)}`;

    // Method 2: base64 shell command fallback
    const dir = filepath.includes("/") ? filepath.substring(0, filepath.lastIndexOf("/")) : "";
    if (dir) {
      await fetch(`${DAYTONA_API}/toolbox/${sandboxId}/toolbox/process/execute`, {
        method: "POST",
        headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ command: `mkdir -p /home/daytona/${dir}` }),
      }).catch(() => {});
    }
    const b64 = Buffer.from(content, "utf8").toString("base64");
    const shellRes = await fetch(`${DAYTONA_API}/toolbox/${sandboxId}/toolbox/process/execute`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ command: `printf '%s' '${b64}' | base64 -d > ${absolutePath} && echo ok` }),
    });
    if (shellRes.ok) {
      const shellData = await shellRes.json() as DaytonaExecResponse;
      if (shellData.result?.includes("ok")) return { ok: true, method: "shell" };
    }
    return { ok: false, error: `${uploadErr}; shell also failed` };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
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

// Execute a command in a sandbox — with automatic wake-up if sandbox is stopped
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

    // Check and wake sandbox if needed (don't throw if DB says stopped — Daytona may still have it)
    if (sandboxRecord.status !== "running") {
      const wake = await checkAndWakeSandbox(sandboxRecord.sandboxId);
      if (wake.running) {
        // Update DB status to running
        await ctx.runMutation(internal.sandboxHelpers.updateSandboxStatus, {
          sandboxDbId: args.sandboxDbId,
          status: "running",
        });
      } else {
        return {
          output: `[SANDBOX NOT RUNNING: ${wake.error ?? "Sandbox is stopped. Please create a new sandbox."}]`,
          exitCode: 1,
        };
      }
    }

    const { output, exitCode } = await executeCommandWithRetry(sandboxRecord.sandboxId, args.command);

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
  handler: async (ctx, args): Promise<{ previewUrl: string | null; deployedFiles: number; errors: string[] }> => {
    const userId = (await ctx.runQuery(internal.customAuthHelpers.getUserIdByToken, { token: args.token })) as Id<"users"> | null;
    if (!userId) throw new Error("Not authenticated");

    const sandboxRecord = (await ctx.runQuery(internal.sandboxHelpers.getSandbox, { sandboxDbId: args.sandboxDbId })) as SandboxRecord | null;
    if (!sandboxRecord) throw new Error("Sandbox not found");
    if (sandboxRecord.userId !== userId) throw new Error("Not authorized");

    // Wake sandbox if needed
    if (sandboxRecord.status !== "running") {
      const wake = await checkAndWakeSandbox(sandboxRecord.sandboxId);
      if (!wake.running) throw new Error(`Sandbox is not running: ${wake.error}`);
      await ctx.runMutation(internal.sandboxHelpers.updateSandboxStatus, { sandboxDbId: args.sandboxDbId, status: "running" });
    }

    const files = (await ctx.runQuery(internal.agentTeamHelpers.getFiles, { sessionId: args.sessionId })) as Array<{ filepath: string; content: string }>;
    if (files.length === 0) return { previewUrl: null, deployedFiles: 0, errors: ["No files to deploy"] };

    const apiKey = getApiKey();
    const errors: string[] = [];

    for (const file of files) {
      const result = await writeFileToSandbox(sandboxRecord.sandboxId, apiKey, file.filepath, file.content);
      if (!result.ok && result.error) errors.push(`${file.filepath}: ${result.error}`);
    }

    // Run npm install and start in background
    try {
      await fetch(`${DAYTONA_API}/toolbox/${sandboxRecord.sandboxId}/toolbox/process/execute`, {
        method: "POST",
        headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ command: "cd /home/daytona && npm install 2>&1 | tail -5 && (npm start &) 2>&1 | head -3" }),
      });
    } catch { /* ignore */ }

    let previewUrl: string | null = null;
    try {
      const data = await daytonaFetch(`/sandbox/${sandboxRecord.sandboxId}/ports/3000/preview-url`) as DaytonaPreviewUrl;
      previewUrl = data.url ?? null;
      if (previewUrl) await ctx.runMutation(internal.sandboxHelpers.updatePreviewUrl, { sandboxDbId: args.sandboxDbId, previewUrl });
    } catch { /* preview URL may not be available yet */ }

    return { previewUrl, deployedFiles: files.length, errors };
  },
});

// Upload a file to sandbox (aligned with writeFileToSandbox)
export const uploadFile = action({
  args: {
    token: v.string(),
    sandboxDbId: v.id("sandboxes"),
    path: v.string(),
    content: v.string(),
  },
  handler: async (ctx, args): Promise<{ success: boolean; method?: string }> => {
    const userId = (await ctx.runQuery(internal.customAuthHelpers.getUserIdByToken, { token: args.token })) as Id<"users"> | null;
    if (!userId) throw new Error("Not authenticated");

    const sandboxRecord = (await ctx.runQuery(internal.sandboxHelpers.getSandbox, { sandboxDbId: args.sandboxDbId })) as SandboxRecord | null;
    if (!sandboxRecord) throw new Error("Sandbox not found");
    if (sandboxRecord.userId !== userId) throw new Error("Not authorized");
    if (sandboxRecord.status !== "running") throw new Error("Sandbox is not running");

    const apiKey = getApiKey();
    const result = await writeFileToSandbox(sandboxRecord.sandboxId, apiKey, args.path, args.content);
    if (!result.ok) throw new Error(result.error || "File upload failed");
    return { success: true, method: result.method };
  },
});

// Deploy project files from a team session into the sandbox
export const deployProjectFiles = action({
  args: {
    token: v.string(),
    sandboxDbId: v.id("sandboxes"),
    sessionId: v.id("teamSessions"),
  },
  handler: async (ctx, args): Promise<{ filesDeployed: number; errors: string[] }> => {
    const userId = (await ctx.runQuery(internal.customAuthHelpers.getUserIdByToken, { token: args.token })) as Id<"users"> | null;
    if (!userId) throw new Error("Not authenticated");

    const sandboxRecord = (await ctx.runQuery(internal.sandboxHelpers.getSandbox, { sandboxDbId: args.sandboxDbId })) as SandboxRecord | null;
    if (!sandboxRecord) throw new Error("Sandbox not found");
    if (sandboxRecord.userId !== userId) throw new Error("Not authorized");
    if (sandboxRecord.status !== "running") throw new Error("Sandbox is not running");

    const files = (await ctx.runQuery(internal.agentTeamHelpers.getFiles, { sessionId: args.sessionId })) as Array<{ filepath: string; content: string }>;
    const apiKey = getApiKey();
    const errors: string[] = [];

    for (const file of files) {
      const result = await writeFileToSandbox(sandboxRecord.sandboxId, apiKey, file.filepath, file.content);
      if (!result.ok && result.error) errors.push(`${file.filepath}: ${result.error}`);
    }

    return { filesDeployed: files.length, errors };
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

// Test file write - tries both methods and returns diagnostic output as a string
export const testFileWrite = action({
  args: {
    token: v.string(),
    sandboxDbId: v.id("sandboxes"),
  },
  handler: async (ctx, args): Promise<{ success: boolean; output: string }> => {
    const userId = (await ctx.runQuery(internal.customAuthHelpers.getUserIdByToken, { token: args.token })) as Id<"users"> | null;
    if (!userId) throw new Error("Not authenticated");

    const sandboxRecord = (await ctx.runQuery(internal.sandboxHelpers.getSandbox, { sandboxDbId: args.sandboxDbId })) as SandboxRecord | null;
    if (!sandboxRecord) throw new Error("Sandbox not found");
    if (sandboxRecord.userId !== userId) throw new Error("Not authorized");
    if (sandboxRecord.status !== "running") throw new Error("Sandbox is not running");

    const apiKey = getApiKey();
    const sandboxId = sandboxRecord.sandboxId;
    const testContent = '{"name":"test","version":"1.0.0","main":"index.js","scripts":{"start":"node index.js"}}';

    // Try multipart upload API and capture raw response
    const boundary = `----FormBoundaryTest${Date.now()}`;
    const contentBytes = Buffer.from(testContent, "utf8");
    const parts: Buffer[] = [];
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="files[0].path"\r\n\r\n/home/daytona/package.json\r\n`));
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="files[0].file"; filename="package.json"\r\nContent-Type: application/octet-stream\r\n\r\n`));
    parts.push(contentBytes);
    parts.push(Buffer.from(`\r\n--${boundary}--\r\n`));
    const body = Buffer.concat(parts);

    let uploadApiStatus = 0;
    let uploadApiBody = "";
    try {
      const uploadRes = await fetch(`${DAYTONA_API}/toolbox/${sandboxId}/toolbox/files/upload`, {
        method: "POST",
        headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": `multipart/form-data; boundary=${boundary}` },
        body,
      });
      uploadApiStatus = uploadRes.status;
      uploadApiBody = (await uploadRes.text().catch(() => "")).slice(0, 200);
    } catch (e) {
      uploadApiBody = e instanceof Error ? e.message : String(e);
    }

    // Try shell command approach
    const b64 = Buffer.from(testContent, "utf8").toString("base64");
    let shellResult = "";
    try {
      const shellRes = await fetch(`${DAYTONA_API}/toolbox/${sandboxId}/toolbox/process/execute`, {
        method: "POST",
        headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ command: `printf '%s' '${b64}' | base64 -d > /home/daytona/package.json && echo "write_ok" && cat /home/daytona/package.json | head -1` }),
      });
      const shellData = await shellRes.json() as DaytonaExecResponse;
      shellResult = shellData.result?.slice(0, 200) ?? `HTTP ${shellRes.status}`;
    } catch (e) {
      shellResult = e instanceof Error ? e.message : String(e);
    }

    // Verify with ls
    let verifyResult = "";
    try {
      const verifyRes = await fetch(`${DAYTONA_API}/toolbox/${sandboxId}/toolbox/process/execute`, {
        method: "POST",
        headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ command: "ls -la /home/daytona/ && cat /home/daytona/package.json 2>/dev/null | head -2" }),
      });
      const verifyData = await verifyRes.json() as DaytonaExecResponse;
      verifyResult = verifyData.result?.slice(0, 300) ?? "";
    } catch { /* ignore */ }

    const success = uploadApiStatus === 200 || shellResult.includes("write_ok");
    const method = uploadApiStatus === 200 ? "multipart" : shellResult.includes("write_ok") ? "shell" : "none";

    const output = [
      `sandboxId: ${sandboxId}`,
      `uploadAPI: ${uploadApiStatus} - ${uploadApiBody}`,
      `shell: ${shellResult}`,
      `verify: ${verifyResult}`,
      `result: ${method}`,
    ].join("\n");

    return { success, output };
  },
});