// Landing page mode grid — the four large cards for Build / Chat / Research /
// Study. Each card also gets a compact re-render in FinalCta.tsx, which reads
// MODE_CARDS from here.

import { motion } from "framer-motion";
import {
  ArrowRight, BookOpen, CheckCircle, Code2, MessageSquare, Search,
} from "lucide-react";

export type ModeId = "chat" | "research" | "study" | "code";

export interface ModeCard {
  id: ModeId;
  label: string;
  icon: typeof MessageSquare;
  tone: string;
  metric: string;
  headline: string;
  desc: string;
  examples: string[];
}

// eslint-disable-next-line react-refresh/only-export-components -- data lives beside its primary consumer; HMR is disabled repo-wide (vite server.hmr: false)
export const MODE_CARDS: ModeCard[] = [
  {
    id: "code",
    label: "Build",
    icon: Code2,
    tone: "text-emerald-300 border-emerald-300/25 bg-emerald-300/8",
    metric: "L3.5 agent",
    headline: "Ship real apps from one prompt",
    desc: "Describe what you want and a team of AI agents plans, writes, tests, and reviews real code — files, commands, and a GitHub push, not just a snippet.",
    examples: ["Web apps", "APIs & tools", "Fix & ship code"],
  },
  {
    id: "chat",
    label: "Chat",
    icon: MessageSquare,
    tone: "text-sky-300 border-sky-300/25 bg-sky-300/8",
    metric: "quick answers",
    headline: "Ask anything and feel understood",
    desc: "Get clear help with everyday questions, writing, planning, decisions, and ideas.",
    examples: ["Explain anything", "Write with confidence", "Plan your day"],
  },
  {
    id: "research",
    label: "Research",
    icon: Search,
    tone: "text-amber-300 border-amber-300/25 bg-amber-300/8",
    metric: "fresh information",
    headline: "Understand any topic faster",
    desc: "Turn messy information into simple explanations, comparisons, summaries, and next steps.",
    examples: ["Compare options", "Catch up quickly", "Learn what matters"],
  },
  {
    id: "study",
    label: "Study",
    icon: BookOpen,
    tone: "text-indigo-300 border-indigo-300/25 bg-indigo-300/8",
    metric: "study help",
    headline: "A patient tutor for every learner",
    desc: "Upload notes or ask a question and get explanations that are easy to follow and ready to revise.",
    examples: ["School lessons", "College topics", "Practice questions"],
  },
];

export default function ModeGrid({ onSelect }: { onSelect: (mode: ModeId) => void }) {
  return (
    <section id="modes" className="px-4 py-18 sm:px-6">
      <div className="mx-auto max-w-7xl">
        <div className="mb-8 flex flex-col justify-between gap-4 border-b border-foreground/10 pb-6 md:flex-row md:items-end">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-primary">Four ways to get help</p>
            <h2 className="mt-3 max-w-3xl text-3xl font-semibold tracking-normal text-foreground sm:text-5xl">The right kind of help for whatever you are doing.</h2>
          </div>
          <p className="max-w-md text-sm leading-6 text-muted-foreground">
            Pick the mode that matches your goal. Thalamus handles the rest in clear, friendly language.
          </p>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          {MODE_CARDS.map((mode, index) => (
            <motion.button
              key={mode.id}
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: index * 0.06 }}
              onClick={() => onSelect(mode.id)}
              className={`group rounded-lg border p-5 text-left transition-all hover:-translate-y-0.5 hover:bg-foreground/[0.045] ${mode.tone}`}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-start gap-4">
                  <div className="flex h-11 w-11 items-center justify-center rounded-lg border border-current/20 bg-background/45">
                    <mode.icon className="h-5 w-5" />
                  </div>
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-xs font-bold uppercase tracking-[0.2em]">{mode.label}</p>
                      <span className="rounded-full border border-current/20 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.12em] opacity-75">{mode.metric}</span>
                    </div>
                    <h3 className="mt-3 text-xl font-semibold text-foreground">{mode.headline}</h3>
                  </div>
                </div>
                <ArrowRight className="mt-1 h-4 w-4 shrink-0 opacity-45 transition-transform group-hover:translate-x-1 group-hover:opacity-100" />
              </div>
              <p className="mt-4 max-w-2xl text-sm leading-6 text-muted-foreground">{mode.desc}</p>
              <div className="mt-5 grid gap-2 sm:grid-cols-3">
                {mode.examples.map(example => (
                  <div key={example} className="flex items-center gap-2 text-[11px] text-muted-foreground">
                    <CheckCircle className="h-3.5 w-3.5 shrink-0 text-current" />
                    <span>{example}</span>
                  </div>
                ))}
              </div>
            </motion.button>
          ))}
        </div>
      </div>
    </section>
  );
}
