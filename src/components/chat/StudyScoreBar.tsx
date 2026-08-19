// Compact gamified score bar for study mode. Shows the kid's level, an XP
// progress bar that fills as they earn points, their current streak and stars
// collected. When an interactive study task is active it also shows how many
// of the required items are done. Pure presentational — all values come from
// the study gamification + task context.

import { memo } from "react";
import { motion } from "framer-motion";
import { Flame, Sparkles, Star } from "lucide-react";
import { GAMIFICATION } from "@/hooks/use-gamification";

interface StudyScoreBarProps {
  xp: number;
  level: number;
  levelProgress: number; // 0..1
  streak: number;
  stars: number;
  bestStreak: number;
  task?: { completed: number; total: number } | null;
}

const StudyScoreBar = memo(function StudyScoreBar({
  xp,
  level,
  levelProgress,
  streak,
  stars,
  bestStreak,
  task,
}: StudyScoreBarProps) {
  const taskDone = task ? task.completed / Math.max(1, task.total) : 1;

  return (
    <div className="mb-2.5 rounded-xl border border-border/70 bg-muted/30 px-3 py-2">
      <div className="flex items-center gap-3">
        {/* Level badge */}
        <motion.div
          key={level}
          initial={{ scale: 0.6, rotate: -12 }}
          animate={{ scale: 1, rotate: 0 }}
          transition={{ type: "spring", stiffness: 400, damping: 15 }}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-amber-400/40 bg-amber-400/15 text-[13px] font-extrabold text-amber-300"
          style={{ boxShadow: "0 0 12px oklch(0.8 0.16 85 / 0.35)" }}
          title={`Level ${level}`}
        >
          {level}
        </motion.div>

        {/* XP bar */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            <span className="flex items-center gap-1">
              <Sparkles className="h-3 w-3 text-amber-300" />
              XP · Level {level}
            </span>
            <span>
              {xp}/{level * GAMIFICATION.XP_PER_LEVEL}
            </span>
          </div>
          <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-border/50">
            <motion.div
              className="h-full rounded-full"
              style={{
                background: "linear-gradient(90deg, #fbbf24, #f59e0b, #fb923c)",
                boxShadow: "0 0 8px oklch(0.8 0.16 85 / 0.5)",
              }}
              animate={{ width: `${Math.round(levelProgress * 100)}%` }}
              transition={{ type: "spring", stiffness: 120, damping: 20 }}
            />
          </div>
        </div>

        {/* Task progress (when locked) */}
        {task && task.total > 0 && (
          <div className="hidden sm:block w-24 shrink-0">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-indigo-300">
              Task {task.completed}/{task.total}
            </div>
            <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-border/50">
              <motion.div
                className="h-full rounded-full bg-indigo-400"
                animate={{ width: `${Math.round(taskDone * 100)}%` }}
                transition={{ type: "spring", stiffness: 120, damping: 20 }}
              />
            </div>
          </div>
        )}
      </div>

      {/* Streak + stars */}
      <div className="mt-1.5 flex items-center gap-3 text-[11px]">
        <span className="flex items-center gap-1 font-semibold text-orange-300">
          <Flame
            className={`h-3.5 w-3.5 ${streak >= 3 ? "animate-pulse" : ""}`}
            style={streak >= 3 ? { filter: "drop-shadow(0 0 6px oklch(0.7 0.2 45 / 0.7))" } : undefined}
          />
          {streak} streak{streak > 0 ? ` · best ${bestStreak}` : ""}
        </span>
        <span className="flex items-center gap-1 font-semibold text-amber-300">
          <Star className="h-3.5 w-3.5 fill-amber-300" />
          {stars} stars
        </span>
        {levelProgress >= 1 && (
          <span className="ml-auto flex items-center gap-1 text-emerald-300">
            <Sparkles className="h-3.5 w-3.5 animate-pulse" />
            Level up!
          </span>
        )}
      </div>
    </div>
  );
});

export default StudyScoreBar;
