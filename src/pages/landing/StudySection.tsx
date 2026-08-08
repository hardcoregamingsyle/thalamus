// Landing "AI study app" section — the SEO-heavy pitch to students and
// parents plus the board/exam pill list.

import { motion } from "framer-motion";
import { CheckCircle } from "lucide-react";

// Study mode — the section search engines and parents actually look for.
const STUDY_BOARDS = [
  "CBSE", "ICSE / ISC", "Maharashtra Board", "UP Board", "Tamil Nadu Board", "Karnataka Board",
  "IB (MYP / DP)", "Cambridge IGCSE / A-Level", "GCSE", "AP", "NIOS", "JEE · NEET · UPSC",
];

export default function StudySection() {
  return (
    <section id="study" className="border-y border-foreground/10 bg-foreground/[0.02] px-4 py-20 sm:px-6">
      <div className="mx-auto max-w-7xl">
        <div className="grid gap-10 lg:grid-cols-[1.1fr_0.9fr] lg:items-center">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-indigo-300">AI study app · homework help</p>
            <h2 className="mt-3 text-3xl font-semibold text-foreground sm:text-5xl">
              AI study assistant for every board — grade 6 to PhD.
            </h2>
            <p className="mt-4 text-sm leading-6 text-muted-foreground">
              Thalamus is the AI study app that gives instant homework help and doubt solving — a tutor, not an
              answer machine. It knows your board's marking scheme (CBSE step-marking, ICSE depth, IB command
              terms, Cambridge mark schemes) and answers the way your examiner wants. Upload your NCERT notes,
              sample papers, and previous year questions (PYQs), and answers come grounded in <em>your</em> material,
              not generic internet memory.
            </p>
            <ul className="mt-6 space-y-2.5 text-sm text-muted-foreground">
              {[
                "Mark-weighted exam answers — ask for a 5-mark answer and get exactly that",
                "Explains, then makes you try — practice questions, feedback on your attempts",
                "Mock tests, flashcards, and quizzes generated from what you studied",
                "Answers in English, Hindi, Tamil, and other languages you prefer",
              ].map((line) => (
                <li key={line} className="flex items-start gap-2">
                  <CheckCircle className="mt-0.5 h-4 w-4 shrink-0 text-indigo-300" />
                  <span>{line}</span>
                </li>
              ))}
            </ul>
          </div>

          <motion.div
            initial={{ opacity: 0, x: 24 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            className="rounded-lg border border-indigo-300/20 bg-indigo-300/[0.05] p-6"
          >
            <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-indigo-300">Boards & exams covered</p>
            <div className="mt-4 flex flex-wrap gap-2">
              {STUDY_BOARDS.map((board) => (
                <span key={board} className="rounded-full border border-foreground/10 bg-background/60 px-3 py-1.5 text-[11px] font-medium text-foreground">
                  {board}
                </span>
              ))}
            </div>
            <p className="mt-5 text-[11px] leading-5 text-muted-foreground">
              Plus every other state board and university curriculum — study mode adapts its language, depth,
              and answer format to the grade and board on your profile.
            </p>
          </motion.div>
        </div>
      </div>
    </section>
  );
}
