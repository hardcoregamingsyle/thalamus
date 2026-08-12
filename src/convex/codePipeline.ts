"use node";
// Code Mode pipeline (the NEW codeProjects/codeBranches system — not TeamPortal).
//
// Execution model: one invocation of runPipelineAction runs exactly ONE agent
// step, persists all progress onto the codeBranches doc, then re-schedules
// itself via scheduler.runAfter(0, ...). This keeps each Convex action well
// under the runtime limit and makes every step resumable — the branch doc is
// the single source of truth, never in-memory state.
//
// Branch fields that drive the state machine:
// - executionPhase: "dispatching" → "planning" → "executing" → "completed"
// - phase:          the agent currently (or next) running within that phase
// - currentTaskIndex: which Planner task the executing pipeline is on
// - round:          monotonically increasing counter, bumped on every agent
//                   hand-off (used for message grouping in the UI)
//
// Pause/resume: when an agent emits <<RUN-CMD>> or <<REQUEST-API-KEY>>, the
// pipeline queues the request, sets status "paused", and returns WITHOUT
// re-scheduling. codeCommands.ts / codeApiKeys.ts re-schedule runPipelineAction
// once the user submits results; the pending-check at the top of the handler
// keeps the pipeline parked if anything is still outstanding.
import { action, internalAction, type ActionCtx } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import {
  callModel,
  parseAgentOutput,
  parsePlannerOutput,
  performSearch,
  performScrape,
  findJsonOpsInternal,
  AGENT_SYSTEM_PROMPTS,
  calcAgentBucksForTier,
  type ModelTier,
} from "./lib/agentCore";
import { mcpCallTool, mcpListTools, decryptAuthHeader } from "./lib/mcpClient";
import { fetchModelScopeModelIds } from "./lib/modelscopeClient";
import { parseMcpCalls, stripMcpBlocks, type ParsedMcpCall } from "./lib/mcpParse";

// MCP loop guard: how many times one agent may be re-run with tool results
// before the pipeline advances anyway (prevents infinite call loops).
const MAX_MCP_ROUNDS = 5;
const MAX_MCP_CALLS_PER_MESSAGE = 5;

/** Resolve the server an {"op":"mcp","server":…} call meant.
 *
 *  Matching used to be exact and case-sensitive, so a call that wrote
 *  "AgentOverflow", "Sketchfab" or "agentoverflow-mcp" — all of which models
 *  produce constantly, because that is how the servers are named in prose —
 *  resolved to nothing and came back as "no connected MCP server". The tool was
 *  attached and healthy; the lookup was the whole failure. Exact wins first,
 *  then a case- and separator-insensitive match, then a prefix match so a
 *  suffixed variant still lands. Anything looser would risk routing a call to
 *  the wrong server, which is worse than not calling it. */
function findMcpServer<T extends { name: string }>(servers: T[], requested: string): T | undefined {
  const exact = servers.find((s) => s.name === requested);
  if (exact) return exact;
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const want = norm(requested);
  if (!want) return undefined;
  return servers.find((s) => norm(s.name) === want)
    ?? servers.find((s) => norm(s.name).startsWith(want) || want.startsWith(norm(s.name)));
}

// A dispatched GitHub Actions run (or a desktop executor that went away) can
// accept a queued command and then never call back — nothing else in the
// codebase times that out, so without this a branch parks "paused" forever
// with zero further messages the moment that happens.
const STALE_COMMAND_MS = 15 * 60 * 1000;

// All known agents in their natural order.
// Researcher is a three-agent team: ResearchPlanner → Researcher (data gatherer) → ReportMaker.
const ALL_PLANNING_AGENTS = ["ResearchPlanner", "Researcher", "ReportMaker", "FactCheck", "Analyser", "Planner"] as const;
const ALL_TASK_AGENTS     = ["ResearchPlanner", "Researcher", "ReportMaker", "FactCheck", "Analyser", "Coder", "Optimiser", "Organizer", "Tester", "Hacker", "Critic"] as const;

// The full fallback pipelines (used when no Dispatcher output exists)
const DEFAULT_PLANNING_PIPELINE = ["ResearchPlanner", "Researcher", "ReportMaker", "FactCheck", "Analyser", "Planner"];
const DEFAULT_TASK_PIPELINE     = ["ResearchPlanner", "Researcher", "ReportMaker", "FactCheck", "Analyser", "Coder", "Optimiser", "Organizer", "Tester", "Hacker", "Critic"];

/** Ensure the research team is always included as a group. */
function expandResearchTeam(agents: string[]): string[] {
  const hasAny = agents.some(a => a === "ResearchPlanner" || a === "Researcher" || a === "ReportMaker");
  if (!hasAny) return agents;
  const set = new Set(agents);
  set.add("ResearchPlanner");
  set.add("Researcher");
  set.add("ReportMaker");
  return [...set];
}

/** Build the actual planning pipeline from the Dispatcher's chosen agent list. */
function buildPlanningPipeline(dispatched: string[]): string[] {
  if (!dispatched || dispatched.length === 0) return DEFAULT_PLANNING_PIPELINE;
  return ALL_PLANNING_AGENTS.filter(a => expandResearchTeam(dispatched).includes(a));
}

/** Build the actual task pipeline from the Dispatcher's chosen agent list.
 *  Coder and Critic are always guaranteed to appear (they were enforced at dispatch time). */
function buildTaskPipeline(dispatched: string[]): string[] {
  if (!dispatched || dispatched.length === 0) return DEFAULT_TASK_PIPELINE;
  return ALL_TASK_AGENTS.filter(a => expandResearchTeam(dispatched).includes(a));
}

/** Parse and validate the Dispatcher's JSON output. Returns null on failure. */
function parseDispatcherOutput(
  text: string,
): { tier: string; agents: string[]; models?: Record<string, string> } | null {
  try {
    // Strip markdown fences if the model wrapped them anyway
    const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();
    const parsed = JSON.parse(cleaned);
    if (!Array.isArray(parsed.agents) || parsed.agents.length === 0) return null;
    const VALID = new Set(["ResearchPlanner","Researcher","ReportMaker","FactCheck","Analyser","Planner","Coder","Optimiser","Organizer","Tester","Hacker","Critic"]);
    const agents = (parsed.agents as string[]).filter(a => VALID.has(a));
    // Always guarantee Coder and Critic
    if (!agents.includes("Coder"))  agents.push("Coder");
    if (!agents.includes("Critic")) agents.push("Critic");

    // Extract per-agent model assignments if the Dispatcher provided them
    let models: Record<string, string> | undefined;
    if (parsed.assignments && Array.isArray(parsed.assignments)) {
      models = {};
      for (const a of parsed.assignments) {
        if (a.agentName && agents.includes(a.agentName) && a.modelId) {
          models[a.agentName] = a.modelId;
        }
      }
      if (Object.keys(models).length === 0) models = undefined;
    }

    return { tier: parsed.tier ?? "medium", agents, models };
  } catch {
    return null;
  }
}

function buildContext(messages: Array<{ agent: string; content: string }>, maxChars = 6000): string {
  const recent = messages.slice(-6);
  let ctx = "";
  for (const m of recent) {
    const line = `[${m.agent}]: ${m.content.slice(0, 2000)}\n\n`;
    if (ctx.length + line.length > maxChars) break;
    ctx += line;
  }
  return ctx;
}

function buildFileContext(files: Array<{ filepath: string; content: string }>, maxChars = 4000): string {
  if (files.length === 0) return "No files yet.";
  let ctx = "## Project Files:\n";
  for (const f of files) {
    const entry = `${f.filepath}:\n\`\`\`\n${f.content.slice(0, 800)}\n\`\`\`\n\n`;
    if (ctx.length + entry.length > maxChars) {
      ctx += `... (${files.length} files, showing ${files.indexOf(f)})\n`;
      break;
    }
    ctx += entry;
  }
  return ctx;
}

// Parse commands from agent output.
// Primary format (JSON ops): {"op":"cmd","command":"npm install"}
// Legacy formats: <<TOOL>> ... <<END.TOOL>>, <<RUN-CMD="...">>, <<RUN-COMMAND="...">>
// The capture accepts any char (newlines included) plus any quote NOT followed
// by `>>`, terminating precisely at the closing `">>`. So a command may contain
// double quotes — `node -e 'console.log("ok")' 2>&1` and the like — or span
// lines. The old [^"]+ died at the first inner quote, silently dropping any
// command with embedded quotes (the exact shape the prompts' own examples use).
function parseCommands(content: string): string[] {
  const commands: string[] = [];

  // Legacy tag format: <<RUN-CMD="...">>
  const legacy = /<<RUN-(?:CMD|COMMAND)="((?:[^"]|"(?!>>))*)">>/g;
  let match;
  while ((match = legacy.exec(content)) !== null) {
    commands.push(match[1]);
  }

  // New unified block format: <<TOOL>> {"type":"cmd","command":"..."} <<END.TOOL>>
  const O = "(?:<<|‹‹|«|‹)";
  const C = "(?:>>|››|»|›)";
  const block = new RegExp(O + "TOOL" + C + "\\s*([\\s\\S]*?)" + O + "END\\.TOOL" + C + "?", "g");
  while ((match = block.exec(content)) !== null) {
    try {
      const parsed = JSON.parse(match[1].trim());
      if (parsed.type === "cmd" && parsed.command) {
        commands.push(parsed.command);
      }
    } catch { /* not valid JSON — skip */ }
  }

  return commands;
}

// Parse API key requests from agent output
function parseApiKeyRequests(content: string): Array<{variableName: string; description: string; howToGet: string}> {
  const requests: Array<{variableName: string; description: string; howToGet: string}> = [];
  const regex = /<<REQUEST-API-KEY\s+name="([^"]+)"\s+description="([^"]+)"\s+howToGet="([^"]+)">>/g;
  let match;
  while ((match = regex.exec(content)) !== null) {
    requests.push({
      variableName: match[1],
      description: match[2],
      howToGet: match[3],
    });
  }
  return requests;
}

// A run that reaches this many saved messages is a runaway, not progress —
// hard-stop it instead of billing forever. Generous so a genuinely large
// multi-task build (each task is a multi-agent sub-pipeline) isn't cut off; a
// true loop is infinite and hits any finite ceiling anyway. (The transcript
// that prompted this was past 200 and climbing.)
// Per-RUN message ceiling, not per agent step — the MCP path writes two
// messages a round and a command pause writes another, so this counts turns
// rather than progress. Raised from 500 because the Planner is told to emit
// 15-25 tasks and each one costs roughly 25 messages, which put a normal large
// build within sight of the old ceiling. Each step is its own action
// invocation, so this costs wall-clock and provider quota and nothing
// structural — no Convex per-invocation limit is anywhere near it.
//
// As of the VM rework this hard cap is REMOVED by request — a complex prompt
// must never be killed at some arbitrary message count. A runaway loop is
// still user-stoppable (stopPipeline) and every step costs real provider
// quota, so the natural break is the user, not a ceiling.

// How many times we'll ask the model to continue an op cut off at the token
// limit before giving up. Kept at 2 (≤3 sequential model calls per step) so the
// loop can't blow the action's time budget.
const MAX_OP_CONTINUATIONS = 2;

// True when a <<CREATEFILE/EDITFILE>> block was opened but never closed — the
// signature of output truncated mid-file. We strip every COMPLETE block first
// (non-greedy to its own <<END.CREATEFILE>>, exactly how parseAgentOutput reads
// them), then check whether an opener is left dangling in the remainder. Naively
// counting marker literals over the whole string false-positives on a file whose
// CONTENT documents the marker syntax; stripping complete blocks first avoids
// that (the inner mention sits inside a stripped block). Both new <<...>> and
// legacy <<<<<...>>>>> delimiters count.
function hasUnclosedFileBlock(content: string): boolean {
  const withoutComplete = content.replace(
    /(?:<<<<<|<<)(?:CREATEFILE|EDITFILE)(?:="[^"]+")?(?:>>>>>|>>)[\s\S]*?(?:<<<<<|<<)END\.CREATEFILE(?:>>>>>|>>)/g,
    "",
  );
  if (/(?:<<<<<|<<)(?:CREATEFILE|EDITFILE)(?:="[^"]+")?(?:>>>>>|>>)/.test(withoutComplete)) return true;
  // JSON op variant: a create-file/edit-file op whose opening exists but whose
  // braces never balance (content cut off mid-JSON). Walk braces from the last
  // opener, skipping strings, so a complete op right before the cut doesn't
  // false-positive.
  const jsonOpen = /"op"\s*:\s*"(?:create-file|edit-file)"/g;
  let lastOpenEnd = -1;
  let m: RegExpExecArray | null;
  while ((m = jsonOpen.exec(withoutComplete)) !== null) lastOpenEnd = m.index + m[0].length;
  if (lastOpenEnd === -1) return false;
  let depth = 0;
  let inStr = false;
  let escaped = false;
  for (let i = lastOpenEnd; i < withoutComplete.length; i++) {
    const ch = withoutComplete[i];
    if (escaped) { escaped = false; continue; }
    if (ch === "\\" && inStr) { escaped = true; continue; }
    if (ch === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (ch === "{") depth++;
    else if (ch === "}") depth--;
  }
  return depth > 0;
}

// True when ANY JSON op (cmd included) is still open at the end of the output.
// A model that runs out of tokens mid-op must be continued, not pruned: a
// dropped trailing {"op":"cmd"...} never gets a result, so the agent re-emits
// the same command next turn — the repeat-forever loop seen on real branches.
// The file-block check above keeps legacy <<CREATEFILE>> truncation covered.
function hasUnclosedJsonOp(content: string): boolean {
  if (hasUnclosedFileBlock(content)) return true;
  const jsonOpen = /"op"\s*:\s*"[a-z-]+"/g;
  let lastOpenEnd = -1;
  let m: RegExpExecArray | null;
  while ((m = jsonOpen.exec(content)) !== null) lastOpenEnd = m.index + m[0].length;
  if (lastOpenEnd === -1) return false;
  let depth = 0;
  let inStr = false;
  let escaped = false;
  for (let i = lastOpenEnd; i < content.length; i++) {
    const ch = content[i];
    if (escaped) { escaped = false; continue; }
    if (ch === "\\" && inStr) { escaped = true; continue; }
    if (ch === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (ch === "{") depth++;
    else if (ch === "}") depth--;
  }
  return depth > 0;
}

// Streaming-aware model call — writes partial output to the branch's streamingContent
// field so the UI can show real-time token output. Falls back to batch callModel if
// streaming is unavailable (Gemini, AgentRouter) or credentials are missing.
// NOTE: "streaming" here is simulated — the full response is fetched first, then
// drip-fed to streamingContent in 300-char chunks. True token streaming from
// Real token streaming proved unreliable inside Convex actions.
async function callModelWithStreaming(
  ctx: { runMutation: ActionCtx["runMutation"]; runQuery: ActionCtx["runQuery"] },
  prompt: string,
  systemPrompt: string,
  branchId: string,
  agentName: string,
  geminiKeys: string[],
  dbCreds: { accessKeyId: string; secretAccessKey: string; region: string } | null,
  agentModelAssignments?: Record<string, string>,
  deadlineMs?: number,
): Promise<{ text: string; inputTokens: number; outputTokens: number; tier: ModelTier }> {
  // If the Dispatcher assigned a specific model for this agent, pass it as an
  // override so callModel uses it directly instead of the hardcoded task-type map.
  // deadlineMs overrides the chain-wide 7-minute budget — the Dispatcher uses
  // this to fail fast: a 3B routing call that can't answer in a minute is a
  // broken provider, not a slow model, and every extra minute is user waiting.
  const overrides: Record<string, unknown> = {};
  if (agentModelAssignments?.[agentName]) overrides.assignedModel = agentModelAssignments[agentName];
  if (deadlineMs) overrides.deadlineMs = deadlineMs;
  const modelArg = Object.keys(overrides).length > 0 ? overrides : undefined;
  const result = await callModel(prompt, systemPrompt, agentName, geminiKeys, dbCreds, ctx, modelArg);

  // Simulated streaming. A Convex action cannot stream tokens out to a client,
  // so the finished response is drip-fed into streamingContent and the UI
  // watches that document — the reply grows instead of landing in one block.
  //
  // This was here, and I deleted it by accident collapsing this function during
  // the run-mode removal. One setStreamingContent with the whole string is
  // functionally "correct" and silently removes the only streaming the product
  // has, which is exactly the kind of regression no gate catches.
  const CHUNK = 300;
  if (!result.text) {
    await ctx.runMutation(internal.codeBranches.setStreamingContent, { branchId, content: "", agentName });
    return result;
  }
  let sent = 0;
  while (sent < result.text.length) {
    sent = Math.min(sent + CHUNK, result.text.length);
    await ctx.runMutation(internal.codeBranches.setStreamingContent, {
      branchId, content: result.text.slice(0, sent), agentName,
    });
    if (sent < result.text.length) await new Promise((r) => setTimeout(r, 20));
  }
  return result;
}

// Main pipeline runner
export const runPipelineAction = internalAction({
  args: {
    branchId: v.string(),
    userPrompt: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<void> => {
    const { branchId } = args;

    // ── Action wall-clock budget ──────────────────────────────────────────────
    // Convex hard-kills an action at 600s with an error NO try/catch here can
    // observe: no message is saved, nothing reschedules, and the branch is left
    // reading "running / <agent> is thinking" forever.
    //
    // One invocation can make several model calls (the agent turn, a file
    // continuation, a search follow-up, the Planner). Each used to receive its
    // OWN 7-minute chain budget, so two slow calls alone could exceed 600s —
    // which is exactly how a stalled provider burst produced the kill. These
    // helpers make the budget a property of the INVOCATION: every model call
    // gets what is actually left, and a call that cannot fit is not started at
    // all — the step reschedules instead, which the pipeline already supports
    // everywhere (state lives on the branch doc, so resuming is free).
    const ACTION_DEADLINE = Date.now() + 450_000; // 7.5 min of the 10-min ceiling
    const RESCHEDULE_FLOOR_MS = 90_000;  // don't start a model call under this
    const PER_CALL_CAP_MS = 240_000;     // no single call may eat the whole budget
    const CALL_TAIL_MS = 30_000;         // reserve for billing/streaming/file ops
    const budgetLeft = () => ACTION_DEADLINE - Date.now();
    const callBudget = () => Math.min(PER_CALL_CAP_MS, Math.max(0, budgetLeft() - CALL_TAIL_MS));
    /** True when the remaining budget is too small to start another model call. */
    const outOfBudget = () => budgetLeft() < RESCHEDULE_FLOOR_MS;
    /** Park the step and let a fresh action pick up from the persisted state. */
    const rescheduleForBudget = async (where: string): Promise<void> => {
      console.warn(`[pipeline] action budget exhausted at ${where}; rescheduling branch ${branchId}`);
      await ctx.runMutation(internal.codeBranches.updateBranchStatus, { branchId, status: "running" });
      await ctx.scheduler.runAfter(0, internal.codePipeline.runPipelineAction, { branchId });
    };

    // Wrapped in the SAME try/catch as the rest of the step (extended to
    // start here) — this setup zone used to run unguarded, so an exception
    // anywhere in it (a bad credential read, a stale branch/project doc)
    // killed the scheduled action with no saved message and no reschedule,
    // leaving the branch silently stuck forever.
    try {
      // Load credentials
      const geminiKeys = await ctx.runQuery(internal.admin.getGeminiKeysInternal, {}) as string[];
      const dbCreds = await ctx.runQuery(internal.admin.getAwsCredentialsInternal, {}) as { accessKeyId: string; secretAccessKey: string; region: string } | null;

      // Check platform budget
      const budgetExhausted = await ctx.runQuery(internal.admin.isPlatformBudgetExhausted, {}) as boolean;
      if (budgetExhausted) {
        await ctx.runMutation(internal.codeBranches.saveMessage, {
          branchId,
          agent: "System",
          content: "⚠️ Platform budget exhausted. Please contact support.",
        });
        await ctx.runMutation(internal.codeBranches.updateBranchStatus, {
          branchId,
          status: "idle",
        });
        return;
      }

      // Load branch
      const branch = await ctx.runQuery(internal.codeBranches.getBranchInternal, { branchId });
      if (!branch) return;

      // User pressed Stop — halt this run WITHOUT rescheduling, and clear the flag
      // so a later start isn't immediately cancelled. (The pipeline writes "idle"
      // between every step, so status alone can't tell a Stop from normal state.)
      if (branch.stopRequested) {
        await ctx.runMutation(internal.codeBranches.updateBranchStatus, {
          branchId, status: "idle", stopRequested: false, currentAgent: undefined,
        });
        return;
      }

      // Resolve the branch owner so every model call bills the right account.
      const project = await ctx.runQuery(internal.codeProjects.getProjectInternal, { projectId: branch.projectId });
      const ownerUserId = project?.userId ?? null;

      // The owner's enabled MCP servers — agents may call their tools. Unified
      // shape over user-connected servers (encrypted auth header in the DB) and
      // the built-in AgentOverflow server (plaintext key from the deployment env).
      interface PipelineMcpServer {
        name: string;
        url: string;
        encryptedAuth?: string;
        plainAuth?: string;
        toolsJson?: string;
      }
      const userServers = ownerUserId
        ? await ctx.runQuery(internal.mcpServers.getEnabledServersInternal, { userId: ownerUserId })
        : [];
      const mcpServers: PipelineMcpServer[] = userServers.map((s: Doc<"mcpServers">) => ({
        name: s.name, url: s.url, encryptedAuth: s.authHeader, toolsJson: s.toolsJson,
      }));

      // Built-in: AgentOverflow rides this same deployment (/ao/mcp), so every
      // pipeline gets its corpus tools out of the box — no config required. With
      // AO_MCP_API_KEY set the run uses that key (unlimited/gold if it's an admin
      // key); without one it connects keyless (anonymous tier: capped per IP,
      // gold hidden). Either way the agents can search before burning tokens. A
      // user-connected server named "agentoverflow" still wins.
      if (!mcpServers.some((s) => s.name === "agentoverflow")) {
        const aoKey = (process.env.AO_MCP_API_KEY ?? "").trim();
        const aoUrl = (process.env.AO_MCP_URL ?? "").trim() ||
          (process.env.CONVEX_SITE_URL ? `${process.env.CONVEX_SITE_URL}/ao/mcp` : "");
        if (aoUrl) {
          mcpServers.unshift({
            name: "agentoverflow",
            url: aoUrl,
            ...(aoKey ? { plainAuth: `Authorization: Bearer ${aoKey}` } : {}),
            toolsJson: JSON.stringify([
              { name: "search", description: "Search AgentOverflow's corpus of agent-written solutions BEFORE burning tokens rediscovering a known fix. Args: {\"query\": \"...\", \"tags\": [\"...\"]?, \"top_k\": 5?}" },
              { name: "answer", description: "Get a synthesized answer with sources from the corpus. Args: {\"query\": \"...\", \"tags\": [\"...\"]?}" },
              { name: "submit_learning", description: "Write up a hard-won solution so other agents can find it later. Args: {\"title\": \"...\", \"problem\": \"...\", \"solution\": \"...\", \"tags\": [\"...\"]?}" },
            ]),
          });
        }
      }

      // Built-in: Sketchfab 3D-model catalogue — attached to EVERY run alongside
      // AgentOverflow. Both MCPs are always available; the agent decides when (if
      // ever) to call them — nothing here gates or auto-fires them. Search + model
      // lookups are public; downloads use the deployment's SKETCHFAB_API_TOKEN when
      // set. A user server named "sketchfab" still wins.
      if (!mcpServers.some((s) => s.name === "sketchfab")) {
        const sfUrl = (process.env.SKETCHFAB_MCP_URL ?? "").trim() ||
          (process.env.CONVEX_SITE_URL ? `${process.env.CONVEX_SITE_URL}/sketchfab/mcp` : "");
        if (sfUrl) {
          mcpServers.unshift({
            name: "sketchfab",
            url: sfUrl,
            toolsJson: JSON.stringify([
              { name: "search_models", description: "Find 3D models for a game/3D scene. Check the license (prefer CC0/CC-BY). Args: {\"query\": \"...\", \"downloadable\": true?, \"limit\": 8?, \"tags\": [\"...\"]?}" },
              { name: "model_info", description: "Full details + license for one model. Args: {\"uid\": \"...\"}" },
              { name: "download_model", description: "Temporary glTF/GLB/USDZ download URLs for a downloadable model. Args: {\"uid\": \"...\"}" },
            ]),
          });
        }
      }

      // Compact tool inventory for the agent prompt (only when servers exist).
      let mcpToolSection = "";
      if (mcpServers.length > 0) {
        const lines: string[] = [];
        for (const s of mcpServers) {
          let tools: Array<{ name: string; description?: string }> = [];
          try {
            const parsed = JSON.parse(s.toolsJson ?? "[]");
            if (Array.isArray(parsed)) tools = parsed;
          } catch { /* stale/error cache — list the server without tools */ }
          // 160 chars keeps the inventory compact without truncating away the
          // "Args: {...}" hints — an agent that has to guess arg names fails
          // its first call and burns an MCP round learning nothing.
          const toolList = tools.slice(0, 10)
            .map(t => t.description ? `${t.name} (${t.description.slice(0, 160)})` : t.name)
            .join(", ");
          lines.push(`- server "${s.name}": ${toolList || "tools unknown — call at your own risk"}`);
        }
        // AgentOverflow is why MCP is wired in at all: agents should hit the
        // corpus before rediscovering known fixes, and (keyed runs only — the
        // server rejects keyless submissions) pay it back with learnings.
        const aoServer = mcpServers.find((s) => s.name === "agentoverflow");
        const aoKeyed = !!(aoServer && (aoServer.plainAuth || aoServer.encryptedAuth));
        const aoGuidance = aoServer
          ? [
              `Before solving a hard problem, debugging a failing command, or researching a library quirk, call agentoverflow's "search" first — another agent has likely already hit it, and one search is cheaper than rediscovery.`,
              ...(aoKeyed
                ? [`When you crack a problem that took real effort (a failing command you fixed, a non-obvious bug, a gotcha that cost you a retry), call agentoverflow's "submit_learning" with a clear title/problem/solution so the next agent skips the pain.`]
                : []),
            ]
          : [];
        // When the 3D catalogue is attached (gamedev tasks), point agents at it for
        // assets instead of stubbing placeholder geometry or asking the user.
        const sketchfabGuidance = mcpServers.some((s) => s.name === "sketchfab")
          ? [`Need a 3D asset (character, prop, environment)? Call sketchfab's "search_models" (downloadable:true), check the license, then "download_model" for a glTF/GLB URL — don't hand-roll placeholder meshes or block on the user for models.`]
          : [];
        mcpToolSection = [
          `## MCP Tools`,
          `You can call external tools on the user's connected MCP servers. Emit a single-line JSON op:`,
          `{"op":"mcp","server":"serverName","tool":"toolName","args":{"argName":"value"}}`,
          `Results will be returned to you before you continue. Available servers:`,
          ...lines,
          ...aoGuidance,
          ...sketchfabGuidance,
        ].join("\n");
      }

      // Charge the owner's AgentBucks + record platform spend for one model call.
      // Centralized so no call site runs for free — the old pipeline never billed
      // at all (a full billing bypass and a blind spot for the budget guard).
      const bill = async (label: string, r: { tier: ModelTier; inputTokens: number; outputTokens: number }) => {
        if (ownerUserId) {
          const ab = calcAgentBucksForTier(r.tier, r.inputTokens, r.outputTokens);
          await ctx.runMutation(internal.credits.deductAgentBucks, { userId: ownerUserId, agentBucksToDeduct: ab });
        }
        await ctx.runMutation(internal.admin.deductPlatformCost, {
          // The tier as returned, unprefixed — pricing looks this up, and
          // `${label}-${tier}` could never match a key in the table.
          modelName: r.tier, inputTokens: r.inputTokens, outputTokens: r.outputTokens,
        });
      };

      // Check if paused for commands
      // (These gates also make re-scheduling idempotent: a spurious extra
      // invocation while the user hasn't answered simply re-parks the branch.)
      const pendingCommands = await ctx.runQuery(internal.codeCommands.getPendingCommands, { branchId }) as Doc<"codeCommands">[];
      if (pendingCommands.length > 0) {
        const now = Date.now();
        const stale = pendingCommands.filter((c) => now - c.createdAt > STALE_COMMAND_MS);
        if (stale.length > 0) {
          for (const c of stale) {
            await ctx.runMutation(internal.codeCommands.recordCommandResult, {
              commandId: c._id,
              status: "failed",
              exitCode: 1,
              output: "Command timed out waiting for a result — the runner may have failed to start or never called back.",
            });
          }
          await ctx.runMutation(internal.codeBranches.saveMessage, {
            branchId,
            agent: "System",
            content: `⚠️ ${stale.length} command${stale.length > 1 ? "s" : ""} timed out waiting for a result.`,
          });
        }
        if (stale.length < pendingCommands.length) {
          // At least one command is still within the timeout window — keep waiting.
          await ctx.runMutation(internal.codeBranches.updateBranchStatus, {
            branchId,
            status: "paused",
          });
          return;
        }
        // Every pending command was stale and just got failed above — fall
        // through instead of re-parking, so the pipeline actually continues.
      }

      // Check if paused for API keys
      const pendingKeyRequests = await ctx.runQuery(internal.codeApiKeys.getPendingRequests, { branchId });
      if (pendingKeyRequests.length > 0) {
        // Still waiting for API keys
        await ctx.runMutation(internal.codeBranches.updateBranchStatus, {
          branchId,
          status: "paused",
        });
        return;
      }

      // Recover the original user request from the first User message in history
      // so all agents always have the full goal even after many pipeline rounds.
      const allMessages = await ctx.runQuery(internal.codeBranches.getMessagesInternal, { branchId }) as Doc<"codeMessages">[];
      const firstUserMessage = allMessages.find((m) => m.agent === "User");
      const task = args.userPrompt || firstUserMessage?.content || branch.description || "Continue working on the project";
      const currentPhase = branch.phase ?? "Dispatcher";
      let round = branch.round ?? 0;
      let totalMessages = branch.totalMessages ?? 0;

      const executionPhase = branch.executionPhase ?? "dispatching";
      const currentTaskIndex = branch.currentTaskIndex ?? 0;

      // Parse the previously saved dispatched-agent list and model assignments
      // (both set by the Dispatcher phase).
      let dispatchedAgents: string[] = [];
      const agentModelAssignments: Record<string, string> = {};
      try {
        if (branch.dispatchedAgentsJson) {
          dispatchedAgents = JSON.parse(branch.dispatchedAgentsJson);
        }
        if (branch.dispatchedModelsJson) {
          const parsed = JSON.parse(branch.dispatchedModelsJson);
          if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
            Object.assign(agentModelAssignments, parsed);
          }
        }
      } catch { /* ignored */ }

      // Mark as running
      await ctx.runMutation(internal.codeBranches.updateBranchStatus, {
        branchId,
        status: "running",
        currentAgent: currentPhase,
        phase: currentPhase,
        round,
        totalMessages,
      });

      // allMessages already loaded above for task recovery
      const messages = allMessages;
      const files = await ctx.runQuery(internal.codeBranches.getFilesInternal, { branchId }) as Doc<"codeFiles">[];

      const context = buildContext(messages);
      const fileContext = buildFileContext(files);

      // Results of shell commands run since the last saved agent message — i.e.
      // exactly the commands this resume is reacting to. Scoping by timestamp
      // keeps later agents/rounds from acting on stale outputs (old test runs).
      const lastMessageAt = messages.length > 0 ? Math.max(...messages.map((m) => m.createdAt)) : 0;
      const commandResults = await ctx.runQuery(internal.codeCommands.getRecentCommandResults, { branchId, sinceMs: lastMessageAt }) as Array<{ command: string; output: string; exitCode: number; status: string }>;
      const commandContext = commandResults.length > 0
        ? "## Recent Command Results\n" + commandResults
            // Fenced + sentinel-neutralized: raw output must read as data, not
            // as pipeline markup the model might mistake for instructions.
            .map((c) => `$ ${c.command}\n[${c.status}, exit ${c.exitCode}]\n\`\`\`\n${c.output.slice(0, 3000).split("<<").join("‹‹").split(">>").join("››")}\n\`\`\``)
            .join("\n\n")
        : "";

      // Agents never know what day it is — a model that guesses "2022" for a
      // test fixture written today is guessing from training data. Pin the
      // date into every prompt build below so timelines, copyright years, and
      // version expectations come from the clock, not the model's memory.
      const currentDateLine = `## Current Date\n${new Date().toISOString().slice(0, 10)} (UTC). Today IS this date — use it for timelines, copyrights, and test fixtures.`;

      // A build/deploy attempt that FAILED is the single most important fact
      // in the room, and the agents were free to ignore it: nothing bound the
      // Critic to an unresolved failure, so it could review "logically" and
      // pass a project whose build was broken. When a recent message carries a
      // failure signature, it becomes binding context — the Coder is ordered
      // to fix the exact error and the Critic is forbidden from passing over
      // it. Silence otherwise: no nagging on healthy branches.
      const recentFailure = (() => {
        for (const m of messages.slice(-3)) {
          if (m.content.length > 40 && /(Failed:|build command exited|npm error|ERESOLVE|error occurred while running|Build failed|build failed)/i.test(m.content)) {
            return m.content;
          }
        }
        return null;
      })();
      const buildFailureBlock = recentFailure
        ? `## A BUILD/DEPLOY ATTEMPT FAILED\n${recentFailure.slice(0, 1500)}\nThis failure is UNRESOLVED. Fix the exact errors shown — do not add new features or rewrite working code while the build is broken.`
        : "";
      // The Critic's pass gate: an open build failure is the one condition
      // that outranks its judgement. It is told to hold security-fail until
      // the Coder's changes demonstrably clear the reported error.
      const buildGateBlock = buildFailureBlock
        ? `## Mandatory Gate\nA build/deploy attempt failed (failure shown above). You MUST output {"op":"security-fail"} while that failure is unresolved. Passing a project whose build is broken is a failure of this review.`
        : "";

      // MCP calls are agent-decided, never system-fired: the pipeline used to
      // auto-search AgentOverflow whenever a command failed and inject the hits.
      // That's now the agent's call — both MCP servers are attached to every run
      // and the prompt guidance tells agents to search the corpus on a failing
      // command themselves, so nothing here reaches out to an MCP on their behalf.

      // ── Dispatcher phase ──────────────────────────────────────────────────
      // Runs at the start AND between every task to decide which agents are
      // needed for the current subtask (agents are re-evaluated per-task).
      if (executionPhase === "dispatching" || currentPhase === "Dispatcher") {
        await ctx.runMutation(internal.codeBranches.updateBranchStatus, {
          branchId,
          status: "running",
          currentAgent: "Dispatcher",
          phase: "Dispatcher",
        });

        // Build subtask context so the Dispatcher can make a per-task decision
        let subtaskContext = "";
        let plannerTasks: Array<{ title: string; description: string; dependencies?: string[] }> = [];
        try { plannerTasks = JSON.parse(branch.plannerTasksJson || "[]"); } catch { /* ignore */ }
        if (plannerTasks.length > 0 && currentTaskIndex >= 0 && currentTaskIndex < plannerTasks.length) {
          const ct = plannerTasks[currentTaskIndex];
          const completed = plannerTasks.slice(0, currentTaskIndex);
          subtaskContext = `\n## Overall Plan (${plannerTasks.length} tasks)\n${plannerTasks.map((t, i) => `${i < currentTaskIndex ? "✓" : (i === currentTaskIndex ? "→" : "○")} Task ${i + 1}: ${t.title}`).join("\n")}\n\n## Current Task (${currentTaskIndex + 1}/${plannerTasks.length}): ${ct.title}\n${ct.description}\n\n### Already completed (${completed.length} done)\n${completed.map((t, i) => `${i + 1}. ${t.title}`).join("\n")}`;
        }

        // Live model menu for the Dispatcher's per-agent assignments. Fetched
        // from ModelScope's /v1/models at dispatch time (union of both hosts,
        // cached 10 min, catalog fallback on failure) so the assignable set
        // auto-adds and auto-drops models as ModelScope's offering changes —
        // no code edit when a new model ships. See modelscopeClient.ts.
        const liveModelIds = await fetchModelScopeModelIds();
        const modelMenu = liveModelIds.length > 0
          ? `\n\n## Live model menu (assign from these exact ids)\n${liveModelIds.map(id => `- ${id}`).join("\n")}`
          : "";

        const dispatchPrompt = `## Project Goal\n${task}${subtaskContext}\n\n## Existing project files\n${files.length > 0 ? files.map(f => `- ${f.filepath}`).join("\n") : "None (greenfield project)"}
\n## Previously dispatched agents\n${dispatchedAgents.length > 0 ? dispatchedAgents.join(", ") : "None yet (first dispatch)"}${modelMenu}\n\n${currentDateLine}`;
        const dispatchResult = await callModelWithStreaming(
          ctx, dispatchPrompt, AGENT_SYSTEM_PROMPTS["Dispatcher"] ?? "",
          branchId, "Dispatcher", geminiKeys, dbCreds, undefined, 60_000,
        );
        await bill("dispatcher", dispatchResult);
        await ctx.runMutation(internal.codeBranches.clearStreamingContent, { branchId });

        const dispatched = parseDispatcherOutput(dispatchResult.text);
        const agents = dispatched?.agents ?? ["Analyser", "Planner", "Coder", "Tester", "Critic"];
        const tier = dispatched?.tier ?? "medium";
        const modelAssignments = dispatched?.models;

        // Persist so every subsequent pipeline invocation can read the agent list
        // and per-agent model assignments.
        await ctx.runMutation(internal.codeBranches.setDispatchedAgents, {
          branchId,
          agentsJson: JSON.stringify(agents),
        });
        if (modelAssignments) {
          await ctx.runMutation(internal.codeBranches.setDispatchedModels, {
            branchId,
            modelsJson: JSON.stringify(modelAssignments),
          });
        }
        dispatchedAgents = agents;
        if (modelAssignments) {
          for (const [agent, model] of Object.entries(modelAssignments)) {
            agentModelAssignments[agent] = model;
          }
        }

        // Post a visible message so the user can see the routing decision.
        const routeLine = agents.join(" → ");
        totalMessages++;
        await ctx.runMutation(internal.codeBranches.saveMessage, {
          branchId,
          agent: "Dispatcher",
          content: `**Task complexity: ${tier}**\nRunning agents: ${routeLine}`,
          round,
          messageIndex: totalMessages,
        });

        // Decide where to go next
        const planningAgents = buildPlanningPipeline(agents);
        if (planningAgents.length > 0) {
          // At least one planning agent was selected — run the planning phase
          const firstPlanningAgent = planningAgents[0];
          round++;
          await ctx.runMutation(internal.codeBranches.updateBranchStatus, {
            branchId,
            status: "idle",
            currentAgent: firstPlanningAgent,
            phase: firstPlanningAgent,
            executionPhase: "planning",
            round,
            totalMessages,
          });
          await ctx.scheduler.runAfter(0, internal.codePipeline.runPipelineAction, { branchId });
          return;
        } else {
          // No planning agents (trivial/simple task) — go straight to execution
          // with a single synthetic task so the Coder has a well-defined prompt.
          const syntheticTask = JSON.stringify([{ title: task.slice(0, 120), description: task }]);
          await ctx.runMutation(internal.codeBranches.updatePlannerTasks, {
            branchId,
            plannerTasksJson: syntheticTask,
          });
          const taskAgents = buildTaskPipeline(agents);
          const firstTaskAgent = taskAgents[0] ?? "Coder";
          round++;
          await ctx.runMutation(internal.codeBranches.updateBranchStatus, {
            branchId,
            status: "idle",
            currentAgent: firstTaskAgent,
            phase: firstTaskAgent,
            executionPhase: "executing",
            round,
            totalMessages,
            mcpRoundCount: 0,
          });
          await ctx.scheduler.runAfter(0, internal.codePipeline.runPipelineAction, { branchId });
          return;
        }
      }

      // ── Normal pipeline phases ────────────────────────────────────────────
      // Determine which pipeline list applies for the current phase.
      const isPlanning = executionPhase === "planning";
      const currentPipeline = isPlanning
        ? buildPlanningPipeline(dispatchedAgents)
        : buildTaskPipeline(dispatchedAgents);
      const phaseIndex = currentPipeline.indexOf(currentPhase);

      // Phase not in the dispatched pipeline (e.g. Dispatcher dropped it, or a
      // stale phase from a previous run) — treat as done rather than erroring.
      if (phaseIndex === -1) {
        totalMessages++;
        await ctx.runMutation(internal.codeBranches.saveMessage, {
          branchId,
          agent: "System",
          content: `Pipeline stopped: "${currentPhase}" is no longer part of the current plan (a stale phase, or the Dispatcher dropped it on re-evaluation). Send another message to continue.`,
          round,
          messageIndex: totalMessages,
        });
        await ctx.runMutation(internal.codeBranches.updateBranchStatus, {
          branchId,
          status: "completed",
          executionPhase: "completed",
          totalMessages,
        });
        return;
      }

      // Run the current agent
      let agentOutput = "";
      const agentName = currentPhase;
      // Tasks parsed from the Planner this run (the stale `branch` object loaded
      // at the top does NOT reflect tasks the Planner just saved — use this).
      let parsedPlannerTasks: Array<{ title: string; description: string }> = [];

      const systemPrompt = currentPhase === "Planner"
        ? (AGENT_SYSTEM_PROMPTS["Planner"] ?? "")
        : (AGENT_SYSTEM_PROMPTS[currentPhase] ?? `You are the ${currentPhase} agent.`);

      if (currentPhase === "Planner") {
        if (outOfBudget()) { await rescheduleForBudget("Planner"); return; }
        const prompt = `## Task\n${task}\n\n## Context\n${context}\n\n## Current Files\n${fileContext}`;
        const result = await callModelWithStreaming(ctx, prompt, systemPrompt, branchId, "Planner", geminiKeys, dbCreds, agentModelAssignments, callBudget());
        agentOutput = result.text;
        await bill("planner", result);
        await ctx.runMutation(internal.codeBranches.clearStreamingContent, { branchId });

        const plannerOutput = parsePlannerOutput(agentOutput);
        if (plannerOutput && plannerOutput.tasks.length > 0) {
          parsedPlannerTasks = plannerOutput.tasks;
          await ctx.runMutation(internal.codeBranches.updatePlannerTasks, {
            branchId,
            plannerTasksJson: JSON.stringify(plannerOutput.tasks),
          });
        }
      } else {
        // Default prompt for planning phase and non-Coder agents in execution
        // phase. mcpToolSection is included here too — the planning-phase
        // Researcher is the natural "search AgentOverflow first" agent, and
        // without the section it never learns the tools exist.
        // The Critic is the only agent that can hold a task open indefinitely,
        // so it is the only one that needs to know how long it has been doing
        // it. No cap is enforced anywhere — this block is the whole mechanism,
        // and it deliberately states the count without stating a limit, because
        // naming a limit is what turns "use your judgement" back into "wait for
        // the counter". Escalates in tone but never in authority: passing or
        // failing stays the Critic's call at every attempt.
        const criticAttempts = branch.criticRetryCount ?? 0;
        const criticJudgementBlock =
          currentPhase === "Critic" && criticAttempts > 0
            ? [
                `## Your Standing on This Task`,
                `You have already rejected this task ${criticAttempts} time${criticAttempts === 1 ? "" : "s"}, and the Coder has reworked it after each rejection.`,
                `Nothing forces this task forward and nothing cuts you off — it advances only when you output {"op":"security-pass"}. That makes the call yours, and holding a task open has a real cost: every rejection re-runs the whole agent chain on the user's quota.`,
                `Re-read what is actually left. Output {"op":"security-pass"} — and say plainly in your review what remains and why you accepted it — when the remaining issues are cosmetic, stylistic, or nitpicks; belong to a different task, a later task, or the user's own environment; are speculative rather than reproducible; or have survived repeated genuine attempts to fix them, which means further rounds are not going to land it.`,
                `Keep outputting {"op":"security-fail"} only while something is genuinely blocking: the app would not start, a core feature of THIS task is missing or broken, an import or config points at a file that does not exist, or a placeholder/TODO/stub is still standing in for real work.`,
                `Do not repeat a rejection the Coder has already tried and failed to satisfy without adding something new and concrete it can act on.`,
              ].join("\n")
            : "";
        let prompt = [`## Project Goal\n${task}`, currentDateLine, buildFailureBlock, `## Current Files\n${fileContext}`, commandContext, mcpToolSection, criticJudgementBlock, buildGateBlock, `## Agent History\n${context}`].filter(Boolean).join("\n\n");

        if (executionPhase === "executing") {
          let plannerTasks: Array<{ title: string; description: string; dependencies?: string[] }> = [];
          try { plannerTasks = JSON.parse(branch.plannerTasksJson || "[]"); } catch { /* ignore */ }

          const currentTask = plannerTasks[currentTaskIndex];
          if (currentTask) {
            // Build a compact file inventory (just paths, no content) so the agent
            // knows what already exists before deciding to create vs. edit.
            const fileInventory = files.length > 0
              ? `## Existing Files (${files.length} total)\n${files.map(f => `- ${f.filepath}`).join("\n")}`
              : "## Existing Files\nNone yet.";

            // Pull recent Critic/Tester feedback from context so Coder knows what to fix
            const recentFeedback = messages
              .filter((m) => ["Critic", "Tester", "Hacker"].includes(m.agent))
              .slice(-3)
              .map((m) => `[${m.agent}]: ${m.content.slice(0, 500)}`)
              .join("\n\n");

            // Completed tasks context
            const completedTasks = plannerTasks
              .slice(0, currentTaskIndex)
              .map((t, i) => `✓ Task ${i + 1}: ${t.title}`)
              .join("\n");

            // Executor gating: when the cloud executor is definitively
            // blocked (e.g. GitHub token missing the `workflow` scope), agents
            // must NOT be told they can emit {"op":"cmd"} — every command they
            // queue will fail on dispatch, they wait forever for output, and
            // burn rounds hallucinating file state. Replace the cmd op section
            // with an explicit unavailability notice and keep the other ops
            // (generate-image, request-api-key) intact so productive work
            // against the file store can still happen.
            const blockedReason = branch.executorBlockedReason;
            const toolUsageBlock = blockedReason
              ? `## Command Execution UNAVAILABLE\n${blockedReason}\nDo NOT emit {"op":"cmd"} ops — they cannot run. Work from the file contents shown above; write files with raw content blocks instead. The user must reconnect GitHub from this branch's Git Sync tab to enable commands.\n\n## Tool Usage\nEmit a single-line JSON object to run a tool:\n{"op":"generate-image","prompt":"a futuristic cityscape","width":1024,"height":768,"model":"flux"}\n\nRequest API keys:\n{"op":"request-api-key","name":"VAR","description":"...","howToGet":"..."}\n\nFile writes — RAW CONTENT BLOCKS, no JSON, no escaping (a JSON "content" field is rejected whenever the file contains quotes):\n<<CREATEFILE="index.html">>\n<!DOCTYPE html>\n...paste the ENTIRE file verbatim between the markers...\n</html>\n<<END.CREATEFILE>>`
              : `## Tool Usage\nEmit a single-line JSON object to run a tool:\n{"op":"cmd","command":"npm install 2>&1"}\n{"op":"cmd","command":"cat package.json"}\n{"op":"cmd","command":"ls -la src/"}\n{"op":"generate-image","prompt":"a futuristic cityscape","width":1024,"height":768,"model":"flux"}\n\nRequest API keys:\n{"op":"request-api-key","name":"VAR","description":"...","howToGet":"..."}\n\nFile writes — RAW CONTENT BLOCKS, no JSON, no escaping (a JSON "content" field is rejected whenever the file contains quotes):\n<<CREATEFILE="index.html">>\n<!DOCTYPE html>\n...paste the ENTIRE file verbatim between the markers...\n</html>\n<<END.CREATEFILE>>\n\nWrong: bare shell commands (cat, ls, npm install) written in plain text\nWrong: <<RUN-CMD="...">> (legacy format, no longer supported)\nWrong: wrapping ops or their text in angle brackets (<json-op>, <op>, <tool>, ...) — the pipeline reads raw {"op":"..."} JSON and plain prose only`;

            prompt = [
              `## Overall Project Goal\n${task}`,
              completedTasks ? `## Completed Tasks\n${completedTasks}` : "",
              currentDateLine,
              buildFailureBlock,
              `## Current Task ${currentTaskIndex + 1}/${plannerTasks.length}: ${currentTask.title}\n${currentTask.description}`,
              fileInventory,
              files.length > 0 ? `## File Contents (recent)\n${fileContext}` : "",
              recentFeedback ? `## Previous Feedback (from Tester/Critic/Hacker)\n${recentFeedback}` : "",
              commandContext,
              `## Pipeline Context\n${context}`,
              toolUsageBlock,
              mcpToolSection,
              // Rebuilt from scratch here, so the Critic's standing block has to
              // be re-appended or it only ever reached the planning phase — where
              // the Critic never runs.
              criticJudgementBlock,
              buildGateBlock,
            ].filter(Boolean).join("\n\n");
          }
        }

        if (outOfBudget()) { await rescheduleForBudget(currentPhase); return; }
        const result = await callModelWithStreaming(ctx, prompt, systemPrompt, branchId, currentPhase, geminiKeys, dbCreds, agentModelAssignments, callBudget());
        agentOutput = result.text;
        await bill(currentPhase.toLowerCase(), result);

        // Stitch a write that got cut off at the token limit: if a JSON op is
        // still open (unclosed string, no trailing }), ask the model to continue
        // from the tail until it closes. Bounded so a model that never closes
        // can't loop. Without this a file bigger than one response — or a final
        // command op — is silently lost and the pipeline retries forever.
        let contRounds = 0;
        // Budget guard as well as a round cap: a continuation that cannot fit in
        // what's left of the action must not be started. Stopping the loop early
        // leaves the (still unclosed) output to the normal downstream handling
        // rather than risking the 600s kill mid-write.
        //
        // Corruption guard: an op whose "content" carries raw unescaped quotes
        // reads to the brace walker exactly like a cut-off op, but continuing it
        // is guaranteed waste — the appended text still never parses, the
        // transcript grows a second copy of the file, and the failure repeats.
        // Signal for that case: the output's LAST line ends with a closing
        // brace, i.e. the model BELIEVES it closed the op while the parse
        // disagrees. A genuinely truncated op ends mid-content, never on a `}`.
        // Legacy <<...>> blocks are untouched by this — they are not JSON ops,
        // so with no JSON op in the output the brace-end test is not consulted.
        while (
          hasUnclosedJsonOp(agentOutput) &&
          (findJsonOpsInternal(agentOutput).ops.length > 0 ||
            findJsonOpsInternal(agentOutput).malformed.length > 0) &&
          !/\}\s*$/.test(agentOutput.trimEnd()) &&
          contRounds < MAX_OP_CONTINUATIONS &&
          !outOfBudget()
        ) {
          contRounds++;
          const tail = agentOutput.slice(-6000);
          const contPrompt = [
            `Your previous output was cut off at the token limit mid-op: an {"op":"..."} JSON op is still open, OR a <<CREATEFILE="...">> raw content block is still open (no <<END.CREATEFILE>> yet).`,
            `## The tail of what you wrote (continue from the exact end of this)`,
            tail,
            `## Continue`,
            `Emit ONLY the remaining body, picking up at the exact character where the tail stops — do NOT repeat anything above, do NOT re-open the op or the block from the start. For a JSON op: finish the content string and close it with its closing brace. For a raw content block: continue the file content verbatim and close with <<END.CREATEFILE>>. If you still had more files or commands to emit after it, continue with those.`,
          ].join("\n\n");
          const cont = await callModelWithStreaming(ctx, contPrompt, systemPrompt, branchId, currentPhase, geminiKeys, dbCreds, agentModelAssignments, callBudget());
          if (!cont.text.trim()) break;
          agentOutput += cont.text;
          await bill(`${currentPhase.toLowerCase()}-cont`, cont);
        }

        await ctx.runMutation(internal.codeBranches.clearStreamingContent, { branchId });
      }

      // Parse the output ONCE, here, and apply its file operations before
      // anything below can pause and return.
      //
      // This used to run only on the terminal path. A reply that created a file
      // AND asked to run a verification command — which the Coder and Tester
      // prompts actively ask for — hit the command pause below and returned, so
      // upsertFile never ran. codeFiles stayed empty, githubActionsRunner pushed
      // a repo without the file, the agent's own `ls` failed, and it was handed
      // a 2000-char slice of its raw previous message as context. It concluded
      // it had been truncated mid-file and wrote the same file again. Forever.
      // The old comment claimed "the re-run re-emits them"; the re-run had no
      // way to know it already had.
      const parsed = parseAgentOutput(agentOutput);
      // MCP blocks aren't known to parseAgentOutput — strip them ourselves so
      // ignored/over-cap calls don't litter the saved message.
      parsed.cleanContent = stripMcpBlocks(parsed.cleanContent);
      // Rejected-op feedback: the in-place [MALFORMED OP] marker tells the
      // agent (and the user) that something failed, but a live run showed the
      // Coder re-emitting the same broken create-file round after round — the
      // marker alone never corrected an op whose "content" carried raw
      // unescaped quotes. Say plainly what to do instead, inside the very
      // message the next agents read from history. The raw-content block is
      // the whole point: file bodies are written verbatim between markers, so
      // quotes and newlines can never break them again.
      if (parsed.malformedOps.length > 0) {
        parsed.cleanContent = `${parsed.cleanContent}\n\n[REJECTED OPS: ${parsed.malformedOps.length} JSON op(s) did not parse and executed nothing. For FILE content, stop using JSON entirely — write a RAW CONTENT BLOCK instead, which needs NO escaping:\n<<CREATEFILE="index.html">>\n<entire file, verbatim — any quotes, any newlines>\n<<END.CREATEFILE>>\nUse {"op":"..."} JSON only for commands, searches, scrapes, MCP calls and image generation.]`;
      }
      for (const op of parsed.fileOps) {
        if (op.type === "create" || op.type === "edit") {
          await ctx.runMutation(internal.codeBranches.upsertFile, {
            branchId,
            filepath: op.filepath,
            content: op.content ?? "",
            agent: agentName,
          });
        } else if (op.type === "delete") {
          await ctx.runMutation(internal.codeBranches.deleteFileByPath, {
            branchId,
            filepath: op.filepath,
          });
        }
      }

      // Execute search and scrape operations from the agent output.
      // Each search is a SERP call plus up to three full page reads, so a
      // batch of five is minutes of wall clock — the budget check stops the
      // loop rather than letting web I/O run the action into the 600s kill.
      // Whatever was collected before the cutoff still feeds the follow-up.
      const searchResults: Array<{ query: string; result: string }> = [];
      // Requests that never ran because the budget was already gone. They used
      // to vanish without a trace: the loop broke, searchResults stayed empty,
      // the re-call never happened, and the agent was handed nothing and told
      // nothing. A FactCheck agent on the receiving end of that concluded "the
      // search functionality is not available", refused to verify anything and
      // failed the build — a correct read of the evidence it was given, and
      // entirely wrong about the system. Same silent-drop class as the MCP path.
      const skippedSearchOps: string[] = [];
      for (const s of parsed.searchOps.slice(0, 5)) {
        if (outOfBudget()) { skippedSearchOps.push(s.query); continue; }
        try {
          const result = await performSearch(s.query);
          searchResults.push({ query: s.query, result });
        } catch {
          searchResults.push({ query: s.query, result: "[Search failed]" });
        }
      }
      for (const s of parsed.scrapeOps.slice(0, 5)) {
        if (outOfBudget()) { skippedSearchOps.push(s.url); continue; }
        try {
          const result = await performScrape(s.url);
          searchResults.push({ query: s.url, result });
        } catch {
          searchResults.push({ query: s.url, result: "[Scrape failed]" });
        }
      }
      // Tell the agent what did not run, even when NOTHING ran — an agent that
      // asked for research and got silence cannot tell "the tool is broken"
      // from "nothing was found", and both readings are wrong. It advances
      // without the re-call, but it advances knowing why.
      if (skippedSearchOps.length > 0) {
        parsed.cleanContent = `${parsed.cleanContent}\n\n[RESEARCH SKIPPED: ${skippedSearchOps.length} request(s) (${skippedSearchOps.slice(0, 3).map((q) => `"${q.slice(0, 60)}"`).join(", ")}${skippedSearchOps.length > 3 ? ", …" : ""}) did not run — this step ran out of its time budget, not because search is unavailable. Work with what you have; the next step can research again.]`;
      }
      if (searchResults.length > 0 && !outOfBudget()) {
        const searchContext = searchResults
          .map((r, i) => `[RESULT ${i + 1} for "${r.query}"]:\n${r.result}`)
          .join("\n\n---\n\n");
        // Re-call the same agent with search results appended. The instruction
        // to quote rather than restate is load-bearing: a production run had an
        // agent "continue" by reproducing the whole result block from memory,
        // corrupting URLs as it went (one source came back with a typo'd path
        // that the pipeline could not have produced), and every agent after it
        // treated those mangled links as real citations.
        const searchPrompt = `${agentOutput}\n\n---\n\nSEARCH RESULTS:\n${searchContext}\n\nNow continue your work using the above information. Do NOT emit any more search or scrape ops. Do NOT reproduce this result block in your reply — quote only the specific lines you rely on, copying any URL character-for-character, and never write a URL that does not appear above.`;
        const searchCall = await callModelWithStreaming(ctx, searchPrompt, systemPrompt, branchId, currentPhase, geminiKeys, dbCreds, agentModelAssignments, callBudget());
        agentOutput = searchCall.text;
        await bill(`${currentPhase.toLowerCase()}-search`, searchCall);
        // Re-parse with search results incorporated
        const reParsed = parseAgentOutput(agentOutput);
        reParsed.cleanContent = stripMcpBlocks(reParsed.cleanContent);
        // Apply any new file ops from the search-informed response
        for (const op of reParsed.fileOps) {
          if (op.type === "create" || op.type === "edit") {
            await ctx.runMutation(internal.codeBranches.upsertFile, {
              branchId,
              filepath: op.filepath,
              content: op.content ?? "",
              agent: agentName,
            });
          } else if (op.type === "delete") {
            await ctx.runMutation(internal.codeBranches.deleteFileByPath, {
              branchId,
              filepath: op.filepath,
            });
          }
        }
        parsed.cleanContent = reParsed.cleanContent;
        parsed.fileOps.push(...reParsed.fileOps);
        // The search-informed response replaced agentOutput, so its tool calls
        // live in reParsed — not in `parsed`, which was parsed from the output
        // that came BEFORE the search. Only fileOps were carried over, so an
        // agent that searched and then asked for a command or an MCP tool had
        // that request silently dropped. Commands were partly saved by
        // parseCommands() re-reading the raw text; MCP ops had no such path and
        // vanished outright. Merge both.
        parsed.cmdOps.push(...reParsed.cmdOps);
        parsed.mcpOps.push(...reParsed.mcpOps);
      }

      // ── MCP tool calls ──────────────────────────────────────────────────
      // Execute inline (plain HTTPS — no sandbox needed), post the results, and
      // re-run the SAME agent so it can use them.
      //
      // This runs BEFORE the command-pause block below, and that ordering is
      // load-bearing. A message that both searched an MCP server and queued a
      // command used to hit the command pause and return, so the MCP call was
      // dropped on the floor with no result and no error — and the agents most
      // likely to combine the two are exactly the ones told to search the
      // corpus when a command fails. MCP is a plain HTTPS round-trip that
      // finishes in-action, so it costs the command nothing to run first: the
      // re-run re-emits the cmd op with the tool results already in context.
      //
      // Both call forms are supported — JSON ops ({"op":"mcp",...}) first,
      // legacy <<MCP-CALL>> / <<TOOL>> blocks as fallback — merged and
      // de-duplicated so a message can't double-fire the same call.
      const legacyMcpCalls = parseMcpCalls(agentOutput);
      const jsonMcpCalls = (parsed.mcpOps ?? [])
        .filter((op) => op.server && op.tool)
        .map((op) => ({ server: op.server, tool: op.tool, args: op.args ?? {} }));
      const mcpCalls: ParsedMcpCall[] = [];
      const seenMcp = new Set<string>();
      for (const call of [...jsonMcpCalls, ...legacyMcpCalls]) {
        const key = `${call.server}|${call.tool}|${JSON.stringify(call.args)}`;
        if (!seenMcp.has(key)) {
          seenMcp.add(key);
          mcpCalls.push(call);
        }
      }
      const mcpRound = branch.mcpRoundCount ?? 0;
      // Nothing can be called: either no server is attached, or this step has
      // spent its round budget. Both used to drop the calls in silence, which
      // reads to the agent as a tool that hangs — it re-emits the same call and
      // burns the rest of its turns waiting for output that is never coming.
      // Say so in the agent's own message and let the pipeline advance normally;
      // re-running the agent here instead would be an unbounded loop, since the
      // condition that made the call impossible cannot change within the step.
      if (mcpCalls.length > 0 && (mcpServers.length === 0 || mcpRound >= MAX_MCP_ROUNDS)) {
        parsed.cleanContent = `${parsed.cleanContent}\n\n[MCP: ${mcpCalls.length} call(s) not made — ${
          mcpServers.length === 0
            ? "no MCP servers are attached to this run"
            : `this step's MCP round budget (${MAX_MCP_ROUNDS}) is spent; earlier results remain in context`
        }. Continue without them.]`;
      } else if (mcpCalls.length > 0) {
        // Cleaned, and its file ops are already applied above.
        totalMessages++;
        await ctx.runMutation(internal.codeBranches.saveMessage, {
          branchId, agent: agentName, content: parsed.cleanContent,
          round, messageIndex: totalMessages,
        });

        const serverNames = mcpServers.map((s) => s.name).join(", ");
        const resultBlocks: string[] = [];
        for (const call of mcpCalls.slice(0, MAX_MCP_CALLS_PER_MESSAGE)) {
          const server = findMcpServer(mcpServers, call.server);
          if (!server) {
            // Naming the attached servers turns a dead end into something the
            // agent can correct on its next turn. Exact-name matching alone
            // failed every call that wrote "AgentOverflow" or "sketchfab-mcp"
            // — see findMcpServer for how far the fuzzy match goes.
            resultBlocks.push(`### ${call.server}/${call.tool}\n[error] No MCP server named "${call.server}" is attached to this run. Attached servers: ${serverNames}. Re-issue the call using one of those names exactly.`);
            continue;
          }
          let outcome;
          try {
            const auth = server.plainAuth ?? await decryptAuthHeader(server.encryptedAuth);
            outcome = await mcpCallTool(server.url, auth, call.tool, call.args);
          } catch (err) {
            outcome = { ok: false, text: err instanceof Error ? err.message : String(err) };
          }
          // Fenced + sentinel-neutralized, same as shell command output. The
          // heading reports the server we RESOLVED to, not the name the agent
          // typed, so a fuzzy match is visible rather than silent.
          const safe = outcome.text.slice(0, 4000).split("<<").join("‹‹").split(">>").join("››");
          resultBlocks.push(`### ${server.name}/${call.tool}\n[${outcome.ok ? "ok" : "error"}]\n\`\`\`\n${safe}\n\`\`\``);
        }
        if (mcpCalls.length > MAX_MCP_CALLS_PER_MESSAGE) {
          resultBlocks.push(`(${mcpCalls.length - MAX_MCP_CALLS_PER_MESSAGE} additional calls skipped — max ${MAX_MCP_CALLS_PER_MESSAGE} per message)`);
        }

        totalMessages++;
        await ctx.runMutation(internal.codeBranches.saveMessage, {
          branchId, agent: "MCP",
          content: `## MCP Tool Results\n${resultBlocks.join("\n\n")}`,
          round, messageIndex: totalMessages,
        });

        await ctx.runMutation(internal.codeBranches.updateBranchStatus, {
          branchId, status: "idle", currentAgent: agentName,
          totalMessages, mcpRoundCount: mcpRound + 1,
        });
        await ctx.scheduler.runAfter(0, internal.codePipeline.runPipelineAction, { branchId });
        return;
      }

      // Commands come from the RAW output, never from cleanContent:
      // parseAgentOutput has already rewritten tool calls into [CMD: …]
      // placeholders, so parsing the cleaned text would match nothing and this
      // whole path would go silently dead. Legacy <<RUN-CMD>>/<<TOOL>> tags are
      // re-read from the raw text, and JSON ops arrive via parsed.cmdOps.
      const commands = Array.from(new Set([
        ...parseCommands(agentOutput),
        ...parsed.cmdOps.map((op) => op.command),
      ]));
      if (commands.length > 0) {
        // Queue commands
        for (const cmd of commands) {
          await ctx.runMutation(internal.codeCommands.queueCommand, {
            branchId,
            agent: agentName,
            command: cmd,
          });
        }

        // Save the partial message CLEANED. Saving raw agentOutput is what
        // put <<CREATEFILE>>, <<END.CREATEFILE>>, <<RUN-CMD=…>> and orphaned
        // <<END.MCP-CALL>> markers straight into the visible transcript — and
        // into the desktop app, which does no stripping of its own.
        totalMessages++;
        await ctx.runMutation(internal.codeBranches.saveMessage, {
          branchId,
          agent: agentName,
          content: parsed.cleanContent,
          round,
          messageIndex: totalMessages,
        });

        // Pause until the commands come back. totalMessages MUST be persisted
        // here: saveMessage only inserts into codeMessages and never touches
        // the branch doc, so a pause path that omits it means these turns are
        // invisible to the message ceiling and a command/resume loop runs
        // completely unbounded.
        await ctx.runMutation(internal.codeBranches.updateBranchStatus, {
          branchId,
          status: "paused",
          currentAgent: agentName,
          totalMessages,
        });

        // Execute the queued commands on the web (Daytona sandbox — works with
        // no desktop app). This runs them and re-schedules runPipelineAction
        // when done. `phase` is left unchanged, so this SAME agent runs again
        // on resume — with the command results now in its context. Its file
        // ops have already been applied above, so the resumed run sees them in
        // its inventory instead of an empty workspace.
        // Cloud branches hand the queue to Daytona. Local ones do not schedule
        // anything: the desktop app is polling for pending commands, runs them
        // on the user's machine, and resumes this pipeline itself through
        // codeCommands.completeCommand. Scheduling Daytona here as well would
        // race it and run every command twice.
        if (branch.executor !== "local") {
          await ctx.scheduler.runAfter(0, internal.githubActionsRunner.executeBranchCommandsViaActions, { branchId });
        }
        return;
      }

      // Parse and handle API key requests — legacy <<REQUEST-API-KEY>> tags
      // plus the JSON op ({"op":"request-api-key",...}) form.
      const apiKeyRequests = parseApiKeyRequests(agentOutput);
      if (parsed.requestApiKey) {
        const existing = apiKeyRequests.some((r) => r.variableName === parsed.requestApiKey?.name);
        if (!existing) {
          apiKeyRequests.push({
            variableName: parsed.requestApiKey.name,
            description: parsed.requestApiKey.description,
            howToGet: parsed.requestApiKey.howToGet,
          });
        }
      }
      if (apiKeyRequests.length > 0) {
        for (const req of apiKeyRequests) {
          await ctx.runMutation(internal.codeApiKeys.requestApiKey, {
            branchId,
            agent: agentName,
            variableName: req.variableName,
            description: req.description,
            howToGet: req.howToGet,
          });
        }

        totalMessages++;
        await ctx.runMutation(internal.codeBranches.saveMessage, {
          branchId,
          agent: agentName,
          content: parsed.cleanContent,
          round,
          messageIndex: totalMessages,
        });

        // Pause until the user supplies the key — same reason as above for
        // persisting totalMessages on a pausing path.
        await ctx.runMutation(internal.codeBranches.updateBranchStatus, {
          branchId,
          status: "paused",
          currentAgent: agentName,
          totalMessages,
        });

        return;
      }

      // Parsed and applied at the top of this block — every path shares it now.
      // Save message
      totalMessages++;
      await ctx.runMutation(internal.codeBranches.saveMessage, {
        branchId,
        agent: agentName,
        content: parsed.cleanContent,
        round,
        messageIndex: totalMessages,
      });

      // Auto-push to GitHub after every AI output
      if (parsed.fileOps.length > 0) {
        await ctx.scheduler.runAfter(0, internal.githubSync.autoPushToGithub, {
          branchId,
          commitMessage: `${agentName}: ${parsed.cleanContent.slice(0, 100)}...`,
        });
      }

      // ── Critic retry loop ────────────────────────────────────────────────────
      // If the Critic says fail, loop back to Coder rather than blindly
      // advancing. There is deliberately NO retry cap: a fixed count either cuts
      // off a task that was one round from correct, or rubber-stamps a broken
      // one the moment the counter runs out — and the old cap did the second,
      // printing "retries exhausted, advancing to next task" and shipping the
      // failure anyway. The Critic decides instead: it is told how many times it
      // has already rejected this task and instructed to pass when what is left
      // is minor, out of scope, or has resisted repeated fixes (see the Critic
      // system prompt and the escalation block in the prompt builder above).
      // Same rationale as the removed per-run message ceiling: a runaway loop
      // costs real provider quota and stays user-stoppable via stopPipeline, so
      // the natural break is the user's judgement, not an arbitrary number.
      if (currentPhase === "Critic" && parsed.criticResult === "fail") {
        // Persisted per-task counter — it survives the separate
        // runPipelineAction invocations each retry spans, and it is what the
        // Critic reads to know how long it has been holding this task.
        const retryCount = branch.criticRetryCount ?? 0;
        round++;
        await ctx.runMutation(internal.codeBranches.updateBranchStatus, {
          branchId,
          status: "idle",
          currentAgent: "Coder",
          phase: "Coder",
          executionPhase,
          round,
          totalMessages,
          criticRetryCount: retryCount + 1,
          mcpRoundCount: 0,
        });
        // Append a system prompt to context so Coder knows exactly what failed
        await ctx.runMutation(internal.codeBranches.saveMessage, {
          branchId,
          agent: "Critic",
          content: `[RETRY ${retryCount + 1}] Critic rejected this task. Coder must fix the issues above. Review the Critic's feedback and fix ALL issues before this task can pass.`,
          round,
          messageIndex: totalMessages + 1,
        });
        await ctx.scheduler.runAfter(0, internal.codePipeline.runPipelineAction, { branchId });
        return;
      }

      // Advance pipeline
      const nextPhaseIndex = phaseIndex + 1;

      if (isPlanning && currentPhase === "Planner") {
        // Planning done, start executing tasks.
        // Use the tasks parsed THIS run, not branch.plannerTasksJson (which is
        // stale — it was loaded before the Planner saved its tasks).
        const plannerTasks = parsedPlannerTasks;

        if (plannerTasks.length > 0) {
          // Start at the first agent in the dynamic task pipeline
          const taskPipeline = buildTaskPipeline(dispatchedAgents);
          const firstTaskAgent = taskPipeline[0] ?? "Coder";
          round++;
          await ctx.runMutation(internal.codeBranches.updateBranchStatus, {
            branchId,
            status: "idle",
            currentAgent: firstTaskAgent,
            phase: firstTaskAgent,
            executionPhase: "executing",
            round,
            totalMessages,
            mcpRoundCount: 0,
          });

          await ctx.scheduler.runAfter(0, internal.codePipeline.runPipelineAction, {
            branchId,
          });
        } else {
          await ctx.runMutation(internal.codeBranches.updateBranchStatus, {
            branchId,
            status: "completed",
            executionPhase: "completed",
            totalMessages,
          });
        }
      } else if (nextPhaseIndex >= currentPipeline.length) {
        // Pipeline complete for this task
        if (!isPlanning) {
          let plannerTasks: Array<{ title: string; description: string }> = [];
          try {
            plannerTasks = JSON.parse(branch.plannerTasksJson || "[]");
          } catch { /* ignore */ }

          const nextTaskIndex = currentTaskIndex + 1;
          if (nextTaskIndex < plannerTasks.length) {
            // Re-run the Dispatcher before every new task so it can decide the
            // optimal agent set for this specific subtask — earlier agents may
            // have finished their work, and later tasks may need a different
            // mix (e.g. after Coder writes code, Tester may not be needed for
            // a documentation task). The saved dispatchedAgentsJson is preserved;
            // the Dispatcher re-evaluates against the fresh task context.
            round++;
            await ctx.runMutation(internal.codeBranches.updateBranchStatus, {
              branchId,
              status: "idle",
              currentAgent: "Dispatcher",
              phase: "Dispatcher",
              executionPhase: "dispatching",
              round,
              totalMessages,
              currentTaskIndex: nextTaskIndex,
              criticRetryCount: 0,
              mcpRoundCount: 0,
            });

            await ctx.scheduler.runAfter(0, internal.codePipeline.runPipelineAction, {
              branchId,
            });
          } else {
            // All done
            await ctx.runMutation(internal.codeBranches.updateBranchStatus, {
              branchId,
              status: "completed",
              executionPhase: "completed",
              totalMessages,
            });
          }
        } else {
          // Planning phase finished WITHOUT a Planner agent in the dispatched
          // set — e.g. a simple task dispatched ResearchPlanner → Researcher →
          // ReportMaker → FactCheck → Coder → Critic. The handoff above only
          // fires when currentPhase === "Planner", so previously this branch
          // marked the branch "completed" and the task agents (Coder, Critic)
          // NEVER ran: the run ended silently right after the research team,
          // with no error and no explanation. Hand off to the task phase the
          // same way the Planner path does — seed a synthetic single task when
          // the plan is empty, then start the task pipeline.
          let plannerTasks: Array<{ title: string; description: string }> = [];
          try { plannerTasks = JSON.parse(branch.plannerTasksJson || "[]"); } catch { /* ignore */ }
          if (plannerTasks.length === 0) {
            const syntheticTask = JSON.stringify([{ title: task.slice(0, 120), description: task }]);
            await ctx.runMutation(internal.codeBranches.updatePlannerTasks, {
              branchId,
              plannerTasksJson: syntheticTask,
            });
          }
          const taskPipeline = buildTaskPipeline(dispatchedAgents);
          const firstTaskAgent = taskPipeline[0] ?? "Coder";
          round++;
          await ctx.runMutation(internal.codeBranches.updateBranchStatus, {
            branchId,
            status: "idle",
            currentAgent: firstTaskAgent,
            phase: firstTaskAgent,
            executionPhase: "executing",
            round,
            totalMessages,
            mcpRoundCount: 0,
          });
          await ctx.scheduler.runAfter(0, internal.codePipeline.runPipelineAction, { branchId });
        }
      } else {
        // Next agent in pipeline
        const nextPhase = currentPipeline[nextPhaseIndex];
        round++;
        await ctx.runMutation(internal.codeBranches.updateBranchStatus, {
          branchId,
          status: "idle",
          currentAgent: nextPhase,
          phase: nextPhase,
          executionPhase,
          round,
          totalMessages,
          mcpRoundCount: 0,
        });

        await ctx.scheduler.runAfter(0, internal.codePipeline.runPipelineAction, {
          branchId,
        });
      }
    } catch (err) {
      console.error("Pipeline error:", err);
      const message = err instanceof Error ? err.message : String(err);

      // These failures are TRANSIENT and the run must survive them:
      //  - provider exhaustion: every free seat rate-limits at once under
      //    burst, and the window is short;
      //  - Convex's own infrastructure blips: "Transient network error running
      //    query (UND_ERR_SOCKET, 5 attempts)" killed a run AFTER it had
      //    already ridden out three provider backoffs — Convex literally labels
      //    the error transient, and terminating on it discards resumable work.
      // The pipeline is resumable (all state lives on the branch doc), so the
      // correct response to any of these is to wait and pick up exactly where
      // it stopped, not to throw the run away.
      const isTransientFailure =
        message.includes("All AI provider seats failed") ||
        message.includes("No AI provider configured") ||
        message.includes("rate limit") ||
        message.includes("429") ||
        message.includes("Transient network error") ||
        message.includes("UND_ERR_SOCKET") ||
        message.includes("ECONNRESET") ||
        message.includes("fetch failed") ||
        message.includes("socket hang up");

      if (isTransientFailure) {
        // Name the failure class honestly — "providers are rate-limited" was
        // wrong (and confusing) when the actual cause was a Convex network blip.
        const isInfraBlip =
          message.includes("Transient network error") ||
          message.includes("UND_ERR_SOCKET") ||
          message.includes("ECONNRESET") ||
          message.includes("fetch failed") ||
message.includes("socket hang up") ||
        message.includes("empty output");
        const causeLabel = isInfraBlip
          ? "A transient network error interrupted this step"
          : "Every model provider is rate-limited right now";

        try {
          const branchNow = await ctx.runQuery(internal.codeBranches.getBranchInternal, { branchId });
          const attempt = (branchNow?.providerBackoffCount ?? 0) + 1;
          const MAX_PROVIDER_BACKOFFS = 5;
          if (attempt <= MAX_PROVIDER_BACKOFFS) {
            // 1, 2, 4, 8, 16 minutes — long enough to outlast a per-minute or
            // per-hour-bucket limit without abandoning the user's work.
            const delayMs = 60_000 * Math.pow(2, attempt - 1);
            await ctx.runMutation(internal.codeBranches.saveMessage, {
              branchId,
              agent: "System",
              content: `⏳ ${causeLabel}. Holding this run and resuming automatically in ${Math.round(delayMs / 60_000)} min (attempt ${attempt}/${MAX_PROVIDER_BACKOFFS}). Nothing has been lost — the pipeline continues from where it stopped.`,
            });
            await ctx.runMutation(internal.codeBranches.updateBranchStatus, {
              branchId,
              status: "running",
              providerBackoffCount: attempt,
            });
            await ctx.scheduler.runAfter(delayMs, internal.codePipeline.runPipelineAction, { branchId });
            return;
          }
          // Out of patience — fall through and report honestly.
          await ctx.runMutation(internal.codeBranches.saveMessage, {
            branchId,
            agent: "System",
            content: `⚠️ ${isInfraBlip ? "Transient errors persisted" : "Model providers stayed unavailable"} across ${MAX_PROVIDER_BACKOFFS} retries spanning ~30 minutes. Stopping so the run doesn't spin. Press send again to resume from here${isInfraBlip ? "" : ", or add a Modal/Ollama key in /admin for a seat that isn't shared"}.`,
          });
          await ctx.runMutation(internal.codeBranches.updateBranchStatus, {
            branchId, status: "idle", providerBackoffCount: 0,
          });
        } catch {
          // The recovery bookkeeping ITSELF hit the same blip (its runQuery /
          // runMutation calls go over the wire too). Don't let the run die on
          // the recovery path: schedule a bare resume and let the next
          // invocation do the accounting. Worst case the watchdog cron picks
          // the branch up in 12 minutes.
          await ctx.scheduler.runAfter(60_000, internal.codePipeline.runPipelineAction, { branchId });
        }
        return;
      }

      await ctx.runMutation(internal.codeBranches.saveMessage, {
        branchId,
        agent: "System",
        content: `⚠️ Error: ${message}`,
      });
      await ctx.runMutation(internal.codeBranches.updateBranchStatus, {
        branchId,
        status: "idle",
      });
    }
  },
});

// Public action: start pipeline
export const startPipeline = action({
  args: {
    token: v.string(),
    branchId: v.string(),
    userPrompt: v.optional(v.string()),
    // The desktop app sends "local" to run commands on the user's own machine.
    // Omitted (every shipped build before this) means cloud.
    executor: v.optional(v.union(v.literal("cloud"), v.literal("local"))),
  },
  handler: async (ctx, args): Promise<void> => {
    // Verify authentication AND that the caller owns this branch — otherwise any
    // signed-in user could inject a prompt into, and start, another user's build.
    const userId = await ctx.runQuery(internal.customAuthHelpers.getUserIdByToken, { token: args.token });
    if (!userId) throw new Error("Not authenticated");
    const branch = await ctx.runQuery(internal.codeBranches.getBranchInternal, { branchId: args.branchId });
    if (!branch) throw new Error("Branch not found");
    const project = await ctx.runQuery(internal.codeProjects.getProjectInternal, { projectId: branch.projectId });
    if (!project || project.userId !== userId) throw new Error("Not authorized");

    // Fresh run: clear any leftover Stop flag and reset the per-task Critic
    // retry budget so a previously-exhausted branch starts clean.
    await ctx.runMutation(internal.codeBranches.updateBranchStatus, {
      // totalMessages resets too. Without it the ceiling is a per-branch
      // LIFETIME budget: nothing else in the codebase ever writes it back to 0
      // after creation, so the first run to trip it bricked that branch for
      // good and every later run just re-printed the ceiling message.
      branchId: args.branchId, stopRequested: false, criticRetryCount: 0, mcpRoundCount: 0, totalMessages: 0,
      // Always set explicitly (defaulting to "cloud") rather than only when
      // passed — otherwise a branch previously run once from the desktop app
      // (executor: "local") stays stuck "local" forever, and every future
      // command queued from a web-only session parks the branch "paused"
      // with nothing able to ever run it (the desktop-only executor queue
      // has no other reader).
      executor: args.executor ?? "cloud",
    });

    // Save user message if provided
    if (args.userPrompt) {
      await ctx.runMutation(internal.codeBranches.saveMessage, {
        branchId: args.branchId,
        agent: "User",
        content: args.userPrompt,
        round: 0,
        messageIndex: 0,
      });
    }

    // Boot the VM the instant a message lands — the whole point of the worker
    // model is that the runner is already warm by the time the first cmd op
    // queues. Idempotent: bootVmForBranch skips if a worker is already alive,
    // so repeat messages cost nothing.
    //
    // A branch carrying a recorded block awaits the boot instead of scheduling
    // it, because that boot IS the re-test: it clears executorBlockedReason on
    // success. Scheduling it meant the warning below read a reason the very next
    // tick was about to erase — which is how a branch kept printing "reconnect
    // GitHub" on every single prompt after the user had already reconnected.
    // Healthy branches keep the fire-and-forget path and pay no latency; only a
    // branch that is already broken waits for the GitHub round-trip, and only
    // until the first successful boot clears it. bootVmForBranch resolves to a
    // status rather than throwing, so it cannot take the user's prompt with it.
    let blockedReason = branch.executorBlockedReason;
    const isCloud = (args.executor ?? "cloud") !== "local";
    if (isCloud && blockedReason) {
      const bootStatus = await ctx.runAction(internal.githubActionsRunner.bootVmForBranch, {
        branchId: args.branchId,
      });
      if (bootStatus === "booted" || bootStatus === "alive") blockedReason = undefined;
    } else if (isCloud) {
      await ctx.scheduler.runAfter(0, internal.githubActionsRunner.bootVmForBranch, {
        branchId: args.branchId,
      });
    }

    // Give any ALREADY-QUEUED commands a fresh dispatch attempt too, not just
    // pre-warm the worker for a future one. A command queued while the
    // executor was broken (a dead registration, any transient dispatch
    // failure) is left "pending" with nothing ever watching it again except a
    // 15-minute staleness check inside runPipelineAction — and that check only
    // runs when something re-invokes the pipeline, which nothing does for a
    // "paused" branch besides a fresh user message or the very callback that
    // will never come. Without this, the user explicitly saying "retry" did
    // nothing until that 15-minute window had already elapsed on its own —
    // unexplained silence on every attempt before it. executeBranchCommands-
    // ViaActions early-returns when there's no backlog, so this costs nothing
    // on the common case of a fresh or already-healthy branch, and it never
    // double-dispatches a command a worker is genuinely still running (its own
    // bootVmForBranch call sees the live heartbeat and does nothing further).
    if (isCloud) {
      await ctx.scheduler.runAfter(0, internal.githubActionsRunner.executeBranchCommandsViaActions, {
        branchId: args.branchId,
      });
    }

    // If the executor is genuinely blocked (a connected GitHub token that GitHub
    // itself reports has no `workflow` scope being the common case), tell the
    // user up front on THIS prompt so they know why commands will not run and
    // what to do about it — the agent prompt will also strip the cmd op
    // advertisement so no rounds are burned on impossible executions.
    // Guarded to once per user prompt (startPipeline runs once per prompt) and
    // deduped against an identical trailing System warning so a Stop/Restart
    // does not spam the transcript.
    if (blockedReason && isCloud) {
      const recent = await ctx.runQuery(internal.codeBranches.getMessagesInternal, {
        branchId: args.branchId,
      }) as Array<{ agent: string; content: string }>;
      const last = recent.length > 0 ? recent[recent.length - 1] : null;
      const warning =
        `⚠️ Cloud command execution is disabled on this branch: ${blockedReason}\n\n`
        + `Agents will keep working on files, but any command they would have run will not execute. `
        + `Open this branch's Git Sync tab to check the GitHub connection and reconnect.`;
      const alreadyWarned =
        last?.agent === "System" &&
        last.content.startsWith("⚠️ Cloud command execution is disabled");
      if (!alreadyWarned) {
        await ctx.runMutation(internal.codeBranches.saveMessage, {
          branchId: args.branchId,
          agent: "System",
          content: warning,
        });
      }
    }

    await ctx.scheduler.runAfter(0, internal.codePipeline.runPipelineAction, {
      branchId: args.branchId,
      userPrompt: args.userPrompt,
    });
  },
});

// Public action: stop pipeline
export const stopPipeline = action({
  args: { token: v.string(), branchId: v.string() },
  handler: async (ctx, args): Promise<void> => {
    const userId = await ctx.runQuery(internal.customAuthHelpers.getUserIdByToken, { token: args.token });
    if (!userId) throw new Error("Not authenticated");
    const branch = await ctx.runQuery(internal.codeBranches.getBranchInternal, { branchId: args.branchId });
    if (!branch) throw new Error("Branch not found");
    const project = await ctx.runQuery(internal.codeProjects.getProjectInternal, { projectId: branch.projectId });
    if (!project || project.userId !== userId) throw new Error("Not authorized");

    // Set the stop flag — the next runPipelineAction (self-chained or resumed)
    // sees it, halts without rescheduling, and clears it. Setting status alone
    // wouldn't work: the pipeline writes "idle" between every step anyway.
    await ctx.runMutation(internal.codeBranches.updateBranchStatus, {
      branchId: args.branchId,
      status: "idle",
      currentAgent: undefined,
      stopRequested: true,
    });

    await ctx.runMutation(internal.codeBranches.saveMessage, {
      branchId: args.branchId,
      agent: "System",
      content: "⏹️ Pipeline stopped by user",
    });
  },
});

// ── Sandbox (live preview) actions ──────────────────────────────────────────────

export const startBranchSandbox = action({
  args: {
    token: v.string(),
    branchId: v.string(),
    startCommand: v.optional(v.string()),
    port: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const userId = await ctx.runQuery(internal.customAuthHelpers.getUserIdByToken, { token: args.token });
    if (!userId) throw new Error("Not authenticated");
    const branch = await ctx.runQuery(internal.codeBranches.getBranchInternal, { branchId: args.branchId });
    if (!branch) throw new Error("Branch not found");
    const project = await ctx.runQuery(internal.codeProjects.getProjectInternal, { projectId: branch.projectId });
    if (!project || project.userId !== userId) throw new Error("Not authorized");

    await ctx.runAction(internal.githubActionsRunner.startSandbox, {
      branchId: args.branchId,
      projectId: branch.projectId,
      startCommand: args.startCommand,
      port: args.port,
    });
  },
});

export const stopBranchSandbox = action({
  args: { token: v.string(), branchId: v.string() },
  handler: async (ctx, args) => {
    const userId = await ctx.runQuery(internal.customAuthHelpers.getUserIdByToken, { token: args.token });
    if (!userId) throw new Error("Not authenticated");
    const branch = await ctx.runQuery(internal.codeBranches.getBranchInternal, { branchId: args.branchId });
    if (!branch) throw new Error("Branch not found");
    const project = await ctx.runQuery(internal.codeProjects.getProjectInternal, { projectId: branch.projectId });
    if (!project || project.userId !== userId) throw new Error("Not authorized");

    await ctx.runAction(internal.githubActionsRunner.stopSandbox, {
      branchId: args.branchId,
      projectId: branch.projectId,
    });
  },
});

// ── MCP tool-cache refresh ───────────────────────────────────────────────────
// Lives here (not in mcpClient.ts) on purpose: the api type of this codebase
// sits at TypeScript's instantiation-depth cliff, and registering an action in
// a brand-new module trips TS2589 on everything in it. mcpServers.ts schedules
// this by string reference ("codePipeline:refreshServerToolsInternal").
export const refreshServerToolsInternal = internalAction({
  args: { serverId: v.id("mcpServers") },
  handler: async (ctx, args): Promise<void> => {
    const server = await ctx.runQuery(internal.mcpServers.getServerInternal, { serverId: args.serverId });
    if (!server) return;
    let toolsJson: string;
    try {
      const auth = await decryptAuthHeader(server.authHeader);
      const tools = await mcpListTools(server.url, auth);
      toolsJson = JSON.stringify(tools);
    } catch (err) {
      toolsJson = JSON.stringify({ error: err instanceof Error ? err.message.slice(0, 300) : String(err) });
    }
    await ctx.runMutation(internal.mcpServers.saveServerTools, {
      serverId: args.serverId,
      toolsJson,
    });
  },
});

// ── Built-in MCP servers ─────────────────────────────────────────────────────
// AgentOverflow and Sketchfab are attached to every pipeline run from the
// deployment env, so they never appear in the user's mcpServers table and the
// Keys tab showed "MCP Servers (0)" on a run that had two. That is
// indistinguishable from "MCP is broken", and there was no way to tell a
// misconfigured env var apart from a dead upstream from the UI at all.
//
// Reports the same resolution the pipeline does, then actually handshakes each
// one — a configured URL that 500s is not a working tool, and only a real
// tools/list round-trip can tell the difference.
export const checkBuiltInMcpServers = action({
  args: { token: v.string() },
  handler: async (ctx, args): Promise<Array<{
    name: string; url: string | null; keyed: boolean; ok: boolean; detail: string; tools: string[];
  }>> => {
    const userId = await ctx.runQuery(internal.customAuthHelpers.getUserIdByToken, { token: args.token });
    if (!userId) throw new Error("Not authenticated");

    const site = (process.env.CONVEX_SITE_URL ?? "").trim();
    const aoKey = (process.env.AO_MCP_API_KEY ?? "").trim();
    const targets = [
      {
        name: "agentoverflow",
        url: (process.env.AO_MCP_URL ?? "").trim() || (site ? `${site}/ao/mcp` : ""),
        auth: aoKey ? `Authorization: Bearer ${aoKey}` : null,
      },
      {
        name: "sketchfab",
        url: (process.env.SKETCHFAB_MCP_URL ?? "").trim() || (site ? `${site}/sketchfab/mcp` : ""),
        auth: null,
      },
    ];

    const results = [];
    for (const t of targets) {
      if (!t.url) {
        results.push({
          name: t.name, url: null, keyed: !!t.auth, ok: false, tools: [],
          detail: "Not attached: no URL resolved. CONVEX_SITE_URL is unset and no explicit override is configured.",
        });
        continue;
      }
      try {
        const tools = await mcpListTools(t.url, t.auth);
        results.push({
          name: t.name, url: t.url, keyed: !!t.auth, ok: true,
          tools: tools.map((x) => x.name),
          detail: `Attached to every run. ${tools.length} tool(s) available.`,
        });
      } catch (err) {
        results.push({
          name: t.name, url: t.url, keyed: !!t.auth, ok: false, tools: [],
          detail: err instanceof Error ? err.message.slice(0, 300) : String(err),
        });
      }
    }
    return results;
  },
});
