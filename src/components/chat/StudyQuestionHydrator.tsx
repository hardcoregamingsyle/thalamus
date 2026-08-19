// Hydrates the study-mode interactive question markers the backend emits into
// real, usable widgets. The backend turns {"op":"ask-question",...} and
// {"op":"ask-mcq",...} JSON ops into empty placeholder divs:
//   <div class="thalamus-ask" data-ask='{"type":"question","question":"..."}'></div>
//   <div class="thalamus-mcq" data-mcq='{"type":"mcq","question":"...","options":[...],"correct":0|[...],"multiSelect":bool}'></div>
// DOMPurify keeps the data-ask/data-mcq attributes, so after rendering we scan
// the DOM for them, parse the JSON, and replace each placeholder with a proper
// React widget via createPortal — a text input for ask-question, radio buttons
// for single-select MCQs, checkboxes for multi-select MCQs. Submitting an
// answer invokes onAnswer(question, answerText) so the caller can send it back
// into the chat.

import { memo, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, Send } from "lucide-react";
import MathRenderer from "@/components/MathRenderer";

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

export type QuestionData = AskData | McqData;

interface HydratedQuestion {
  id: number;
  el: HTMLElement;
  data: QuestionData;
}

interface StudyQuestionHydratorProps {
  html: string;
  accentText?: string;
  onAnswer?: (question: string, answer: string) => void;
}

// ── Individual question widgets ─────────────────────────────────────────────

function AskWidget({
  data,
  onAnswer,
}: {
  data: AskData;
  onAnswer?: (q: string, a: string) => void;
}) {
  const [text, setText] = useState("");
  const submit = () => {
    const t = text.trim();
    if (!t || !onAnswer) return;
    onAnswer(data.question, t);
    setText("");
  };
  return (
    <div className="rounded-xl border border-indigo-500/30 bg-indigo-500/5 p-3 space-y-2">
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

function McqWidget({
  data,
  onAnswer,
}: {
  data: McqData;
  onAnswer?: (q: string, a: string) => void;
}) {
  const multi = data.multiSelect === true || Array.isArray(data.correct);
  const [selected, setSelected] = useState<number[]>([]);
  const [submitted, setSubmitted] = useState(false);

  const correctArr = Array.isArray(data.correct) ? data.correct : [data.correct];

  const toggle = (i: number) => {
    if (submitted) return;
    setSelected(prev => multi
      ? (prev.includes(i) ? prev.filter(x => x !== i) : [...prev, i])
      : [i]);
  };

  const submit = () => {
    if (selected.length === 0 || !onAnswer) return;
    setSubmitted(true);
    const chosen = selected.map(i => data.options[i]).join(", ");
    onAnswer(data.question, chosen);
  };

  return (
    <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-3 space-y-2">
      <p className="text-xs font-semibold text-emerald-500 uppercase tracking-wider">
        {multi ? "Multiple Choice — select all that apply" : "Multiple Choice"}
      </p>
      <p className="text-sm text-foreground leading-relaxed">{data.question}</p>
      <div className="space-y-1.5">
        {data.options.map((opt, i) => {
          const isSelected = selected.includes(i);
          const isCorrect = correctArr.includes(i);
          const showState = submitted;
          let cls = "border-border bg-background";
          if (showState && isCorrect) cls = "border-emerald-500/60 bg-emerald-500/10";
          else if (showState && isSelected) cls = "border-red-500/60 bg-red-500/10";
          else if (isSelected) cls = "border-emerald-500/50 bg-emerald-500/5";
          return (
            <label
              key={i}
              className={`flex items-center gap-2.5 rounded-lg border px-3 py-2 cursor-pointer transition-colors ${cls}`}
            >
              <input
                type={multi ? "checkbox" : "radio"}
                checked={isSelected}
                onChange={() => toggle(i)}
                disabled={submitted}
                className="accent-emerald-500"
              />
              <span className="text-sm text-foreground flex-1">{opt}</span>
              {showState && isCorrect && <Check className="h-4 w-4 text-emerald-500 shrink-0" />}
            </label>
          );
        })}
      </div>
      <div className="flex justify-end">
        {submitted ? (
          <span className="text-xs text-muted-foreground">Answer sent — I'll grade it.</span>
        ) : (
          <button
            onClick={submit}
            disabled={selected.length === 0}
            className="flex items-center gap-1.5 rounded-lg bg-emerald-500 text-white px-3 py-1.5 text-xs font-medium hover:bg-emerald-500/90 disabled:opacity-40 transition-colors"
          >
            <Send className="h-3.5 w-3.5" /> Submit answer
          </button>
        )}
      </div>
    </div>
  );
}

// ── Hydrator ────────────────────────────────────────────────────────────────

const StudyQuestionHydrator = memo(function StudyQuestionHydrator({
  html,
  onAnswer,
}: StudyQuestionHydratorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [questions, setQuestions] = useState<HydratedQuestion[]>([]);
  const prevHtmlRef = useRef<string | null>(null);

  // After the sanitized HTML is rendered, find the question placeholders and
  // replace each with a live mount node (React portal target).
  useEffect(() => {
    const root = containerRef.current;
    if (!root) return;
    if (prevHtmlRef.current === html) return; // html unchanged — no re-hydrate
    prevHtmlRef.current = html;

    const found: HydratedQuestion[] = [];
    const nodes = Array.from(root.querySelectorAll<HTMLElement>("[data-ask],[data-mcq]"));
    nodes.forEach((node, idx) => {
      const rawAsk = node.getAttribute("data-ask");
      const rawMcq = node.getAttribute("data-mcq");
      let data: QuestionData | null = null;
      try {
        if (rawAsk) data = JSON.parse(rawAsk) as QuestionData;
        else if (rawMcq) data = JSON.parse(rawMcq) as QuestionData;
      } catch { /* skip malformed */ }
      if (!data) return;
      // Replace the placeholder with a mount node for the widget.
      const mount = document.createElement("div");
      mount.className = "thalamus-question-mount";
      node.replaceWith(mount);
      found.push({ id: idx, el: mount, data });
    });

    setQuestions(found);
  }, [html]);

  return (
    <div>
      {/* Render the full sanitized HTML with math/formatting, then hydrate the
          question placeholders inside it. */}
      <div ref={containerRef}>
        <MathRenderer html={html} className="text-[15px] leading-relaxed" />
      </div>
      {questions.map(q => (
        <div key={q.id}>
          {q.el.isConnected &&
            createPortal(
              q.data.type === "question"
                ? <AskWidget data={q.data} onAnswer={onAnswer} />
                : <McqWidget data={q.data} onAnswer={onAnswer} />,
              q.el,
            )}
        </div>
      ))}
    </div>
  );
});

export default StudyQuestionHydrator;
