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
  // Additive: raw excerpts (truncated to 200 chars) of lines that clearly
  // intended to be JSON ops (`{"op":…` / `{ "op":…`) but failed to parse — most
  // commonly a create-file whose content string has unescaped double quotes.
  // Previously these were silently dropped, so the agent got no feedback and
  // repeated the mistake. Callers can surface these back to the agent as
  // "here is what you tried to send; it did not parse; fix it and retry".
  // Purely additive so every existing caller keeps working unchanged.
  malformedOps: string[];
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

/** Internal scanner: returns both successfully parsed ops and raw excerpts of
 *  ops that clearly INTENDED to be JSON (opener matched the `{"op":` shape) but
 *  failed to parse. Kept private; the exported `findJsonOps` preserves its old
 *  signature so existing callers remain unaffected. */
function findJsonOpsInternal(content: string): {
  ops: Array<Record<string, unknown>>;
  malformed: string[];
} {
  const ops: Array<Record<string, unknown>> = [];
  const malformed: string[] = [];
  const startMarker = '{"op":"';
  const MALFORMED_EXCERPT_MAX = 200;
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
      // Unterminated op — either the model's output got truncated mid-JSON, OR
      // the "content" string field is malformed (unescaped quotes) so the
      // brace/string tracker never returns to depth 0. Both cases used to be
      // silently dropped which starved the agent of feedback and let it repeat
      // the same broken emission forever. Capture a bounded excerpt so the
      // caller can surface it back to the agent as "you tried this, it did not
      // parse". Bound the excerpt at the earliest of: end-of-line, the NEXT
      // op's opener (so a following well-formed op is not swallowed into this
      // one's excerpt), or a hard 200-char cap.
      const eol = content.indexOf("\n", start);
      const nextOp = content.indexOf(startMarker, start + startMarker.length);
      let stop = Math.min(start + MALFORMED_EXCERPT_MAX, content.length);
      if (eol !== -1 && eol < stop) stop = eol;
      if (nextOp !== -1 && nextOp < stop) stop = nextOp;
      malformed.push(content.slice(start, stop).trimEnd());
      // Advance past the opener only — the sibling ops after us must still run.
      i = start + startMarker.length;
      continue;
    }

    const raw = content.slice(start, end);
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      if (typeof parsed.op === "string") {
        ops.push(parsed);
      } else {
        // Parsed as valid JSON but no string `op` field — treat as malformed so
        // the agent is told rather than silently ignored.
        malformed.push(raw.slice(0, MALFORMED_EXCERPT_MAX));
      }
    } catch {
      // Brace scan superficially balanced but not valid JSON — almost always
      // an unescaped `"` inside a `"content"` string. Deliberately do NOT try
      // to auto-repair: guessing where a content string ends is exactly how a
      // corrupted file gets silently written to disk. Report the failure and
      // let the agent fix its own emission on the next round.
      malformed.push(raw.slice(0, MALFORMED_EXCERPT_MAX));
    }

    i = end;
  }
  return { ops, malformed };
}

/** Scan content for balanced JSON objects starting with {"op":" and parse them.
 *  Kept for backward compatibility with existing external callers; new code in
 *  this module uses findJsonOpsInternal to also learn about malformed ops. */
export function findJsonOps(content: string): Array<Record<string, unknown>> {
  return findJsonOpsInternal(content).ops;
}

/** Strip LLM special-token wrappers that leak into raw output. Real production
 *  runs saw DeepSeek-family markers like `<｜｜DSML｜｜op>…</｜｜DSML｜｜op>`
 *  (fullwidth pipe U+FF5C) wrapping real ops. Left in place they (a) leak
 *  straight into the visible message and (b) sometimes prevent the JSON op
 *  inside them from being found. OpenAI-family control tokens show up the same
 *  way from other models — `<|im_start|>`, `<|eot_id|>`, `<|channel|>`.
 *
 *  Two deliberately different bounds:
 *   - FULLWIDTH pipe (U+FF5C): attributes allowed (`<｜｜DSML｜｜invoke
 *     name="cmd">` appeared in production). Safe because `<｜` never opens
 *     legitimate markup or code — the fullwidth pipe is exclusively a model
 *     special-token character.
 *   - ASCII pipe: body stays whitespace-free and 1–80 chars, because `<|` with
 *     spaces could in principle collide with real text; the known control
 *     tokens (`<|im_start|>` etc.) never contain spaces.
 *  Real code — `x < y`, `a || b`, `<div>`, `<https://…>` — never puts a pipe
 *  right after `<`, so neither branch can eat it. */
function stripSpecialTokenWrappers(content: string): string {
  return content
    .replace(/<\/?｜[^<>]{1,160}>/g, "")
    .replace(/<\/?\|[^\s<>]{1,80}>/g, "")
    // Models invent their own wrapper tags — production runs showed
    // `<json-op> [SEARCHING: …] </json-op>` around marker text (and sometimes
    // around real ops). The protocol is raw {"op":"..."} JSON and plain prose;
    // these tags are never instructions to the parser, they just leak into the
    // transcript looking like HTML. Stripping the tags (not their contents)
    // keeps the inner marker text visible and, if the model ever wraps a real
    // JSON op, lets findJsonOps still see it.
    .replace(/<\/?json-op>/gi, "");
}

/** Recover commands from DeepSeek's leaked tool-call syntax. Production runs
 *  showed the model sometimes emits its NATIVE function-call markup instead of
 *  a JSON op:
 *      <｜｜DSML｜｜invoke name="cmd"> <｜｜DSML｜｜parameter name="command"
 *      string="true">ls -la && find . -type f | sort
 *  Before this, the command was silently lost (the wrapper was stripped and no
 *  op parsed) and the agent looped re-asking for output that never came. The
 *  command text is extracted and queued as a real cmd op; the markup is
 *  replaced with the same visible `[CMD: …]` marker JSON ops get. Content runs
 *  until the next fullwidth-pipe tag or end of message, so commands containing
 *  `<` (heredocs, redirections) survive intact. */
function recoverDsmlCommands(
  content: string,
  cmdOps: CmdOp[],
): string {
  const paramCmdRe = /<｜[^<>]*parameter[^<>]*name="command"[^<>]*>([\s\S]*?)(?=<\/?｜|$)/g;
  return content.replace(paramCmdRe, (_whole, body: string) => {
    const command = body.trim();
    if (!command) return "";
    if (!cmdOps.some((c) => c.command === command)) {
      cmdOps.push({ command });
    }
    return `[CMD: ${command}]`;
  });
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
  const malformedOps: string[] = [];

  // Recover commands from leaked DSML tool-call markup FIRST (it needs the
  // wrapper tags intact to find the parameter boundaries), THEN strip the
  // remaining special-token wrappers so (a) a JSON op wrapped in `<｜…｜>`
  // still finds its opener and (b) no wrapper characters survive into
  // cleanContent. Legacy `<<TAG>>` markers use double angle brackets, so they
  // are unaffected by either pass.
  const recovered = recoverDsmlCommands(content, cmdOps);
  const stripped = stripSpecialTokenWrappers(recovered);
  let cleanContent = stripped;

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

  // Scan the wrapper-stripped text so ops previously trapped inside special
  // tokens are now visible, and so malformed excerpts we surface to the user
  // do not still carry the wrapper characters.
  const { ops: jsonOps, malformed: malformedRaws } = findJsonOpsInternal(stripped);
  // Substitute malformed op excerpts BEFORE the successful-op loop rewrites
  // adjacent text — the excerpt is a literal slice of the current cleanContent,
  // so replace() finds it now; once other ops rewrite chunks around it the
  // literal may no longer be present. Marker is deliberately visible in-line
  // so both the agent and the user can see that something was rejected.
  const MALFORMED_MARKER = "[MALFORMED OP — not executed]";
  for (const excerpt of malformedRaws) {
    malformedOps.push(excerpt);
    cleanContent = cleanContent.replace(excerpt, MALFORMED_MARKER);
  }
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
          // Show the whole command. It used to be cut at 80 chars, which sliced
          // pipelines mid-word ("… | he") and left the reader unable to tell
          // what actually ran — the opposite of what a transcript is for. Long
          // commands are rare and a wrapped line beats a lie.
          cleanContent = cleanContent.replace(raw, `[CMD: ${op.command}]`);
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

  return { fileOps, searchOps, scrapeOps, cmdOps, mcpOps, cleanContent, malformedOps, testerResult, testerFailReason, hackerResult, criticResult, deployCommands, infoRequest, instructions, changeMode, requestApiKey };
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
