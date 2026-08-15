// Landing "AI study app" section. Deliberately short on screen — the long-form
// keyword copy that used to live here now sits in the FAQ, which is crawlable
// but collapsed, so the page reads light without losing the search terms.

import { motion } from "framer-motion";

const STUDY_BOARDS = [
  "CBSE", "ICSE / ISC", "Maharashtra", "UP Board", "Tamil Nadu", "Karnataka",
  "IB", "Cambridge", "GCSE", "AP", "NIOS", "JEE · NEET · UPSC",
];

export default function StudySection() {
  return (
    <section id="study" className="border-y border-foreground/10 bg-foreground/[0.02] px-4 py-20 sm:px-6">
      <div className="mx-auto max-w-3xl text-center">
        <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-indigo-300">
          AI study app · homework help
        </p>
        <h2 className="mt-4 text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
          Also: a tutor that knows your board.
        </h2>
        <p className="mx-auto mt-4 max-w-xl text-base leading-7 text-muted-foreground">
          Answers in your exam's marking scheme, grounded in your own notes. Grade 6 to PhD.
        </p>

        <motion.div
          initial={{ opacity: 0, y: 12 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="mt-8 flex flex-wrap justify-center gap-2"
        >
          {STUDY_BOARDS.map((board) => (
            <span
              key={board}
              className="rounded-full border border-foreground/10 bg-background/60 px-3 py-1.5 text-[12px] font-medium text-muted-foreground"
            >
              {board}
            </span>
          ))}
        </motion.div>
      </div>
    </section>
  );
}
