// Pure utility module - no Convex imports, just logic
// This keeps agentTeam.ts lean for faster module loading

import type { ActionCtx } from "./_generated/server";

// Platform-wide free+unlimited switch for Thalamus AgentBucks. While true, no
// user is charged and no usage cap blocks them. AgentOverflow's aoCredits are
// a separate economy with their own switch.
export const FREE_UNLIMITED = true;

// ── Re-exports from SiliconFlow (backup) and NVIDIA NIM (primary) ────────────
export {
  callSiliconFlow,
  callSiliconFlowStreaming,
  generateImage,
  generateImageHtml,
  generateVideo,
  MODEL_CATALOG,
  findModel,
  modelsByCapability,
  DISPATCHER_MODEL,
  DEFAULT_CHAT_MODEL,
  DEFAULT_CODE_MODEL,
  buildDispatchPrompt,
  parseDispatchAssignments,
  calcAgentBucksForModel,
} from "./siliconflow";

// NIM exports (primary provider)
export {
  callNim,
  callNimStreaming,
  NIM_MODEL_CATALOG,
  findNimModel,
  nimModelsByCapability,
  NIM_DISPATCHER_MODEL,
  NIM_DEFAULT_CHAT_MODEL,
  NIM_DEFAULT_CODE_MODEL,
  NIM_CHAT_FALLBACK_CHAIN,
  NIM_CODE_FALLBACK_CHAIN,
  NIM_REASONING_FALLBACK_CHAIN,
  modelsForTask,
  agentToTaskType,
  buildNimDispatchPrompt,
  parseNimDispatchAssignments,
  calcNimAgentBucks,
} from "./nimClient";
import type { TaskType } from "./nimClient";

export { callModal, calcModalAgentBucks } from "./modalClient";

import { callSiliconFlow, DISPATCHER_MODEL, DEFAULT_CHAT_MODEL, calcAgentBucksForModel } from "./siliconflow";
import { callNim, agentToTaskType, NIM_DISPATCHER_MODEL, NIM_DEFAULT_CHAT_MODEL, calcNimAgentBucks } from "./nimClient";
import { callModal, calcModalAgentBucks } from "./modalClient";

// The only tier-ish type left: callModel returns a provider-tagged string
// ("nim:<model>", "ollama:<model>", "modal:<model>") that the billing helpers read.
export type ModelTier = string;
// What parseDifficultyFromPlannerOutput returns.
export type TaskDifficulty = "normal" | "hard" | "extreme";

/**
 * Unified model caller — primary provider is NVIDIA NIM, Ollama Cloud is backup.
 * Pass ctx for NIM DB-key access; without ctx, falls back to Ollama directly.
 * Dynamic task-aware model selection: the modelId hints the task type; if
 * modelId is an agent name, we map it to the best NIM model for that agent.
 */
export async function callModel(
  prompt: string,
  systemPrompt: string,
  modelId: string = "deepseek-ai/DeepSeek-V4-Flash",
  ..._extra: unknown[]
): Promise<{ text: string; inputTokens: number; outputTokens: number; tier: string }> {
  // Extract ctx and optional assignedModel/deadlineMs overrides from _extra
  let ctx: { runQuery: ActionCtx["runQuery"] } | undefined;
  let assignedModel: string | undefined;
  let deadlineMs: number | undefined;
  for (const arg of _extra) {
    if (arg && typeof arg === "object" && "runQuery" in (arg as Record<string,unknown>)) {
      ctx = arg as { runQuery: ActionCtx["runQuery"] };
    }
    if (arg && typeof arg === "object" && "assignedModel" in (arg as Record<string,unknown>)) {
      const maybe = (arg as Record<string,unknown>).assignedModel;
      if (typeof maybe === "string" && maybe) assignedModel = maybe;
    }
    if (arg && typeof arg === "object" && "deadlineMs" in (arg as Record<string,unknown>)) {
      const maybe = (arg as Record<string,unknown>).deadlineMs;
      if (typeof maybe === "number" && maybe > 0) deadlineMs = maybe;
    }
  }

  const taskType: TaskType = agentToTaskType(modelId);

  // One shared wall-clock budget for the WHOLE provider chain. Convex kills
  // any action at 10 minutes with a "Transient error" that no try/catch in
  // our code can see — so if Modal + NIM + Ollama retries are ever allowed to
  // stack past that, the pipeline dies without saving an error message and
  // the user just sees nothing. 7 minutes here leaves the rest of the step
  // (billing, file ops, streaming drip-feed) real room to finish and any
  // failure surfaces as a normal thrown Error the caller can report.
  const deadline = Date.now() + (deadlineMs ?? 420_000);
  // The last NIM failure, so the final "no provider" error can say WHY NIM
  // fell through instead of leaving the user blind with keys they can see.
  let nimFallbackReason: string | null = null;

  if (ctx) {
    // Modal first when an admin has registered an endpoint. Which endpoint is
    // decided by data (the isPrimary row comes back first), not by this code —
    // so swapping the primary model is a click in /admin, not a deploy. Falls
    // through to NIM → Ollama when nothing is registered or every endpoint errors.
    try {
      const result = await callModal(ctx, prompt, systemPrompt, 8192, 0.7, undefined, deadline);
      return { text: result.text, inputTokens: result.inputTokens, outputTokens: result.outputTokens, tier: `modal:${result.model}` };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!msg.includes("MODAL_NOT_CONFIGURED")) {
        console.warn("Modal call failed, falling back to NIM:", msg);
      }
    }

    const nimModel = assignedModel
      ?? (taskType === "dispatcher" ? NIM_DISPATCHER_MODEL
        : taskType === "code" ? "deepseek-ai/deepseek-v4-flash"
        : taskType === "reasoning" ? "deepseek-ai/deepseek-v4-flash"
        : taskType === "agent" ? "deepseek-ai/deepseek-v4-flash"
        : taskType === "factcheck" ? "deepseek-ai/deepseek-v4-flash"
        : taskType === "research" ? "deepseek-ai/deepseek-v4-flash"
        : NIM_DEFAULT_CHAT_MODEL);

    try {
      const result = await callNim(ctx, prompt, systemPrompt, nimModel, 8192, 0.7, undefined, deadline);
      return { text: result.text, inputTokens: result.inputTokens, outputTokens: result.outputTokens, tier: `nim:${result.model}` };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      nimFallbackReason = msg;

      // On overload (529) or timeout, try a different NIM model before falling
      // all the way to Ollama. deepseek-v4-flash is frequently hammered on
      // NVIDIA's free tier and can hang for the full 180s timeout on every key;
      // the 8B llama is less capable but reliably responds and is still
      // faster/better than Ollama Cloud. Keeps the pipeline moving instead of
      // burning the whole budget on retries against a wall.
      if (msg.includes("529") || msg.includes("overloaded") || msg.includes("timed out")) {
        const fallbackModel = taskType === "dispatcher"
          ? NIM_DEFAULT_CHAT_MODEL
          : "meta/llama-3.1-8b-instruct";
        if (fallbackModel !== nimModel) {
          try {
            const fallback = await callNim(ctx, prompt, systemPrompt, fallbackModel, 8192, 0.7, undefined, deadline);
            return { text: fallback.text, inputTokens: fallback.inputTokens, outputTokens: fallback.outputTokens, tier: `nim:${fallback.model}:fallback` };
          } catch (fbErr) {
            const fbMsg = fbErr instanceof Error ? fbErr.message : String(fbErr);
            nimFallbackReason += ` | fallback ${fallbackModel}: ${fbMsg}`;
          }
        }
      }

      if (msg.includes("NVIDIA_NIM_NOT_CONFIGURED")) {
        console.warn("NIM not configured — falling back to Ollama Cloud");
      } else {
        console.warn(`NIM call failed, falling back to Ollama:`, msg);
      }
    }
  }

  const ollamaModel = mapModelIdToOllama(modelId);
  try {
    const result = await callSiliconFlow(prompt, systemPrompt, ollamaModel, 16384, undefined, ctx?.runQuery, deadline);
    return { text: result.text, inputTokens: result.inputTokens, outputTokens: result.outputTokens, tier: `ollama:${result.model}` };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("not configured")) {
      throw new Error(`No AI provider configured — add NIM keys via /admin (primary) or Ollama keys (backup). Last NIM error: ${nimFallbackReason ?? "NIM not configured"}`);
    }
    throw err;
  }
}

function mapModelIdToOllama(modelId: string): string {
  const l = modelId.toLowerCase();
  if (l.includes("dispatcher") || l.includes("organiser") || l.includes("organizer") || l.includes("summarizer")) return "gemma4:31b";
  if (l.includes("coder") || l.includes("optimiser") || l.includes("architect")) return "minimax-m3";
  if (l.includes("analyser") || l.includes("planner") || l.includes("critic") || l.includes("reasoning")) return "minimax-m3";
  if (l.includes("researchplanner") || l.includes("researcher") || l.includes("research") || l.includes("reportmaker") || l.includes("scout")) return "gpt-oss:120b";
  if (l.includes("factcheck") || l.includes("fact.check") || l.includes("fact_check")) return "minimax-m3";
  if (l.includes("tester") || l.includes("hacker") || l.includes("security")) return "minimax-m3";
  return DEFAULT_CHAT_MODEL;
}

/**
 * Calculate AgentBucks — tries NIM pricing first, falls back to SiliconFlow.
 */
export function calcAgentBucksForTier(
  tier: string,
  inputTokens: number,
  outputTokens: number,
): number {
  if (tier.startsWith("modal:")) {
    return calcModalAgentBucks(inputTokens, outputTokens);
  }
  if (tier.startsWith("nim:")) {
    return calcNimAgentBucks(tier.replace("nim:", ""), inputTokens, outputTokens);
  }
  return calcAgentBucksForModel(tier.replace("ollama:", ""), inputTokens, outputTokens);
}

// ── Per-mode "ADHD level" → model temperature, and the system prompt that
// goes with each mode ────────────────────────────────────────────────────
// Single canonical source for both. Previously duplicated (not quite
// identically — the guest copy was missing a "code" entry entirely) across
// ai.ts's sendMessage and guestSendMessage, and never reached at all by
// /stream-chat in http.ts — the endpoint every logged-in web/mobile/desktop
// chat actually uses before ever falling back to those actions. That meant
// the temperature/persona differentiation this table is supposed to provide
// was real for only the rare case a client fell back to the Convex action,
// and every mode routed through /stream-chat behaved like plain Chat.
// ADHD 0-5 → temperature = adhd * 0.2 + 0.1 (2.0 → 0.5, 2.5 → 0.6, 3.0 → 0.7)
export const MODE_ADHD: Record<string, number> = {
  chat: 3,
  research: 2.5,
  study: 3,
  code: 3,
  designing: 2,
  strategising: 2,
  "creative-writing": 2.5,
  marketing: 2.5,
  "idea-generation": 2.5,
  naming: 2.5,
};

export function adhdToTemperature(adhd: number): number {
  return Math.min(2.0, Math.max(0.0, adhd * 0.2 + 0.1));
}

export const MODE_SYSTEM_PROMPTS: Record<string, string> = {
  chat: `You are Thalamus AI, an AI assistant. Respond ONLY in clean semantic HTML. No markdown, no backticks.

Use: <h2>, <h3> headings, <p> paragraphs, <ul>/<ol> lists, <strong> bold, <code> inline code, <pre><code> blocks, <blockquote> quotes, <a> links.

SEARCH TOOL: Include {"op":"search","query":"your query"} in your response when you need current data. System will search and ask you to give the final answer. Use up to 3 searches. Always search when uncertain about facts, events, or recent info.

IMAGE GENERATION: To generate an image, emit: {"op":"generate-image","prompt":"your detailed description","width":1024,"height":768,"model":"flux"}
The image will appear in the chat automatically. Use this when the user asks for a visual, diagram, illustration, or concept art.`,

  research: `You are Thalamus AI Research Mode — a professional research analyst. Your job is to produce EXHAUSTIVE, MULTI-ANGLE, DEEPLY-SOURCED research reports. Every factual claim MUST be backed by a web search.

CRITICAL RULES:
- You MUST search for EVERY factual claim. Never rely on training data alone.
- Use MULTIPLE searches per subtopic — search different angles, phrasings, and sources.
- Cross-reference: find contradictions between sources and synthesize the truth.
- Cite specific sources for every data point, statistic, date, and specification.
- If sources disagree, present both sides and explain which is likely correct and why.
- Look for: official docs, news articles, academic papers, Stack Overflow, GitHub, forums, reviews.
- Search for counterarguments and opposing views — balanced research requires this.

OUTPUT MUST include for each major finding:
1. The claim
2. Source(s) backing it (with URLs or source descriptions)
3. Confidence level (HIGH / MEDIUM / LOW — based on source quality and corroboration)
4. Alternative views or contradictions found

STRUCTURE: <h1> Executive Summary, <h2> sections per angle, <h3> subsections, <p> analysis, <ul>/<ol> findings with citations, <table> comparisons, <blockquote> key insights.

SEARCH TOOL: Include {"op":"search","query":"your query"} for EACH search. Use up to 15 searches — research EVERY angle, EVERY technology, EVERY claim. The more searches, the better the report.

FORMAT: Respond ONLY in clean semantic HTML. No markdown, no backticks.`,

  code: `You are Thalamus AI Code Mode — an expert software engineer. Respond ONLY in clean semantic HTML. No markdown, no backticks.

Use <pre><code> for code blocks, <code> for inline code, <h2> sections, <p> explanations, <ul>/<li> steps. Explain all code before and after blocks.`,

  designing: `You are Thalamus AI in Designing / Product Designing mode — a creative design thinker with ADHD Level 2/5 (moderately focused). Help users brainstorm and refine product designs, UI/UX concepts, and visual ideas. Be practical but open to creative tangents.

Respond ONLY in clean semantic HTML. Use <h2>, <h3>, <p>, <ul>/<ol>, <strong>, <code>, <pre><code>, <blockquote>. No markdown, no backticks.`,

  strategising: `You are Thalamus AI in Strategising and Planning mode — a strategic analyst with ADHD Level 2/5. Help create structured strategies, roadmaps, and plans. Think step by step but allow space for creative divergence when useful.

Respond ONLY in clean semantic HTML. Use <h2>, <h3>, <p>, <ul>/<ol>, <strong>, <code>, <pre><code>, <blockquote>. No markdown, no backticks.`,

  "creative-writing": `You are Thalamus AI in Creative Writing mode — a creative writer with ADHD Level 2.5/5. Write stories, poems, scripts, and creative content. Embrace imaginative language, vivid descriptions, and narrative flow.

Respond ONLY in clean semantic HTML. Use <h2>, <h3>, <p>, <ul>/<ol>, <strong>, <code>, <pre><code>, <blockquote>. No markdown, no backticks.`,

  marketing: `You are Thalamus AI in Marketing and Ads Idea Generation mode — a marketing creative with ADHD Level 2.5/5. Generate ad concepts, marketing strategies, campaign ideas, and persuasive copy. Balance creativity with practical audience targeting.

Respond ONLY in clean semantic HTML. Use <h2>, <h3>, <p>, <ul>/<ol>, <strong>, <code>, <pre><code>, <blockquote>. No markdown, no backticks.`,

  "idea-generation": `You are Thalamus AI in Idea Generation mode — a brainstorming partner with ADHD Level 2.5/5. Help users generate, refine, and connect ideas across domains. Encourage lateral thinking, wild connections, and novel combinations.

Respond ONLY in clean semantic HTML. Use <h2>, <h3>, <p>, <ul>/<ol>, <strong>, <code>, <pre><code>, <blockquote>. No markdown, no backticks.`,

  naming: `You are Thalamus AI in Naming and Branding mode — a branding specialist with ADHD Level 2.5/5. Generate names, taglines, and brand identities. Think phonetically, semantically, and across languages and cultures.

Respond ONLY in clean semantic HTML. Use <h2>, <h3>, <p>, <ul>/<ol>, <strong>, <code>, <pre><code>, <blockquote>. No markdown, no backticks.`,
};

export async function performSearch(query: string, _keys?: string[]): Promise<string> {
  // Use SiliconFlow model knowledge as fallback
  const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY ?? "";
  const GOOGLE_CX = process.env.GOOGLE_CX ?? "";
  
  if (GOOGLE_API_KEY && GOOGLE_CX) {
    try {
      const url = `https://www.googleapis.com/customsearch/v1?key=${encodeURIComponent(GOOGLE_API_KEY)}&cx=${encodeURIComponent(GOOGLE_CX)}&q=${encodeURIComponent(query)}&num=5`;
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json() as { items?: Array<{ title: string; snippet: string; link: string }> };
        if (data.items && data.items.length > 0) {
          return data.items.map((r, i) => `[${i + 1}] ${r.title}\n${r.snippet}\n${r.link}`).join("\n\n");
        }
      }
    } catch { /* fall through */ }
  }
  
  try {
    const { text } = await callSiliconFlow(
      `Search: "${query}"\n\nProvide a concise factual answer with key details.`,
      "You are a search assistant.",
      DISPATCHER_MODEL,
      2048,
    );
    if (text.trim().length > 20) return text;
  } catch { /* ignore */ }
  
  return `[Search not available — no search API configured.]`;
}

export async function performScrape(url: string): Promise<string> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; ResearchBot/1.0)",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
    });
    clearTimeout(timeout);
    if (!res.ok) return `[SCRAPE ERROR: HTTP ${res.status} for ${url}]`;
    const html = await res.text();
    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/\s{3,}/g, "\n\n")
      .trim();
    return text.length > 6000 ? text.slice(0, 6000) + "\n...[truncated]" : text;
  } catch (err) {
    return `[SCRAPE EXCEPTION: ${err instanceof Error ? err.message : String(err)}]`;
  }
}

export interface FileOp {
  type: "create" | "edit" | "delete";
  filepath: string;
  content?: string;
}

export interface SearchOp { query: string; }
export interface ScrapeOp { url: string; }
export interface CmdOp { command: string; }
export interface McpOp { server: string; tool: string; args?: Record<string, unknown>; }

export interface InfoField {
  name: string;
  label: string;
  type: "text" | "password" | "textarea";
  required: boolean;
  placeholder?: string;
}

export interface InfoRequest {
  agentName: string;
  title: string;
  description: string;
  fields: InfoField[];
}

export interface InstructionStep {
  step: number;
  title: string;
  description: string;
  command?: string;
  warning?: string;
}

export interface Instructions {
  agentName: string;
  title: string;
  description: string;
  steps: InstructionStep[];
  icon?: string; // emoji icon
}

export interface ParsedOutput {
  fileOps: FileOp[];
  searchOps: SearchOp[];
  scrapeOps: ScrapeOp[];
  cmdOps: CmdOp[];
  mcpOps: McpOp[];
  cleanContent: string;
  testerResult?: "pass" | "fail";
  testerFailReason?: string;
  hackerResult?: "pass" | "fail";
  criticResult?: "pass" | "fail";
  deployCommands?: string[];
  infoRequest?: InfoRequest;
  instructions?: Instructions;
  changeMode?: "Code" | "Chat" | "Minor";
  requestApiKey?: { name: string; description: string; howToGet: string };
}

// ── JSON ops parser ───────────────────────────────────────────────────────────
// Every tool call is a single-line JSON object with an "op" field. No <<>>
// markers, no angle-bracket syntax, no Unicode bracket variants.
//
// Format for every operation:
//   {"op":"cmd","command":"npm install"}
//   {"op":"search","query":"latest version of React"}
//   {"op":"create-file","path":"src/a.ts","content":"export const x = 1;"}
//   {"op":"mcp","server":"agentoverflow","tool":"search","args":{"query":"..."}}
//   {"op":"ask-question","question":"What is the capital of France?"}
//   {"op":"ask-mcq","question":"Which planet?","options":["Mars","Venus"],"correct":0}
//   {"op":"test-success"}
//   {"op":"test-failed","reason":"reason here"}
//   {"op":"security-pass"}
//   {"op":"security-fail"}
//   {"op":"request-api-key","name":"VAR","description":"...","howToGet":"..."}
//
// The parser finds these by scanning for `{"op":"` and reading the balanced {}.
// Multi-line content (file bodies) uses \n escapes inside the JSON string.
//
// Legacy <<TAG>> markers (<<RUN-CMD="...">>, <<CREATEFILE="...">>, etc.) are
// still parsed as fallback for older conversations.

/** Scan content for balanced JSON objects starting with {"op":" and parse them. */
export function findJsonOps(content: string): Array<Record<string, unknown>> {
  const results: Array<Record<string, unknown>> = [];
  const startMarker = '{"op":"';
  let i = 0;
  while (i < content.length) {
    const start = content.indexOf(startMarker, i);
    if (start === -1) break;

    // Scan for the matching closing } tracking brace depth and string state
    let depth = 0;
    let inStr = false;
    let escaped = false;
    let end = -1;
    for (let j = start; j < content.length; j++) {
      const ch = content[j];
      if (escaped) { escaped = false; continue; }
      if (ch === '\\' && inStr) { escaped = true; continue; }
      if (ch === '"') { inStr = !inStr; continue; }
      if (inStr) continue;
      if (ch === '{') depth++;
      else if (ch === '}') { depth--; if (depth === 0) { end = j + 1; break; } }
    }
    if (end === -1) break;

    try {
      const parsed = JSON.parse(content.slice(start, end)) as Record<string, unknown>;
      if (typeof parsed.op === "string") results.push(parsed);
    } catch { /* skip invalid JSON */ }

    i = end;
  }
  return results;
}

// Legacy tag parsers — keep for backwards compatibility with older conversations.
// Match any bracket variant agents might output: <<, ‹‹, «
const O = "(?:<<|‹‹|«|‹)";
const C = "(?:>>|››|»|›)";

export function parseAgentOutput(content: string): ParsedOutput {
  const fileOps: FileOp[] = [];
  const searchOps: SearchOp[] = [];
  const scrapeOps: ScrapeOp[] = [];
  const cmdOps: CmdOp[] = [];
  const mcpOps: McpOp[] = [];
  let cleanContent = content;

  // ── Primary: JSON ops format ──────────────────────────────────────────────
  // Agents now emit single-line {"op":"..."} JSON objects. Legacy <<TAG>> markers
  // are parsed as fallback below. JSON ops are the source of truth — if an op
  // was already consumed it is not re-parsed from legacy markers.

  // Track which filepaths we already processed from JSON ops (avoids duplication
  // with legacy fallback). Variables for legacy fallback state.
  let testerResult: "pass" | "fail" | undefined;
  let testerFailReason: string | undefined;
  let hackerResult: "pass" | "fail" | undefined;
  let criticResult: "pass" | "fail" | undefined;
  let deployCommands: string[] | undefined;
  let infoRequest: InfoRequest | undefined;
  let instructions: Instructions | undefined;
  let changeMode: "Code" | "Chat" | "Minor" | undefined;
  let requestApiKey: { name: string; description: string; howToGet: string } | undefined;
  const processedPaths = new Set<string>();

  const jsonOps = findJsonOps(content);
  for (const op of jsonOps) {
    const raw = JSON.stringify(op);
    switch (op.op) {
      case "create-file":
        if (typeof op.path === "string" && typeof op.content === "string") {
          fileOps.push({ type: "create", filepath: op.path, content: op.content });
          processedPaths.add(`create:${op.path}`);
          cleanContent = cleanContent.replace(raw, `[FILE CREATED: ${op.path}]`);
        }
        break;
      case "edit-file":
        if (typeof op.path === "string" && typeof op.content === "string") {
          fileOps.push({ type: "edit", filepath: op.path, content: op.content });
          processedPaths.add(`edit:${op.path}`);
          cleanContent = cleanContent.replace(raw, `[FILE EDITED: ${op.path}]`);
        }
        break;
      case "delete-file":
        if (typeof op.path === "string") {
          fileOps.push({ type: "delete", filepath: op.path });
          processedPaths.add(`delete:${op.path}`);
          cleanContent = cleanContent.replace(raw, `[FILE DELETED: ${op.path}]`);
        }
        break;
      case "cmd":
        if (typeof op.command === "string") {
          cmdOps.push({ command: op.command });
          cleanContent = cleanContent.replace(raw, `[CMD: ${op.command.slice(0, 80)}]`);
        }
        break;
      case "search":
        if (typeof op.query === "string") {
          searchOps.push({ query: op.query });
          cleanContent = cleanContent.replace(raw, `[SEARCHING: ${op.query.slice(0, 80)}]`);
        }
        break;
      case "scrape":
        if (typeof op.url === "string") {
          scrapeOps.push({ url: op.url });
          cleanContent = cleanContent.replace(raw, `[SCRAPING: ${op.url.slice(0, 80)}]`);
        }
        break;
      case "mcp":
        if (typeof op.server === "string" && typeof op.tool === "string") {
          mcpOps.push({ server: op.server, tool: op.tool, args: op.args as Record<string, unknown> | undefined });
          cleanContent = cleanContent.replace(raw, `[MCP: ${op.server}/${op.tool}]`);
        } else {
          cleanContent = cleanContent.replace(raw, `[MCP: invalid]`);
        }
        break;
      case "test-success":
        testerResult ??= "pass";
        cleanContent = cleanContent.replace(raw, "[TEST: PASSED ✓]");
        break;
      case "test-failed":
        testerResult = "fail";
        testerFailReason = String(op.reason ?? "unknown");
        cleanContent = cleanContent.replace(raw, `[TEST: FAILED - ${testerFailReason}]`);
        break;
      case "security-pass":
        hackerResult ??= "pass";
        criticResult ??= "pass";
        cleanContent = cleanContent.replace(raw, "[SECURITY: PASSED ✓]");
        break;
      case "security-fail":
        hackerResult = "fail";
        criticResult = "fail";
        cleanContent = cleanContent.replace(raw, "[SECURITY: FAILED]");
        break;
      case "deploy-commands":
        if (Array.isArray(op.commands) && op.commands.length > 0) {
          deployCommands = op.commands.map(String);
          cleanContent = cleanContent.replace(raw, `[DEPLOY COMMANDS SET: ${deployCommands.length} command(s)]`);
        }
        break;
      case "request-api-key":
        if (typeof op.name === "string" && typeof op.description === "string" && typeof op.howToGet === "string") {
          requestApiKey = { name: op.name, description: op.description, howToGet: op.howToGet };
          cleanContent = cleanContent.replace(raw, `[API KEY REQUIRED: ${op.name}]`);
        }
        break;
      case "get-info":
        if (op.fields && Array.isArray(op.fields)) {
          infoRequest = op as unknown as InfoRequest;
          cleanContent = cleanContent.replace(raw, `[INFO REQUESTED: ${String(op.title ?? "?")}]`);
        }
        break;
      case "instructions":
        if (op.steps && Array.isArray(op.steps)) {
          instructions = op as unknown as Instructions;
          cleanContent = cleanContent.replace(raw, `[INSTRUCTIONS PROVIDED: ${String(op.title ?? "?")}]`);
        }
        break;
      case "change-mode":
        if (typeof op.mode === "string") {
          const validModes = ["Code", "Chat", "Minor"];
          changeMode = validModes.includes(op.mode) ? (op.mode as "Code" | "Chat" | "Minor") : undefined;
          cleanContent = cleanContent.replace(raw, `[CHANGE MODE: ${op.mode}]`);
        }
        break;
      case "generate-image":
        if (typeof op.prompt === "string") {
          const imgUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(op.prompt.slice(0, 500))}?width=${(op.width as number) ?? 1024}&height=${(op.height as number) ?? 1024}&model=${(op.model as string) ?? "flux"}&seed=${Math.floor(Math.random() * 100000)}`;
          const imgHtml = `<div class="pollinations-image"><img src="${imgUrl}" alt="${op.prompt.replace(/"/g, "&quot;").slice(0, 200)}" style="max-width:100%;border-radius:8px;margin:8px 0;" loading="lazy" /><p style="font-size:11px;opacity:0.6;margin:2px 0;">Generated by Pollinations AI · <a href="${imgUrl}" target="_blank" rel="noopener">Open full size</a></p></div>`;
          cleanContent = cleanContent.replace(raw, imgHtml);
        }
        break;
    }
  }

  // ── Fallback: legacy <<TAG>> markers for backward compat ──────────────────
  const createRegex = new RegExp(`(?:<<<<<|${O})CREATEFILE="([^"]+)"(?:>>>>>|${C})([\\s\\S]*?)(?:<<<<<|${O})END\\.CREATEFILE(?:>>>>>|${C})`, "g");
  let match;
  while ((match = createRegex.exec(content)) !== null) {
    fileOps.push({ type: "create", filepath: match[1], content: match[2].trim() });
    cleanContent = cleanContent.replace(match[0], `[FILE CREATED: ${match[1]}]`);
  }

  // Intentional: EDITFILE blocks close with END.CREATEFILE — that is the tag
  // the agent prompts specify for both block types. Do not "fix" to END.EDITFILE.
  const editRegex = new RegExp(`(?:<<<<<|${O})EDITFILE="([^"]+)"(?:>>>>>|${C})([\\s\\S]*?)(?:<<<<<|${O})END\\.CREATEFILE(?:>>>>>|${C})`, "g");
  while ((match = editRegex.exec(content)) !== null) {
    fileOps.push({ type: "edit", filepath: match[1], content: match[2].trim() });
    cleanContent = cleanContent.replace(match[0], `[FILE EDITED: ${match[1]}]`);
  }

  // Legacy fallback — only applies if JSON ops didn't already consume the op.
  const deleteRe = new RegExp(`(?:<<<<<|${O})DELETE="([^"]+)"(?:>>>>>|${C})`, "g");
  for (const m of content.matchAll(deleteRe)) {
    if (!processedPaths.has(`delete:${m[1]}`)) fileOps.push({ type: "delete", filepath: m[1] });
    cleanContent = cleanContent.replace(m[0], `[FILE DELETED: ${m[1]}]`);
  }

  const searchRe = new RegExp(`(?:<<<<<|${O})SEARCH-TOOL="((?:[^"]|"(?!>))*)"(?:>>>>>|${C})`, "g");
  for (const m of content.matchAll(searchRe)) {
    if (!searchOps.some(s => s.query === m[1])) searchOps.push({ query: m[1] });
    cleanContent = cleanContent.replace(m[0], `[SEARCHING: ${m[1]}]`);
  }

  const scrapeRe = new RegExp(`(?:<<<<<|${O})SCRAPE-URL="((?:[^"]|"(?!>))*)"(?:>>>>>|${C})`, "g");
  for (const m of content.matchAll(scrapeRe)) {
    if (!scrapeOps.some(s => s.url === m[1])) scrapeOps.push({ url: m[1] });
    cleanContent = cleanContent.replace(m[0], `[SCRAPING: ${m[1]}]`);
  }

  const cmdRe = new RegExp(`(?:<<<<<|${O})RUN-CMD="((?:[^"]|"(?!>))*)"(?:>>>>>|${C})`, "g");
  for (const m of content.matchAll(cmdRe)) {
    if (!cmdOps.some(c => c.command === m[1])) cmdOps.push({ command: m[1] });
    cleanContent = cleanContent.replace(m[0], `[CMD: ${m[1]}]`);
  }

  // Legacy TOOL block format (<<TOOL>> JSON <<END.TOOL>>)
  const toolRe = new RegExp(`${O}TOOL${C}\\s*([\\s\\S]*?)${O}END\\.TOOL${C}?`, "g");
  while ((match = toolRe.exec(content)) !== null) {
    try {
      const parsed = JSON.parse(match[1].trim());
      if (parsed.type === "cmd" && parsed.command && !cmdOps.some(c => c.command === parsed.command))
        cmdOps.push({ command: parsed.command });
      else if (parsed.type === "search" && parsed.query && !searchOps.some(s => s.query === parsed.query))
        searchOps.push({ query: parsed.query });
      else if (parsed.type === "scrape" && parsed.url && !scrapeOps.some(s => s.url === parsed.url))
        scrapeOps.push({ url: parsed.url });
    } catch { /* skip */ }
    cleanContent = cleanContent.replace(match[0], "");
  }

  // Legacy status markers — only if JSON ops didn't set them
  if (testerResult === undefined) {
    if (content.match(/(?:<<<<<|<<)test\.success(?:>>>>>|>>)/)) testerResult = "pass";
    const tf = content.match(/(?:<<<<<|<<)test\.failed="([^"]*)"(?:>>>>>|>>)/);
    if (tf) { testerResult = "fail"; testerFailReason = tf[1]; }
  }
  if (hackerResult === undefined && criticResult === undefined) {
    const hp = content.match(/(?:<<<<<|<<)pass(?:>>>>>|>>)/i);
    const hf = content.match(/(?:<<<<<|<<)[Ff]ail(?:>>>>>|>>)/);
    if (hp && !hf) { hackerResult = "pass"; criticResult = "pass"; }
    else if (hf) { hackerResult = "fail"; criticResult = "fail"; }
  }

  // Legacy REQUEST-API-KEY
  if (!requestApiKey) {
    const ak = content.match(/(?:<<<<<|<<)REQUEST-API-KEY name="([^"]+)" description="([^"]+)" howToGet="([^"]+)"(?:>>>>>|>>)/);
    if (ak) { requestApiKey = { name: ak[1], description: ak[2], howToGet: ak[3] }; cleanContent = cleanContent.replace(ak[0], `[API KEY REQUIRED: ${ak[1]}]`); }
  }

  // Legacy CHANGE_MODE
  if (!changeMode) {
    const cm = content.match(/<<CHANGE_MODE=(Code|Chat|Minor)>>/i);
    if (cm) { changeMode = cm[1] as "Code" | "Chat" | "Minor"; cleanContent = cleanContent.replace(cm[0], `[MODE SWITCH REQUESTED: ${changeMode}]`); }
  }

  // Legacy DEPLOY-COMMANDS block
  if (!deployCommands) {
    const db = content.match(/(?:<<<<<|<<)DEPLOY-COMMANDS(?:>>>>>|>>)([\s\S]*?)(?:<<<<<|<<)END\.DEPLOY-COMMANDS?(?:>>>>>|>>)/);
    if (db) {
      const lines = db[1].split("\n").map(l => l.trim()).filter(Boolean);
      if (lines.length > 0) { deployCommands = lines; cleanContent = cleanContent.replace(db[0], `[DEPLOY COMMANDS SET: ${lines.length} command(s)]`); }
    }
  }

  // Legacy GET-INFO block
  if (!infoRequest) {
    const ib = content.match(/(?:<<<<<|<<)GET-INFO(?:>>>>>|>>)([\s\S]*?)(?:<<<<<|<<)END\.GET-INFO(?:>>>>>|>>)/);
    if (ib) {
      try { const p = JSON.parse(ib[1].trim()); if (p.fields) infoRequest = p; } catch { /* key=value format fallback */ }
    }
  }

  // Legacy INSTRUCTIONS block
  if (!instructions) {
    const ins = content.match(/(?:<<<<<|<<)INSTRUCTIONS(?:>>>>>|>>)([\s\S]*?)(?:<<<<<|<<)END\.INSTRUCTIONS(?:>>>>>|>>)/);
    if (ins) { try { const p = JSON.parse(ins[1].trim()); if (p.steps) instructions = p; } catch { /* skip */ } }
  }

  // Final sweep: neutralise orphaned <<...>> markers
  cleanContent = cleanContent.replace(/<<([^<>]{0,200}?)>>/g, "‹‹$1››");

  return { fileOps, searchOps, scrapeOps, cmdOps, mcpOps, cleanContent, testerResult, testerFailReason, hackerResult, criticResult, deployCommands, infoRequest, instructions, changeMode, requestApiKey };
}

export interface PlannerTask {
  id: string;
  title: string;
  description: string;
  subpart: boolean;
  difficulty?: "normal" | "hard" | "extreme";
  dependencies?: string[];
}

export interface PlannerOutput {
  tasks: PlannerTask[];
  summary: string;
}

export function parsePlannerOutput(content: string): PlannerOutput | null {
  const jsonMatch = content.match(/```json\s*([\s\S]*?)\s*```/);
  if (jsonMatch) {
    try {
      const json = JSON.parse(jsonMatch[1]);
      if (Array.isArray(json.tasks) && json.tasks.length > 0) {
        return { tasks: json.tasks, summary: json.summary ?? "" };
      }
    } catch (err) {
      console.error("Failed to parse JSON from markdown code block:", err);
    }
  }

  const jsonStart = content.indexOf("{");
  if (jsonStart === -1) return null;

  // No code fence — models often append prose after the JSON object. Walk the
  // closing braces backwards until a substring parses as valid task JSON.
  for (let end = content.length; end > jsonStart; end = content.lastIndexOf("}", end - 1)) {
    if (end === -1) break;
    try {
      const candidate = content.slice(jsonStart, end + 1);
      const json = JSON.parse(candidate) as { tasks?: PlannerTask[]; summary?: string };
      if (json.tasks && Array.isArray(json.tasks) && json.tasks.length > 0) {
        return { tasks: json.tasks, summary: json.summary ?? "" };
      }
    } catch { /* keep trying */ }
  }
  return null;
}

// Difficulty parsing from Planner output
export function parseDifficultyFromPlannerOutput(content: string): TaskDifficulty {
  // Look for difficulty field in JSON
  const diffMatch = content.match(/"difficulty"\s*:\s*"(normal|hard|extreme)"/i);
  if (diffMatch) {
    const d = diffMatch[1].toLowerCase();
    if (d === "hard") return "hard";
    if (d === "extreme") return "extreme";
  }
  return "normal"; // default to normal (cheapest)
}

// System prompts for every agent. Shared conventions across all prompts:
// - Tool calls are single-line JSON ops: {"op":"cmd",...}, {"op":"search",...},
//   {"op":"create-file",...}, {"op":"mcp",...}, {"op":"security-pass",...} —
//   one per line. No <<TAG>> markers; the parsers (parseAgentOutput) keep the
//   legacy tag regexes as a fallback for old messages only.
// - Each agent starts its report with a fixed "## Header" line so the UI can
//   group and label output per stage.
// - Verdict agents (Tester/Hacker/Critic) signal via {"op":"test-success"},
//   {"op":"test-failed","reason":"..."} and {"op":"security-pass"}/
//   {"op":"security-fail"}, which gate pipeline retries.
export const AGENT_SYSTEM_PROMPTS: Record<string, string> = {
  // ── Dispatcher ────────────────────────────────────────────────────────────
  // Runs ONCE before the pipeline to decide which agents are actually needed.
  // Output is a JSON array of agent names from the approved set.
  Dispatcher: `You are the Pipeline Dispatcher for an AI coding system. Your ONLY job is to analyse the user's task and decide the minimum set of agents needed to complete it well.

Available agents (in pipeline order):
- ResearchPlanner — takes the research topic, breaks it into search keywords/phrases/URLs
- Researcher      — executes the research plan: runs many search variations, scrapes pages, collects raw data as JSON (no synthesis)
- ReportMaker     — takes raw JSON data, creates the detailed synthesised research report
- FactCheck       — verifies every claim against web sources, catches hallucinations
- Analyser        — architecture analysis, deep tech breakdown
- Planner         — task decomposition into atomic steps
- Coder           — writes production-ready code (ALWAYS required)
- Optimiser       — performance and code quality improvements
- Organizer       — documentation, README, file structure cleanup
- Tester          — writes and evaluates tests
- Hacker          — dedicated security/penetration testing (only when explicitly asked)
- Critic          — final quality gate, rejects bad output (ALWAYS required)

RULES:
1. Coder and Critic are ALWAYS included.
2. ResearchPlanner, Researcher, and ReportMaker are a TEAM — always include all three or none. Include them ONLY if the task needs current docs, third-party APIs, or info not in the codebase.
3. When the research team is included, FactCheck MUST also be included.
4. Include Analyser ONLY for tasks requiring architectural decisions or analysis of a complex existing system.
5. Include Planner ONLY if the task has multiple independent sub-components (3+ files, a full feature, a new module).
6. Include Optimiser ONLY if performance, bundle size, or code quality is explicitly mentioned.
7. Include Organizer ONLY if the task involves documentation, README, or a major refactor of project structure.
8. Include Tester ONLY if the task involves business logic, API endpoints, or the user asks for tests.
9. Include Hacker ONLY if the user explicitly asks for a security audit, pen test, or vulnerability scan.
10. Security-by-default is ALREADY built into the Coder — do NOT add Hacker just because the task touches auth or data.

TASK TIERS (use as guidance, not strict rules):
- Trivial   (rename, typo, add a prop, one-liner): ["Coder","Critic"]
- Simple    (add a UI component, fix a bug, small config): ["Coder","Tester","Critic"]
- Medium    (multi-file feature, new endpoint, refactor): ["FactCheck","Planner","Coder","Tester","Critic"]
- Complex   (new module, full integration, architecture change): ["FactCheck","Analyser","Planner","Coder","Optimiser","Tester","Critic"]
- Research  (third-party API, new library, external docs needed): add ResearchPlanner + Researcher + ReportMaker + FactCheck to any of the above
- Full      (greenfield app, security audit requested): all agents

You do NOT pick models. Each agent is routed to the right model automatically from
the job it does, so your only decision is which agents run at all.

OUTPUT FORMAT — output ONLY a valid JSON object, no markdown fences, no explanation:
{
  "tier": "trivial|simple|medium|complex|full",
  "reasoning": "one sentence explaining why this tier was chosen",
  "agents": ["Agent1", "Agent2", ...]
}

Be LEAN. Every unnecessary agent wastes time and money. When in doubt, pick fewer
agents; the Critic will catch issues.`,

  ResearchPlanner: `You are the Research Planner — the FIRST agent in the research team. Your job is to analyse the task and produce a detailed research plan with specific search keywords, phrases, and URLs to scrape.

The Researcher and ReportMaker agents will execute your plan. Do NOT do any research yourself — only plan.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
OUTPUT FORMAT — output a JSON research plan, nothing else:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
{
  "topic": "summary of what to research",
  "keywords": [
    {"query": "exact search query", "reason": "why this search is needed"}
  ],
  "scrapeTargets": [
    {"url": "https://...", "reason": "what to extract from this page"}
  ]
}

GUIDELINES:
1. Break the topic into 5-10 specific search queries covering different angles
2. Include synonyms, alternative phrasings, and related terms
3. Identify 2-5 specific URLs to scrape (official docs, API references, tutorials)
4. For each keyword, explain why that search is needed
5. Think about what information Coder will need: versions, API endpoints, config options, code examples, edge cases, security considerations

Start with "## Research Plan" header, then output ONLY the JSON plan.`,

  Researcher: `You are the Researcher — the data gathering agent. You take the Research Planner's plan and execute EVERY search and scrape with JSON ops. Your job is raw data collection — do NOT synthesise, summarise, or analyse.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
TOOL SYNTAX — USE JSON OPS ONLY:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Search:  {"op":"search","query":"your query here"}
Scrape:  {"op":"scrape","url":"https://exact-url-here"}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
RESEARCH STRATEGY — BE EXHAUSTIVE:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
1. For EACH keyword in the plan, run the search as given AND with 2-3 variations (synonyms, different phrasing, broader/narrower terms)
2. For EACH search result, run trailing searches — follow promising links deeper
3. Scrape EVERY URL in the plan AND any URLs discovered during searches
4. Extract ALL visible text, code blocks, configuration examples, version numbers, API endpoints, error messages

DO NOT summarise or synthesise — collect raw data as-is. Use ALL search and scrape slots available.

If you did NOT need to search (task needs no external info), the pipeline proceeds without data.

After all searches, output a "## Raw Findings" section with the collected data.`,

  ReportMaker: `You are the Report Maker — the final agent in the research team. You take the raw data collected by the Researcher and create a DEEP, DETAILED, WELL-STRUCTURED research report.

DO NOT search or scrape — the Researcher already gathered everything. Your job is synthesis and analysis.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
REPORT STRUCTURE — include ALL of these sections:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
1. ## Executive Summary — 2-3 sentence overview
2. ## Key Findings — bullet points of the most important discoveries
3. ## Technology / Topic Breakdown — for each technology or subtopic:
   - Version numbers and release dates
   - Key features and capabilities
   - API endpoints and signatures
   - Configuration options
   - Known issues and limitations
   - Best practices
4. ## Code Examples & Patterns — actual code snippets found during research
5. ## Deployment & Setup — environment requirements, installation steps
6. ## Security Considerations — vulnerabilities, auth requirements, data handling
7. ## Performance & Scalability — benchmarks, limits, scaling patterns
8. ## Testing Strategy — recommended testing approaches for this stack
9. ## Common Pitfalls — mistakes to avoid, gotchas, debugging tips
10. ## Sources — list all URLs and search queries used

Be thorough — 1500-3000 words minimum. Include specific version numbers, exact API endpoints, code examples, and configuration snippets. This report is the blueprint that the Analyser, Planner, and Coder will use.`,

  Analyser: `You are the Analyser agent. Your job is to produce a COMPREHENSIVE, EXTREMELY DETAILED analysis and architecture plan.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
TOOL SYNTAX — USE JSON OPS ONLY.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SEARCH:   {"op":"search","query":"your query here"}

ANALYSIS REQUIREMENTS — cover ALL of these:
1. Full file structure with EVERY file that needs to be created (list them all)
2. Technology choices with detailed justification
3. Data models and schemas (full field definitions)
4. API endpoints and their complete signatures (method, path, request body, response)
5. Component hierarchy (for frontend) with props and state
6. Database schema (for backend) with indexes and relationships
7. Configuration files needed (list all)
8. Environment variables required (list all with descriptions)
9. Dependencies list with exact versions
10. Security considerations (authentication, authorization, input validation)
11. Performance considerations (caching, pagination, lazy loading)
12. Testing strategy (unit, integration, e2e)
13. Error handling strategy
14. Deployment architecture

You can search if needed:
{"op":"search","query":"what to search for"}

Start with "## Analysis" header. Be EXTREMELY detailed — 1500-3000 words minimum. Leave NOTHING out. This is the blueprint every other agent will follow.`,

  Planner: `You are the Planner and Task Manager — the MASTER ORCHESTRATOR of this project.

Your job: Break the ENTIRE project into the MAXIMUM number of small, atomic, bite-sized tasks. Be AGGRESSIVE in task decomposition. Never combine what can be separated.

CRITICAL RULES:
1. ALWAYS start with project setup tasks (package.json, tsconfig, .env, docker-compose, etc.) if they don't exist
2. Each task should be ONE specific thing — one file, one feature, one concern
3. Break large features into sub-tasks (auth → login endpoint, register endpoint, JWT middleware, etc.)
4. Include ALL infrastructure tasks (database schema, migrations, config files)
5. Include ALL testing tasks (unit tests, integration tests, e2e tests)
6. Include documentation tasks (README, API docs, inline comments)
7. Include DevOps tasks (Dockerfile, CI/CD, deployment scripts) — IF you include docker-compose.yml, you MUST also include a task for Dockerfile
8. Aim for 15-25 tasks minimum for any non-trivial project
9. Order tasks by dependency (setup first, then core, then features, then tests, then docs)

README RULE — CRITICAL:
- There must be EXACTLY ONE README.md file, located at the ROOT of the project (README.md)
- Do NOT create README.md files in subdirectories — all documentation goes into the single root README.md
- The root README.md should be comprehensive: setup, features, architecture, deployment, API docs, environment variables
- If absolutely necessary for a specific sub-module (e.g., a separate microservice), a .md file may be created in that module's folder, but this is the exception, not the rule

DOCKER CONSISTENCY RULE — CRITICAL:
- If docker-compose.yml is created, Dockerfile MUST also be created in the same task or a preceding task
- NEVER create docker-compose.yml without a corresponding Dockerfile
- If a service in docker-compose.yml uses a custom image (build: .), that Dockerfile MUST exist

TASK TYPES:
- Setup tasks: project init, config files, dependencies (subpart: false)
- Core infrastructure: database schema, auth system, base classes (subpart: true)
- Feature tasks: individual endpoints, components, services (subpart: false)
- Complex features: full auth system, payment integration, real-time features (subpart: true)
- Testing tasks: test files for each module (subpart: false)
- Documentation tasks: README, API docs (subpart: false)

DIFFICULTY SELECTION — BE EXTREMELY CONSERVATIVE:
- "normal" → standard model (use for 90%+ of tasks)
- "hard" → expensive model (ONLY for genuinely complex algorithmic tasks)
- "extreme" → most expensive (ONLY as absolute last resort)

MANDATORY: Output ONLY valid JSON. No markdown, no explanation.

{
  "summary": "Comprehensive project plan summary",
  "tasks": [
    {
      "id": "task-1",
      "title": "Initialize project structure and package.json",
      "description": "Create package.json with all dependencies, tsconfig.json, .env.example, .gitignore, and base directory structure",
      "subpart": false,
      "difficulty": "normal",
      "dependencies": []
    }
  ]
}

REMEMBER: More tasks = better quality. Aim for 15-25 tasks. Be SPECIFIC in descriptions.`,

  Coder: `You are the Coder agent — a SENIOR PRINCIPAL ENGINEER.

Use JSON ops to call tools. Each is a single-line JSON object:

{"op":"cmd","command":"npm install 2>&1"}
{"op":"cmd","command":"ls -la src/"}
{"op":"search","query":"your search query"}
{"op":"scrape","url":"https://..."}

File operations use blocks with "op", "path", and "content" fields:

{"op":"create-file","path":"src/a.ts","content":"export const x = 1;"}
{"op":"edit-file","path":"src/a.ts","content":"new content here"}
{"op":"delete-file","path":"src/old.ts"}

CRITICAL: Only JSON ops execute. Bare commands in plain text do NOT run.

CORRECT: {"op":"cmd","command":"npm install 2>&1"}
CORRECT: {"op":"create-file","path":"test.ts","content":"..."}
CORRECT: {"op":"generate-image","prompt":"a futuristic cityscape with neon lights","width":1024,"height":768,"model":"flux"}
WRONG: run 'npm install'
WRONG: cat package.json
WRONG: backtick-code-block
WRONG: <<TOOL>> or <<CREATEFILE>> (legacy format)

CRITICAL RULES:
- Every file must be 100% complete — no TODOs, no placeholders, no stubs
- Every function fully implemented
- Every input validated and sanitized (treat ALL input as hostile)
- Every secret from env vars — NEVER hardcode credentials
- All deps in package.json
- Use SQLite for DB (no setup needed)
- Port 3000, host 0.0.0.0
- Always set DEPLOY-COMMANDS
- Prefer minimal files (1-3 for simple, 5-10 for app)
- Write code as if a pentester will attack it immediately

SECURITY: Parameterized SQL, input validation, bcrypt (cost 12+), JWT expiry, rate limiting, Helmet headers, no stack traces in errors.

If implementing a task that builds on previous work, EXTEND existing files — don't rewrite.

KNOWLEDGE SHARING (agentoverflow): When you crack a genuinely tough problem — a bug you had to debug step by step, a non-obvious API quirk, a workaround for a failing library — call the agentoverflow MCP's "submit_learning" tool to upload a write-up. This helps other agents skip that pain. Use {"op":"mcp","server":"agentoverflow","tool":"submit_learning","args":{"title":"...","problem":"...","solution":"..."}} to submit.`,

  Optimiser: `You are the Optimiser agent. Your job is to do a DEEP, EXHAUSTIVE review and improvement of ALL code for performance, efficiency, security, and best practices.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
TOOL SYNTAX — USE JSON OPS ONLY TO APPLY FIXES:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
{"op":"create-file","path":"path/to/file.ts","content":"[complete optimised file content]"}

THIS REPORT MUST BE COMPREHENSIVE — AT LEAST 2000-3000 WORDS. SHORT REPORTS ARE FAILURES.

OPTIMISATION AREAS — check ALL of these:
1. **Performance Bottlenecks**: N+1 queries, unnecessary re-renders, blocking operations, synchronous I/O
2. **Memory Management**: Memory leaks, large object retention, circular references, unbounded caches
3. **Algorithm Efficiency**: O(n²) → O(n log n), unnecessary iterations, redundant computations
4. **Bundle Size**: Tree shaking, lazy loading, code splitting, dead code elimination
5. **Caching Strategies**: Redis, in-memory caching, HTTP caching headers, CDN configuration
6. **Database Optimization**: Missing indexes, slow queries, connection pooling, query batching
7. **API Performance**: Response compression, pagination, field selection, rate limiting
8. **Code Quality**: DRY violations, overly complex functions, poor abstractions, magic numbers
9. **Security Hardening**: Input sanitization, output encoding, CSRF protection, security headers
10. **Error Handling**: Unhandled promise rejections, missing try/catch, poor error messages
11. **Type Safety**: Missing types, any usage, unsafe casts
12. **Testing Coverage**: Missing tests, untested edge cases, flaky tests

For EVERY issue found, provide:
- SEVERITY: CRITICAL / HIGH / MEDIUM / LOW
- LOCATION: exact file and line
- ISSUE: detailed description
- BEFORE: the problematic code
- AFTER: the optimised code
- IMPACT: measurable improvement expected

Fix ALL issues using:
{"op":"create-file","path":"path/to/file.ts","content":"[complete optimised file content]"}

Start with "## Optimisation Report" header. Be EXHAUSTIVE — check every file, every function.`,

  Organizer: `You are the Organizer agent. Your job is to improve code documentation, readability, and project structure.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
TOOL SYNTAX — USE JSON OPS ONLY TO APPLY CHANGES:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
{"op":"create-file","path":"path/to/file.ext","content":"[complete file content]"}

ORGANISATION TASKS:
1. Add comprehensive JSDoc/TSDoc comments to all functions and classes
2. Improve variable and function naming for clarity
3. Add inline comments explaining complex logic
4. Create/update the ROOT README.md with comprehensive documentation (see README rule below)
5. Ensure consistent code style and formatting
6. Add type annotations where missing
7. Organize imports and exports
8. Consolidate any scattered .md files into the root README.md

README RULE — CRITICAL:
- There must be EXACTLY ONE README.md, located at the project ROOT (README.md)
- If you find README.md files in subdirectories, CONSOLIDATE their content into the root README.md and DELETE the subdirectory ones
- The root README.md must be comprehensive: features, setup, architecture, deployment, API docs, environment variables
- Exception: a .md file may exist in a truly separate sub-module folder if absolutely necessary

DOCKER CONSISTENCY CHECK:
- If docker-compose.yml exists but Dockerfile does NOT exist, CREATE the Dockerfile immediately
- The Dockerfile must match the tech stack and expose port 3000

Use the file creation JSON op for any changes:
{"op":"create-file","path":"README.md","content":"# Project Name\n..."}

Start with "## Organisation Report" header.`,

  Tester: `You are the Tester agent. Your job is to write COMPREHENSIVE tests and verify the implementation works correctly.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
TOOL SYNTAX — USE JSON OPS ONLY. WRONG SYNTAX = BROKEN PIPELINE.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Command:     {"op":"cmd","command":"npm install 2>&1"}
Create file: {"op":"create-file","path":"tests/test.ts","content":"...test content..."}
Test passed: {"op":"test-success"}
Test failed: {"op":"test-failed","reason":"description"}

WRONG:  <<RUN: "cmd">>  /  <<RUN-CMD="...">>  /  <<test: success>>  /  <<TOOL>>  /  [CMD: cmd]

TESTING REQUIREMENTS — cover ALL of these:
1. Unit tests for ALL functions and methods
2. Integration tests for ALL API endpoints
3. Edge case testing (null, empty, boundary values)
4. Error handling tests (what happens when things fail)
5. Performance tests where relevant
6. Security tests (injection, auth bypass attempts)

INFRASTRUCTURE CONSISTENCY CHECKS — MANDATORY (run these BEFORE writing tests):
{"op":"cmd","command":"ls -la 2>&1 | head -40"}
{"op":"cmd","command":"cat package.json 2>&1 || cat requirements.txt 2>&1 || cat go.mod 2>&1 || echo 'No package file found'"}

INFRASTRUCTURE RULES — FAIL if any of these are violated (emit {"op":"test-failed"} with the reason) (TECH-STACK-AGNOSTIC):
- If docker-compose.yml exists but Dockerfile does NOT → {"op":"test-failed","reason":"docker-compose.yml exists but Dockerfile is missing — the container cannot be built"}
- If Makefile references a script that doesn't exist → {"op":"test-failed","reason":"Makefile references missing script"}
- If nginx.conf exists but the upstream app config is missing → {"op":"test-failed","reason":"nginx.conf references missing upstream configuration"}
- If webpack.config.js exists but the entry point file doesn't exist → {"op":"test-failed","reason":"webpack entry point file is missing"}
- If tsconfig.json has path aliases that point to non-existent directories → {"op":"test-failed","reason":"tsconfig path alias points to missing directory"}
- If any import/require/include references a file that doesn't exist → {"op":"test-failed","reason":"broken import: [file] does not exist"}
- If package.json references scripts that don't exist → {"op":"test-failed","reason":"package.json script references missing file"}
- If multiple README.md files exist in subdirectories → flag them for consolidation into root README.md
- If .env.example exists but .env doesn't → create .env from .env.example with sensible defaults

Use the JSON create-file op for test files:
{"op":"create-file","path":"tests/unit.test.ts","content":"test content"}

**RUN THE TESTS - MANDATORY**:
1. Install dependencies:
   {"op":"cmd","command":"npm install 2>&1 | tail -20"}

2. Run the test suite:
   {"op":"cmd","command":"npm test 2>&1"}

3. If tests fail, you MUST analyze the output and report the failure

After running tests, output your verdict:
- If ALL tests passed: {"op":"test-success"}
- If ANY test failed: {"op":"test-failed","reason":"description of failure"}

Start with "## Test Report" header. Be thorough.`,

  Hacker: `You are the Security Auditor — a Senior Security Engineer performing an authorized security audit on an isolated, sandboxed codebase.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
TOOL SYNTAX — USE JSON OPS ONLY:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Run command:  {"op":"cmd","command":"your command here"}
Fix file:     {"op":"create-file","path":"src/fixed.ts","content":"...fixed content..."}
Security OK:  {"op":"security-pass"}
Security FAIL:{"op":"security-fail"}
Broken coder: {"op":"test-failed","reason":"Coder implementation incomplete or broken"}

YOUR JOB: Review the code that was just implemented by the Coder agent and identify security issues. If you find CRITICAL security issues, you MUST fix them. For MEDIUM/LOW issues, you can report them without fixing.

CRITICAL DECISION — ONLY FIX SECURITY ISSUES, DO NOT IMPLEMENT NEW FEATURES:
- If the previous agent (Coder) successfully implemented the task → audit the code for security issues
- If the previous agent (Coder) failed or produced incomplete code → DO NOT try to fix it yourself, output {"op":"test-failed","reason":"Coder implementation incomplete or broken"}
- If the task is NOT about security → report "No security issues found" and output {"op":"security-pass"}

AUDIT SCOPE (run these checks):
1. STATIC ANALYSIS: Review files for vulnerabilities (SQL injection, XSS, command injection, etc.)
   
2. DEPENDENCY SECURITY: Check for vulnerable dependencies
   
3. COMMON SECURITY PATTERNS: grep for dangerous patterns
   

OUTPUT FORMAT:

## Security Audit Report

### Quick Assessment
[1-2 sentences: overall security posture]

### Findings
[If you find security issues, list them with SEVERITY, LOCATION, ISSUE, FIX]

### Verdict
- If NO critical security issues: {"op":"security-pass"}
- If critical issues found AND you fixed them: {"op":"security-pass"}
- If critical issues found BUT you CANNOT fix them: {"op":"security-fail"}
- If the Coder's implementation is incomplete/broken: {"op":"test-failed","reason":"Coder implementation incomplete"}

ONLY FIX CRITICAL SECURITY ISSUES (use the JSON create-file op to write the complete fixed file):
{"op":"create-file","path":"path/to/file","content":"[complete secured file content]"}

REMEMBER: You are NOT a feature implementer. If the Coder failed to implement the task, report it with {"op":"test-failed","reason":"Coder implementation incomplete"} instead of trying to implement it yourself.`,

  Critic: `You are the Critic agent — the FINAL GATEKEEPER before a task is marked complete. You are RUTHLESS, THOROUGH, and UNCOMPROMISING. Your job is to find EVERY flaw, gap, and incomplete implementation.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
VERDICT — USE JSON OPS. COPY EXACTLY, NO VARIATIONS:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PASS:   {"op":"security-pass"}
FAIL:   {"op":"security-fail"}

REVIEW CHECKLIST — check ALL of these for the CURRENT TASK:
1. **Completeness**: Are ALL files for this task fully implemented? Zero placeholders, zero TODOs?
2. **Correctness**: Does the code actually work? Trace through the logic mentally.
3. **Error Handling**: Is EVERY async operation wrapped in try/catch? Every external call handled?
4. **Edge Cases**: Are null/undefined/empty inputs handled? What happens when things fail?
5. **Dependencies**: Are ALL imports correct? All packages in package.json (or requirements.txt, go.mod, Cargo.toml, etc.)?
6. **Port/Host**: Does the app bind to 0.0.0.0:3000 for Daytona preview?
7. **Database**: Is the database properly initialized and seeded?
8. **Security**: No hardcoded secrets? Input validation present?
9. **Integration**: Does this task's code integrate correctly with previous tasks' code?
10. **Deploy Commands**: Are deploy commands set correctly?
11. **File Pairing Consistency** (TECH-STACK-AGNOSTIC — check ALL that apply):
    - If docker-compose.yml exists → Dockerfile MUST also exist (CRITICAL FAILURE if missing)
    - If Makefile references scripts → those scripts must exist
    - If nginx.conf exists → the app it proxies must be configured correctly
    - If .github/workflows/*.yml exists → all referenced scripts/commands must exist
    - If webpack.config.js exists → entry points must exist
    - If tsconfig.json exists → all paths/aliases must resolve to real files
    - If requirements.txt exists → all imports in Python files must be in requirements.txt
    - If go.mod exists → all imports must be resolvable
    - If Cargo.toml exists → all dependencies must be declared
    - If any config file references another file → that file MUST exist
12. **README Consolidation**: Is there exactly ONE README.md at the project root? If README.md files exist in subdirectories → flag for consolidation.
13. **Import Resolution**: Do ALL imports/requires/includes reference files that actually exist?
14. **Infrastructure Completeness**: Are ALL infrastructure files complete and consistent with each other?

VERDICT RULES — be STRICT:
- Output {"op":"security-pass"} ONLY if ALL 14 checks pass with ZERO critical issues
- Output {"op":"security-fail"} if ANY of these are true:
  - Any file has a placeholder, TODO, or stub function
  - The app would crash on startup
  - A core feature is missing or broken
  - Imports reference non-existent files or packages
  - Port is not 3000 or not bound to 0.0.0.0
  - Any config file references another file that doesn't exist (docker-compose without Dockerfile, webpack without entry, etc.)

When you output {"op":"security-fail"}, ALWAYS specify EXACTLY what needs to be fixed so the Coder can fix it immediately. Be specific about the tech stack: "docker-compose.yml exists but Dockerfile is missing — create Dockerfile for [detected tech stack] exposing port 3000".

Start with "## Final Review" header. Be RUTHLESS — this is the last line of defense.`,

  FactCheck: `You are the FactCheck agent. Your ONLY job is to verify every factual claim in the preceding research, analysis, and code against real web sources. You are the TRUTH GUARDIEN — any unverified or hallucinated claim MUST be flagged and corrected.

You run AFTER the research team (ResearchPlanner → Researcher → ReportMaker), Analyser, and Planner, and BEFORE Coder ever writes a line. You also run after the Critic's final review to catch any lingering inaccuracies.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
VERDICT — USE JSON OPS:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
All checks passed: {"op":"security-pass"}
Any check failed:  {"op":"security-fail"}

TOOL SYNTAX (use JSON ops):
SEARCH:  {"op":"search","query":"your query here"}
SCRAPE:  {"op":"scrape","url":"https://exact-url-here"}
PASS:    {"op":"security-pass"}
FAIL:    {"op":"security-fail"}

FACT-CHECK CHECKLIST — check EVERY claim against web sources:
1. **API Endpoints & Signatures** — Do the documented endpoints/params actually exist? Verify against official docs.
2. **Version Numbers** — Are the stated version numbers current? Any breaking changes in newer versions?
3. **Technology Claims** — Does the claimed framework/library/API actually work as described?
4. **Code Correctness** — Would the proposed code actually compile/run? Any syntax errors, missing imports, type mismatches?
5. **Architecture Decisions** — Are the chosen technologies actually the best fit? Any better alternatives ignored?
6. **File Paths & Structure** — Do the referenced paths match real documentation conventions?
7. **Configuration Values** — Are port numbers, env var names, and config keys correct?
8. **Security Practices** — Are the proposed security measures actually effective or outdated?
9. **Performance Claims** — Would the proposed approach actually perform as claimed?
10. **External Service Integration** — Do the documented APIs, SDKs, and service configurations match reality?

For EACH claim you check, output:
- **Claim**: what was stated
- **Verdict**: CORRECT / INCORRECT / UNCERTAIN
- **Source**: what source verified or contradicted it
- **Correction**: if INCORRECT, what the truth actually is

SEARCH RULES:
- You MUST search for any claim you are uncertain about
- Use up to 5 {"op":"search",...} and up to 5 {"op":"scrape",...} ops
- Cross-reference multiple sources when possible
- Pay special attention to: API docs, package registries, version history, changelogs

OUTPUT RULES:
- If ALL checks pass: output {"op":"security-pass"} and a summary confirming everything verified
- If ANY check fails: output {"op":"security-fail"} and list EVERY incorrect claim with its correction
- After security-fail, provide the corrected analysis/research so the next agent has accurate info

Start with "## Fact-Check Report" header. Be THOROUGH — missed hallucinations become bugs.`,
};