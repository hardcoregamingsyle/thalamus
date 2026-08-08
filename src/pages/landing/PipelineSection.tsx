// Landing "AI app builder" pipeline story — the 10-agent grid the scroll
// walks through.

import { motion } from "framer-motion";

// The build pipeline, told as a scroll story — each agent card slides in as
// you reach it, so scrolling literally walks the pipeline.
const PIPELINE_AGENTS = [
  { name: "Dispatcher", role: "Reads your task and picks the smallest crew that can nail it" },
  { name: "Researcher", role: "Pulls current docs and APIs before a line is written" },
  { name: "Analyser", role: "Turns the request into an architecture" },
  { name: "Planner", role: "Breaks it into atomic, checkable tasks" },
  { name: "Coder", role: "Writes the complete implementation — real files, real commands" },
  { name: "Optimiser", role: "Performance and quality pass" },
  { name: "Organizer", role: "Structure, docs, readme" },
  { name: "Tester", role: "Writes and runs the tests" },
  { name: "Hacker", role: "Attacks the code before you ever see it" },
  { name: "Critic", role: "Final gate — rejects weak work and sends it back" },
];

export default function PipelineSection() {
  return (
    <section id="pipeline" className="px-4 py-20 sm:px-6">
      <div className="mx-auto max-w-7xl">
        <div className="mb-10 max-w-3xl">
          <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-emerald-300">AI app builder</p>
          <h2 className="mt-3 text-3xl font-semibold text-foreground sm:text-5xl">
            AI app builder: describe it once, a team of AI agents builds it.
          </h2>
          <p className="mt-4 text-sm leading-6 text-muted-foreground">
            Thalamus runs a dynamic multi-agent pipeline: a dispatcher sizes up your task and sends in only the
            agents it needs — up to nine of them — to research, plan, write, test, attack, and review real code.
            A typo fix gets two agents. A full app gets the whole crew. Files get written, commands get executed,
            and finished projects can push straight to GitHub.
          </p>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">
            The big AI coding tools charge $20–200 a month for a single agent. Thalamus runs the whole team on
            free daily credits — you pay only if you want more. <span className="text-foreground/80">L3.5 means it
            plans and executes multi-step builds end to end, verifies its own work through the Tester and Critic,
            and leaves you the final say — autonomy where it helps, control where it matters.</span>
          </p>
        </div>

        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
          {PIPELINE_AGENTS.map((agent, index) => (
            <motion.div
              key={agent.name}
              initial={{ opacity: 0, y: 24, scale: 0.96 }}
              whileInView={{ opacity: 1, y: 0, scale: 1 }}
              viewport={{ once: true, margin: "-60px" }}
              transition={{ delay: index * 0.07, duration: 0.45 }}
              className="rounded-lg border border-emerald-300/15 bg-emerald-300/[0.04] p-4"
            >
              <div className="flex items-center gap-2">
                <span className="flex h-5 w-5 items-center justify-center rounded-full border border-emerald-300/30 text-[10px] font-bold text-emerald-300">
                  {index + 1}
                </span>
                <p className="text-xs font-bold uppercase tracking-[0.14em] text-foreground">{agent.name}</p>
              </div>
              <p className="mt-2 text-[11px] leading-5 text-muted-foreground">{agent.role}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
