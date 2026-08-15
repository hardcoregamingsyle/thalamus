// Landing closer — one line, one button. The mode picker that used to repeat
// here is already the ModeGrid up top; repeating it just added noise.

import { ArrowRight } from "lucide-react";
import { type ModeId } from "./ModeGrid";

export interface FinalCtaProps {
  onLaunch: () => void;
  /** Kept for the route's shared handler signature; the closer has no picker. */
  onSelect?: (mode: ModeId) => void;
}

export default function FinalCta({ onLaunch }: FinalCtaProps) {
  return (
    <section className="px-4 py-24 sm:px-6">
      <div className="mx-auto max-w-2xl text-center">
        <h2 className="text-3xl font-semibold tracking-tight text-foreground sm:text-5xl">
          Build something today.
        </h2>
        <p className="mt-4 text-base text-muted-foreground">Free every day. No card.</p>
        <a
          href="/portal"
          onClick={(e) => { e.preventDefault(); onLaunch(); }}
          className="group mt-8 inline-flex items-center gap-2 rounded-full bg-foreground px-8 py-4 text-sm font-semibold text-background shadow-xl shadow-black/25 transition-all hover:bg-foreground/90"
        >
          Start building free
          <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
        </a>
      </div>
    </section>
  );
}
