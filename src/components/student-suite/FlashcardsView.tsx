// StudentSuite flashcards view — index + flip + known/still-learning tracking.
// Card list and progress live in the parent shell so quiz/mock feedback can
// feed misconceptionItems later.

import { motion } from "framer-motion";
import { CheckCircle, ChevronLeft, ChevronRight, RefreshCw, XCircle } from "lucide-react";
import type { Flashcard } from "./types";

export interface FlashcardsViewProps {
  flashcards: Flashcard[];
  cardIndex: number;
  cardFlipped: boolean;
  knownCards: Set<number>;
  onFlip: () => void;
  onPrev: () => void;
  onNextUnflipped: () => void;
  onMarkStillLearning: () => void;
  onMarkKnown: () => void;
  onReset: () => void;
}

export default function FlashcardsView({
  flashcards,
  cardIndex,
  cardFlipped,
  knownCards,
  onFlip,
  onPrev,
  onNextUnflipped,
  onMarkStillLearning,
  onMarkKnown,
  onReset,
}: FlashcardsViewProps) {
  return (
    <motion.div key="flashcards" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="p-6 flex flex-col items-center gap-4">
      {/* Progress */}
      <div className="w-full flex items-center justify-between text-[11px] text-muted-foreground">
        <span>{cardIndex + 1} / {flashcards.length}</span>
        <span className="text-emerald-400 font-bold">{knownCards.size} known ✓</span>
        <span className="text-indigo-400">{flashcards[cardIndex]?.topic}</span>
      </div>
      <div className="w-full bg-border/30 rounded-full h-1">
        <div className="bg-indigo-400 h-1 rounded-full transition-all" style={{ width: `${((cardIndex + 1) / flashcards.length) * 100}%` }} />
      </div>

      {/* Card */}
      <div
        className="w-full cursor-pointer"
        style={{ perspective: "1000px" }}
        onClick={onFlip}
      >
        <motion.div
          animate={{ rotateY: cardFlipped ? 180 : 0 }}
          transition={{ duration: 0.4 }}
          style={{ transformStyle: "preserve-3d", position: "relative", minHeight: 200 }}
        >
          {/* Front */}
          <div
            className="absolute inset-0 flex flex-col items-center justify-center p-6 bg-indigo-400/8 border border-indigo-400/25 rounded-2xl"
            style={{ backfaceVisibility: "hidden" }}
          >
            <p className="text-[10px] text-indigo-400 font-bold mb-3 uppercase tracking-wider">Question</p>
            <p className="text-base font-semibold text-foreground text-center leading-relaxed">{flashcards[cardIndex]?.front}</p>
            <p className="text-[10px] text-muted-foreground mt-4">Tap to reveal answer</p>
          </div>
          {/* Back */}
          <div
            className="absolute inset-0 flex flex-col items-center justify-center p-6 bg-emerald-400/8 border border-emerald-400/25 rounded-2xl"
            style={{ backfaceVisibility: "hidden", transform: "rotateY(180deg)" }}
          >
            <p className="text-[10px] text-emerald-400 font-bold mb-3 uppercase tracking-wider">Answer</p>
            <p className="text-sm text-foreground text-center leading-relaxed">{flashcards[cardIndex]?.back}</p>
          </div>
        </motion.div>
      </div>

      {/* Controls */}
      <div className="flex items-center gap-3 w-full">
        <button
          onClick={onPrev}
          disabled={cardIndex === 0}
          className="flex-1 py-2 bg-card border border-border rounded-xl text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-30 transition-all flex items-center justify-center gap-1.5"
        >
          <ChevronLeft className="h-3.5 w-3.5" /> Prev
        </button>
        {cardFlipped && (
          <>
            <button
              onClick={onMarkStillLearning}
              className="flex-1 py-2 bg-red-400/10 border border-red-400/30 rounded-xl text-[11px] text-red-400 hover:bg-red-400/20 transition-all flex items-center justify-center gap-1.5"
            >
              <XCircle className="h-3.5 w-3.5" /> Still Learning
            </button>
            <button
              onClick={onMarkKnown}
              className="flex-1 py-2 bg-emerald-400/10 border border-emerald-400/30 rounded-xl text-[11px] text-emerald-400 hover:bg-emerald-400/20 transition-all flex items-center justify-center gap-1.5"
            >
              <CheckCircle className="h-3.5 w-3.5" /> Got It!
            </button>
          </>
        )}
        {!cardFlipped && (
          <button
            onClick={onNextUnflipped}
            disabled={cardIndex === flashcards.length - 1}
            className="flex-1 py-2 bg-card border border-border rounded-xl text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-30 transition-all flex items-center justify-center gap-1.5"
          >
            Next <ChevronRight className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {knownCards.size === flashcards.length && (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="w-full p-3 bg-emerald-400/10 border border-emerald-400/30 rounded-xl text-center">
          <p className="text-sm font-bold text-emerald-400">🎉 All cards mastered!</p>
          <button onClick={onReset} className="mt-2 text-[11px] text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1 mx-auto">
            <RefreshCw className="h-3 w-3" /> Reset & review again
          </button>
        </motion.div>
      )}
    </motion.div>
  );
}
