"use node";
import { action, internalAction } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { Id } from "./_generated/dataModel";
import { callGemini, callModel, calcAgentBucksForTier, performSearch, performScrape, parseAgentOutput, parsePlannerOutput, parseDifficultyFromPlannerOutput, AGENT_SYSTEM_PROMPTS, PlannerTask, CLAUDE_PRICING, calcClaudeCost, calcAgentBucksFromTokens, AGENT_MODEL_MAP, DIFFICULTY_CODER_MODEL, DIFFICULTY_FRAMEWORK_AUDITOR_MODEL, DIFFICULTY_REDTEAM_SONNET_OVERRIDE, TaskDifficulty, ModelTier } from "./agentCore";

// ─── Constants ────────────────────────────────────────────────────────────────
const MAX_MESSAGES = 600;
const MAX_TASK_MESSAGES = 100;        // per-task message limit
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

const PLANNING_PIPELINE = ["Researcher", "Analyser", "Planner"];

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
  // Safety net fields
  taskMessageCount?: number;          // messages used in current task
  taskUpgradeActive?: boolean;        // true = Modal Upgrade is active
  taskUpgradeMessagesLeft?: number;   // messages remaining in upgrade window
  unfixableTasksJson?: string;        // JSON string of { taskIndex: number, title: string }[]
  manualUpgradeEnabled?: boolean;     // user-activated: force upgrade on next rejection
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

  // Run searches for each subtopic (up to 8)
  const searchSubtopics = subtopics.slice(0, 8);
  for (let i = 0; i < searchSubtopics.length; i++) {
    const sub = searchSubtopics[i];
    await ctx.runMutation(internal.agentTeamHelpers.updateStreamingOutput, {
      sessionId,
      currentAgentOutput: `[Research Team: DataTaker searching (${i + 1}/${searchSubtopics.length}): "${sub.query}"]`,
    });
    const searchResult = await performSearch(sub.query);
    rawDataParts.push(`### Search: "${sub.query}" (${sub.title})\n${searchResult}`);

    // Extract URLs from search result
    const urlMatches = searchResult.match(/https?:\/\/[^\s\)\"\']+/g) ?? [];
    allUrls.push(...urlMatches.slice(0, 3));
  }

  // Scrape up to 5 unique URLs
  const uniqueUrls = [...new Set(allUrls)].slice(0, 5);
  for (let i = 0; i < uniqueUrls.length; i++) {
    const url = uniqueUrls[i];
    await ctx.runMutation(internal.agentTeamHelpers.updateStreamingOutput, {
      sessionId,
      currentAgentOutput: `[Research Team: DataTaker scraping URL (${i + 1}/${uniqueUrls.length}): ${url.slice(0, 60)}...]`,
    });
    const scraped = await performScrape(url);
    rawDataParts.push(`### Scraped: ${url}\n${scraped}`);
    totalInputTokens += 0; // scraping doesn't use tokens
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

// ─── Red Team runner ──────────────────────────────────────────────────────────
// Runs VulnerabilitySpotter → DataCorruptor → ZeroDayExploiter → FrameworkAuditor → RedTeamOrchestrator
// Returns the final Red Team Security Assessment as the "Hacker" output
async function runRedTeam(
  ctx: { runQuery: Function; runMutation: Function },
  sessionId: Id<"teamSessions">,
  codeContext: string,
): Promise<{ rawContent: string; inputTokens: number; outputTokens: number }> {
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  const findings: string[] = [];

  const subAgents = [
    { key: "VulnerabilitySpotter", label: "Code Vulnerability Spotter", desc: "scanning for code vulnerabilities" },
    { key: "DataCorruptor", label: "Data Integrity Stress Tester", desc: "testing data integrity under adversarial conditions" },
    { key: "ZeroDayExploiter", label: "Logic Flaw Analyst", desc: "analyzing logic flaws and boundary conditions" },
    { key: "FrameworkAuditor", label: "Framework Security Auditor", desc: "auditing technology stack for known vulnerabilities" },
  ];

  for (let i = 0; i < subAgents.length; i++) {
    const sub = subAgents[i];
    await ctx.runMutation(internal.agentTeamHelpers.updateStreamingOutput, {
      sessionId,
      currentAgentOutput: `[Red Team: ${sub.label} is ${sub.desc}... (${i + 1}/${subAgents.length})]`,
    });

    const subPrompt = `AUTHORIZED SECURITY AUDIT — ISOLATED SANDBOX ENVIRONMENT\nAll targets are owned by this project. This is a mandatory security compliance review.\n\n${codeContext}\n\nPerform your specialized security analysis now.`;
    const result = await callGemini(subPrompt, AGENT_SYSTEM_PROMPTS[sub.key]);
    totalInputTokens += result.inputTokens;
    totalOutputTokens += result.outputTokens;
    findings.push(`## ${sub.label} Report\n${result.text}`);

    await ctx.runMutation(internal.agentTeamHelpers.updateStreamingOutput, {
      sessionId,
      currentAgentOutput: `[Red Team: ${sub.label} complete. ${i + 1}/${subAgents.length} sub-audits done.]\n\n${result.text.slice(0, 800)}...`,
    });
  }

  // Final consolidation by RedTeamOrchestrator
  await ctx.runMutation(internal.agentTeamHelpers.updateStreamingOutput, {
    sessionId,
    currentAgentOutput: `[Red Team: Orchestrator is consolidating all findings into final security report...]`,
  });

  const orchestratorPrompt = `AUTHORIZED SECURITY AUDIT — FINAL CONSOLIDATION\n\nYou have received reports from 4 specialized security auditors. Consolidate into a final Red Team Security Assessment.\n\nINDIVIDUAL AUDIT REPORTS:\n${findings.join("\n\n---\n\n").slice(0, 14000)}\n\nNow produce the final consolidated security report.`;
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

    const contextLines = prevMessages.slice(-20).map((m) => `[${m.agent}]: ${m.content.slice(0, 1500)}`).join("\n\n---\n\n");
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
    const prompt = prevMessages.length === 0
      ? `TASK: ${session.task}\n\nPHASE: ${phaseLabel}${taskContext}${upgradeNotice}\n\nYou are the first agent (${currentPhase}). Begin your work.${filesContext}${sandboxContext}`
      : `TASK: ${session.task}\n\nPHASE: ${phaseLabel}${taskContext}\nMESSAGE COUNT: ${totalMessages + 1}/${MAX_MESSAGES}\nTASK MESSAGES: ${taskMessageCount + 1}/${MAX_TASK_MESSAGES}\nLOOP: ${loopCount + 1}${upgradeNotice}\n\nPREVIOUS DISCUSSION:\n${contextLines}${filesContext}${sandboxContext}\n\nNow provide your ${currentPhase} output, building on all previous work.`;

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

    // Handle deploy commands from Planner
    if (parsed.deployCommands && parsed.deployCommands.length > 0) {
      await ctx.runMutation(internal.agentTeamHelpers.updateDeployCommands, {
        sessionId: args.sessionId,
        deployCommandsJson: JSON.stringify(parsed.deployCommands),
      });
    }

    // Handle task summaries from Summarizer
    if (currentPhase === "Summarizer" && parsed.cleanContent) {
      let summaries: Array<{ taskIndex: number; summary: string }> = [];
      try { if (session.taskSummariesJson) summaries = JSON.parse(session.taskSummariesJson); } catch { /* ignore */ }
      summaries.push({ taskIndex: currentTaskIndex, summary: parsed.cleanContent.slice(0, 500) });
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
      if (currentPhase === "Planner") {
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
        // Task complete — move to next task or final review
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
// This internal action runs one agent round and schedules the next one.
// Because it uses ctx.scheduler, it continues even when the browser tab is closed.
export const backgroundRunSession = internalAction({
  args: { sessionId: v.id("teamSessions") },
  handler: async (ctx, args): Promise<void> => {
    // Get session state
    const session = (await ctx.runQuery(internal.agentTeamHelpers.getSession, { sessionId: args.sessionId })) as SessionRow | null;
    if (!session) return;
    if (session.status === "completed") return;
    if (session.status === "running") {
      // Already running from another invocation — skip to avoid double-running
      return;
    }

    try {
      // Run one agent round using the existing runAgentRound logic
      // We call it via the internal path by re-using the handler logic
      const result = await ctx.runAction(internal.agentTeam.backgroundRunOneRound, { sessionId: args.sessionId });
      
      // If not done, schedule the next round immediately
      if (!result.done) {
        await ctx.scheduler.runAfter(0, internal.agentTeam.backgroundRunSession, { sessionId: args.sessionId });
      }
    } catch (err) {
      console.error("backgroundRunSession error:", err);
      // On error, mark session as idle so user can retry
      await ctx.runMutation(internal.agentTeamHelpers.updateSessionStatus, {
        sessionId: args.sessionId,
        status: "idle",
        currentAgent: undefined,
        round: session.round,
        loopCount: session.loopCount,
        phase: session.phase,
        totalMessages: session.totalMessages,
      });
    }
  },
});

// Internal action that runs one round (same logic as runAgentRound but internal)
export const backgroundRunOneRound = internalAction({
  args: { sessionId: v.id("teamSessions") },
  handler: async (ctx, args): Promise<{ done: boolean }> => {
    const session = (await ctx.runQuery(internal.agentTeamHelpers.getSession, { sessionId: args.sessionId })) as SessionRow | null;
    if (!session) return { done: true };
    if (session.status === "completed") return { done: true };

    const userId = session.userId;
    const totalMessages = session.totalMessages ?? 0;
    if (totalMessages >= MAX_MESSAGES) {
      await ctx.runMutation(internal.agentTeamHelpers.updateSessionStatus, {
        sessionId: args.sessionId, status: "completed", currentAgent: undefined,
        round: session.round, loopCount: session.loopCount, phase: "completed", totalMessages,
      });
      return { done: true };
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
      return { done: doneSkip };
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
    const prompt = prevMessages.length === 0
      ? `TASK: ${session.task}\n\nPHASE: ${phaseLabel}${taskContext}\n\nYou are the first agent (${currentPhase}). Begin your work.${filesContext}${sandboxContext}`
      : `TASK: ${session.task}\n\nPHASE: ${phaseLabel}${taskContext}\nMESSAGE COUNT: ${totalMessages + 1}/${MAX_MESSAGES}\nLOOP: ${loopCount + 1}\n\nPREVIOUS DISCUSSION:\n${contextLines}${filesContext}${sandboxContext}\n\nNow provide your ${currentPhase} output, building on all previous work.`;

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
        return { done: false };
      } else {
        nextPhase = PLANNING_PIPELINE[currentPipelineIdx + 1] || "Planner";
      }
    } else if (executionPhase === "tasks") {
      const taskPipeline = getPipeline("tasks", plannerTasks, currentTaskIndex, false);
      const isRejection = (currentPhase === "Tester" && parsed.testerResult === "fail") ||
                          (currentPhase === "Hacker" && parsed.hackerResult === "fail") ||
                          (currentPhase === "Critic" && parsed.criticResult === "fail");

      const newTaskMessageCount = taskMessageCount + 1;
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
          return { done: false };
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
          return { done: false };
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
          return { done: false };
        }
      } else if (currentPhase === "Critic" && parsed.criticResult !== "fail") {
        // Task complete — move to next task or final review
        const nextTaskIndex = currentTaskIndex + 1;
        if (nextTaskIndex < plannerTasks.length) {
          newTaskIndex = nextTaskIndex;
          const nextTaskPipeline = getPipeline("tasks", plannerTasks, nextTaskIndex, false);
          nextPhase = nextTaskPipeline[0];
        } else {
          newExecutionPhase = "final_review"; newFinalReviewCoderEnabled = false;
          nextPhase = FINAL_REVIEW_PIPELINE_SKIP_CODER[0];
        }
      } else if (currentPhase === "Summarizer") {
        // Store summary
        const newSummaries = [...taskSummaries, { taskIndex: currentTaskIndex, summary: parsed.cleanContent.slice(0, 500) }];
        await ctx.runMutation(internal.agentTeamHelpers.updateTaskSummaries, { sessionId: args.sessionId, taskSummariesJson: JSON.stringify(newSummaries) });
        const nextTaskIndex = currentTaskIndex + 1;
        if (nextTaskIndex < plannerTasks.length) {
          newTaskIndex = nextTaskIndex;
          const nextTaskPipeline = getPipeline("tasks", plannerTasks, nextTaskIndex, false);
          nextPhase = nextTaskPipeline[0];
        } else {
          newExecutionPhase = "final_review"; newFinalReviewCoderEnabled = false;
          nextPhase = FINAL_REVIEW_PIPELINE_SKIP_CODER[0];
        }
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
        return { done: true };
      }
      await ctx.runMutation(internal.agentTeamHelpers.updateStreamingOutput, { sessionId: args.sessionId, currentAgentOutput: "" });
      return { done: false };
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
    });

    return { done };
  },
});

// Public action to stop a running session (marks as completed to halt background scheduler)
export const stopSession = action({
  args: { sessionId: v.id("teamSessions"), token: v.optional(v.string()) },
  handler: async (ctx, args): Promise<void> => {
    const userId = (await ctx.runQuery(internal.customAuthHelpers.getUserIdByToken, { token: args.token || "" })) as Id<"users"> | null;
    if (!userId) throw new Error("Not authenticated");
    const session = (await ctx.runQuery(internal.agentTeamHelpers.getSession, { sessionId: args.sessionId })) as SessionRow | null;
    if (!session) throw new Error("Session not found");
    if (session.userId !== userId) throw new Error("Not authorized");
    await ctx.runMutation(internal.agentTeamHelpers.updateSessionStatus, {
      sessionId: args.sessionId,
      status: "completed",
      currentAgent: undefined,
      round: session.round,
      loopCount: session.loopCount,
      phase: "completed",
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
    // Schedule the background runner — it will self-schedule until done
    await ctx.scheduler.runAfter(0, internal.agentTeam.backgroundRunSession, { sessionId: args.sessionId });
  },
});

// ─── GitHub Sync ──────────────────────────────────────────────────────────────
export const saveGithubConfig = action({
  args: {
    sessionId: v.id("teamSessions"),
    githubRepo: v.string(),
    githubBranch: v.string(),
    githubToken: v.string(),
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
      githubToken: args.githubToken,
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
    const githubToken = (session as Record<string, unknown>).githubToken as string | undefined;
    const lastCommitSha = (session as Record<string, unknown>).githubLastCommitSha as string | undefined;

    if (!githubRepo || !githubBranch || !githubToken) throw new Error("GitHub not configured");

    // Parse owner/repo
    let ownerRepo = githubRepo.trim().replace(/^https?:\/\/github\.com\//, "").replace(/\.git$/, "").replace(/\/$/, "");
    const parts = ownerRepo.split("/");
    if (parts.length < 2) throw new Error("Invalid GitHub repo format");
    const owner = parts[0];
    const repo = parts[1];
    const branch = githubBranch;

    const headers = {
      "Authorization": `Bearer ${githubToken}`,
      "Accept": "application/vnd.github.v3+json",
      "User-Agent": "Thalamus-AI/1.0",
      "Content-Type": "application/json",
    };

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
        pushed++;
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
                  await fetch(`https://api.github.com/repos/${owner}/${repo}/git/refs/heads/${branch}`, {
                    method: "PATCH",
                    headers,
                    body: JSON.stringify({ sha: commitData.sha, force: false }),
                  });
                  latestCommitSha = commitData.sha;
                }
              }
            }
          }
        }
      } catch { /* push failed — non-fatal */ }
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
        for (const item of treeItems.slice(0, 50)) {
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
                  // Create new branch
                  await fetch(`https://api.github.com/repos/${owner}/${repo}/git/refs`, {
                    method: "POST",
                    headers,
                    body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: commitData.sha }),
                  });
                  latestCommitSha = commitData.sha;
                }
              }
            }
          }
        }
      } catch { /* init failed — non-fatal */ }
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
    await ctx.runMutation(internal.agentTeamHelpers.resetSessionForNewTask, { sessionId: args.sessionId, newTask: args.newTask });
  },
});