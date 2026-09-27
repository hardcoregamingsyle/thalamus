"use client";

import { useReducedMotion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { highlight } from "@/lib/highlight";

const CODE = `from openai import OpenAI

client = OpenAI(
    base_url="https://thalamus.aphantic.skinticals.com/v1",
    api_key="th_...",
)

stream = client.chat.completions.create(
    model="thalamus-sophon-1.0",
    messages=[{"role": "user", "content": "Say hello."}],
    stream=True,
)
for chunk in stream:
    print(chunk.choices[0].delta.content or "", end="")`;

const REPLY = ["Hello", " from", " Thalamus", " Sophon."];

type Phase = "typing" | "running" | "streaming" | "done";

export function ApiDemo() {
  const still = useReducedMotion();
  const root = useRef<HTMLDivElement>(null);
  const [inView, setInView] = useState(false);
  const [typed, setTyped] = useState(0);
  const [words, setWords] = useState(0);
  const [phase, setPhase] = useState<Phase>("typing");

  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => setInView(entries[0]?.isIntersecting ?? false),
      {
        threshold: 0.2,
      },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (still) {
      setTyped(CODE.length);
      setWords(REPLY.length);
      setPhase("done");
      return;
    }
    if (!inView) return;
    let timer: ReturnType<typeof setTimeout>;
    if (phase === "typing") {
      timer =
        typed < CODE.length
          ? setTimeout(() => setTyped((n) => Math.min(CODE.length, n + 3)), 16)
          : setTimeout(() => setPhase("running"), 500);
    } else if (phase === "running") {
      timer = setTimeout(() => setPhase("streaming"), 750);
    } else if (phase === "streaming") {
      timer =
        words < REPLY.length
          ? setTimeout(() => setWords((n) => n + 1), 170)
          : setTimeout(() => setPhase("done"), 200);
    } else {
      timer = setTimeout(() => {
        setTyped(0);
        setWords(0);
        setPhase("typing");
      }, 5200);
    }
    return () => clearTimeout(timer);
  }, [still, inView, phase, typed, words]);

  const status =
    phase === "running"
      ? "Connecting"
      : phase === "streaming"
        ? "Streaming"
        : phase === "done"
          ? "200 OK"
          : "Idle";

  return (
    <div ref={root} className="relative">
      <div
        aria-hidden="true"
        className="absolute -inset-x-8 top-8 bottom-0 -z-10 rounded-[40px] bg-[linear-gradient(110deg,var(--raw-grad-1),var(--raw-grad-2),var(--raw-grad-3))] opacity-[0.16] blur-3xl"
      />
      <div className="overflow-hidden rounded-2xl border border-white/10 bg-code-bg/90 text-left shadow-[0_40px_120px_-40px_rgb(0_0_0/0.8)] backdrop-blur-xl">
        <div className="flex items-center gap-2 border-b border-white/[0.07] px-4 py-3">
          <span className="h-2.5 w-2.5 rounded-full bg-white/15" />
          <span className="h-2.5 w-2.5 rounded-full bg-white/15" />
          <span className="h-2.5 w-2.5 rounded-full bg-white/15" />
          <span className="ml-3 font-mono text-xs text-white/40">quickstart.py</span>
        </div>
        <div className="grid md:grid-cols-[1.5fr_1fr]">
          <pre
            aria-label="Example: calling Thalamus with the OpenAI Python SDK"
            className="min-h-[330px] overflow-hidden whitespace-pre-wrap break-all p-5 font-mono text-[12.5px] leading-[1.75] text-white/85 sm:p-6"
          >
            <code>
              {highlight(CODE.slice(0, typed), "python")}
              {phase === "typing" && (
                <span className="animate-caret ml-px inline-block h-[1.1em] w-[7px] translate-y-[3px] bg-white/70" />
              )}
            </code>
          </pre>
          <div className="flex flex-col border-t border-white/[0.07] md:border-l md:border-t-0">
            <div className="flex items-center justify-between px-5 py-3 text-xs">
              <span className="font-medium text-white/50">Output</span>
              <span className="flex items-center gap-2 font-mono text-white/45">
                <span
                  className={`h-1.5 w-1.5 rounded-full transition-colors ${
                    phase === "done"
                      ? "bg-[#6ee7b7]"
                      : phase === "typing"
                        ? "bg-white/25"
                        : "animate-pulse bg-[#93c5fd]"
                  }`}
                />
                {status}
              </span>
            </div>
            <div className="flex-1 px-5 pb-6 pt-2 font-mono text-[15px] leading-relaxed text-white">
              {REPLY.slice(0, words).join("")}
              {(phase === "running" || phase === "streaming") && (
                <span className="animate-caret ml-0.5 inline-block h-[1.05em] w-[8px] translate-y-[3px] bg-[#93c5fd]" />
              )}
            </div>
            <div className="flex flex-wrap gap-2 border-t border-white/[0.07] px-5 py-3 font-mono text-[11px] text-white/40">
              <span className="rounded-md bg-white/[0.05] px-2 py-1">
                model thalamus-sophon-1.0
              </span>
              <span className="rounded-md bg-white/[0.05] px-2 py-1">stream true</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
