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
  AGENT_SYSTEM_PROMPTS,
  getAgentTier,
  calcAgentBucksForTier,
  type ModelTier,
  type RunMode,
} from "./agentCore";
import { mcpCallTool, mcpListTools, decryptAuthHeader } from "./mcpClient";

// MCP loop guard: how many times one agent may be re-run with tool results
// before the pipeline advances anyway (prevents infinite call loops).
const MAX_MCP_ROUNDS = 2;
const MAX_MCP_CALLS_PER_MESSAGE = 5;

// All known agents in their natural order
const ALL_PLANNING_AGENTS = ["Researcher", "Analyser", "Planner"] as const;
const ALL_TASK_AGENTS     = ["Researcher", "Analyser", "Coder", "Optimiser", "Organizer", "Tester", "Hacker", "Critic"] as const;

// The full fallback pipelines (used when no Dispatcher output exists)
const DEFAULT_PLANNING_PIPELINE = ["Researcher", "Analyser", "Planner"];
const DEFAULT_TASK_PIPELINE     = ["Researcher", "Analyser", "Coder", "Optimiser", "Organizer", "Tester", "Hacker", "Critic"];

/** Build the actual planning pipeline from the Dispatcher's chosen agent list. */
function buildPlanningPipeline(dispatched: string[]): string[] {
  if (!dispatched || dispatched.length === 0) return DEFAULT_PLANNING_PIPELINE;
  return ALL_PLANNING_AGENTS.filter(a => dispatched.includes(a));
}

/** Build the actual task pipeline from the Dispatcher's chosen agent list.
 *  Coder and Critic are always guaranteed to appear (they were enforced at dispatch time). */
function buildTaskPipeline(dispatched: string[]): string[] {
  if (!dispatched || dispatched.length === 0) return DEFAULT_TASK_PIPELINE;
  return ALL_TASK_AGENTS.filter(a => dispatched.includes(a));
}

/** Parse and validate the Dispatcher's JSON output. Returns null on failure. */
function parseDispatcherOutput(text: string): { tier: string; agents: string[] } | null {
  try {
    // Strip markdown fences if the model wrapped them anyway
    const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();
    const parsed = JSON.parse(cleaned);
    if (!Array.isArray(parsed.agents) || parsed.agents.length === 0) return null;
    const VALID = new Set(["Researcher","Analyser","Planner","Coder","Optimiser","Organizer","Tester","Hacker","Critic"]);
    const agents = (parsed.agents as string[]).filter(a => VALID.has(a));
    // Always guarantee Coder and Critic
    if (!agents.includes("Coder"))  agents.push("Coder");
    if (!agents.includes("Critic")) agents.push("Critic");
    return { tier: parsed.tier ?? "medium", agents };
  } catch {
    return null;
  }
}

function buildContext(messages: Array<{ agent: string; content: string }>, maxChars = 12000): string {
  const recent = messages.slice(-12);
  let ctx = "";
  for (const m of recent) {
    const line = `[${m.agent}]: ${m.content}\n\n`;
    if (ctx.length + line.length > maxChars) break;
    ctx += line;
  }
  return ctx;
}

function buildFileContext(files: Array<{ filepath: string; content: string }>, maxChars = 10000): string {
  if (files.length === 0) return "No files yet.";
  let ctx = "## Current Project Files:\n\n";
  for (const f of files) {
    const entry = `### ${f.filepath}\n\`\`\`\n${f.content.slice(0, 2000)}\n\`\`\`\n\n`;
    if (ctx.length + entry.length > maxChars) {
      ctx += `... (${files.length} files total, showing first ${files.indexOf(f)} files)\n`;
      break;
    }
    ctx += entry;
  }
  return ctx;
}

// Parse commands from agent output
// Agents are instructed (in AGENT_SYSTEM_PROMPTS) to emit <<RUN-CMD="...">>.
// Accept the legacy <<RUN-COMMAND="...">> spelling too so older prompts still work.
function parseCommands(content: string): string[] {
  const commands: string[] = [];
  const regex = /<<RUN-(?:CMD|COMMAND)="([^"]+)">>/g;
  let match;
  while ((match = regex.exec(content)) !== null) {
    commands.push(match[1]);
  }
  return commands;
}

// Parse MCP tool calls from agent output. Block form (mirrors CREATEFILE):
//   <<MCP-CALL server="name" tool="toolName">>
//   {"json": "arguments"}
//   <<END.MCP-CALL>>
const MCP_CALL_REGEX = /<<MCP-CALL\s+server="([^"]+)"\s+tool="([^"]+)">>\s*([\s\S]*?)<<END\.MCP-CALL>>/g;

function parseMcpCalls(content: string): Array<{ server: string; tool: string; args: Record<string, unknown> }> {
  const calls: Array<{ server: string; tool: string; args: Record<string, unknown> }> = [];
  let match;
  const regex = new RegExp(MCP_CALL_REGEX.source, "g");
  while ((match = regex.exec(content)) !== null) {
    let args: Record<string, unknown> = {};
    const body = match[3].trim();
    if (body) {
      try { args = JSON.parse(body) as Record<string, unknown>; }
      catch { args = { _raw: body.slice(0, 2000) }; }
    }
    calls.push({ server: match[1], tool: match[2], args });
  }
  return calls;
}

function stripMcpBlocks(content: string): string {
  return content.replace(new RegExp(MCP_CALL_REGEX.source, "g"), "").trim();
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

// Streaming-aware model call — writes partial output to the branch's streamingContent
// field so the UI can show real-time token output. Falls back to batch callModel if
// streaming is unavailable (Gemini, AgentRouter) or credentials are missing.
// NOTE: "streaming" here is simulated — the full response is fetched first, then
// drip-fed to streamingContent in 300-char chunks. True token streaming from
// Bedrock proved unreliable inside Convex actions (see callClaude in agentCore).
async function callModelWithStreaming(
  ctx: { runMutation: ActionCtx["runMutation"]; runQuery: ActionCtx["runQuery"] },
  prompt: string,
  systemPrompt: string,
  tier: ModelTier,
  branchId: string,
  agentName: string,
  geminiKeys: string[],
  dbCreds: { accessKeyId: string; secretAccessKey: string; region: string } | null,
): Promise<{ text: string; inputTokens: number; outputTokens: number; tier: ModelTier }> {
  // Only Bedrock Claude tiers support token-level streaming from the pipeline
  const BEDROCK_MODELS: Record<string, string> = {
    haiku:  "us.anthropic.claude-haiku-4-5-20251001-v1:0",
    sonnet: "us.anthropic.claude-sonnet-4-5-20250929-v1:0",
    opus46: "us.anthropic.claude-opus-4-1-20250805-v1:0",
    opus48: "us.anthropic.claude-opus-4-1-20250805-v1:0",
  };
  if (tier === "gemini" || !BEDROCK_MODELS[tier]) {
    // Gemini: no per-token streaming — just run and update when done
    const result = await callModel(prompt, systemPrompt, tier, geminiKeys, dbCreds);
    await ctx.runMutation(internal.codeBranches.setStreamingContent, {
      branchId, content: result.text, agentName,
    });
    return result;
  }

  // Bedrock streaming
  const envKey = (process.env.AWS_BEDROCK_API_KEY ?? "").trim();
  const isCustomKey = envKey.startsWith("ABSK");
  const creds = isCustomKey
    ? { accessKeyId: envKey, secretAccessKey: "", region: "us-east-1" }
    : dbCreds;

  if (!creds || (!creds.accessKeyId && !creds.secretAccessKey)) {
    const result = await callModel(prompt, systemPrompt, tier, geminiKeys, dbCreds);
    return result;
  }

  const modelId = BEDROCK_MODELS[tier];
  const region = creds.region || "us-east-1";
  const rawUrl = `https://bedrock-runtime.${region}.amazonaws.com/model/${modelId}/invoke`;
  const requestBody = JSON.stringify({
    anthropic_version: "bedrock-2023-05-31",
    system: systemPrompt.length > 8000 ? systemPrompt.slice(0, 8000) : systemPrompt,
    messages: [{ role: "user", content: prompt.length > 48000 ? prompt.slice(0, 48000) : prompt }],
    max_tokens: 8192,
    temperature: 0.7,
  });

  const buildHeaders = async (): Promise<Record<string, string>> => {
    if (isCustomKey) {
      return { "Content-Type": "application/json", "Authorization": `Bearer ${creds.accessKeyId}`, "x-api-key": creds.accessKeyId };
    }
    // SigV4 sign using callModel's signing logic — just delegate to the non-streaming invoke
    return { "Content-Type": "application/json" };
  };

  try {
    const headers = await buildHeaders();
    if (!isCustomKey) {
      // SigV4 required — fall back to non-streaming callModel which handles signing
      // but simulate streaming by splitting the result into chunks for the UI
      const result = await callModel(prompt, systemPrompt, tier, geminiKeys, dbCreds);
      // Drip-feed the result in 300-char chunks so the UI shows something incrementally
      const chunkSize = 300;
      let sent = 0;
      while (sent < result.text.length) {
        sent = Math.min(sent + chunkSize, result.text.length);
        await ctx.runMutation(internal.codeBranches.setStreamingContent, {
          branchId, content: result.text.slice(0, sent), agentName,
        });
        if (sent < result.text.length) {
          await new Promise(r => setTimeout(r, 80));
        }
      }
      return result;
    }

    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), 120_000);
    let response: Response;
    try {
      response = await fetch(rawUrl, { method: "POST", headers, body: requestBody, signal: ctrl.signal });
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      throw new Error(`Bedrock ${response.status}`);
    }

    const data = await response.json() as {
      content?: Array<{ type: string; text?: string }>;
      usage?: { input_tokens?: number; output_tokens?: number };
    };
    const text = data.content?.find(c => c.type === "text")?.text ?? "";
    const inputTokens = data.usage?.input_tokens ?? 0;
    const outputTokens = data.usage?.output_tokens ?? 0;

    // Drip-feed the result in 300-char chunks for UI
    const chunkSize = 300;
    let sent = 0;
    while (sent < text.length) {
      sent = Math.min(sent + chunkSize, text.length);
      await ctx.runMutation(internal.codeBranches.setStreamingContent, {
        branchId, content: text.slice(0, sent), agentName,
      });
      if (sent < text.length) await new Promise(r => setTimeout(r, 80));
    }
    return { text, inputTokens, outputTokens, tier };
  } catch {
    // Any streaming failure: fall back to non-streaming
    const result = await callModel(prompt, systemPrompt, tier, geminiKeys, dbCreds);
    return result;
  }
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

    // The owner's enabled MCP servers — agents may call their tools.
    const mcpServers = ownerUserId
      ? await ctx.runQuery(internal.mcpServers.getEnabledServersInternal, { userId: ownerUserId })
      : [];

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
        const toolList = tools.slice(0, 10)
          .map(t => t.description ? `${t.name} (${t.description.slice(0, 80)})` : t.name)
          .join(", ");
        lines.push(`- server "${s.name}": ${toolList || "tools unknown — call at your own risk"}`);
      }
      mcpToolSection = [
        `## MCP Tools`,
        `You can call external tools on the user's connected MCP servers. Emit:`,
        `<<MCP-CALL server="serverName" tool="toolName">>`,
        `{"argName": "value"}`,
        `<<END.MCP-CALL>>`,
        `Results will be returned to you before you continue. Available servers:`,
        ...lines,
      ].join("\n");
    }

    // Charge the owner's AgentBucks + record platform spend for one model call.
    // Centralized so no call site runs for free — the old pipeline never billed
    // at all (a full billing bypass and a blind spot for the budget guard).
    const bill = async (label: string, r: { tier: ModelTier; inputTokens: number; outputTokens: number }) => {
      if (ownerUserId) {
        const ab = calcAgentBucksForTier(r.tier, r.inputTokens, r.outputTokens);
        await ctx.runMutation(internal.sandboxHelpers.deductAgentBucks, { userId: ownerUserId, agentBucksToDeduct: ab });
      }
      await ctx.runMutation(internal.admin.deductPlatformCost, {
        modelName: `${label}-${r.tier}`, inputTokens: r.inputTokens, outputTokens: r.outputTokens,
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
    const executionPhase = branch.executionPhase ?? "dispatching";
    const currentTaskIndex = branch.currentTaskIndex ?? 0;
    const runMode: RunMode = (branch.runMode as RunMode) ?? "balanced";

    // Parse the previously saved dispatched-agent list (set by Dispatcher phase).
    let dispatchedAgents: string[] = [];
    try {
      if (branch.dispatchedAgentsJson) {
        dispatchedAgents = JSON.parse(branch.dispatchedAgentsJson);
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

      // ── Dispatcher phase ──────────────────────────────────────────────────
      // Runs once at the very start to decide which agents are needed.
      if (executionPhase === "dispatching" || currentPhase === "Dispatcher") {
        await ctx.runMutation(internal.codeBranches.updateBranchStatus, {
          branchId,
          status: "running",
          currentAgent: "Dispatcher",
          phase: "Dispatcher",
        });

        const dispatchPrompt = `## Task to analyse\n${task}\n\n## Existing project files\n${files.length > 0 ? files.map(f => `- ${f.filepath}`).join("\n") : "None (greenfield project)"}`;
        const dispatchResult = await callModelWithStreaming(
          ctx, dispatchPrompt, AGENT_SYSTEM_PROMPTS["Dispatcher"] ?? "", "haiku",
          branchId, "Dispatcher", geminiKeys, dbCreds,
        );
        await bill("dispatcher", dispatchResult);
        await ctx.runMutation(internal.codeBranches.clearStreamingContent, { branchId });

        const dispatched = parseDispatcherOutput(dispatchResult.text);
        const agents = dispatched?.agents ?? ["Analyser", "Planner", "Coder", "Tester", "Critic"];
        const tier = dispatched?.tier ?? "medium";

        // Persist so every subsequent pipeline invocation can read it
        await ctx.runMutation(internal.codeBranches.setDispatchedAgents, {
          branchId,
          agentsJson: JSON.stringify(agents),
        });
        dispatchedAgents = agents;

        // Post a visible message so the user can see the routing decision
        totalMessages++;
        await ctx.runMutation(internal.codeBranches.saveMessage, {
          branchId,
          agent: "Dispatcher",
          content: `**Task complexity: ${tier}**\nRunning agents: ${agents.join(" → ")}`,
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

      if (currentPhase === "Planner") {
        const systemPrompt = AGENT_SYSTEM_PROMPTS["Planner"] ?? "";
        const prompt = `## Task\n${task}\n\n## Context\n${context}\n\n## Current Files\n${fileContext}`;
        const tier = getAgentTier("Planner", runMode);
        const result = await callModelWithStreaming(ctx, prompt, systemPrompt, tier, branchId, "Planner", geminiKeys, dbCreds);
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
        const systemPrompt = AGENT_SYSTEM_PROMPTS[currentPhase] ?? `You are the ${currentPhase} agent.`;
        // Default prompt for planning phase and non-Coder agents in execution phase
        let prompt = [`## Project Goal\n${task}`, `## Current Files\n${fileContext}`, commandContext, `## Agent History\n${context}`].filter(Boolean).join("\n\n");

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
              `## Tool Usage\nRun shell commands: <<RUN-CMD="command">>\nRequest API keys: <<REQUEST-API-KEY name="VAR" description="..." howToGet="...">>`,
              mcpToolSection,
            ].filter(Boolean).join("\n\n");
          }
        }

        const tier = getAgentTier(currentPhase, runMode);
        const result = await callModelWithStreaming(ctx, prompt, systemPrompt, tier, branchId, currentPhase, geminiKeys, dbCreds);
        agentOutput = result.text;
        await bill(currentPhase.toLowerCase(), result);
        await ctx.runMutation(internal.codeBranches.clearStreamingContent, { branchId });
      }

      // Parse and handle commands
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

        // Pause pipeline until commands complete
        await ctx.runMutation(internal.codeBranches.updateBranchStatus, {
          branchId,
          status: "paused",
          currentAgent: agentName,
        });

        // Save partial message
        totalMessages++;
        await ctx.runMutation(internal.codeBranches.saveMessage, {
          branchId,
          agent: agentName,
          content: agentOutput,
          round,
          messageIndex: totalMessages,
        });

        // Execute the queued commands on the web (Daytona sandbox — works with
        // no desktop app). This runs them and re-schedules runPipelineAction
        // when done. `phase` is left unchanged, so this SAME agent runs again
        // on resume — with the command results now in its context. File ops in
        // this partial output are intentionally not applied; the re-run
        // re-emits them.
        await ctx.scheduler.runAfter(0, internal.sandbox.executeBranchCommands, { branchId });
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

        // Pause pipeline until API keys provided
        await ctx.runMutation(internal.codeBranches.updateBranchStatus, {
          branchId,
          status: "paused",
          currentAgent: agentName,
        });

        totalMessages++;
        await ctx.runMutation(internal.codeBranches.saveMessage, {
          branchId,
          agent: agentName,
          content: agentOutput,
          round,
          messageIndex: totalMessages,
        });

        return;
      }

      // ── MCP tool calls ──────────────────────────────────────────────────
      // Execute inline (plain HTTPS — no sandbox needed), post the results,
      // and re-run the SAME agent so it can use them. Bounded by
      // MAX_MCP_ROUNDS; past the cap the calls are stripped and the pipeline
      // advances normally (results from earlier rounds stay in context).
      const mcpCalls = parseMcpCalls(agentOutput);
      if (mcpCalls.length > 0 && mcpServers.length > 0) {
        const mcpRound = branch.mcpRoundCount ?? 0;
        if (mcpRound < MAX_MCP_ROUNDS) {
          // Save the partial output as-is; the re-run re-emits file ops.
          totalMessages++;
          await ctx.runMutation(internal.codeBranches.saveMessage, {
            branchId, agent: agentName, content: agentOutput,
            round, messageIndex: totalMessages,
          });

          const resultBlocks: string[] = [];
          for (const call of mcpCalls.slice(0, MAX_MCP_CALLS_PER_MESSAGE)) {
            const server = mcpServers.find((s: Doc<"mcpServers">) => s.name === call.server);
            if (!server) {
              resultBlocks.push(`### ${call.server}/${call.tool}\n[error] No connected MCP server named "${call.server}"`);
              continue;
            }
            let outcome;
            try {
              const auth = await decryptAuthHeader(server.authHeader);
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

      // Parse file operations
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
        }
      }

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
      const MAX_CRITIC_RETRIES = 2;
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
            // More tasks — restart task pipeline from first agent
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
              currentTaskIndex: nextTaskIndex,
              criticRetryCount: 0, // fresh task — reset the Critic retry budget
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
  args: { token: v.string(), branchId: v.string(), userPrompt: v.optional(v.string()) },
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
      branchId: args.branchId, stopRequested: false, criticRetryCount: 0, mcpRoundCount: 0,
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
