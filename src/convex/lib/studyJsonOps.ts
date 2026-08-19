// Robust extraction and HTML conversion of study-mode interactive JSON ops
// (ask-question / ask-mcq / flashcards / pathway). The model emits these as
// {"op":"..."} JSON objects that are often pretty-printed, multi-line, and
// wrapped in ```json code fences — so we use a brace-depth + string-state
// walker rather than line-oriented regexes, which failed on fenced JSON.
//
// Pure module (no Convex, no node) so it is importable from both the default
// runtime http router and the "use node" study action.

interface StudyJsonOp {
  raw: string;
  op: string;
  data: Record<string, unknown>;
}

/**
 * Find all balanced {"op":"..."} JSON objects in content. Handles nested
 * braces/arrays, braces inside string values, AND pretty-printed JSON where
 * whitespace appears after the opening brace ({\n  "op": "flashcards"}).
 */
export function extractStudyJsonOps(content: string): StudyJsonOp[] {
  const ops: StudyJsonOp[] = [];
  const openerRe = /\{\s*"op"\s*:\s*"/g;
  let i = 0;
  while (i < content.length) {
    openerRe.lastIndex = i;
    const open = openerRe.exec(content);
    if (!open) break;
    const start = open.index;
    let depth = 0, inStr = false, escaped = false, end = -1;
    for (let j = start; j < content.length; j++) {
      const ch = content[j];
      if (escaped) { escaped = false; continue; }
      if (ch === "\\" && inStr) { escaped = true; continue; }
      if (ch === '"') { inStr = !inStr; continue; }
      if (inStr) continue;
      if (ch === "{") depth++;
      else if (ch === "}") { depth--; if (depth === 0) { end = j + 1; break; } }
    }
    if (end === -1) break;
    const raw = content.slice(start, end);
    try {
      const parsed = JSON.parse(raw) as { op?: string };
      if (typeof parsed.op === "string") ops.push({ raw, op: parsed.op, data: parsed as Record<string, unknown> });
    } catch { /* skip malformed */ }
    i = end;
  }
  return ops;
}

/**
 * Convert study-mode JSON ops in a model reply into interactive placeholder
 * divs and strip the op JSON (plus any ```json fence) from the visible prose.
 */
export function convertStudyJsonOps(content: string): string {
  const ops = extractStudyJsonOps(content);
  if (ops.length === 0) return content;

  let out = content;
  for (const op of ops) {
    let widget = "";
    try {
      if (op.op === "ask-question") {
        const question = String(op.data.question ?? "");
        if (question) widget = `<div class="thalamus-ask" data-ask='${JSON.stringify({type:"question",question})}'></div>`;
      } else if (op.op === "ask-mcq") {
        const question = String(op.data.question ?? "");
        const options = Array.isArray(op.data.options) ? op.data.options.map(String) : [];
        const c = op.data.correct;
        const correct = Array.isArray(c) ? c.map(Number) : Number(c);
        const multiSelect = Array.isArray(c) || op.data.multiSelect === true;
        if (question && options.length > 0) widget = `<div class="thalamus-mcq" data-mcq='${JSON.stringify({type:"mcq",question,options,correct,multiSelect})}'></div>`;
      } else if (op.op === "flashcards") {
        const cards = Array.isArray(op.data.cards)
          ? op.data.cards.filter((c): c is { front: string; back: string } => !!c && typeof (c as { front?: string }).front === "string" && typeof (c as { back?: string }).back === "string")
          : [];
        if (cards.length > 0) widget = `<div class="thalamus-flashcards" data-flashcards='${JSON.stringify({type:"flashcards",cards})}'></div>`;
      } else if (op.op === "pathway") {
        const title = String(op.data.title ?? "Learning path");
        const steps = Array.isArray(op.data.steps) ? op.data.steps : [];
        if (steps.length > 0) widget = `<div class="thalamus-pathway" data-pathway='${JSON.stringify({type:"pathway",title,steps})}'></div>`;
      }
    } catch { widget = ""; }

    if (widget) {
      const at = out.indexOf(op.raw);
      if (at === -1) continue;
      const before = out.slice(0, at).replace(/```json\s*$/, "").replace(/```\s*$/, "");
      const after = out.slice(at + op.raw.length).replace(/^\s*```/, "");
      out = before + "\n\n" + widget + "\n\n" + after;
    }
  }
  return out.replace(/\n{3,}/g, "\n\n").trim();
}
