// Landing capability band — the four-column pitch strip between the study
// section and the FAQ.

import { motion } from "framer-motion";
import { Brain, Layers3, ShieldCheck, Zap } from "lucide-react";

const CAPABILITIES = [
  { icon: Brain, label: "Helpful for everything", detail: "Use one AI for questions, learning, research, writing, planning, and building." },
  { icon: Layers3, label: "Made for real life", detail: "Switch between quick help, deeper learning, and bigger projects without changing tools." },
  { icon: ShieldCheck, label: "Private by default", detail: "Your work stays in your session, so you can think, learn, and create with confidence." },
  { icon: Zap, label: "Fast and easy", detail: "Responses appear as they are written, so the experience feels immediate and natural." },
];

export default function CapabilityBand() {
  return (
    <section className="border-y border-foreground/10 bg-foreground/[0.025] px-4 py-16 sm:px-6">
      <div className="mx-auto grid max-w-7xl gap-3 md:grid-cols-4">
        {CAPABILITIES.map((item, index) => (
          <motion.div
            key={item.label}
            initial={{ opacity: 0, y: 14 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: index * 0.05 }}
            className="rounded-lg border border-foreground/10 bg-background/55 p-5"
          >
            <item.icon className="h-5 w-5 text-primary" />
            <p className="mt-5 text-sm font-bold text-foreground">{item.label}</p>
            <p className="mt-2 text-xs leading-5 text-muted-foreground">{item.detail}</p>
          </motion.div>
        ))}
      </div>
    </section>
  );
}
