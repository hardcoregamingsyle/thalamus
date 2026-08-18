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
    <div className="flex flex-col items-center text-center px-4">
      {/* Mode emblem with soft glow */}
      <div className="relative mb-5">
        <div className={`absolute inset-0 rounded-2xl blur-2xl opacity-40 ${mode.accent}`} />
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.4 }}
          className="relative w-16 h-16 rounded-2xl bg-card border border-border flex items-center justify-center shadow-lg"
        >
          <mode.icon className={`h-8 w-8 ${mode.color}`} />
        </motion.div>
      </div>

      <motion.h2
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.05, duration: 0.4 }}
        className="text-2xl font-semibold text-foreground mb-2 tracking-tight"
      >
        {mode.label.charAt(0) + mode.label.slice(1).toLowerCase()}
      </motion.h2>
      <motion.p
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1, duration: 0.4 }}
        className="text-sm text-muted-foreground max-w-md mb-7"
      >
        {mode.id === "study"
          ? `${resourceCount > 0 ? `${resourceCount} resource(s) loaded · ` : ""}Ask anything — live web search enabled`
          : mode.id === "research"
          ? "Deep research with live web data"
          : mode.desc}
      </motion.p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 w-full max-w-lg">
        {suggestions.map((s, i) => (
          <motion.button
            key={i}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15 + i * 0.05 }}
            onClick={() => onPick(s.prompt)}
            className="group text-left rounded-xl border border-border bg-card hover:border-ring/50 hover:bg-muted/40 hover:shadow-sm transition-all px-4 py-3"
          >
            <p className="text-xs font-semibold text-foreground mb-1">
              <span className="mr-1.5">{s.icon}</span>
              {s.title}
            </p>
            <p className="text-[12px] text-muted-foreground line-clamp-2 leading-relaxed">{s.prompt}</p>
          </motion.button>
        ))}
      </div>
    </div>
  );
}
