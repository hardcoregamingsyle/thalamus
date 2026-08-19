// Full-screen celebration shown the moment a kid finishes an entire study
// task (every question, flashcard and pathway step done). A trophy, their
// session stats, and a confetti rain in the background. Fires once per task
// completion, auto-dismisses after a few seconds.

import { useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Flame, Medal, Star, Trophy, Zap } from "lucide-react";
import { confettiRain, stopConfetti } from "@/lib/confetti";
import { sfx } from "@/lib/sfx";

interface StudyCelebrationProps {
  open: boolean;
  xp: number;
  stars: number;
  streak: number;
  bestStreak: number;
  onPlayAgain: () => void;
  onClose: () => void;
}

export default function StudyCelebration({
  open,
  xp,
  stars,
  streak,
  bestStreak,
  onPlayAgain,
  onClose,
}: StudyCelebrationProps) {
  useEffect(() => {
    if (!open) return;
    sfx.tada();
    confettiRain(1800);
    const t = setTimeout(() => {
      stopConfetti();
      onClose();
    }, 5200);
    return () => {
      clearTimeout(t);
      stopConfetti();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] bg-background/80 backdrop-blur-md"
            onClick={onClose}
          />
          <div className="fixed inset-0 z-[101] flex items-center justify-center p-4 pointer-events-none">
            <motion.div
              initial={{ scale: 0.6, y: 40, opacity: 0 }}
              animate={{ scale: 1, y: 0, opacity: 1 }}
              transition={{ type: "spring", stiffness: 260, damping: 20 }}
              className="pointer-events-auto w-full max-w-sm rounded-3xl border border-amber-400/30 bg-card p-6 text-center shadow-2xl"
              style={{ boxShadow: "0 0 60px oklch(0.8 0.16 85 / 0.25)" }}
            >
              <motion.div
                animate={{ y: [0, -10, 0], rotate: [0, -4, 4, 0] }}
                transition={{ duration: 1.4, repeat: Infinity }}
                className="mx-auto mb-2 flex h-16 w-16 items-center justify-center rounded-full border border-amber-400/40 bg-amber-400/15"
                style={{ boxShadow: "0 0 24px oklch(0.8 0.16 85 / 0.5)" }}
              >
                <Trophy className="h-8 w-8 text-amber-300" />
              </motion.div>

              <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-emerald-400">
                Task complete
              </p>
              <h2 className="mt-1 text-2xl font-extrabold text-foreground">Way to go!</h2>

              {/* Stats */}
              <div className="mt-4 grid grid-cols-3 gap-2">
                <div className="rounded-xl border border-border bg-muted/40 p-2.5">
                  <Zap className="mx-auto h-4 w-4 text-amber-300" />
                  <p className="mt-1 text-lg font-extrabold text-foreground">{xp}</p>
                  <p className="text-[10px] text-muted-foreground">XP earned</p>
                </div>
                <div className="rounded-xl border border-border bg-muted/40 p-2.5">
                  <Star className="mx-auto h-4 w-4 text-amber-300" />
                  <p className="mt-1 text-lg font-extrabold text-foreground">{stars}</p>
                  <p className="text-[10px] text-muted-foreground">Stars</p>
                </div>
                <div className="rounded-xl border border-border bg-muted/40 p-2.5">
                  <Flame className="mx-auto h-4 w-4 text-orange-300" />
                  <p className="mt-1 text-lg font-extrabold text-foreground">{bestStreak}</p>
                  <p className="text-[10px] text-muted-foreground">Best streak</p>
                </div>
              </div>

              <p className="mt-3 text-xs text-muted-foreground">
                {streak > 0 ? `Ended on a ${streak}-answer streak. Keep it going!` : "Review your cards to build a streak."}
              </p>

              <div className="mt-5 flex gap-2">
                <button
                  onClick={() => {
                    stopConfetti();
                    onClose();
                  }}
                  className="flex-1 rounded-xl border border-border px-3 py-2.5 text-sm font-semibold text-muted-foreground hover:bg-muted transition-colors"
                >
                  Keep exploring
                </button>
                <button
                  onClick={() => {
                    stopConfetti();
                    onPlayAgain();
                  }}
                  className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-amber-400 px-3 py-2.5 text-sm font-bold text-amber-950 hover:bg-amber-300 transition-colors"
                  style={{ boxShadow: "0 4px 18px oklch(0.8 0.16 85 / 0.4)" }}
                >
                  <Medal className="h-4 w-4" /> Play again
                </button>
              </div>
            </motion.div>
          </div>
        </>
      )}
    </AnimatePresence>
  );
}
