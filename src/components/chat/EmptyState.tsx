// Centered welcome state shown before any message: a large mode title, a short
// descriptive line, and suggestion chips the user can click to seed the prompt.
// The composer sits directly beneath, so the prompt is unmistakably the focus.

import { motion } from "framer-motion";
import type { ModeMeta } from "@/pages/portal/modes";
import { SUGGESTIONS_BY_MODE } from "@/pages/portal/suggestions";

interface EmptyStateProps {
  mode: ModeMeta;
  onPick: (prompt: string) => void;
  resourceCount?: number;
}

export default function EmptyState({ mode, onPick, resourceCount = 0 }: EmptyStateProps) {
  const suggestions = (SUGGESTIONS_BY_MODE[mode.id] ?? SUGGESTIONS_BY_MODE.chat).slice(0, 4);

  return (
    <div className="flex flex-col items-center justify-center text-center px-4">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="w-14 h-14 rounded-2xl bg-muted border border-border flex items-center justify-center mb-4"
      >
        <mode.icon className={`h-7 w-7 ${mode.color}`} />
      </motion.div>
      <motion.h2
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.05, duration: 0.4 }}
        className="text-2xl font-semibold text-foreground mb-2"
      >
        {mode.label.charAt(0) + mode.label.slice(1).toLowerCase()}
      </motion.h2>
      <motion.p
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1, duration: 0.4 }}
        className="text-sm text-muted-foreground max-w-md mb-6"
      >
        {mode.id === "study"
          ? `${resourceCount > 0 ? `${resourceCount} resource(s) loaded · ` : ""}Ask anything — live web search enabled`
          : mode.id === "research"
          ? "Deep research with live web data"
          : mode.desc}
      </motion.p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 w-full max-w-lg">
        {suggestions.map((s, i) => (
          <motion.button
            key={i}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15 + i * 0.05 }}
            onClick={() => onPick(s.prompt)}
            className="group text-left rounded-xl border border-border bg-card hover:border-ring/50 hover:bg-muted/40 transition-all px-3.5 py-3"
          >
            <p className="text-xs font-medium text-foreground mb-0.5">
              <span className="mr-1.5">{s.icon}</span>
              {s.title}
            </p>
            <p className="text-[11px] text-muted-foreground line-clamp-2">{s.prompt}</p>
          </motion.button>
        ))}
      </div>
    </div>
  );
}
