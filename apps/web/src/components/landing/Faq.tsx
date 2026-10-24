"use client";

import { AnimatePresence, motion } from "motion/react";
import { Plus } from "lucide-react";
import { useState } from "react";
import { Reveal } from "@/components/ui/Reveal";

const ITEMS = [
  {
    q: "What is NAMELESS?",
    a: "An AI model built on our own architecture, currently in training. We’re working toward unlimited context, persistent memory, and more capable reasoning with much lower ongoing costs.",
  },
  {
    q: "How do I join the waitlist?",
    a: "Create an account with your email, Google, or GitHub. You’ll automatically join the waitlist. We’ll notify you by email when an early-access slot is available.",
  },
  {
    q: "When will it launch?",
    a: "There is no announced launch date. Slots will open as training, evaluation, and capacity allow. Your account shows your waitlist status.",
  },
  {
    q: "How fast will it be?",
    a: "We’re prioritizing deeper reasoning, memory, and cost over response speed. Expect a slower pace than the assistants you may use today; measured results will follow evaluation.",
  },
  {
    q: "What will it cost?",
    a: "Our target is pennies compared with Claude, Gemini, and ChatGPT, especially for long conversations. Final pricing and comparisons will be shared after evaluation. Joining the waitlist is free.",
  },
];

export function Faq() {
  const [open, setOpen] = useState<number | null>(0);
  return (
    <section className="mx-auto max-w-3xl px-4 py-24 sm:px-6 sm:py-32">
      <Reveal>
        <h2 className="text-center text-3xl font-semibold tracking-[-0.03em] text-fg sm:text-5xl">
          Questions
        </h2>
      </Reveal>
      <div className="mt-12 divide-y divide-border border-y border-border">
        {ITEMS.map((item, i) => {
          const isOpen = open === i;
          return (
            <div key={item.q}>
              <button
                type="button"
                onClick={() => setOpen(isOpen ? null : i)}
                aria-expanded={isOpen}
                className="flex w-full items-center justify-between gap-6 py-6 text-left"
              >
                <span className="text-base font-medium text-fg sm:text-lg">{item.q}</span>
                <Plus
                  className={`h-5 w-5 shrink-0 text-fg-subtle transition-transform duration-300 ${isOpen ? "rotate-45" : ""}`}
                />
              </button>
              <AnimatePresence initial={false}>
                {isOpen && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
                    className="overflow-hidden"
                  >
                    <p className="max-w-2xl pb-6 text-[15px] leading-relaxed text-fg-muted">
                      {item.a}
                    </p>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          );
        })}
      </div>
    </section>
  );
}
