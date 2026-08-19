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
 * Strip leftover ```json / ``` code-fence markers from the edges of a prose
 * slice. When an op is wrapped in a ```json fence, the slice before the op
 * carries the previous block's closing ``` at its start and this block's
 * opening ```json at its end. If a lone ``` is left behind, a markdown renderer
 * treats the rest of the prose as a fenced code block and the markdown (##, **)
 * shows as literal text. Shared by the backend converter and the frontend
 * hydrator so both strip fences identically.
 */
export function stripOpFences(prose: string): string {
  return prose
    .replace(/^\s*```json/, "")
    .replace(/^\s*```/, "")
    .replace(/```json\s*$/, "")
    .replace(/```\s*$/, "");
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

// Each interactive element in a reply gets a stable id so the persisted study
// task (buildStudyTaskItems) and the widget placeholders (convertStudyJsonOps)
// agree on which item a client completion refers to. The client reads the id
// off the widget's data payload and reports it back to markStudyItemDone.
type StudyItemId = { id: string };

// Assign sequential ids to every interactive element in a reply, in document
// order. Both the task builder and the converter use this so ids line up.
function assignStudyItemIds(content: string): Array<StudyItemId> {
  const ops = extractStudyJsonOps(content);
  const ids: Array<StudyItemId> = [];
  let seq = 0;
  for (const op of ops) {
    try {
      if (op.op === "ask-question") {
        const question = String(op.data.question ?? "").trim();
        if (question) ids.push({ id: `q${seq++}` });
      } else if (op.op === "ask-mcq") {
        const question = String(op.data.question ?? "").trim();
        if (question) ids.push({ id: `m${seq++}` });
      } else if (op.op === "flashcards" && Array.isArray(op.data.cards)) {
        for (const c of op.data.cards as Array<{ front?: string }>) {
          if (String(c?.front ?? "").trim()) ids.push({ id: `f${seq++}` });
        }
      } else if (op.op === "pathway" && Array.isArray(op.data.steps)) {
        for (const s of op.data.steps as Array<{ question?: string }>) {
          if (String(s?.question ?? "").trim()) ids.push({ id: `s${seq++}` });
        }
      }
    } catch { /* skip malformed */ }
  }
  return ids;
}

/**
 * Convert study-mode JSON ops in a model reply into interactive placeholder
 * divs and strip the op JSON (plus any ```json fence) from the visible prose.
 * Each widget's data payload carries its stable `id` so the client can mark it
 * complete in the persisted study task.
 */
export function convertStudyJsonOps(content: string): string {
  const ops = extractStudyJsonOps(content);
  if (ops.length === 0) return content;

  // Match each op to the id the task builder assigns it (walk in order).
  const ids = assignStudyItemIds(content);
  let idCursor = 0;

  let out = content;
  for (const op of ops) {
    let widget = "";
    try {
      const myId = ids[idCursor]?.id;
      if (op.op === "ask-question") {
        const question = String(op.data.question ?? "");
        if (question) widget = `<div class="thalamus-ask" data-ask='${JSON.stringify({type:"question",question,id:myId})}'></div>`;
        idCursor++;
      } else if (op.op === "ask-mcq") {
        const question = String(op.data.question ?? "");
        const options = Array.isArray(op.data.options) ? op.data.options.map(String) : [];
        const c = op.data.correct;
        const correct = Array.isArray(c) ? c.map(Number) : Number(c);
        const multiSelect = Array.isArray(c) || op.data.multiSelect === true;
        if (question && options.length > 0) widget = `<div class="thalamus-mcq" data-mcq='${JSON.stringify({type:"mcq",question,options,correct,multiSelect,id:myId})}'></div>`;
        idCursor++;
      } else if (op.op === "flashcards") {
        const cards = Array.isArray(op.data.cards)
          ? op.data.cards.filter((c): c is { front: string; back: string } => !!c && typeof (c as { front?: string }).front === "string" && typeof (c as { back?: string }).back === "string")
          : [];
        // Collect this deck's per-card ids for per-item completion.
        const cardCount = Array.isArray(op.data.cards)
          ? (op.data.cards as Array<{ front?: string }>).filter((c) => String(c?.front ?? "").trim()).length
          : 0;
        const deckIds = ids.slice(idCursor, idCursor + cardCount).map((x) => x.id);
        idCursor += cardCount;
        if (cards.length > 0) widget = `<div class="thalamus-flashcards" data-flashcards='${JSON.stringify({type:"flashcards",cards,ids:deckIds})}'></div>`;
      } else if (op.op === "pathway") {
        const title = String(op.data.title ?? "Learning path");
        const steps = Array.isArray(op.data.steps) ? op.data.steps : [];
        // Collect this pathway's per-step ids for per-step completion.
        const stepCount = Array.isArray(op.data.steps)
          ? (op.data.steps as Array<{ question?: string }>).filter((s) => String(s?.question ?? "").trim()).length
          : 0;
        const stepIds = ids.slice(idCursor, idCursor + stepCount).map((x) => x.id);
        idCursor += stepCount;
        if (steps.length > 0) widget = `<div class="thalamus-pathway" data-pathway='${JSON.stringify({type:"pathway",title,steps,ids:stepIds})}'></div>`;
      }
    } catch { widget = ""; }

    if (widget) {
      const at = out.indexOf(op.raw);
      if (at === -1) continue;
      const before = stripOpFences(out.slice(0, at));
      const after = out.slice(at + op.raw.length).replace(/^\s*```/, "");
      out = before + "\n\n" + widget + "\n\n" + after;
    }
  }
  return out.replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * Build the interactive study-task items present in a model reply: one item for
 * every flashcard, MCQ, open question, and pathway step. Used to create the
 * persisted study task the frontend locks study mode on. `taskKey` is derived
 * from the content so a stale completion from a previous reply never unlocks a
 * newer one.
 */
export function buildStudyTaskItems(content: string): {
  taskKey: string;
  items: Array<{ id: string; kind: "question" | "mcq" | "flashcard" | "step"; label: string }>;
} {
  const items: Array<{ id: string; kind: "question" | "mcq" | "flashcard" | "step"; label: string }> = [];
  const ops = extractStudyJsonOps(content);
  const ids = assignStudyItemIds(content);
  let idCursor = 0;
  for (const op of ops) {
    try {
      if (op.op === "ask-question") {
        const question = String(op.data.question ?? "").trim();
        if (question) { const id = ids[idCursor++]?.id; items.push({ id: id ?? `q${items.length}`, kind: "question", label: question.slice(0, 120) }); }
      } else if (op.op === "ask-mcq") {
        const question = String(op.data.question ?? "").trim();
        if (question) { const id = ids[idCursor++]?.id; items.push({ id: id ?? `m${items.length}`, kind: "mcq", label: question.slice(0, 120) }); }
      } else if (op.op === "flashcards" && Array.isArray(op.data.cards)) {
        for (const c of op.data.cards as Array<{ front?: string }>) {
          const front = String(c?.front ?? "").trim();
          if (front) { const id = ids[idCursor++]?.id; items.push({ id: id ?? `f${items.length}`, kind: "flashcard", label: front.slice(0, 120) }); }
        }
      } else if (op.op === "pathway" && Array.isArray(op.data.steps)) {
        for (const s of op.data.steps as Array<{ question?: string }>) {
          const question = String(s?.question ?? "").trim();
          if (question) { const id = ids[idCursor++]?.id; items.push({ id: id ?? `s${items.length}`, kind: "step", label: question.slice(0, 120) }); }
        }
      }
    } catch { /* skip malformed */ }
  }
  if (items.length === 0) return { taskKey: "", items: [] };
  // taskKey: a stable hash of the item ids + labels so re-sending the same
  // question set yields the same key, and a new set yields a new one.
  let hash = 0;
  const seed = items.map((it) => `${it.kind}:${it.label}`).join("|");
  for (let i = 0; i < seed.length; i++) {
    hash = ((hash << 5) - hash + seed.charCodeAt(i)) | 0;
  }
  return { taskKey: `task-${Math.abs(hash)}`, items };
}
