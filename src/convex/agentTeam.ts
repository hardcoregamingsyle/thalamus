"use node";
import { action } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { Id } from "./_generated/dataModel";
import { callGemini, performSearch, parseAgentOutput, AGENT_SYSTEM_PROMPTS } from "./agentCore";

const PIPELINE = ["Analyser", "Coder", "Optimiser", "Tester", "Hacker", "Critic"];
const MAX_MESSAGES = 60;
const RAG_BASE_URL = "https://leadshello-graph-rag-and-chroma-db.hf.space";

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

    const systemPrompt = AGENT_SYSTEM_PROMPTS[currentPhase] || AGENT_SYSTEM_PROMPTS["Analyser"];

    let prompt: string;
    if (prevMessages.length === 0) {
      prompt = `TASK: ${session.task}\n\nYou are the first agent. Provide your ${currentPhase} output.${filesContext}`;
    } else {
      prompt = `TASK: ${session.task}\n\nMESSAGE COUNT: ${totalMessages + 1}/${MAX_MESSAGES}\nLOOP: ${loopCount + 1}\n\nPREVIOUS DISCUSSION:\n${contextLines}${filesContext}\n\nNow provide your ${currentPhase} output, building on all previous work.`;
    }

    await ctx.runMutation(internal.agentTeamHelpers.updateSessionStatus, {
      sessionId: args.sessionId, status: "running", currentAgent: currentPhase,
      round: session.round, loopCount, phase: currentPhase, totalMessages,
    });

    let geminiResult = await callGemini(prompt, systemPrompt, 4096);
    let rawContent = geminiResult.text;
    let totalInputTokens = geminiResult.inputTokens;
    let totalOutputTokens = geminiResult.outputTokens;

    const parsed = parseAgentOutput(rawContent);

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
      parsed.fileOps.push(...reparsed.fileOps);
      parsed.cleanContent = reparsed.cleanContent;
      Object.assign(parsed, {
        testerResult: reparsed.testerResult ?? parsed.testerResult,
        testerFailReason: reparsed.testerFailReason ?? parsed.testerFailReason,
        hackerResult: reparsed.hackerResult ?? parsed.hackerResult,
        criticResult: reparsed.criticResult ?? parsed.criticResult,
      });
    }

    let fileOpsCount = 0;
    for (const fileOp of parsed.fileOps) {
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

    const user = await ctx.runQuery(internal.agentTeamHelpers.getSession, { sessionId: args.sessionId });
    if (user) {
      const userDoc = await ctx.runQuery(internal.customAuthHelpers.getUserIdByToken, { token: "" });
      void userDoc;
    }
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