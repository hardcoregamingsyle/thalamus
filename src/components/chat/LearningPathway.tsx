// In-chat guided learning path hydrated from {"op":"pathway",...}. A titled
// sequence of steps, each a checkpoint question (single/multi select). The
// student advances through waypoints with animated progress, instant feedback,
// and sounds. Reaching the end shows a completion state.

import { memo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Check, Flag, Lock, Trophy } from "lucide-react";
import FloatingReward from "@/components/chat/FloatingReward";
import { sfx } from "@/lib/sfx";
import { bigCelebrateAt, celebrateAt } from "@/lib/vfx";
import { useStudyTaskContext } from "@/components/chat/StudyTaskContext";

export interface PathwayStep {
  topic?: string;
  question: string;
  options: string[];
  correct: number | number[];
  multiSelect?: boolean;
  explain?: string;
}

interface LearningPathwayProps {
  title: string;
  steps: PathwayStep[];
  stepItemIds?: string[];
  onAnswer?: (question: string, answer: string) => void;
}

const LearningPathway = memo(function LearningPathway({ title, steps, stepItemIds, onAnswer }: LearningPathwayProps) {
  const { completeItem, report } = useStudyTaskContext();
  const wrapRef = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(0);
  const [selected, setSelected] = useState<number[]>([]);
  const [checked, setChecked] = useState(false);
  const [correctCount, setCorrectCount] = useState(0);
  const [finished, setFinished] = useState(false);
  const [shakeKey, setShakeKey] = useState(0);
  const [reward, setReward] = useState<string | null>(null);

  const step = steps[index];
  if (!step) return null;
  const multi = step.multiSelect === true || Array.isArray(step.correct);
  const correctArr = Array.isArray(step.correct) ? step.correct : [step.correct];

  const toggle = (i: number) => {
    if (checked) return;
    sfx.click();
    setSelected(prev => multi ? (prev.includes(i) ? prev.filter(x => x !== i) : [...prev, i]) : [i]);
  };

  const check = () => {
    if (selected.length === 0) return;
    const ok = multi
      ? selected.length === correctArr.length && selected.every(s => correctArr.includes(s))
      : selected[0] === correctArr[0];
    setChecked(true);
    if (ok) {
      sfx.correct();
      setCorrectCount(c => c + 1);
      report?.(true);
      celebrateAt(wrapRef.current);
      setReward("+10 XP");
    } else {
      sfx.wrong();
      report?.(false);
      setShakeKey(k => k + 1);
    }
    // Mark this step done in the persisted task once answered.
    if (stepItemIds && stepItemIds[index]) completeItem?.(stepItemIds[index], true);
    if (onAnswer && !ok) {
      onAnswer(step.question, selected.map(i => step.options[i]).join(", "));
    }
  };

  const next = () => {
    sfx.advance();
    if (index >= steps.length - 1) {
      sfx.complete();
      bigCelebrateAt(wrapRef.current);
      setFinished(true);
    } else {
      setIndex(i => i + 1);
      setSelected([]);
      setChecked(false);
    }
  };

  if (finished) {
    return (
      <div ref={wrapRef} className="relative">
        {reward && <FloatingReward label={reward} onDone={() => setReward(null)} />}
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-6 text-center space-y-3"
        >
          <motion.div
            animate={{ y: [0, -8, 0] }}
            transition={{ duration: 1.2, repeat: Infinity }}
            className="mx-auto w-12 h-12 rounded-full bg-emerald-400/15 border border-emerald-400/30 flex items-center justify-center"
            style={{ boxShadow: "0 0 20px oklch(0.72 0.19 150 / 0.4)" }}
          >
            <Trophy className="h-6 w-6 text-emerald-400" />
          </motion.div>
          <p className="text-lg font-extrabold study-gold-text">Path complete!</p>
          <p className="text-xs text-muted-foreground">
            You answered {correctCount} of {steps.length} correctly on "{title}".
          </p>
          <p className="text-xs text-emerald-400 font-medium">Your tutor will bring this back later for spaced review.</p>
        </motion.div>
      </div>
    );
  }

  return (
    <div ref={wrapRef} className="relative">
      {reward && <FloatingReward label={reward} onDone={() => setReward(null)} />}
    <div key={shakeKey} className={`rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-3 space-y-3 ${shakeKey > 0 ? "study-shake" : ""}`}>
      {/* Title + waypoint map */}
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-bold text-emerald-500 uppercase tracking-wider truncate">{title}</p>
        <span className="text-[10px] text-muted-foreground shrink-0">{index + 1}/{steps.length}</span>
      </div>

      {/* Waypoints */}
      <div className="flex items-center gap-1.5">
        {steps.map((s, i) => {
          const done = i < index;
          const active = i === index;
          return (
            <motion.div
              key={i}
              className={`flex-1 h-1.5 rounded-full ${done ? "bg-emerald-400" : active ? "bg-emerald-400/60" : "bg-border/50"}`}
              animate={{ scale: active ? 1.2 : 1 }}
              transition={{ duration: 0.2 }}
            />
          );
        })}
      </div>

      <AnimatePresence mode="wait">
        <motion.div
          key={index}
          initial={{ opacity: 0, x: 24 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -24 }}
          transition={{ duration: 0.2 }}
          className="space-y-2"
        >
          {step.topic && (
            <p className="text-[10px] font-semibold text-emerald-500 flex items-center gap-1">
              <Flag className="h-3 w-3" /> {step.topic}
            </p>
          )}
          <p className="text-sm text-foreground leading-relaxed">{step.question}</p>

          <div className="space-y-1.5">
            {step.options.map((opt, i) => {
              const isSel = selected.includes(i);
              const isCorrect = correctArr.includes(i);
              let cls = "border-border bg-background";
              if (checked && isCorrect) cls = "border-emerald-500/60 bg-emerald-500/10";
              else if (checked && isSel) cls = "border-red-500/60 bg-red-500/10";
              else if (isSel) cls = "border-emerald-500/50 bg-emerald-500/5";
              return (
                <label
                  key={i}
                  className={`flex items-center gap-2.5 rounded-lg border px-3 py-2 cursor-pointer transition-colors ${cls}`}
                >
                  <input type={multi ? "checkbox" : "radio"} checked={isSel} onChange={() => toggle(i)} disabled={checked} className="accent-emerald-500" />
                  <span className="text-sm text-foreground flex-1">{opt}</span>
                  {checked && isCorrect && <Check className="h-4 w-4 text-emerald-500 shrink-0" />}
                </label>
              );
            })}
          </div>

          {checked && step.explain && (
            <p className="text-[11px] text-muted-foreground leading-relaxed border-l-2 border-emerald-500/40 pl-2">{step.explain}</p>
          )}
        </motion.div>
      </AnimatePresence>

      <div className="flex justify-end">
        {checked ? (
          <button
            onClick={next}
            className="flex items-center gap-1.5 rounded-lg bg-emerald-500 text-white px-3.5 py-1.5 text-xs font-medium hover:bg-emerald-500/90 transition-colors"
          >
            {index >= steps.length - 1 ? "Finish path" : "Next step"} <Lock className="h-3.5 w-3.5" />
          </button>
        ) : (
          <button
            onClick={check}
            disabled={selected.length === 0}
            className="flex items-center gap-1.5 rounded-lg bg-emerald-500 text-white px-3.5 py-1.5 text-xs font-medium hover:bg-emerald-500/90 disabled:opacity-40 transition-colors"
          >
            Check answer
          </button>
        )}
      </div>
    </div>
    </div>
  );
});

export default LearningPathway;
