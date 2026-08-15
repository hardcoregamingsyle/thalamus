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
export interface ResearchOp { query: string; detail?: string; }
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
  // True when the agent ended its reply with {"op":"continue"} — the pipeline
  // re-runs the SAME agent instead of advancing, so a file too large for one
  // response can be written across multiple turns (each turn's file ops are
  // applied before the next begins). Bounded by the pipeline's
  // continue-count cap so a model stuck emitting continue can't run forever.
  continueRequested: boolean;
  // Additive: raw excerpts (truncated to 200 chars) of lines that clearly
  // intended to be JSON ops (`{"op":…` / `{ "op":…`) but failed to parse — most
  // commonly a create-file whose content string has unescaped double quotes.
  // Previously these were silently dropped, so the agent got no feedback and
  // repeated the mistake. Callers can surface these back to the agent as
  // "here is what you tried to send; it did not parse; fix it and retry".
  // Purely additive so every existing caller keeps working unchanged.
  malformedOps: string[];
  // The Coder-invoked research team: {"op":"research","query":"...","detail":"..."}
  // asks the Researcher→ReportMaker pair to gather and synthesize, and the
  // report comes back into the agent's next turn (see the pipeline).
  researchOps: ResearchOp[];
  testerResult?: "pass" | "fail";
  testerFailReason?: string;
  hackerResult?: "pass" | "fail";
  criticResult?: "pass" | "fail";
  deployCommands?: string[];
  infoRequest?: InfoRequest;
  instructions?: Instructions;
  changeMode?: "Code" | "Chat" | "Minor";
  requestApiKey?: { name: string; description: string; howToGet: string };
  // KnowItAll's hand-off op: {"op":"dispatch","reason":"..."} — the answering
  // agent found a problem or bug that needs the real build pipeline, so the
  // pipeline re-runs the Dispatcher (with the reason in the transcript) to set
  // up the fix instead of completing the run.
  dispatchRequested: boolean;
  dispatchReason?: string;
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
//   {"op":"continue"}   — ask the pipeline for another turn of the SAME agent
//   {"op":"dispatch","reason":"..."} — KnowItAll found a problem/bug; re-run the
//                                      Dispatcher to set up the build pipeline
//
// The parser finds these by scanning for `{"op":"` (whitespace around `:` and
// inside the braces tolerated — models add spaces freely) and reading the
// balanced {}. Multi-line content (file bodies) uses \n escapes inside the JSON
// string.
//
// PREFERRED FORMAT — one pure JSON DOCUMENT per message, no HTML-style tags:
//   {"message":"visible prose","ops":[{"op":"create-file","path":"x","content":"<p>hi</p>"}]}
// Every agent reply is a single JSON object with an optional "message" (or
// "review") field and an "ops" array. The document path is tried first; the
// inline-op scanner below remains the fallback for models that ignore the
// format, and for output truncated at the token limit.
//
// Legacy <<TAG>> markers (<<RUN-CMD="...">>, <<CREATEFILE="...">>, etc.) are
// still parsed as a silent backward-compatibility fallback ONLY — agents are
// no longer taught them, and file bodies now live in JSON string "content"
// fields.

/** One op that clearly INTENDED to be JSON (opener matched the `{"op":` shape)
 *  but failed to parse. `unterminated` true = the brace/string walk ran off the
 *  end of the content (output genuinely cut off — a continuation can still
 *  stitch it); false = the walk found a balanced close but JSON.parse rejected
 *  it (almost always an unescaped `"` inside "content" — continuing can never
 *  fix that, the agent must re-emit). The pipeline keys its continuation
 *  decision off this flag. */
export interface MalformedOpExcerpt {
  raw: string;
  unterminated: boolean;
}

/** Opener shape tolerated: `{"op":"`, `{"op": "`, `{ "op" : "`. Production
 *  output shows models inserting spaces (`{"op": "search"...}`); the old exact
 *  `{"op":"` scan silently ignored every spaced variant. */
const JSON_OP_OPEN_RE = /\{\s*"op"\s*:\s*"/g;

/** Internal scanner: returns both successfully parsed ops and raw excerpts of
 *  ops that clearly INTENDED to be JSON (opener matched the {"op": shape) but
 *  failed to parse. Kept exported for the pipeline's continuation decision (a
 *  truncated op can be stitched, a corrupted one cannot) and the unit tests;
 *  the exported `findJsonOps` preserves its old signature so existing callers
 *  remain unaffected. */
export function findJsonOpsInternal(content: string): {
  ops: Array<Record<string, unknown>>;
  malformed: MalformedOpExcerpt[];
} {
  const ops: Array<Record<string, unknown>> = [];
  const malformed: MalformedOpExcerpt[] = [];
  const MALFORMED_EXCERPT_MAX = 200;
  let i = 0;
  while (true) {
    JSON_OP_OPEN_RE.lastIndex = i;
    const open = JSON_OP_OPEN_RE.exec(content);
    if (!open) break;
    const start = open.index;
    const afterOpener = JSON_OP_OPEN_RE.lastIndex;

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
      JSON_OP_OPEN_RE.lastIndex = afterOpener;
      const nextOpen = JSON_OP_OPEN_RE.exec(content);
      const nextOp = nextOpen ? nextOpen.index : -1;
      let stop = Math.min(start + MALFORMED_EXCERPT_MAX, content.length);
      if (eol !== -1 && eol < stop) stop = eol;
      if (nextOp !== -1 && nextOp < stop) stop = nextOp;
      malformed.push({ raw: content.slice(start, stop).trimEnd(), unterminated: true });
      // Advance past the opener only — the sibling ops after us must still run.
      i = afterOpener;
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
        malformed.push({ raw: raw.slice(0, MALFORMED_EXCERPT_MAX), unterminated: false });
      }
    } catch {
      // Brace scan superficially balanced but not valid JSON — almost always
      // an unescaped `"` inside a `"content"` string. Deliberately do NOT try
      // to auto-repair: guessing where a content string ends is exactly how a
      // corrupted file gets silently written to disk. Report the failure and
      // let the agent fix its own emission on the next round.
      malformed.push({ raw: raw.slice(0, MALFORMED_EXCERPT_MAX), unterminated: false });
    }

    i = end;
  }
  return { ops, malformed };
}

/** Scan content for balanced JSON objects starting with {"op": and parse them.
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

/** True when the stripped text is one pure-JSON agent document of the shape
 *  {"message"|"review": string, "ops": [op, ...]}. Document mode is the
 *  canonical output format — every agent reply is a single JSON object, so
 *  nothing HTML-tag-like ever appears in the transcript. Returns the parsed
 *  doc fields when it matches, null otherwise (the inline-op scanner takes
 *  over as the fallback).
 *
 *  "ops" entries may be op objects, or the transcript MARKER strings agents
 *  keep echoing back ([SECURITY: FAILED], [TEST: PASSED ✓], ...) — a model
 *  that copies the marker it read in history instead of re-emitting the op.
 *  Markers are mapped back to the verdict ops so the pipeline still advances
 *  correctly, and one level of array nesting ([[...]]) is flattened for the
 *  same reason. */
export function tryParseAgentDoc(
  content: string,
): { ops: Array<Record<string, unknown>>; message: string } | null {
  const trimmed = content
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/, "")
    .trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) return null;
  let doc: Record<string, unknown>;
  try {
    doc = JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (!Array.isArray(doc.ops) || doc.ops.length === 0) return null;
  const ops: Array<Record<string, unknown>> = [];
  for (const entry of doc.ops) {
    if (entry && typeof entry === "object" && !Array.isArray(entry) && typeof (entry as Record<string, unknown>).op === "string") {
      ops.push(entry as Record<string, unknown>);
      continue;
    }
    const verdict = markerToVerdictOp(entry);
    if (verdict) ops.push(verdict);
  }
  if (ops.length === 0) return null;
  const message =
    typeof doc.message === "string" ? doc.message
    : typeof doc.review === "string" ? doc.review
    : "";
  return { ops, message };
}

const MARKER_VERDICT_OPS: Record<string, Record<string, unknown>> = {
  "[SECURITY: PASSED ✓]": { op: "security-pass" },
  "[SECURITY: FAILED]": { op: "security-fail" },
  "[TEST: PASSED ✓]": { op: "test-success" },
};

/** Map a transcript marker string (or one-level nested array of one) back to
 *  the verdict op it stands for. Null when the value is not a known marker. */
function markerToVerdictOp(value: unknown): Record<string, unknown> | null {
  if (Array.isArray(value)) {
    if (value.length === 0) return null;
    return markerToVerdictOp(value[0]);
  }
  if (typeof value !== "string") return null;
  const v = value.trim();
  if (v.startsWith("[TEST: FAILED")) return { op: "test-failed", reason: v };
  return MARKER_VERDICT_OPS[v] ?? null;
}

/** A reply is doc-shaped — starts {"message"|"review"|"ops": — even when it
 *  failed to parse as a document. Used to keep the inline op scanner away
 *  from broken documents (see parseAgentOutput). */
const LOOKS_LIKE_DOC_RE = /^\{\s*"(?:message|review|ops)"\s*:/;

/** Marker texts the pipeline itself writes into the transcript (and agents
 *  sometimes echo back instead of re-emitting the verdict op). */
const MARKER_RE = /\[(?:SECURITY: (?:PASSED ✓|FAILED)|TEST: (?:PASSED ✓|FAILED[^\]]*))\]/g;

/** The ops-array portion of a broken document — everything from the first
 *  "ops" key onward. Verdict recovery is confined to this tail so op
 *  examples quoted inside the message prose can never execute. */
function opsArrayTail(content: string): string {
  const idx = content.search(/"ops"\s*:/);
  return idx === -1 ? content : content.slice(idx);
}

/** Best-effort recovery of the message/review prose from a malformed
 *  document, unescaping the JSON string escapes. */
function extractDocMessage(content: string): string {
  const m = content.match(/\{\s*"(?:message|review)"\s*:\s*"((?:[^"\\]|\\.)*)"/);
  if (!m) return "";
  return m[1].replace(/\\(["\\n])/g, (_ch, c: string) => (c === "n" ? "\n" : c));
}

export function parseAgentOutput(content: string): ParsedOutput {
  const fileOps: FileOp[] = [];
  const searchOps: SearchOp[] = [];
  const scrapeOps: ScrapeOp[] = [];
  const cmdOps: CmdOp[] = [];
  const mcpOps: McpOp[] = [];
  const researchOps: ResearchOp[] = [];
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

  // Marker stamped where a malformed op or broken document is scrubbed from
  // the transcript — visible to both the agent and the user, and matched by
  // the pipeline's feedback scrub.
  const MALFORMED_MARKER = "[MALFORMED OP — not executed]";

  // ── Primary: one pure-JSON document per message ────────────────────────────
  // The canonical agent format. When the whole reply parses as a document they
  // are on, its ops array IS the op source and "message" is the visible prose;
  // the inline scanner below is only reached as the fallback (models that
  // ignore the format, or replies cut off at the token limit).
  const doc = tryParseAgentDoc(stripped);
  const docMode = doc !== null;
  const docOps = doc?.ops ?? [];
  if (docMode) cleanContent = doc?.message ?? "";

  // Scan the wrapper-stripped text so ops previously trapped inside special
  // tokens are now visible, and so malformed excerpts we surface to the user
  // do not still carry the wrapper characters. In document mode the ops come
  // pre-parsed from the doc — re-scanning the raw text would find the same ops
  // nested inside the doc and double-apply them.
  let jsonOps: Array<Record<string, unknown>> = [];
  let malformedRaws: MalformedOpExcerpt[] = [];
  if (!docMode) {
    // Broken document: doc-shaped ({"message"|"review"|"ops":) with an "ops"
    // key, but JSON.parse failed — most commonly an unescaped quote. An
    // ops-LESS {"message":"..."} reply is a legitimate no-tool-call message
    // and stays on the inline fallback path.
    if (LOOKS_LIKE_DOC_RE.test(stripped) && /"ops"\s*:/.test(stripped)) {
      // CRITICAL: never run the inline op scanner over a broken document.
      // Op examples the agent quoted inside its own message text would
      // execute — a Critic that reviewed "use {"op":"security-fail"} here"
      // got its run rejected by its own example. Keep the message text if
      // extractable, stamp the marker, and report the raw blob as malformed.
      const msg = extractDocMessage(stripped);
      cleanContent = msg ? `${msg}\n\n${MALFORMED_MARKER}` : MALFORMED_MARKER;
      malformedRaws = [{ raw: stripped.slice(0, 200), unterminated: false }];
      // Verdict recovery is confined to the OPS TAIL (from the first "ops"
      // key onward): real ops the model got there still execute, and marker
      // texts it echoed back ([SECURITY: FAILED] etc.) map to their verdicts.
      // The message prose — where the model quotes op examples — is excluded.
      const tail = opsArrayTail(stripped);
      const tailScan = findJsonOpsInternal(tail);
      jsonOps = tailScan.ops;
      malformedRaws = [...malformedRaws, ...tailScan.malformed];
      for (const m of tail.matchAll(MARKER_RE)) {
        const verdict = markerToVerdictOp(m[0]);
        if (verdict) jsonOps.push(verdict);
      }
    } else {
      const found = findJsonOpsInternal(stripped);
      jsonOps = found.ops;
      malformedRaws = found.malformed;
    }
  }
  const opsToApply = docMode ? docOps : jsonOps;

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
  let continueRequested = false;
  let dispatchRequested = false;
  let dispatchReason: string | undefined;
  const processedPaths = new Set<string>();

  // Substitute malformed op excerpts BEFORE the successful-op loop rewrites
  // adjacent text — the excerpt is a literal slice of the current cleanContent,
  // so replace() finds it now; once other ops rewrite chunks around it the
  // literal may no longer be present. Marker is deliberately visible in-line
  // so both the agent and the user can see that something was rejected.
  for (const excerpt of malformedRaws) {
    malformedOps.push(excerpt.raw);
    const idx = cleanContent.indexOf(excerpt.raw);
    if (idx === -1) continue;
    // The excerpt itself is bounded at ~200 chars or the end of its line, so
    // the remainder of a broken op — and any raw content spilled onto the
    // lines below it — would otherwise survive in the transcript, where the
    // agent reads its own garbage back and re-copies it verbatim into the next
    // attempt. Stamp the marker and drop the whole broken region. It ends at
    // the next JSON op (sibling ops must still run), the next blank line
    // (prose divider the agent wrote after the attempt), or the end.
    let stop = cleanContent.length;
    const afterRegion = cleanContent.indexOf("\n\n", idx + excerpt.raw.length);
    if (afterRegion !== -1 && afterRegion < stop) stop = afterRegion;
    const nextOp = cleanContent.slice(idx + excerpt.raw.length).search(/\n?\s*\{\s*"op"/);
    if (nextOp !== -1) {
      const nextOpAbs = idx + excerpt.raw.length + nextOp;
      if (nextOpAbs < stop) stop = nextOpAbs;
    }
    cleanContent = cleanContent.slice(0, idx) + MALFORMED_MARKER + cleanContent.slice(stop);
  }
  for (const op of opsToApply) {
    // Inline mode the op is a literal slice of cleanContent, so the marker
    // replaces the text in place; in document mode there is no raw text — the
    // marker appends under the document's "message".
    const raw = docMode ? "" : JSON.stringify(op);
    const mark = (placeholder: string) => {
      if (docMode) cleanContent = cleanContent.length > 0 ? `${cleanContent}\n\n${placeholder}` : placeholder;
      else cleanContent = cleanContent.replace(raw, placeholder);
    };
    // Op-name normalisation: feedback (and models' training data) call the
    // ops by MCP-style names — write_file, rewrite_file, edit_file,
    // delete_file, run_command. Fold underscores to hyphens and map the
    // foreign spellings to their canonical ops, so an op the Coder was TOLD
    // to emit actually runs instead of silently no-op'ing.
    const opRaw = String(op.op ?? "").toLowerCase().replace(/_/g, "-");
    const opName =
      opRaw === "write-file" || opRaw === "rewrite-file" ? "create-file"
      : opRaw === "run-command" ? "cmd"
      : opRaw;
    switch (opName) {
      case "create-file":
        if (typeof op.path === "string" && typeof op.content === "string") {
          fileOps.push({ type: "create", filepath: op.path, content: op.content });
          processedPaths.add(`create:${op.path}`);
          mark(`[FILE CREATED: ${op.path}]`);
        }
        break;
      case "edit-file":
        if (typeof op.path === "string" && typeof op.content === "string") {
          fileOps.push({ type: "edit", filepath: op.path, content: op.content });
          processedPaths.add(`edit:${op.path}`);
          mark(`[FILE EDITED: ${op.path}]`);
        }
        break;
      case "delete-file":
        if (typeof op.path === "string") {
          fileOps.push({ type: "delete", filepath: op.path });
          processedPaths.add(`delete:${op.path}`);
          mark(`[FILE DELETED: ${op.path}]`);
        }
        break;
      case "cmd":
        if (typeof op.command === "string") {
          cmdOps.push({ command: op.command });
          // Show the whole command. It used to be cut at 80 chars, which sliced
          // pipelines mid-word ("… | he") and left the reader unable to tell
          // what actually ran — the opposite of what a transcript is for. Long
          // commands are rare and a wrapped line beats a lie.
          mark(`[CMD: ${op.command}]`);
        }
        break;
      case "search":
        if (typeof op.query === "string") {
          searchOps.push({ query: op.query });
          mark(`[SEARCHING: ${op.query.slice(0, 80)}]`);
        }
        break;
      case "scrape":
        if (typeof op.url === "string") {
          scrapeOps.push({ url: op.url });
          mark(`[SCRAPING: ${op.url.slice(0, 80)}]`);
        }
        break;
      case "research":
        if (typeof op.query === "string") {
          researchOps.push({ query: op.query, detail: typeof op.detail === "string" ? op.detail : undefined });
          mark(`[RESEARCHING: ${op.query.slice(0, 80)}]`);
        }
        break;
      case "mcp":
        if (typeof op.server === "string" && typeof op.tool === "string") {
          mcpOps.push({ server: op.server, tool: op.tool, args: op.args as Record<string, unknown> | undefined });
          mark(`[MCP: ${op.server}/${op.tool}]`);
        } else {
          mark(`[MCP: invalid]`);
        }
        break;
      case "test-success":
        testerResult ??= "pass";
        mark("[TEST: PASSED ✓]");
        break;
      case "test-failed":
        testerResult = "fail";
        testerFailReason = String(op.reason ?? "unknown");
        mark(`[TEST: FAILED - ${testerFailReason}]`);
        break;
      case "security-pass":
        hackerResult ??= "pass";
        criticResult ??= "pass";
        mark("[SECURITY: PASSED ✓]");
        break;
      case "security-fail":
        hackerResult = "fail";
        criticResult = "fail";
        mark("[SECURITY: FAILED]");
        break;
      case "deploy-commands":
        if (Array.isArray(op.commands) && op.commands.length > 0) {
          deployCommands = op.commands.map(String);
          mark(`[DEPLOY COMMANDS SET: ${deployCommands.length} command(s)]`);
        }
        break;
      case "request-api-key":
        if (typeof op.name === "string" && typeof op.description === "string" && typeof op.howToGet === "string") {
          requestApiKey = { name: op.name, description: op.description, howToGet: op.howToGet };
          mark(`[API KEY REQUIRED: ${op.name}]`);
        }
        break;
      case "get-info":
        if (op.fields && Array.isArray(op.fields)) {
          infoRequest = op as unknown as InfoRequest;
          mark(`[INFO REQUESTED: ${String(op.title ?? "?")}]`);
        }
        break;
      case "instructions":
        if (op.steps && Array.isArray(op.steps)) {
          instructions = op as unknown as Instructions;
          mark(`[INSTRUCTIONS PROVIDED: ${String(op.title ?? "?")}]`);
        }
        break;
      case "change-mode":
        if (typeof op.mode === "string") {
          const validModes = ["Code", "Chat", "Minor"];
          changeMode = validModes.includes(op.mode) ? (op.mode as "Code" | "Chat" | "Minor") : undefined;
          mark(`[CHANGE MODE: ${op.mode}]`);
        }
        break;
      case "generate-image":
        if (typeof op.prompt === "string") {
          const imgUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(op.prompt.slice(0, 500))}?width=${(op.width as number) ?? 1024}&height=${(op.height as number) ?? 1024}&model=${(op.model as string) ?? "flux"}&seed=${Math.floor(Math.random() * 100000)}`;
          const imgHtml = `<div class="pollinations-image"><img src="${imgUrl}" alt="${op.prompt.replace(/"/g, "&quot;").slice(0, 200)}" style="max-width:100%;border-radius:8px;margin:8px 0;" loading="lazy" /><p style="font-size:11px;opacity:0.6;margin:2px 0;">Generated by Pollinations AI · <a href="${imgUrl}" target="_blank" rel="noopener">Open full size</a></p></div>`;
          mark(imgHtml);
        }
        break;
      case "continue":
        // Explicit "give me another turn" signal. The pipeline re-runs this
        // same agent after applying this round's file ops — the mechanism that
        // lets a single large file be written across several responses. The
        // op itself carries no data; the agent just keeps its document short
        // and asks for more room instead of emitting a truncated file.
        continueRequested = true;
        mark("[CONTINUE]");
        break;
      case "dispatch":
        // KnowItAll's escalation: the answering agent found a problem/bug that
        // needs the build pipeline. The reason lands in the transcript so the
        // Dispatcher re-run has the context.
        dispatchRequested = true;
        if (typeof op.reason === "string" && op.reason.trim()) {
          dispatchReason = op.reason.trim().slice(0, 500);
          mark(`[DISPATCH REQUESTED: ${dispatchReason.slice(0, 120)}]`);
        } else {
          mark("[DISPATCH REQUESTED]");
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

  // Bare-block pairing — the model often writes the path into a JSON op and
  // the content into a block WITHOUT the =path attribute, e.g.
  //   {"op":"create-file","path":"index.html"}
  //   <<CREATEFILE>> ...raw content... <<END.CREATEFILE>>
  // The JSON op alone is inert (it carries no "content"), so pair the block
  // with the nearest preceding JSON create/edit op and write the file. Guards
  // the exact shape a live run kept producing while its JSON-escaped
  // create-file attempts were being rejected.
  const bareBlockRe = new RegExp(`${O}(?:CREATEFILE|EDITFILE)${C}([\\s\\S]*?)${O}END\\.CREATEFILE${C}`, "g");
  while ((match = bareBlockRe.exec(content)) !== null) {
    const opTypeRe = /\{"op"\s*:\s*"(create-file|edit-file)","path"\s*:\s*"([^"]+)"/g;
    let last: RegExpExecArray | null = null;
    let m2: RegExpExecArray | null;
    while ((m2 = opTypeRe.exec(content.slice(0, match.index))) !== null) last = m2;
    if (!last) continue;
    const path = last[2];
    const key = `${last[1] === "edit-file" ? "edit" : "create"}:${path}`;
    if (processedPaths.has(key)) continue;
    processedPaths.add(key);
    fileOps.push({ type: last[1] === "edit-file" ? "edit" : "create", filepath: path, content: match[1].trim() });
    cleanContent = cleanContent.replace(match[0], `[FILE ${last[1] === "edit-file" ? "EDITED" : "CREATED"}: ${path}]`);
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

  return { fileOps, searchOps, scrapeOps, cmdOps, mcpOps, researchOps, cleanContent, malformedOps, testerResult, testerFailReason, hackerResult, criticResult, deployCommands, infoRequest, instructions, changeMode, requestApiKey, continueRequested, dispatchRequested, dispatchReason };
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
