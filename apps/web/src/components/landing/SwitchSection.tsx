import { highlight } from "@/lib/highlight";
import { Reveal } from "@/components/ui/Reveal";

const LINES: { kind: " " | "-" | "+"; text: string }[] = [
  { kind: " ", text: "client = OpenAI(" },
  { kind: "-", text: '    base_url="https://api.openai.com/v1",' },
  { kind: "+", text: '    base_url="https://thalamus.aphantic.skinticals.com/v1",' },
  { kind: "-", text: '    api_key=os.environ["OPENAI_API_KEY"],' },
  { kind: "+", text: '    api_key=os.environ["THALAMUS_API_KEY"],' },
  { kind: " ", text: ")" },
];

export function SwitchSection() {
  return (
    <section className="mx-auto grid max-w-6xl items-center gap-12 px-4 py-24 sm:px-6 sm:py-32 lg:grid-cols-[1fr_1.25fr] [&>*]:min-w-0">
      <Reveal>
        <h2 className="text-3xl font-semibold tracking-[-0.03em] text-fg sm:text-5xl">
          Switch in <span className="text-gradient">two lines.</span>
        </h2>
        <p className="mt-5 max-w-md text-base leading-relaxed text-fg-muted sm:text-lg">
          Already on the OpenAI SDK? Point it at Thalamus. Streaming, messages and errors work the
          way you expect.
        </p>
      </Reveal>
      <Reveal delay={0.1}>
        <div className="overflow-hidden rounded-2xl border border-white/10 bg-code-bg shadow-2xl shadow-black/40">
          <div className="border-b border-white/[0.07] px-4 py-3 font-mono text-xs text-white/40">
            app.py
          </div>
          <pre className="overflow-x-auto py-4 font-mono text-[12.5px] leading-[1.9]">
            {LINES.map((l, i) => (
              <div
                key={i}
                className={`flex px-4 ${
                  l.kind === "+"
                    ? "bg-[#6ee7b7]/[0.08]"
                    : l.kind === "-"
                      ? "bg-[#f87171]/[0.07] opacity-60"
                      : ""
                }`}
              >
                <span
                  className={`w-6 shrink-0 select-none ${
                    l.kind === "+"
                      ? "text-[#6ee7b7]"
                      : l.kind === "-"
                        ? "text-[#f87171]"
                        : "text-white/20"
                  }`}
                >
                  {l.kind}
                </span>
                <code
                  className={
                    l.kind === "-"
                      ? "text-white/60 line-through decoration-white/20"
                      : "text-white/85"
                  }
                >
                  {highlight(l.text, "python")}
                </code>
              </div>
            ))}
          </pre>
        </div>
      </Reveal>
    </section>
  );
}
