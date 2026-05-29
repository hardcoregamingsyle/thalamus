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
const PLANNING_PIPELINE = ["Researcher", "Analyser", "Planner"];
const TASK_PIPELINE = ["Researcher", "Analyser", "Coder", "Optimiser", "Organizer", "Tester", "Hacker", "Critic"];

const RESEARCH_SUB_AGENTS = ["ResearchPlanner", "DataTaker", "ResearchOrganiser"];
const SECURITY_SUB_AGENTS = [
  "VulnerabilitySpotter", "VulnerabilityFixer",
  "DataCorruptor", "DataFixer",
  "ZeroDayExploiter", "ZeroDayRemover",
  "FrameworkAuditor", "FrameworkRefiner",
  "RedTeamOrchestrator",
];

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

// ── Parse commands from agent output ──────────────────────────────────────────
function parseCommands(content: string): string[] {
  const commands: string[] = [];
  const regex = /<<RUN-COMMAND="([^"]+)">>/g;
  let match;
  while ((match = regex.exec(content)) !== null) {
    commands.push(match[1]);
  }
  return commands;
}

// ── Parse API key requests from agent output ──────────────────────────────────
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

// ── Main pipeline runner ──────────────────────────────────────────────────────
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
    const branch = await ctx.runQuery(internal.codeBranches.getBranchInternal, { branchId }) as any;
    if (!branch) return;

    // Check if paused for commands
    const pendingCommands = await ctx.runQuery(internal.codeCommands.getPendingCommands, { branchId }) as any[];
    if (pendingCommands.length > 0) {
      // Still waiting for commands to complete
      await ctx.runMutation(internal.codeBranches.updateBranchStatus, {
        branchId,
        status: "paused",
      });
      return;
    }

    // Check if paused for API keys
    const pendingKeyRequests = await ctx.runQuery(internal.codeApiKeys.getPendingRequests, { branchId }) as any[];
    if (pendingKeyRequests.length > 0) {
      // Still waiting for API keys
      await ctx.runMutation(internal.codeBranches.updateBranchStatus, {
        branchId,
        status: "paused",
      });
      return;
    }

    const task = args.userPrompt || "Continue working on the project";
    let currentPhase = branch.phase ?? "Researcher";
    let round = branch.round ?? 0;
    let totalMessages = branch.totalMessages ?? 0;
    let executionPhase = branch.executionPhase ?? "planning";
    let currentTaskIndex = branch.currentTaskIndex ?? 0;
    let taskDifficulty: TaskDifficulty = branch.currentTaskDifficulty ?? "normal";

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
      // Load messages and files
      const messages = await ctx.runQuery(internal.codeBranches.getMessagesInternal, { branchId }) as any[];
      const files = await ctx.runQuery(internal.codeBranches.getFilesInternal, { branchId }) as any[];

      const context = buildContext(messages);
      const fileContext = buildFileContext(files);

      // Determine pipeline
      const isPlanning = executionPhase === "planning";
      const currentPipeline = isPlanning ? PLANNING_PIPELINE : TASK_PIPELINE;
      const phaseIndex = currentPipeline.indexOf(currentPhase);

      if (phaseIndex === -1) {
        await ctx.runMutation(internal.codeBranches.updateBranchStatus, {
          branchId,
          status: "completed",
          executionPhase: "completed",
        });
        return;
      }

      // ── Run the current agent ─────────────────────────────────────────────
      let agentOutput = "";
      let agentName = currentPhase;

      if (currentPhase === "Planner") {
        const systemPrompt = AGENT_SYSTEM_PROMPTS["Planner"] ?? "";
        const prompt = `## Task\n${task}\n\n## Context\n${context}\n\n## Current Files\n${fileContext}`;
        const tier = AGENT_MODEL_MAP["Planner"] as ModelTier ?? "haiku";
        const result = await callModel(prompt, systemPrompt, tier, geminiKeys, dbCreds);
        agentOutput = result.text;

        const plannerOutput = parsePlannerOutput(agentOutput);
        if (plannerOutput && plannerOutput.tasks.length > 0) {
          // Save tasks to branch
          await ctx.runMutation(internal.codeBranches.updatePlannerTasks, {
            branchId,
            plannerTasksJson: JSON.stringify(plannerOutput.tasks),
          });

          const difficulty = parseDifficultyFromPlannerOutput(agentOutput);
          taskDifficulty = difficulty;
        }

        // Deduct credits (implement this in your system)
        const ab = calcAgentBucksForTier(tier, result.inputTokens, result.outputTokens);
      } else {
        // Run standard agent
        const systemPrompt = AGENT_SYSTEM_PROMPTS[currentPhase] ?? `You are the ${currentPhase} agent.`;
        let prompt = `## Task\n${task}\n\n## Context\n${context}\n\n## Current Files\n${fileContext}`;

        if (executionPhase === "executing") {
          // Add task-specific context
          let plannerTasks: Array<{ title: string; description: string }> = [];
          try {
            plannerTasks = JSON.parse(branch.plannerTasksJson || "[]");
          } catch {}

          const currentTask = plannerTasks[currentTaskIndex];
          if (currentTask) {
            prompt = `## Overall Project\n${task}\n\n## Current Task (${currentTaskIndex + 1}/${plannerTasks.length})\n**${currentTask.title}**\n${currentTask.description}\n\n## Context\n${context}\n\n## Files\n${fileContext}\n\n## Commands\nYou can run commands using: <<RUN-COMMAND="your command">>\n\n## API Keys\nYou can request API keys using: <<REQUEST-API-KEY name="VAR_NAME" description="What this key is for" howToGet="How to obtain this key">>`;
          }
        }

        const tier = AGENT_MODEL_MAP[currentPhase] as ModelTier ?? "haiku";
        const result = await callModel(prompt, systemPrompt, tier, geminiKeys, dbCreds);
        agentOutput = result.text;
      }

      // ── Parse and handle commands ─────────────────────────────────────────
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

      // ── Parse and handle API key requests ─────────────────────────────────
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

      // ── Parse file operations ─────────────────────────────────────────────
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

      // ── Advance pipeline ──────────────────────────────────────────────────
      const nextPhaseIndex = phaseIndex + 1;

      if (isPlanning && currentPhase === "Planner") {
        // Planning done, start executing tasks
        let plannerTasks: Array<any> = [];
        try {
          plannerTasks = JSON.parse(branch.plannerTasksJson || "[]");
        } catch {}

        if (plannerTasks.length > 0) {
          round++;
          await ctx.runMutation(internal.codeBranches.updateBranchStatus, {
            branchId,
            status: "idle",
            currentAgent: "Researcher",
            phase: "Researcher",
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
          let plannerTasks: Array<any> = [];
          try {
            plannerTasks = JSON.parse(branch.plannerTasksJson || "[]");
          } catch {}

          const nextTaskIndex = currentTaskIndex + 1;
          if (nextTaskIndex < plannerTasks.length) {
            // More tasks
            round++;
            await ctx.runMutation(internal.codeBranches.updateBranchStatus, {
              branchId,
              status: "idle",
              currentAgent: "Researcher",
              phase: "Researcher",
              executionPhase: "executing",
              round,
              totalMessages,
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

// ── Public action: start pipeline ─────────────────────────────────────────────
export const startPipeline = action({
  args: { token: v.string(), branchId: v.string(), userPrompt: v.optional(v.string()) },
  handler: async (ctx, args): Promise<void> => {
    // Verify authentication and ownership
    const sessions = await ctx.runQuery(internal.customAuthHelpers.getUserIdByToken, { token: args.token }) as any;
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

// ── Public action: stop pipeline ──────────────────────────────────────────────
export const stopPipeline = action({
  args: { token: v.string(), branchId: v.string() },
  handler: async (ctx, args): Promise<void> => {
    const userId = await ctx.runQuery(internal.customAuthHelpers.getUserIdByToken, { token: args.token }) as any;
    if (!userId) throw new Error("Not authenticated");

    await ctx.runMutation(internal.codeBranches.updateBranchStatus, {
      branchId: args.branchId,
      status: "idle",
      currentAgent: undefined,
    });

    await ctx.runMutation(internal.codeBranches.saveMessage, {
      branchId: args.branchId,
      agent: "System",
      content: "⏹️ Pipeline stopped by user.",
    });
  },
});