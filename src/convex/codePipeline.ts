"use node";
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
  type ModelTier,
  type RunMode,
} from "./agentCore";

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

    // Check if paused for commands
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
        let prompt = `## Project Goal\n${task}\n\n## Current Files\n${fileContext}\n\n## Agent History\n${context}`;

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
              `## Pipeline Context\n${context}`,
              `## Tool Usage\nRun shell commands: <<RUN-CMD="command">>\nRequest API keys: <<REQUEST-API-KEY name="VAR" description="..." howToGet="...">>`,
            ].filter(Boolean).join("\n\n");
          }
        }

        const tier = getAgentTier(currentPhase, runMode);
        const result = await callModelWithStreaming(ctx, prompt, systemPrompt, tier, branchId, currentPhase, geminiKeys, dbCreds);
        agentOutput = result.text;
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

        return; // Exit and wait for commands to complete
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

      // Parse file operations
      const parsed = parseAgentOutput(agentOutput);
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
        const retryCount = (branch as { criticRetryCount?: number }).criticRetryCount ?? 0;
        if (retryCount < MAX_CRITIC_RETRIES) {
          // Save a fix-request context message and requeue from Coder
          round++;
          await ctx.runMutation(internal.codeBranches.updateBranchStatus, {
            branchId,
            status: "idle",
            currentAgent: "Coder",
            phase: "Coder",
            executionPhase,
            round,
            totalMessages,
          });
          // Store retry count in branch (patch directly — no dedicated mutation needed)
          const branchDoc = await ctx.runQuery(internal.codeBranches.getBranchInternal, { branchId });
          if (branchDoc) {
            // We can't do a custom patch here (no direct db access in actions), so
            // we use a saveMessage to carry the retry number in context instead.
          }
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
    // Verify authentication and ownership
    const sessions = await ctx.runQuery(internal.customAuthHelpers.getUserIdByToken, { token: args.token });
    if (!sessions) throw new Error("Not authenticated");

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

    await ctx.runMutation(internal.codeBranches.updateBranchStatus, {
      branchId: args.branchId,
      status: "idle",
      currentAgent: undefined,
    });

    await ctx.runMutation(internal.codeBranches.saveMessage, {
      branchId: args.branchId,
      agent: "System",
      content: "⏹️ Pipeline stopped by user",
    });
  },
});