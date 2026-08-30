// Verbose transcript parsing for code mode — the shared, framework-free half
// of the Claude Code-style activity view. The React renderers live in
// src/components/code-workspace/VerboseBlocks.tsx.
//
// The pipeline stamps visible activity markers into committed agent messages
// ([CMD: …], [FILE CREATED: …], [OVER TO: …]) and routing lines into System
// messages (⇄ …, ✔ Run complete, [ROUTING] …). The old UI printed them as raw
// bracketed text; this module parses them into typed markers so the UI can
// render each one as a proper verbose block (icon, verb, mono argument, ⎿
// detail line) while ordinary prose keeps flowing through markdown.
//
// It also owns the streaming half. Code-mode agents reply with one JSON doc —
// {"message": "…", "ops": […]} — and that raw doc is what lands in the
// branch's streamingContent while tokens arrive. extractStreamingMessage
// pulls the growing message string out of the partial JSON so the live view
// types out formatted prose — never raw JSON, never half-written ops.

// ── Marker model ─────────────────────────────────────────────────────────────

export type VerboseMarkerKind =
  | "handoff" // ⇄ … System line — the steering event's hero banner; never hidden
  | "overto" // [OVER TO: …] inside an agent message — the agent's own emission; a compact row, because the System ⇄ line that follows already carries the hero banner (two heroes for one event read as a glitch, and a rejected self/unknown target must never look like a real route)
  | "route" // [ROUTING] … — silent re-route announcement
  | "checkpoint" // [CHECKPOINT] … / [CHECKPOINT: …] — the Coder's floor-cap verdict question (System row) and its stamp inside the Coder's own message
  | "complete" // ✔ Run complete
  | "retry" // [RETRY n] — Critic sent a task back
  | "cmd" // [CMD: …]
  | "file-create" // [FILE CREATED: …]
  | "file-edit" // [FILE EDITED: …]
  | "file-delete" // [FILE DELETED: …]
  | "search" // [SEARCHING: …] / legacy [SEARCH: …]
  | "scrape" // [SCRAPING: …] / legacy [SCRAPE: …]
  | "research" // [RESEARCHING: …]
  | "mcp" // [MCP: server/tool]
  | "test-pass" // [TEST: PASSED ✓]
  | "test-fail" // [TEST: FAILED — …]
  | "security-pass" // [SECURITY: PASSED ✓]
  | "security-fail" // [SECURITY: FAILED]
  | "deploy" // [DEPLOY COMMANDS SET: …] / legacy [DEPLOY COMMANDS]
  | "key-request" // [API KEY REQUIRED: …]
  | "info" // [INFO REQUESTED: …] / [INSTRUCTIONS PROVIDED: …]
  | "mode" // [CHANGE MODE: …]
  | "continue" // [CONTINUE] / [CONTINUING: …] — same agent takes another turn
  | "done" // [DONE: …] / [DONE] — a closing seat's explicit run end; a compact row, because the System ✔ Run complete line carries the banner
  | "dispatch" // [DISPATCH REQUESTED …]
  | "malformed" // [MALFORMED OP …]
  | "warning" // ⚠️ … / Run stopped …
  | "hold"; // ⏳ … — provider backoff, run parked

export interface VerboseMarker {
  kind: VerboseMarkerKind;
  /** Uppercase verb shown next to the icon ("RUN", "HAND OFF", …). */
  label: string;
  /** Main argument: the command, path, query, target agent… */
  detail?: string;
  /** Secondary line rendered under the block with a ⎿ leader. */
  secondary?: string;
  /** Sender of a hand-off. Only System ⇄ lines (kind "handoff") carry it —
   *  agent-message OVER TO rows sit inside the sender's own bubble, which
   *  already names them. */
  fromAgent?: string;
  /** The exact source text the marker was parsed from. */
  raw: string;
}

export type VerboseSegment =
  | { type: "prose"; text: string }
  | { type: "marker"; marker: VerboseMarker };

// ── Marker grammar ───────────────────────────────────────────────────────────
// One alternation over every marker the pipeline (or the legacy-tag cleaner)
// can stamp into a message. Order is priority — specific shapes first so
// "[DISPATCH REQUESTED — handed off to the Dispatcher]:" never half-matches as
// the shorter form. Each rule is wrapped in its own named group (?<rN>…) so
// the matcher knows WHICH rule fired; the rule's own named group carries the
// detail argument.

interface MarkerRule {
  kind: VerboseMarkerKind;
  label: string;
  /** Regex source with an optional named capture group for the detail. */
  source: string;
  /** Name of the capture group holding the detail argument, if any. */
  group?: string;
}

const MARKER_RULES: MarkerRule[] = [
  // Hand-offs first — the steering the user must ALWAYS see. Inside an agent
  // message this renders as a compact row ("overto"): the System ⇄ line the
  // pipeline writes for the same event already carries the hero banner, and
  // two banners for one hand-off read as a glitch.
  {
    kind: "overto",
    label: "HAND OFF",
    source: "\\[OVER TO: (?<overTo>[^\\]]+)\\]",
    group: "overTo",
  },
  // A self hand-off rewritten by the parser as keep-working intent —
  // "over to Coder" FROM the Coder means "the next step is still mine".
  {
    kind: "continue",
    label: "CONTINUE",
    source: "\\[CONTINUING(?::\\s?(?<continuing>[^\\]]+))?\\]",
    group: "continuing",
  },
  // A closing seat's explicit run end ({"op":"done"} parsed to a stamp) —
  // a compact row: the System ✔ line that follows carries the banner.
  {
    kind: "done",
    label: "DONE",
    source: "\\[DONE(?::\\s?(?<doneWhy>[^\\]]+))?\\]",
    group: "doneWhy",
  },
  // The Coder's floor-cap checkpoint stamped INTO its own message (the
  // verdict question must reach the model — the digest drops System rows).
  {
    kind: "checkpoint",
    label: "CHECKPOINT",
    source: "\\[CHECKPOINT(?::\\s?(?<checkpointBody>[^\\]]+))?\\]",
    group: "checkpointBody",
  },
  // KnowItAll handing a Q&A thread back to the build team. The pipeline
  // appends the reason AFTER the closing bracket. Both historical shapes
  // render: "handed to the Analyser" (current) and "handed off to the
  // Dispatcher" (the Dispatcher era — it is gone from the pipeline but old
  // transcripts still carry its markers).
  {
    kind: "dispatch",
    label: "DISPATCH",
    source: "\\[DISPATCH REQUESTED — handed (?:off )?to (?:the Analyser|the Dispatcher)\\]:?\\s*(?<dispatchHandoff>[^\\n]*)",
    group: "dispatchHandoff",
  },
  {
    kind: "dispatch",
    label: "DISPATCH",
    source: "\\[DISPATCH REQUESTED(?::\\s?(?<dispatchWhy>[^\\]]*))?\\]",
    group: "dispatchWhy",
  },
  {
    kind: "malformed",
    label: "MALFORMED",
    source: "\\[MALFORMED OP(?: — (?<malformed>[^\\]]*))?\\]",
    group: "malformed",
  },
  {
    kind: "cmd",
    label: "RUN",
    source: "\\[CMD: (?<cmd>[^\\]]+)\\]",
    group: "cmd",
  },
  {
    kind: "file-create",
    label: "CREATE",
    source: "\\[FILE CREATED: (?<fileCreate>[^\\]]+)\\]",
    group: "fileCreate",
  },
  {
    kind: "file-edit",
    label: "UPDATE",
    source: "\\[FILE EDITED: (?<fileEdit>[^\\]]+)\\]",
    group: "fileEdit",
  },
  {
    kind: "file-delete",
    label: "DELETE",
    source: "\\[FILE DELETED: (?<fileDelete>[^\\]]+)\\]",
    group: "fileDelete",
  },
  {
    kind: "search",
    label: "SEARCH",
    source: "\\[SEARCH(?:ING)?: (?<search>[^\\]]+)\\]",
    group: "search",
  },
  {
    kind: "scrape",
    label: "READ",
    source: "\\[SCRAP(?:E|ING): (?<scrape>[^\\]]+)\\]",
    group: "scrape",
  },
  {
    kind: "research",
    label: "RESEARCH",
    source: "\\[RESEARCHING: (?<research>[^\\]]+)\\]",
    group: "research",
  },
  {
    kind: "mcp",
    label: "MCP TOOL",
    source: "\\[MCP: (?<mcp>[^\\]]+)\\]",
    group: "mcp",
  },
  {
    kind: "test-pass",
    label: "TESTS",
    source: "\\[TEST: PASSED[^\\]]*\\]",
  },
  {
    kind: "test-fail",
    label: "TESTS",
    source: "\\[TEST: FAILED(?:\\s*[-—]\\s?(?<testFail>[^\\]]*))?\\]",
    group: "testFail",
  },
  {
    kind: "security-pass",
    label: "SECURITY",
    source: "\\[SECURITY: PASSED[^\\]]*\\]",
  },
  {
    kind: "security-fail",
    label: "SECURITY",
    source: "\\[SECURITY: FAILED[^\\]]*\\]",
  },
  {
    kind: "deploy",
    label: "DEPLOY",
    source: "\\[DEPLOY COMMANDS SET: (?<deploySet>[^\\]]+)\\]",
    group: "deploySet",
  },
  {
    kind: "deploy",
    label: "DEPLOY",
    source: "\\[DEPLOY COMMANDS\\]",
  },
  {
    kind: "key-request",
    label: "API KEY",
    source: "\\[API KEY REQUIRED: (?<keyReq>[^\\]]+)\\]",
    group: "keyReq",
  },
  {
    kind: "info",
    label: "INFO",
    source: "\\[INFO REQUESTED: (?<infoReq>[^\\]]+)\\]",
    group: "infoReq",
  },
  {
    kind: "info",
    label: "GUIDE",
    source: "\\[INSTRUCTIONS PROVIDED: (?<guide>[^\\]]+)\\]",
    group: "guide",
  },
  {
    kind: "mode",
    label: "MODE",
    source: "\\[CHANGE MODE: (?<changeMode>[^\\]]+)\\]",
    group: "changeMode",
  },
  {
    kind: "continue",
    label: "CONTINUE",
    source: "\\[CONTINUE\\]",
  },
  {
    kind: "retry",
    label: "RETRY",
    source: "\\[RETRY (?<retryN>\\d+)\\]",
    group: "retryN",
  },
];

const MARKER_RE = new RegExp(
  MARKER_RULES.map((rule, i) => `(?<r${i}>${rule.source})`).join("|"),
  "g",
);

function markerFromMatch(m: RegExpExecArray): VerboseMarker | null {
  const groups = m.groups ?? {};
  const idx = MARKER_RULES.findIndex((_, i) => groups[`r${i}`] !== undefined);
  if (idx === -1) return null;
  const rule = MARKER_RULES[idx];
  const raw = m[0];
  let kind = rule.kind;
  let detail = rule.group ? groups[rule.group]?.trim() : undefined;
  let secondary: string | undefined;

  switch (kind) {
    case "overto": {
      if (!detail) break;
      // "[OVER TO: Coder — fix the login form]" — target first, optional
      // reason after the em dash. The reason shows in full: it is the
      // receiver's briefing, and a wrap beats a mid-word cut.
      const [target, ...whyParts] = detail.split(/\s+—\s+/);
      detail = target.trim();
      secondary = whyParts.length > 0 ? whyParts.join(" — ").trim() : undefined;
      if (detail === "invalid") {
        kind = "warning";
        detail = "invalid — no agent named";
        secondary = undefined;
      }
      break;
    }
    case "test-pass":
      detail = "passed";
      break;
    case "test-fail":
      detail = detail ? `failed — ${detail}` : "failed";
      break;
    case "security-pass":
      detail = "passed";
      break;
    case "security-fail":
      detail = "failed";
      break;
    case "retry":
      detail = detail ? `#${detail}` : undefined;
      break;
    case "dispatch":
      if (!detail) detail = undefined;
      break;
    default:
      break;
  }
  if (detail === "") detail = undefined;
  return { kind, label: rule.label, detail, secondary, raw };
}

/** Split a committed transcript message into prose runs and typed activity
 *  markers, in source order. Prose between markers is preserved verbatim
 *  (markdown still applies); unknown [ … ] text stays prose. */
export function segmentVerboseContent(content: string): VerboseSegment[] {
  const segments: VerboseSegment[] = [];
  if (!content) return segments;
  const pushProse = (text: string) => {
    if (text.trim().length > 0) segments.push({ type: "prose", text });
  };
  const re = new RegExp(MARKER_RE.source, "g");
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    if (m.index > last) pushProse(content.slice(last, m.index));
    const marker = markerFromMatch(m);
    if (marker) segments.push({ type: "marker", marker });
    else pushProse(m[0]);
    last = m.index + m[0].length;
  }
  if (last < content.length) pushProse(content.slice(last));
  return segments;
}

// ── System routing lines ─────────────────────────────────────────────────────
// The pipeline writes its own steering decisions as System messages: a ⇄ line
// for every hand-off, ✔ for completion, [ROUTING] when it has to take the
// wheel itself, ⚠️ for trouble, ⏳ for provider backoff holds. These are the
// run's narration — classify them so they render as banners, not plain text.

/** Parse a System message into a banner marker, or null when the line is not
 *  a recognised routing event (callers render it as a plain dim note). */
export function classifySystemLine(content: string): VerboseMarker | null {
  const text = content.trim();
  if (!text) return null;
  const raw = content;

  // ⇄ Analyser handed over to Coder — fix the login form
  // ⇄ Critic called for "Researcher" — research runs as one team, so the
  //   whole Research Team takes it, in order (ResearchPlanner → …).
  const hand = text.match(/^⇄\s*(?<from>.+?)\s+(?<verb>handed over to|called for)\s+(?<rest>[\s\S]*)$/);
  if (hand?.groups) {
    const from = hand.groups.from.trim();
    const rest = hand.groups.rest.trim();
    const [head, ...whyParts] = rest.split(/\s+—\s+/);
    const target = head.trim();
    const why = whyParts.join(" — ").trim();
    // A member name can never be the route — naming one summons the WHOLE
    // Research Team. The banner says so; landing on one member is the bug the
    // user called out.
    if (hand.groups.verb === "called for") {
      const member = target.replace(/^"|"$/g, "");
      return {
        kind: "handoff",
        label: "HAND OFF",
        fromAgent: from,
        detail: "the Research Team",
        secondary: `${from} called for ${member} — ${why || "research runs as one team, in order."}`,
        raw,
      };
    }
    return {
      kind: "handoff",
      label: "HAND OFF",
      fromAgent: from,
      detail: target,
      secondary: why || undefined,
      raw,
    };
  }

  const done = text.match(/^✔\s*(?<label>Run complete)(?:\s*—\s*(?<why>[\s\S]*))?$/);
  if (done) {
    return {
      kind: "complete",
      label: "RUN COMPLETE",
      detail: done.groups?.why?.trim() || undefined,
      raw,
    };
  }

  const checkpoint = text.match(/^\[CHECKPOINT\]\s*(?<what>[\s\S]*)$/);
  if (checkpoint) {
    return { kind: "checkpoint", label: "CHECKPOINT", detail: checkpoint.groups?.what?.trim(), raw };
  }

  const routing = text.match(/^\[ROUTING\]\s*(?<what>[\s\S]*)$/);
  if (routing) {
    return { kind: "route", label: "ROUTING", detail: routing.groups?.what?.trim(), raw };
  }

  if (text.startsWith("⚠️")) {
    return { kind: "warning", label: "WARNING", detail: text.replace(/^⚠️\s*/, ""), raw };
  }
  if (text.startsWith("⏳")) {
    return { kind: "hold", label: "HOLDING", detail: text.replace(/^⏳\s*/, ""), raw };
  }
  if (/^Run stopped:/.test(text)) {
    return { kind: "warning", label: "STOPPED", detail: text, raw };
  }
  return null;
}

// ── Live-stream extraction ───────────────────────────────────────────────────

/** Pull the growing "message" (or "review") string out of the partial JSON
 *  doc a code-mode agent streams. Returns:
 *    - the extracted text so far (possibly "") when the stream is doc-shaped
 *      — ops that follow the message string NEVER leak into the view;
 *    - null when the stream is plain prose (caller shows the raw text with
 *      op blocks stripped instead).
 *  Escape sequences are decoded incrementally; a truncated escape at the
 *  drip-edge is held back until its remaining chars arrive. */
export function extractStreamingMessage(raw: string): string | null {
  // Fast path: message first (how the agents are taught to reply). Fallback:
  // message anywhere — a doc that opens with ops still gets a live message.
  const match =
    raw.match(/^\s*\{\s*"(?:message|review)"\s*:\s*"/) ??
    (/\{/.test(raw) ? raw.match(/"(?:message|review)"\s*:\s*"/) : null);
  if (!match) {
    // Doc-shaped but no message key yet (e.g. the drizzle has only produced
    // `{"ops":...`) → nothing to type out yet, but DON'T fall back to raw
    // (that would flash the JSON). Plain-text streams return null.
    return /^\s*\{/.test(raw) ? "" : null;
  }

  let i = (match.index ?? 0) + match[0].length;
  let out = "";
  while (i < raw.length) {
    const ch = raw[i];
    if (ch === "\\") {
      const next = raw[i + 1];
      if (next === undefined) break; // dangling backslash — wait for the drip
      if (next === "n") out += "\n";
      else if (next === "t") out += "\t";
      else if (next === "r") out += "\r";
      else if (next === "b") out += "\b";
      else if (next === "f") out += "\f";
      else if (next === "u") {
        const hex = raw.slice(i + 2, i + 6);
        if (/^[0-9a-fA-F]{4}$/.test(hex)) {
          out += String.fromCharCode(parseInt(hex, 16));
          i += 6;
          continue;
        }
        break; // incomplete \uXXXX — wait for the drip
      } else {
        out += next; // \" \\ \/ — the escaped char itself
      }
      i += 2;
      continue;
    }
    if (ch === "\"") break; // message string closed — ops follow; stop here
    out += ch;
    i++;
  }
  return out;
}

/** Strip ```json … ``` op blocks (and bare {"op":…} objects) from a plain-text
 *  stream so interactive ops never appear as raw code while text types out.
 *  Shared by the chat portal bubble and the code-mode fallback path. */
export function stripOpsForStreaming(content: string): string {
  let out = content.replace(/```json[\s\S]*?```/gi, "");
  out = out.replace(/\{\s*"op"\s*:\s*"[^"]*"[\s\S]*?\}/g, "");
  return out;
}

/** What the code-mode streaming bubble should type out: the live message
 *  string for JSON-doc streams, stripped prose for plain-text streams. */
export function streamVisibleText(raw: string): string {
  const message = extractStreamingMessage(raw);
  if (message !== null) return message;
  return stripOpsForStreaming(raw);
}
