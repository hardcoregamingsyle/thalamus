// Session-local gamification state for study mode. Tracks XP, level, streaks
// and stars as a kid answers questions/flashcards/pathway steps. This is a
// pure client-side tally for the "game feel" — the persisted task lock is
// handled separately by useStudyTask. Resets on reload (each study session
// feels like a fresh little game).

import { useCallback, useMemo, useState } from "react";

const XP_PER_CORRECT = 10;
const XP_PER_LEVEL = 50; // level up every 50 XP

export interface Gamification {
  xp: number;
  level: number;
  levelProgress: number; // 0..1
  streak: number;
  bestStreak: number;
  stars: number;
  correctCount: number;
  wrongCount: number;
  report: (correct: boolean) => void;
  reset: () => void;
  justLevelledUp: boolean;
}

export function useGamification(): Gamification {
  const [xp, setXp] = useState(0);
  const [streak, setStreak] = useState(0);
  const [bestStreak, setBestStreak] = useState(0);
  const [stars, setStars] = useState(0);
  const [correctCount, setCorrectCount] = useState(0);
  const [wrongCount, setWrongCount] = useState(0);
  const [justLevelledUp, setJustLevelledUp] = useState(false);

  const report = useCallback((correct: boolean) => {
    if (correct) {
      setXp((x) => {
        const before = x;
        const after = x + XP_PER_CORRECT;
        // Level up the moment we cross an XP_PER_LEVEL boundary.
        if (Math.floor(after / XP_PER_LEVEL) > Math.floor(before / XP_PER_LEVEL)) {
          setJustLevelledUp(true);
          setTimeout(() => setJustLevelledUp(false), 1600);
        }
        return after;
      });
      setStars((s) => s + 1);
      setCorrectCount((c) => c + 1);
      setStreak((s) => {
        const n = s + 1;
        setBestStreak((b) => Math.max(b, n));
        return n;
      });
    } else {
      setStreak(0);
      setWrongCount((w) => w + 1);
    }
  }, []);

  const reset = useCallback(() => {
    setXp(0);
    setStreak(0);
    setBestStreak(0);
    setStars(0);
    setCorrectCount(0);
    setWrongCount(0);
    setJustLevelledUp(false);
  }, []);

  const level = Math.floor(xp / XP_PER_LEVEL) + 1;
  const levelProgress = (xp % XP_PER_LEVEL) / XP_PER_LEVEL;

  return useMemo(
    () => ({
      xp,
      level,
      levelProgress,
      streak,
      bestStreak,
      stars,
      correctCount,
      wrongCount,
      report,
      reset,
      justLevelledUp,
    }),
    [xp, level, levelProgress, streak, bestStreak, stars, correctCount, wrongCount, report, reset, justLevelledUp],
  );
}

export const GAMIFICATION = { XP_PER_CORRECT, XP_PER_LEVEL };
