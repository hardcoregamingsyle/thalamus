"use client";

import { Code2, KeyRound, MessageCircle, type LucideIcon } from "lucide-react";
import Link from "next/link";
import type { MouseEvent } from "react";
import { Reveal } from "@/components/ui/Reveal";

const PILLARS: { icon: LucideIcon; title: string; body: string; href: string }[] = [
  {
    icon: Code2,
    title: "API",
    body: "OpenAI-compatible. Change the base URL, keep your code.",
    href: "/docs",
  },
  {
    icon: MessageCircle,
    title: "Chat",
    body: "Talk to it directly, right in the browser.",
    href: "/chat",
  },
  { icon: KeyRound, title: "Console", body: "Keys and usage, all in one place.", href: "/console" },
];

function track(e: MouseEvent<HTMLAnchorElement>) {
  const r = e.currentTarget.getBoundingClientRect();
  e.currentTarget.style.setProperty("--x", `${e.clientX - r.left}px`);
  e.currentTarget.style.setProperty("--y", `${e.clientY - r.top}px`);
}

export function Pillars() {
  return (
    <section className="mx-auto max-w-6xl px-4 py-24 sm:px-6 sm:py-32">
      <Reveal>
        <h2 className="text-center text-3xl font-semibold tracking-[-0.03em] text-fg sm:text-5xl">
          One model. Three ways in.
        </h2>
      </Reveal>
      <div className="mt-14 grid gap-4 md:grid-cols-3">
        {PILLARS.map((p, i) => (
          <Reveal key={p.title} delay={i * 0.08}>
            <Link
              href={p.href}
              onMouseMove={track}
              className="group relative flex h-full flex-col overflow-hidden rounded-3xl border border-border bg-surface p-7 transition-colors duration-300 hover:border-border-strong"
            >
              <div
                aria-hidden="true"
                className="pointer-events-none absolute -inset-px rounded-3xl opacity-0 transition-opacity duration-300 group-hover:opacity-100"
                style={{
                  background:
                    "radial-gradient(420px circle at var(--x) var(--y), color-mix(in srgb, var(--raw-grad-2) 14%, transparent), transparent 45%)",
                }}
              />
              <span className="flex h-11 w-11 items-center justify-center rounded-2xl border border-border bg-surface-strong">
                <p.icon className="h-5 w-5 text-fg" strokeWidth={1.75} />
              </span>
              <h3 className="mt-10 text-lg font-semibold tracking-tight text-fg">{p.title}</h3>
              <p className="mt-2 text-[15px] leading-relaxed text-fg-muted">{p.body}</p>
            </Link>
          </Reveal>
        ))}
      </div>
    </section>
  );
}
