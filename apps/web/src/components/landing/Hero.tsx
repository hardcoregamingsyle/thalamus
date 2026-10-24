import { ArrowRight } from "lucide-react";
import { Aurora } from "@/components/site/Aurora";
import { ButtonLink } from "@/components/ui/Button";

function Line({
  children,
  delay,
  className = "",
}: {
  children: React.ReactNode;
  delay: number;
  className?: string;
}) {
  return (
    <span className="block overflow-hidden pb-[0.08em]">
      <span
        className={`block animate-rise [--rise:105%] ${className}`}
        style={{ animationDelay: `${delay}s` }}
      >
        {children}
      </span>
    </span>
  );
}

export function Hero() {
  return (
    <section className="relative isolate overflow-hidden pt-32 sm:pt-40">
      <div className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[1000px]">
        <Aurora className="h-full w-full scale-110 blur-[56px]" />
        <div className="bg-grid absolute inset-0 opacity-60" />
        <div className="absolute inset-x-0 bottom-0 h-64 bg-gradient-to-b from-transparent to-bg" />
      </div>

      <div className="mx-auto max-w-5xl px-4 text-center sm:px-6">
        <h1 className="text-balance text-[2.5rem] font-semibold leading-[1.04] tracking-[-0.035em] text-fg sm:text-7xl md:text-[5.25rem]">
          <span className="mb-6 block text-sm font-medium uppercase tracking-[0.2em] text-fg-muted">
            NAMELESS · Currently training
          </span>
          <Line delay={0.05}>Every conversation.</Line>
          <Line delay={0.18}>
            <span className="text-gradient animate-shimmer">Nothing left behind.</span>
          </Line>
        </h1>

        <p
          style={{ animationDelay: "0.42s" }}
          className="animate-rise mx-auto mt-7 max-w-xl text-pretty text-base leading-relaxed text-fg-muted sm:text-lg"
        >
          An AI built on our own architecture. We’re working toward unlimited context, lasting
          memory, and powerful reasoning at a fraction of today’s costs.
        </p>

        <div
          style={{ animationDelay: "0.54s" }}
          className="animate-rise mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row"
        >
          <ButtonLink href="/auth" size="lg">
            Join the waitlist
            <ArrowRight className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5" />
          </ButtonLink>
          <ButtonLink href="#vision" size="lg" variant="secondary">
            Explore the vision
          </ButtonLink>
        </div>
      </div>

      <div
        style={{ animationDelay: "0.7s", animationDuration: "1.1s" }}
        className="animate-rise [--rise:40px] mx-auto mt-20 max-w-5xl px-4 pb-24 sm:mt-24 sm:px-6"
      >
        <div className="rounded-3xl border border-border bg-surface px-6 py-10 text-center">
          <p className="font-mono text-sm uppercase tracking-[0.16em] text-fg-subtle">
            A different pace. A longer memory.
          </p>
          <p className="mx-auto mt-4 max-w-2xl text-xl leading-relaxed text-fg">
            Less time repeating yourself. More room to think.
          </p>
          <p className="mx-auto mt-4 max-w-xl text-sm leading-relaxed text-fg-muted">
            The model is still training. Create an account and you’re on the waitlist. We’ll email
            you when a slot opens.
          </p>
        </div>
      </div>
    </section>
  );
}
