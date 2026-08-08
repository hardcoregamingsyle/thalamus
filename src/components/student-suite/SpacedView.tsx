// StudentSuite spaced-repetition view — rate each seeded topic to get a
// (fake but useful) suggested next-review interval. Pure client state.

import { motion } from "framer-motion";
import { CalendarDays } from "lucide-react";
import type { ReviewRating } from "./types";

export interface SpacedViewProps {
  studyTopics: string[];
  reviewRatings: Record<number, ReviewRating>;
  onRate: (index: number, rating: ReviewRating) => void;
}

export default function SpacedView({ studyTopics, reviewRatings, onRate }: SpacedViewProps) {
  return (
    <motion.div key="spaced" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="p-5 space-y-4">
      <div className="p-4 bg-sky-400/8 border border-sky-400/25 rounded-xl">
        <p className="text-sm font-bold text-foreground">Review before you forget</p>
        <p className="text-[11px] text-muted-foreground mt-1 leading-relaxed">
          Rate each topic. Hard topics come back sooner, easy topics move further away.
        </p>
      </div>
      <div className="space-y-3">
        {studyTopics.map((topic, index) => {
          const rating = reviewRatings[index];
          const nextReview = rating === "easy" ? "Review in 7 days" : rating === "okay" ? "Review in 3 days" : rating === "hard" ? "Review tomorrow" : "Review today";
          return (
            <div key={`${topic}-${index}`} className="p-3 bg-background border border-border rounded-xl">
              <div className="flex items-start gap-3">
                <CalendarDays className="h-4 w-4 text-sky-400 shrink-0 mt-0.5" />
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold text-foreground leading-relaxed">{topic}</p>
                  <p className="text-[10px] text-sky-400 mt-1">{nextReview}</p>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2 mt-3">
                {(["hard", "okay", "easy"] as ReviewRating[]).map(option => (
                  <button
                    key={option}
                    onClick={() => onRate(index, option)}
                    className={`py-1.5 rounded-lg border text-[10px] font-bold capitalize transition-all ${rating === option ? "bg-sky-400/15 border-sky-400/40 text-sky-300" : "bg-card border-border text-muted-foreground hover:text-foreground"}`}
                  >
                    {option}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </motion.div>
  );
}
