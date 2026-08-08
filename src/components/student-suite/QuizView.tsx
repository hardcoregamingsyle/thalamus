// StudentSuite quiz view — one question at a time with immediate feedback,
// streak/score tracking, and a results screen. Wrong answers are surfaced to
// the mistake-review view via quizAnswers in the shell.

import { motion } from "framer-motion";
import {
  CheckCircle, ChevronRight, Loader2, RefreshCw, Star, Trophy, XCircle, Zap,
} from "lucide-react";
import type { QuizPhase, QuizQuestion } from "./types";

export interface QuizViewProps {
  quizQuestions: QuizQuestion[];
  quizPhase: QuizPhase;
  quizIndex: number;
  quizAnswers: Record<number, number>;
  quizSelected: number | null;
  quizShowAnswer: boolean;
  quizScore: number;
  quizStreak: number;
  quizMaxStreak: number;
  isLoading: boolean;
  onAnswer: (optionIndex: number) => void;
  onNext: () => void;
  onNewQuiz: () => void;
}

export default function QuizView({
  quizQuestions,
  quizPhase,
  quizIndex,
  quizAnswers,
  quizSelected,
  quizShowAnswer,
  quizScore,
  quizStreak,
  quizMaxStreak,
  isLoading,
  onAnswer,
  onNext,
  onNewQuiz,
}: QuizViewProps) {
  if (quizQuestions.length > 0 && quizPhase === "quiz") {
    return (
      <motion.div key="quiz" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="p-4 space-y-4">
        {/* Score bar */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1 px-2 py-1 bg-emerald-400/10 border border-emerald-400/30 rounded-lg">
              <Star className="h-3 w-3 text-emerald-400" />
              <span className="text-[11px] font-bold text-emerald-400">{quizScore}</span>
            </div>
            {quizStreak >= 2 && (
              <div className="flex items-center gap-1 px-2 py-1 bg-amber-400/10 border border-amber-400/30 rounded-lg">
                <Zap className="h-3 w-3 text-amber-400" />
                <span className="text-[11px] font-bold text-amber-400">{quizStreak}x streak!</span>
              </div>
            )}
          </div>
          <span className="text-[11px] text-muted-foreground">{quizIndex + 1}/{quizQuestions.length}</span>
        </div>

        {/* Progress */}
        <div className="w-full bg-border/30 rounded-full h-1.5">
          <div className="bg-emerald-400 h-1.5 rounded-full transition-all" style={{ width: `${((quizIndex + 1) / quizQuestions.length) * 100}%` }} />
        </div>

        {/* Question */}
        <div className="p-4 bg-emerald-400/8 border border-emerald-400/25 rounded-xl">
          <p className="text-[10px] text-emerald-400 font-bold mb-2">{quizQuestions[quizIndex]?.topic}</p>
          <p className="text-sm font-semibold text-foreground leading-relaxed">{quizQuestions[quizIndex]?.question}</p>
        </div>

        {/* Options */}
        <div className="space-y-2">
          {quizQuestions[quizIndex]?.options.map((opt, oi) => {
            const isSelected = quizSelected === oi;
            const isCorrect = oi === quizQuestions[quizIndex].correctIndex;
            let cls = "bg-card border-border text-muted-foreground hover:border-emerald-400/30 hover:text-foreground";
            if (quizShowAnswer) {
              if (isCorrect) cls = "bg-emerald-400/15 border-emerald-400/40 text-emerald-300 font-bold";
              else if (isSelected && !isCorrect) cls = "bg-red-400/15 border-red-400/40 text-red-300";
              else cls = "bg-card border-border text-muted-foreground opacity-50";
            } else if (isSelected) {
              cls = "bg-emerald-400/10 border-emerald-400/30 text-foreground";
            }
            return (
              <button
                key={oi}
                onClick={() => onAnswer(oi)}
                disabled={quizShowAnswer}
                className={`w-full text-left px-3 py-2.5 rounded-xl text-[11px] border transition-all ${cls}`}
              >
                <span className="font-bold mr-2">{String.fromCharCode(65 + oi)}.</span>{opt}
              </button>
            );
          })}
        </div>

        {/* Explanation */}
        {quizShowAnswer && (
          <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="p-3 bg-card border border-border rounded-xl">
            <p className="text-[10px] text-muted-foreground leading-relaxed">{quizQuestions[quizIndex]?.explanation}</p>
          </motion.div>
        )}

        {quizShowAnswer && (
          <button
            onClick={onNext}
            className="w-full py-2.5 bg-emerald-500 text-white font-bold text-sm rounded-xl hover:bg-emerald-600 transition-all flex items-center justify-center gap-2"
          >
            {quizIndex >= quizQuestions.length - 1 ? <><Trophy className="h-4 w-4" />See Results</> : <>Next Question <ChevronRight className="h-4 w-4" /></>}
          </button>
        )}
      </motion.div>
    );
  }

  if (quizPhase === "results") {
    return (
      <motion.div key="quizresults" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="p-6 space-y-4">
        <div className="text-center">
          <div className="text-5xl mb-3">
            {quizScore >= 13 ? "🏆" : quizScore >= 10 ? "🎉" : quizScore >= 7 ? "👍" : "📚"}
          </div>
          <p className="text-2xl font-black text-foreground">{quizScore}/{quizQuestions.length}</p>
          <p className="text-sm text-muted-foreground mt-1">
            {quizScore >= 13 ? "Outstanding! You're exam-ready!" : quizScore >= 10 ? "Great job! Keep it up!" : quizScore >= 7 ? "Good effort! Review the missed ones." : "Keep studying — you'll get there!"}
          </p>
          {quizMaxStreak >= 3 && (
            <div className="mt-2 inline-flex items-center gap-1.5 px-3 py-1 bg-amber-400/10 border border-amber-400/30 rounded-full">
              <Zap className="h-3 w-3 text-amber-400" />
              <span className="text-[11px] text-amber-400 font-bold">Best streak: {quizMaxStreak}x</span>
            </div>
          )}
        </div>

        {/* Per-question review */}
        <div className="space-y-1.5">
          {quizQuestions.map((q) => {
            const answered = quizAnswers[q.id];
            const correct = answered === q.correctIndex;
            return (
              <div key={q.id} className={`flex items-start gap-2 p-2.5 rounded-lg border ${correct ? "bg-emerald-400/8 border-emerald-400/20" : "bg-red-400/8 border-red-400/20"}`}>
                {correct ? <CheckCircle className="h-3.5 w-3.5 text-emerald-400 shrink-0 mt-0.5" /> : <XCircle className="h-3.5 w-3.5 text-red-400 shrink-0 mt-0.5" />}
                <div className="min-w-0">
                  <p className="text-[10px] text-foreground line-clamp-1">{q.question}</p>
                  {!correct && <p className="text-[9px] text-emerald-400 mt-0.5">✓ {q.options[q.correctIndex]}</p>}
                </div>
              </div>
            );
          })}
        </div>

        <button
          onClick={onNewQuiz}
          disabled={isLoading}
          className="w-full py-2.5 bg-emerald-500 text-white font-bold text-sm rounded-xl hover:bg-emerald-600 disabled:opacity-50 transition-all flex items-center justify-center gap-2"
        >
          {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <><RefreshCw className="h-4 w-4" />New Quiz</>}
        </button>
      </motion.div>
    );
  }

  return null;
}
