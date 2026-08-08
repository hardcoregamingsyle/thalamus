// Structured-output parsers for pipeline agents. Interfaces for every op-type
// (FileOp/SearchOp/ScrapeOp/CmdOp/McpOp/InfoRequest/Instructions/ParsedOutput,
// PlannerTask/PlannerOutput) plus findJsonOps, parseAgentOutput,
// parsePlannerOutput and parseDifficultyFromPlannerOutput. Everything here is
// pure text→data — no Convex, no network — kept separate from agentCore.ts so
// the parser can be exercised by unit tests without pulling the whole router.

// Shared difficulty tag returned by parseDifficultyFromPlannerOutput.
export type TaskDifficulty = "normal" | "hard" | "extreme";

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
    if (end === -1) {
      // Unterminated op — the model's output got truncated mid-JSON (usually a
      // create-file whose content hit the token ceiling). Breaking here would
      // silently drop EVERY later op in the message (files AND commands). Skip
      // just this opener and keep scanning so siblings still run.
      i = start + startMarker.length;
      continue;
    }

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
