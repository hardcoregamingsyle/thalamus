import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronDown, Loader2 } from "lucide-react";

interface ThinkingPanelProps {
  title?: string;
  content: string;
  active?: boolean;
  accentClassName?: string;
}

export default function ThinkingPanel({
  title = "Thinking",
  content,
  active = false,
  accentClassName = "text-primary border-primary/30 bg-primary/10",
}: ThinkingPanelProps) {
  const [open, setOpen] = useState(true);

  if (!content.trim() && !active) return null;

  const display = content.trim() || "Preparing context...";

  return (
    <div className={`rounded-xl border ${accentClassName} overflow-hidden`}>
      <button
        type="button"
        onClick={() => setOpen(value => !value)}
        className="w-full flex items-center justify-between gap-3 px-3 py-2 text-left"
      >
        <div className="flex items-center gap-2 min-w-0">
          {active ? <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" /> : <span className="h-2 w-2 rounded-full bg-current opacity-70 shrink-0" />}
          <span className="text-[11px] font-bold uppercase tracking-wide truncate">{title}</span>
          <span className="text-[10px] opacity-65">{active ? "streaming" : "captured"}</span>
        </div>
        <ChevronDown className={`h-3.5 w-3.5 shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="overflow-hidden"
          >
            <div className="px-3 pb-3">
              <pre className="whitespace-pre-wrap break-words rounded-lg bg-background/55 border border-current/10 px-3 py-2 text-[11px] leading-relaxed text-foreground/80 font-mono">
                {display}
              </pre>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
