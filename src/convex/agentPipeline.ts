"use node";
import { action, internalAction, type ActionCtx } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { Id } from "./_generated/dataModel";
import {
  callModel,
  parseAgentOutput,
  parsePlannerOutput,
  parseDifficultyFromPlannerOutput,
  AGENT_SYSTEM_PROMPTS,
  AGENT_MODEL_MAP,
  DIFFICULTY_CODER_MODEL,
  calcAgentBucksForTier,
  type ModelTier,
  type TaskDifficulty,
} from "./agentCore";

// Pipeline definition — dynamic since the Dispatcher landed (mirrors codePipeline.ts).
// The Dispatcher runs once per task and picks the minimum agent set; these
// ALL_* lists define the canonical ordering the picks are filtered against.
const ALL_PLANNING_AGENTS = ["Researcher", "Analyser", "Planner"] as const;
const ALL_TASK_AGENTS     = ["Researcher", "Analyser", "Coder", "Optimiser", "Organizer", "Tester", "Hacker", "Critic"] as const;

// Full fallback pipelines (used when no Dispatcher output exists — e.g. old
// sessions that started before the Dispatcher phase existed)
const DEFAULT_PLANNING_PIPELINE = ["Researcher", "Analyser", "Planner"];
const DEFAULT_TASK_PIPELINE     = ["Researcher", "Analyser", "Coder", "Optimiser", "Organizer", "Tester", "Hacker", "Critic"];

/** Build the actual planning pipeline from the Dispatcher's chosen agent list. */
function buildPlanningPipeline(dispatched: string[]): string[] {
  if (!dispatched || dispatched.length === 0) return DEFAULT_PLANNING_PIPELINE;
  return ALL_PLANNING_AGENTS.filter(a => dispatched.includes(a));
}

/** Build the actual task pipeline from the Dispatcher's chosen agent list.
 *  Coder and Critic are always guaranteed (enforced at dispatch parse time). */
function buildTaskPipeline(dispatched: string[]): string[] {
  if (!dispatched || dispatched.length === 0) return DEFAULT_TASK_PIPELINE;
  return ALL_TASK_AGENTS.filter(a => dispatched.includes(a));
}

/** Parse and validate the Dispatcher's JSON output. Returns null on failure. */
function parseDispatcherOutput(text: string): { tier: string; agents: string[] } | null {
  try {
    const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();
    const parsed = JSON.parse(cleaned);
    if (!Array.isArray(parsed.agents) || parsed.agents.length === 0) return null;
    const VALID = new Set(["Researcher","Analyser","Planner","Coder","Optimiser","Organizer","Tester","Hacker","Critic"]);
    const agents = (parsed.agents as string[]).filter(a => VALID.has(a));
    if (!agents.includes("Coder"))  agents.push("Coder");
    if (!agents.includes("Critic")) agents.push("Critic");
    return { tier: parsed.tier ?? "medium", agents };
  } catch {
    return null;
  }
}

// Research sub-agents that run under the "Researcher" slot
const RESEARCH_SUB_AGENTS = ["ResearchPlanner", "DataTaker", "ResearchOrganiser"];

// Security sub-agents that run under the "Hacker" slot
const SECURITY_SUB_AGENTS = [
  "VulnerabilitySpotter", "VulnerabilityFixer",
  "DataCorruptor", "DataFixer",
  "ZeroDayExploiter", "ZeroDayRemover",
  "FrameworkAuditor", "FrameworkRefiner",
  "RedTeamOrchestrator",
];

// Helper: build context string from messages
function buildContext(messages: Array<{ agent: string; content: string }>, maxChars = 32000): string {
  const recent = messages.slice(-30);
  let ctx = "";
  for (const m of recent) {
    const line = `[${m.agent}]: ${m.content}\n\n`;
    if (ctx.length + line.length > maxChars) break;
    ctx += line;
  }
  return ctx;
}

// Helper: build file context
function buildFileContext(files: Array<{ filepath: string; content: string }>, maxChars = 20000): string {
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

// Main pipeline action
export const runPipelineAction = internalAction({
  args: {
    sessionId: v.id("teamSessions"),
    userId: v.id("users"),
  },
  handler: async (ctx, args): Promise<void> => {
    const { sessionId, userId } = args;

    // Load credentials
    const geminiKeys = await ctx.runQuery(internal.admin.getGeminiKeysInternal, {}) as string[];
    const dbCreds = await ctx.runQuery(internal.admin.getAwsCredentialsInternal, {}) as { accessKeyId: string; secretAccessKey: string; region: string } | null;

    // Check platform budget
    const budgetExhausted = await ctx.runQuery(internal.admin.isPlatformBudgetExhausted, {}) as boolean;
    if (budgetExhausted) {
      await ctx.runMutation(internal.agentTeamHelpers.saveAgentMessage, {
        sessionId, userId, agent: "System",
        content: "⚠️ Platform budget exhausted. Please contact support.",
        round: 0, messageIndex: 999,
      });
      await ctx.runMutation(internal.agentTeamHelpers.forceIdleSession, { sessionId });
      return;
    }

    // Load session
    const session = await ctx.runQuery(internal.agentTeamHelpers.getSession, { sessionId });
    if (!session) return;

    const task = session.task;
    const currentPhase = session.phase ?? "Researcher";
    let round = session.round ?? 0;
    let loopCount = session.loopCount ?? 0;
    let totalMessages = session.totalMessages ?? 1;
    let executionPhase = session.executionPhase ?? "planning";
    const currentTaskIndex = session.currentTaskIndex ?? 0;
    let taskDifficulty: TaskDifficulty = (session as Record<string, unknown>).currentTaskDifficulty as TaskDifficulty ?? "normal";

    // The Dispatcher's previously saved agent picks (empty = full pipeline)
    let dispatchedAgents: string[] = [];
    try {
      if (session.dispatchedAgentsJson) {
        dispatchedAgents = JSON.parse(session.dispatchedAgentsJson);
      }
    } catch { /* ignored — falls back to the full pipeline */ }

    // Mark session as running
    await ctx.runMutation(internal.agentTeamHelpers.updateSessionStatus, {
      sessionId, status: "running", currentAgent: currentPhase,
      round, loopCount, phase: currentPhase, totalMessages,
    });

    try {
      const messages = await ctx.runQuery(internal.agentTeamHelpers.getSessionMessages, { sessionId }) as Array<{ agent: string; content: string; round?: number; messageIndex?: number }>;
      const files = await ctx.runQuery(internal.agentTeamHelpers.getFiles, { sessionId }) as Array<{ filepath: string; content: string }>;

      const context = buildContext(messages);
      const fileContext = buildFileContext(files);

      // ── Dispatcher phase ────────────────────────────────────────────────
      // Runs once at the very start of a task to pick the minimum agent set.
      if (executionPhase === "dispatching" || currentPhase === "Dispatcher") {
        const dispatchPrompt = `## Task to analyse\n${task}\n\n## Existing project files\n${files.length > 0 ? files.map(f => `- ${f.filepath}`).join("\n") : "None (greenfield project)"}`;
        const dispatchTier = AGENT_MODEL_MAP["Dispatcher"] as ModelTier ?? "haiku";
        const dispatchResult = await callModel(dispatchPrompt, AGENT_SYSTEM_PROMPTS["Dispatcher"] ?? "", dispatchTier, geminiKeys, dbCreds);

        const ab = calcAgentBucksForTier(dispatchTier, dispatchResult.inputTokens, dispatchResult.outputTokens);
        await ctx.runMutation(internal.sandboxHelpers.deductAgentBucks, { userId, agentBucksToDeduct: ab });
        await ctx.runMutation(internal.admin.deductPlatformCost, {
          modelName: `dispatcher-${dispatchTier}`, inputTokens: dispatchResult.inputTokens, outputTokens: dispatchResult.outputTokens,
        });

        const dispatched = parseDispatcherOutput(dispatchResult.text);
        const agents = dispatched?.agents ?? ["Analyser", "Planner", "Coder", "Tester", "Critic"];
        const tier = dispatched?.tier ?? "medium";

        await ctx.runMutation(internal.agentTeamHelpers.setDispatchedAgents, {
          sessionId,
          agentsJson: JSON.stringify(agents),
        });
        dispatchedAgents = agents;

        // Visible routing decision, so the user sees why the pipeline is lean
        totalMessages++;
        await ctx.runMutation(internal.agentTeamHelpers.saveAgentMessage, {
          sessionId, userId, agent: "Dispatcher",
          content: `**Task complexity: ${tier}**\nRunning agents: ${agents.join(" → ")}`,
          round, messageIndex: totalMessages,
        });

        const planningAgents = buildPlanningPipeline(agents);
        if (planningAgents.length > 0) {
          // Planning agents selected — run the planning phase first
          round++;
          await ctx.runMutation(internal.agentTeamHelpers.updateSessionFull, {
            sessionId, status: "idle", currentAgent: planningAgents[0],
            phase: planningAgents[0], totalMessages, executionPhase: "planning",
            currentTaskIndex: 0, loopCount,
          });
        } else {
          // Trivial/simple task — skip planning, run the task pipeline against
          // a single synthetic task so the Coder has a well-defined prompt.
          await ctx.runMutation(internal.agentTeamHelpers.updatePlannerTasks, {
            sessionId,
            plannerTasksJson: JSON.stringify([{ id: "task-1", title: task.slice(0, 120), description: task }]),
          });
          const taskAgents = buildTaskPipeline(agents);
          round++;
          await ctx.runMutation(internal.agentTeamHelpers.updateSessionFull, {
            sessionId, status: "idle", currentAgent: taskAgents[0] ?? "Coder",
            phase: taskAgents[0] ?? "Coder", totalMessages, executionPhase: "executing",
            currentTaskIndex: 0, loopCount,
          });
        }
        await ctx.scheduler.runAfter(0, internal.agentPipeline.runPipelineAction, { sessionId, userId });
        return;
      }

      // ── Normal pipeline phases ──────────────────────────────────────────
      const isPlanning = executionPhase === "planning";
      const currentPipeline = isPlanning
        ? buildPlanningPipeline(dispatchedAgents)
        : buildTaskPipeline(dispatchedAgents);
      const phaseIndex = currentPipeline.indexOf(currentPhase);

      if (phaseIndex === -1) {
        await ctx.runMutation(internal.agentTeamHelpers.updateSessionFull, {
          sessionId, status: "completed", currentAgent: undefined,
          phase: "Critic", totalMessages, executionPhase: "completed",
          currentTaskIndex, clearPlannerTasks: false,
        });
        return;
      }

      let agentOutput = "";
      let agentName = currentPhase;

      if (currentPhase === "Researcher") {
        let researchTask = task;
        if (executionPhase === "executing") {
          let plannerTasks: Array<{ id: string; title: string; description: string }> = [];
          try {
            plannerTasks = JSON.parse((session as Record<string, unknown>).plannerTasksJson as string ?? "[]") as typeof plannerTasks;
          } catch { /* ignore */ }
          const currentTask = plannerTasks[currentTaskIndex];
          if (currentTask) {
            researchTask = `## Overall Project\n${task}\n\n## Current Task (${currentTaskIndex + 1}/${plannerTasks.length})\n**${currentTask.title}**\n${currentTask.description}\n\nResearch specifically for this task.`;
          }
        }
        agentOutput = await runResearchTeam(ctx, sessionId, userId, researchTask, context, geminiKeys, dbCreds);
        agentName = "Researcher";
      } else if (currentPhase === "Hacker") {
        let securityTask = task;
        if (executionPhase === "executing") {
          let plannerTasks: Array<{ id: string; title: string; description: string }> = [];
          try {
            plannerTasks = JSON.parse((session as Record<string, unknown>).plannerTasksJson as string ?? "[]") as typeof plannerTasks;
          } catch { /* ignore */ }
          const currentTask = plannerTasks[currentTaskIndex];
          if (currentTask) {
            securityTask = `## Overall Project\n${task}\n\n## Current Task (${currentTaskIndex + 1}/${plannerTasks.length})\n**${currentTask.title}**\n${currentTask.description}\n\nSecurity review specifically for this task's changes.`;
          }
        }
        agentOutput = await runSecurityTeam(ctx, sessionId, userId, securityTask, context, fileContext, geminiKeys, dbCreds);
        agentName = "Hacker";
      } else if (currentPhase === "Planner") {
        const systemPrompt = AGENT_SYSTEM_PROMPTS["Planner"] ?? "";
        const prompt = `## Task\n${task}\n\n## Research Context\n${context}\n\n## Current Files\n${fileContext}`;
        const tier = AGENT_MODEL_MAP["Planner"] as ModelTier ?? "haiku";
        const result = await callModel(prompt, systemPrompt, tier, geminiKeys, dbCreds);
        agentOutput = result.text;

        const plannerOutput = parsePlannerOutput(agentOutput);
        if (plannerOutput && plannerOutput.tasks.length > 0) {
          await ctx.runMutation(internal.agentTeamHelpers.updatePlannerTasks, {
            sessionId,
            plannerTasksJson: JSON.stringify(plannerOutput.tasks),
          });
          const difficulty = parseDifficultyFromPlannerOutput(agentOutput);
          taskDifficulty = difficulty;
          await ctx.runMutation(internal.agentTeamHelpers.updateTaskDifficulty, {
            sessionId, difficulty,
          });
        }

        const ab = calcAgentBucksForTier(tier, result.inputTokens, result.outputTokens);
        await ctx.runMutation(internal.sandboxHelpers.deductAgentBucks, { userId, agentBucksToDeduct: ab });
        await ctx.runMutation(internal.admin.deductPlatformCost, {
          modelName: `planner-${tier}`, inputTokens: result.inputTokens, outputTokens: result.outputTokens,
        });
      } else if (currentPhase === "Coder") {
        let plannerTasks: Array<{ id: string; title: string; description: string }> = [];
        try {
          plannerTasks = JSON.parse((session as Record<string, unknown>).plannerTasksJson as string ?? "[]") as typeof plannerTasks;
        } catch { /* ignore */ }

        const currentTask = plannerTasks[currentTaskIndex];
        const systemPrompt = AGENT_SYSTEM_PROMPTS["Coder"] ?? "";
        let prompt = "";

        if (currentTask) {
          prompt = `## Overall Project Task\n${task}\n\n## Current Task (${currentTaskIndex + 1}/${plannerTasks.length})\n**${currentTask.title}**\n${currentTask.description}\n\n## Context from Previous Agents in THIS Task Loop\n${context}\n\n## Current Files\n${fileContext}`;
        } else {
          prompt = `## Task\n${task}\n\n## Context\n${context}\n\n## Current Files\n${fileContext}`;
        }

        const tier = DIFFICULTY_CODER_MODEL[taskDifficulty] as ModelTier ?? "opus46";
        const result = await callModel(prompt, systemPrompt, tier, geminiKeys, dbCreds);
        agentOutput = result.text;

        const ab = calcAgentBucksForTier(tier, result.inputTokens, result.outputTokens);
        await ctx.runMutation(internal.sandboxHelpers.deductAgentBucks, { userId, agentBucksToDeduct: ab });
        await ctx.runMutation(internal.admin.deductPlatformCost, {
          modelName: `coder-${tier}`, inputTokens: result.inputTokens, outputTokens: result.outputTokens,
        });
      } else {
        const systemPrompt = AGENT_SYSTEM_PROMPTS[currentPhase] ?? `You are the ${currentPhase} agent. Complete your role for this task.`;

        let prompt = "";
        if (executionPhase === "executing") {
          let plannerTasks: Array<{ id: string; title: string; description: string }> = [];
          try {
            plannerTasks = JSON.parse((session as Record<string, unknown>).plannerTasksJson as string ?? "[]") as typeof plannerTasks;
          } catch { /* ignore */ }

          const currentTask = plannerTasks[currentTaskIndex];
          if (currentTask) {
            prompt = `## Overall Project Task\n${task}\n\n## Current Task (${currentTaskIndex + 1}/${plannerTasks.length})\n**${currentTask.title}**\n${currentTask.description}\n\n## Context from Previous Agents in THIS Task Loop\n${context}\n\n## Current Files\n${fileContext}`;
          } else {
            prompt = `## Task\n${task}\n\n## Context\n${context}\n\n## Current Files\n${fileContext}`;
          }
        } else {
          prompt = `## Task\n${task}\n\n## Context\n${context}\n\n## Current Files\n${fileContext}`;
        }

        const tier = AGENT_MODEL_MAP[currentPhase] as ModelTier ?? "haiku";
        const result = await callModel(prompt, systemPrompt, tier, geminiKeys, dbCreds);
        agentOutput = result.text;

        const ab = calcAgentBucksForTier(tier, result.inputTokens, result.outputTokens);
        await ctx.runMutation(internal.sandboxHelpers.deductAgentBucks, { userId, agentBucksToDeduct: ab });
        await ctx.runMutation(internal.admin.deductPlatformCost, {
          modelName: `${currentPhase.toLowerCase()}-${tier}`, inputTokens: result.inputTokens, outputTokens: result.outputTokens,
        });
      }

      const parsed = parseAgentOutput(agentOutput);

      for (const op of parsed.fileOps) {
        if (op.type === "create" || op.type === "edit") {
          await ctx.runMutation(internal.agentTeamHelpers.upsertFile, {
            sessionId, userId, filepath: op.filepath, content: op.content ?? "", agent: agentName,
          });
        } else if (op.type === "delete") {
          await ctx.runMutation(internal.agentTeamHelpers.deleteFile, {
            sessionId, filepath: op.filepath,
          });
        }
      }

      if (parsed.deployCommands && parsed.deployCommands.length > 0) {
        await ctx.runMutation(internal.agentTeamHelpers.updateDeployCommands, {
          sessionId, deployCommandsJson: JSON.stringify(parsed.deployCommands),
        });
      }

      if (parsed.infoRequest) {
        await ctx.runMutation(internal.agentTeamHelpers.setInfoRequest, {
          sessionId, infoRequestJson: JSON.stringify(parsed.infoRequest),
        });
        totalMessages++;
        await ctx.runMutation(internal.agentTeamHelpers.saveAgentMessage, {
          sessionId, userId, agent: agentName, content: parsed.cleanContent,
          round, messageIndex: totalMessages,
        });
        await ctx.runMutation(internal.agentTeamHelpers.forceIdleSession, {
          sessionId, currentAgent: undefined, round, loopCount, phase: currentPhase, totalMessages,
        });
        return;
      }

      totalMessages++;
      await ctx.runMutation(internal.agentTeamHelpers.saveAgentMessage, {
        sessionId, userId, agent: agentName, content: parsed.cleanContent,
        round, messageIndex: totalMessages,
      });

      const nextPhaseIndex = phaseIndex + 1;
      loopCount++;

      if (isPlanning && currentPhase === "Planner") {
        // Reload tasks from DB (they were just saved by updatePlannerTasks)
        const freshSession = await ctx.runQuery(internal.agentTeamHelpers.getSession, { sessionId });
        let plannerTasks: Array<{ id: string; title: string; description: string }> = [];
        try {
          plannerTasks = JSON.parse((freshSession as Record<string, unknown>)?.plannerTasksJson as string ?? "[]") as typeof plannerTasks;
        } catch { /* ignore */ }

        if (plannerTasks.length === 0) {
          await ctx.runMutation(internal.agentTeamHelpers.updateSessionFull, {
            sessionId, status: "completed", currentAgent: undefined,
            phase: "Planner", totalMessages, executionPhase: "completed",
            currentTaskIndex: 0, loopCount, clearPlannerTasks: false,
          });
        } else {
          const firstTaskAgent = buildTaskPipeline(dispatchedAgents)[0] ?? "Coder";
          round++;
          await ctx.runMutation(internal.agentTeamHelpers.updateSessionFull, {
            sessionId, status: "idle", currentAgent: firstTaskAgent,
            phase: firstTaskAgent, totalMessages, executionPhase: "executing",
            currentTaskIndex: 0, loopCount,
          });
          // Self-chain to next agent
          await ctx.scheduler.runAfter(0, internal.agentPipeline.runPipelineAction, {
            sessionId, userId,
          });
        }
      } else if (nextPhaseIndex >= currentPipeline.length) {
        if (isPlanning) {
          await ctx.runMutation(internal.agentTeamHelpers.updateSessionFull, {
            sessionId, status: "completed", currentAgent: undefined,
            phase: currentPhase, totalMessages, executionPhase: "completed",
            currentTaskIndex, loopCount, clearPlannerTasks: false,
          });
        } else {
          let plannerTasks: Array<{ id: string; title: string; description: string }> = [];
          try {
            plannerTasks = JSON.parse((session as Record<string, unknown>).plannerTasksJson as string ?? "[]") as typeof plannerTasks;
          } catch { /* ignore */ }

          const nextTaskIndex = currentTaskIndex + 1;
          if (nextTaskIndex < plannerTasks.length) {
            const firstTaskAgent = buildTaskPipeline(dispatchedAgents)[0] ?? "Coder";
            round++;
            await ctx.runMutation(internal.agentTeamHelpers.updateSessionFull, {
              sessionId, status: "idle", currentAgent: firstTaskAgent,
              phase: firstTaskAgent, totalMessages, executionPhase: "executing",
              currentTaskIndex: nextTaskIndex, loopCount,
            });
            await ctx.scheduler.runAfter(0, internal.agentPipeline.runPipelineAction, {
              sessionId, userId,
            });
          } else {
            executionPhase = "completed";
            await ctx.runMutation(internal.agentTeamHelpers.updateSessionFull, {
              sessionId, status: "completed", currentAgent: undefined,
              phase: "Critic", totalMessages, executionPhase: "completed",
              currentTaskIndex: nextTaskIndex, loopCount, clearPlannerTasks: false,
            });
          }
        }
      } else {
        const nextPhase = currentPipeline[nextPhaseIndex];
        round++;
        await ctx.runMutation(internal.agentTeamHelpers.updateSessionFull, {
          sessionId, status: "idle", currentAgent: nextPhase,
          phase: nextPhase, totalMessages, executionPhase,
          currentTaskIndex, loopCount,
        });

        // Self-chain to next agent
        await ctx.scheduler.runAfter(0, internal.agentPipeline.runPipelineAction, {
          sessionId, userId,
        });
      }
    } catch (err) {
      console.error("Pipeline error:", err);
      const errMsg = err instanceof Error ? err.message : String(err);
      await ctx.runMutation(internal.agentTeamHelpers.saveAgentMessage, {
        sessionId, userId, agent: "System",
        content: `⚠️ Pipeline error: ${errMsg}`,
        round: 0, messageIndex: totalMessages + 1,
      });
      await ctx.runMutation(internal.agentTeamHelpers.forceIdleSession, {
        sessionId, currentAgent: undefined, round, loopCount, phase: currentPhase, totalMessages: totalMessages + 1,
      });
    }
  },
});

// Research Team runner
async function runResearchTeam(
  ctx: ActionCtx,
  sessionId: Id<"teamSessions">,
  userId: Id<"users">,
  task: string,
  context: string,
  geminiKeys: string[],
  dbCreds: { accessKeyId: string; secretAccessKey: string; region: string } | null,
): Promise<string> {
  let researchContext = context;
  let finalOutput = "";

  for (const subAgent of RESEARCH_SUB_AGENTS) {
    const systemPrompt = AGENT_SYSTEM_PROMPTS[subAgent] ?? `You are the ${subAgent} agent.`;
    const prompt = `## Task\n${task}\n\n## Context\n${researchContext}`;
    const tier = AGENT_MODEL_MAP[subAgent] as ModelTier ?? "gemini";
    const result = await callModel(prompt, systemPrompt, tier, geminiKeys, dbCreds);

    // Deduct credits
    const ab = calcAgentBucksForTier(tier, result.inputTokens, result.outputTokens);
    await ctx.runMutation(internal.sandboxHelpers.deductAgentBucks, { userId, agentBucksToDeduct: ab });
    await ctx.runMutation(internal.admin.deductPlatformCost, {
      modelName: `${subAgent.toLowerCase()}-${tier}`, inputTokens: result.inputTokens, outputTokens: result.outputTokens,
    });

    researchContext += `\n\n[${subAgent}]: ${result.text.slice(0, 8000)}`;
    finalOutput = result.text;
  }

  return finalOutput;
}

// Security Team runner
async function runSecurityTeam(
  ctx: ActionCtx,
  sessionId: Id<"teamSessions">,
  userId: Id<"users">,
  task: string,
  context: string,
  fileContext: string,
  geminiKeys: string[],
  dbCreds: { accessKeyId: string; secretAccessKey: string; region: string } | null,
): Promise<string> {
  let securityContext = context;
  let finalOutput = "";

  for (const subAgent of SECURITY_SUB_AGENTS) {
    const systemPrompt = AGENT_SYSTEM_PROMPTS[subAgent] ?? `You are the ${subAgent} security agent.`;
    const prompt = `## Task\n${task}\n\n## Files\n${fileContext}\n\n## Security Context\n${securityContext}`;
    const tier = AGENT_MODEL_MAP[subAgent] as ModelTier ?? "sonnet";
    const result = await callModel(prompt, systemPrompt, tier, geminiKeys, dbCreds);

    // Deduct credits
    const ab = calcAgentBucksForTier(tier, result.inputTokens, result.outputTokens);
    await ctx.runMutation(internal.sandboxHelpers.deductAgentBucks, { userId, agentBucksToDeduct: ab });
    await ctx.runMutation(internal.admin.deductPlatformCost, {
      modelName: `${subAgent.toLowerCase()}-${tier}`, inputTokens: result.inputTokens, outputTokens: result.outputTokens,
    });

    securityContext += `\n\n[${subAgent}]: ${result.text.slice(0, 4000)}`;
    finalOutput = result.text;

    // Apply file fixes from security agents
    const parsed = parseAgentOutput(result.text);
    for (const op of parsed.fileOps) {
      if (op.type === "create" || op.type === "edit") {
        await ctx.runMutation(internal.agentTeamHelpers.upsertFile, {
          sessionId, userId, filepath: op.filepath, content: op.content ?? "", agent: subAgent,
        });
      }
    }
  }

  return finalOutput;
}

// Public action: start pipeline
export const startPipelineAction = action({
  args: { token: v.string(), sessionId: v.id("teamSessions") },
  handler: async (ctx, args): Promise<void> => {
    // Authenticate
    const userId = await ctx.runQuery(internal.customAuthHelpers.getUserIdByToken, { token: args.token }) as Id<"users"> | null;
    if (!userId) throw new Error("Not authenticated");

    // Verify session ownership
    const session = await ctx.runQuery(internal.agentTeamHelpers.getSession, { sessionId: args.sessionId });
    if (!session || session.userId !== userId) throw new Error("Session not found");

    // Don't start if already running
    if (session.status === "running") return;

    // Schedule pipeline execution
    await ctx.scheduler.runAfter(0, internal.agentPipeline.runPipelineAction, {
      sessionId: args.sessionId, userId,
    });
  },
});