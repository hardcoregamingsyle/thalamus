// Landing final CTA row plus the compact secondary mode-picker underneath it.

import { ArrowRight } from "lucide-react";
import { MODE_CARDS, type ModeId } from "./ModeGrid";

export interface FinalCtaProps {
  onLaunch: () => void;
  onSelect: (mode: ModeId) => void;
}

export default function FinalCta({ onLaunch, onSelect }: FinalCtaProps) {
  return (
    <section className="px-4 py-20 sm:px-6">
      <div className="mx-auto max-w-7xl">
        <div className="grid gap-8 border-y border-foreground/10 py-12 md:grid-cols-[1fr_auto] md:items-center">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-primary">Start with anything</p>
            <h2 className="mt-3 max-w-3xl text-3xl font-semibold tracking-normal text-foreground sm:text-5xl">
              Powerful enough for big work. Simple enough for everyone.
            </h2>
            <p className="mt-4 max-w-2xl text-sm leading-6 text-muted-foreground">
              Start with a question, a lesson, a topic, an idea, or a project. Thalamus will guide you from there.
            </p>
          </div>
          <button onClick={onLaunch} className="group flex items-center justify-center gap-2 rounded-lg bg-foreground px-6 py-3 text-sm font-bold text-background shadow-2xl shadow-black/30 transition-all hover:bg-foreground/90">
            Launch now
            <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
          </button>
        </div>

        <div className="mt-8 grid gap-2 sm:grid-cols-4">
          {MODE_CARDS.map(mode => (
            <button key={mode.id} onClick={() => onSelect(mode.id)} className={`flex items-center justify-between rounded-lg border px-3 py-3 text-xs font-bold transition-all hover:bg-foreground/[0.045] ${mode.tone}`}>
              <span>{mode.label}</span>
              <mode.icon className="h-4 w-4" />
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
