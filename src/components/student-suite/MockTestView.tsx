// StudentSuite mock test view — the pre-submit paper (MCQ + written answers)
// and the post-submit results card with per-question feedback. The shell
// evaluates the paper via api.study.evaluateMockTest before flipping phase.

import { motion } from "framer-motion";
import { Loader2, RefreshCw, Zap } from "lucide-react";
import type { EvalResult, MockPhase, MockTest } from "./types";

function gradeColor(grade: string) {
  if (grade === "A+" || grade === "A") return "text-emerald-400";
  if (grade === "B") return "text-blue-400";
  if (grade === "C") return "text-amber-400";
  return "text-red-400";
}

export interface MockTestViewProps {
  mockTest: MockTest | null;
  mockPhase: MockPhase;
  mockAnswers: Record<number, string>;
  isEvaluating: boolean;
  evalResult: EvalResult | null;
  onAnswerChange: (id: number, value: string) => void;
  onSubmit: () => void;
  onRetake: () => void;
}

export default function MockTestView({
  mockTest,
  mockPhase,
  mockAnswers,
  isEvaluating,
  evalResult,
  onAnswerChange,
  onSubmit,
  onRetake,
}: MockTestViewProps) {
  if (mockTest && mockPhase === "test") {
    return (
      <motion.div key="mocktest" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="p-4 space-y-4">
        <div className="flex items-center gap-3 p-3 bg-purple-400/8 border border-purple-400/25 rounded-xl">
          <div>
            <p className="text-xs font-bold text-foreground">{mockTest.title}</p>
            <p className="text-[10px] text-muted-foreground">Total: {mockTest.totalMarks} marks · {mockTest.duration}</p>
          </div>
          <div className="ml-auto text-right">
            <p className="text-[10px] text-muted-foreground">Answered</p>
            <p className="text-sm font-bold text-purple-400">{Object.keys(mockAnswers).length}/{mockTest.sections.flatMap(s => s.questions).length}</p>
          </div>
        </div>

        {mockTest.sections.map((section, si) => (
          <div key={si} className="space-y-3">
            <div className="px-3 py-2 bg-card border border-border rounded-lg">
              <p className="text-[11px] font-bold text-foreground">{section.name}</p>
              <p className="text-[10px] text-muted-foreground">{section.instructions}</p>
            </div>
            {section.questions.map((q) => (
              <div key={q.id} className="p-3 bg-background border border-border rounded-xl space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-[11px] font-semibold text-foreground flex-1">{q.id}. {q.question}</p>
                  <span className="text-[9px] text-purple-400 border border-purple-400/30 bg-purple-400/10 px-1.5 py-0.5 rounded-full shrink-0">{q.marks}M</span>
                </div>
                {q.type === "mcq" && q.options && (
                  <div className="space-y-1.5">
                    {q.options.map((opt, oi) => (
                      <button
                        key={oi}
                        onClick={() => onAnswerChange(q.id, opt)}
                        className={`w-full text-left px-3 py-2 rounded-lg text-[11px] border transition-all ${mockAnswers[q.id] === opt ? "bg-purple-400/15 border-purple-400/40 text-purple-300 font-bold" : "bg-card border-border text-muted-foreground hover:border-purple-400/30 hover:text-foreground"}`}
                      >
                        {opt}
                      </button>
                    ))}
                  </div>
                )}
                {q.type !== "mcq" && (
                  <textarea
                    value={mockAnswers[q.id] ?? ""}
                    onChange={e => onAnswerChange(q.id, e.target.value)}
                    placeholder={q.type === "short" ? "Write your answer (2-3 sentences)..." : q.type === "long" ? "Write a detailed answer..." : q.type === "hots" ? "Apply your knowledge creatively..." : "Describe the diagram and explain..."}
                    rows={q.type === "long" || q.type === "hots" ? 4 : 2}
                    className="w-full bg-card border border-border rounded-lg px-2 py-1.5 text-[11px] text-foreground placeholder:text-muted-foreground resize-none focus:outline-none focus:border-purple-400/60 transition-colors"
                  />
                )}
              </div>
            ))}
          </div>
        ))}

        <button
          onClick={onSubmit}
          disabled={isEvaluating}
          className="w-full py-3 bg-purple-500 text-white font-bold text-sm rounded-xl hover:bg-purple-600 disabled:opacity-50 transition-all flex items-center justify-center gap-2"
        >
          {isEvaluating ? <><Loader2 className="h-4 w-4 animate-spin" />Evaluating...</> : <><Zap className="h-4 w-4" />Submit & Evaluate</>}
        </button>
      </motion.div>
    );
  }

  if (evalResult && mockPhase === "results") {
    return (
      <motion.div key="mockresults" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="p-4 space-y-4">
        {/* Score card */}
        <div className="p-4 bg-purple-400/8 border border-purple-400/25 rounded-2xl text-center">
          <p className="text-[10px] text-muted-foreground mb-1">Your Score</p>
          <p className="text-4xl font-black text-foreground">{evalResult.obtainedMarks}<span className="text-xl text-muted-foreground">/{evalResult.totalMarks}</span></p>
          <p className={`text-2xl font-bold mt-1 ${gradeColor(evalResult.grade)}`}>{evalResult.grade} · {evalResult.percentage}%</p>
          <p className="text-[11px] text-muted-foreground mt-2 leading-relaxed">{evalResult.overallFeedback}</p>
        </div>

        {/* Per-question feedback */}
        <div className="space-y-2">
          {evalResult.feedback.map(f => (
            <div key={f.id} className={`p-3 rounded-xl border ${f.correct ? "bg-emerald-400/8 border-emerald-400/25" : "bg-red-400/8 border-red-400/25"}`}>
              <div className="flex items-center justify-between mb-1">
                <span className="text-[11px] font-bold text-foreground">Q{f.id}</span>
                <span className={`text-[11px] font-bold ${f.correct ? "text-emerald-400" : "text-red-400"}`}>{f.marks}/{f.maxMarks} marks</span>
              </div>
              <p className="text-[10px] text-muted-foreground">{f.feedback}</p>
            </div>
          ))}
        </div>

        <button
          onClick={onRetake}
          className="w-full py-2.5 bg-card border border-border text-muted-foreground text-sm rounded-xl hover:bg-muted/50 transition-all flex items-center justify-center gap-2"
        >
          <RefreshCw className="h-4 w-4" /> Retake Test
        </button>
      </motion.div>
    );
  }

  return null;
}
