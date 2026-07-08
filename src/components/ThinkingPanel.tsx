import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronDown, Sparkles } from "lucide-react";

interface ThinkingPanelProps {
  title?: string;
  content: string;
  active?: boolean;
  accentClassName?: string;
}

export default function ThinkingPanel({
  content,
  active = false,
}: ThinkingPanelProps) {
  const [open, setOpen] = useState(false);

  if (!content.trim() && !active) return null;

  // Extract a one-line summary from the thinking content
  const lines = content.trim().split("\n").filter(l => l.trim());
  const summary = lines.length > 0
    ? lines[0].slice(0, 80) + (lines[0].length > 80 ? "…" : "")
    : "Preparing response…";

  const wordCount = content.trim().split(/\s+/).filter(Boolean).length;

  return (
    <div className="mb-3 max-w-4xl">
      {/* Pill trigger */}
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="group flex items-center gap-2 px-3 py-1.5 rounded-full border border-border/60 bg-muted/40 hover:bg-muted/70 transition-all duration-200 text-left"
      >
        {active ? (
          /* Animated thinking dots */
          <span className="flex items-center gap-[3px] shrink-0">
            {[0, 1, 2].map(i => (
              <span
                key={i}
                className="h-1.5 w-1.5 rounded-full bg-primary/70"
                style={{
                  animation: "thinkingBounce 1.2s ease-in-out infinite",
                  animationDelay: `${i * 0.2}s`,
                }}
              />
            ))}
          </span>
        ) : (
          <Sparkles className="h-3 w-3 text-primary/60 shrink-0" />
        )}
        <span className="text-[11px] text-muted-foreground font-medium">
          {active
            ? "Thinking…"
            : `Thought for ${wordCount > 200 ? "a while" : "a moment"}`}
        </span>
        {!active && content.trim() && (
          <ChevronDown
            className={`h-3 w-3 text-muted-foreground/60 transition-transform duration-200 ${open ? "rotate-180" : ""}`}
          />
        )}
      </button>

      {/* Expanded content */}
      <AnimatePresence initial={false}>
        {open && content.trim() && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: "easeInOut" }}
            className="overflow-hidden"
          >
            <div className="mt-2 mx-0.5 rounded-xl border border-border/50 bg-muted/20 backdrop-blur-sm">
              <div className="px-4 py-3 max-h-60 overflow-y-auto">
                <p className="text-[11px] leading-relaxed text-muted-foreground/80 whitespace-pre-wrap font-mono">
                  {content.trim()}
                </p>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <style>{`
        @keyframes thinkingBounce {
          0%, 60%, 100% { transform: translateY(0); opacity: 0.4; }
          30% { transform: translateY(-4px); opacity: 1; }
        }
      `}</style>
    </div>
  );
}
