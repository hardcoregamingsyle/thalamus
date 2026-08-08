// Landing hero section: headline, subhead, the two primary CTAs, and the
// IntelligenceConsole strip below them. Also owns EXE_URL — the same string
// is used by Footer.tsx, so it re-exports for that import.

import { motion } from "framer-motion";
import { ArrowRight, CheckCircle, Download, Globe2, Layers3, Sparkles } from "lucide-react";

// Always points to the latest release — no hardcoded version tag that goes stale.
export const EXE_URL = "https://github.com/hardcoregamingsyle/thalamus/releases/latest/download/Thalamus.exe";

const CONSOLE_LINES = [
  { agent: "Ask", text: "Understanding what you need and choosing the best way to help." },
  { agent: "Learn", text: "Breaking difficult ideas into clear steps and simple language." },
  { agent: "Explore", text: "Finding the important points and turning them into a useful answer." },
  { agent: "Create", text: "Helping turn plans, notes, and ideas into finished work." },
];

const SIGNALS = [
  "Answers for everyday questions",
  "Help with school and college",
  "Fresh research when you need it",
  "Tools for building apps and websites",
  "Clear thinking notes you can open or close",
];

function IntelligenceConsole({ onLaunch }: { onLaunch: () => void }) {
  return (
    <div className="pointer-events-auto mx-auto w-full max-w-5xl">
      <div className="grid gap-3 border-y border-foreground/10 bg-background/65 px-3 py-3 backdrop-blur-xl md:grid-cols-[1.15fr_0.85fr] md:rounded-lg md:border">
        <div className="rounded-lg border border-foreground/10 bg-black/30 p-3">
          <div className="mb-3 flex items-center justify-between border-b border-foreground/10 pb-2">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" />
              <span className="text-[11px] font-bold uppercase tracking-[0.22em] text-foreground">How Thalamus Helps</span>
            </div>
            <span className="rounded-full border border-emerald-300/25 bg-emerald-300/10 px-2 py-0.5 text-[10px] font-bold text-emerald-300">Online</span>
          </div>
          <div className="space-y-2">
            {CONSOLE_LINES.map((line, index) => (
              <motion.div
                key={line.agent}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.12 * index }}
                className="grid grid-cols-[88px_1fr] gap-3 rounded-lg border border-foreground/8 bg-foreground/[0.03] px-3 py-2"
              >
                <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-primary">{line.agent}</span>
                <span className="text-[11px] leading-relaxed text-muted-foreground">{line.text}</span>
              </motion.div>
            ))}
          </div>
        </div>

        <div className="grid gap-3">
          <div className="rounded-lg border border-foreground/10 bg-foreground/[0.035] p-4">
            <div className="mb-3 flex items-center gap-2">
              <Globe2 className="h-4 w-4 text-amber-300" />
              <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-foreground">What You Can Do</p>
            </div>
            <div className="space-y-2">
              {SIGNALS.map(signal => (
                <div key={signal} className="flex items-center gap-2 text-[11px] text-muted-foreground">
                  <CheckCircle className="h-3.5 w-3.5 shrink-0 text-emerald-300" />
                  <span>{signal}</span>
                </div>
              ))}
            </div>
          </div>
          <button
            onClick={onLaunch}
            className="group flex items-center justify-between rounded-lg border border-primary/30 bg-primary px-4 py-4 text-left text-primary-foreground shadow-xl shadow-primary/15 transition-all hover:bg-primary/90"
          >
            <span>
              <span className="block text-xs font-bold uppercase tracking-[0.18em]">Start now</span>
              <span className="mt-1 block text-[11px] opacity-80">Choose Chat, Research, Study, or Build.</span>
            </span>
            <ArrowRight className="h-5 w-5 transition-transform group-hover:translate-x-1" />
          </button>
        </div>
      </div>
    </div>
  );
}

export default function Hero({ onLaunch }: { onLaunch: () => void }) {
  return (
    <section className="relative min-h-[92vh] overflow-hidden px-4 pt-28 sm:px-6">
      <div className="absolute inset-0 -z-10 opacity-80">
        <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.055)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.055)_1px,transparent_1px)] bg-[size:80px_80px]" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_10%,rgba(125,180,255,0.18),transparent_38%),radial-gradient(circle_at_85%_35%,rgba(245,190,90,0.10),transparent_30%),linear-gradient(180deg,transparent_0%,var(--background)_88%)]" />
      </div>

      <div className="mx-auto max-w-7xl">
        <div className="mx-auto max-w-5xl text-center">
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-8 inline-flex items-center gap-2 rounded-full border border-foreground/10 bg-foreground/[0.04] px-4 py-2 text-[11px] font-bold uppercase tracking-[0.18em] text-muted-foreground backdrop-blur-xl"
          >
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-300" />
            L3.5 Agent · dynamic multi-agent pipeline · by Aphantic
          </motion.div>

          <motion.h1
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.65 }}
            className="mx-auto max-w-5xl text-balance text-4xl font-semibold leading-[0.98] tracking-normal text-foreground/90 sm:text-6xl lg:text-7xl"
          >
            <span className="block">The L3.5 AI agent that builds real apps.</span>
            <span className="block bg-[linear-gradient(110deg,#a7f3d0_0%,#6ee7b7_35%,#93c5fd_70%,#c4b5fd_100%)] bg-clip-text text-transparent">
              Better output. A fraction of the price.
            </span>
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.12, duration: 0.55 }}
            className="mx-auto mt-6 max-w-3xl text-base leading-7 text-muted-foreground sm:text-lg"
          >
            Describe what you want once. A dispatcher sends in a team of up to nine AI agents that plan, code,
            test, attack, and review it — real files, real commands, pushed to GitHub. And when you're done
            building, there's a free board-aware study tutor in the same app.
          </motion.p>


          <motion.div
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row"
          >
            <a
              href="/portal"
              onClick={(e) => { e.preventDefault(); onLaunch(); }}
              className="group flex items-center gap-2 rounded-lg bg-foreground px-6 py-3 text-sm font-bold text-background shadow-2xl shadow-black/30 transition-all hover:bg-foreground/90"
            >
              Launch Thalamus
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
            </a>
            <a
              href={EXE_URL}
              download="Thalamus.exe"
              className="group flex items-center gap-2 rounded-lg border border-primary/40 bg-primary/10 px-6 py-3 text-sm font-bold text-primary backdrop-blur-xl transition-all hover:bg-primary/20 hover:border-primary/60"
            >
              <Download className="h-4 w-4" />
              Download for Windows
            </a>
            <button onClick={() => document.getElementById("modes")?.scrollIntoView({ behavior: "smooth" })} className="flex items-center gap-2 rounded-lg border border-foreground/10 bg-foreground/[0.035] px-6 py-3 text-sm font-bold text-foreground backdrop-blur-xl transition-all hover:border-foreground/20 hover:bg-foreground/[0.06]">
              See what it can do
              <Layers3 className="h-4 w-4" />
            </button>
          </motion.div>
        </div>

        <motion.div
          initial={{ opacity: 0, y: 28 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.28, duration: 0.65 }}
          className="mt-14"
        >
          <IntelligenceConsole onLaunch={onLaunch} />
        </motion.div>
      </div>
    </section>
  );
}
