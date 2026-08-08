// StudentSuite interleaved-practice view — mixes recall / apply / compare
// prompts across seeded study topics.

import { motion } from "framer-motion";

export interface InterleavePrompt {
  topic: string;
  task: string;
  type: string;
}

export default function InterleaveView({ interleavedPrompts }: { interleavedPrompts: InterleavePrompt[] }) {
  return (
    <motion.div key="interleave" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="p-5 space-y-4">
      <div className="p-4 bg-amber-400/8 border border-amber-400/25 rounded-xl">
        <p className="text-sm font-bold text-foreground">Mixed practice</p>
        <p className="text-[11px] text-muted-foreground mt-1 leading-relaxed">
          Do these in order. The mix is intentional: switching topics helps long-term learning.
        </p>
      </div>
      <div className="space-y-2">
        {interleavedPrompts.map((prompt, index) => (
          <div key={`${prompt.topic}-${index}`} className="flex gap-3 p-3 bg-background border border-border rounded-xl">
            <div className="w-7 h-7 rounded-lg bg-amber-400/10 border border-amber-400/25 text-amber-400 flex items-center justify-center text-[10px] font-bold shrink-0">
              {index + 1}
            </div>
            <div className="min-w-0">
              <p className="text-[10px] font-bold text-amber-400">{prompt.type}</p>
              <p className="text-xs text-foreground mt-0.5 leading-relaxed">{prompt.task}</p>
              <p className="text-[10px] text-muted-foreground mt-1 line-clamp-2">{prompt.topic}</p>
            </div>
          </div>
        ))}
      </div>
    </motion.div>
  );
}
