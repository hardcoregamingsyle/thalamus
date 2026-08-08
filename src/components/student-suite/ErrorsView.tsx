// StudentSuite mistake-review view — pooled misconceptions from the mock
// test feedback and wrong quiz answers, plus generic "easy mistake" prompts
// per topic, with a diagnostic follow-up on the selected item.

import { motion } from "framer-motion";

export interface ErrorsViewProps {
  misconceptionItems: string[];
  selectedMisconception: number | null;
  onSelect: (index: number) => void;
}

export default function ErrorsView({ misconceptionItems, selectedMisconception, onSelect }: ErrorsViewProps) {
  return (
    <motion.div key="errors" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="p-5 space-y-4">
      <div className="p-4 bg-red-400/8 border border-red-400/25 rounded-xl">
        <p className="text-sm font-bold text-foreground">Turn mistakes into practice</p>
        <p className="text-[11px] text-muted-foreground mt-1 leading-relaxed">
          Pick a weak spot. Then answer the diagnostic prompt before returning to quizzes or flashcards.
        </p>
      </div>
      <div className="space-y-2">
        {misconceptionItems.map((item, index) => (
          <button
            key={`${item}-${index}`}
            onClick={() => onSelect(index)}
            className={`w-full text-left p-3 rounded-xl border transition-all ${selectedMisconception === index ? "bg-red-400/12 border-red-400/40" : "bg-background border-border hover:border-red-400/30"}`}
          >
            <p className="text-xs text-foreground leading-relaxed">{item}</p>
          </button>
        ))}
      </div>
      {selectedMisconception !== null && (
        <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="p-4 bg-card border border-border rounded-xl">
          <p className="text-[10px] font-bold text-red-400 mb-2">Diagnostic prompt</p>
          <p className="text-xs text-foreground leading-relaxed">
            Explain the correct idea, give one example, and write the mistake you will avoid next time.
          </p>
        </motion.div>
      )}
    </motion.div>
  );
}
