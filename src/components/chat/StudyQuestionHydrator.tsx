// Study-mode message renderer. The study model replies in MARKDOWN with
// interactive JSON ops embedded ({"op":"ask-question"}, {"op":"ask-mcq"},
// {"op":"flashcards"}, {"op":"pathway"}), often pretty-printed and fenced in
// ```json blocks. This component:
//   1. Extracts those ops from the raw content with a robust brace-matching
//      parser (so fenced / multi-line JSON works).
//   2. Splits the content into prose segments and widget segments.
//   3. Renders prose with react-markdown (so headings, bold, tables, math,
//      code blocks render properly) and widgets as live React components.
// This works whether or not the backend already converted the ops to HTML.

import { memo, useState } from "react";
import ReactMarkdown from "react-markdown";
import { Check, Send } from "lucide-react";
import FlashcardDeck from "@/components/chat/FlashcardDeck";
import LearningPathway, { type PathwayStep } from "@/components/chat/LearningPathway";
import { sfx } from "@/lib/sfx";

export interface AskData {
  type: "question";
  question: string;
}
export interface McqData {
  type: "mcq";
  question: string;
  options: string[];
  correct: number | number[];
  multiSelect?: boolean;
}
export interface FlashcardsData {
  type: "flashcards";
  cards: Array<{ front: string; back: string }>;
}
export interface PathwayData {
  type: "pathway";
  title: string;
  steps: PathwayStep[];
}
export type QuestionData = AskData | McqData | FlashcardsData | PathwayData;

interface StudyQuestionHydratorProps {
  html: string;
  accentText?: string;
  onAnswer?: (question: string, answer: string) => void;
}

// ── Robust JSON-op extraction ───────────────────────────────────────────────
// The content may arrive either as raw {"op":...} JSON (during/if the backend
// didn't convert) or as placeholder divs the backend produced:
//   <div class="thalamus-ask" data-ask='{...}'></div>
//   <div class="thalamus-mcq" data-mcq='{...}'></div>
//   <div class="thalamus-flashcards" data-flashcards='{...}'></div>
//   <div class="thalamus-pathway" data-pathway='{...}'></div>
// We support both.

interface ParsedOp {
  op: string;
  data: Record<string, unknown>;
  start: number;
  end: number;
}

function extractOps(content: string): ParsedOp[] {
  const out: ParsedOp[] = [];
  // 1) Raw JSON ops: {"op":"..."}, whitespace-tolerant.
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
      if (typeof parsed.op === "string") out.push({ op: parsed.op, data: parsed as Record<string, unknown>, start, end });
    } catch { /* skip */ }
    i = end;
  }

  // 2) Placeholder divs: <div class="thalamus-*" data-*='{...}'></div>
  const divRe = /<div\s+class="thalamus-(ask|mcq|flashcards|pathway)"\s+data-(?:ask|mcq|flashcards|pathway)='((?:[^'\\]|\\.)*)'><\/div>/g;
  let m: RegExpExecArray | null;
  while ((m = divRe.exec(content)) !== null) {
    const type = m[1];
    try {
      const data = JSON.parse(m[2].replace(/\\'/g, "'")) as Record<string, unknown>;
      // The data carries "type"; map div type to op name.
      const opName = type === "ask" ? "ask-question" : type === "mcq" ? "ask-mcq" : type === "flashcards" ? "flashcards" : "pathway";
      out.push({ op: opName, data, start: m.index, end: m.index + m[0].length });
    } catch { /* skip */ }
  }

  out.sort((a, b) => a.start - b.start);
  return out;
}

// ── Widgets ─────────────────────────────────────────────────────────────────

function AskWidget({ data, onAnswer }: { data: AskData; onAnswer?: (q: string, a: string) => void }) {
  const [text, setText] = useState("");
  const submit = () => {
    const t = text.trim();
    if (!t || !onAnswer) return;
    sfx.click();
    onAnswer(data.question, t);
    setText("");
  };
  return (
    <div className="rounded-xl border border-indigo-500/30 bg-indigo-500/5 p-3 space-y-2 my-2">
      <p className="text-xs font-semibold text-indigo-400 uppercase tracking-wider">Question</p>
      <p className="text-sm text-foreground leading-relaxed">{data.question}</p>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); } }}
        rows={2}
        placeholder="Type your answer here…"
        className="w-full resize-none rounded-lg border border-border bg-background px-2.5 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-indigo-400/60"
      />
      <div className="flex justify-end">
        <button
          onClick={submit}
          disabled={!text.trim()}
          className="flex items-center gap-1.5 rounded-lg bg-indigo-500 text-white px-3 py-1.5 text-xs font-medium hover:bg-indigo-500/90 disabled:opacity-40 transition-colors"
        >
          <Send className="h-3.5 w-3.5" /> Submit answer
        </button>
      </div>
    </div>
  );
}

function McqWidget({ data, onAnswer }: { data: McqData; onAnswer?: (q: string, a: string) => void }) {
  const multi = data.multiSelect === true || Array.isArray(data.correct);
  const [selected, setSelected] = useState<number[]>([]);
  const [submitted, setSubmitted] = useState(false);
  const correctArr = Array.isArray(data.correct) ? data.correct : [data.correct];

  const toggle = (i: number) => {
    if (submitted) return;
    setSelected(prev => multi ? (prev.includes(i) ? prev.filter(x => x !== i) : [...prev, i]) : [i]);
  };
  const submit = () => {
    if (selected.length === 0 || !onAnswer) return;
    setSubmitted(true);
    const ok = multi
      ? selected.length === correctArr.length && selected.every(s => correctArr.includes(s))
      : selected[0] === correctArr[0];
    if (ok) sfx.correct(); else sfx.wrong();
    onAnswer(data.question, selected.map(i => data.options[i]).join(", "));
  };

  return (
    <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-3 space-y-2 my-2">
      <p className="text-xs font-semibold text-emerald-500 uppercase tracking-wider">
        {multi ? "Multiple Choice — select all that apply" : "Multiple Choice"}
      </p>
      <p className="text-sm text-foreground leading-relaxed">{data.question}</p>
      <div className="space-y-1.5">
        {data.options.map((opt, i) => {
          const isSelected = selected.includes(i);
          const isCorrect = correctArr.includes(i);
          let cls = "border-border bg-background";
          if (submitted && isCorrect) cls = "border-emerald-500/60 bg-emerald-500/10";
          else if (submitted && isSelected) cls = "border-red-500/60 bg-red-500/10";
          else if (isSelected) cls = "border-emerald-500/50 bg-emerald-500/5";
          return (
            <label key={i} className={`flex items-center gap-2.5 rounded-lg border px-3 py-2 cursor-pointer transition-colors ${cls}`}>
              <input type={multi ? "checkbox" : "radio"} checked={isSelected} onChange={() => toggle(i)} disabled={submitted} className="accent-emerald-500" />
              <span className="text-sm text-foreground flex-1">{opt}</span>
              {submitted && isCorrect && <Check className="h-4 w-4 text-emerald-500 shrink-0" />}
            </label>
          );
        })}
      </div>
      <div className="flex justify-end">
        {submitted ? (
          <span className="text-xs text-muted-foreground">Answer sent — I'll grade it.</span>
        ) : (
          <button onClick={submit} disabled={selected.length === 0} className="flex items-center gap-1.5 rounded-lg bg-emerald-500 text-white px-3 py-1.5 text-xs font-medium hover:bg-emerald-500/90 disabled:opacity-40 transition-colors">
            <Send className="h-3.5 w-3.5" /> Submit answer
          </button>
        )}
      </div>
    </div>
  );
}

function widgetFor(op: string, data: Record<string, unknown>, onAnswer?: (q: string, a: string) => void): React.ReactNode {
  switch (op) {
    case "ask-question": {
      const question = String(data.question ?? "");
      if (!question) return null;
      return <AskWidget data={{ type: "question", question }} onAnswer={onAnswer} />;
    }
    case "ask-mcq": {
      const question = String(data.question ?? "");
      const options = Array.isArray(data.options) ? data.options.map(String) : [];
      const c = data.correct;
      const correct = Array.isArray(c) ? c.map(Number) : Number(c);
      const multiSelect = Array.isArray(c) || data.multiSelect === true;
      if (!question || options.length === 0) return null;
      return <McqWidget data={{ type: "mcq", question, options, correct, multiSelect }} onAnswer={onAnswer} />;
    }
    case "flashcards": {
      const cards = Array.isArray(data.cards)
        ? data.cards.filter((c): c is { front: string; back: string } => !!c && typeof (c as { front?: string }).front === "string" && typeof (c as { back?: string }).back === "string")
        : [];
      if (cards.length === 0) return null;
      return <FlashcardDeck cards={cards} />;
    }
    case "pathway": {
      const title = String(data.title ?? "Learning path");
      const steps = Array.isArray(data.steps) ? data.steps : [];
      if (steps.length === 0) return null;
      return <LearningPathway title={title} steps={steps} onAnswer={onAnswer} />;
    }
    default:
      return null;
  }
}

// Prose styling for react-markdown output (headings, lists, tables, code).
const PROSE_CLASS =
  "prose-html text-[15px] leading-relaxed";

const StudyQuestionHydrator = memo(function StudyQuestionHydrator({
  html,
  onAnswer,
}: StudyQuestionHydratorProps) {
  const content = html.startsWith("<") ? html : html.replace(/\n/g, "\n");
  const ops = extractOps(content);

  // If no ops, render the whole thing as markdown.
  if (ops.length === 0) {
    return (
      <div className={PROSE_CLASS}>
        <ReactMarkdown>{content}</ReactMarkdown>
      </div>
    );
  }

  // Split into alternating prose / widget segments.
  const segments: Array<{ kind: "prose" | "widget"; text?: string; op?: string; data?: Record<string, unknown> }> = [];
  let cursor = 0;
  for (const op of ops) {
    // Strip the ```json fence around the op from prose boundaries.
    let proseBefore = content.slice(cursor, op.start);
    // If the op sits inside a ```json fence, the fence opening is just before
    // the op and the fence closing just after — trim them from prose.
    proseBefore = proseBefore.replace(/```json\s*$/, "").replace(/```\s*$/, "");
    if (proseBefore.trim()) segments.push({ kind: "prose", text: proseBefore });
    segments.push({ kind: "widget", op: op.op, data: op.data });
    let proseAfter = content.slice(op.end);
    proseAfter = proseAfter.replace(/^\s*```/, "");
    // keep cursor for next iteration
    cursor = op.end;
    // store the "after" as next cursor's before by continuing; simpler: append trailing later.
    if (segments.length) {
      // remember trailing prose for after the loop
    }
  }
  const trailing = content.slice(cursor).replace(/^\s*```/, "");

  return (
    <div>
      {segments.map((seg, i) => {
        if (seg.kind === "prose") {
          return (
            <div key={`p${i}`} className={PROSE_CLASS}>
              <ReactMarkdown>{seg.text ?? ""}</ReactMarkdown>
            </div>
          );
        }
        return (
          <div key={`w${i}`}>{widgetFor(seg.op!, seg.data!, onAnswer)}</div>
        );
      })}
      {trailing.trim() && (
        <div className={PROSE_CLASS}>
          <ReactMarkdown>{trailing}</ReactMarkdown>
        </div>
      )}
    </div>
  );
});

export default StudyQuestionHydrator;
