"use node";
import { action, internalAction } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { Id } from "./_generated/dataModel";
import { callGemini, callClaude, callModel, calcAgentBucksForTier, performSearch, performScrape, parseAgentOutput, parsePlannerOutput, parseDifficultyFromPlannerOutput, AGENT_SYSTEM_PROMPTS, PlannerTask, CLAUDE_PRICING, calcClaudeCost, calcAgentBucksFromTokens, AGENT_MODEL_MAP, DIFFICULTY_CODER_MODEL, DIFFICULTY_FRAMEWORK_AUDITOR_MODEL, DIFFICULTY_REDTEAM_SONNET_OVERRIDE, TaskDifficulty, ModelTier, InfoRequest } from "./agentCore";

// ─── Constants ────────────────────────────────────────────────────────────────
const MAX_MESSAGES = 100_000; // No practical limit — sessions run until complete
const MAX_TASK_MESSAGES = 200;        // per-task message limit (increased from 100)
const MODAL_UPGRADE_TRIGGER = 40;     // messages in task before upgrade activates on rejection (cumulative across restarts)
const MODAL_UPGRADE_DURATION = 30;    // messages the upgrade lasts
const DAYTONA_API = "https://app.daytona.io/api";
const DAYTONA_API_KEY_FALLBACK = "dtn_7f36b63fc707555bd843029875fb29caf44e4607c2b3ab29a28c73c737e450b5";
const MAX_CMD_LOOPS = 10;
const RAG_BASE_URL = "https://leadshello-graph-rag-and-chroma-db.hf.space";

// ─── Execution phases ─────────────────────────────────────────────────────────
// "planning"      → Researcher → Analyser → Planner (produces JSON task list)
// "tasks"         → For each task: Researcher → Analyser → [Planner if subpart] → Coder → Optimiser → Organizer → Tester → Hacker → Critic
// "final_review"  → Researcher → Analyser → Optimiser → Organizer → Tester → Hacker → Critic

const PLANNING_PIPELINE = ["Researcher", "Analyser", "Planner", "Architect"];

// Per-task pipeline — Summarizer runs after Critic approves
const TASK_PIPELINE_FULL = ["Researcher", "Analyser", "Planner", "Coder", "Optimiser", "Organizer", "Tester", "Hacker", "Critic", "Summarizer"];
const TASK_PIPELINE_SUBPART = ["Researcher", "Analyser", "Coder", "Optimiser", "Organizer", "Tester", "Hacker", "Critic", "Summarizer"];

// Final review pipeline (no Summarizer — final review is the end)
const FINAL_REVIEW_PIPELINE_SKIP_CODER = ["Researcher", "Analyser", "Optimiser", "Organizer", "Tester", "Hacker", "Critic"];
const FINAL_REVIEW_PIPELINE_WITH_CODER = ["Researcher", "Analyser", "Coder", "Optimiser", "Organizer", "Tester", "Hacker", "Critic"];

// ─── Types ────────────────────────────────────────────────────────────────────
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
  plannerTasksJson?: string;
  currentTaskIndex?: number;
  executionPhase?: string;
  finalReviewCoderEnabled?: boolean;
  taskSummariesJson?: string;
  currentTaskDifficulty?: string;
  taskMessageCount?: number;
  taskUpgradeActive?: boolean;
  taskUpgradeMessagesLeft?: number;
  unfixableTasksJson?: string;
  manualUpgradeEnabled?: boolean;
  techStackJson?: string;
  infoRequestJson?: string;          // Pending GET-INFO request from an agent
};
type MsgRow = { _id: Id<"agentMessages">; agent: string; content: string; round?: number; messageIndex?: number };
type FileRow = { _id: Id<"projectFiles">; filepath: string; content: string; lastModifiedBy: string };
type SandboxDbRow = { _id: Id<"sandboxes">; sandboxId: string; lastCommand?: string; lastOutput?: string; status: string; createdAt: number };

interface DaytonaExecResponse {
  result?: string;
  exitCode?: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
async function wakeSandbox(sandboxId: string, apiKey: string): Promise<boolean> {
  try {
    const startRes = await fetch(`${DAYTONA_API}/sandbox/${sandboxId}/start`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json", "Accept": "application/json" },
    });
    if (!startRes.ok) return false;
    // Wait up to 30s for sandbox to be ready
    for (let i = 0; i < 10; i++) {
      await new Promise(r => setTimeout(r, 3000));
      try {
        const pollRes = await fetch(`${DAYTONA_API}/sandbox/${sandboxId}`, {
          headers: { "Authorization": `Bearer ${apiKey}`, "Accept": "application/json" },
        });
        if (pollRes.ok) {
          const pollData = await pollRes.json() as { state?: string };
          const state = (pollData.state ?? "").toLowerCase();
          if (state === "running" || state === "started") return true;
        }
      } catch { /* keep polling */ }
    }
    return false;
  } catch {
    return false;
  }
}

async function executeSandboxCommand(sandboxId: string, command: string): Promise<{ output: string; exitCode: number }> {
  const apiKey = process.env.DAYTONA_API_KEY || DAYTONA_API_KEY_FALLBACK;
  const wrappedCommand = command.startsWith("cd ") ? command : `cd /home/daytona && ${command}`;

  const doExec = async (): Promise<{ output: string; exitCode: number; httpStatus: number }> => {
    try {
      const res = await fetch(`${DAYTONA_API}/toolbox/${sandboxId}/toolbox/process/execute`, {
        method: "POST",
        headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json", "Accept": "application/json" },
        body: JSON.stringify({ command: wrappedCommand }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        return { output: `[SANDBOX ERROR ${res.status}: ${text.slice(0, 200)}]`, exitCode: 1, httpStatus: res.status };
      }
      const data = await res.json() as DaytonaExecResponse;
      return { output: data.result ?? "", exitCode: data.exitCode ?? 0, httpStatus: 200 };
    } catch (err) {
      return { output: `[SANDBOX EXCEPTION: ${err instanceof Error ? err.message : String(err)}]`, exitCode: 1, httpStatus: 0 };
    }
  };

  // First attempt
  const first = await doExec();
  if (first.httpStatus !== 400) return { output: first.output, exitCode: first.exitCode };

  // 400 error — sandbox may not be running, try to wake it
  const woke = await wakeSandbox(sandboxId, apiKey);
  if (!woke) {
    return { output: `[SANDBOX NOT RUNNING: Failed to wake sandbox. Please restart it manually.]`, exitCode: 1 };
  }

  // Retry after wake
  const retry = await doExec();
  return { output: retry.output, exitCode: retry.exitCode };
}

// Determine which pipeline to use based on execution phase and current task
function getPipeline(executionPhase: string, tasks: PlannerTask[], taskIndex: number, finalReviewCoderEnabled: boolean): string[] {
  if (executionPhase === "planning") return PLANNING_PIPELINE;
  if (executionPhase === "final_review") {
    return finalReviewCoderEnabled ? FINAL_REVIEW_PIPELINE_WITH_CODER : FINAL_REVIEW_PIPELINE_SKIP_CODER;
  }
  // "tasks" phase
  const task = tasks[taskIndex];
  if (!task) return TASK_PIPELINE_FULL;
  // subpart=true → Planner runs (FULL pipeline); subpart=false → Planner skipped (SUBPART pipeline)
  return task.subpart ? TASK_PIPELINE_FULL : TASK_PIPELINE_SUBPART;
}

// ─── RAG actions ──────────────────────────────────────────────────────────────
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

// ─── Auto-RAG: vectorize a single file into the RAG/vector DB ─────────────────
export const vectorizeFile = internalAction({
  args: { sessionId: v.id("teamSessions"), filepath: v.string(), content: v.string() },
  handler: async (_ctx, args): Promise<void> => {
    if (!args.content.trim() || args.content.length < 10) return; // skip empty files
    const docId = `${args.sessionId}:${args.filepath}`;
    const text = `FILE: ${args.filepath}\n\n${args.content.slice(0, 8000)}`;
    try {
      await fetch(`${RAG_BASE_URL}/add_document`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: docId, text }),
      });
    } catch { /* RAG unavailable — non-fatal */ }
  },
});

// ─── Vectorize all files in a session (runs GraphRAG index after) ─────────────
// Public wrapper for frontend to call — does the work directly and returns actual count
export const vectorizeSessionPublic = action({
  args: { sessionId: v.id("teamSessions"), token: v.optional(v.string()) },
  handler: async (ctx, args): Promise<{ indexed: number }> => {
    const userId = (await ctx.runQuery(internal.customAuthHelpers.getUserIdByToken, { token: args.token || "" })) as Id<"users"> | null;
    if (!userId) throw new Error("Not authenticated");
    const files = (await ctx.runQuery(internal.agentTeamHelpers.getFiles, { sessionId: args.sessionId })) as FileRow[];
    let indexed = 0;
    for (const file of files) {
      if (!file.content.trim() || file.content.length < 10) continue;
      const docId = `${args.sessionId}:${file.filepath}`;
      const text = `FILE: ${file.filepath}\n\n${file.content.slice(0, 8000)}`;
      try {
        const res = await fetch(`${RAG_BASE_URL}/add_document`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: docId, text }),
        });
        if (res.ok) indexed++;
      } catch { /* non-fatal */ }
    }
    // Run GraphRAG index after all documents are added (non-fatal if fails)
    try {
      await fetch(`${RAG_BASE_URL}/run_graphrag_index`, { method: "POST", headers: { "Content-Type": "application/json" } });
    } catch { /* non-fatal */ }
    return { indexed };
  },
});

// Internal version — no auth required (called from scheduler/background)
export const vectorizeSession = internalAction({
  args: { sessionId: v.id("teamSessions"), token: v.optional(v.string()) },
  handler: async (ctx, args): Promise<{ indexed: number }> => {
    const files = (await ctx.runQuery(internal.agentTeamHelpers.getFiles, { sessionId: args.sessionId })) as FileRow[];
    let indexed = 0;
    for (const file of files) {
      if (!file.content.trim() || file.content.length < 10) continue;
      const docId = `${args.sessionId}:${file.filepath}`;
      const text = `FILE: ${file.filepath}\n\n${file.content.slice(0, 8000)}`;
      try {
        const res = await fetch(`${RAG_BASE_URL}/add_document`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: docId, text }),
        });
        if (res.ok) indexed++;
      } catch { /* non-fatal */ }
    }
    // Run GraphRAG index after all documents are added
    try {
      await fetch(`${RAG_BASE_URL}/run_graphrag_index`, { method: "POST", headers: { "Content-Type": "application/json" } });
    } catch { /* non-fatal */ }
    return { indexed };
  },
});

// ─── GitHub import: fetch all files from a public GitHub repo ─────────────────
// Uses the public GitHub API — no token required for public repos
export const importFromGithub = action({
  args: {
    sessionId: v.id("teamSessions"),
    repoUrl: v.string(), // e.g. "https://github.com/owner/repo" or "owner/repo"
    branch: v.optional(v.string()), // defaults to "main"
    token: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<{ imported: number; errors: string[] }> => {
    const userId = (await ctx.runQuery(internal.customAuthHelpers.getUserIdByToken, { token: args.token || "" })) as Id<"users"> | null;
    if (!userId) throw new Error("Not authenticated");

    // Parse owner/repo from URL
    let ownerRepo = args.repoUrl.trim();
    ownerRepo = ownerRepo.replace(/^https?:\/\/github\.com\//, "").replace(/\.git$/, "").replace(/\/$/, "");
    const parts = ownerRepo.split("/");
    if (parts.length < 2) throw new Error("Invalid GitHub URL. Use format: owner/repo or https://github.com/owner/repo");
    const owner = parts[0];
    const repo = parts[1];
    const branch = args.branch ?? "main";

    // Get the file tree from GitHub API
    const treeUrl = `https://api.github.com/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`;
    const treeRes = await fetch(treeUrl, {
      headers: { "Accept": "application/vnd.github.v3+json", "User-Agent": "Thalamus-AI/1.0" },
    });

    if (!treeRes.ok) {
      // Try "master" branch if "main" fails
      if (branch === "main") {
        const masterUrl = `https://api.github.com/repos/${owner}/${repo}/git/trees/master?recursive=1`;
        const masterRes = await fetch(masterUrl, {
          headers: { "Accept": "application/vnd.github.v3+json", "User-Agent": "Thalamus-AI/1.0" },
        });
        if (!masterRes.ok) throw new Error(`GitHub API error: ${masterRes.status}. Make sure the repo is public.`);
        const masterData = await masterRes.json() as { tree: Array<{ path: string; type: string; url: string; size?: number }> };
        return await processGithubTree(ctx, masterData.tree, owner, repo, "master", args.sessionId, userId);
      }
      throw new Error(`GitHub API error: ${treeRes.status}. Make sure the repo is public.`);
    }

    const treeData = await treeRes.json() as { tree: Array<{ path: string; type: string; url: string; size?: number }> };
    return await processGithubTree(ctx, treeData.tree, owner, repo, branch, args.sessionId, userId);
  },
});

// Helper to process GitHub tree and import files
async function processGithubTree(
  ctx: { runMutation: Function; scheduler: { runAfter: Function } },
  tree: Array<{ path: string; type: string; url: string; size?: number }>,
  owner: string,
  repo: string,
  branch: string,
  sessionId: Id<"teamSessions">,
  userId: Id<"users">,
): Promise<{ imported: number; errors: string[] }> {
  // Filter to only files (not directories), skip binary files and large files
  const SKIP_EXTENSIONS = [".png", ".jpg", ".jpeg", ".gif", ".svg", ".ico", ".woff", ".woff2", ".ttf", ".eot", ".mp4", ".mp3", ".zip", ".tar", ".gz", ".pdf", ".bin", ".exe", ".dll", ".so", ".dylib"];
  const MAX_FILE_SIZE = 100_000; // 100KB

  const fileNodes = tree.filter(node =>
    node.type === "blob" &&
    (node.size ?? 0) < MAX_FILE_SIZE &&
    !SKIP_EXTENSIONS.some(ext => node.path.toLowerCase().endsWith(ext)) &&
    !node.path.includes("node_modules/") &&
    !node.path.includes(".git/") &&
    !node.path.includes("dist/") &&
    !node.path.includes("build/")
  ).slice(0, 200); // max 200 files

  const errors: string[] = [];
  let imported = 0;

  // Fetch files in batches of 10 to avoid rate limiting
  for (let i = 0; i < fileNodes.length; i += 10) {
    const batch = fileNodes.slice(i, i + 10);
    await Promise.all(batch.map(async (node) => {
      try {
        const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${node.path}`;
        const res = await fetch(rawUrl, { headers: { "User-Agent": "Thalamus-AI/1.0" } });
        if (!res.ok) { errors.push(`Failed to fetch ${node.path}: ${res.status}`); return; }
        const content = await res.text();
        await ctx.runMutation(internal.agentTeamHelpers.upsertFile, {
          sessionId, userId, filepath: node.path, content, agent: "GitHub Import",
        });
        imported++;
      } catch (err) {
        errors.push(`Error importing ${node.path}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }));
    // Small delay between batches to avoid rate limiting
    if (i + 10 < fileNodes.length) await new Promise(r => setTimeout(r, 200));
  }

  // Vectorize all imported files into RAG
  if (imported > 0) {
    await ctx.scheduler.runAfter(0, internal.agentTeam.vectorizeSession, { sessionId, token: undefined });
  }

  return { imported, errors };
}

// ─── Session management ───────────────────────────────────────────────────────
export const createSession = action({
  args: { task: v.string(), token: v.optional(v.string()) },
  handler: async (ctx, args): Promise<{ sessionId: Id<"teamSessions">; customId: string }> => {
    const userId = (await ctx.runQuery(internal.customAuthHelpers.getUserIdByToken, { token: args.token || "" })) as Id<"users"> | null;
    if (!userId) throw new Error("Not authenticated");
    const result = (await ctx.runMutation(internal.agentTeamHelpers.createSessionMutation, {
      userId, task: args.task, title: args.task.slice(0, 60),
    })) as { sessionId: Id<"teamSessions">; customId: string };
    return result;
  },
});

// ─── Research Team runner ─────────────────────────────────────────────────────
// Runs ResearchPlanner → DataTaker → ResearchOrganiser as a sub-pipeline
// Returns the final Research Report as the "Researcher" output
async function runResearchTeam(
  ctx: { runQuery: Function; runMutation: Function },
  sessionId: Id<"teamSessions">,
  topic: string,
): Promise<{ rawContent: string; inputTokens: number; outputTokens: number }> {
  let totalInputTokens = 0;
  let totalOutputTokens = 0;

  // ── Step 1: ResearchPlanner — break topic into subtopics ──────────────────
  await ctx.runMutation(internal.agentTeamHelpers.updateStreamingOutput, {
    sessionId,
    currentAgentOutput: `[Research Team: ResearchPlanner is breaking down the topic...]`,
  });

  const plannerResult = await callGemini(
    `Research topic: ${topic}\n\nBreak this into specific subtopics and search queries.`,
    AGENT_SYSTEM_PROMPTS["ResearchPlanner"],
  );
  totalInputTokens += plannerResult.inputTokens;
  totalOutputTokens += plannerResult.outputTokens;

  // Parse subtopics JSON
  interface ResearchSubtopic { title: string; query: string; why: string; }
  interface ResearchPlan { topic: string; subtopics: ResearchSubtopic[]; }
  let researchPlan: ResearchPlan = { topic, subtopics: [] };
  try {
    const jsonMatch = plannerResult.text.match(/\{[\s\S]*\}/);
    if (jsonMatch) researchPlan = JSON.parse(jsonMatch[0]) as ResearchPlan;
  } catch { /* use empty plan */ }

  const subtopics = researchPlan.subtopics.length > 0
    ? researchPlan.subtopics
    : [{ title: topic, query: topic, why: "Main topic" }];

  await ctx.runMutation(internal.agentTeamHelpers.updateStreamingOutput, {
    sessionId,
    currentAgentOutput: `[Research Team: ResearchPlanner identified ${subtopics.length} subtopics. DataTaker is now searching...]\n\nSubtopics:\n${subtopics.map((s, i) => `${i + 1}. ${s.title}`).join("\n")}`,
  });

  // ── Step 2: DataTaker — search all subtopics and scrape URLs ──────────────
  const rawDataParts: string[] = [];
  const allUrls: string[] = [];

  // Run searches for all subtopics IN PARALLEL (up to 5) — much faster than sequential
  const searchSubtopics = subtopics.slice(0, 5);
  await ctx.runMutation(internal.agentTeamHelpers.updateStreamingOutput, {
    sessionId,
    currentAgentOutput: `[Research Team: DataTaker searching ${searchSubtopics.length} topics in parallel...]`,
  });

  const searchResults = await Promise.allSettled(
    searchSubtopics.map(sub => performSearch(sub.query))
  );

  for (let i = 0; i < searchSubtopics.length; i++) {
    const sub = searchSubtopics[i];
    const result = searchResults[i];
    const searchResult = result.status === "fulfilled" ? result.value : `[Search failed: ${result.reason}]`;
    rawDataParts.push(`### Search: "${sub.query}" (${sub.title})\n${searchResult}`);
    const urlMatches = searchResult.match(/https?:\/\/[^\s\)\"\']+/g) ?? [];
    allUrls.push(...urlMatches.slice(0, 2));
  }

  // Scrape up to 2 unique URLs IN PARALLEL (reduced from 5 to avoid timeouts)
  const uniqueUrls = [...new Set(allUrls)].slice(0, 2);
  if (uniqueUrls.length > 0) {
    await ctx.runMutation(internal.agentTeamHelpers.updateStreamingOutput, {
      sessionId,
      currentAgentOutput: `[Research Team: DataTaker scraping ${uniqueUrls.length} URL(s) in parallel...]`,
    });
    const scrapeResults = await Promise.allSettled(uniqueUrls.map(url => performScrape(url)));
    for (let i = 0; i < uniqueUrls.length; i++) {
      const result = scrapeResults[i];
      const scraped = result.status === "fulfilled" ? result.value : `[Scrape failed]`;
      rawDataParts.push(`### Scraped: ${uniqueUrls[i]}\n${scraped}`);
    }
  }

  const rawData = rawDataParts.join("\n\n---\n\n");

  await ctx.runMutation(internal.agentTeamHelpers.updateStreamingOutput, {
    sessionId,
    currentAgentOutput: `[Research Team: DataTaker collected ${rawDataParts.length} data sources. ResearchOrganiser is synthesizing...]`,
  });

  // ── Step 3: ResearchOrganiser — synthesize into final report ──────────────
  const organiserPrompt = `Research topic: ${topic}

Subtopics researched:
${subtopics.map((s, i) => `${i + 1}. ${s.title} — ${s.why}`).join("\n")}

RAW DATA COLLECTED:
${rawData.slice(0, 12000)}${rawData.length > 12000 ? "\n...[truncated for length]" : ""}

Now synthesize this into a comprehensive Research Report.`;

  const organiserResult = await callGemini(organiserPrompt, AGENT_SYSTEM_PROMPTS["ResearchOrganiser"]);
  totalInputTokens += organiserResult.inputTokens;
  totalOutputTokens += organiserResult.outputTokens;

  // Build the combined message: Planner breakdown + Organiser final report
  const plannerSection = `## R&D Team — Research Plan\n\n**Topic:** ${researchPlan.topic || topic}\n\n**Research Subtopics (${subtopics.length}):**\n${subtopics.map((s, i) => `${i + 1}. **${s.title}** — ${s.why}`).join("\n")}`;
  const combinedOutput = `${plannerSection}\n\n---\n\n${organiserResult.text}`;

  await ctx.runMutation(internal.agentTeamHelpers.updateStreamingOutput, {
    sessionId,
    currentAgentOutput: combinedOutput,
  });

  return {
    rawContent: combinedOutput,
    inputTokens: totalInputTokens,
    outputTokens: totalOutputTokens,
  };
}

// ─── Security Team runner ─────────────────────────────────────────────────────
// New flow: Spotter → Fixer → Spotter (verify) → next stage
// VulnerabilitySpotter → VulnerabilityFixer (if fail) → VulnerabilitySpotter (verify)
// DataCorruptor → DataFixer (if fail) → DataCorruptor (verify)
// ZeroDayExploiter → ZeroDayRemover (if fail) → ZeroDayExploiter (verify)
// FrameworkAuditor → FrameworkRefiner (if fail) → FrameworkAuditor (verify)
// RedTeamOrchestrator (final consolidation)
async function runRedTeam(
  ctx: { runQuery: Function; runMutation: Function },
  sessionId: Id<"teamSessions">,
  codeContext: string,
): Promise<{ rawContent: string; inputTokens: number; outputTokens: number }> {
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  const allReports: string[] = [];

  const stages = [
    {
      spotter: "VulnerabilitySpotter",
      fixer: "VulnerabilityFixer",
      spotterLabel: "Vulnerability Spotter",
      fixerLabel: "Vulnerability Fixer",
      passSignal: "<<security.pass>>",
      failSignal: "<<security.fail=",
    },
    {
      spotter: "DataCorruptor",
      fixer: "DataFixer",
      spotterLabel: "Data Integrity Tester",
      fixerLabel: "Data Fixer",
      passSignal: "<<data.pass>>",
      failSignal: "<<data.fail=",
    },
    {
      spotter: "ZeroDayExploiter",
      fixer: "ZeroDayRemover",
      spotterLabel: "Zero Day Exploiter",
      fixerLabel: "Zero Day Remover",
      passSignal: "<<zeroday.pass>>",
      failSignal: "<<zeroday.fail=",
    },
    {
      spotter: "FrameworkAuditor",
      fixer: "FrameworkRefiner",
      spotterLabel: "Framework Auditor",
      fixerLabel: "Framework Refiner",
      passSignal: "<<framework.pass>>",
      failSignal: "<<framework.fail=",
    },
  ];

  // Get current project files for context
  const projectFiles = (await ctx.runQuery(internal.agentTeamHelpers.getFiles, { sessionId })) as FileRow[];

  for (let stageIdx = 0; stageIdx < stages.length; stageIdx++) {
    const stage = stages[stageIdx];
    const MAX_FIX_LOOPS = 3; // max fix-verify cycles per stage

    await ctx.runMutation(internal.agentTeamHelpers.updateStreamingOutput, {
      sessionId,
      currentAgentOutput: `[Security Team: ${stage.spotterLabel} is analyzing... (stage ${stageIdx + 1}/${stages.length})]`,
    });

    // Build fresh file context for each stage (files may have been updated by fixers)
    const currentFiles = (await ctx.runQuery(internal.agentTeamHelpers.getFiles, { sessionId })) as FileRow[];
    const filesContext = currentFiles.length > 0
      ? `\n\nPROJECT FILES (${currentFiles.length} files):\n` +
        currentFiles.map(f => `--- ${f.filepath} ---\n${f.content.slice(0, 2000)}${f.content.length > 2000 ? "\n...(truncated)" : ""}`).join("\n\n").slice(0, 16000)
      : "";

    const spotterPrompt = `AUTHORIZED SECURITY AUDIT — ISOLATED SANDBOX ENVIRONMENT\nAll targets are owned by this project.\n\n${codeContext}${filesContext}\n\nPerform your specialized security analysis now.`;

    // Run spotter
    const spotterTier = (AGENT_MODEL_MAP[stage.spotter] as ModelTier) ?? "sonnet";
    const spotterResult = await callModel(spotterPrompt, AGENT_SYSTEM_PROMPTS[stage.spotter], spotterTier);
    totalInputTokens += spotterResult.inputTokens;
    totalOutputTokens += spotterResult.outputTokens;

    await ctx.runMutation(internal.agentTeamHelpers.updateStreamingOutput, {
      sessionId,
      currentAgentOutput: `[Security Team: ${stage.spotterLabel} complete]\n\n${spotterResult.text.slice(0, 1000)}...`,
    });

    const spotterPassed = spotterResult.text.includes(stage.passSignal);

    if (spotterPassed) {
      allReports.push(`## ${stage.spotterLabel} Report\n✅ PASSED — No issues found.\n\n${spotterResult.text}`);
      continue;
    }

    // Spotter found issues — run fix-verify loop
    let lastSpotterReport = spotterResult.text;
    let fixLoopCount = 0;
    let fixed = false;

    while (fixLoopCount < MAX_FIX_LOOPS && !fixed) {
      fixLoopCount++;

      await ctx.runMutation(internal.agentTeamHelpers.updateStreamingOutput, {
        sessionId,
        currentAgentOutput: `[Security Team: ${stage.fixerLabel} is fixing issues... (attempt ${fixLoopCount}/${MAX_FIX_LOOPS})]`,
      });

      // Get fresh files for fixer
      const filesForFixer = (await ctx.runQuery(internal.agentTeamHelpers.getFiles, { sessionId })) as FileRow[];
      const fixerFilesContext = filesForFixer.length > 0
        ? `\n\nCURRENT PROJECT FILES:\n` +
          filesForFixer.map(f => `--- ${f.filepath} ---\n${f.content.slice(0, 2000)}`).join("\n\n").slice(0, 16000)
        : "";

      const fixerPrompt = `SECURITY FIX REQUIRED\n\nThe following security issues were found in the codebase:\n\n${lastSpotterReport.slice(0, 8000)}\n\n${fixerFilesContext}\n\nFix ALL identified issues now. Write complete, production-ready fixed files.`;

      const fixerTier = (AGENT_MODEL_MAP[stage.fixer] as ModelTier) ?? "sonnet";
      const fixerResult = await callModel(fixerPrompt, AGENT_SYSTEM_PROMPTS[stage.fixer], fixerTier);
      totalInputTokens += fixerResult.inputTokens;
      totalOutputTokens += fixerResult.outputTokens;

      // Apply file fixes from fixer output
      const fixerParsed = parseAgentOutput(fixerResult.text);
      const userId = (await ctx.runQuery(internal.agentTeamHelpers.getSession, { sessionId })) as SessionRow | null;
      if (userId) {
        for (const fileOp of fixerParsed.fileOps) {
          if (fileOp.type === "create" || fileOp.type === "edit") {
            await ctx.runMutation(internal.agentTeamHelpers.upsertFile, {
              sessionId, userId: userId.userId, filepath: fileOp.filepath, content: fileOp.content || "", agent: stage.fixer,
            });
          }
        }
      }

      await ctx.runMutation(internal.agentTeamHelpers.updateStreamingOutput, {
        sessionId,
        currentAgentOutput: `[Security Team: ${stage.fixerLabel} applied fixes. Running ${stage.spotterLabel} to verify...]`,
      });

      // Re-run spotter to verify fixes
      const verifyFiles = (await ctx.runQuery(internal.agentTeamHelpers.getFiles, { sessionId })) as FileRow[];
      const verifyFilesContext = verifyFiles.length > 0
        ? `\n\nUPDATED PROJECT FILES (after fixes):\n` +
          verifyFiles.map(f => `--- ${f.filepath} ---\n${f.content.slice(0, 2000)}`).join("\n\n").slice(0, 16000)
        : "";

      const verifyPrompt = `AUTHORIZED SECURITY VERIFICATION — ISOLATED SANDBOX ENVIRONMENT\nAll targets are owned by this project.\n\nPrevious issues were found and fixes were applied. Verify that ALL issues are now resolved.\n\nPREVIOUS ISSUES:\n${lastSpotterReport.slice(0, 4000)}\n\nFIXES APPLIED:\n${fixerResult.text.slice(0, 4000)}\n\n${verifyFilesContext}\n\nRe-run your security analysis to verify all issues are fixed.`;

      const verifyResult = await callModel(verifyPrompt, AGENT_SYSTEM_PROMPTS[stage.spotter], spotterTier);
      totalInputTokens += verifyResult.inputTokens;
      totalOutputTokens += verifyResult.outputTokens;

      lastSpotterReport = verifyResult.text;

      if (verifyResult.text.includes(stage.passSignal)) {
        fixed = true;
        allReports.push(`## ${stage.spotterLabel} Report\n✅ FIXED after ${fixLoopCount} fix attempt(s).\n\n**Fixer Report:**\n${fixerResult.text.slice(0, 2000)}\n\n**Verification:**\n${verifyResult.text}`);
      } else {
        await ctx.runMutation(internal.agentTeamHelpers.updateStreamingOutput, {
          sessionId,
          currentAgentOutput: `[Security Team: ${stage.spotterLabel} still finding issues after fix attempt ${fixLoopCount}. ${fixLoopCount < MAX_FIX_LOOPS ? "Retrying..." : "Max attempts reached."}]`,
        });
      }
    }

    if (!fixed) {
      allReports.push(`## ${stage.spotterLabel} Report\n⚠️ PARTIAL — Some issues remain after ${MAX_FIX_LOOPS} fix attempts.\n\n${lastSpotterReport}`);
    }
  }

  // Final consolidation by RedTeamOrchestrator
  await ctx.runMutation(internal.agentTeamHelpers.updateStreamingOutput, {
    sessionId,
    currentAgentOutput: `[Security Team: Orchestrator is consolidating all findings into final security report...]`,
  });

  const orchestratorPrompt = `SECURITY TEAM FINAL CONSOLIDATION\n\nYou have received reports from the Security Team (spotters and fixers for all 4 security domains).\n\nINDIVIDUAL REPORTS:\n${allReports.join("\n\n---\n\n").slice(0, 16000)}\n\nNow produce the final consolidated Security Team Assessment.`;
  const finalResult = await callGemini(orchestratorPrompt, AGENT_SYSTEM_PROMPTS["RedTeamOrchestrator"]);
  totalInputTokens += finalResult.inputTokens;
  totalOutputTokens += finalResult.outputTokens;

  await ctx.runMutation(internal.agentTeamHelpers.updateStreamingOutput, {
    sessionId,
    currentAgentOutput: finalResult.text,
  });

  return { rawContent: finalResult.text, inputTokens: totalInputTokens, outputTokens: totalOutputTokens };
}

// ─── Core agent runner ────────────────────────────────────────────────────────
async function runSingleAgentCall(
  ctx: { runQuery: Function; runMutation: Function },
  sessionId: Id<"teamSessions">,
  userId: Id<"users">,
  currentPhase: string,
  prompt: string,
  systemPrompt: string,
  sandboxDaytonaId: string | null,
  sandboxDbId: Id<"sandboxes"> | null,
  modelTier?: ModelTier,
): Promise<{ rawContent: string; inputTokens: number; outputTokens: number; tier: ModelTier }> {
  const tier: ModelTier = modelTier ?? (AGENT_MODEL_MAP[currentPhase] as ModelTier) ?? "gemini";

  // Set thinking indicator
  await ctx.runMutation(internal.agentTeamHelpers.updateStreamingOutput, {
    sessionId,
    currentAgentOutput: `[${currentPhase} is thinking...]`,
  });

  let modelResult = await callModel(prompt, systemPrompt, tier);
  let rawContent = modelResult.text;
  let totalInputTokens = modelResult.inputTokens;
  let totalOutputTokens = modelResult.outputTokens;

  // Show initial output
  const initialParsed = parseAgentOutput(rawContent);
  await ctx.runMutation(internal.agentTeamHelpers.updateStreamingOutput, {
    sessionId,
    currentAgentOutput: initialParsed.cleanContent,
  });

  let parsed = initialParsed;

  // Handle scrape ops (max 2)
  if (parsed.scrapeOps.length > 0) {
    const limitedScrapeOps = parsed.scrapeOps.slice(0, 2);
    await ctx.runMutation(internal.agentTeamHelpers.updateStreamingOutput, {
      sessionId,
      currentAgentOutput: `${parsed.cleanContent}\n\n[Scraping ${limitedScrapeOps.length} URL(s)...]`,
    });
    const scrapeResults: string[] = [];
    for (const scrapeOp of limitedScrapeOps) {
      const result = await performScrape(scrapeOp.url);
      scrapeResults.push(`SCRAPED CONTENT from "${scrapeOp.url}":\n${result}`);
    }
    const promptWithScrapes = `${prompt}\n\nURL scrape results:\n\n${scrapeResults.join("\n\n---\n\n")}\n\nNow provide your complete ${currentPhase} output incorporating this information.`;
    const modelResult2 = await callModel(promptWithScrapes, systemPrompt, tier);
    rawContent = modelResult2.text;
    totalInputTokens += modelResult2.inputTokens;
    totalOutputTokens += modelResult2.outputTokens;
    parsed = parseAgentOutput(rawContent);
    await ctx.runMutation(internal.agentTeamHelpers.updateStreamingOutput, {
      sessionId,
      currentAgentOutput: parsed.cleanContent,
    });
  }

  // Handle search ops (max 2)
  if (parsed.searchOps.length > 0) {
    const limitedSearchOps = parsed.searchOps.slice(0, 2);
    await ctx.runMutation(internal.agentTeamHelpers.updateStreamingOutput, {
      sessionId,
      currentAgentOutput: `${parsed.cleanContent}\n\n[Searching ${limitedSearchOps.length} query(ies)...]`,
    });
    const searchResults: string[] = [];
    for (const searchOp of limitedSearchOps) {
      const result = await performSearch(searchOp.query);
      searchResults.push(`SEARCH RESULT for "${searchOp.query}":\n${result}`);
    }
    const promptWithSearch = `${prompt}\n\nSearch results:\n\n${searchResults.join("\n\n---\n\n")}\n\nNow provide your complete ${currentPhase} output incorporating these results.`;
    const modelResult3 = await callModel(promptWithSearch, systemPrompt, tier);
    rawContent = modelResult3.text;
    totalInputTokens += modelResult3.inputTokens;
    totalOutputTokens += modelResult3.outputTokens;
    parsed = parseAgentOutput(rawContent);
    await ctx.runMutation(internal.agentTeamHelpers.updateStreamingOutput, {
      sessionId,
      currentAgentOutput: parsed.cleanContent,
    });
  }

  // Handle sandbox RUN-CMD loop
  if (currentPhase !== "Researcher" && currentPhase !== "Analyser" && currentPhase !== "Planner" && sandboxDaytonaId && parsed.cmdOps.length > 0) {
    let cmdLoopCount = 0;
    let currentPrompt = prompt;
    let currentParsed = parsed;
    const allCmdResults: string[] = []; // accumulate ALL command results for Tester evaluation

    while (currentParsed.cmdOps.length > 0 && cmdLoopCount < MAX_CMD_LOOPS) {
      const cmdResults: string[] = [];
      for (const cmdOp of currentParsed.cmdOps) {
        await ctx.runMutation(internal.agentTeamHelpers.updateStreamingOutput, {
          sessionId,
          currentAgentOutput: `${parsed.cleanContent}\n\n[Running: ${cmdOp.command}]`,
        });
        const { output, exitCode } = await executeSandboxCommand(sandboxDaytonaId, cmdOp.command);
        const resultStr = `$ ${cmdOp.command}\n${output.slice(0, 2000)}${output.length > 2000 ? "\n...(truncated)" : ""}\n[exit code: ${exitCode}]`;
        cmdResults.push(resultStr);
        allCmdResults.push(resultStr);
        if (sandboxDbId) {
          await ctx.runMutation(internal.sandboxHelpers.updateSandboxCommand, {
            sandboxDbId,
            lastCommand: cmdOp.command,
            lastOutput: output.slice(0, 2000),
            costCents: 0,
          });
        }
      }
      const promptWithCmds = `${currentPrompt}\n\nSandbox command results:\n\n${cmdResults.join("\n\n---\n\n")}\n\nProvide your updated ${currentPhase} output. Use RUN-CMD again if needed, or provide final output without RUN-CMD.`;
      const modelResultCmd = await callModel(promptWithCmds, systemPrompt, tier);
      rawContent = modelResultCmd.text;
      totalInputTokens += modelResultCmd.inputTokens;
      totalOutputTokens += modelResultCmd.outputTokens;
      currentParsed = parseAgentOutput(rawContent);
      parsed.fileOps.push(...currentParsed.fileOps);
      parsed.cleanContent = currentParsed.cleanContent;
      Object.assign(parsed, {
        testerResult: currentParsed.testerResult ?? parsed.testerResult,
        testerFailReason: currentParsed.testerFailReason ?? parsed.testerFailReason,
        hackerResult: currentParsed.hackerResult ?? parsed.hackerResult,
        criticResult: currentParsed.criticResult ?? parsed.criticResult,
      });
      await ctx.runMutation(internal.agentTeamHelpers.updateStreamingOutput, {
        sessionId,
        currentAgentOutput: parsed.cleanContent,
      });
      currentPrompt = promptWithCmds;
      cmdLoopCount++;
    }

    // For Tester: if no explicit pass/fail was set after running commands, force a final evaluation
    if (currentPhase === "Tester" && !parsed.testerResult && allCmdResults.length > 0) {
      const evalPrompt = `${currentPrompt}\n\nALL COMMAND RESULTS SO FAR:\n${allCmdResults.join("\n\n---\n\n")}\n\nBased on the ACTUAL command output above, you MUST now output your final verdict:\n- If ALL tests passed (no errors, no failures, exit code 0): output <<test.success>>\n- If ANY test failed, errored, or had non-zero exit code: output <<test.failed="exact error message from output">>`;
      const evalResult = await callModel(evalPrompt, systemPrompt, tier);
      rawContent = evalResult.text;
      totalInputTokens += evalResult.inputTokens;
      totalOutputTokens += evalResult.outputTokens;
      const evalParsed = parseAgentOutput(rawContent);
      parsed.testerResult = evalParsed.testerResult ?? parsed.testerResult;
      parsed.testerFailReason = evalParsed.testerFailReason ?? parsed.testerFailReason;
      parsed.cleanContent = evalParsed.cleanContent;
      await ctx.runMutation(internal.agentTeamHelpers.updateStreamingOutput, {
        sessionId,
        currentAgentOutput: parsed.cleanContent,
      });
    }
  }

  // For Tester: if no sandbox available but no pass/fail set, default to fail (can't verify without running)
  if (currentPhase === "Tester" && !parsed.testerResult && !sandboxDaytonaId) {
    // No sandbox — Tester can't actually run tests, so it should fail
    // But we allow it to pass if it explicitly said so in its output
    // Check if the raw content contains any indication of passing
    const hasExplicitPass = rawContent.includes("<<test.success>>") || rawContent.includes("<<<test.success>>>") || rawContent.toLowerCase().includes("all tests pass");
    if (!hasExplicitPass) {
      parsed.testerResult = "fail";
      parsed.testerFailReason = "No sandbox available to run tests — cannot verify";
    }
  }

  return { rawContent, inputTokens: totalInputTokens, outputTokens: totalOutputTokens, tier };
}

// ─── Main runAgentRound action ────────────────────────────────────────────────
export const runAgentRound = action({
  args: { sessionId: v.id("teamSessions"), token: v.optional(v.string()) },
  handler: async (ctx, args): Promise<{ agent: string; content: string; done: boolean; nextAgent: string; loopCount: number; totalMessages: number; fileOpsCount: number }> => {
    const userId = (await ctx.runQuery(internal.customAuthHelpers.getUserIdByToken, { token: args.token || "" })) as Id<"users"> | null;
    if (!userId) throw new Error("Not authenticated");

    const session = (await ctx.runQuery(internal.agentTeamHelpers.getSession, { sessionId: args.sessionId })) as SessionRow | null;
    if (!session) throw new Error("Session not found");
    if (session.userId !== userId) throw new Error("Not authorized");
    if (session.status === "completed") throw new Error("Session already completed");

    // Block execution if there's a pending GET-INFO request
    if (session.infoRequestJson) {
      throw new Error("Waiting for user input. Please fill in the required information.");
    }

    const totalMessages = session.totalMessages ?? 0;
    if (totalMessages >= MAX_MESSAGES) {
      await ctx.runMutation(internal.agentTeamHelpers.updateSessionStatus, {
        sessionId: args.sessionId, status: "completed", currentAgent: undefined,
        round: session.round, loopCount: session.loopCount, phase: "completed", totalMessages,
      });
      throw new Error(`Maximum message limit (${MAX_MESSAGES}) reached`);
    }

    // Platform budget check — block new requests if budget exhausted
    const budgetExhausted = await ctx.runQuery(internal.admin.isPlatformBudgetExhausted, {});
    if (budgetExhausted) {
      await ctx.runMutation(internal.agentTeamHelpers.updateSessionStatus, {
        sessionId: args.sessionId, status: "completed", currentAgent: undefined,
        round: session.round, loopCount: session.loopCount, phase: "completed", totalMessages,
      });
      throw new Error("Platform budget exhausted ($5 threshold reached). Contact admin to add more credits.");
    }

    // Determine execution state
    const executionPhase = session.executionPhase ?? "planning";
    const currentTaskIndex = session.currentTaskIndex ?? 0;
    const loopCount = session.loopCount ?? 0;
    const finalReviewCoderEnabled = session.finalReviewCoderEnabled ?? false;

    // Safety net state
    const taskMessageCount = session.taskMessageCount ?? 0;
    const taskUpgradeActive = session.taskUpgradeActive ?? false;
    const taskUpgradeMessagesLeft = session.taskUpgradeMessagesLeft ?? 0;
    const manualUpgradeEnabled = session.manualUpgradeEnabled ?? false;
    let unfixableTasks: Array<{ taskIndex: number; title: string }> = [];
    try {
      if (session.unfixableTasksJson) unfixableTasks = JSON.parse(session.unfixableTasksJson);
    } catch { /* ignore */ }

    // Per-task message limit check (only in tasks phase)
    if (executionPhase === "tasks" && taskMessageCount >= MAX_TASK_MESSAGES) {
      // Force skip this task — it's exceeded the per-task limit
      const currentTask = (() => {
        try { return (JSON.parse(session.plannerTasksJson ?? "[]") as PlannerTask[])[currentTaskIndex]; } catch { return null; }
      })();
      const taskTitle = currentTask?.title ?? `Task ${currentTaskIndex + 1}`;
      unfixableTasks.push({ taskIndex: currentTaskIndex, title: taskTitle });

      let plannerTasks: PlannerTask[] = [];
      try { plannerTasks = JSON.parse(session.plannerTasksJson ?? "[]") as PlannerTask[]; } catch { /* ignore */ }

      const nextTaskIndex = currentTaskIndex + 1;
      let nextPhase: string;
      let newExecutionPhase = executionPhase;
      let newTaskIndex = currentTaskIndex;
      let done = false;

      if (nextTaskIndex < plannerTasks.length) {
        newTaskIndex = nextTaskIndex;
        const nextTaskPipeline = getPipeline("tasks", plannerTasks, nextTaskIndex, false);
        nextPhase = nextTaskPipeline[0];
      } else {
        newExecutionPhase = "final_review";
        nextPhase = FINAL_REVIEW_PIPELINE_SKIP_CODER[0];
      }

      // Save a system message about the skip
      await ctx.runMutation(internal.agentTeamHelpers.saveAgentMessage, {
        sessionId: args.sessionId, userId, agent: "System",
        content: `⚠️ Task "${taskTitle}" exceeded the ${MAX_TASK_MESSAGES}-message limit and was skipped. It will be reported as an unfixable issue at the end of the session.`,
        round: loopCount, messageIndex: totalMessages + 1,
      });

      await ctx.runMutation(internal.agentTeamHelpers.updateSessionFull, {
        sessionId: args.sessionId, status: done ? "completed" : "idle",
        currentAgent: done ? undefined : nextPhase, loopCount,
        phase: done ? "completed" : nextPhase, totalMessages: totalMessages + 1,
        executionPhase: done ? "completed" : newExecutionPhase, currentTaskIndex: newTaskIndex,
        finalReviewCoderEnabled, taskMessageCount: 0, taskUpgradeActive: false,
        taskUpgradeMessagesLeft: 0, unfixableTasksJson: JSON.stringify(unfixableTasks),
        clearPlannerTasks: done ? true : undefined,
      });

      return { agent: "System", content: `Task skipped (limit exceeded)`, done, nextAgent: nextPhase, loopCount, totalMessages: totalMessages + 1, fileOpsCount: 0 };
    }

    // Parse stored tasks
    let plannerTasks: PlannerTask[] = [];
    if (session.plannerTasksJson) {
      try { plannerTasks = JSON.parse(session.plannerTasksJson) as PlannerTask[]; } catch { /* ignore */ }
    }

    // Get the current pipeline
    const pipeline = getPipeline(executionPhase, plannerTasks, currentTaskIndex, finalReviewCoderEnabled);
    // Validate currentPhase is in the pipeline — if not (stale from old session), reset to first agent
    const rawPhase = session.phase ?? pipeline[0];
    const currentPhase = pipeline.includes(rawPhase) ? rawPhase : pipeline[0];

    // Build context
    const prevMessages = (await ctx.runQuery(internal.agentTeamHelpers.getSessionMessages, { sessionId: args.sessionId })) as MsgRow[];
    const projectFiles = (await ctx.runQuery(internal.agentTeamHelpers.getFiles, { sessionId: args.sessionId })) as FileRow[];

    // Load task summaries for Summarizer context
    let taskSummaries: Array<{ taskIndex: number; summary: string }> = [];
    if (session.taskSummariesJson) {
      try { taskSummaries = JSON.parse(session.taskSummariesJson) as Array<{ taskIndex: number; summary: string }>; } catch { /* ignore */ }
    }

    const contextLines = prevMessages.slice(-20).map((m) => `[${m.agent}]: ${m.content.slice(0, 1500)}`).join("\n\n---\n\n");
    // File manifest: just paths (no content) so agents always know the full directory structure
    const fileManifest = projectFiles.length > 0
      ? `\n\n## EXISTING FILE MANIFEST (${projectFiles.length} files — CHECK THIS BEFORE CREATING ANY FILE):\n${projectFiles.map(f => `  ${f.filepath}`).join("\n")}\n⚠️ DO NOT create a file that already exists in this manifest. Use <<EDITFILE>> to modify existing files.`
      : "";
    const filesContext = projectFiles.length > 0
      ? `\n\nCURRENT PROJECT FILES (${projectFiles.length} files):\n` +
        projectFiles.map((f) => `--- ${f.filepath} ---\n${f.content.slice(0, 1500)}${f.content.length > 1500 ? "\n...(truncated)" : ""}`).join("\n\n")
      : "";

    // Task context for "tasks" phase
    let taskContext = "";
    if (executionPhase === "tasks" && plannerTasks.length > 0) {
      const currentTask = plannerTasks[currentTaskIndex];
      if (currentTask) {
        taskContext = `\n\nCURRENT TASK (${currentTaskIndex + 1}/${plannerTasks.length}): ${currentTask.title}\n${currentTask.description}`;
        // Add completed task summaries for context
        const completedSummaries = taskSummaries.filter(s => s.taskIndex < currentTaskIndex);
        if (completedSummaries.length > 0) {
          taskContext += `\n\nCOMPLETED TASKS SUMMARY:\n${completedSummaries.map((s: { taskIndex: number; summary: string }) => `Task ${s.taskIndex + 1}: ${s.summary.slice(0, 300)}`).join("\n")}`;
        }
        // Parse and set difficulty
        const difficulty = parseDifficultyFromPlannerOutput(currentTask.description ?? "");
        if (difficulty !== (session.currentTaskDifficulty ?? "normal")) {
          await ctx.runMutation(internal.agentTeamHelpers.updateTaskDifficulty, { sessionId: args.sessionId, difficulty });
        }
      }
    }

    // Sandbox context
    let sandboxDbId: Id<"sandboxes"> | null = null;
    let sandboxDaytonaId: string | null = null;
    let sandboxContext = "";
    if (currentPhase !== "Researcher" && currentPhase !== "Analyser" && currentPhase !== "Planner") {
      const sandbox = (await ctx.runQuery(internal.sandboxHelpers.getSandboxBySession, { sessionId: args.sessionId })) as SandboxDbRow | null;
      if (sandbox && sandbox.status === "running") {
        sandboxDbId = sandbox._id;
        sandboxDaytonaId = sandbox.sandboxId;
        if (sandbox.lastCommand || sandbox.lastOutput) {
          sandboxContext = `\n\nLAST SANDBOX OUTPUT:\n$ ${sandbox.lastCommand ?? ""}\n${(sandbox.lastOutput ?? "").slice(0, 1500)}`;
        }
      }
    }

    const systemPrompt = AGENT_SYSTEM_PROMPTS[currentPhase] || AGENT_SYSTEM_PROMPTS["Researcher"];
    const phaseLabel = executionPhase === "planning" ? "PLANNING PHASE" : executionPhase === "final_review" ? "FINAL REVIEW" : `TASK ${currentTaskIndex + 1}/${plannerTasks.length}`;
    // Add upgrade notice to prompt if active
    const upgradeNotice = taskUpgradeActive ? `\n\n⚡ MODAL UPGRADE ACTIVE: You are running at maximum capability (Opus tier). This task has been difficult — give your absolute best output.` : "";
    // Tech stack context — shared with all agents after Architect runs
    const techStackContext = session.techStackJson
      ? `\n\n## APPROVED TECH STACK (defined by Architect — MUST follow this exactly):\n${session.techStackJson}`
      : "";
    // For Summarizer: pass ALL previous summaries as context so it can produce a cumulative summary
    const summarizerContext = currentPhase === "Summarizer" && taskSummaries.length > 0
      ? `\n\nPREVIOUS TASK SUMMARIES (incorporate ALL of this into your new cumulative summary):\n${taskSummaries.map(s => `=== Task ${s.taskIndex + 1} Summary ===\n${s.summary}`).join("\n\n")}`
      : "";

    const prompt = prevMessages.length === 0
      ? `TASK: ${session.task}\n\nPHASE: ${phaseLabel}${taskContext}${upgradeNotice}${techStackContext}${fileManifest}\n\nYou are the first agent (${currentPhase}). Begin your work.${filesContext}${sandboxContext}`
      : `TASK: ${session.task}\n\nPHASE: ${phaseLabel}${taskContext}\nMESSAGE COUNT: ${totalMessages + 1}/${MAX_MESSAGES}\nTASK MESSAGES: ${taskMessageCount + 1}/${MAX_TASK_MESSAGES}\nLOOP: ${loopCount + 1}${upgradeNotice}${techStackContext}${summarizerContext}${fileManifest}\n\nPREVIOUS DISCUSSION:\n${contextLines}${filesContext}${sandboxContext}\n\nNow provide your ${currentPhase} output, building on all previous work.`;

    await ctx.runMutation(internal.agentTeamHelpers.updateSessionStatus, {
      sessionId: args.sessionId, status: "running", currentAgent: currentPhase,
      round: session.round, loopCount, phase: currentPhase, totalMessages,
    });

    // Determine model tier for this agent
    // Modal Upgrade: if active, upgrade sonnet→opus47, haiku→opus46
    let agentTier: ModelTier = (AGENT_MODEL_MAP[currentPhase] as ModelTier) ?? "gemini";
    const currentDifficulty = (session.currentTaskDifficulty ?? "normal") as TaskDifficulty;
    if (currentPhase === "Coder") {
      agentTier = DIFFICULTY_CODER_MODEL[currentDifficulty] ?? "sonnet";
    } else if (["DataCorruptor", "ZeroDayExploiter"].includes(currentPhase)) {
      const override = DIFFICULTY_REDTEAM_SONNET_OVERRIDE[currentDifficulty];
      if (override) agentTier = override;
    } else if (currentPhase === "FrameworkAuditor") {
      const override = DIFFICULTY_FRAMEWORK_AUDITOR_MODEL[currentDifficulty];
      if (override) agentTier = override;
    }
    // Context-aware Analyser: haiku in planning, haiku in tasks/subtasks (gemini replaced by haiku)
    if (currentPhase === "Analyser" && executionPhase !== "planning") {
      agentTier = "haiku"; // haiku for task/subtask phase
    }
    // Apply Modal Upgrade: sonnet→opus47, haiku→opus46, gemini→haiku
    if (taskUpgradeActive) {
      if (agentTier === "sonnet") agentTier = "opus47";
      else if (agentTier === "haiku") agentTier = "opus46";
      else if (agentTier === "gemini") agentTier = "haiku"; // gemini agents upgrade to haiku
    }

    // Run the agent
    let agentResult: { rawContent: string; inputTokens: number; outputTokens: number; tier: ModelTier };
    if (currentPhase === "Researcher") {
      const r = await runResearchTeam(ctx, args.sessionId, session.task + (taskContext ? `\n\nCurrent task context: ${taskContext}` : ""));
      agentResult = { ...r, tier: "gemini" };
    } else if (currentPhase === "Hacker") {
      const redTeamContext = `PROJECT TASK: ${session.task}\n\nCURRENT PHASE: ${phaseLabel}\n\nPROJECT FILES:\n${projectFiles.map(f => `--- ${f.filepath} ---\n${f.content.slice(0, 2000)}`).join("\n\n").slice(0, 12000)}\n\nPREVIOUS AGENT OUTPUTS:\n${contextLines.slice(0, 4000)}`;
      const r = await runRedTeam(ctx, args.sessionId, redTeamContext);
      agentResult = { ...r, tier: "gemini" };
    } else {
      agentResult = await runSingleAgentCall(ctx, args.sessionId, userId, currentPhase, prompt, systemPrompt, sandboxDaytonaId, sandboxDbId, agentTier);
    }

    const { rawContent, inputTokens, outputTokens } = agentResult;
    const usedTier = agentResult.tier ?? agentTier;
    const parsed = parseAgentOutput(rawContent);

    // If Planner, extract and store the task list
    if (currentPhase === "Planner" && executionPhase === "planning") {
      const plannerOutput = parsePlannerOutput(rawContent);
      if (plannerOutput && plannerOutput.tasks.length > 0) {
        await ctx.runMutation(internal.agentTeamHelpers.updatePlannerTasks, {
          sessionId: args.sessionId,
          plannerTasksJson: JSON.stringify(plannerOutput.tasks),
        });
        plannerTasks = plannerOutput.tasks;
      } else if (plannerTasks.length === 0) {
        // Fallback: create a single task from the session task
        const fallbackTask: PlannerTask = { id: "task-1", title: session.task.slice(0, 80), description: session.task, subpart: false };
        plannerTasks = [fallbackTask];
        await ctx.runMutation(internal.agentTeamHelpers.updatePlannerTasks, {
          sessionId: args.sessionId,
          plannerTasksJson: JSON.stringify(plannerTasks),
        });
      }
    }

    // If Architect, extract and store the tech stack
    if (currentPhase === "Architect" && executionPhase === "planning") {
      // Try to parse JSON from the Architect output
      const jsonMatch = rawContent.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try {
          JSON.parse(jsonMatch[0]); // validate it's valid JSON
          await ctx.runMutation(internal.agentTeamHelpers.updateTechStack, {
            sessionId: args.sessionId,
            techStackJson: jsonMatch[0],
          });
        } catch { /* ignore invalid JSON */ }
      }
    }

    // Handle file operations from agent output
    let fileOpsCount = 0;
    if (parsed.fileOps.length > 0) {
      for (const fileOp of parsed.fileOps) {
        if (fileOp.filepath && fileOp.content !== undefined) {
          await ctx.runMutation(internal.agentTeamHelpers.upsertFile, {
            sessionId: args.sessionId, userId, filepath: fileOp.filepath, content: fileOp.content || "", agent: currentPhase,
          });
          fileOpsCount++;
        }
      }
    }

    // Handle GET-INFO request — pause execution and wait for user input
    if (parsed.infoRequest) {
      await ctx.runMutation(internal.agentTeamHelpers.setInfoRequest, {
        sessionId: args.sessionId,
        infoRequestJson: JSON.stringify({ ...parsed.infoRequest, agentName: currentPhase }),
      });
      // Save the agent message showing the info request
      const newTotalMsgsInfo = totalMessages + 1;
      await ctx.runMutation(internal.agentTeamHelpers.saveAgentMessage, {
        sessionId: args.sessionId, userId, agent: currentPhase, content: parsed.cleanContent,
        round: loopCount, messageIndex: newTotalMsgsInfo,
        modelUsed: undefined, agentBucksDeducted: undefined,
      });
      await ctx.runMutation(internal.agentTeamHelpers.updateSessionStatus, {
        sessionId: args.sessionId, status: "idle", currentAgent: currentPhase,
        round: session.round, loopCount, phase: currentPhase, totalMessages: newTotalMsgsInfo,
      });
      return { agent: currentPhase, content: parsed.cleanContent, done: false, nextAgent: currentPhase, loopCount, totalMessages: newTotalMsgsInfo, fileOpsCount: 0 };
    }

    // Handle deploy commands from Planner
    if (parsed.deployCommands && parsed.deployCommands.length > 0) {
      await ctx.runMutation(internal.agentTeamHelpers.updateDeployCommands, {
        sessionId: args.sessionId,
        deployCommandsJson: JSON.stringify(parsed.deployCommands),
      });
    }

    // Handle task summaries from Summarizer — store FULL summary (cumulative, replaces previous)
    if (currentPhase === "Summarizer" && parsed.cleanContent) {
      let summaries: Array<{ taskIndex: number; summary: string }> = [];
      try { if (session.taskSummariesJson) summaries = JSON.parse(session.taskSummariesJson); } catch { /* ignore */ }
      // Replace existing summary for this task index if it exists, otherwise append
      const existingIdx = summaries.findIndex(s => s.taskIndex === currentTaskIndex);
      if (existingIdx >= 0) {
        summaries[existingIdx] = { taskIndex: currentTaskIndex, summary: parsed.cleanContent };
      } else {
        summaries.push({ taskIndex: currentTaskIndex, summary: parsed.cleanContent });
      }
      await ctx.runMutation(internal.agentTeamHelpers.updateTaskSummaries, {
        sessionId: args.sessionId,
        taskSummariesJson: JSON.stringify(summaries),
      });
    }

    // Cost accounting
    const TIER_MODEL_NAMES: Record<ModelTier, string> = {
      gemini: "gemini-3.1-flash-lite-preview",
      haiku: "claude-haiku-4-5",
      sonnet: "claude-sonnet-4-6",
      opus46: "claude-opus-4-6",
      opus47: "claude-opus-4-7",
    };
    const agentBucksToDeduct = calcAgentBucksForTier(usedTier, inputTokens, outputTokens);
    await ctx.runMutation(internal.sandboxHelpers.deductAgentBucks, { userId, agentBucksToDeduct });

    // Deduct from platform budget
    const modelNameForBudget = TIER_MODEL_NAMES[usedTier];
    await ctx.runMutation(internal.admin.deductPlatformCost, { modelName: modelNameForBudget, inputTokens, outputTokens });

    const newTotalMessages = totalMessages + 1;
    const updatedTaskMessageCount = executionPhase === "tasks" ? taskMessageCount + 1 : 0;
    await ctx.runMutation(internal.agentTeamHelpers.saveAgentMessage, {
      sessionId: args.sessionId, userId, agent: currentPhase, content: parsed.cleanContent, round: loopCount, messageIndex: newTotalMessages,
      modelUsed: TIER_MODEL_NAMES[usedTier],
      agentBucksDeducted: agentBucksToDeduct,
    });

    // ─── Determine next state ─────────────────────────────────────────────────
    let nextPhase: string;
    let newLoopCount = loopCount;
    let done = false;
    let newExecutionPhase = executionPhase;
    let newTaskIndex = currentTaskIndex;
    let newFinalReviewCoderEnabled = finalReviewCoderEnabled;
    let newTaskMessageCount = updatedTaskMessageCount;
    let newTaskUpgradeActive = taskUpgradeActive;
    let newTaskUpgradeMessagesLeft = taskUpgradeActive ? taskUpgradeMessagesLeft - 1 : 0;
    let newUnfixableTasks = [...unfixableTasks];

    // Decrement upgrade window
    if (taskUpgradeActive && newTaskUpgradeMessagesLeft <= 0) {
      newTaskUpgradeActive = false;
      newTaskUpgradeMessagesLeft = 0;
    }

    const currentPipelineIdx = pipeline.indexOf(currentPhase);
    const isRejection = (currentPhase === "Tester" && parsed.testerResult === "fail") ||
                        (currentPhase === "Hacker" && parsed.hackerResult === "fail") ||
                        (currentPhase === "Critic" && parsed.criticResult === "fail");

    if (executionPhase === "planning") {
      // Planning phase: advance through PLANNING_PIPELINE
      if (currentPhase === "Architect") {
        // Architect is the last step in planning — now move to tasks
        newExecutionPhase = "tasks";
        newTaskIndex = 0;
        newTaskMessageCount = 0;
        const taskPipeline = getPipeline("tasks", plannerTasks, 0, false);
        nextPhase = taskPipeline[0];
        await ctx.runMutation(internal.agentTeamHelpers.updateSessionFull, {
          sessionId: args.sessionId, status: "idle", currentAgent: taskPipeline[0], loopCount: newLoopCount,
          phase: taskPipeline[0], totalMessages: newTotalMessages, executionPhase: "tasks", currentTaskIndex: 0,
          finalReviewCoderEnabled: false,
        });
        return { agent: currentPhase, content: parsed.cleanContent, done: false, nextAgent: taskPipeline[0], loopCount: newLoopCount, totalMessages: newTotalMessages, fileOpsCount };
      } else if (currentPhase === "Planner") {
        // After Planner, move to Architect (next in PLANNING_PIPELINE)
        nextPhase = "Architect";
      } else if (false && currentPhase === "Planner_DISABLED") {
        // Legacy: Planner used to transition directly to tasks — now Architect does it
        newExecutionPhase = "tasks";
        newTaskIndex = 0;
        newTaskMessageCount = 0; // reset for first task
        const taskPipeline = getPipeline("tasks", plannerTasks, 0, false);
        nextPhase = taskPipeline[0];
      } else {
        nextPhase = PLANNING_PIPELINE[currentPipelineIdx + 1] || "Planner";
      }
    } else if (executionPhase === "tasks") {
      const taskPipeline = getPipeline("tasks", plannerTasks, currentTaskIndex, false);

      if (isRejection) {
        // Check if we should activate Modal Upgrade or skip task
        // Manual upgrade: activate immediately on rejection if user enabled it
        if (!taskUpgradeActive && (manualUpgradeEnabled || newTaskMessageCount >= MODAL_UPGRADE_TRIGGER)) {
          // Activate Modal Upgrade for next 30 messages
          newTaskUpgradeActive = true;
          newTaskUpgradeMessagesLeft = MODAL_UPGRADE_DURATION;
          nextPhase = taskPipeline[0]; // restart task with upgraded models
          newLoopCount = loopCount + 1;
          const upgradeReason = manualUpgradeEnabled ? "manually activated by user" : `${newTaskMessageCount} messages used`;
          // Save a system message about the upgrade
          await ctx.runMutation(internal.agentTeamHelpers.saveAgentMessage, {
            sessionId: args.sessionId, userId, agent: "System",
            content: `⚡ MODAL UPGRADE ACTIVATED (${upgradeReason}): Task "${plannerTasks[currentTaskIndex]?.title ?? `Task ${currentTaskIndex + 1}`}" is being upgraded. All agents now running at maximum capability (Sonnet→Opus 4.7, Haiku→Opus 4.6) for the next ${MODAL_UPGRADE_DURATION} messages.`,
            round: loopCount, messageIndex: newTotalMessages + 0.5,
          });
          // Disable manual upgrade flag now that it's been consumed
          await ctx.runMutation(internal.agentTeamHelpers.updateSessionFull, {
            sessionId: args.sessionId, status: "running", currentAgent: currentPhase,
            loopCount: newLoopCount, phase: currentPhase, totalMessages: newTotalMessages,
            executionPhase, currentTaskIndex, finalReviewCoderEnabled,
            taskMessageCount: newTaskMessageCount, taskUpgradeActive: true,
            taskUpgradeMessagesLeft: MODAL_UPGRADE_DURATION, unfixableTasksJson: JSON.stringify(newUnfixableTasks),
            manualUpgradeEnabled: false,
          });
        } else if (taskUpgradeActive && newTaskUpgradeMessagesLeft <= 0) {
          // Upgrade expired and still rejected — skip this task
          const taskTitle = plannerTasks[currentTaskIndex]?.title ?? `Task ${currentTaskIndex + 1}`;
          newUnfixableTasks.push({ taskIndex: currentTaskIndex, title: taskTitle });
          // Save a system message about the skip
          await ctx.runMutation(internal.agentTeamHelpers.saveAgentMessage, {
            sessionId: args.sessionId, userId, agent: "System",
            content: `⚠️ Task "${taskTitle}" could not be fixed even with Modal Upgrade. Skipping and marking as unfixable. This will be reported at the end of the session.`,
            round: loopCount, messageIndex: newTotalMessages + 0.5,
          });
          // Move to next task
          const nextTaskIndex = currentTaskIndex + 1;
          if (nextTaskIndex < plannerTasks.length) {
            newTaskIndex = nextTaskIndex;
            newTaskMessageCount = 0;
            newTaskUpgradeActive = false;
            newTaskUpgradeMessagesLeft = 0;
            const nextTaskPipeline = getPipeline("tasks", plannerTasks, nextTaskIndex, false);
            nextPhase = nextTaskPipeline[0];
          } else {
            newExecutionPhase = "final_review";
            newFinalReviewCoderEnabled = false;
            newTaskMessageCount = 0;
            newTaskUpgradeActive = false;
            nextPhase = FINAL_REVIEW_PIPELINE_SKIP_CODER[0];
          }
        } else {
          // Normal rejection — restart task (keep taskMessageCount cumulative!)
          nextPhase = taskPipeline[0];
          newLoopCount = loopCount + 1;
          // DO NOT reset newTaskMessageCount here — it must accumulate across restarts
          // so the upgrade trigger fires after enough messages
        }
      } else if (currentPhase === "Critic" && parsed.criticResult !== "fail") {
        // Critic passed — run Summarizer next (Summarizer will advance the task index)
        nextPhase = "Summarizer";
      } else if (currentPhase === "Summarizer") {
        // Summarizer complete — now advance to next task or final review
        const nextTaskIndex = currentTaskIndex + 1;
        if (nextTaskIndex < plannerTasks.length) {
          newTaskIndex = nextTaskIndex;
          newTaskMessageCount = 0; // reset for new task
          newTaskUpgradeActive = false;
          newTaskUpgradeMessagesLeft = 0;
          const nextTaskPipeline = getPipeline("tasks", plannerTasks, nextTaskIndex, false);
          nextPhase = nextTaskPipeline[0];
        } else {
          newExecutionPhase = "final_review";
          newFinalReviewCoderEnabled = false;
          newTaskMessageCount = 0;
          newTaskUpgradeActive = false;
          nextPhase = FINAL_REVIEW_PIPELINE_SKIP_CODER[0];
        }
      } else {
        // Advance within task pipeline
        const nextIdx = taskPipeline.indexOf(currentPhase) + 1;
        nextPhase = taskPipeline[nextIdx] || "Critic";
      }
    } else {
      // final_review phase
      const reviewPipeline = finalReviewCoderEnabled ? FINAL_REVIEW_PIPELINE_WITH_CODER : FINAL_REVIEW_PIPELINE_SKIP_CODER;

      if (currentPhase === "Critic") {
        if (parsed.criticResult === "fail") {
          if (!finalReviewCoderEnabled) {
            newFinalReviewCoderEnabled = true;
            nextPhase = FINAL_REVIEW_PIPELINE_WITH_CODER[0];
            newLoopCount = loopCount + 1;
          } else {
            nextPhase = "completed";
            done = true;
          }
        } else {
          nextPhase = "completed";
          done = true;
        }
      } else {
        const nextIdx = reviewPipeline.indexOf(currentPhase) + 1;
        nextPhase = reviewPipeline[nextIdx] || "Critic";
      }
    }

    if (newTotalMessages >= MAX_MESSAGES) { done = true; nextPhase = "completed"; }

    // If done and there are unfixable tasks, save a final report message
    if (done && newUnfixableTasks.length > 0) {
      await ctx.runMutation(internal.agentTeamHelpers.saveAgentMessage, {
        sessionId: args.sessionId, userId, agent: "System",
        content: `📋 SESSION COMPLETE — UNFIXABLE ISSUES REPORT:\n\nThe following ${newUnfixableTasks.length} task(s) could not be resolved even after Modal Upgrade:\n\n${newUnfixableTasks.map((t, i) => `${i + 1}. Task ${t.taskIndex + 1}: "${t.title}"`).join("\n")}\n\nThese tasks were skipped to allow the rest of the project to complete. You may want to manually review and fix these issues.`,
        round: loopCount, messageIndex: newTotalMessages + 0.5,
      });
    }

    // Clear streaming output
    await ctx.runMutation(internal.agentTeamHelpers.updateStreamingOutput, { sessionId: args.sessionId, currentAgentOutput: "" });

    // Update session state
    await ctx.runMutation(internal.agentTeamHelpers.updateSessionFull, {
      sessionId: args.sessionId,
      status: done ? "completed" : "idle",
      currentAgent: done ? undefined : nextPhase,
      loopCount: newLoopCount,
      phase: done ? "completed" : nextPhase,
      totalMessages: newTotalMessages,
      executionPhase: done ? "completed" : newExecutionPhase,
      currentTaskIndex: newTaskIndex,
      finalReviewCoderEnabled: newFinalReviewCoderEnabled,
      taskMessageCount: newTaskMessageCount,
      taskUpgradeActive: newTaskUpgradeActive,
      taskUpgradeMessagesLeft: newTaskUpgradeMessagesLeft,
      unfixableTasksJson: JSON.stringify(newUnfixableTasks),
      clearPlannerTasks: done ? true : undefined,
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

// ─── Background self-scheduling runner ───────────────────────────────────────
// Thin wrapper: handles stale-state recovery, then kicks off backgroundRunOneRound.
// backgroundRunOneRound is now self-scheduling — each agent gets its own fresh action.
export const backgroundRunSession = internalAction({
  args: { sessionId: v.id("teamSessions") },
  handler: async (ctx, args): Promise<void> => {
    const session = (await ctx.runQuery(internal.agentTeamHelpers.getSession, { sessionId: args.sessionId })) as SessionRow | null;
    if (!session) return;
    if (session.status === "completed") return;

    // If status is "running", check if it's stale (action timed out > 12 minutes ago)
    if (session.status === "running") {
      const runningAt = (session as Record<string, unknown>).runningAt as number | undefined;
      const STALE_THRESHOLD_MS = 12 * 60 * 1000; // 12 minutes
      if (runningAt && Date.now() - runningAt < STALE_THRESHOLD_MS) {
        return; // Genuinely running — skip to avoid double-running
      }
      // Stale "running" state — recover by resetting to idle and continuing
      console.log(`backgroundRunSession: recovering stale running state for session ${args.sessionId}`);
      await ctx.runMutation(internal.agentTeamHelpers.updateSessionStatus, {
        sessionId: args.sessionId, status: "idle",
        currentAgent: session.currentAgent, round: session.round,
        loopCount: session.loopCount, phase: session.phase, totalMessages: session.totalMessages,
      });
    }

    // Schedule backgroundRunOneRound as a new independent action
    // Each agent gets its own fresh 10-minute timeout budget
    await ctx.scheduler.runAfter(0, internal.agentTeam.backgroundRunOneRound, { sessionId: args.sessionId });
  },
});

// ─── One-agent-per-action runner ─────────────────────────────────────────────
// Each invocation runs exactly ONE agent, then schedules the next as a new action.
// This gives every agent its own fresh 10-minute Convex action timeout.
export const backgroundRunOneRound = internalAction({
  args: { sessionId: v.id("teamSessions") },
  handler: async (ctx, args): Promise<void> => {
    const session = (await ctx.runQuery(internal.agentTeamHelpers.getSession, { sessionId: args.sessionId })) as SessionRow | null;
    if (!session) return;
    if (session.status === "completed") return;

    // If status is "running", skip — the existing chain is active.
    // Only recover if stale (action timed out > 12 minutes ago).
    // startBackgroundSession handles stale recovery for external triggers.
    if (session.status === "running") {
      const runningAt = (session as Record<string, unknown>).runningAt as number | undefined;
      const STALE_THRESHOLD_MS = 12 * 60 * 1000; // 12 minutes
      if (!runningAt || Date.now() - runningAt < STALE_THRESHOLD_MS) {
        return; // Genuinely running — skip to avoid double-running
      }
      // Stale "running" state — recover by resetting to idle and continuing
      await ctx.runMutation(internal.agentTeamHelpers.updateSessionStatus, {
        sessionId: args.sessionId, status: "idle",
        currentAgent: session.currentAgent, round: session.round,
        loopCount: session.loopCount, phase: session.phase, totalMessages: session.totalMessages,
      });
    }

    const userId = session.userId;
    const totalMessages = session.totalMessages ?? 0;
    if (totalMessages >= MAX_MESSAGES) {
      await ctx.runMutation(internal.agentTeamHelpers.updateSessionStatus, {
        sessionId: args.sessionId, status: "completed", currentAgent: undefined,
        round: session.round, loopCount: session.loopCount, phase: "completed", totalMessages,
      });
      return;
    }

    const executionPhase = session.executionPhase ?? "planning";
    const currentTaskIndex = session.currentTaskIndex ?? 0;
    const loopCount = session.loopCount ?? 0;
    const finalReviewCoderEnabled = session.finalReviewCoderEnabled ?? false;
    const taskMessageCount = session.taskMessageCount ?? 0;
    const taskUpgradeActive = session.taskUpgradeActive ?? false;
    const taskUpgradeMessagesLeft = session.taskUpgradeMessagesLeft ?? 0;
    const manualUpgradeEnabled = session.manualUpgradeEnabled ?? false;

    let plannerTasks: PlannerTask[] = [];
    if (session.plannerTasksJson) {
      try { plannerTasks = JSON.parse(session.plannerTasksJson) as PlannerTask[]; } catch { /* ignore */ }
    }

    // ── Force-skip task if it exceeded per-task message limit ────────────────
    if (executionPhase === "tasks" && taskMessageCount >= MAX_TASK_MESSAGES) {
      const currentTask = plannerTasks[currentTaskIndex] ?? null;
      const taskTitle = currentTask?.title ?? `Task ${currentTaskIndex + 1}`;
      let unfixableTasks: Array<{ taskIndex: number; title: string }> = [];
      try { if (session.unfixableTasksJson) unfixableTasks = JSON.parse(session.unfixableTasksJson); } catch { /* ignore */ }
      unfixableTasks.push({ taskIndex: currentTaskIndex, title: taskTitle });
      const nextTaskIndex = currentTaskIndex + 1;
      let newExecutionPhaseSkip = executionPhase;
      let newTaskIndexSkip = currentTaskIndex;
      let newNextPhaseSkip: string;
      let doneSkip = false;
      if (nextTaskIndex < plannerTasks.length) {
        newTaskIndexSkip = nextTaskIndex;
        const nextPipeline = getPipeline("tasks", plannerTasks, nextTaskIndex, false);
        newNextPhaseSkip = nextPipeline[0];
      } else {
        newExecutionPhaseSkip = "final_review";
        newNextPhaseSkip = FINAL_REVIEW_PIPELINE_SKIP_CODER[0];
      }
      if ((session.totalMessages ?? 0) >= MAX_MESSAGES) { doneSkip = true; newNextPhaseSkip = "completed"; }
      await ctx.runMutation(internal.agentTeamHelpers.saveAgentMessage, {
        sessionId: args.sessionId, userId, agent: "System",
        content: `⚠️ Task "${taskTitle}" exceeded the ${MAX_TASK_MESSAGES}-message limit and was skipped. Moving to next task.`,
        round: loopCount, messageIndex: (session.totalMessages ?? 0) + 0.5,
      });
      await ctx.runMutation(internal.agentTeamHelpers.updateSessionFull, {
        sessionId: args.sessionId, status: doneSkip ? "completed" : "idle",
        currentAgent: doneSkip ? undefined : newNextPhaseSkip, loopCount,
        phase: doneSkip ? "completed" : newNextPhaseSkip, totalMessages: session.totalMessages ?? 0,
        executionPhase: doneSkip ? "completed" : newExecutionPhaseSkip, currentTaskIndex: newTaskIndexSkip,
        finalReviewCoderEnabled, taskMessageCount: 0, taskUpgradeActive: false,
        taskUpgradeMessagesLeft: 0, unfixableTasksJson: JSON.stringify(unfixableTasks),
      });
      if (!doneSkip) await ctx.scheduler.runAfter(0, internal.agentTeam.backgroundRunOneRound, { sessionId: args.sessionId });
      return;
    }

    const pipeline = getPipeline(executionPhase, plannerTasks, currentTaskIndex, finalReviewCoderEnabled);
    const rawPhase = session.phase ?? pipeline[0];
    const currentPhase = pipeline.includes(rawPhase) ? rawPhase : pipeline[0];

    const prevMessages = (await ctx.runQuery(internal.agentTeamHelpers.getSessionMessages, { sessionId: args.sessionId })) as MsgRow[];
    const projectFiles = (await ctx.runQuery(internal.agentTeamHelpers.getFiles, { sessionId: args.sessionId })) as FileRow[];

    // Build task summaries context for new tasks
    let taskSummaries: Array<{ taskIndex: number; summary: string }> = [];
    if (session.taskSummariesJson) {
      try { taskSummaries = JSON.parse(session.taskSummariesJson) as Array<{ taskIndex: number; summary: string }>; } catch { /* ignore */ }
    }

    // For tasks phase: only show messages from current task (not previous tasks)
    // Previous tasks are represented by their summaries
    let contextMessages = prevMessages;
    if (executionPhase === "tasks" && currentTaskIndex > 0) {
      // Find messages from current task only (after the last Summarizer message)
      const summarizerMessages = prevMessages.filter(m => m.agent === "Summarizer");
      if (summarizerMessages.length > 0) {
        const lastSummarizerIdx = prevMessages.lastIndexOf(summarizerMessages[summarizerMessages.length - 1]);
        contextMessages = prevMessages.slice(lastSummarizerIdx + 1);
      }
    }

    const contextLines = contextMessages.slice(-20).map((m) => `[${m.agent}]: ${m.content.slice(0, 1500)}`).join("\n\n---\n\n");
    // File manifest: just paths so agents always know the full directory structure
    const fileManifestBg = projectFiles.length > 0
      ? `\n\n## EXISTING FILE MANIFEST (${projectFiles.length} files — CHECK THIS BEFORE CREATING ANY FILE):\n${projectFiles.map(f => `  ${f.filepath}`).join("\n")}\n⚠️ DO NOT create a file that already exists in this manifest. Use <<EDITFILE>> to modify existing files.`
      : "";
    const filesContext = projectFiles.length > 0
      ? `\n\nCURRENT PROJECT FILES (${projectFiles.length} files):\n` +
        projectFiles.map((f) => `--- ${f.filepath} ---\n${f.content.slice(0, 1500)}${f.content.length > 1500 ? "\n...(truncated)" : ""}`).join("\n\n")
      : "";

    // Task context
    let taskContext = "";
    if (executionPhase === "tasks" && plannerTasks.length > 0) {
      const currentTask = plannerTasks[currentTaskIndex];
      if (currentTask) {
        taskContext = `\n\nCURRENT TASK (${currentTaskIndex + 1}/${plannerTasks.length}): ${currentTask.title}\n${currentTask.description}`;
        // Add summaries of completed tasks
        if (taskSummaries.length > 0) {
          const completedSummaries = taskSummaries.filter(s => s.taskIndex < currentTaskIndex);
          if (completedSummaries.length > 0) {
            taskContext += `\n\nCOMPLETED TASKS SUMMARY:\n${completedSummaries.map(s => `Task ${s.taskIndex + 1}: ${s.summary}`).join("\n")}`;
          }
        }
      }
    }

    // Fetch sandbox
    let sandboxDbId: Id<"sandboxes"> | null = null;
    let sandboxDaytonaId: string | null = null;
    let sandboxContext = "";
    if (currentPhase !== "Researcher" && currentPhase !== "Analyser" && currentPhase !== "Planner") {
      const sandbox = (await ctx.runQuery(internal.sandboxHelpers.getSandboxBySession, { sessionId: args.sessionId })) as SandboxDbRow | null;
      if (sandbox && sandbox.status === "running") {
        sandboxDbId = sandbox._id;
        sandboxDaytonaId = sandbox.sandboxId;
        if (sandbox.lastCommand || sandbox.lastOutput) {
          sandboxContext = `\n\nLAST SANDBOX OUTPUT:\n$ ${sandbox.lastCommand ?? ""}\n${(sandbox.lastOutput ?? "").slice(0, 1500)}`;
        }
      }
    }

    const systemPrompt = AGENT_SYSTEM_PROMPTS[currentPhase] || AGENT_SYSTEM_PROMPTS["Researcher"];
    const phaseLabel = executionPhase === "planning" ? "PLANNING PHASE" : executionPhase === "final_review" ? "FINAL REVIEW" : `TASK ${currentTaskIndex + 1}/${plannerTasks.length}`;
    // Tech stack context — shared with all agents after Architect runs
    const techStackContextBg = session.techStackJson
      ? `\n\n## APPROVED TECH STACK (defined by Architect — MUST follow this exactly):\n${session.techStackJson}`
      : "";
    // For Summarizer: pass ALL previous summaries as context so it can produce a cumulative summary
    const summarizerContext = currentPhase === "Summarizer" && taskSummaries.length > 0
      ? `\n\nPREVIOUS TASK SUMMARIES (incorporate ALL of this into your new cumulative summary):\n${taskSummaries.map(s => `=== Task ${s.taskIndex + 1} Summary ===\n${s.summary}`).join("\n\n")}`
      : "";

    const prompt = prevMessages.length === 0
      ? `TASK: ${session.task}\n\nPHASE: ${phaseLabel}${taskContext}${techStackContextBg}${fileManifestBg}\n\nYou are the first agent (${currentPhase}). Begin your work.${filesContext}${sandboxContext}`
      : `TASK: ${session.task}\n\nPHASE: ${phaseLabel}${taskContext}\nMESSAGE COUNT: ${totalMessages + 1}/${MAX_MESSAGES}\nLOOP: ${loopCount + 1}${techStackContextBg}${summarizerContext}${fileManifestBg}\n\nPREVIOUS DISCUSSION:\n${contextLines}${filesContext}${sandboxContext}\n\nNow provide your ${currentPhase} output, building on all previous work.`;

    await ctx.runMutation(internal.agentTeamHelpers.updateSessionStatus, {
      sessionId: args.sessionId, status: "running", currentAgent: currentPhase,
      round: session.round, loopCount, phase: currentPhase, totalMessages,
    });

    // Determine model tier for this agent
    let agentTier: ModelTier = (AGENT_MODEL_MAP[currentPhase] as ModelTier) ?? "gemini";
    const currentDifficulty = (session.currentTaskDifficulty ?? "normal") as TaskDifficulty;
    if (currentPhase === "Coder") {
      agentTier = DIFFICULTY_CODER_MODEL[currentDifficulty] ?? "gemini";
    } else if (["DataCorruptor", "ZeroDayExploiter"].includes(currentPhase)) {
      const override = DIFFICULTY_REDTEAM_SONNET_OVERRIDE[currentDifficulty];
      if (override) agentTier = override;
    }

    // Run the agent
    let agentResult: { rawContent: string; inputTokens: number; outputTokens: number; tier: ModelTier };
    if (currentPhase === "Researcher") {
      const r = await runResearchTeam(ctx, args.sessionId, session.task + (taskContext ? `\n\nCurrent task context: ${taskContext}` : ""));
      agentResult = { ...r, tier: "gemini" };
    } else if (currentPhase === "Hacker") {
      const redTeamContext = `PROJECT TASK: ${session.task}\n\nCURRENT PHASE: ${phaseLabel}\n\nPROJECT FILES:\n${projectFiles.map(f => `--- ${f.filepath} ---\n${f.content.slice(0, 2000)}`).join("\n\n").slice(0, 12000)}\n\nPREVIOUS AGENT OUTPUTS:\n${contextLines.slice(0, 4000)}`;
      const r = await runRedTeam(ctx, args.sessionId, redTeamContext);
      agentResult = { ...r, tier: "gemini" };
    } else {
      agentResult = await runSingleAgentCall(ctx, args.sessionId, userId, currentPhase, prompt, systemPrompt, sandboxDaytonaId, sandboxDbId, agentTier);
    }

    const { rawContent, inputTokens, outputTokens, tier } = agentResult;
    const parsed = parseAgentOutput(rawContent);

    // Planner: extract task list
    if (currentPhase === "Planner" && executionPhase === "planning") {
      const plannerOutput = parsePlannerOutput(rawContent);
      if (plannerOutput && plannerOutput.tasks.length > 0) {
        await ctx.runMutation(internal.agentTeamHelpers.updatePlannerTasks, { sessionId: args.sessionId, plannerTasksJson: JSON.stringify(plannerOutput.tasks) });
        plannerTasks = plannerOutput.tasks;
      } else {
        const defaultTasks: PlannerTask[] = [{ id: "task-1", title: session.task.slice(0, 80), description: `Complete the full implementation: ${session.task}`, subpart: false, dependencies: [] }];
        await ctx.runMutation(internal.agentTeamHelpers.updatePlannerTasks, { sessionId: args.sessionId, plannerTasksJson: JSON.stringify(defaultTasks) });
        plannerTasks = defaultTasks;
      }
    }

    // File operations
    let fileOpsCount = 0;
    const fileOpsMap = new Map<string, typeof parsed.fileOps[0]>();
    for (const op of parsed.fileOps) { fileOpsMap.set(op.filepath, op); }
    for (const fileOp of fileOpsMap.values()) {
      if (fileOp.type === "create" || fileOp.type === "edit") {
        await ctx.runMutation(internal.agentTeamHelpers.upsertFile, { sessionId: args.sessionId, userId, filepath: fileOp.filepath, content: fileOp.content || "", agent: currentPhase });
        fileOpsCount++;
      } else if (fileOp.type === "delete") {
        await ctx.runMutation(internal.agentTeamHelpers.deleteFile, { sessionId: args.sessionId, filepath: fileOp.filepath });
        fileOpsCount++;
      }
    }

    if (parsed.deployCommands && parsed.deployCommands.length > 0) {
      await ctx.runMutation(internal.agentTeamHelpers.updateDeployCommands, { sessionId: args.sessionId, deployCommandsJson: JSON.stringify(parsed.deployCommands) });
    }

    // Handle GET-INFO request — pause background execution and wait for user input
    if (parsed.infoRequest) {
      await ctx.runMutation(internal.agentTeamHelpers.setInfoRequest, {
        sessionId: args.sessionId,
        infoRequestJson: JSON.stringify({ ...parsed.infoRequest, agentName: currentPhase }),
      });
      const newTotalMsgsBg = totalMessages + 1;
      await ctx.runMutation(internal.agentTeamHelpers.saveAgentMessage, {
        sessionId: args.sessionId, userId, agent: currentPhase, content: parsed.cleanContent,
        round: loopCount, messageIndex: newTotalMsgsBg,
        modelUsed: undefined, agentBucksDeducted: undefined,
      });
      await ctx.runMutation(internal.agentTeamHelpers.updateSessionStatus, {
        sessionId: args.sessionId, status: "idle", currentAgent: currentPhase,
        round: session.round, loopCount, phase: currentPhase, totalMessages: newTotalMsgsBg,
      });
      return; // Stop background loop — user must submit info
    }

    // Cost accounting
    const agentBucksToDeduct = calcAgentBucksForTier(tier, inputTokens, outputTokens);
    await ctx.runMutation(internal.sandboxHelpers.deductAgentBucks, { userId, agentBucksToDeduct });

    const newTotalMessages = totalMessages + 1;
    const modelLabel = tier === "gemini" ? "gemini-flash-lite" : tier === "haiku" ? "claude-haiku-4-5" : tier === "sonnet" ? "claude-sonnet-4-6" : tier === "opus46" ? "claude-opus-4-6" : "claude-opus-4-7";
    await ctx.runMutation(internal.agentTeamHelpers.saveAgentMessage, {
      sessionId: args.sessionId, userId, agent: currentPhase, content: parsed.cleanContent, round: loopCount, messageIndex: newTotalMessages,
      modelUsed: modelLabel, agentBucksDeducted: agentBucksToDeduct,
    });

    // Determine next state
    let nextPhase: string;
    let newLoopCount = loopCount;
    let done = false;
    let newExecutionPhase = executionPhase;
    let newTaskIndex = currentTaskIndex;
    let newFinalReviewCoderEnabled = finalReviewCoderEnabled;
    const currentPipelineIdx = pipeline.indexOf(currentPhase);

    if (executionPhase === "planning") {
      if (currentPhase === "Planner") {
        newExecutionPhase = "tasks";
        newTaskIndex = 0;
        const taskPipeline = getPipeline("tasks", plannerTasks, 0, false);
        nextPhase = taskPipeline[0];
        // Parse difficulty from planner output
        const difficulty = parseDifficultyFromPlannerOutput(rawContent);
        await ctx.runMutation(internal.agentTeamHelpers.updateSessionFull, {
          sessionId: args.sessionId, status: "idle", currentAgent: taskPipeline[0], loopCount: newLoopCount,
          phase: taskPipeline[0], totalMessages: newTotalMessages, executionPhase: "tasks", currentTaskIndex: 0,
          finalReviewCoderEnabled: false,
        });
        await ctx.runMutation(internal.agentTeamHelpers.updateTaskDifficulty, { sessionId: args.sessionId, difficulty });
        await ctx.scheduler.runAfter(0, internal.agentTeam.backgroundRunOneRound, { sessionId: args.sessionId });
        return;
      } else {
        nextPhase = PLANNING_PIPELINE[currentPipelineIdx + 1] || "Planner";
      }
    } else if (executionPhase === "tasks") {
      const taskPipeline = getPipeline("tasks", plannerTasks, currentTaskIndex, false);
      const isRejection = (currentPhase === "Tester" && parsed.testerResult === "fail") ||
                          (currentPhase === "Hacker" && parsed.hackerResult === "fail") ||
                          (currentPhase === "Critic" && parsed.criticResult === "fail");

      let newTaskMessageCount = taskMessageCount + 1;
      let newTaskUpgradeActive = taskUpgradeActive;
      let newTaskUpgradeMessagesLeft = taskUpgradeActive ? taskUpgradeMessagesLeft - 1 : 0;
      let newUnfixableTasks: Array<{ taskIndex: number; title: string }> = [];
      try { if (session.unfixableTasksJson) newUnfixableTasks = JSON.parse(session.unfixableTasksJson); } catch { /* ignore */ }

      if (isRejection) {
        if (!taskUpgradeActive && (manualUpgradeEnabled || newTaskMessageCount >= MODAL_UPGRADE_TRIGGER)) {
          // Activate Modal Upgrade
          const upgradeReason = manualUpgradeEnabled ? "manual" : `${newTaskMessageCount} task messages`;
          await ctx.runMutation(internal.agentTeamHelpers.saveAgentMessage, {
            sessionId: args.sessionId, userId, agent: "System",
            content: `⚡ MODAL UPGRADE ACTIVATED (${upgradeReason}): Task "${plannerTasks[currentTaskIndex]?.title ?? `Task ${currentTaskIndex + 1}`}" is being upgraded. All agents now running at maximum capability for the next ${MODAL_UPGRADE_DURATION} messages.`,
            round: loopCount, messageIndex: newTotalMessages + 0.5,
          });
          await ctx.runMutation(internal.agentTeamHelpers.updateSessionFull, {
            sessionId: args.sessionId, status: "idle", currentAgent: taskPipeline[0], loopCount: loopCount + 1,
            phase: taskPipeline[0], totalMessages: newTotalMessages, executionPhase, currentTaskIndex,
            finalReviewCoderEnabled, taskMessageCount: newTaskMessageCount, taskUpgradeActive: true,
            taskUpgradeMessagesLeft: MODAL_UPGRADE_DURATION, unfixableTasksJson: JSON.stringify(newUnfixableTasks),
            manualUpgradeEnabled: false,
          });
          await ctx.scheduler.runAfter(0, internal.agentTeam.backgroundRunOneRound, { sessionId: args.sessionId });
          return;
        } else if (taskUpgradeActive && newTaskUpgradeMessagesLeft <= 0) {
          // Upgrade expired and still rejected — skip this task
          const taskTitle = plannerTasks[currentTaskIndex]?.title ?? `Task ${currentTaskIndex + 1}`;
          newUnfixableTasks.push({ taskIndex: currentTaskIndex, title: taskTitle });
          await ctx.runMutation(internal.agentTeamHelpers.saveAgentMessage, {
            sessionId: args.sessionId, userId, agent: "System",
            content: `⚠️ Task "${taskTitle}" could not be fixed even with Modal Upgrade. Skipping and marking as unfixable.`,
            round: loopCount, messageIndex: newTotalMessages + 0.5,
          });
          const nextTaskIndex = currentTaskIndex + 1;
          if (nextTaskIndex < plannerTasks.length) {
            newTaskIndex = nextTaskIndex;
            newTaskUpgradeActive = false;
            newTaskUpgradeMessagesLeft = 0;
            const nextTaskPipeline = getPipeline("tasks", plannerTasks, nextTaskIndex, false);
            nextPhase = nextTaskPipeline[0];
          } else {
            newExecutionPhase = "final_review"; newFinalReviewCoderEnabled = false;
            newTaskUpgradeActive = false;
            nextPhase = FINAL_REVIEW_PIPELINE_SKIP_CODER[0];
          }
          await ctx.runMutation(internal.agentTeamHelpers.updateSessionFull, {
            sessionId: args.sessionId, status: "idle", currentAgent: nextPhase, loopCount: newLoopCount,
            phase: nextPhase, totalMessages: newTotalMessages, executionPhase: newExecutionPhase, currentTaskIndex: newTaskIndex,
            finalReviewCoderEnabled: newFinalReviewCoderEnabled, taskMessageCount: 0, taskUpgradeActive: false,
            taskUpgradeMessagesLeft: 0, unfixableTasksJson: JSON.stringify(newUnfixableTasks),
          });
          await ctx.scheduler.runAfter(0, internal.agentTeam.backgroundRunOneRound, { sessionId: args.sessionId });
          return;
        } else {
          // Normal rejection — restart task
          nextPhase = taskPipeline[0];
          newLoopCount = loopCount + 1;
          await ctx.runMutation(internal.agentTeamHelpers.updateSessionFull, {
            sessionId: args.sessionId, status: "idle", currentAgent: nextPhase, loopCount: newLoopCount,
            phase: nextPhase, totalMessages: newTotalMessages, executionPhase, currentTaskIndex,
            finalReviewCoderEnabled, taskMessageCount: newTaskMessageCount, taskUpgradeActive: newTaskUpgradeActive,
            taskUpgradeMessagesLeft: newTaskUpgradeMessagesLeft, unfixableTasksJson: JSON.stringify(newUnfixableTasks),
          });
          await ctx.scheduler.runAfter(0, internal.agentTeam.backgroundRunOneRound, { sessionId: args.sessionId });
          return;
        }
      } else if (currentPhase === "Critic" && parsed.criticResult !== "fail") {
        // Critic passed — run Summarizer next (Summarizer will advance the task index)
        nextPhase = "Summarizer";
      } else if (currentPhase === "Summarizer") {
        // Store FULL cumulative summary — replace existing for this task index
        const existingIdx = taskSummaries.findIndex(s => s.taskIndex === currentTaskIndex);
        let newSummaries = [...taskSummaries];
        if (existingIdx >= 0) {
          newSummaries[existingIdx] = { taskIndex: currentTaskIndex, summary: parsed.cleanContent };
        } else {
          newSummaries = [...taskSummaries, { taskIndex: currentTaskIndex, summary: parsed.cleanContent }];
        }
        await ctx.runMutation(internal.agentTeamHelpers.updateTaskSummaries, { sessionId: args.sessionId, taskSummariesJson: JSON.stringify(newSummaries) });
        const nextTaskIndex = currentTaskIndex + 1;
        if (nextTaskIndex < plannerTasks.length) {
          newTaskIndex = nextTaskIndex;
          newTaskUpgradeActive = false;
          newTaskUpgradeMessagesLeft = 0;
          const nextTaskPipeline = getPipeline("tasks", plannerTasks, nextTaskIndex, false);
          nextPhase = nextTaskPipeline[0];
        } else {
          newExecutionPhase = "final_review"; newFinalReviewCoderEnabled = false;
          newTaskUpgradeActive = false;
          nextPhase = FINAL_REVIEW_PIPELINE_SKIP_CODER[0];
        }
        // Reset task message count for the new task
        newTaskMessageCount = 0;
      } else {
        const nextIdx = taskPipeline.indexOf(currentPhase) + 1;
        nextPhase = taskPipeline[nextIdx] || "Critic";
      }

      // Update taskMessageCount in the final updateSessionFull below
      await ctx.runMutation(internal.agentTeamHelpers.updateSessionFull, {
        sessionId: args.sessionId, status: "idle", currentAgent: nextPhase, loopCount: newLoopCount,
        phase: nextPhase, totalMessages: newTotalMessages, executionPhase: newExecutionPhase, currentTaskIndex: newTaskIndex,
        finalReviewCoderEnabled: newFinalReviewCoderEnabled, taskMessageCount: newTaskMessageCount,
        taskUpgradeActive: newTaskUpgradeActive, taskUpgradeMessagesLeft: newTaskUpgradeMessagesLeft,
        unfixableTasksJson: JSON.stringify(newUnfixableTasks),
      });
      if (newTotalMessages >= MAX_MESSAGES) {
        await ctx.runMutation(internal.agentTeamHelpers.updateSessionFull, {
          sessionId: args.sessionId, status: "completed", currentAgent: undefined, loopCount: newLoopCount,
          phase: "completed", totalMessages: newTotalMessages, executionPhase: "completed", currentTaskIndex: newTaskIndex,
          finalReviewCoderEnabled: newFinalReviewCoderEnabled, taskMessageCount: newTaskMessageCount,
          taskUpgradeActive: false, taskUpgradeMessagesLeft: 0, unfixableTasksJson: JSON.stringify(newUnfixableTasks),
        });
        return;
      }
      await ctx.runMutation(internal.agentTeamHelpers.updateStreamingOutput, { sessionId: args.sessionId, currentAgentOutput: "" });
      await ctx.scheduler.runAfter(0, internal.agentTeam.backgroundRunOneRound, { sessionId: args.sessionId });
      return;
    } else {
      const reviewPipeline = finalReviewCoderEnabled ? FINAL_REVIEW_PIPELINE_WITH_CODER : FINAL_REVIEW_PIPELINE_SKIP_CODER;
      if (currentPhase === "Critic") {
        if (parsed.criticResult === "fail") {
          if (!finalReviewCoderEnabled) {
            newFinalReviewCoderEnabled = true; nextPhase = FINAL_REVIEW_PIPELINE_WITH_CODER[0]; newLoopCount = loopCount + 1;
          } else {
            nextPhase = "completed"; done = true;
          }
        } else {
          nextPhase = "completed"; done = true;
        }
      } else {
        const nextIdx = reviewPipeline.indexOf(currentPhase) + 1;
        nextPhase = reviewPipeline[nextIdx] || "Critic";
      }
    }

    if (newTotalMessages >= MAX_MESSAGES) { done = true; nextPhase = "completed"; }

    await ctx.runMutation(internal.agentTeamHelpers.updateStreamingOutput, { sessionId: args.sessionId, currentAgentOutput: "" });
    await ctx.runMutation(internal.agentTeamHelpers.updateSessionFull, {
      sessionId: args.sessionId, status: done ? "completed" : "idle",
      currentAgent: done ? undefined : nextPhase, loopCount: newLoopCount,
      phase: done ? "completed" : nextPhase, totalMessages: newTotalMessages,
      executionPhase: done ? "completed" : newExecutionPhase, currentTaskIndex: newTaskIndex,
      finalReviewCoderEnabled: newFinalReviewCoderEnabled,
      taskMessageCount: 0, taskUpgradeActive: false, taskUpgradeMessagesLeft: 0,
      clearPlannerTasks: done ? true : undefined,
    });

    if (!done) await ctx.scheduler.runAfter(0, internal.agentTeam.backgroundRunOneRound, { sessionId: args.sessionId });
  },
});

// Public action to stop a running session (marks as completed to halt background scheduler)
// Submit user's response to a GET-INFO request — resumes the agent with the provided data
export const submitInfoResponse = action({
  args: {
    sessionId: v.id("teamSessions"),
    token: v.optional(v.string()),
    responses: v.array(v.object({ fieldId: v.string(), value: v.string() })),
  },
  handler: async (ctx, args): Promise<void> => {
    const userId = (await ctx.runQuery(internal.customAuthHelpers.getUserIdByToken, { token: args.token || "" })) as Id<"users"> | null;
    if (!userId) throw new Error("Not authenticated");
    const session = (await ctx.runQuery(internal.agentTeamHelpers.getSession, { sessionId: args.sessionId })) as SessionRow | null;
    if (!session) throw new Error("Session not found");
    if (session.userId !== userId) throw new Error("Not authorized");
    if (!session.infoRequestJson) throw new Error("No pending info request");

    // Parse the info request to get the agent name
    let infoReq: InfoRequest & { agentName: string };
    try { infoReq = JSON.parse(session.infoRequestJson) as InfoRequest & { agentName: string }; }
    catch { throw new Error("Invalid info request data"); }

    // Format the user's responses as a message to the agent
    const responseText = `## User Provided Information\n\n${args.responses.map(r => `**${r.fieldId}**: ${r.value}`).join("\n")}`;

    // Save the user's response as a message
    const totalMessages = session.totalMessages ?? 0;
    await ctx.runMutation(internal.agentTeamHelpers.saveAgentMessage, {
      sessionId: args.sessionId, userId, agent: "User",
      content: responseText, round: session.loopCount ?? 0, messageIndex: totalMessages + 0.5,
    });

    // Clear the info request so execution can resume
    await ctx.runMutation(internal.agentTeamHelpers.clearInfoRequest, { sessionId: args.sessionId });

    // Update session to idle so it can be resumed
    await ctx.runMutation(internal.agentTeamHelpers.updateSessionStatus, {
      sessionId: args.sessionId, status: "idle", currentAgent: infoReq.agentName,
      round: session.round, loopCount: session.loopCount, phase: infoReq.agentName, totalMessages: totalMessages + 1,
    });
  },
});

export const stopSession = action({
  args: { sessionId: v.id("teamSessions"), token: v.optional(v.string()) },
  handler: async (ctx, args): Promise<void> => {
    const userId = (await ctx.runQuery(internal.customAuthHelpers.getUserIdByToken, { token: args.token || "" })) as Id<"users"> | null;
    if (!userId) throw new Error("Not authenticated");
    const session = (await ctx.runQuery(internal.agentTeamHelpers.getSession, { sessionId: args.sessionId })) as SessionRow | null;
    if (!session) throw new Error("Session not found");
    if (session.userId !== userId) throw new Error("Not authorized");
    // Force-reset to idle and clear runningAt so future RUN calls are never blocked
    await ctx.runMutation(internal.agentTeamHelpers.forceIdleSession, {
      sessionId: args.sessionId,
      currentAgent: session.currentAgent,
      round: session.round,
      loopCount: session.loopCount,
      phase: session.phase,
      totalMessages: session.totalMessages,
    });
  },
});

// Public action to start background execution (called from frontend once)
export const startBackgroundSession = action({
  args: { sessionId: v.id("teamSessions"), token: v.optional(v.string()) },
  handler: async (ctx, args): Promise<void> => {
    const userId = (await ctx.runQuery(internal.customAuthHelpers.getUserIdByToken, { token: args.token || "" })) as Id<"users"> | null;
    if (!userId) throw new Error("Not authenticated");
    const session = (await ctx.runQuery(internal.agentTeamHelpers.getSession, { sessionId: args.sessionId })) as SessionRow | null;
    if (!session) throw new Error("Session not found");
    if (session.userId !== userId) throw new Error("Not authorized");
    if (session.status === "completed") throw new Error("Session already completed");

    // If already running and NOT stale, skip scheduling — the existing chain will continue
    // This prevents double-scheduling which causes task regression
    if (session.status === "running") {
      const runningAt = (session as Record<string, unknown>).runningAt as number | undefined;
      const STALE_THRESHOLD_MS = 12 * 60 * 1000; // 12 minutes
      if (runningAt && Date.now() - runningAt < STALE_THRESHOLD_MS) {
        return; // Already running — don't interrupt or double-schedule
      }
      // Stale "running" state — recover by resetting to idle
      await ctx.runMutation(internal.agentTeamHelpers.updateSessionStatus, {
        sessionId: args.sessionId,
        status: "idle",
        currentAgent: session.currentAgent,
        round: session.round,
        loopCount: session.loopCount,
        phase: session.phase,
        totalMessages: session.totalMessages,
      });
    }

    // Schedule backgroundRunOneRound — each agent gets its own fresh timeout budget
    await ctx.scheduler.runAfter(0, internal.agentTeam.backgroundRunOneRound, { sessionId: args.sessionId });
  },
});

// ─── GitHub Sync ──────────────────────────────────────────────────────────────
export const saveGithubConfig = action({
  args: {
    sessionId: v.id("teamSessions"),
    githubRepo: v.string(),
    githubBranch: v.string(),
    token: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<void> => {
    const userId = (await ctx.runQuery(internal.customAuthHelpers.getUserIdByToken, { token: args.token || "" })) as Id<"users"> | null;
    if (!userId) throw new Error("Not authenticated");
    const session = (await ctx.runQuery(internal.agentTeamHelpers.getSession, { sessionId: args.sessionId })) as SessionRow | null;
    if (!session || session.userId !== userId) throw new Error("Not authorized");
    await ctx.runMutation(internal.agentTeamHelpers.saveGithubConfigMutation, {
      sessionId: args.sessionId,
      githubRepo: args.githubRepo,
      githubBranch: args.githubBranch,
    });
  },
});

export const syncGithub = action({
  args: {
    sessionId: v.id("teamSessions"),
    token: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<{ pushed: number; pulled: number; conflicts: string[] }> => {
    const userId = (await ctx.runQuery(internal.customAuthHelpers.getUserIdByToken, { token: args.token || "" })) as Id<"users"> | null;
    if (!userId) throw new Error("Not authenticated");
    const session = (await ctx.runQuery(internal.agentTeamHelpers.getSession, { sessionId: args.sessionId })) as SessionRow | null;
    if (!session || session.userId !== userId) throw new Error("Not authorized");

    const githubRepo = (session as Record<string, unknown>).githubRepo as string | undefined;
    const githubBranch = (session as Record<string, unknown>).githubBranch as string | undefined;
    const lastCommitSha = (session as Record<string, unknown>).githubLastCommitSha as string | undefined;

    if (!githubRepo || !githubBranch) throw new Error("GitHub not configured. Please connect a repository first.");

    // Get the user's stored OAuth token
    const user = await ctx.runQuery(internal.githubHelpers.getUserById, { userId });
    const githubToken = (user as Record<string, unknown> | null)?.githubAccessToken as string | undefined;
    if (!githubToken) throw new Error("GitHub account not connected. Please connect your GitHub account first.");

    // Parse owner/repo — if only a repo name is given, use the authenticated user's username
    let ownerRepo = githubRepo.trim().replace(/^https?:\/\/github\.com\//, "").replace(/\.git$/, "").replace(/\/$/, "");
    const parts = ownerRepo.split("/");
    let owner: string;
    let repo: string;
    const branch = githubBranch;

    const headers = {
      "Authorization": `Bearer ${githubToken}`,
      "Accept": "application/vnd.github.v3+json",
      "User-Agent": "Thalamus-AI/1.0",
      "Content-Type": "application/json",
    };

    if (parts.length < 2 || !parts[1]) {
      // Only repo name given — fetch the authenticated user's login
      const userRes = await fetch("https://api.github.com/user", { headers });
      if (!userRes.ok) throw new Error("Failed to fetch GitHub user info");
      const userData = await userRes.json() as { login: string };
      owner = userData.login;
      repo = parts[0];
    } else {
      owner = parts[0];
      repo = parts[1];
    }

    // Auto-create the repo if it doesn't exist
    const repoCheckRes = await fetch(`https://api.github.com/repos/${owner}/${repo}`, { headers });
    if (repoCheckRes.status === 404) {
      // Repo doesn't exist — create it
      const createRes = await fetch("https://api.github.com/user/repos", {
        method: "POST",
        headers,
        body: JSON.stringify({ name: repo, description: "Thalamus AI project", private: false, auto_init: true }),
      });
      if (!createRes.ok) {
        const errData = await createRes.json().catch(() => ({})) as { message?: string };
        throw new Error(`Failed to create repository: ${errData.message ?? createRes.status}`);
      }
      // Wait a moment for GitHub to initialize the repo
      await new Promise(r => setTimeout(r, 2000));
    }

    // ── Step 1: Get current GitHub tree ──────────────────────────────────────
    const SKIP_EXTENSIONS = [".png", ".jpg", ".jpeg", ".gif", ".svg", ".ico", ".woff", ".woff2", ".ttf", ".eot", ".mp4", ".mp3", ".zip", ".tar", ".gz", ".pdf", ".bin", ".exe", ".dll", ".so", ".dylib"];
    const MAX_FILE_SIZE = 100_000;

    let githubFiles: Record<string, { sha: string; content: string }> = {};
    let latestCommitSha = "";

    try {
      // Get latest commit SHA
      const refRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/ref/heads/${branch}`, { headers });
      if (refRes.ok) {
        const refData = await refRes.json() as { object?: { sha?: string } };
        latestCommitSha = refData.object?.sha ?? "";
      } else if (refRes.status === 404) {
        // Branch doesn't exist yet — we'll create it by pushing
        latestCommitSha = "";
      }

      if (latestCommitSha) {
        // Get tree
        const treeRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/trees/${latestCommitSha}?recursive=1`, { headers });
        if (treeRes.ok) {
          const treeData = await treeRes.json() as { tree: Array<{ path: string; type: string; sha: string; size?: number }> };
          const fileNodes = treeData.tree.filter(n =>
            n.type === "blob" &&
            (n.size ?? 0) < MAX_FILE_SIZE &&
            !SKIP_EXTENSIONS.some(ext => n.path.toLowerCase().endsWith(ext)) &&
            !n.path.includes("node_modules/") &&
            !n.path.includes(".git/") &&
            !n.path.includes("dist/") &&
            !n.path.includes("build/")
          ).slice(0, 300);

          // Fetch file contents in batches
          for (let i = 0; i < fileNodes.length; i += 10) {
            const batch = fileNodes.slice(i, i + 10);
            await Promise.all(batch.map(async (node) => {
              try {
                const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${latestCommitSha}/${node.path}`;
                const res = await fetch(rawUrl, { headers: { "Authorization": `Bearer ${githubToken}`, "User-Agent": "Thalamus-AI/1.0" } });
                if (res.ok) {
                  const content = await res.text();
                  githubFiles[node.path] = { sha: node.sha, content };
                }
              } catch { /* skip */ }
            }));
            if (i + 10 < fileNodes.length) await new Promise(r => setTimeout(r, 100));
          }
        }
      }
    } catch { /* GitHub fetch failed — proceed with push-only */ }

    // ── Step 2: Get local files ───────────────────────────────────────────────
    const localFiles = (await ctx.runQuery(internal.agentTeamHelpers.getFiles, { sessionId: args.sessionId })) as FileRow[];
    const localMap: Record<string, string> = {};
    for (const f of localFiles) localMap[f.filepath] = f.content;

    // ── Step 3: Determine changes ─────────────────────────────────────────────
    const conflicts: string[] = [];
    let pulled = 0;
    let pushed = 0;

    // Files in GitHub but not local, or different from local → pull
    const filesToPull: Array<{ path: string; content: string }> = [];
    for (const [path, { content }] of Object.entries(githubFiles)) {
      if (!(path in localMap)) {
        // New file from GitHub — pull it
        filesToPull.push({ path, content });
      } else if (localMap[path] !== content) {
        // Both changed — GitHub wins (last-write-wins from GitHub)
        // But if local was modified after last sync, it's a conflict — we'll note it but GitHub wins
        filesToPull.push({ path, content });
        conflicts.push(path);
      }
    }

    // Pull files from GitHub
    for (const { path, content } of filesToPull) {
      await ctx.runMutation(internal.agentTeamHelpers.upsertFile, {
        sessionId: args.sessionId,
        userId,
        filepath: path,
        content,
        agent: "GitHub Sync",
      });
      pulled++;
    }

    // ── Step 4: Push local files not in GitHub (or different) ────────────────
    // Build tree for GitHub commit
    const treeItems: Array<{ path: string; mode: string; type: string; content: string }> = [];
    for (const [path, content] of Object.entries(localMap)) {
      const githubContent = githubFiles[path]?.content;
      if (githubContent === undefined || githubContent !== content) {
        // New or changed local file — push to GitHub
        treeItems.push({ path, mode: "100644", type: "blob", content });
        // NOTE: pushed counter is set AFTER successful commit, not here
      }
    }

    if (treeItems.length > 0 && latestCommitSha !== "") {
      try {
        // Create blobs for each file
        const blobShas: Array<{ path: string; sha: string }> = [];
        for (let i = 0; i < treeItems.length; i += 5) {
          const batch = treeItems.slice(i, i + 5);
          await Promise.all(batch.map(async (item) => {
            try {
              const blobRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/blobs`, {
                method: "POST",
                headers,
                body: JSON.stringify({ content: item.content, encoding: "utf-8" }),
              });
              if (blobRes.ok) {
                const blobData = await blobRes.json() as { sha?: string };
                if (blobData.sha) blobShas.push({ path: item.path, sha: blobData.sha });
              }
            } catch { /* skip */ }
          }));
          if (i + 5 < treeItems.length) await new Promise(r => setTimeout(r, 100));
        }

        if (blobShas.length > 0) {
          // Create tree
          const treeRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/trees`, {
            method: "POST",
            headers,
            body: JSON.stringify({
              base_tree: latestCommitSha,
              tree: blobShas.map(b => ({ path: b.path, mode: "100644", type: "blob", sha: b.sha })),
            }),
          });

          if (treeRes.ok) {
            const treeData = await treeRes.json() as { sha?: string };
            if (treeData.sha) {
              // Create commit
              const commitRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/commits`, {
                method: "POST",
                headers,
                body: JSON.stringify({
                  message: `Thalamus AI sync — ${new Date().toISOString()}`,
                  tree: treeData.sha,
                  parents: [latestCommitSha],
                }),
              });

              if (commitRes.ok) {
                const commitData = await commitRes.json() as { sha?: string };
                if (commitData.sha) {
                  // Update branch ref
                  const refUpdateRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/refs/heads/${branch}`, {
                    method: "PATCH",
                    headers,
                    body: JSON.stringify({ sha: commitData.sha, force: true }),
                  });
                  if (refUpdateRes.ok) {
                    pushed = blobShas.length; // Only count after successful push
                    latestCommitSha = commitData.sha;
                  } else {
                    const errText = await refUpdateRes.text().catch(() => "");
                    throw new Error(`Failed to update branch ref: ${refUpdateRes.status} ${errText.slice(0, 200)}`);
                  }
                }
              } else {
                const errText = await commitRes.text().catch(() => "");
                throw new Error(`Failed to create commit: ${commitRes.status} ${errText.slice(0, 200)}`);
              }
            }
          } else {
            const errText = await treeRes.text().catch(() => "");
            throw new Error(`Failed to create git tree: ${treeRes.status} ${errText.slice(0, 200)}`);
          }
        }
      } catch (pushErr) {
        // Push failed — throw so the frontend shows the real error
        throw new Error(`Push failed: ${pushErr instanceof Error ? pushErr.message : String(pushErr)}`);
      }
    } else if (treeItems.length > 0 && latestCommitSha === "") {
      // Branch doesn't exist — initialize it
      try {
        // Get default branch SHA to use as base
        const repoRes = await fetch(`https://api.github.com/repos/${owner}/${repo}`, { headers });
        let baseSha = "";
        if (repoRes.ok) {
          const repoData = await repoRes.json() as { default_branch?: string };
          const defaultBranch = repoData.default_branch ?? "main";
          const baseRefRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/ref/heads/${defaultBranch}`, { headers });
          if (baseRefRes.ok) {
            const baseRefData = await baseRefRes.json() as { object?: { sha?: string } };
            baseSha = baseRefData.object?.sha ?? "";
          }
        }

        // Create blobs
        const blobShas: Array<{ path: string; sha: string }> = [];
        for (const item of treeItems.slice(0, 200)) {
          try {
            const blobRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/blobs`, {
              method: "POST",
              headers,
              body: JSON.stringify({ content: item.content, encoding: "utf-8" }),
            });
            if (blobRes.ok) {
              const blobData = await blobRes.json() as { sha?: string };
              if (blobData.sha) blobShas.push({ path: item.path, sha: blobData.sha });
            }
          } catch { /* skip */ }
        }

        if (blobShas.length > 0) {
          const treePayload: { base_tree?: string; tree: Array<{ path: string; mode: string; type: string; sha: string }> } = {
            tree: blobShas.map(b => ({ path: b.path, mode: "100644", type: "blob", sha: b.sha })),
          };
          if (baseSha) treePayload.base_tree = baseSha;

          const treeRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/trees`, {
            method: "POST",
            headers,
            body: JSON.stringify(treePayload),
          });

          if (treeRes.ok) {
            const treeData = await treeRes.json() as { sha?: string };
            if (treeData.sha) {
              const commitPayload: { message: string; tree: string; parents: string[] } = {
                message: `Thalamus AI initial sync — ${new Date().toISOString()}`,
                tree: treeData.sha,
                parents: baseSha ? [baseSha] : [],
              };
              const commitRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/commits`, {
                method: "POST",
                headers,
                body: JSON.stringify(commitPayload),
              });

              if (commitRes.ok) {
                const commitData = await commitRes.json() as { sha?: string };
                if (commitData.sha) {
                  // Create new branch or update existing
                  const createRefRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/refs`, {
                    method: "POST",
                    headers,
                    body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: commitData.sha }),
                  });
                  if (createRefRes.ok || createRefRes.status === 422) {
                    // 422 = ref already exists, try to update it
                    if (createRefRes.status === 422) {
                      await fetch(`https://api.github.com/repos/${owner}/${repo}/git/refs/heads/${branch}`, {
                        method: "PATCH",
                        headers,
                        body: JSON.stringify({ sha: commitData.sha, force: true }),
                      });
                    }
                    pushed = blobShas.length;
                    latestCommitSha = commitData.sha;
                  }
                }
              } else {
                const errText = await commitRes.text().catch(() => "");
                throw new Error(`Failed to create initial commit: ${commitRes.status} ${errText.slice(0, 200)}`);
              }
            }
          } else {
            const errText = await treeRes.text().catch(() => "");
            throw new Error(`Failed to create git tree: ${treeRes.status} ${errText.slice(0, 200)}`);
          }
        }
      } catch (initErr) {
        throw new Error(`Initial push failed: ${initErr instanceof Error ? initErr.message : String(initErr)}`);
      }
    }

    // Update last sync time and commit SHA
    await ctx.runMutation(internal.agentTeamHelpers.updateGithubSync, {
      sessionId: args.sessionId,
      lastSyncAt: Date.now(),
      lastCommitSha: latestCommitSha,
    });

    return { pushed, pulled, conflicts };
  },
});

// ─── Branch Management ────────────────────────────────────────────────────────
export const createBranch = action({
  args: {
    mainSessionId: v.id("teamSessions"),
    branchPurpose: v.string(), // e.g. "Android APK", "Windows EXE"
    token: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<{ branchSessionId: Id<"teamSessions">; branchCustomId: string; groupId: string; groupName: string }> => {
    const userId = (await ctx.runQuery(internal.customAuthHelpers.getUserIdByToken, { token: args.token || "" })) as Id<"users"> | null;
    if (!userId) throw new Error("Not authenticated");

    const mainSession = (await ctx.runQuery(internal.agentTeamHelpers.getSession, { sessionId: args.mainSessionId })) as SessionRow | null;
    if (!mainSession) throw new Error("Session not found");
    if (mainSession.userId !== userId) throw new Error("Not authorized");

    // Use Gemini to generate a group name and branch task
    let groupName = `${mainSession.title.slice(0, 30)} Group`;
    let branchTask = `${args.branchPurpose}: ${mainSession.task}`;
    let branchTitle = `${args.branchPurpose} — ${mainSession.title.slice(0, 40)}`;

    try {
      const techStack = mainSession.techStackJson ? (() => { try { return JSON.parse(mainSession.techStackJson); } catch { return null; } })() : null;
      const techStackStr = techStack ? `\nTech Stack: ${JSON.stringify(techStack).slice(0, 500)}` : "";
      const prompt = `You are helping organize a software project into branches.

Main Project: "${mainSession.title}"
Main Task: "${mainSession.task}"${techStackStr}
New Branch Purpose: "${args.branchPurpose}"

Generate:
1. A short group name (max 5 words) that describes the overall project family
2. A specific task description for the new branch (1-2 sentences)
3. A short title for the new branch (max 8 words)

Respond in JSON only:
{"groupName": "...", "branchTask": "...", "branchTitle": "..."}`;

      const result = await callGemini(prompt, "You are a concise project naming assistant. Respond only with valid JSON.");
      const parsed = JSON.parse(result.text) as { groupName?: string; branchTask?: string; branchTitle?: string };
      if (parsed.groupName) groupName = parsed.groupName;
      if (parsed.branchTask) branchTask = parsed.branchTask;
      if (parsed.branchTitle) branchTitle = parsed.branchTitle;
    } catch { /* use defaults */ }

    // Check if main session already has a branch group
    let groupId: Id<"sessionBranchGroups">;
    const existingGroupId = (mainSession as Record<string, unknown>).branchGroupId as string | undefined;

    if (existingGroupId) {
      // Already in a group — use existing group
      groupId = existingGroupId as Id<"sessionBranchGroups">;
      // Get current branch count
      const group = await ctx.runQuery(internal.agentTeamHelpers.getBranchGroupQuery, { groupId });
      const branchNumber = (group?.branchSessionIds?.length ?? 0) + 2; // +2 because main is 1

      // Create the new branch session
      const branchResult = (await ctx.runMutation(internal.agentTeamHelpers.createSessionMutation, {
        userId,
        task: branchTask,
        title: branchTitle,
      })) as { sessionId: Id<"teamSessions">; customId: string };

      // Copy files from main session to branch
      const mainFiles = (await ctx.runQuery(internal.agentTeamHelpers.getFiles, { sessionId: args.mainSessionId })) as FileRow[];
      for (const file of mainFiles) {
        await ctx.runMutation(internal.agentTeamHelpers.upsertFile, {
          sessionId: branchResult.sessionId,
          userId,
          filepath: file.filepath,
          content: file.content,
          agent: "Branch Copy",
        });
      }

      // Copy tech stack and summaries
      if (mainSession.techStackJson) {
        await ctx.runMutation(internal.agentTeamHelpers.updateTechStack, { sessionId: branchResult.sessionId, techStackJson: mainSession.techStackJson });
      }

      await ctx.runMutation(internal.agentTeamHelpers.addBranchToGroupMutation, {
        groupId,
        branchSessionId: branchResult.sessionId,
        branchName: args.branchPurpose,
        branchPurpose: args.branchPurpose,
        branchNumber,
        mainSessionId: args.mainSessionId,
      });

      return { branchSessionId: branchResult.sessionId, branchCustomId: branchResult.customId, groupId, groupName };
    } else {
      // Create new branch group
      const projectSummary = mainSession.taskSummariesJson ? (() => {
        try {
          const summaries = JSON.parse(mainSession.taskSummariesJson) as Array<{ summary: string }>;
          return summaries.map(s => s.summary).join("\n\n").slice(0, 1000);
        } catch { return undefined; }
      })() : undefined;

      groupId = (await ctx.runMutation(internal.agentTeamHelpers.createBranchGroupMutation, {
        userId,
        groupName,
        mainSessionId: args.mainSessionId,
        projectSummary,
      })) as Id<"sessionBranchGroups">;

      // Create the new branch session
      const branchResult = (await ctx.runMutation(internal.agentTeamHelpers.createSessionMutation, {
        userId,
        task: branchTask,
        title: branchTitle,
      })) as { sessionId: Id<"teamSessions">; customId: string };

      // Copy files from main session to branch
      const mainFiles = (await ctx.runQuery(internal.agentTeamHelpers.getFiles, { sessionId: args.mainSessionId })) as FileRow[];
      for (const file of mainFiles) {
        await ctx.runMutation(internal.agentTeamHelpers.upsertFile, {
          sessionId: branchResult.sessionId,
          userId,
          filepath: file.filepath,
          content: file.content,
          agent: "Branch Copy",
        });
      }

      // Copy tech stack
      if (mainSession.techStackJson) {
        await ctx.runMutation(internal.agentTeamHelpers.updateTechStack, { sessionId: branchResult.sessionId, techStackJson: mainSession.techStackJson });
      }

      await ctx.runMutation(internal.agentTeamHelpers.addBranchToGroupMutation, {
        groupId,
        branchSessionId: branchResult.sessionId,
        branchName: args.branchPurpose,
        branchPurpose: args.branchPurpose,
        branchNumber: 2,
        mainSessionId: args.mainSessionId,
      });

      return { branchSessionId: branchResult.sessionId, branchCustomId: branchResult.customId, groupId, groupName };
    }
  },
});

// Propagate main branch file updates to all child branches
export const propagateBranchUpdate = action({
  args: {
    mainSessionId: v.id("teamSessions"),
    token: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<{ updated: number }> => {
    const userId = (await ctx.runQuery(internal.customAuthHelpers.getUserIdByToken, { token: args.token || "" })) as Id<"users"> | null;
    if (!userId) throw new Error("Not authenticated");

    const mainSession = (await ctx.runQuery(internal.agentTeamHelpers.getSession, { sessionId: args.mainSessionId })) as SessionRow | null;
    if (!mainSession || mainSession.userId !== userId) throw new Error("Not authorized");

    const branchGroupId = (mainSession as Record<string, unknown>).branchGroupId as string | undefined;
    if (!branchGroupId) return { updated: 0 };

    const group = await ctx.runQuery(internal.agentTeamHelpers.getBranchGroupQuery, { groupId: branchGroupId as Id<"sessionBranchGroups"> });
    if (!group) return { updated: 0 };

    const mainFiles = (await ctx.runQuery(internal.agentTeamHelpers.getFiles, { sessionId: args.mainSessionId })) as FileRow[];
    let updated = 0;

    for (const branchId of group.branchSessionIds) {
      for (const file of mainFiles) {
        await ctx.runMutation(internal.agentTeamHelpers.upsertFile, {
          sessionId: branchId,
          userId,
          filepath: file.filepath,
          content: file.content,
          agent: "Branch Sync from Main",
        });
      }
      updated++;
    }

    return { updated };
  },
});

// ─── Other actions ────────────────────────────────────────────────────────────
export const listSessions = action({
  args: { token: v.optional(v.string()) },
  handler: async (ctx, args): Promise<Array<{ _id: Id<"teamSessions">; title: string; status: string; round: number; task: string; phase: string; totalMessages: number; loopCount: number }>> => {
    const userId = (await ctx.runQuery(internal.customAuthHelpers.getUserIdByToken, { token: args.token || "" })) as Id<"users"> | null;
    if (!userId) return [];
    const sessions = (await ctx.runQuery(internal.agentTeamHelpers.listSessionsQuery, { userId })) as SessionRow[];
    return sessions.map((s) => ({ _id: s._id, title: s.title, status: s.status, round: s.round ?? 0, task: s.task, phase: s.phase ?? "Researcher", totalMessages: s.totalMessages ?? 0, loopCount: s.loopCount ?? 0 }));
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
    return { _id: session._id, title: session.title, status: session.status, round: session.round ?? 0, task: session.task, currentAgent: session.currentAgent, phase: session.phase ?? "Researcher", totalMessages: session.totalMessages ?? 0, loopCount: session.loopCount ?? 0 };
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
    // If session is completed, reset fully so Planner runs fresh with new tasks
    // If session is still running/idle, append context to preserve in-progress task state
    if (session.status === "completed" || session.executionPhase === "completed") {
      await ctx.runMutation(internal.agentTeamHelpers.resetSessionForNewTask, { sessionId: args.sessionId, newTask: args.newTask });
    } else {
      await ctx.runMutation(internal.agentTeamHelpers.appendTaskContext, { sessionId: args.sessionId, additionalContext: args.newTask });
    }
  },
});

// Public action to reset session message limit (allows continuing past 600 msgs)
export const resetSessionLimit = action({
  args: { sessionId: v.id("teamSessions"), token: v.optional(v.string()) },
  handler: async (ctx, args): Promise<void> => {
    const userId = (await ctx.runQuery(internal.customAuthHelpers.getUserIdByToken, { token: args.token || "" })) as Id<"users"> | null;
    if (!userId) throw new Error("Not authenticated");
    const session = (await ctx.runQuery(internal.agentTeamHelpers.getSession, { sessionId: args.sessionId })) as SessionRow | null;
    if (!session) throw new Error("Session not found");
    if (session.userId !== userId) throw new Error("Not authorized");
    await ctx.runMutation(internal.agentTeamHelpers.resetSessionLimitMutation, { sessionId: args.sessionId });
  },
});

// ─── Chat Mode: single-turn claude-haiku-4.5 for platform help ───────────────
export const chatModeMessage = action({
  args: {
    sessionId: v.id("teamSessions"),
    content: v.string(),
    token: v.optional(v.string()),
    history: v.optional(v.array(v.object({ role: v.string(), content: v.string() }))),
  },
  handler: async (ctx, args): Promise<{ response: string; changeMode?: string }> => {
    const userId = (await ctx.runQuery(internal.customAuthHelpers.getUserIdByToken, { token: args.token || "" })) as Id<"users"> | null;
    if (!userId) throw new Error("Not authenticated");

    const systemPrompt = `You are Thalamus AI's Code Mode assistant. You help users understand the platform, answer questions about how to use Code Mode, explain what the agents do, help with deployment, and provide guidance on the multi-agent system.

You can answer questions like:
- How does Code Mode work?
- What do the different agents do?
- How do I deploy my project?
- What is a sandbox?
- How do I use the file tree?
- What is the difference between Code, Chat, and Minor Edit modes?

If the user's request is actually a coding task that needs the full multi-agent system, respond with <<CHANGE_MODE=Code>> at the end.
If the user wants a small targeted edit to existing code, respond with <<CHANGE_MODE=Minor>> at the end.

Be concise, helpful, and friendly. Use markdown formatting.`;

    const historyMsgs = (args.history ?? []).slice(-10).map(m => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    }));

    // Build conversation context from history
    const historyContext = historyMsgs.length > 0
      ? "\n\nConversation history:\n" + historyMsgs.map(m => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`).join("\n")
      : "";

    const prompt = `${historyContext}\n\nUser: ${args.content}`;

    let response: string;
    try {
      const result = await callClaude(prompt, systemPrompt, "claude-haiku-4-5");
      response = result.text;
    } catch {
      try {
        const result = await callGemini(prompt, systemPrompt, 2048);
        response = result.text;
      } catch {
        response = "I'm having trouble connecting right now. Please try again in a moment.";
      }
    }

    // Check for mode switch
    const changeModeMatch = response.match(/<<CHANGE_MODE=(Code|Chat|Minor)>>/i);
    const changeMode = changeModeMatch ? changeModeMatch[1] : undefined;
    const cleanResponse = response.replace(/<<CHANGE_MODE=(Code|Chat|Minor)>>/gi, "").trim();

    // Save to session messages
    await ctx.runMutation(internal.agentTeamHelpers.saveAgentMessage, {
      sessionId: args.sessionId,
      userId,
      agent: "Assistant",
      content: cleanResponse,
      round: 0,
      messageIndex: Date.now(),
    });

    return { response: cleanResponse, changeMode };
  },
});

// ─── Minor Edit Mode: single Coder agent for small targeted edits ─────────────
export const minorEditMessage = action({
  args: {
    sessionId: v.id("teamSessions"),
    content: v.string(),
    token: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<{ response: string; changeMode?: string }> => {
    const userId = (await ctx.runQuery(internal.customAuthHelpers.getUserIdByToken, { token: args.token || "" })) as Id<"users"> | null;
    if (!userId) throw new Error("Not authenticated");

    const projectFiles = (await ctx.runQuery(internal.agentTeamHelpers.getFiles, { sessionId: args.sessionId })) as FileRow[];
    const fileManifest = projectFiles.length > 0
      ? `\n\nEXISTING FILES (${projectFiles.length} total):\n${projectFiles.map(f => `  ${f.filepath}`).join("\n")}`
      : "";
    const filesContext = projectFiles.length > 0
      ? `\n\nPROJECT FILES:\n` + projectFiles.slice(0, 20).map(f => `--- ${f.filepath} ---\n${f.content.slice(0, 2000)}${f.content.length > 2000 ? "\n...(truncated)" : ""}`).join("\n\n")
      : "";

    const systemPrompt = `You are a Senior Engineer assistant. You can either answer questions OR make minor targeted code edits.

CRITICAL DECISION — read the user's message carefully:

1. If the user is ASKING A QUESTION (e.g. "how do I deploy this?", "what does this do?", "explain X", "what features does this have?", "how does X work?"):
   - Answer the question directly and helpfully using the project files as context
   - DO NOT edit any files
   - DO NOT output any <<EDITFILE>> blocks
   - Just write a clear, helpful answer in plain text/markdown

2. If the user is requesting a CODE CHANGE (e.g. "fix the bug in X", "add a button", "change the color to blue"):
   - Make ONLY the specific change requested
   - Edit ONLY the files that need to change
   - Use this format for file edits:
     <<EDITFILE="path/to/file.ts">>
     [COMPLETE updated file content]
     <<END.CREATEFILE>>

3. If the request needs the full multi-agent system (large feature, new app, complex architecture):
   - Say so briefly and output <<CHANGE_MODE=Code>>

NEVER edit README.md or any file just because someone asked a question. Questions get answers, not file edits.`;

    const prompt = `USER REQUEST: ${args.content}${fileManifest}${filesContext}

Respond appropriately — answer the question OR make the code change.`;

    let response = "";
    try {
      const result = await callClaude(prompt, systemPrompt, "claude-haiku-4-5");
      response = result.text;
    } catch {
      const { vly } = await import('../lib/vly-integrations');
      const r = await vly.ai.completion({
        model: "claude-haiku-4-5",
        messages: [{ role: "user", content: systemPrompt + "\n\n" + prompt }],
        maxTokens: 4096,
      });
      response = (r.success && r.data) ? (r.data.choices[0]?.message?.content ?? "Failed") : "Failed";
    }

    const parsed = parseAgentOutput(response);

    // Only apply file operations if there are actual file edits (not just a question answer)
    if (parsed.fileOps.length > 0) {
      for (const fileOp of parsed.fileOps) {
        if (fileOp.type === "create" || fileOp.type === "edit") {
          await ctx.runMutation(internal.agentTeamHelpers.upsertFile, {
            sessionId: args.sessionId, userId, filepath: fileOp.filepath, content: fileOp.content || "", agent: "MinorEdit",
          });
        } else if (fileOp.type === "delete") {
          await ctx.runMutation(internal.agentTeamHelpers.deleteFile, { sessionId: args.sessionId, filepath: fileOp.filepath });
        }
      }
    }

    // Save to session messages
    await ctx.runMutation(internal.agentTeamHelpers.saveAgentMessage, {
      sessionId: args.sessionId,
      userId,
      agent: "MinorEdit",
      content: parsed.cleanContent,
      round: 0,
      messageIndex: Date.now(),
    });

    return { response: parsed.cleanContent, changeMode: parsed.changeMode };
  },
});

// ─── Hidden Checker Agent: validates if task needs full Code mode ─────────────
export const checkerAgent = internalAction({
  args: {
    sessionId: v.id("teamSessions"),
    task: v.string(),
  },
  handler: async (_ctx, args): Promise<{ needsCodeMode: boolean; reason: string }> => {
    // Runs on gemini-3.1-flash-lite — fast, cheap, hidden from UI
    const systemPrompt = `You are a task classifier. Determine if a user's request needs the full multi-agent code generation system (Code mode) or if it's a simple question/chat.

Respond with JSON only:
{"needsCodeMode": true/false, "reason": "brief reason"}

Code mode is needed for: building apps, writing code, creating files, implementing features, debugging complex issues.
Chat mode is fine for: questions about the platform, how-to questions, explanations, simple advice.`;

    try {
      const result = await callGemini(
        `${systemPrompt}\n\nUser task: "${args.task}"`,
        "You are a task classifier.",
        512,
      );
      const json = JSON.parse(result.text.match(/\{[\s\S]*\}/)?.[0] ?? "{}") as { needsCodeMode?: boolean; reason?: string };
      return { needsCodeMode: json.needsCodeMode ?? true, reason: json.reason ?? "Unknown" };
    } catch {
      return { needsCodeMode: true, reason: "Could not classify — defaulting to Code mode" };
    }
  },
});