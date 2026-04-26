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

async function callGemini(prompt: string, systemPrompt: string, maxTokens = 4096): Promise<string> {
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
            generationConfig: { maxOutputTokens: maxTokens, temperature: 0.7 },
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

// Perform a web search using Gemini's grounding (simulated via a search prompt)
async function performSearch(query: string): Promise<string> {
  const searchPrompt = `Search query: "${query}"\n\nProvide a comprehensive, factual answer to this search query. Include relevant code examples, documentation references, best practices, and technical details. Format as a search result summary.`;
  const systemPrompt = `You are a search engine assistant. Provide accurate, detailed search results for technical queries. Include code examples, documentation links, and best practices.`;
  return await callGemini(searchPrompt, systemPrompt, 2048);
}

// Parse file operations from agent output
interface FileOp {
  type: "create" | "edit" | "delete";
  filepath: string;
  content?: string;
}

interface SearchOp {
  query: string;
}

interface ParsedOutput {
  fileOps: FileOp[];
  searchOps: SearchOp[];
  cleanContent: string;
  testerResult?: "pass" | "fail";
  testerFailReason?: string;
  hackerResult?: "pass" | "fail";
  criticResult?: "pass" | "fail";
}

function parseAgentOutput(content: string): ParsedOutput {
  const fileOps: FileOp[] = [];
  const searchOps: SearchOp[] = [];
  let cleanContent = content;

  // Parse CREATEFILE commands
  const createRegex = /<<<<<CREATEFILE="([^"]+)">>>>>([\s\S]*?)<<<<<END\.CREATEFILE>>>>>/g;
  let match;
  while ((match = createRegex.exec(content)) !== null) {
    fileOps.push({ type: "create", filepath: match[1], content: match[2].trim() });
    cleanContent = cleanContent.replace(match[0], `[FILE CREATED: ${match[1]}]`);
  }

  // Parse EDITFILE commands
  const editRegex = /<<<<<EDITFILE="([^"]+)">>>>>([\s\S]*?)<<<<<END\.CREATEFILE>>>>>/g;
  while ((match = editRegex.exec(content)) !== null) {
    fileOps.push({ type: "edit", filepath: match[1], content: match[2].trim() });
    cleanContent = cleanContent.replace(match[0], `[FILE EDITED: ${match[1]}]`);
  }

  // Parse DELETE commands
  const deleteRegex = /<<<<<DELETE="([^"]+)">>>>>/ ;
  const deleteMatches = content.matchAll(/<<<<<DELETE="([^"]+)">>>>>/ as RegExp);
  for (const m of deleteMatches) {
    fileOps.push({ type: "delete", filepath: m[1] });
    cleanContent = cleanContent.replace(m[0], `[FILE DELETED: ${m[1]}]`);
  }

  // Parse SEARCH commands
  const searchRegex = /<<<<<SEARCH-TOOL="([^"]+)">>>>>/ ;
  const searchMatches = content.matchAll(/<<<<<SEARCH-TOOL="([^"]+)">>>>>/ as RegExp);
  for (const m of searchMatches) {
    searchOps.push({ query: m[1] });
    cleanContent = cleanContent.replace(m[0], `[SEARCHING: ${m[1]}]`);
  }

  // Parse Tester results
  let testerResult: "pass" | "fail" | undefined;
  let testerFailReason: string | undefined;
  if (content.includes("<<<<<test.success>>>>>")) {
    testerResult = "pass";
    cleanContent = cleanContent.replace(/<<<<<test\.success>>>>>/g, "[TEST: PASSED ✓]");
  }
  const testerFailMatch = content.match(/<<<<<test\.failed="([^"]*)">>>>>/);
  if (testerFailMatch) {
    testerResult = "fail";
    testerFailReason = testerFailMatch[1];
    cleanContent = cleanContent.replace(testerFailMatch[0], `[TEST: FAILED - ${testerFailReason}]`);
  }

  // Parse Hacker results
  let hackerResult: "pass" | "fail" | undefined;
  if (content.match(/<<<<<pass>>>>>/i) && !content.includes("<<<<<fail>>>>>")) {
    hackerResult = "pass";
    cleanContent = cleanContent.replace(/<<<<<pass>>>>>/gi, "[SECURITY: PASSED ✓]");
  } else if (content.includes("<<<<<Fail>>>>>") || content.includes("<<<<<fail>>>>>")) {
    hackerResult = "fail";
    cleanContent = cleanContent.replace(/<<<<<[Ff]ail>>>>>/g, "[SECURITY: FAILED]");
  }

  // Parse Critic results
  let criticResult: "pass" | "fail" | undefined;
  if (content.match(/<<<<<pass>>>>>/i) && !content.includes("<<<<<fail>>>>>")) {
    criticResult = "pass";
  } else if (content.includes("<<<<<Fail>>>>>") || content.includes("<<<<<fail>>>>>")) {
    criticResult = "fail";
  }

  return { fileOps, searchOps, cleanContent, testerResult, testerFailReason, hackerResult, criticResult };
}

// Agent definitions with full system prompts including command instructions
const AGENT_SYSTEM_PROMPTS: Record<string, string> = {
  Analyser: `You are the Analyser agent in a vibe coding team building a complete project from scratch.

Your job: Deeply analyse the task, break it down into components, identify the full file structure needed, challenges, and edge cases.

You MUST output a complete file structure plan. For coding tasks, plan ALL files including:
- Configuration files (package.json, tsconfig.json, .env.example, etc.)
- Source files
- Test files
- Documentation (README.md)

You can use the search tool to research best practices:
<<<<<SEARCH-TOOL="what to search for">>>>> 

Start with "## Analysis" header. Be thorough and specific.`,

  Coder: `You are the Coder agent in a vibe coding team. You BUILD the entire project from scratch.

You MUST create ALL files using these exact commands:

Create a new file:
<<<<<CREATEFILE="filepath/filename.ext">>>>>
{FULL FILE CONTENTS - NO SNIPPETS, COMPLETE CODE}
<<<<<END.CREATEFILE>>>>>

Edit an existing file (full replacement):
<<<<<EDITFILE="filepath/filename.ext">>>>>
{NEW FULL CONTENTS - NO SNIPPETS, COMPLETE CODE}
<<<<<END.CREATEFILE>>>>>

Delete a file:
<<<<<DELETE="filepath/filename.ext">>>>>

Search for information:
<<<<<SEARCH-TOOL="search query">>>>> 

RULES:
- Create EVERY file needed for the project to work
- Include ALL config files (package.json, tsconfig.json, etc.)
- Write COMPLETE, WORKING code - no placeholders, no TODOs
- After using SEARCH-TOOL, wait for results before proceeding
- Start with "## Implementation" header`,

  Optimiser: `You are the Optimiser agent in a vibe coding team.

Review all created files and optimize them. Use EDITFILE to update files with improvements:

<<<<<EDITFILE="filepath/filename.ext">>>>>
{OPTIMIZED FULL CONTENTS}
<<<<<END.CREATEFILE>>>>>

Search for optimization techniques:
<<<<<SEARCH-TOOL="optimization technique">>>>> 

Focus on: performance, bundle size, caching, algorithms, memory usage.
Start with "## Optimisation" header`,

  Tester: `You are the Tester agent in a vibe coding team.

Write comprehensive tests and verify the implementation. Create test files:

<<<<<CREATEFILE="tests/filename.test.ts">>>>>
{COMPLETE TEST CODE}
<<<<<END.CREATEFILE>>>>>

After testing, you MUST output ONE of these:
- If all tests pass: <<<<<test.success>>>>>
- If tests fail: <<<<<test.failed="detailed reasons and bugs found">>>>> 

Start with "## Testing" header`,

  Hacker: `You are the Hacker agent in a vibe coding team.

Find security vulnerabilities and fix them. Edit files to patch security issues:

<<<<<EDITFILE="filepath/filename.ext">>>>>
{SECURITY-HARDENED FULL CONTENTS}
<<<<<END.CREATEFILE>>>>>

After security review, you MUST output ONE of these:
- If secure: <<<<<pass>>>>>
- If critical vulnerabilities remain: <<<<<Fail>>>>>

Start with "## Security Analysis" header`,

  Critic: `You are the Critic agent in a vibe coding team.

Critically review ALL work done. Check code quality, completeness, and correctness.

After review, you MUST output ONE of these:
- If project is complete and good: <<<<<pass>>>>>
- If significant issues remain: <<<<<Fail>>>>>

Start with "## Critical Review" header`,
};

// Agent pipeline order
const PIPELINE = ["Analyser", "Coder", "Optimiser", "Tester", "Hacker", "Critic"];
const MAX_MESSAGES = 60;

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

    // Get all messages for context
    const prevMessages = (await ctx.runQuery(internal.agentTeamHelpers.getSessionMessages, { sessionId: args.sessionId })) as MsgRow[];

    // Get current project files for context
    const projectFiles = (await ctx.runQuery(internal.agentTeamHelpers.getFiles, { sessionId: args.sessionId })) as FileRow[];

    // Build context
    const contextLines = prevMessages
      .map((m) => `[${m.agent}]: ${m.content}`)
      .join("\n\n---\n\n");

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

    // Mark as running
    await ctx.runMutation(internal.agentTeamHelpers.updateSessionStatus, {
      sessionId: args.sessionId, status: "running", currentAgent: currentPhase,
      round: session.round, loopCount, phase: currentPhase, totalMessages,
    });

    // Call Gemini
    let rawContent = await callGemini(prompt, systemPrompt, 4096);

    // Parse output for commands
    const parsed = parseAgentOutput(rawContent);

    // Handle search operations (re-call with search results)
    if (parsed.searchOps.length > 0) {
      const searchResults: string[] = [];
      for (const searchOp of parsed.searchOps) {
        const result = await performSearch(searchOp.query);
        searchResults.push(`SEARCH RESULT for "${searchOp.query}":\n${result}`);
      }

      // Re-call with search results appended
      const promptWithSearch = `${prompt}\n\nYour previous response requested searches. Here are the results:\n\n${searchResults.join("\n\n---\n\n")}\n\nNow provide your complete ${currentPhase} output incorporating these search results.`;
      rawContent = await callGemini(promptWithSearch, systemPrompt, 4096);
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

    // Execute file operations
    let fileOpsCount = 0;
    for (const op of parsed.fileOps) {
      if (op.type === "create" || op.type === "edit") {
        await ctx.runMutation(internal.agentTeamHelpers.upsertFile, {
          sessionId: args.sessionId,
          userId,
          filepath: op.filepath,
          content: op.content || "",
          agent: currentPhase,
        });
        fileOpsCount++;
      } else if (op.type === "delete") {
        await ctx.runMutation(internal.agentTeamHelpers.deleteFile, {
          sessionId: args.sessionId,
          filepath: op.filepath,
        });
        fileOpsCount++;
      }
    }

    const newTotalMessages = totalMessages + 1;

    // Save agent message
    await ctx.runMutation(internal.agentTeamHelpers.saveAgentMessage, {
      sessionId: args.sessionId,
      userId,
      agent: currentPhase,
      content: parsed.cleanContent,
      round: loopCount,
      messageIndex: newTotalMessages,
    });

    // Determine next phase based on pass/fail logic
    let nextPhase: string;
    let newLoopCount = loopCount;
    let done = false;

    if (currentPhase === "Tester") {
      if (parsed.testerResult === "fail") {
        // Loop back to Analyser
        nextPhase = "Analyser";
        newLoopCount = loopCount + 1;
      } else {
        // Pass or no explicit result - proceed to Hacker
        nextPhase = "Hacker";
      }
    } else if (currentPhase === "Hacker") {
      if (parsed.hackerResult === "fail") {
        // Loop back to Analyser
        nextPhase = "Analyser";
        newLoopCount = loopCount + 1;
      } else {
        // Pass - proceed to Critic
        nextPhase = "Critic";
      }
    } else if (currentPhase === "Critic") {
      if (parsed.criticResult === "fail") {
        // Loop back to Analyser
        nextPhase = "Analyser";
        newLoopCount = loopCount + 1;
      } else {
        // Pass - done!
        nextPhase = "completed";
        done = true;
      }
    } else {
      // Linear pipeline: Analyser -> Coder -> Optimiser -> Tester
      const idx = PIPELINE.indexOf(currentPhase);
      nextPhase = PIPELINE[idx + 1] || "completed";
      if (nextPhase === "completed") done = true;
    }

    // Check max messages
    if (newTotalMessages >= MAX_MESSAGES) {
      done = true;
      nextPhase = "completed";
    }

    await ctx.runMutation(internal.agentTeamHelpers.updateSessionStatus, {
      sessionId: args.sessionId,
      status: done ? "completed" : "idle",
      currentAgent: done ? undefined : nextPhase,
      round: PIPELINE.indexOf(nextPhase),
      loopCount: newLoopCount,
      phase: done ? "completed" : nextPhase,
      totalMessages: newTotalMessages,
    });

    return {
      agent: currentPhase,
      content: parsed.cleanContent,
      done,
      nextAgent: nextPhase,
      loopCount: newLoopCount,
      totalMessages: newTotalMessages,
      fileOpsCount,
    };
  },
});

export const listSessions = action({
  args: { token: v.optional(v.string()) },
  handler: async (ctx, args): Promise<Array<{ _id: Id<"teamSessions">; title: string; status: string; round: number; task: string; phase: string; totalMessages: number; loopCount: number }>> => {
    const userId = (await ctx.runQuery(internal.customAuthHelpers.getUserIdByToken, { token: args.token || "" })) as Id<"users"> | null;
    if (!userId) return [];
    const sessions = (await ctx.runQuery(internal.agentTeamHelpers.listSessionsQuery, { userId })) as SessionRow[];
    return sessions.map((s) => ({
      _id: s._id,
      title: s.title,
      status: s.status,
      round: s.round ?? 0,
      task: s.task,
      phase: s.phase ?? "Analyser",
      totalMessages: s.totalMessages ?? 0,
      loopCount: s.loopCount ?? 0,
    }));
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
    return {
      _id: session._id,
      title: session.title,
      status: session.status,
      round: session.round ?? 0,
      task: session.task,
      currentAgent: session.currentAgent,
      phase: session.phase ?? "Analyser",
      totalMessages: session.totalMessages ?? 0,
      loopCount: session.loopCount ?? 0,
    };
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