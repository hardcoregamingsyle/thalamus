"use client";

import { AnimatePresence, motion } from "motion/react";
import { Plus } from "lucide-react";
import { useState } from "react";
import { Reveal } from "@/components/ui/Reveal";

const ITEMS = [
  {
    q: "What is Thalamus Sophon?",
    a: "A model built on a non-transformer architecture. Thalamus serves it through an OpenAI-compatible API, a developer console and a chat app.",
  },
  {
    q: "When can I use it?",
    a: "Thalamus is in private beta. Join the waitlist; accounts are invited in the order they joined.",
  },
  {
    q: "Does it work with the OpenAI SDK?",
    a: "Yes. Set the base URL to https://thalamus.aphantic.skinticals.com/v1 and use a Thalamus API key. Streaming works the same way.",
  },
  {
    q: "What does it cost?",
    a: "Nothing during the beta. Usage is rate-limited while the model is in private beta.",
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
