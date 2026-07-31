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
  findJsonOps,
  parseAgentOutput,
  parsePlannerOutput,
  performSearch,
  performScrape,
  AGENT_SYSTEM_PROMPTS,
  calcAgentBucksForTier,
  type ModelTier,
} from "./agentCore";
import { mcpCallTool, mcpListTools, decryptAuthHeader } from "./mcpClient";
import { parseMcpCalls, stripMcpBlocks, type ParsedMcpCall } from "./mcpParse";

// MCP loop guard: how many times one agent may be re-run with tool results
// before the pipeline advances anyway (prevents infinite call loops).
const MAX_MCP_ROUNDS = 5;
const MAX_MCP_CALLS_PER_MESSAGE = 5;

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
const MAX_TOTAL_MESSAGES = 2000;

// How many times we'll ask the model to continue a file cut off at the token
// limit before giving up. Kept at 2 (≤3 sequential model calls per step) so the
// loop can't blow the action's time budget — with the 16k cap above, most files
// need zero continuations anyway.
const MAX_FILE_CONTINUATIONS = 2;

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
    /(?:<<<<<|<<)(?:CREATEFILE|EDITFILE)="[^"]+"(?:>>>>>|>>)[\s\S]*?(?:<<<<<|<<)END\.CREATEFILE(?:>>>>>|>>)/g,
    "",
  );
  return /(?:<<<<<|<<)(?:CREATEFILE|EDITFILE)="[^"]+"(?:>>>>>|>>)/.test(withoutComplete);
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
): Promise<{ text: string; inputTokens: number; outputTokens: number; tier: ModelTier }> {
  // If the Dispatcher assigned a specific model for this agent, pass it as an
  // override so callModel uses it directly instead of the hardcoded task-type map.
  const assignedModel = agentModelAssignments?.[agentName];
  const modelArg = assignedModel ? { assignedModel } : undefined;
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
        `You can call external tools on the user's connected MCP servers. Emit:`,
        `<<MCP-CALL server="serverName" tool="toolName">>`,
        `{"argName": "value"}`,
        `<<END.MCP-CALL>>`,
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
    const pendingCommands = await ctx.runQuery(internal.codeCommands.getPendingCommands, { branchId });
    if (pendingCommands.length > 0) {
      // Still waiting for commands to complete
      await ctx.runMutation(internal.codeBranches.updateBranchStatus, {
        branchId,
        status: "paused",
      });
      return;
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

    // Hard stop for a runaway loop: a run this long isn't progressing (the
    // failure that prompted this sat past 200, re-running the Coder forever).
    // Better to end with a clear message than bill into the void.
    if (totalMessages >= MAX_TOTAL_MESSAGES) {
      totalMessages++;
      await ctx.runMutation(internal.codeBranches.saveMessage, {
        branchId,
        agent: "System",
        content: `Pipeline stopped: hit the ${MAX_TOTAL_MESSAGES}-step ceiling without finishing. A run this long is stuck rather than progressing — start a fresh run, or narrow the task into smaller pieces.`,
        round,
        messageIndex: totalMessages,
      });
      await ctx.runMutation(internal.codeBranches.updateBranchStatus, {
        branchId, status: "completed", currentAgent: undefined, totalMessages,
      });
      return;
    }

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

    try {
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
            .map((c) => `$ ${c.command}\n[${c.status}, exit ${c.exitCode}]\n\`\`\`\n${c.output.slice(0, 1500).split("<<").join("‹‹").split(">>").join("››")}\n\`\`\``)
            .join("\n\n")
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

        const dispatchPrompt = `## Project Goal\n${task}${subtaskContext}\n\n## Existing project files\n${files.length > 0 ? files.map(f => `- ${f.filepath}`).join("\n") : "None (greenfield project)"}
\n## Previously dispatched agents\n${dispatchedAgents.length > 0 ? dispatchedAgents.join(", ") : "None yet (first dispatch)"}`;
        const dispatchResult = await callModelWithStreaming(
          ctx, dispatchPrompt, AGENT_SYSTEM_PROMPTS["Dispatcher"] ?? "",
          branchId, "Dispatcher", geminiKeys, dbCreds,
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
        await ctx.runMutation(internal.codeBranches.updateBranchStatus, {
          branchId,
          status: "completed",
          executionPhase: "completed",
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
        const prompt = `## Task\n${task}\n\n## Context\n${context}\n\n## Current Files\n${fileContext}`;
        const result = await callModelWithStreaming(ctx, prompt, systemPrompt, branchId, "Planner", geminiKeys, dbCreds, agentModelAssignments);
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
        let prompt = [`## Project Goal\n${task}`, `## Current Files\n${fileContext}`, commandContext, mcpToolSection, `## Agent History\n${context}`].filter(Boolean).join("\n\n");

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

            prompt = [
              `## Overall Project Goal\n${task}`,
              completedTasks ? `## Completed Tasks\n${completedTasks}` : "",
              `## Current Task ${currentTaskIndex + 1}/${plannerTasks.length}: ${currentTask.title}\n${currentTask.description}`,
              fileInventory,
              files.length > 0 ? `## File Contents (recent)\n${fileContext}` : "",
              recentFeedback ? `## Previous Feedback (from Tester/Critic/Hacker)\n${recentFeedback}` : "",
              commandContext,
              `## Pipeline Context\n${context}`,
              `## Tool Usage\nEmit a single-line JSON object to run a tool:\n{"op":"cmd","command":"npm install 2>&1"}\n{"op":"cmd","command":"cat package.json"}\n{"op":"cmd","command":"ls -la src/"}\n{"op":"generate-image","prompt":"a futuristic cityscape","width":1024,"height":768,"model":"flux"}\n\nRequest API keys:\n{"op":"request-api-key","name":"VAR","description":"...","howToGet":"..."}\n\nWrong: bare shell commands (cat, ls, npm install) written in plain text\nWrong: <<RUN-CMD="...">> (legacy format, no longer supported)`,
              mcpToolSection,
            ].filter(Boolean).join("\n\n");
          }
        }

        const result = await callModelWithStreaming(ctx, prompt, systemPrompt, branchId, currentPhase, geminiKeys, dbCreds, agentModelAssignments);
        agentOutput = result.text;
        await bill(currentPhase.toLowerCase(), result);

        // Stitch a file write that got cut off at the token limit: if a
        // <<CREATEFILE/EDITFILE>> block is still open (no <<END.CREATEFILE>>),
        // ask the model to continue from the tail until it closes. Bounded so a
        // model that never closes can't loop. Without this a file bigger than one
        // response is silently lost and the pipeline retries forever.
        let contRounds = 0;
        while (hasUnclosedFileBlock(agentOutput) && contRounds < MAX_FILE_CONTINUATIONS) {
          contRounds++;
          const tail = agentOutput.slice(-6000);
          const contPrompt = [
            `Your previous output was cut off at the token limit mid-file: a <<CREATEFILE="...">> or <<EDITFILE="...">> block is still open, with no closing <<END.CREATEFILE>> tag yet.`,
            `## The tail of what you wrote (continue from the exact end of this)`,
            tail,
            `## Continue`,
            `Emit ONLY the remaining content, picking up at the exact character where the tail stops — do NOT repeat anything above, do NOT re-open the <<CREATEFILE/EDITFILE tag. Finish the file and close it with <<END.CREATEFILE>>. If you still had more files or commands to emit after it, continue with those.`,
          ].join("\n\n");
          const cont = await callModelWithStreaming(ctx, contPrompt, systemPrompt, branchId, currentPhase, geminiKeys, dbCreds, agentModelAssignments);
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

      // Execute search and scrape operations from the agent output
      const searchResults: Array<{ query: string; result: string }> = [];
      for (const s of parsed.searchOps.slice(0, 5)) {
        try {
          const result = await performSearch(s.query);
          searchResults.push({ query: s.query, result });
        } catch {
          searchResults.push({ query: s.query, result: "[Search failed]" });
        }
      }
      for (const s of parsed.scrapeOps.slice(0, 5)) {
        try {
          const result = await performScrape(s.url);
          searchResults.push({ query: s.url, result });
        } catch {
          searchResults.push({ query: s.url, result: "[Scrape failed]" });
        }
      }
      if (searchResults.length > 0) {
        const searchContext = searchResults
          .map((r, i) => `[RESULT ${i + 1} for "${r.query}"]:\n${r.result}`)
          .join("\n\n---\n\n");
        // Re-call the same agent with search results appended
        const searchPrompt = `${agentOutput}\n\n---\n\nSEARCH RESULTS:\n${searchContext}\n\nNow continue your work using the above information. Do NOT emit any more <<TOOL>> blocks for search or scrape.`;
        const searchCall = await callModelWithStreaming(ctx, searchPrompt, systemPrompt, branchId, currentPhase, geminiKeys, dbCreds, agentModelAssignments);
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
      }

      // Commands come from the RAW output, never from cleanContent:
      // parseAgentOutput has already rewritten <<RUN-CMD=…>> into [CMD: …], so
      // parsing the cleaned text would match nothing and this whole path would
      // go silently dead.
      const commands = parseCommands(agentOutput);
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

      // Parse and handle API key requests
      const apiKeyRequests = parseApiKeyRequests(agentOutput);
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

      // ── MCP tool calls ──────────────────────────────────────────────────
      // Execute inline (plain HTTPS — no sandbox needed), post the results,
      // and re-run the SAME agent so it can use them. Bounded by
      // MAX_MCP_ROUNDS; past the cap the calls are stripped and the pipeline
      // advances normally (results from earlier rounds stay in context).
      // Supports both legacy <<MCP-CALL>> / <<TOOL>> blocks and JSON ops format
      // ({"op":"mcp","server":"...","tool":"...","args":{...}}).
      const legacyMcpCalls = parseMcpCalls(agentOutput);
      const jsonMcpCalls = (parsed.mcpOps ?? [])
        .filter((op) => op.server && op.tool)
        .map((op) => ({ server: op.server, tool: op.tool, args: op.args ?? {} }));
      const mcpCalls: ParsedMcpCall[] = legacyMcpCalls.length > 0 ? legacyMcpCalls : jsonMcpCalls;
      if (mcpCalls.length > 0 && mcpServers.length > 0) {
        const mcpRound = branch.mcpRoundCount ?? 0;
        if (mcpRound < MAX_MCP_ROUNDS) {
          // Cleaned, and its file ops are already applied above.
          totalMessages++;
          await ctx.runMutation(internal.codeBranches.saveMessage, {
            branchId, agent: agentName, content: parsed.cleanContent,
            round, messageIndex: totalMessages,
          });

          const resultBlocks: string[] = [];
          for (const call of mcpCalls.slice(0, MAX_MCP_CALLS_PER_MESSAGE)) {
            const server = mcpServers.find((s) => s.name === call.server);
            if (!server) {
              resultBlocks.push(`### ${call.server}/${call.tool}\n[error] No connected MCP server named "${call.server}"`);
              continue;
            }
            let outcome;
            try {
              const auth = server.plainAuth ?? await decryptAuthHeader(server.encryptedAuth);
              outcome = await mcpCallTool(server.url, auth, call.tool, call.args);
            } catch (err) {
              outcome = { ok: false, text: err instanceof Error ? err.message : String(err) };
            }
            // Fenced + sentinel-neutralized, same as shell command output.
            const safe = outcome.text.slice(0, 4000).split("<<").join("‹‹").split(">>").join("››");
            resultBlocks.push(`### ${call.server}/${call.tool}\n[${outcome.ok ? "ok" : "error"}]\n\`\`\`\n${safe}\n\`\`\``);
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
      // If the Critic says <<Fail>>, loop back to Coder (up to 2 retries) rather
      // than blindly advancing — this is the core L4.5 behavior improvement.
      const MAX_CRITIC_RETRIES = 3;
      if (currentPhase === "Critic" && parsed.criticResult === "fail") {
        // Persisted per-task counter, so the cap is actually enforced across the
        // separate runPipelineAction invocations each retry spans.
        const retryCount = branch.criticRetryCount ?? 0;
        if (retryCount < MAX_CRITIC_RETRIES) {
          // Bump the counter and requeue from Coder to fix what the Critic flagged.
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
            content: `[RETRY ${retryCount + 1}/${MAX_CRITIC_RETRIES}] Critic rejected this task. Coder must fix the issues above. Review the Critic's feedback and fix ALL issues before this task can pass.`,
            round,
            messageIndex: totalMessages + 1,
          });
          await ctx.scheduler.runAfter(0, internal.codePipeline.runPipelineAction, { branchId });
          return;
        }
        // Max retries reached — advance anyway with warning
        await ctx.runMutation(internal.codeBranches.saveMessage, {
          branchId,
          agent: "System",
          content: `⚠️ Critic retries exhausted after ${MAX_CRITIC_RETRIES} attempts. Advancing to next task.`,
          round,
          messageIndex: totalMessages + 1,
        });
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
          await ctx.runMutation(internal.codeBranches.updateBranchStatus, {
            branchId,
            status: "completed",
            executionPhase: "completed",
            totalMessages,
          });
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
      await ctx.runMutation(internal.codeBranches.saveMessage, {
        branchId,
        agent: "System",
        content: `⚠️ Error: ${err instanceof Error ? err.message : String(err)}`,
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
      ...(args.executor ? { executor: args.executor } : {}),
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
