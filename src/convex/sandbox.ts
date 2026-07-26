/* eslint-disable @typescript-eslint/ban-ts-comment -- Convex generated api types are self-referential here and exceed TS instantiation depth (TS2589); checked builds require this suppression. */
// @ts-nocheck
"use node";
import { internalAction } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";

const DAYTONA_API = "https://app.daytona.io/api";

// The key lives in the Convex dashboard env, never in source — this repo is public.
function getApiKey(): string {
  const key = process.env.DAYTONA_API_KEY;
  if (!key) throw new Error("DAYTONA_API_KEY is not configured in the Convex dashboard");
  return key;
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

interface DaytonaSandbox {
  id: string;
  state?: string;
}

interface DaytonaExecResponse {
  result?: string;
  exitCode?: number;
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
    // Hard timeout: Daytona's execute endpoint blocks until the command exits,
    // and a command that never exits would otherwise block until the Convex
    // action is killed — leaving branch commands stuck in limbo.
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), 150_000);
    let res: Response;
    try {
      res = await fetch(`${DAYTONA_API}/toolbox/${sandboxId}/toolbox/process/execute`, {
        method: "POST",
        headers: daytonaHeaders(apiKey),
        body: JSON.stringify({ command: wrappedCommand }),
        signal: abort.signal,
      });
    } catch (err) {
      if (abort.signal.aborted) {
        return { output: "[TIMEOUT: command exceeded 150s — background long-running processes or split the work]", exitCode: 124, status: 408 };
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
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

// Web command executor for the NEW code system (codeBranches). Without this,
// an agent that emits <<RUN-CMD>> queues the command and the pipeline pauses
// forever — nothing else runs it. This runs every queued command in a Daytona
// cloud sandbox (the path that works with NO desktop app installed), records
// results, and resumes the pipeline. Fails safe: if Daytona isn't configured
// or a command errors, the command is marked failed and the pipeline still
// resumes, so a build can never hang.
// Commands that never exit on their own (dev servers) get backgrounded so a
// single <<RUN-CMD="npm run dev">> can't block the executor until the action
// deadline kills it (which would leave the branch paused forever).
const BLOCKING_CMD = /\b(npm|yarn|pnpm|bun)\s+(run\s+)?(dev|start|serve|preview)\b|\bvite(\s|$)|\bnext\s+dev\b|\bnodemon\b|\bserve\b/;
function backgroundIfBlocking(command: string): { command: string; backgrounded: boolean } {
  if (!BLOCKING_CMD.test(command)) return { command, backgrounded: false };
  return {
    command: `nohup ${command} > /tmp/thalamus-server.log 2>&1 & sleep 3; echo "[backgrounded — logs: /tmp/thalamus-server.log]"; tail -20 /tmp/thalamus-server.log || true`,
    backgrounded: true,
  };
}

// Hard cap on total commands per branch: an agent stuck re-emitting failing
// commands otherwise livelocks the pipeline with unbounded model+sandbox spend.
const MAX_COMMANDS_PER_BRANCH = 40;

export const executeBranchCommands = internalAction({
  args: { branchId: v.string() },
  handler: async (ctx, args): Promise<void> => {
    // Resume in `finally` — no matter what throws above it, the branch must
    // never be left paused with commands stuck in limbo.
    try {
      // Claiming flips rows pending → running, so a duplicate invocation of
      // this action sees an empty pending set and can't double-charge.
      const pending = await ctx.runMutation(internal.codeCommands.claimPendingCommands, { branchId: args.branchId });
      if (!pending || pending.length === 0) return;

      const totalSoFar = await ctx.runQuery(internal.codeCommands.countCommands, { branchId: args.branchId });
      if (totalSoFar > MAX_COMMANDS_PER_BRANCH) {
        for (const cmd of pending) {
          await ctx.runMutation(internal.codeCommands.recordCommandResult, {
            commandId: cmd._id, status: "failed", exitCode: 1,
            output: `Command budget exhausted (${MAX_COMMANDS_PER_BRANCH} per branch) — finish the task with the results you already have.`,
          });
        }
        return;
      }

      // Ensure a sandbox exists for this branch (created lazily, cached on the branch).
      let sandboxId: string | null = await ctx.runQuery(internal.codeCommands.getBranchSandboxId, { branchId: args.branchId });
      if (!sandboxId) {
        try {
          const sandbox = await daytonaFetch("/sandbox", {
            method: "POST",
            body: JSON.stringify({ language: "typescript", envVars: { NODE_ENV: "development" } }),
          }) as DaytonaSandbox;
          sandboxId = sandbox.id;
          await ctx.runMutation(internal.codeCommands.setBranchSandboxId, { branchId: args.branchId, sandboxId });
        } catch (err) {
          const msg = err instanceof Error ? err.message : "Sandbox unavailable";
          for (const cmd of pending) {
            await ctx.runMutation(internal.codeCommands.recordCommandResult, {
              commandId: cmd._id, status: "failed", output: `Sandbox error: ${msg}`, exitCode: 1,
            });
          }
          return;
        }
      }

      // Seed the sandbox with the branch's generated files BEFORE running any
      // command, so `npm run build` / `tsc` / tests execute against the real
      // code instead of an empty disk — the change that makes verification
      // actually mean something. Incremental (only files changed since the last
      // seed) and best-effort: if seeding fails the commands still run exactly
      // as before, so this can only improve outcomes, never break them.
      try {
        const branch = await ctx.runQuery(internal.codeBranches.getBranchInternal, { branchId: args.branchId });
        const lastSync = branch?.lastSandboxSyncAt ?? 0;
        const files = await ctx.runQuery(internal.codeBranches.getFilesInternal, { branchId: args.branchId });
        const changed = files.filter((f) => (f.lastModifiedAt ?? 0) > lastSync);
        if (changed.length > 0) {
          const apiKey = getApiKey();
          for (const f of changed) {
            await writeFileToSandbox(sandboxId, apiKey, f.filepath, f.content);
          }
          await ctx.runMutation(internal.codeBranches.updateBranchStatus, {
            branchId: args.branchId, lastSandboxSyncAt: Date.now(),
          });
        }
      } catch (err) {
        console.error("Sandbox seed failed (commands run anyway):", err instanceof Error ? err.message : err);
      }

      for (const cmd of pending) {
        try {
          const prepared = backgroundIfBlocking(cmd.command);
          const { output, exitCode } = await executeCommandWithRetry(sandboxId, prepared.command);
          await ctx.runMutation(internal.codeCommands.recordCommandResult, {
            commandId: cmd._id, status: "completed", output: (output ?? "").slice(0, 20000), exitCode,
          });
        } catch (err) {
          const msg = err instanceof Error ? err.message : "Command failed";
          await ctx.runMutation(internal.codeCommands.recordCommandResult, {
            commandId: cmd._id, status: "failed", output: msg.slice(0, 20000), exitCode: 1,
          });
        }
      }
    } finally {
      await ctx.scheduler.runAfter(0, internal.codePipeline.runPipelineAction, { branchId: args.branchId });
    }
  },
});

// Tear down a branch's Daytona sandbox. Called on pipeline completion and
// branch deletion — without this every branch that ever ran a command leaves
// a sandbox billing ~$54/month until someone finds it in the Daytona console.
export const destroyBranchSandbox = internalAction({
  args: { sandboxId: v.string() },
  handler: async (_ctx, args): Promise<void> => {
    try {
      await daytonaFetch(`/sandbox/${args.sandboxId}`, { method: "DELETE" });
    } catch {
      // Best effort — already gone, or Daytona unreachable. Nothing to do.
    }
  },
});
