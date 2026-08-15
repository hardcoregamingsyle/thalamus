// Landing page mode grid — the four large cards for Build / Chat / Research /
// Study. Each card also gets a compact re-render in FinalCta.tsx, which reads
// MODE_CARDS from here.

import { motion } from "framer-motion";
import { BookOpen, Code2, MessageSquare, Search } from "lucide-react";

export type ModeId = "chat" | "research" | "study" | "code";

export interface ModeCard {
  id: ModeId;
  label: string;
  icon: typeof MessageSquare;
  tone: string;
  /** One short line. The grid is scanned, not read — keep it under ~60 chars. */
  desc: string;
}

// eslint-disable-next-line react-refresh/only-export-components -- data lives beside its primary consumer; HMR is disabled repo-wide (vite server.hmr: false)
export const MODE_CARDS: ModeCard[] = [
  {
    id: "code",
    label: "Build",
    icon: Code2,
    tone: "text-emerald-300 border-emerald-300/25 bg-emerald-300/8",
    desc: "Ship real apps from one prompt",
  },
  {
    id: "study",
    label: "Study",
    icon: BookOpen,
    tone: "text-indigo-300 border-indigo-300/25 bg-indigo-300/8",
    desc: "A tutor that knows your board",
  },
  {
    id: "research",
    label: "Research",
    icon: Search,
    tone: "text-amber-300 border-amber-300/25 bg-amber-300/8",
    desc: "Answers with real sources",
  },
  {
    id: "chat",
    label: "Chat",
    icon: MessageSquare,
    tone: "text-sky-300 border-sky-300/25 bg-sky-300/8",
    desc: "Ask anything, instantly",
  },
];

export default function ModeGrid({ onSelect }: { onSelect: (mode: ModeId) => void }) {
  return (
    <section id="modes" className="px-4 py-16 sm:px-6">
      <div className="mx-auto max-w-5xl">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {MODE_CARDS.map((mode, index) => (
            <motion.button
              key={mode.id}
              initial={{ opacity: 0, y: 12 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: index * 0.05 }}
              onClick={() => onSelect(mode.id)}
              className={`group rounded-xl border p-5 text-left transition-all hover:-translate-y-0.5 ${mode.tone}`}
            >
              <mode.icon className="h-5 w-5" />
              <p className="mt-4 text-sm font-semibold text-foreground">{mode.label}</p>
              <p className="mt-1 text-[13px] leading-5 text-muted-foreground">{mode.desc}</p>
            </motion.button>
          ))}
        </div>
      </div>
    </section>
  );
}
