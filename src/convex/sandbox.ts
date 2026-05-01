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
    throw new Error(`Daytona API error ${res.status}: ${text.slice(0, 300)}`);
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
// Always checks the live Daytona state (not just DB state).
async function checkAndWakeSandbox(sandboxId: string): Promise<{ running: boolean; state?: string; error?: string }> {
  const apiKey = getApiKey();
  try {
    // Check current status from Daytona directly
    const res = await fetch(`${DAYTONA_API}/sandbox/${sandboxId}`, {
      headers: daytonaHeaders(apiKey),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { running: false, error: `Status check failed: ${res.status} ${text.slice(0, 200)}` };
    }
    const data = await res.json() as DaytonaSandbox;
    const state = (data.state ?? "").toLowerCase();

    if (state === "running" || state === "started") {
      return { running: true, state };
    }

    // Sandbox is not running — attempt to start it
    const startRes = await fetch(`${DAYTONA_API}/sandbox/${sandboxId}/start`, {
      method: "POST",
      headers: daytonaHeaders(apiKey),
    });
    if (!startRes.ok) {
      const startText = await startRes.text().catch(() => "");
      return { running: false, state, error: `Failed to start sandbox: ${startRes.status} ${startText.slice(0, 200)}` };
    }

    // Wait up to 60 seconds for sandbox to become ready
    for (let i = 0; i < 20; i++) {
      await new Promise(r => setTimeout(r, 3000));
      try {
        const pollRes = await fetch(`${DAYTONA_API}/sandbox/${sandboxId}`, {
          headers: daytonaHeaders(apiKey),
        });
        if (pollRes.ok) {
          const pollData = await pollRes.json() as DaytonaSandbox;
          const pollState = (pollData.state ?? "").toLowerCase();
          if (pollState === "running" || pollState === "started") {
            return { running: true, state: pollState };
          }
        }
      } catch { /* keep polling */ }
    }

    return { running: false, state, error: "Sandbox did not become ready within 60 seconds" };
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
      return { output: `[SANDBOX ERROR ${status}: ${text.slice(0, 300)}]`, exitCode: 1, status };
    }
    const data = await res.json() as DaytonaExecResponse;
    return { output: data.result ?? "", exitCode: data.exitCode ?? 0, status };
  };

  // First attempt
  const first = await doExecute();
  // If sandbox is not running (400 or 503), try to wake it
  if ((first.status === 400 && first.output.toLowerCase().includes("not running")) ||
      first.status === 503 || first.status === 502) {
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

  return { output: first.output, exitCode: first.exitCode };
}

// Unified file write: tries multipart upload API first, falls back to base64 shell command
async function writeFileToSandbox(sandboxId: string, apiKey: string, filepath: string, content: string): Promise<{ ok: boolean; method?: string; error?: string }> {
  const absolutePath = `/home/daytona/${filepath}`;

  // Ensure parent directory exists first
  const dir = filepath.includes("/") ? filepath.substring(0, filepath.lastIndexOf("/")) : "";
  if (dir) {
    try {
      await fetch(`${DAYTONA_API}/toolbox/${sandboxId}/toolbox/process/execute`, {
        method: "POST",
        headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ command: `mkdir -p /home/daytona/${dir}` }),
      });
    } catch { /* ignore */ }
  }

  // Method 1: Daytona multipart upload API
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

    // Method 2: base64 shell command fallback (chunked for large files)
    const b64 = Buffer.from(content, "utf8").toString("base64");
    // Split into chunks to avoid shell arg length limits
    const CHUNK_SIZE = 50000;
    if (b64.length <= CHUNK_SIZE) {
      const shellRes = await fetch(`${DAYTONA_API}/toolbox/${sandboxId}/toolbox/process/execute`, {
        method: "POST",
        headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ command: `printf '%s' '${b64}' | base64 -d > ${absolutePath} && echo ok` }),
      });
      if (shellRes.ok) {
        const shellData = await shellRes.json() as DaytonaExecResponse;
        if (shellData.result?.includes("ok")) return { ok: true, method: "shell" };
      }
    } else {
      // Large file: write in chunks
      const chunks = [];
      for (let i = 0; i < b64.length; i += CHUNK_SIZE) {
        chunks.push(b64.slice(i, i + CHUNK_SIZE));
      }
      // Write first chunk
      await fetch(`${DAYTONA_API}/toolbox/${sandboxId}/toolbox/process/execute`, {
        method: "POST",
        headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ command: `printf '%s' '${chunks[0]}' > /tmp/_b64_chunk` }),
      });
      // Append remaining chunks
      for (let i = 1; i < chunks.length; i++) {
        await fetch(`${DAYTONA_API}/toolbox/${sandboxId}/toolbox/process/execute`, {
          method: "POST",
          headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({ command: `printf '%s' '${chunks[i]}' >> /tmp/_b64_chunk` }),
        });
      }
      // Decode and write final file
      const finalRes = await fetch(`${DAYTONA_API}/toolbox/${sandboxId}/toolbox/process/execute`, {
        method: "POST",
        headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ command: `base64 -d /tmp/_b64_chunk > ${absolutePath} && echo ok` }),
      });
      if (finalRes.ok) {
        const finalData = await finalRes.json() as DaytonaExecResponse;
        if (finalData.result?.includes("ok")) return { ok: true, method: "shell-chunked" };
      }
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

    // ALWAYS check live Daytona state and wake if needed (sandbox may auto-sleep)
    const wake = await checkAndWakeSandbox(sandboxRecord.sandboxId);
    if (!wake.running) {
      throw new Error(`Sandbox is not running (state: ${wake.state ?? "unknown"}): ${wake.error ?? "Could not wake sandbox. Please stop and create a new sandbox."}`);
    }
    // Update DB status to match live state
    if (sandboxRecord.status !== "running") {
      await ctx.runMutation(internal.sandboxHelpers.updateSandboxStatus, { sandboxDbId: args.sandboxDbId, status: "running" });
    }

    const files = (await ctx.runQuery(internal.agentTeamHelpers.getFiles, { sessionId: args.sessionId })) as Array<{ filepath: string; content: string }>;
    if (files.length === 0) return { previewUrl: null, deployedFiles: 0, errors: ["No files to deploy"] };

    const apiKey = getApiKey();
    const errors: string[] = [];

    // Deploy all files
    for (const file of files) {
      const result = await writeFileToSandbox(sandboxRecord.sandboxId, apiKey, file.filepath, file.content);
      if (!result.ok && result.error) errors.push(`${file.filepath}: ${result.error}`);
    }

    // Detect project type from file list
    const filePaths = files.map(f => f.filepath);
    const hasPackageJson = filePaths.some(f => f === "package.json" || f.endsWith("/package.json"));
    const hasNextConfig = filePaths.some(f => f.includes("next.config"));
    const hasViteConfig = filePaths.some(f => f.includes("vite.config"));
    const hasDockerCompose = filePaths.some(f => f === "docker-compose.yml" || f === "docker-compose.yaml");
    const hasRequirements = filePaths.some(f => f === "requirements.txt");
    const hasPyproject = filePaths.some(f => f === "pyproject.toml");
    const hasMainPy = filePaths.some(f => f === "main.py" || f === "app.py" || f === "server.py" || f.endsWith("/main.py") || f.endsWith("/app.py"));
    const isPython = hasRequirements || hasPyproject || hasMainPy;

    // Read package.json to find the right start script
    let startCmd = "";
    const pkgFile = files.find(f => f.filepath === "package.json" || f.filepath.endsWith("/package.json"));
    if (pkgFile) {
      try {
        const pkg = JSON.parse(pkgFile.content) as { scripts?: Record<string, string> };
        const scripts = pkg.scripts ?? {};
        if (hasNextConfig && scripts.dev) {
          startCmd = `npm run dev -- --port 3000 --hostname 0.0.0.0`;
        } else if (hasViteConfig && scripts.dev) {
          startCmd = `npm run dev -- --port 3000 --host 0.0.0.0`;
        } else if (scripts.start) {
          startCmd = `PORT=3000 npm start`;
        } else if (scripts.dev) {
          startCmd = `npm run dev`;
        } else if (scripts.serve) {
          startCmd = `npm run serve`;
        }
      } catch { /* ignore parse errors */ }
    }

    // Python project detection
    if (!startCmd && isPython) {
      const mainPyFile = files.find(f => f.filepath === "main.py" || f.filepath.endsWith("/main.py"));
      const appPyFile = files.find(f => f.filepath === "app.py" || f.filepath.endsWith("/app.py"));
      const reqFile = files.find(f => f.filepath === "requirements.txt");
      const hasFastapi = reqFile?.content.toLowerCase().includes("fastapi") || mainPyFile?.content.toLowerCase().includes("fastapi") || appPyFile?.content.toLowerCase().includes("fastapi");
      const hasFlask = reqFile?.content.toLowerCase().includes("flask") || mainPyFile?.content.toLowerCase().includes("flask") || appPyFile?.content.toLowerCase().includes("flask");
      const hasDjango = reqFile?.content.toLowerCase().includes("django");
      const hasUvicorn = reqFile?.content.toLowerCase().includes("uvicorn");

      const installCmd = `pip install -r requirements.txt 2>&1 | tail -5`;
      if (hasFastapi || hasUvicorn) {
        const entryFile = mainPyFile ? "main.py" : appPyFile ? "app.py" : "main.py";
        const moduleName = entryFile.replace(".py", "");
        startCmd = `${installCmd} && uvicorn ${moduleName}:app --host 0.0.0.0 --port 3000 --reload`;
      } else if (hasFlask) {
        const entryFile = appPyFile ? "app.py" : mainPyFile ? "main.py" : "app.py";
        startCmd = `${installCmd} && FLASK_APP=${entryFile} FLASK_RUN_HOST=0.0.0.0 FLASK_RUN_PORT=3000 flask run`;
      } else if (hasDjango) {
        startCmd = `${installCmd} && python manage.py runserver 0.0.0.0:3000`;
      } else {
        const entryFile = mainPyFile ? "main.py" : appPyFile ? "app.py" : "server.py";
        startCmd = `${installCmd} && python ${entryFile}`;
      }
    }

    // Fallback start commands
    if (!startCmd) {
      if (hasPackageJson) {
        startCmd = `PORT=3000 npm start 2>/dev/null || npm run dev 2>/dev/null`;
      } else {
        startCmd = `node index.js 2>/dev/null || node server.js 2>/dev/null || node app.js`;
      }
    }

    // Install Node dependencies if needed
    const nodeInstall = hasPackageJson ? "npm install --legacy-peer-deps 2>&1 | tail -5 && " : "";

    // For docker-compose projects, use docker-compose up
    let launchCmd: string;
    if (hasDockerCompose) {
      launchCmd = `cd /home/daytona && ${nodeInstall}docker-compose up -d 2>&1 | tail -5`;
    } else {
      launchCmd = `cd /home/daytona && ${nodeInstall}nohup ${startCmd} > /tmp/app.log 2>&1 &`;
    }

    // Execute launch command and capture output for diagnostics
    let launchOutput = "";
    try {
      const launchRes = await fetch(`${DAYTONA_API}/toolbox/${sandboxRecord.sandboxId}/toolbox/process/execute`, {
        method: "POST",
        headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ command: launchCmd }),
      });
      if (launchRes.ok) {
        const launchData = await launchRes.json() as DaytonaExecResponse;
        launchOutput = launchData.result ?? "";
        if (launchData.exitCode && launchData.exitCode !== 0) {
          errors.push(`Launch command failed (exit ${launchData.exitCode}): ${launchOutput.slice(0, 300)}`);
        }
      } else {
        const errText = await launchRes.text().catch(() => "");
        errors.push(`Launch command HTTP ${launchRes.status}: ${errText.slice(0, 200)}`);
      }
    } catch (err) {
      errors.push(`Launch exception: ${err instanceof Error ? err.message : String(err)}`);
    }

    // Wait for app to start — check port 3000 (and fallback ports 8000, 8080)
    const portsToCheck = [3000, 8000, 8080, 5000];
    let appPort = 3000;
    let appStarted = false;

    for (let i = 0; i < 12; i++) {
      await new Promise(r => setTimeout(r, 3000));
      for (const port of portsToCheck) {
        try {
          const checkRes = await fetch(`${DAYTONA_API}/toolbox/${sandboxRecord.sandboxId}/toolbox/process/execute`, {
            method: "POST",
            headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
            body: JSON.stringify({ command: `curl -s -o /dev/null -w '%{http_code}' http://localhost:${port}/ 2>/dev/null || echo 'not_ready'` }),
          });
          if (checkRes.ok) {
            const checkData = await checkRes.json() as DaytonaExecResponse;
            const result = checkData.result ?? "";
            if (result.match(/^[23]\d\d/) || result.includes("200") || result.includes("301") || result.includes("302")) {
              appStarted = true;
              appPort = port;
              break;
            }
          }
        } catch { /* keep polling */ }
      }
      if (appStarted) break;
    }

    // Get preview URL for the detected port
    let previewUrl: string | null = null;
    try {
      const data = await daytonaFetch(`/sandbox/${sandboxRecord.sandboxId}/ports/${appPort}/preview-url`) as DaytonaPreviewUrl;
      previewUrl = data.url ?? null;
      if (previewUrl) await ctx.runMutation(internal.sandboxHelpers.updatePreviewUrl, { sandboxDbId: args.sandboxDbId, previewUrl });
    } catch { /* preview URL may not be available yet */ }

    if (!appStarted) {
      // Get app logs for debugging
      try {
        const logRes = await fetch(`${DAYTONA_API}/toolbox/${sandboxRecord.sandboxId}/toolbox/process/execute`, {
          method: "POST",
          headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({ command: "tail -50 /tmp/app.log 2>/dev/null || echo 'No logs available'" }),
        });
        if (logRes.ok) {
          const logData = await logRes.json() as DaytonaExecResponse;
          if (logData.result) errors.push(`App startup logs:\n${logData.result.slice(0, 1000)}`);
        }
      } catch { /* ignore */ }
      if (launchOutput) errors.push(`Launch output: ${launchOutput.slice(0, 300)}`);
    }

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

// Sync files from sandbox filesystem to Convex projectFiles
export const syncSandboxFiles = action({
  args: {
    token: v.string(),
    sandboxDbId: v.id("sandboxes"),
    sessionId: v.id("teamSessions"),
  },
  handler: async (ctx, args): Promise<{ synced: number; errors: string[] }> => {
    const userId = (await ctx.runQuery(internal.customAuthHelpers.getUserIdByToken, { token: args.token })) as Id<"users"> | null;
    if (!userId) throw new Error("Not authenticated");

    const sandboxRecord = (await ctx.runQuery(internal.sandboxHelpers.getSandbox, { sandboxDbId: args.sandboxDbId })) as SandboxRecord | null;
    if (!sandboxRecord) throw new Error("Sandbox not found");
    if (sandboxRecord.userId !== userId) throw new Error("Not authorized");

    const apiKey = getApiKey();
    const errors: string[] = [];
    let synced = 0;

    // Get list of files in /home/daytona (excluding node_modules, .git, etc.)
    const listRes = await fetch(`${DAYTONA_API}/toolbox/${sandboxRecord.sandboxId}/toolbox/process/execute`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ command: `find /home/daytona -type f -not -path '*/node_modules/*' -not -path '*/.git/*' -not -path '*/dist/*' -not -path '*/.next/*' -not -path '*/__pycache__/*' -not -name '*.pyc' -not -name '*.log' 2>/dev/null | head -200` }),
    });

    if (!listRes.ok) return { synced: 0, errors: ["Failed to list files"] };
    const listData = await listRes.json() as DaytonaExecResponse;
    const filePaths = (listData.result ?? "").split("\n").filter(p => p.trim() && p.startsWith("/home/daytona/"));

    // Read each file and upsert to Convex
    for (const absPath of filePaths) {
      const relPath = absPath.replace("/home/daytona/", "");
      if (!relPath) continue;

      try {
        const readRes = await fetch(`${DAYTONA_API}/toolbox/${sandboxRecord.sandboxId}/toolbox/process/execute`, {
          method: "POST",
          headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({ command: `cat "${absPath}" 2>/dev/null | head -c 100000` }),
        });
        if (!readRes.ok) { errors.push(`Failed to read ${relPath}`); continue; }
        const readData = await readRes.json() as DaytonaExecResponse;
        const content = readData.result ?? "";

        await ctx.runMutation(internal.agentTeamHelpers.upsertProjectFile, {
          sessionId: args.sessionId,
          userId,
          filepath: relPath,
          content,
          lastModifiedBy: "sandbox-sync",
        });
        synced++;
      } catch (err) {
        errors.push(`${relPath}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    return { synced, errors };
  },
});

// Run deploy commands sequentially in the sandbox
export const runDeployCommands = action({
  args: {
    token: v.string(),
    sandboxDbId: v.id("sandboxes"),
    commands: v.array(v.string()),
  },
  handler: async (ctx, args): Promise<{ results: Array<{ cmd: string; output: string; exitCode: number }> }> => {
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

    const results: Array<{ cmd: string; output: string; exitCode: number }> = [];
    for (const cmd of args.commands) {
      const { output, exitCode } = await executeCommandWithRetry(sandboxRecord.sandboxId, cmd);
      results.push({ cmd, output, exitCode });
      // Stop on failure
      if (exitCode !== 0) break;
    }

    return { results };
  },
});