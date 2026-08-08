// Landing FAQ section. Content comes from src/content/faq.ts, which must
// stay word-for-word in sync with the FAQPage JSON-LD block in /index.html.

import { motion } from "framer-motion";
import { ChevronRight } from "lucide-react";
import { FAQ_ITEMS } from "@/content/faq";

export default function FaqSection() {
  return (
    <section id="faq" className="px-4 py-20 sm:px-6">
      <div className="mx-auto max-w-4xl">
        <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-primary">Questions</p>
        <h2 className="mt-3 text-3xl font-semibold text-foreground sm:text-4xl">Frequently asked questions</h2>
        <div className="mt-8 space-y-3">
          {FAQ_ITEMS.map((item, index) => (
            <motion.details
              key={item.q}
              initial={{ opacity: 0, y: 12 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: index * 0.04 }}
              className="group rounded-lg border border-foreground/10 bg-foreground/[0.03] px-5 py-4"
            >
              <summary className="cursor-pointer list-none text-sm font-semibold text-foreground marker:content-none">
                <span className="flex items-center justify-between gap-4">
                  {item.q}
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-90" />
                </span>
              </summary>
              <p className="mt-3 text-sm leading-6 text-muted-foreground">{item.a}</p>
            </motion.details>
          ))}
        </div>
      </div>
    </section>
  );
}
