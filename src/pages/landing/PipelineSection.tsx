// Landing "AI app builder" section — the agent roster as a visual flow plus a
// three-number price contrast. The long explainer paragraphs that used to sit
// here moved into the FAQ: crawlable for search, collapsed for the reader.

import { motion } from "framer-motion";

// Two words each. The grid is a picture of the pipeline, not a description of it.
const PIPELINE_AGENTS = [
  { name: "Dispatcher", role: "picks the crew" },
  { name: "Researcher", role: "reads the docs" },
  { name: "Analyser", role: "designs it" },
  { name: "Planner", role: "splits the work" },
  { name: "Coder", role: "writes the code" },
  { name: "Optimiser", role: "tightens it" },
  { name: "Organizer", role: "docs & structure" },
  { name: "Tester", role: "runs the tests" },
  { name: "Hacker", role: "attacks it" },
  { name: "Critic", role: "final gate" },
];

const STATS = [
  { value: "10", label: "agents on call" },
  { value: "$0", label: "to start, every day" },
  { value: "1", label: "prompt to ship" },
];

export default function PipelineSection() {
  return (
    <section id="pipeline" className="px-4 py-20 sm:px-6">
      <div className="mx-auto max-w-5xl">
        <div className="text-center">
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-emerald-300">AI app builder</p>
          <h2 className="mx-auto mt-4 max-w-2xl text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
            One prompt in. A whole team on it.
          </h2>
        </div>

        <div className="mt-12 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
          {PIPELINE_AGENTS.map((agent, index) => (
            <motion.div
              key={agent.name}
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-40px" }}
              transition={{ delay: index * 0.05, duration: 0.4 }}
              className="rounded-xl border border-emerald-300/15 bg-emerald-300/[0.04] p-4"
            >
              <span className="text-[10px] font-semibold text-emerald-300/70">{String(index + 1).padStart(2, "0")}</span>
              <p className="mt-1.5 text-[13px] font-semibold text-foreground">{agent.name}</p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">{agent.role}</p>
            </motion.div>
          ))}
        </div>

        <div className="mt-14 grid gap-6 border-t border-foreground/10 pt-10 sm:grid-cols-3">
          {STATS.map((stat) => (
            <div key={stat.label} className="text-center">
              <p className="text-4xl font-semibold tracking-tight text-foreground">{stat.value}</p>
              <p className="mt-1.5 text-[13px] text-muted-foreground">{stat.label}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
