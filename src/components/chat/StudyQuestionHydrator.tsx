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

import { memo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { motion } from "framer-motion";
import { Check, Loader2, Send, X } from "lucide-react";
import FlashcardDeck from "@/components/chat/FlashcardDeck";
import LearningPathway, { type PathwayStep } from "@/components/chat/LearningPathway";
import FloatingReward from "@/components/chat/FloatingReward";
import { stripOpFences } from "@/convex/lib/studyJsonOps";
import { sfx } from "@/lib/sfx";
import { celebrateAt } from "@/lib/vfx";
import { useStudyTaskContext } from "@/components/chat/StudyTaskContext";
import type { StudyQuestionPrompt } from "@/lib/studyComposerQuestion";

const OPTION_LETTERS = ["A", "B", "C", "D", "E", "F", "G", "H"];

export interface AskData {
  type: "question";
  question: string;
  // Plain/legacy questions have no persisted task item, so their answer must go
  // back through the conversation instead of only using the inline grader.
  submitDirectly?: boolean;
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
  // Ask/MCQ controls move into the main composer when false. Flashcards and
  // learning pathways remain in the transcript where their larger UI belongs.
  renderQuestions?: boolean;
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
  // Stop at the placeholder's full closing delimiter, not at an apostrophe in
  // JSON text (for example, "What's next?").
  const divRe = /<div\s+class="thalamus-(ask|mcq|flashcards|pathway)"\s+data-(?:ask|mcq|flashcards|pathway)='([\s\S]*?)'><\/div>/g;
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

  // 3) Legacy tool tags are still emitted by some providers. A tool-only reply
  // is often only ~50 characters, so failing to hydrate it looks exactly like a
  // stream that completed and then vanished.
  const legacyOpen = "(?:<<|‹‹|«|‹)";
  const legacyClose = "(?:>>|››|»|›)";
  const legacyQuestionRe = new RegExp(
    legacyOpen + "ASK-QUESTION\\s+question=\"([^\"]+)\"\\s*/?" + legacyClose,
    "g",
  );
  while ((m = legacyQuestionRe.exec(content)) !== null) {
    out.push({
      op: "ask-question",
      data: { type: "question", question: m[1], submitDirectly: true },
      start: m.index,
      end: m.index + m[0].length,
    });
  }
  const legacyMcqRe = new RegExp(
    legacyOpen +
      "ASK-MCQ\\s+question=\"([^\"]+)\"\\s+options='([^']+)'\\s+correct=\"([^\"]+)\"\\s*/?" +
      legacyClose,
    "g",
  );
  while ((m = legacyMcqRe.exec(content)) !== null) {
    try {
      const options = JSON.parse(m[2]) as unknown;
      if (!Array.isArray(options)) continue;
      out.push({
        op: "ask-mcq",
        data: {
          type: "mcq",
          question: m[1],
          options: options.map(String),
          correct: Number.parseInt(m[3], 10),
        },
        start: m.index,
        end: m.index + m[0].length,
      });
    } catch { /* skip malformed legacy MCQ */ }
  }

  out.sort((a, b) => a.start - b.start);
  return out;
}

// ── Widgets ─────────────────────────────────────────────────────────────────

function AskWidget({
  data,
  itemId,
  onAnswer,
}: {
  data: AskData;
  itemId?: string;
  onAnswer?: (q: string, a: string) => void;
}) {
  const { completeItem, gradeAnswer, report } = useStudyTaskContext();
  const wrapRef = useRef<HTMLDivElement>(null);
  const [text, setText] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [grading, setGrading] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [decision, setDecision] = useState<"retry-same" | "retry-different" | "move-on" | null>(null);
  const [followUp, setFollowUp] = useState<string | undefined>(undefined);
  const [shakeKey, setShakeKey] = useState(0);
  const [reward, setReward] = useState<string | null>(null);

  const submit = async () => {
    const t = text.trim();
    if (!t) return;
    sfx.click();
    if (gradeAnswer && !data.submitDirectly) {
      setGrading(true);
      try {
        const res = await gradeAnswer(data.question, t, attempt);
        setFeedback(res.feedback);
        setDecision(res.decision);
        setFollowUp(res.followUpQuestion);
        setAttempt(a => a + 1);
        if (res.correct) {
          sfx.correct();
          report?.(true);
          celebrateAt(wrapRef.current);
          setReward("+10 XP");
          if (itemId) completeItem?.(itemId, true);
          // The inline grader supplies instant feedback; the conversation still
          // needs the answer so the tutor can continue to its next teaching turn.
          onAnswer?.(data.question, t);
        } else {
          sfx.wrong();
          report?.(false);
          setShakeKey(k => k + 1);
        }
        setText("");
      } catch {
        // Fall back to sending as a normal chat message.
        setGrading(false);
        onAnswer?.(data.question, t);
        setText("");
      } finally {
        setGrading(false);
      }
      return;
    }
    onAnswer?.(data.question, t);
    setText("");
  };

  return (
    <div ref={wrapRef} className="relative my-2">
      {reward && <FloatingReward label={reward} onDone={() => setReward(null)} />}
      <div key={shakeKey} className={`rounded-xl border border-indigo-500/30 bg-indigo-500/5 p-3 space-y-2 ${shakeKey > 0 ? "study-shake" : ""}`}>
        <p className="text-xs font-semibold text-indigo-400 uppercase tracking-wider">Question</p>
        <p className="text-sm text-foreground leading-relaxed">{data.question}</p>

        {/* Input — kept active while decision is retry-same; cleared on move-on */}
        {decision !== "move-on" && (
          <>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); } }}
              rows={2}
              placeholder={decision === "retry-same" ? "Try again with that hint…" : "Type your answer here…"}
              className="w-full resize-none rounded-lg border border-border bg-background px-2.5 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-indigo-400/60"
            />
            <div className="flex justify-end">
              <button
                onClick={submit}
                disabled={!text.trim() || grading}
                className="flex items-center gap-1.5 rounded-lg bg-indigo-500 text-white px-3 py-1.5 text-xs font-medium hover:bg-indigo-500/90 disabled:opacity-40 transition-colors"
              >
                {grading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                {grading ? "Grading…" : "Submit answer"}
              </button>
            </div>
          </>
        )}

        {/* Inline AI feedback */}
        {feedback && (
          <div className={`rounded-lg border px-3 py-2 text-sm leading-relaxed ${decision === "move-on" ? "border-emerald-500/40 bg-emerald-500/5 text-foreground" : "border-indigo-500/40 bg-indigo-500/5 text-foreground"}`}>
            {feedback}
          </div>
        )}

        {/* Follow-up question on retry-different */}
        {decision === "retry-different" && followUp && (
          <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 px-3 py-2">
            <p className="text-[10px] font-semibold text-amber-500 uppercase tracking-wider mb-1">Fresh angle</p>
            <p className="text-sm text-foreground leading-relaxed">{followUp}</p>
          </div>
        )}

        {/* Done state */}
        {decision === "move-on" && (
          <div className="flex items-center gap-1.5 text-xs text-emerald-500">
            <Check className="h-4 w-4" /> Nice — moving on.
          </div>
        )}
      </div>
    </div>
  );
}

function McqWidget({
  data,
  itemId,
  onAnswer,
}: {
  data: McqData;
  itemId?: string;
  onAnswer?: (q: string, a: string) => void;
}) {
  const { completeItem, report } = useStudyTaskContext();
  const wrapRef = useRef<HTMLDivElement>(null);
  const multi = data.multiSelect === true || Array.isArray(data.correct);
  const [selected, setSelected] = useState<number[]>([]);
  const [submitted, setSubmitted] = useState(false);
  const [shakeKey, setShakeKey] = useState(0);
  const [reward, setReward] = useState<string | null>(null);
  const correctArr = Array.isArray(data.correct) ? data.correct : [data.correct];

  const toggle = (i: number) => {
    if (submitted) return;
    sfx.click();
    setSelected(prev => multi ? (prev.includes(i) ? prev.filter(x => x !== i) : [...prev, i]) : [i]);
  };
  const submit = () => {
    if (selected.length === 0 || !onAnswer) return;
    setSubmitted(true);
    const ok = multi
      ? selected.length === correctArr.length && selected.every(s => correctArr.includes(s))
      : selected[0] === correctArr[0];
    if (ok) {
      sfx.correct();
      report?.(true);
      celebrateAt(wrapRef.current);
      setReward("+10 XP");
    } else {
      sfx.wrong();
      report?.(false);
      setShakeKey(k => k + 1);
    }
    if (itemId) completeItem?.(itemId, ok);
    onAnswer(data.question, selected.map(i => data.options[i]).join(", "));
  };

  return (
    <div ref={wrapRef} className="relative my-2">
      {reward && <FloatingReward label={reward} onDone={() => setReward(null)} />}
      <div key={shakeKey} className={`rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-3 space-y-2 ${shakeKey > 0 ? "study-shake" : ""}`}>
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
              <motion.label
                key={i}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.05, duration: 0.2 }}
                className={`flex items-center gap-2.5 rounded-lg border px-3 py-2 cursor-pointer transition-colors ${cls} ${
                  submitted && isSelected && isCorrect ? "study-pop" : ""
                }`}
              >
                <input type={multi ? "checkbox" : "radio"} checked={isSelected} onChange={() => toggle(i)} disabled={submitted} className="accent-emerald-500" />
                <span className={`study-opt-badge ${submitted && isCorrect ? "text-emerald-400" : submitted && isSelected ? "text-red-400" : "text-muted-foreground"}`}>
                  {OPTION_LETTERS[i] ?? i + 1}
                </span>
                <span className="text-sm text-foreground flex-1">{opt}</span>
                {submitted && isCorrect && <Check className="h-4 w-4 text-emerald-500 shrink-0" />}
                {submitted && isSelected && !isCorrect && <X className="h-4 w-4 text-red-400 shrink-0" />}
              </motion.label>
            );
          })}
        </div>
        <div className="flex justify-end">
          {submitted ? (
            <span className="text-xs text-muted-foreground">
              {itemId ? "Locked in — nice work!" : "Answer sent — I'll grade it."}
            </span>
          ) : (
            <button onClick={submit} disabled={selected.length === 0} className="flex items-center gap-1.5 rounded-lg bg-emerald-500 text-white px-3 py-1.5 text-xs font-medium hover:bg-emerald-500/90 disabled:opacity-40 transition-colors">
              <Send className="h-3.5 w-3.5" /> Submit answer
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function widgetFor(
  op: string,
  data: Record<string, unknown>,
  onAnswer?: (q: string, a: string) => void,
  renderQuestions = true,
): React.ReactNode {
  const itemId = typeof data.id === "string" ? data.id : undefined;
  const ids = Array.isArray(data.ids) ? data.ids.map(String) : undefined;
  switch (op) {
    case "ask-question": {
      if (!renderQuestions) return null;
      const question = String(data.question ?? "");
      if (!question) return null;
      return <AskWidget data={{ type: "question", question }} itemId={itemId} onAnswer={onAnswer} />;
    }
    case "ask-mcq": {
      if (!renderQuestions) return null;
      const question = String(data.question ?? "");
      const options = Array.isArray(data.options) ? data.options.map(String) : [];
      const c = data.correct;
      const correct = Array.isArray(c) ? c.map(Number) : Number(c);
      const multiSelect = Array.isArray(c) || data.multiSelect === true;
      if (!question || options.length === 0) return null;
      return <McqWidget data={{ type: "mcq", question, options, correct, multiSelect }} itemId={itemId} onAnswer={onAnswer} />;
    }
    case "flashcards": {
      const cards = Array.isArray(data.cards)
        ? data.cards.filter((c): c is { front: string; back: string } => !!c && typeof (c as { front?: string }).front === "string" && typeof (c as { back?: string }).back === "string")
        : [];
      if (cards.length === 0) return null;
      return <FlashcardDeck cards={cards} deckItemIds={ids} />;
    }
    case "pathway": {
      const title = String(data.title ?? "Learning path");
      const steps = Array.isArray(data.steps) ? data.steps : [];
      if (steps.length === 0) return null;
      return <LearningPathway title={title} steps={steps} stepItemIds={ids} onAnswer={onAnswer} />;
    }
    default:
      return null;
  }
}

/** The active study question rendered in place of the normal prompt box. */
export function StudyComposerQuestion({
  prompt,
  onAnswer,
}: {
  prompt: StudyQuestionPrompt;
  onAnswer: (question: string, answer: string) => void;
}) {
  return (
    <div className="composer-accent max-h-[48vh] overflow-y-auto rounded-2xl border border-border bg-card px-1.5 shadow-sm">
      {widgetFor(prompt.op, prompt.data, onAnswer)}
    </div>
  );
}

// Prose styling for react-markdown output (headings, lists, tables, code).
const PROSE_CLASS =
  "prose-html text-[15px] leading-relaxed";

const StudyQuestionHydrator = memo(function StudyQuestionHydrator({
  html,
  onAnswer,
  renderQuestions = true,
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
    // The op is often wrapped in a ```json fence. That means this slice carries
    // the closing ``` of the PREVIOUS op's fence at its start and the opening
    // ```json of THIS op's fence at its end. If we leave either behind, the
    // lone ``` makes react-markdown treat the rest of the prose as a fenced
    // code block, so the markdown (##, **) renders as literal text. Strip a
    // leading ``` / ```json AND a trailing ```json / ```.
    let proseBefore = content.slice(cursor, op.start);
    proseBefore = stripOpFences(proseBefore);
    if (proseBefore.trim()) segments.push({ kind: "prose", text: proseBefore });
    segments.push({ kind: "widget", op: op.op, data: op.data });
    cursor = op.end;
  }
  // Trailing prose after the last op — again strip a leftover closing fence.
  const trailing = stripOpFences(content.slice(cursor));

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
        const widget = widgetFor(seg.op!, seg.data!, onAnswer, renderQuestions);
        return widget ? <div key={`w${i}`}>{widget}</div> : null;
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
