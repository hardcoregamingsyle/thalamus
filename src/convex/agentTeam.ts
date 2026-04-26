"use node";
import { action } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { Id } from "./_generated/dataModel";

const GEMINI_KEYS = [
  "AIzaSyB6LdCRxGz27Xpj-K8-EiOVBQRvl0SPzyQ",
  "AIzaSyBZHdEWGlYTpr26fVGGWBOHxn4dRKkd-9Y",
  "AIzaSyCJHWZmUwc2_HAV-KS0Q4C50aOBkvm7OwE",
  "AIzaSyCOX7-EwKrZDVh6qUeGoqT_G-D3svl6tco",
  "AIzaSyCyRPBb-rFOZD_6aKgX6cQiKOshjlXt1ho",
  "AIzaSyBDXq8Oceo1DYXDjlM2t0voCxF8wRKCAK0",
  "AIzaSyD4cuooT54P1oCkDq3kJxbRJ2Kf1A9aaXU",
  "AIzaSyAr5AlBQ2RIPiAlYZAJMVboV_0W6WZJh4g",
  "AIzaSyA6TuU_Xu635NSouv2Y9l9DuUowp5CYkzc",
  "AIzaSyDTCwP3prKrW3f2HdiZegHHVXfXZGiaHA0",
  "AIzaSyDneLEfifQh1IXNoko3AxnTAB0NFbezKhA",
  "AIzaSyA793SBkb73ezazr70XExT8iKKzS26uqy4",
  "AIzaSyA88JXgwsL97y0JbWmO6QxMGJ0dE19vRVA",
  "AIzaSyB_Hx34iB-rxaSsENMKdUIJSEAK5rMFf0w",
  "AIzaSyDakGlolmstnXqmirkLex_z6Avl0Zn4vEs",
  "AIzaSyChZvH5fNODWZ3mJa6RXwK1PthDTjpQgfM",
  "AIzaSyBnPzwY7W3pUUlqeKYkA_c-pvjcM135038",
  "AIzaSyB2w9KntAZ7bal3d9D4CIDdvT90rXIZ2pk",
  "AIzaSyBqutBm0ydorD4tZ0SBOjjiGXdtTe8gd5s",
  "AIzaSyDMiSElpUZrnAA90zEuwF2YLggqI_-EjLA",
];

let keyIndex = 0;

async function callGemini(prompt: string, systemPrompt: string): Promise<string> {
  const maxRetries = GEMINI_KEYS.length;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const key = GEMINI_KEYS[keyIndex % GEMINI_KEYS.length];
    keyIndex++;
    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite-preview:generateContent?key=${key}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            system_instruction: { parts: [{ text: systemPrompt }] },
            contents: [{ role: "user", parts: [{ text: prompt }] }],
            generationConfig: { maxOutputTokens: 2048, temperature: 0.7 },
          }),
        }
      );
      if (!response.ok) {
        if (response.status === 429 || response.status === 403) continue;
        const err = await response.text();
        throw new Error(`Gemini API error ${response.status}: ${err}`);
      }
      const data = await response.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) throw new Error("No response from Gemini");
      return text;
    } catch (err) {
      if (attempt === maxRetries - 1) throw err;
    }
  }
  throw new Error("All Gemini API keys exhausted");
}

const AGENTS = [
  { name: "Analyser", systemPrompt: `You are the Analyser agent in a vibe coding team. Deeply analyse the task, break it down into components, identify challenges and edge cases. Be thorough but concise. Start with "## Analysis" header.` },
  { name: "Coder", systemPrompt: `You are the Coder agent in a vibe coding team. Write clean, working code based on the analysis. Use best practices, modern patterns. Provide complete, runnable code with comments. Start with "## Implementation" header.` },
  { name: "Optimiser", systemPrompt: `You are the Optimiser agent in a vibe coding team. Review the code and find performance improvements. Optimize algorithms, reduce complexity, suggest caching/memoization. Show before/after. Start with "## Optimisation" header.` },
  { name: "Tester", systemPrompt: `You are the Tester agent in a vibe coding team. Write comprehensive test cases, test edge cases, identify bugs. Write unit/integration tests. Start with "## Testing" header.` },
  { name: "Hacker", systemPrompt: `You are the Hacker agent in a vibe coding team. Find security vulnerabilities, injection attacks, XSS, CSRF, auth flaws. Suggest security hardening. Start with "## Security Analysis" header.` },
  { name: "Critic", systemPrompt: `You are the Critic agent in a vibe coding team. Critically review all previous work. Identify what's good and what needs improvement. Challenge assumptions. Provide final verdict. Start with "## Critical Review" header.` },
];

type SessionRow = { _id: Id<"teamSessions">; title: string; status: string; round?: number; task: string; currentAgent?: string; userId: Id<"users"> };
type MsgRow = { _id: Id<"agentMessages">; agent: string; content: string; round?: number };

export const createSession = action({
  args: { task: v.string(), token: v.optional(v.string()) },
  handler: async (ctx, args): Promise<Id<"teamSessions">> => {
    const userId = (await ctx.runQuery(internal.customAuthHelpers.getUserIdByToken, { token: args.token || "" })) as Id<"users"> | null;
    if (!userId) throw new Error("Not authenticated");
    return (await ctx.runMutation(internal.agentTeamHelpers.createSessionMutation, { userId, task: args.task, title: args.task.slice(0, 60) })) as Id<"teamSessions">;
  },
});

export const runAgentRound = action({
  args: { sessionId: v.id("teamSessions"), token: v.optional(v.string()) },
  handler: async (ctx, args): Promise<{ agent: string; content: string; done: boolean }> => {
    const userId = (await ctx.runQuery(internal.customAuthHelpers.getUserIdByToken, { token: args.token || "" })) as Id<"users"> | null;
    if (!userId) throw new Error("Not authenticated");

    const session = (await ctx.runQuery(internal.agentTeamHelpers.getSession, { sessionId: args.sessionId })) as SessionRow | null;
    if (!session) throw new Error("Session not found");
    if (session.userId !== userId) throw new Error("Not authorized");

    const prevMessages = (await ctx.runQuery(internal.agentTeamHelpers.getSessionMessages, { sessionId: args.sessionId })) as MsgRow[];

    const round = session.round ?? 0;
    const agent = AGENTS[round % AGENTS.length];

    const contextLines = prevMessages.map((m) => `[${m.agent}]: ${m.content}`).join("\n\n---\n\n");
    const prompt = contextLines
      ? `TASK: ${session.task}\n\nPREVIOUS DISCUSSION:\n${contextLines}\n\nNow provide your ${agent.name} perspective, building on the previous work.`
      : `TASK: ${session.task}\n\nYou are the first agent to respond. Provide your ${agent.name} analysis.`;

    await ctx.runMutation(internal.agentTeamHelpers.updateSessionStatus, { sessionId: args.sessionId, status: "running", currentAgent: agent.name, round });

    const content = await callGemini(prompt, agent.systemPrompt);

    await ctx.runMutation(internal.agentTeamHelpers.saveAgentMessage, { sessionId: args.sessionId, userId, agent: agent.name, content, round });

    const nextRound = round + 1;
    const done = nextRound >= AGENTS.length;

    await ctx.runMutation(internal.agentTeamHelpers.updateSessionStatus, { sessionId: args.sessionId, status: done ? "completed" : "idle", currentAgent: undefined, round: nextRound });

    return { agent: agent.name, content, done };
  },
});

export const listSessions = action({
  args: { token: v.optional(v.string()) },
  handler: async (ctx, args): Promise<Array<{ _id: Id<"teamSessions">; title: string; status: string; round: number; task: string }>> => {
    const userId = (await ctx.runQuery(internal.customAuthHelpers.getUserIdByToken, { token: args.token || "" })) as Id<"users"> | null;
    if (!userId) return [];
    const sessions = (await ctx.runQuery(internal.agentTeamHelpers.listSessionsQuery, { userId })) as SessionRow[];
    return sessions.map((s) => ({ _id: s._id, title: s.title, status: s.status, round: s.round ?? 0, task: s.task }));
  },
});

export const getSessionMessages2 = action({
  args: { sessionId: v.id("teamSessions"), token: v.optional(v.string()) },
  handler: async (ctx, args): Promise<Array<{ _id: string; agent: string; content: string; round?: number }>> => {
    const userId = (await ctx.runQuery(internal.customAuthHelpers.getUserIdByToken, { token: args.token || "" })) as Id<"users"> | null;
    if (!userId) return [];
    const msgs = (await ctx.runQuery(internal.agentTeamHelpers.getSessionMessages, { sessionId: args.sessionId })) as MsgRow[];
    return msgs.map((m) => ({ _id: m._id as string, agent: m.agent, content: m.content, round: m.round }));
  },
});

export const getSessionInfo = action({
  args: { sessionId: v.id("teamSessions"), token: v.optional(v.string()) },
  handler: async (ctx, args): Promise<{ _id: Id<"teamSessions">; title: string; status: string; round: number; task: string; currentAgent?: string } | null> => {
    const userId = (await ctx.runQuery(internal.customAuthHelpers.getUserIdByToken, { token: args.token || "" })) as Id<"users"> | null;
    if (!userId) return null;
    const session = (await ctx.runQuery(internal.agentTeamHelpers.getSession, { sessionId: args.sessionId })) as SessionRow | null;
    if (!session) return null;
    return { _id: session._id, title: session.title, status: session.status, round: session.round ?? 0, task: session.task, currentAgent: session.currentAgent };
  },
});