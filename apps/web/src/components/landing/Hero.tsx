"use client";

import { ArrowRight } from "lucide-react";
import { motion, useScroll, useTransform } from "motion/react";
import { Aurora } from "@/components/site/Aurora";
import { ButtonLink } from "@/components/ui/Button";
import { ApiDemo } from "./ApiDemo";

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
  const { scrollY } = useScroll();
  const auroraOpacity = useTransform(scrollY, [0, 700], [1, 0.25]);

  return (
    <section className="relative isolate overflow-hidden pt-32 sm:pt-40">
      <motion.div
        style={{ opacity: auroraOpacity }}
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[1000px]"
      >
        <Aurora className="h-full w-full scale-110 blur-[56px]" />
        <div className="bg-grid absolute inset-0 opacity-60" />
        <div className="absolute inset-x-0 bottom-0 h-64 bg-gradient-to-b from-transparent to-bg" />
      </motion.div>

      <div className="mx-auto max-w-5xl px-4 text-center sm:px-6">
        <h1 className="text-balance text-[2.5rem] font-semibold leading-[1.04] tracking-[-0.035em] text-fg sm:text-7xl md:text-[5.25rem]">
          <Line delay={0.05}>A new kind of model.</Line>
          <Line delay={0.18}>
            <span className="text-gradient animate-shimmer">Not a transformer.</span>
          </Line>
        </h1>

        <p
          style={{ animationDelay: "0.42s" }}
          className="animate-rise mx-auto mt-7 max-w-xl text-pretty text-base leading-relaxed text-fg-muted sm:text-lg"
        >
          Thalamus Sophon runs on an architecture of its own, served through an OpenAI-compatible
          API. Now in private beta.
        </p>

        <div
          style={{ animationDelay: "0.54s" }}
          className="animate-rise mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row"
        >
          <ButtonLink href="/auth" size="lg">
            Join the waitlist
            <ArrowRight className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5" />
          </ButtonLink>
          <ButtonLink href="/docs" size="lg" variant="secondary">
            Read the docs
          </ButtonLink>
        </div>
      </div>

      <div
        style={{ animationDelay: "0.7s", animationDuration: "1.1s" }}
        className="animate-rise [--rise:40px] mx-auto mt-20 max-w-5xl px-4 pb-24 sm:mt-24 sm:px-6"
      >
        <ApiDemo />
      </div>
    </section>
  );
}
