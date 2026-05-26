"use node";
import { action, internalAction } from "./_generated/server";
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

// ── Pipeline definition ───────────────────────────────────────────────────────
const PIPELINE = ["Researcher", "Analyser", "Planner", "Coder", "Optimiser", "Organizer", "Tester", "Hacker", "Critic"];

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

// ── Helper: build context string from messages ────────────────────────────────
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

// ── Helper: build file context ────────────────────────────────────────────────
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

// ── Main pipeline action ──────────────────────────────────────────────────────
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
    let currentPhase = session.phase ?? "Researcher";
    let round = session.round ?? 0;
    let loopCount = session.loopCount ?? 0;
    let totalMessages = session.totalMessages ?? 1;
    let executionPhase = session.executionPhase ?? "planning";
    let currentTaskIndex = session.currentTaskIndex ?? 0;
    let taskDifficulty: TaskDifficulty = (session as Record<string, unknown>).currentTaskDifficulty as TaskDifficulty ?? "normal";

    // Mark session as running
    await ctx.runMutation(internal.agentTeamHelpers.updateSessionStatus, {
      sessionId, status: "running", currentAgent: currentPhase,
      round, loopCount, phase: currentPhase, totalMessages,
    });

    try {
      // Load messages and files
      const messages = await ctx.runQuery(internal.agentTeamHelpers.getSessionMessages, { sessionId }) as Array<{ agent: string; content: string; round?: number; messageIndex?: number }>;
      const files = await ctx.runQuery(internal.agentTeamHelpers.getFiles, { sessionId }) as Array<{ filepath: string; content: string }>;

      const context = buildContext(messages);
      const fileContext = buildFileContext(files);

      // ── Determine which agent to run ──────────────────────────────────────
      const phaseIndex = PIPELINE.indexOf(currentPhase);
      if (phaseIndex === -1) {
        // Unknown phase — complete
        await ctx.runMutation(internal.agentTeamHelpers.updateSessionFull, {
          sessionId, status: "completed", currentAgent: undefined,
          phase: "Critic", totalMessages, executionPhase: "completed",
          currentTaskIndex, clearPlannerTasks: false,
        });
        return;
      }

      // ── Run the current agent ─────────────────────────────────────────────
      let agentOutput = "";
      let agentName = currentPhase;

      if (currentPhase === "Researcher") {
        // Run Research Team (3 sub-agents)
        agentOutput = await runResearchTeam(ctx, sessionId, userId, task, context, geminiKeys, dbCreds);
        agentName = "Researcher";
      } else if (currentPhase === "Hacker") {
        // Run Security Team
        agentOutput = await runSecurityTeam(ctx, sessionId, userId, task, context, fileContext, geminiKeys, dbCreds, taskDifficulty);
        agentName = "Hacker";
      } else if (currentPhase === "Planner") {
        // Run Planner — also parses tasks
        const systemPrompt = AGENT_SYSTEM_PROMPTS["Planner"] ?? "";
        const prompt = `## Task\n${task}\n\n## Research Context\n${context}\n\n## Current Files\n${fileContext}`;
        const tier = AGENT_MODEL_MAP["Planner"] as ModelTier ?? "haiku";
        const result = await callModel(prompt, systemPrompt, tier, geminiKeys, dbCreds);
        agentOutput = result.text;

        // Parse planner output for tasks
        const plannerOutput = parsePlannerOutput(agentOutput);
        if (plannerOutput && plannerOutput.tasks.length > 0) {
          await ctx.runMutation(internal.agentTeamHelpers.updatePlannerTasks, {
            sessionId,
            plannerTasksJson: JSON.stringify(plannerOutput.tasks),
          });
          // Parse difficulty
          const difficulty = parseDifficultyFromPlannerOutput(agentOutput);
          taskDifficulty = difficulty;
          await ctx.runMutation(internal.agentTeamHelpers.updateTaskDifficulty, {
            sessionId, difficulty,
          });
        }

        // Deduct credits
        const ab = calcAgentBucksForTier(tier, result.inputTokens, result.outputTokens);
        await ctx.runMutation(internal.sandboxHelpers.deductAgentBucks, { userId, agentBucksToDeduct: ab });
        await ctx.runMutation(internal.admin.deductPlatformCost, {
          modelName: `planner-${tier}`, inputTokens: result.inputTokens, outputTokens: result.outputTokens,
        });
      } else if (currentPhase === "Coder") {
        // Run Coder — task-by-task execution
        agentOutput = await runCoderAgent(ctx, sessionId, userId, task, context, fileContext, geminiKeys, dbCreds, taskDifficulty, currentTaskIndex);
      } else {
        // Standard agent
        const systemPrompt = AGENT_SYSTEM_PROMPTS[currentPhase] ?? `You are the ${currentPhase} agent. Complete your role for this task.`;
        const prompt = `## Task\n${task}\n\n## Context\n${context}\n\n## Current Files\n${fileContext}`;
        const tier = AGENT_MODEL_MAP[currentPhase] as ModelTier ?? "haiku";
        const result = await callModel(prompt, systemPrompt, tier, geminiKeys, dbCreds);
        agentOutput = result.text;

        // Deduct credits
        const ab = calcAgentBucksForTier(tier, result.inputTokens, result.outputTokens);
        await ctx.runMutation(internal.sandboxHelpers.deductAgentBucks, { userId, agentBucksToDeduct: ab });
        await ctx.runMutation(internal.admin.deductPlatformCost, {
          modelName: `${currentPhase.toLowerCase()}-${tier}`, inputTokens: result.inputTokens, outputTokens: result.outputTokens,
        });
      }

      // ── Parse agent output for file operations ────────────────────────────
      const parsed = parseAgentOutput(agentOutput);

      // Apply file operations
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

      // Handle deploy commands
      if (parsed.deployCommands && parsed.deployCommands.length > 0) {
        await ctx.runMutation(internal.agentTeamHelpers.updateDeployCommands, {
          sessionId, deployCommandsJson: JSON.stringify(parsed.deployCommands),
        });
      }

      // Handle info requests
      if (parsed.infoRequest) {
        await ctx.runMutation(internal.agentTeamHelpers.setInfoRequest, {
          sessionId, infoRequestJson: JSON.stringify(parsed.infoRequest),
        });
        // Save agent message and pause
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

      // Save agent message
      totalMessages++;
      await ctx.runMutation(internal.agentTeamHelpers.saveAgentMessage, {
        sessionId, userId, agent: agentName, content: parsed.cleanContent,
        round, messageIndex: totalMessages,
      });

      // ── Advance to next agent ─────────────────────────────────────────────
      const nextPhaseIndex = phaseIndex + 1;
      loopCount++;

      if (nextPhaseIndex >= PIPELINE.length) {
        // All agents done — complete
        executionPhase = "completed";
        await ctx.runMutation(internal.agentTeamHelpers.updateSessionFull, {
          sessionId, status: "completed", currentAgent: undefined,
          phase: "Critic", totalMessages, executionPhase: "completed",
          currentTaskIndex, loopCount, clearPlannerTasks: false,
        });
      } else {
        // Move to next agent
        const nextPhase = PIPELINE[nextPhaseIndex];
        round++;
        await ctx.runMutation(internal.agentTeamHelpers.updateSessionFull, {
          sessionId, status: "idle", currentAgent: nextPhase,
          phase: nextPhase, totalMessages, executionPhase: "executing",
          currentTaskIndex, loopCount,
        });

        // Schedule next agent round
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

// ── Research Team runner ──────────────────────────────────────────────────────
async function runResearchTeam(
  ctx: Parameters<typeof runPipelineAction["handler"]>[0],
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

// ── Security Team runner ──────────────────────────────────────────────────────
async function runSecurityTeam(
  ctx: Parameters<typeof runPipelineAction["handler"]>[0],
  sessionId: Id<"teamSessions">,
  userId: Id<"users">,
  task: string,
  context: string,
  fileContext: string,
  geminiKeys: string[],
  dbCreds: { accessKeyId: string; secretAccessKey: string; region: string } | null,
  difficulty: TaskDifficulty,
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

// ── Coder agent runner (task-by-task) ─────────────────────────────────────────
async function runCoderAgent(
  ctx: Parameters<typeof runPipelineAction["handler"]>[0],
  sessionId: Id<"teamSessions">,
  userId: Id<"users">,
  task: string,
  context: string,
  fileContext: string,
  geminiKeys: string[],
  dbCreds: { accessKeyId: string; secretAccessKey: string; region: string } | null,
  difficulty: TaskDifficulty,
  currentTaskIndex: number,
): Promise<string> {
  const session = await ctx.runQuery(internal.agentTeamHelpers.getSession, { sessionId });
  if (!session) return "Session not found";

  let plannerTasks: Array<{ id: string; title: string; description: string; subpart: boolean }> = [];
  try {
    plannerTasks = JSON.parse((session as Record<string, unknown>).plannerTasksJson as string ?? "[]") as typeof plannerTasks;
  } catch { /* ignore */ }

  if (plannerTasks.length === 0) {
    // No tasks — run coder on the full task
    const systemPrompt = AGENT_SYSTEM_PROMPTS["Coder"] ?? "";
    const prompt = `## Task\n${task}\n\n## Context\n${context}\n\n## Current Files\n${fileContext}`;
    const tier = DIFFICULTY_CODER_MODEL[difficulty] as ModelTier ?? "opus46";
    const result = await callModel(prompt, systemPrompt, tier, geminiKeys, dbCreds);

    const ab = calcAgentBucksForTier(tier, result.inputTokens, result.outputTokens);
    await ctx.runMutation(internal.sandboxHelpers.deductAgentBucks, { userId, agentBucksToDeduct: ab });
    await ctx.runMutation(internal.admin.deductPlatformCost, {
      modelName: `coder-${tier}`, inputTokens: result.inputTokens, outputTokens: result.outputTokens,
    });

    const parsed = parseAgentOutput(result.text);
    for (const op of parsed.fileOps) {
      if (op.type === "create" || op.type === "edit") {
        await ctx.runMutation(internal.agentTeamHelpers.upsertFile, {
          sessionId, userId, filepath: op.filepath, content: op.content ?? "", agent: "Coder",
        });
      } else if (op.type === "delete") {
        await ctx.runMutation(internal.agentTeamHelpers.deleteFile, { sessionId, filepath: op.filepath });
      }
    }

    return result.text;
  }

  // Run the current task
  const currentTask = plannerTasks[currentTaskIndex];
  if (!currentTask) {
    return `All ${plannerTasks.length} tasks completed.`;
  }

  const systemPrompt = AGENT_SYSTEM_PROMPTS["Coder"] ?? "";
  const taskPrompt = `## Overall Project Task\n${task}\n\n## Current Task (${currentTaskIndex + 1}/${plannerTasks.length})\n**${currentTask.title}**\n${currentTask.description}\n\n## Context from Previous Agents\n${context}\n\n## Current Files\n${fileContext}`;
  const tier = DIFFICULTY_CODER_MODEL[difficulty] as ModelTier ?? "opus46";
  const result = await callModel(taskPrompt, systemPrompt, tier, geminiKeys, dbCreds);

  const ab = calcAgentBucksForTier(tier, result.inputTokens, result.outputTokens);
  await ctx.runMutation(internal.sandboxHelpers.deductAgentBucks, { userId, agentBucksToDeduct: ab });
  await ctx.runMutation(internal.admin.deductPlatformCost, {
    modelName: `coder-${tier}`, inputTokens: result.inputTokens, outputTokens: result.outputTokens,
  });

  const parsed = parseAgentOutput(result.text);
  for (const op of parsed.fileOps) {
    if (op.type === "create" || op.type === "edit") {
      await ctx.runMutation(internal.agentTeamHelpers.upsertFile, {
        sessionId, userId, filepath: op.filepath, content: op.content ?? "", agent: "Coder",
      });
    } else if (op.type === "delete") {
      await ctx.runMutation(internal.agentTeamHelpers.deleteFile, { sessionId, filepath: op.filepath });
    }
  }

  // Advance task index if there are more tasks
  const nextTaskIndex = currentTaskIndex + 1;
  if (nextTaskIndex < plannerTasks.length) {
    await ctx.runMutation(internal.agentTeamHelpers.updateSessionFull, {
      sessionId, status: "running", currentAgent: "Coder",
      phase: "Coder", totalMessages: (session.totalMessages ?? 1) + 1,
      executionPhase: "executing", currentTaskIndex: nextTaskIndex,
    });
    // Schedule next task
    await ctx.scheduler.runAfter(0, internal.agentPipeline.runCoderTaskAction, {
      sessionId, userId, taskIndex: nextTaskIndex,
    });
  }

  return result.text;
}

// ── Public action: start pipeline ─────────────────────────────────────────────
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

// ── Internal action: run a specific coder task ────────────────────────────────
export const runCoderTaskAction = internalAction({
  args: {
    sessionId: v.id("teamSessions"),
    userId: v.id("users"),
    taskIndex: v.number(),
  },
  handler: async (ctx, args): Promise<void> => {
    const { sessionId, userId, taskIndex } = args;

    const geminiKeys = await ctx.runQuery(internal.admin.getGeminiKeysInternal, {}) as string[];
    const dbCreds = await ctx.runQuery(internal.admin.getAwsCredentialsInternal, {}) as { accessKeyId: string; secretAccessKey: string; region: string } | null;

    const session = await ctx.runQuery(internal.agentTeamHelpers.getSession, { sessionId });
    if (!session) return;

    const messages = await ctx.runQuery(internal.agentTeamHelpers.getSessionMessages, { sessionId }) as Array<{ agent: string; content: string }>;
    const files = await ctx.runQuery(internal.agentTeamHelpers.getFiles, { sessionId }) as Array<{ filepath: string; content: string }>;

    const context = buildContext(messages);
    const fileContext = buildFileContext(files);
    const taskDifficulty: TaskDifficulty = (session as Record<string, unknown>).currentTaskDifficulty as TaskDifficulty ?? "normal";

    let plannerTasks: Array<{ id: string; title: string; description: string; subpart: boolean }> = [];
    try {
      plannerTasks = JSON.parse((session as Record<string, unknown>).plannerTasksJson as string ?? "[]") as typeof plannerTasks;
    } catch { /* ignore */ }

    const currentTask = plannerTasks[taskIndex];
    if (!currentTask) return;

    const systemPrompt = AGENT_SYSTEM_PROMPTS["Coder"] ?? "";
    const taskPrompt = `## Overall Project Task\n${session.task}\n\n## Current Task (${taskIndex + 1}/${plannerTasks.length})\n**${currentTask.title}**\n${currentTask.description}\n\n## Context\n${context}\n\n## Current Files\n${fileContext}`;
    const tier = DIFFICULTY_CODER_MODEL[taskDifficulty] as ModelTier ?? "opus46";

    try {
      const result = await callModel(taskPrompt, systemPrompt, tier, geminiKeys, dbCreds);

      const ab = calcAgentBucksForTier(tier, result.inputTokens, result.outputTokens);
      await ctx.runMutation(internal.sandboxHelpers.deductAgentBucks, { userId, agentBucksToDeduct: ab });
      await ctx.runMutation(internal.admin.deductPlatformCost, {
        modelName: `coder-task-${tier}`, inputTokens: result.inputTokens, outputTokens: result.outputTokens,
      });

      const parsed = parseAgentOutput(result.text);
      for (const op of parsed.fileOps) {
        if (op.type === "create" || op.type === "edit") {
          await ctx.runMutation(internal.agentTeamHelpers.upsertFile, {
            sessionId, userId, filepath: op.filepath, content: op.content ?? "", agent: "Coder",
          });
        } else if (op.type === "delete") {
          await ctx.runMutation(internal.agentTeamHelpers.deleteFile, { sessionId, filepath: op.filepath });
        }
      }

      const totalMessages = (session.totalMessages ?? 1) + 1;
      await ctx.runMutation(internal.agentTeamHelpers.saveAgentMessage, {
        sessionId, userId, agent: "Coder", content: parsed.cleanContent,
        round: session.round ?? 0, messageIndex: totalMessages,
      });

      const nextTaskIndex = taskIndex + 1;
      if (nextTaskIndex < plannerTasks.length) {
        await ctx.runMutation(internal.agentTeamHelpers.updateSessionFull, {
          sessionId, status: "running", currentAgent: "Coder",
          phase: "Coder", totalMessages, executionPhase: "executing",
          currentTaskIndex: nextTaskIndex,
        });
        await ctx.scheduler.runAfter(0, internal.agentPipeline.runCoderTaskAction, {
          sessionId, userId, taskIndex: nextTaskIndex,
        });
      } else {
        // All tasks done — move to Optimiser
        const nextPhase = "Optimiser";
        await ctx.runMutation(internal.agentTeamHelpers.updateSessionFull, {
          sessionId, status: "idle", currentAgent: nextPhase,
          phase: nextPhase, totalMessages, executionPhase: "executing",
          currentTaskIndex: nextTaskIndex,
        });
        await ctx.scheduler.runAfter(0, internal.agentPipeline.runPipelineAction, {
          sessionId, userId,
        });
      }
    } catch (err) {
      console.error("Coder task error:", err);
      const errMsg = err instanceof Error ? err.message : String(err);
      await ctx.runMutation(internal.agentTeamHelpers.saveAgentMessage, {
        sessionId, userId, agent: "System",
        content: `⚠️ Coder task ${taskIndex + 1} error: ${errMsg}`,
        round: 0, messageIndex: (session.totalMessages ?? 1) + 1,
      });
      await ctx.runMutation(internal.agentTeamHelpers.forceIdleSession, { sessionId });
    }
  },
});
