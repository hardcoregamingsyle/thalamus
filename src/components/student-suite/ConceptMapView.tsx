// StudentSuite concept-map view — pairs each seeded topic with the next one
// as a lightweight "connect these ideas" prompt.

import { motion } from "framer-motion";

export default function ConceptMapView({ studyTopics }: { studyTopics: string[] }) {
  return (
    <motion.div key="conceptmap" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="p-5 space-y-4">
      <div className="p-4 bg-cyan-400/8 border border-cyan-400/25 rounded-xl">
        <p className="text-sm font-bold text-foreground">Connect the ideas</p>
        <p className="text-[11px] text-muted-foreground mt-1 leading-relaxed">
          Learning gets stronger when you know how ideas relate, not just what each one means.
        </p>
      </div>
      <div className="space-y-3">
        {studyTopics.map((topic, index) => {
          const next = studyTopics[(index + 1) % studyTopics.length];
          return (
            <div key={`${topic}-${index}`} className="p-3 bg-background border border-border rounded-xl">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-cyan-400/10 border border-cyan-400/25 text-cyan-400 flex items-center justify-center text-[10px] font-bold shrink-0">
                  {index + 1}
                </div>
                <p className="text-xs font-semibold text-foreground leading-relaxed min-w-0">{topic}</p>
              </div>
              {studyTopics.length > 1 && (
                <div className="ml-4 mt-3 pl-7 border-l border-cyan-400/25">
                  <p className="text-[10px] text-muted-foreground">Connect this to:</p>
                  <p className="text-[11px] text-cyan-300 mt-0.5 line-clamp-2">{next}</p>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </motion.div>
  );
}
