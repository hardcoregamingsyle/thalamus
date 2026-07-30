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
import { callNim, agentToTaskType, NIM_DEFAULT_CHAT_MODEL, calcNimAgentBucks } from "./nimClient";
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
  // Extract ctx and optional assignedModel override from _extra
  let ctx: { runQuery: ActionCtx["runQuery"] } | undefined;
  let assignedModel: string | undefined;
  for (const arg of _extra) {
    if (arg && typeof arg === "object" && "runQuery" in (arg as Record<string,unknown>)) {
      ctx = arg as { runQuery: ActionCtx["runQuery"] };
    }
    if (arg && typeof arg === "object" && "assignedModel" in (arg as Record<string,unknown>)) {
      const maybe = (arg as Record<string,unknown>).assignedModel;
      if (typeof maybe === "string" && maybe) assignedModel = maybe;
    }
  }

  const taskType: TaskType = agentToTaskType(modelId);

  if (ctx) {
    // Modal first when an admin has registered an endpoint. Which endpoint is
    // decided by data (the isPrimary row comes back first), not by this code —
    // so swapping the primary model is a click in /admin, not a deploy. Falls
    // through to NIM → Ollama when nothing is registered or every endpoint errors.
    try {
      const result = await callModal(ctx, prompt, systemPrompt);
      return { text: result.text, inputTokens: result.inputTokens, outputTokens: result.outputTokens, tier: `modal:${result.model}` };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!msg.includes("MODAL_NOT_CONFIGURED")) {
        console.warn("Modal call failed, falling back to NIM:", msg);
      }
    }

    try {
      const nimModel = assignedModel
        ?? (taskType === "dispatcher" ? "meta/llama-3.2-3b-instruct"
          : taskType === "code" ? "meta/llama-3.1-8b-instruct"
          : taskType === "reasoning" ? "nvidia/nemotron-3-super-120b-a12b"
          : taskType === "agent" ? "deepseek-ai/deepseek-v4-pro"
          : taskType === "factcheck" ? "moonshotai/kimi-k2-instruct"
          : NIM_DEFAULT_CHAT_MODEL);

      const result = await callNim(ctx, prompt, systemPrompt, nimModel);
      return { text: result.text, inputTokens: result.inputTokens, outputTokens: result.outputTokens, tier: `nim:${result.model}` };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("NVIDIA_NIM_NOT_CONFIGURED")) {
        console.warn("NIM not configured — falling back to Ollama Cloud");
      } else {
        console.warn(`NIM call failed, falling back to Ollama:`, msg);
      }
    }
  }

  const ollamaModel = mapModelIdToOllama(modelId);
  try {
    const result = await callSiliconFlow(prompt, systemPrompt, ollamaModel, 16384, undefined, ctx?.runQuery);
    return { text: result.text, inputTokens: result.inputTokens, outputTokens: result.outputTokens, tier: `ollama:${result.model}` };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("not configured")) {
      throw new Error("No AI provider configured — add NIM keys via /admin (primary) or Ollama keys (backup)");
    }
    throw err;
  }
}

function mapModelIdToOllama(modelId: string): string {
  const l = modelId.toLowerCase();
  if (l.includes("dispatcher") || l.includes("organiser") || l.includes("organizer") || l.includes("summarizer")) return "gemma4:31b";
  if (l.includes("coder") || l.includes("optimiser") || l.includes("architect")) return "minimax-m3";
  if (l.includes("analyser") || l.includes("planner") || l.includes("critic") || l.includes("reasoning")) return "minimax-m3";
  if (l.includes("researcher") || l.includes("research") || l.includes("scout")) return "gpt-oss:120b";
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
  cleanContent: string;
  testerResult?: "pass" | "fail";
  testerFailReason?: string;
  hackerResult?: "pass" | "fail";
  criticResult?: "pass" | "fail";
  deployCommands?: string[];
  infoRequest?: InfoRequest;
  instructions?: Instructions;
  changeMode?: "Code" | "Chat" | "Minor"; // AI-requested mode switch
}

// Agents "call tools" by emitting inline <<TAG>> markers in their text output
// (there is no native tool-use API in this path). This parser extracts every
// operation and replaces each marker in cleanContent with a human-readable
// placeholder, because cleanContent is what gets stored and shown in the chat
// UI — raw markers (which can embed entire file bodies) must never reach it.
export function parseAgentOutput(content: string): ParsedOutput {
  const fileOps: FileOp[] = [];
  const searchOps: SearchOp[] = [];
  const scrapeOps: ScrapeOp[] = [];
  const cmdOps: CmdOp[] = [];
  let cleanContent = content;

  // Support both <<TAG>> (new) and <<<<<TAG>>>>> (legacy) formats
  const createRegex = /(?:<<<<<|<<)CREATEFILE="([^"]+)"(?:>>>>>|>>)([\s\S]*?)(?:<<<<<|<<)END\.CREATEFILE(?:>>>>>|>>)/g;
  let match;
  while ((match = createRegex.exec(content)) !== null) {
    fileOps.push({ type: "create", filepath: match[1], content: match[2].trim() });
    cleanContent = cleanContent.replace(match[0], `[FILE CREATED: ${match[1]}]`);
  }

  // Intentional: EDITFILE blocks close with END.CREATEFILE — that is the tag
  // the agent prompts specify for both block types. Do not "fix" to END.EDITFILE.
  const editRegex = /(?:<<<<<|<<)EDITFILE="([^"]+)"(?:>>>>>|>>)([\s\S]*?)(?:<<<<<|<<)END\.CREATEFILE(?:>>>>>|>>)/g;
  while ((match = editRegex.exec(content)) !== null) {
    fileOps.push({ type: "edit", filepath: match[1], content: match[2].trim() });
    cleanContent = cleanContent.replace(match[0], `[FILE EDITED: ${match[1]}]`);
  }

  for (const m of content.matchAll(/(?:<<<<<|<<)DELETE="([^"]+)"(?:>>>>>|>>)/g)) {
    fileOps.push({ type: "delete", filepath: m[1] });
    cleanContent = cleanContent.replace(m[0], `[FILE DELETED: ${m[1]}]`);
  }

  // These args are free-form and may contain double quotes — a shell command
  // like node -e 'console.log("ok")', a search query, a URL with a quoted
  // fragment. `(?:[^"]|"(?!>>))*` accepts any char (newlines included, so
  // multi-line values still work) plus any quote NOT immediately followed by
  // `>>`, terminating precisely at the closing `">>`. The old [^"]+ died at the
  // first inner quote and silently dropped the whole marker.
  for (const m of content.matchAll(/(?:<<<<<|<<)SEARCH-TOOL="((?:[^"]|"(?!>>))*)"(?:>>>>>|>>)/g)) {
    searchOps.push({ query: m[1] });
    cleanContent = cleanContent.replace(m[0], `[SEARCHING: ${m[1]}]`);
  }

  for (const m of content.matchAll(/(?:<<<<<|<<)SCRAPE-URL="((?:[^"]|"(?!>>))*)"(?:>>>>>|>>)/g)) {
    scrapeOps.push({ url: m[1] });
    cleanContent = cleanContent.replace(m[0], `[SCRAPING: ${m[1]}]`);
  }

  for (const m of content.matchAll(/(?:<<<<<|<<)RUN-CMD="((?:[^"]|"(?!>>))*)"(?:>>>>>|>>)/g)) {
    cmdOps.push({ command: m[1] });
    cleanContent = cleanContent.replace(m[0], `[CMD: ${m[1]}]`);
  }

  let testerResult: "pass" | "fail" | undefined;
  let testerFailReason: string | undefined;
  if (content.includes("<<test.success>>") || content.includes("<<<<<test.success>>>>>")) {
    testerResult = "pass";
    cleanContent = cleanContent.replace(/(?:<<<<<|<<)test\.success(?:>>>>>|>>)/g, "[TEST: PASSED ✓]");
  }
  const testerFailMatch = content.match(/(?:<<<<<|<<)test\.failed="([^"]*)"(?:>>>>>|>>)/);
  if (testerFailMatch) {
    testerResult = "fail";
    testerFailReason = testerFailMatch[1];
    cleanContent = cleanContent.replace(testerFailMatch[0], `[TEST: FAILED - ${testerFailReason}]`);
  }

  // Hacker and Critic share the same <<pass>>/<<Fail>> markers, so both results
  // are derived from one scan. A fail marker anywhere overrides a pass marker —
  // agents sometimes emit both when quoting their own instructions.
  let hackerResult: "pass" | "fail" | undefined;
  const hasPass = content.match(/(?:<<<<<|<<)pass(?:>>>>>|>>)/i);
  const hasFail = content.match(/(?:<<<<<|<<)[Ff]ail(?:>>>>>|>>)/);
  if (hasPass && !hasFail) {
    hackerResult = "pass";
    cleanContent = cleanContent.replace(/(?:<<<<<|<<)pass(?:>>>>>|>>)/gi, "[SECURITY: PASSED ✓]");
  } else if (hasFail) {
    hackerResult = "fail";
    cleanContent = cleanContent.replace(/(?:<<<<<|<<)[Ff]ail(?:>>>>>|>>)/g, "[SECURITY: FAILED]");
  }

  let criticResult: "pass" | "fail" | undefined;
  if (hasPass && !hasFail) criticResult = "pass";
  else if (hasFail) criticResult = "fail";

  // Parse DEPLOY-COMMANDS block
  let deployCommands: string[] | undefined;
  const deployBlockMatch = content.match(/(?:<<<<<|<<)DEPLOY-COMMANDS(?:>>>>>|>>)([\s\S]*?)(?:<<<<<|<<)END\.DEPLOY-COMMANDS?(?:>>>>>|>>)/);
  if (deployBlockMatch) {
    const block = deployBlockMatch[1];
    // Commands may be newline-separated or all on one line
    const rawLines = block.includes("\n")
      ? block.split("\n")
      : block.trim().split(/\s+(?=npm\s|node\s|yarn\s|pnpm\s|bun\s|sh\s|bash\s)/);
    const cmds = rawLines
      .map(line => line.trim())
      .filter(line => line.length > 0)
      .map(line => {
        if ((line.startsWith('"') && line.endsWith('"')) || (line.startsWith("'") && line.endsWith("'"))) {
          return line.slice(1, -1);
        }
        return line;
      })
      .filter(line => line.length > 0);
    if (cmds.length > 0) deployCommands = cmds;
    cleanContent = cleanContent.replace(deployBlockMatch[0], `[DEPLOY COMMANDS SET: ${cmds.length} command(s)]`);
  }

  // Parse GET-INFO block
  let infoRequest: InfoRequest | undefined;
  const infoBlockMatch = content.match(/(?:<<<<<|<<)GET-INFO(?:>>>>>|>>)([\s\S]*?)(?:<<<<<|<<)END\.GET-INFO(?:>>>>>|>>)/);
  if (infoBlockMatch) {
    try {
      const block = infoBlockMatch[1].trim();
      // Try to parse as JSON first
      const parsed = JSON.parse(block) as InfoRequest;
      if (parsed.fields && Array.isArray(parsed.fields)) {
        infoRequest = parsed;
      }
    } catch {
      // Fallback: parse simple key=value format
      const titleMatch = infoBlockMatch[1].match(/title="([^"]+)"/);
      const descMatch = infoBlockMatch[1].match(/description="([^"]+)"/);
      const fieldMatches = [...infoBlockMatch[1].matchAll(/field\s+name="([^"]+)"\s+label="([^"]+)"(?:\s+type="([^"]+)")?(?:\s+required="([^"]+)")?(?:\s+placeholder="([^"]+)")?/g)];
      if (fieldMatches.length > 0) {
        infoRequest = {
          agentName: "Agent",
          title: titleMatch?.[1] ?? "Information Required",
          description: descMatch?.[1] ?? "Please provide the following information to continue.",
          fields: fieldMatches.map(m => ({
            name: m[1],
            label: m[2],
            type: (m[3] as "text" | "password" | "textarea") ?? "text",
            required: m[4] !== "false",
            placeholder: m[5],
          })),
        };
      }
    }
    if (infoRequest) {
      cleanContent = cleanContent.replace(infoBlockMatch[0], `[INFO REQUESTED: ${infoRequest.title}]`);
    }
  }

  // Parse INSTRUCTIONS block
  let instructions: Instructions | undefined;
  const instructionsBlockMatch = content.match(/(?:<<<<<|<<)INSTRUCTIONS(?:>>>>>|>>)([\s\S]*?)(?:<<<<<|<<)END\.INSTRUCTIONS(?:>>>>>|>>)/);
  if (instructionsBlockMatch) {
    try {
      const block = instructionsBlockMatch[1].trim();
      const parsed = JSON.parse(block) as Instructions;
      if (parsed.steps && Array.isArray(parsed.steps)) {
        instructions = parsed;
      }
    } catch {
      // Ignore parse errors
    }
    if (instructions) {
      cleanContent = cleanContent.replace(instructionsBlockMatch[0], `[INSTRUCTIONS PROVIDED: ${instructions.title}]`);
    }
  }

  // Parse CHANGE_MODE directive
  let changeMode: "Code" | "Chat" | "Minor" | undefined;
  const changeModeMatch = content.match(/<<CHANGE_MODE=(Code|Chat|Minor)>>/i);
  if (changeModeMatch) {
    changeMode = changeModeMatch[1] as "Code" | "Chat" | "Minor";
    cleanContent = cleanContent.replace(changeModeMatch[0], `[MODE SWITCH REQUESTED: ${changeMode}]`);
  }

  // Final sweep: neutralise any sentinel the rules above did not consume.
  //
  // Every handler here matches a COMPLETE, well-formed pair, so anything the
  // model half-emits survives untouched — an orphan <<END.CREATEFILE>> from a
  // truncated block, an <<END.MCP-CALL>> whose opener was malformed (MCP is
  // parsed in mcpParse.ts and unknown to this function), <<REQUEST-API-KEY …>>,
  // or a <<RUN-COMMAND=…>> alias. Those went to the transcript verbatim, and
  // the desktop app strips nothing of its own, so they reached the .exe too.
  //
  // Angle brackets are swapped for lookalikes rather than deleted: the text
  // stays readable and honest about what the model wrote, and a leftover can
  // never be re-parsed as a live directive on a later pass.
  cleanContent = cleanContent.replace(/<<([^<>]{0,200}?)>>/g, "‹‹$1››");

  return { fileOps, searchOps, scrapeOps, cmdOps, cleanContent, testerResult, testerFailReason, hackerResult, criticResult, deployCommands, infoRequest, instructions, changeMode };
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
// - Tool calls are inline <<TAG>> markers (see parseAgentOutput) — the prompts
//   and the parser regexes must stay in lockstep.
// - Each agent starts its report with a fixed "## Header" line so the UI can
//   group and label output per stage.
// - Verdict agents (Tester/Hacker/Critic) signal via <<test.success>>,
//   <<test.failed="...">> and <<pass>>/<<Fail>>, which gate pipeline retries.
export const AGENT_SYSTEM_PROMPTS: Record<string, string> = {
  // ── Dispatcher ────────────────────────────────────────────────────────────
  // Runs ONCE before the pipeline to decide which agents are actually needed.
  // Output is a JSON array of agent names from the approved set.
  Dispatcher: `You are the Pipeline Dispatcher for an AI coding system. Your ONLY job is to analyse the user's task and decide the minimum set of agents needed to complete it well.

Available agents (in pipeline order):
- Researcher   — web search, docs, API reference lookup
- FactCheck    — verifies every claim against web sources, catches hallucinations
- Analyser     — architecture analysis, deep tech breakdown
- Planner      — task decomposition into atomic steps
- Coder        — writes production-ready code (ALWAYS required)
- Optimiser    — performance and code quality improvements
- Organizer    — documentation, README, file structure cleanup
- Tester       — writes and evaluates tests
- Hacker       — dedicated security/penetration testing (only when explicitly asked)
- Critic       — final quality gate, rejects bad output (ALWAYS required)

RULES:
1. Coder and Critic are ALWAYS included.
2. When Researcher is included, FactCheck MUST also be included.
3. Include Researcher ONLY if the task needs current docs, third-party APIs, or info not in the codebase.
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
- Research  (third-party API, new library, external docs needed): add Researcher + FactCheck to any of the above
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

  Researcher: `You are the Researcher agent — the FIRST agent in the pipeline. Your job is to gather COMPREHENSIVE, DEEP, EXHAUSTIVE information before any code is written.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
TOOL SYNTAX — COPY THESE EXACTLY, CHARACTER-FOR-CHARACTER.
DO NOT INVENT VARIATIONS. DO NOT USE MARKDOWN. DO NOT PARAPHRASE.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

SEARCH:   <<SEARCH-TOOL="your query here">>
SCRAPE:   <<SCRAPE-URL="https://exact-url-here">>

WRONG (never do these):
  ✗ <<SEARCH: "query">>          ✗ [SEARCH: query]
  ✗ search("query")              ✗ <<search tool="query">>
  ✗ <<SCRAPE: "url">>            ✗ Describing the action in text

You can scrape URLs (use up to 5):
<<SCRAPE-URL="https://example.com/docs">>

You can search (use up to 5):
<<SEARCH-TOOL="search query">>

RESEARCH STRATEGY — Be EXHAUSTIVE. Use ALL your search and scrape slots:
1. Identify ALL technologies, libraries, APIs, frameworks in the task
2. Scrape official documentation for the most critical ones
3. Search for: latest versions, breaking changes, best practices, known issues
4. Research deployment requirements, environment setup, security considerations
5. Find code examples, tutorials, gotchas
6. Look for performance benchmarks, scalability patterns
7. Research testing strategies for the specific tech stack
8. Find GitHub repos, community resources, Stack Overflow answers
9. Research common failure modes and how to avoid them
10. Look for migration guides if upgrading existing systems

CRITICAL: Do NOT be conservative. Research EVERYTHING that could possibly be relevant. Use all 5 searches and all 5 scrapes.

Start with "## Research Report" header. Be thorough — 1000-2000 words minimum. Include specific version numbers, API endpoints, configuration options, code examples.`,

  Analyser: `You are the Analyser agent. Your job is to produce a COMPREHENSIVE, EXTREMELY DETAILED analysis and architecture plan.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
TOOL SYNTAX — COPY EXACTLY IF NEEDED.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SEARCH:   <<SEARCH-TOOL="your query here">>

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
<<SEARCH-TOOL="what to search for">>

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

Create/Edit files using these tags:
<<CREATEFILE="path">> content <<END.CREATEFILE>>
<<EDITFILE="path">> content <<END.CREATEFILE>>
<<DELETE="path">>
<<RUN-CMD="command">>

CRITICAL COMMAND RULE — IMPORTANT: Only commands wrapped in <<RUN-CMD="...">> execute. Writing bare shell commands like 'cat', 'ls', 'npm install', 'grep', etc. in plain text will NOT run them — they are silently ignored. Every command MUST use the correct syntax.

CORRECT: <<RUN-CMD="npm install 2>&1">>
CORRECT: <<RUN-CMD="ls -la src/">>
WRONG: run 'npm install'
WRONG: cat package.json
WRONG: backtick-code-block npm test

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

If implementing a task that builds on previous work, EXTEND existing files — don't rewrite.`,

  Optimiser: `You are the Optimiser agent. Your job is to do a DEEP, EXHAUSTIVE review and improvement of ALL code for performance, efficiency, security, and best practices.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
TOOL SYNTAX — USE THESE EXACTLY TO APPLY FIXES:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
<<CREATEFILE="path/to/file.ext">>
[complete optimised file content]
<<END.CREATEFILE>>

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
<<CREATEFILE="path/to/file.ts">>
optimised content
<<END.CREATEFILE>>

Start with "## Optimisation Report" header. Be EXHAUSTIVE — check every file, every function.`,

  Organizer: `You are the Organizer agent. Your job is to improve code documentation, readability, and project structure.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
TOOL SYNTAX — USE THESE EXACTLY TO APPLY CHANGES:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
<<CREATEFILE="path/to/file.ext">>
[complete file content]
<<END.CREATEFILE>>

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

Use the file creation format for any changes:
<<CREATEFILE="README.md">>
# Project Name
...
<<END.CREATEFILE>>

Start with "## Organisation Report" header.`,

  Tester: `You are the Tester agent. Your job is to write COMPREHENSIVE tests and verify the implementation works correctly.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
TOOL SYNTAX — COPY EXACTLY. WRONG SYNTAX = BROKEN PIPELINE.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
RUN COMMAND:    <<RUN-CMD="command">>
CREATE FILE:    <<CREATEFILE="path">> ... <<END.CREATEFILE>>
TEST PASSED:    <<test.success>>
TEST FAILED:    <<test.failed="reason here">>

WRONG:  <<RUN: "cmd">>  /  <<test: success>>  /  [RUN-CMD: cmd]  /  run("cmd")

TESTING REQUIREMENTS — cover ALL of these:
1. Unit tests for ALL functions and methods
2. Integration tests for ALL API endpoints
3. Edge case testing (null, empty, boundary values)
4. Error handling tests (what happens when things fail)
5. Performance tests where relevant
6. Security tests (injection, auth bypass attempts)

INFRASTRUCTURE CONSISTENCY CHECKS — MANDATORY (run these BEFORE writing tests):
<<RUN-CMD="ls -la 2>&1 | head -40">>
<<RUN-CMD="cat package.json 2>&1 || cat requirements.txt 2>&1 || cat go.mod 2>&1 || echo 'No package file found'">>

INFRASTRUCTURE RULES — FAIL if any of these are violated (TECH-STACK-AGNOSTIC):
- If docker-compose.yml exists but Dockerfile does NOT → <<test.failed="docker-compose.yml exists but Dockerfile is missing — the container cannot be built">>
- If Makefile references a script that doesn't exist → <<test.failed="Makefile references missing script">>
- If nginx.conf exists but the upstream app config is missing → <<test.failed="nginx.conf references missing upstream configuration">>
- If webpack.config.js exists but the entry point file doesn't exist → <<test.failed="webpack entry point file is missing">>
- If tsconfig.json has path aliases that point to non-existent directories → <<test.failed="tsconfig path alias points to missing directory">>
- If any import/require/include references a file that doesn't exist → <<test.failed="broken import: [file] does not exist">>
- If package.json references scripts that don't exist → <<test.failed="package.json script references missing file">>
- If multiple README.md files exist in subdirectories → flag them for consolidation into root README.md
- If .env.example exists but .env doesn't → create .env from .env.example with sensible defaults

Use the file creation format for test files:
<<CREATEFILE="tests/unit.test.ts">>
test content
<<END.CREATEFILE>>

**RUN THE TESTS - MANDATORY**:
1. Install dependencies:
   <<RUN-CMD="npm install 2>&1 | tail -20">>

2. Run the test suite:
   <<RUN-CMD="npm test 2>&1">>

3. If tests fail, you MUST analyze the output and report the failure

After running tests, output your verdict:
- If ALL tests passed: <<test.success>>
- If ANY test failed: <<test.failed="description of failure">>

Start with "## Test Report" header. Be thorough.`,

  Hacker: `You are the Security Auditor — a Senior Security Engineer performing an authorized security audit on an isolated, sandboxed codebase.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
TOOL SYNTAX — USE THESE EXACTLY:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
RUN COMMAND:    <<RUN-CMD="command">>
FIX FILE:       <<CREATEFILE="path">> ... <<END.CREATEFILE>>
PASS:           <<pass>>
FAIL:           <<Fail>>
BROKEN CODER:   <<test.failed="reason">>

YOUR JOB: Review the code that was just implemented by the Coder agent and identify security issues. If you find CRITICAL security issues, you MUST fix them. For MEDIUM/LOW issues, you can report them without fixing.

CRITICAL DECISION — ONLY FIX SECURITY ISSUES, DO NOT IMPLEMENT NEW FEATURES:
- If the previous agent (Coder) successfully implemented the task → audit the code for security issues
- If the previous agent (Coder) failed or produced incomplete code → DO NOT try to fix it yourself, output <<test.failed="Coder implementation incomplete or broken">>
- If the task is NOT about security → report "No security issues found" and output <<pass>>

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
- If NO critical security issues: <<pass>>
- If critical issues found AND you fixed them: <<pass>>
- If critical issues found BUT you CANNOT fix them: <<Fail>>
- If the Coder's implementation is incomplete/broken: <<test.failed="Coder implementation incomplete">>

ONLY FIX CRITICAL SECURITY ISSUES (use <<CREATEFILE>> to write the complete fixed file):
<<CREATEFILE="path/to/file">>
[complete secured file content]
<<END.CREATEFILE>>

REMEMBER: You are NOT a feature implementer. If the Coder failed to implement the task, report it as <<test.failed>> instead of trying to implement it yourself.`,

  Critic: `You are the Critic agent — the FINAL GATEKEEPER before a task is marked complete. You are RUTHLESS, THOROUGH, and UNCOMPROMISING. Your job is to find EVERY flaw, gap, and incomplete implementation.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
VERDICT TAGS — COPY EXACTLY, NO VARIATIONS:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PASS:   <<pass>>
FAIL:   <<Fail>>

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
- Output <<pass>> ONLY if ALL 14 checks pass with ZERO critical issues
- Output <<Fail>> if ANY of these are true:
  - Any file has a placeholder, TODO, or stub function
  - The app would crash on startup
  - A core feature is missing or broken
  - Imports reference non-existent files or packages
  - Port is not 3000 or not bound to 0.0.0.0
  - Any config file references another file that doesn't exist (docker-compose without Dockerfile, webpack without entry, etc.)

When you output <<Fail>>, ALWAYS specify EXACTLY what needs to be fixed so the Coder can fix it immediately. Be specific about the tech stack: "docker-compose.yml exists but Dockerfile is missing — create Dockerfile for [detected tech stack] exposing port 3000".

Start with "## Final Review" header. Be RUTHLESS — this is the last line of defense.`,

  FactCheck: `You are the FactCheck agent. Your ONLY job is to verify every factual claim in the preceding research, analysis, and code against real web sources. You are the TRUTH GUARDIEN — any unverified or hallucinated claim MUST be flagged and corrected.

You run AFTER the Researcher, Analyser, and Planner, and BEFORE Coder ever writes a line. You also run after the Critic's final review to catch any lingering inaccuracies.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
VERDICT TAGS — COPY EXACTLY, NO VARIATIONS:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PASS:   <<pass>>
FAIL:   <<Fail>>

TOOL SYNTAX:
SEARCH:   <<SEARCH-TOOL="your query here">>
SCRAPE:   <<SCRAPE-URL="https://exact-url-here">>

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
- Use up to 5 <<SEARCH-TOOL>> tags and up to 5 <<SCRAPE-URL>> tags
- Cross-reference multiple sources when possible
- Pay special attention to: API docs, package registries, version history, changelogs

OUTPUT RULES:
- If ALL checks pass: output <<pass>> and a summary confirming everything verified
- If ANY check fails: output <<Fail>> and list EVERY incorrect claim with its correction
- After <<Fail>>, provide the corrected analysis/research so the next agent has accurate info

Start with "## Fact-Check Report" header. Be THOROUGH — missed hallucinations become bugs.`,
};