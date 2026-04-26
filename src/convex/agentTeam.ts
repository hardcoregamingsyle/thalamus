"use node";
import { action } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { Id } from "./_generated/dataModel";
import { callGemini, performSearch, parseAgentOutput, AGENT_SYSTEM_PROMPTS } from "./agentCore";

const PIPELINE = ["Analyser", "Coder", "Optimiser", "Tester", "Hacker", "Critic"];
const MAX_MESSAGES = 60;
const RAG_BASE_URL = "https://leadshello-graph-rag-and-chroma-db.hf.space";
const DAYTONA_API = "https://app.daytona.io/api";
const DAYTONA_API_KEY_FALLBACK = "dtn_7f36b63fc707555bd843029875fb29caf44e4607c2b3ab29a28c73c737e450b5";
const MAX_CMD_LOOPS = 10; // max sandbox command iterations per agent round

type SessionRow = {
  _id: Id<"teamSessions">;
  title: string;
  status: string;
  round?: number;
  loopCount?: number;
  phase?: string;
  totalMessages?: number;
  task: string;
  currentAgent?: string;
  userId: Id<"users">;
};
type MsgRow = { _id: Id<"agentMessages">; agent: string; content: string; round?: number; messageIndex?: number };
type FileRow = { _id: Id<"projectFiles">; filepath: string; content: string; lastModifiedBy: string };
type SandboxDbRow = { _id: Id<"sandboxes">; sandboxId: string; lastCommand?: string; lastOutput?: string; status: string; createdAt: number };

interface DaytonaExecResponse {
  result?: string;
  exitCode?: number;
}

async function executeSandboxCommand(sandboxId: string, command: string): Promise<{ output: string; exitCode: number }> {
  const apiKey = process.env.DAYTONA_API_KEY || DAYTONA_API_KEY_FALLBACK;

  // Always run commands from /workspace directory
  const wrappedCommand = command.startsWith("cd ") ? command : `cd /workspace && ${command}`;

  try {
    const res = await fetch(`${DAYTONA_API}/toolbox/${sandboxId}/toolbox/process/execute`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "Accept": "application/json",
      },
      body: JSON.stringify({ command: wrappedCommand }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { output: `[SANDBOX ERROR ${res.status}: ${text.slice(0, 200)}]`, exitCode: 1 };
    }
    const data = await res.json() as DaytonaExecResponse;
    return { output: data.result ?? "", exitCode: data.exitCode ?? 0 };
  } catch (err) {
    return { output: `[SANDBOX EXCEPTION: ${err instanceof Error ? err.message : String(err)}]`, exitCode: 1 };
  }
}

export const ragAddDocument = action({
  args: { id: v.string(), text: v.string(), token: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const userId = (await ctx.runQuery(internal.customAuthHelpers.getUserIdByToken, { token: args.token || "" })) as Id<"users"> | null;
    if (!userId) throw new Error("Not authenticated");
    const response = await fetch(`${RAG_BASE_URL}/add_document`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: args.id, text: args.text }),
    });
    if (!response.ok) throw new Error(`RAG add_document failed: ${await response.text()}`);
    return await response.json();
  },
});

export const ragRunIndex = action({
  args: { token: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const userId = (await ctx.runQuery(internal.customAuthHelpers.getUserIdByToken, { token: args.token || "" })) as Id<"users"> | null;
    if (!userId) throw new Error("Not authenticated");
    const response = await fetch(`${RAG_BASE_URL}/run_graphrag_index`, { method: "POST", headers: { "Content-Type": "application/json" } });
    if (!response.ok) throw new Error(`GraphRAG indexing failed: ${await response.text()}`);
    return await response.json();
  },
});

export const ragQueryVector = action({
  args: { query: v.string(), nResults: v.optional(v.number()), token: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const userId = (await ctx.runQuery(internal.customAuthHelpers.getUserIdByToken, { token: args.token || "" })) as Id<"users"> | null;
    if (!userId) throw new Error("Not authenticated");
    const params = new URLSearchParams({ query: args.query, n_results: String(args.nResults ?? 3) });
    const response = await fetch(`${RAG_BASE_URL}/query_vector?${params.toString()}`);
    if (!response.ok) throw new Error(`ChromaDB query failed: ${await response.text()}`);
    return await response.json();
  },
});

export const createSession = action({
  args: { task: v.string(), token: v.optional(v.string()) },
  handler: async (ctx, args): Promise<Id<"teamSessions">> => {
    const userId = (await ctx.runQuery(internal.customAuthHelpers.getUserIdByToken, { token: args.token || "" })) as Id<"users"> | null;
    if (!userId) throw new Error("Not authenticated");
    return (await ctx.runMutation(internal.agentTeamHelpers.createSessionMutation, {
      userId, task: args.task, title: args.task.slice(0, 60),
    })) as Id<"teamSessions">;
  },
});

export const runAgentRound = action({
  args: { sessionId: v.id("teamSessions"), token: v.optional(v.string()) },
  handler: async (ctx, args): Promise<{ agent: string; content: string; done: boolean; nextAgent: string; loopCount: number; totalMessages: number; fileOpsCount: number }> => {
    const userId = (await ctx.runQuery(internal.customAuthHelpers.getUserIdByToken, { token: args.token || "" })) as Id<"users"> | null;
    if (!userId) throw new Error("Not authenticated");

    const session = (await ctx.runQuery(internal.agentTeamHelpers.getSession, { sessionId: args.sessionId })) as SessionRow | null;
    if (!session) throw new Error("Session not found");
    if (session.userId !== userId) throw new Error("Not authorized");
    if (session.status === "completed") throw new Error("Session already completed");

    const totalMessages = session.totalMessages ?? 0;
    if (totalMessages >= MAX_MESSAGES) {
      await ctx.runMutation(internal.agentTeamHelpers.updateSessionStatus, {
        sessionId: args.sessionId, status: "completed", currentAgent: undefined,
        round: session.round, loopCount: session.loopCount, phase: "completed", totalMessages,
      });
      throw new Error("Maximum message limit (60) reached");
    }

    const currentPhase = session.phase ?? "Analyser";
    const loopCount = session.loopCount ?? 0;

    const prevMessages = (await ctx.runQuery(internal.agentTeamHelpers.getSessionMessages, { sessionId: args.sessionId })) as MsgRow[];
    const projectFiles = (await ctx.runQuery(internal.agentTeamHelpers.getFiles, { sessionId: args.sessionId })) as FileRow[];

    const contextLines = prevMessages.map((m) => `[${m.agent}]: ${m.content}`).join("\n\n---\n\n");
    const filesContext = projectFiles.length > 0
      ? `\n\nCURRENT PROJECT FILES (${projectFiles.length} files):\n` +
        projectFiles.map((f) => `--- ${f.filepath} ---\n${f.content.slice(0, 2000)}${f.content.length > 2000 ? "\n...(truncated)" : ""}`).join("\n\n")
      : "";

    // Fetch sandbox for non-Analyser agents
    let sandboxDbId: Id<"sandboxes"> | null = null;
    let sandboxDaytonaId: string | null = null;
    let sandboxContext = "";
    if (currentPhase !== "Analyser") {
      const sandbox = (await ctx.runQuery(internal.sandboxHelpers.getSandboxBySession, {
        sessionId: args.sessionId,
      })) as SandboxDbRow | null;
      if (sandbox && sandbox.status === "running") {
        sandboxDbId = sandbox._id;
        sandboxDaytonaId = sandbox.sandboxId;
        if (sandbox.lastCommand || sandbox.lastOutput) {
          sandboxContext = `\n\nLAST SANDBOX OUTPUT:\n$ ${sandbox.lastCommand ?? ""}\n${(sandbox.lastOutput ?? "").slice(0, 2000)}`;
        }
      }
    }

    const systemPrompt = AGENT_SYSTEM_PROMPTS[currentPhase] || AGENT_SYSTEM_PROMPTS["Analyser"];

    let prompt: string;
    if (prevMessages.length === 0) {
      prompt = `TASK: ${session.task}\n\nYou are the first agent. Provide your ${currentPhase} output.${filesContext}${sandboxContext}`;
    } else {
      prompt = `TASK: ${session.task}\n\nMESSAGE COUNT: ${totalMessages + 1}/${MAX_MESSAGES}\nLOOP: ${loopCount + 1}\n\nPREVIOUS DISCUSSION:\n${contextLines}${filesContext}${sandboxContext}\n\nNow provide your ${currentPhase} output, building on all previous work.`;
    }

    await ctx.runMutation(internal.agentTeamHelpers.updateSessionStatus, {
      sessionId: args.sessionId, status: "running", currentAgent: currentPhase,
      round: session.round, loopCount, phase: currentPhase, totalMessages,
    });

    let geminiResult = await callGemini(prompt, systemPrompt, 4096);
    let rawContent = geminiResult.text;
    let totalInputTokens = geminiResult.inputTokens;
    let totalOutputTokens = geminiResult.outputTokens;

    let parsed = parseAgentOutput(rawContent);

    // Handle search operations
    if (parsed.searchOps.length > 0) {
      const searchResults: string[] = [];
      for (const searchOp of parsed.searchOps) {
        const result = await performSearch(searchOp.query);
        searchResults.push(`SEARCH RESULT for "${searchOp.query}":\n${result}`);
      }
      const promptWithSearch = `${prompt}\n\nYour previous response requested searches. Here are the results:\n\n${searchResults.join("\n\n---\n\n")}\n\nNow provide your complete ${currentPhase} output incorporating these search results.`;
      const geminiResult2 = await callGemini(promptWithSearch, systemPrompt, 4096);
      rawContent = geminiResult2.text;
      totalInputTokens += geminiResult2.inputTokens;
      totalOutputTokens += geminiResult2.outputTokens;
      const reparsed = parseAgentOutput(rawContent);
      parsed = reparsed;
      parsed.fileOps.push(...reparsed.fileOps);
    }

    // Handle sandbox RUN-CMD loop (non-Analyser only, up to MAX_CMD_LOOPS iterations)
    if (currentPhase !== "Analyser" && sandboxDaytonaId && parsed.cmdOps.length > 0) {
      let cmdLoopCount = 0;
      let currentPrompt = prompt;
      let currentParsed = parsed;

      while (currentParsed.cmdOps.length > 0 && cmdLoopCount < MAX_CMD_LOOPS) {
        const cmdResults: string[] = [];

        for (const cmdOp of currentParsed.cmdOps) {
          const { output, exitCode } = await executeSandboxCommand(sandboxDaytonaId, cmdOp.command);
          const resultStr = `$ ${cmdOp.command}\n${output.slice(0, 2000)}${output.length > 2000 ? "\n...(truncated)" : ""}\n[exit code: ${exitCode}]`;
          cmdResults.push(resultStr);

          // Update sandbox record with last command/output
          if (sandboxDbId) {
            const elapsedHours = 0; // cost tracked separately per sandbox
            void elapsedHours;
            await ctx.runMutation(internal.sandboxHelpers.updateSandboxCommand, {
              sandboxDbId,
              lastCommand: cmdOp.command,
              lastOutput: output.slice(0, 2000),
              costCents: Math.round(elapsedHours * 7.5 * 100) / 100,
            });
          }
        }

        // Feed command results back to agent
        const promptWithCmds = `${currentPrompt}\n\nYour previous response ran sandbox commands. Here are the results:\n\n${cmdResults.join("\n\n---\n\n")}\n\nBased on these results, provide your updated ${currentPhase} output. If you need to run more commands, use RUN-CMD again. If done, provide your final output without any RUN-CMD commands.`;

        const geminiResultCmd = await callGemini(promptWithCmds, systemPrompt, 4096);
        rawContent = geminiResultCmd.text;
        totalInputTokens += geminiResultCmd.inputTokens;
        totalOutputTokens += geminiResultCmd.outputTokens;

        currentParsed = parseAgentOutput(rawContent);
        // Accumulate file ops from each iteration
        parsed.fileOps.push(...currentParsed.fileOps);
        parsed.cleanContent = currentParsed.cleanContent;
        Object.assign(parsed, {
          testerResult: currentParsed.testerResult ?? parsed.testerResult,
          testerFailReason: currentParsed.testerFailReason ?? parsed.testerFailReason,
          hackerResult: currentParsed.hackerResult ?? parsed.hackerResult,
          criticResult: currentParsed.criticResult ?? parsed.criticResult,
        });

        currentPrompt = promptWithCmds;
        cmdLoopCount++;
      }
    }

    // Execute file operations
    let fileOpsCount = 0;
    // Deduplicate file ops (last write wins per filepath)
    const fileOpsMap = new Map<string, typeof parsed.fileOps[0]>();
    for (const op of parsed.fileOps) {
      fileOpsMap.set(op.filepath, op);
    }
    for (const fileOp of fileOpsMap.values()) {
      if (fileOp.type === "create" || fileOp.type === "edit") {
        await ctx.runMutation(internal.agentTeamHelpers.upsertFile, {
          sessionId: args.sessionId,
          userId,
          filepath: fileOp.filepath,
          content: fileOp.content || "",
          agent: currentPhase,
        });
        fileOpsCount++;
      } else if (fileOp.type === "delete") {
        await ctx.runMutation(internal.agentTeamHelpers.deleteFile, {
          sessionId: args.sessionId,
          filepath: fileOp.filepath,
        });
        fileOpsCount++;
      }
    }

    const inputCostCents = (totalInputTokens / 1_000_000) * 35;
    const outputCostCents = (totalOutputTokens / 1_000_000) * 145;
    const costCents = Math.ceil(inputCostCents + outputCostCents);
    await ctx.runMutation(internal.sandboxHelpers.addUserCost, { userId, costCents });

    const newTotalMessages = totalMessages + 1;

    await ctx.runMutation(internal.agentTeamHelpers.saveAgentMessage, {
      sessionId: args.sessionId,
      userId,
      agent: currentPhase,
      content: parsed.cleanContent,
      round: loopCount,
      messageIndex: newTotalMessages,
    });

    let nextPhase: string;
    let newLoopCount = loopCount;
    let done = false;

    if (currentPhase === "Tester") {
      if (parsed.testerResult === "fail") { nextPhase = "Analyser"; newLoopCount = loopCount + 1; }
      else { nextPhase = "Hacker"; }
    } else if (currentPhase === "Hacker") {
      if (parsed.hackerResult === "fail") { nextPhase = "Analyser"; newLoopCount = loopCount + 1; }
      else { nextPhase = "Critic"; }
    } else if (currentPhase === "Critic") {
      if (parsed.criticResult === "fail") { nextPhase = "Analyser"; newLoopCount = loopCount + 1; }
      else { nextPhase = "completed"; done = true; }
    } else {
      const idx = PIPELINE.indexOf(currentPhase);
      nextPhase = PIPELINE[idx + 1] || "completed";
      if (nextPhase === "completed") done = true;
    }

    if (newTotalMessages >= MAX_MESSAGES) { done = true; nextPhase = "completed"; }

    await ctx.runMutation(internal.agentTeamHelpers.updateSessionStatus, {
      sessionId: args.sessionId,
      status: done ? "completed" : "idle",
      currentAgent: done ? undefined : nextPhase,
      round: PIPELINE.indexOf(nextPhase),
      loopCount: newLoopCount,
      phase: done ? "completed" : nextPhase,
      totalMessages: newTotalMessages,
    });

    return { agent: currentPhase, content: parsed.cleanContent, done, nextAgent: nextPhase, loopCount: newLoopCount, totalMessages: newTotalMessages, fileOpsCount };
  },
});

export const listSessions = action({
  args: { token: v.optional(v.string()) },
  handler: async (ctx, args): Promise<Array<{ _id: Id<"teamSessions">; title: string; status: string; round: number; task: string; phase: string; totalMessages: number; loopCount: number }>> => {
    const userId = (await ctx.runQuery(internal.customAuthHelpers.getUserIdByToken, { token: args.token || "" })) as Id<"users"> | null;
    if (!userId) return [];
    const sessions = (await ctx.runQuery(internal.agentTeamHelpers.listSessionsQuery, { userId })) as SessionRow[];
    return sessions.map((s) => ({ _id: s._id, title: s.title, status: s.status, round: s.round ?? 0, task: s.task, phase: s.phase ?? "Analyser", totalMessages: s.totalMessages ?? 0, loopCount: s.loopCount ?? 0 }));
  },
});

export const getSessionMessages2 = action({
  args: { sessionId: v.id("teamSessions"), token: v.optional(v.string()) },
  handler: async (ctx, args): Promise<Array<{ _id: string; agent: string; content: string; round?: number; messageIndex?: number }>> => {
    const userId = (await ctx.runQuery(internal.customAuthHelpers.getUserIdByToken, { token: args.token || "" })) as Id<"users"> | null;
    if (!userId) return [];
    const msgs = (await ctx.runQuery(internal.agentTeamHelpers.getSessionMessages, { sessionId: args.sessionId })) as MsgRow[];
    return msgs.map((m) => ({ _id: m._id as string, agent: m.agent, content: m.content, round: m.round, messageIndex: m.messageIndex }));
  },
});

export const getSessionInfo = action({
  args: { sessionId: v.id("teamSessions"), token: v.optional(v.string()) },
  handler: async (ctx, args): Promise<{ _id: Id<"teamSessions">; title: string; status: string; round: number; task: string; currentAgent?: string; phase: string; totalMessages: number; loopCount: number } | null> => {
    const userId = (await ctx.runQuery(internal.customAuthHelpers.getUserIdByToken, { token: args.token || "" })) as Id<"users"> | null;
    if (!userId) return null;
    const session = (await ctx.runQuery(internal.agentTeamHelpers.getSession, { sessionId: args.sessionId })) as SessionRow | null;
    if (!session) return null;
    return { _id: session._id, title: session.title, status: session.status, round: session.round ?? 0, task: session.task, currentAgent: session.currentAgent, phase: session.phase ?? "Analyser", totalMessages: session.totalMessages ?? 0, loopCount: session.loopCount ?? 0 };
  },
});

export const getProjectFiles = action({
  args: { sessionId: v.id("teamSessions"), token: v.optional(v.string()) },
  handler: async (ctx, args): Promise<Array<{ filepath: string; content: string; lastModifiedBy: string }>> => {
    const userId = (await ctx.runQuery(internal.customAuthHelpers.getUserIdByToken, { token: args.token || "" })) as Id<"users"> | null;
    if (!userId) return [];
    const files = (await ctx.runQuery(internal.agentTeamHelpers.getFiles, { sessionId: args.sessionId })) as FileRow[];
    return files.map((f) => ({ filepath: f.filepath, content: f.content, lastModifiedBy: f.lastModifiedBy }));
  },
});

export const continueSession = action({
  args: { sessionId: v.id("teamSessions"), newTask: v.string(), token: v.optional(v.string()) },
  handler: async (ctx, args): Promise<void> => {
    const userId = (await ctx.runQuery(internal.customAuthHelpers.getUserIdByToken, { token: args.token || "" })) as Id<"users"> | null;
    if (!userId) throw new Error("Not authenticated");
    const session = (await ctx.runQuery(internal.agentTeamHelpers.getSession, { sessionId: args.sessionId })) as SessionRow | null;
    if (!session) throw new Error("Session not found");
    if (session.userId !== userId) throw new Error("Not authorized");
    await ctx.runMutation(internal.agentTeamHelpers.resetSessionForNewTask, { sessionId: args.sessionId, newTask: args.newTask });
  },
});