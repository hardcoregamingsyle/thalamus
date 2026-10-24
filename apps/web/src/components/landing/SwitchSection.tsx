import { Reveal } from "@/components/ui/Reveal";

export function SwitchSection() {
  return (
    <section className="mx-auto grid max-w-6xl items-center gap-12 px-4 py-24 sm:px-6 sm:py-32 lg:grid-cols-2">
      <Reveal>
        <p className="text-sm uppercase tracking-[0.16em] text-fg-subtle">Our own architecture</p>
        <h2 className="mt-5 text-3xl font-semibold tracking-[-0.03em] text-fg sm:text-5xl">
          More room to think.
          <br />
          <span className="text-gradient">A different tradeoff.</span>
        </h2>
        <p className="mt-5 text-base leading-relaxed text-fg-muted">
          We’re prioritizing reasoning, persistent memory, and low ongoing costs over fast replies.
          NAMELESS is being designed for work that deserves more than a quick answer.
        </p>
      </Reveal>
      <Reveal delay={0.1}>
        <div className="rounded-3xl border border-border bg-surface p-8 sm:p-10">
          <h3 className="text-xl font-semibold text-fg">Still training. Built with intent.</h3>
          <p className="mt-4 leading-relaxed text-fg-muted">
            Unlimited context and memory that carries across conversations are the goals. By
            avoiding repeated processing of the entire conversation, we aim to keep the cost of
            continuing it extremely low.
          </p>
          <p className="mt-5 text-sm leading-relaxed text-fg-subtle">
            Capabilities, limits, speed, and pricing will be published after evaluation. Comparisons
            with Claude, Gemini, and ChatGPT are targets, not measured results.
          </p>
        </div>
      </Reveal>
    </section>
  );
}
