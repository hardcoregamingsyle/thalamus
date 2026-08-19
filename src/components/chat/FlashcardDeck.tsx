// In-chat flip-card deck hydrated from {"op":"flashcards",...}. Cards flip on
// click with a 3D animation, can be marked known / still-learning, and play a
// sound on flip and on mark. Progress bar tracks how far through the deck the
// student is.

import { memo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { Check, RefreshCw, X } from "lucide-react";
import FloatingReward from "@/components/chat/FloatingReward";
import { sfx } from "@/lib/sfx";
import { bigCelebrateAt, celebrateAt } from "@/lib/vfx";
import { useStudyTaskContext } from "@/components/chat/StudyTaskContext";

interface Flashcard {
  front: string;
  back: string;
}

const FlashcardDeck = memo(function FlashcardDeck({
  cards,
  deckItemIds,
}: {
  cards: Flashcard[];
  deckItemIds?: string[];
}) {
  const { completeItem, report } = useStudyTaskContext();
  const wrapRef = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [known, setKnown] = useState<Set<number>>(new Set());
  const [reward, setReward] = useState<string | null>(null);

  const card = cards[index];

  const go = (dir: 1 | -1) => {
    sfx.advance();
    setFlipped(false);
    setIndex(i => Math.min(cards.length - 1, Math.max(0, i + dir)));
  };

  const mark = (k: boolean) => {
    const nowKnown = new Set(known);
    if (k) nowKnown.add(index); else nowKnown.delete(index);
    setKnown(nowKnown);
    if (k) {
      sfx.correct();
      report?.(true);
      celebrateAt(wrapRef.current);
      setReward("+10 XP");
      // Bigger celebration when the whole deck is mastered.
      if (nowKnown.size === cards.length) {
        sfx.tada();
        bigCelebrateAt(wrapRef.current);
      }
    } else {
      sfx.wrong();
      report?.(false);
    }
    // Report completion for this card to the persisted study task.
    if (deckItemIds && deckItemIds[index]) completeItem?.(deckItemIds[index], k);
    setFlipped(false);
    setIndex(i => Math.min(cards.length - 1, i + 1));
  };

  return (
    <div ref={wrapRef} className="relative">
      {reward && <FloatingReward label={reward} onDone={() => setReward(null)} />}
    <div className="rounded-xl border border-indigo-500/30 bg-indigo-500/5 p-3 space-y-3">
      <div className="flex items-center justify-between text-[11px] text-muted-foreground">
        <span className="font-semibold text-indigo-400 uppercase tracking-wider">Flashcards</span>
        <span>{known.size}/{cards.length} known · card {index + 1}/{cards.length}</span>
      </div>
      <div className="w-full h-1 bg-border/40 rounded-full overflow-hidden">
        <motion.div
          className="h-full bg-indigo-400"
          animate={{ width: `${((index + 1) / cards.length) * 100}%` }}
          transition={{ duration: 0.3 }}
        />
      </div>

      {/* Card */}
      <div
        className="cursor-pointer select-none"
        style={{ perspective: "1000px" }}
        onClick={() => { if (!flipped) sfx.flip(); setFlipped(f => !f); }}
      >
        <motion.div
          animate={{ rotateY: flipped ? 180 : 0 }}
          transition={{ duration: 0.45, ease: "easeInOut" }}
          style={{ transformStyle: "preserve-3d", position: "relative", minHeight: 150 }}
        >
          <div
            className="absolute inset-0 flex items-center justify-center p-5 bg-indigo-400/8 border border-indigo-400/25 rounded-xl"
            style={{ backfaceVisibility: "hidden" }}
          >
            <p className="text-sm font-semibold text-foreground text-center leading-relaxed">{card.front}</p>
          </div>
          <div
            className="absolute inset-0 flex items-center justify-center p-5 bg-emerald-400/8 border border-emerald-400/25 rounded-xl"
            style={{ backfaceVisibility: "hidden", transform: "rotateY(180deg)" }}
          >
            <p className="text-sm text-foreground text-center leading-relaxed">{card.back}</p>
          </div>
        </motion.div>
      </div>

      {/* Controls */}
      <div className="flex items-center gap-2">
        <button
          onClick={() => go(-1)}
          disabled={index === 0}
          className="flex-1 py-2 rounded-lg border border-border text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-30 transition-colors"
        >
          Prev
        </button>
        {flipped && (
          <>
            <button
              onClick={() => mark(false)}
              className="flex-1 py-2 rounded-lg bg-red-400/10 border border-red-400/30 text-[11px] text-red-400 hover:bg-red-400/20 flex items-center justify-center gap-1"
            >
              <X className="h-3.5 w-3.5" /> Still learning
            </button>
            <button
              onClick={() => mark(true)}
              className="flex-1 py-2 rounded-lg bg-emerald-400/10 border border-emerald-400/30 text-[11px] text-emerald-400 hover:bg-emerald-400/20 flex items-center justify-center gap-1"
            >
              <Check className="h-3.5 w-3.5" /> Got it
            </button>
          </>
        )}
        {!flipped && (
          <button
            onClick={() => go(1)}
            disabled={index === cards.length - 1}
            className="flex-1 py-2 rounded-lg border border-border text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-30 transition-colors"
          >
            Next
          </button>
        )}
      </div>

      {known.size === cards.length && (
        <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="text-center">
          <p className="text-sm font-bold text-emerald-400">🎉 All cards mastered!</p>
          <button
            onClick={() => { sfx.click(); setKnown(new Set()); setIndex(0); setFlipped(false); }}
            className="mt-1 text-[11px] text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
          >
            <RefreshCw className="h-3 w-3" /> Review again
          </button>
        </motion.div>
      )}
    </div>
    </div>
  );
});

export default FlashcardDeck;
