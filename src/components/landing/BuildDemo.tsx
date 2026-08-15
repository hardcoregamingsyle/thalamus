import { motion, useReducedMotion } from "framer-motion";
import { useEffect, useState } from "react";
import { Check, FileCode2, Loader2, Terminal } from "lucide-react";

// The hero's product demo — a looping mock of a real Build run: the prompt
// types itself, the dispatched agents tick through, then the written files
// land. It replaces the paragraph-heavy console that used to sit here; showing
// the pipeline work reads faster than describing it.

const PROMPT = "build a habit tracker with charts and dark mode";

const AGENTS = [
  { name: "Dispatcher", detail: "picked 5 agents" },
  { name: "Planner", detail: "7 tasks" },
  { name: "Coder", detail: "wrote 6 files" },
  { name: "Tester", detail: "12 tests passed" },
  { name: "Critic", detail: "approved" },
];

const FILES = ["App.tsx", "HabitChart.tsx", "storage.ts", "theme.css"];

// Timeline (ms from loop start)
const TYPE_MS = 45;                                   // per character
const PROMPT_DONE = PROMPT.length * TYPE_MS + 300;
const AGENT_STEP = 620;
const FILES_AT = PROMPT_DONE + AGENTS.length * AGENT_STEP + 200;
const LOOP_MS = FILES_AT + 2600;

export default function BuildDemo() {
  const reduceMotion = useReducedMotion();
  const [t, setT] = useState(reduceMotion ? LOOP_MS : 0);

  useEffect(() => {
    if (reduceMotion) return; // show the finished state, never animate
    const started = Date.now();
    const id = setInterval(() => setT((Date.now() - started) % LOOP_MS), 60);
    return () => clearInterval(id);
  }, [reduceMotion]);

  const typed = PROMPT.slice(0, Math.min(PROMPT.length, Math.floor(t / TYPE_MS)));
  const agentsDone = Math.max(0, Math.min(AGENTS.length, Math.floor((t - PROMPT_DONE) / AGENT_STEP)));
  const showFiles = t >= FILES_AT;

  return (
    <div className="mx-auto w-full max-w-2xl overflow-hidden rounded-xl border border-white/10 bg-[#0a1020]/80 shadow-2xl shadow-black/40 backdrop-blur-xl">
      {/* window chrome */}
      <div className="flex items-center gap-2 border-b border-white/10 px-4 py-3">
        <span className="h-2.5 w-2.5 rounded-full bg-red-400/70" />
        <span className="h-2.5 w-2.5 rounded-full bg-amber-400/70" />
        <span className="h-2.5 w-2.5 rounded-full bg-emerald-400/70" />
        <span className="ml-2 flex items-center gap-1.5 text-[11px] font-medium text-white/40">
          <Terminal className="h-3 w-3" /> Thalamus · Build
        </span>
      </div>

      <div className="space-y-4 p-5 font-mono text-[13px]">
        {/* prompt */}
        <p className="text-white/70">
          <span className="text-emerald-300">›</span> {typed}
          {typed.length < PROMPT.length && <span className="ml-0.5 inline-block h-4 w-1.5 translate-y-0.5 bg-emerald-300/80" />}
        </p>

        {/* agents */}
        <div className="space-y-1.5">
          {AGENTS.map((agent, i) => {
            const done = i < agentsDone;
            const active = i === agentsDone && t > PROMPT_DONE;
            if (!done && !active) return null;
            return (
              <motion.div
                key={agent.name}
                initial={{ opacity: 0, x: -6 }}
                animate={{ opacity: 1, x: 0 }}
                className="flex items-center gap-2.5"
              >
                {done ? (
                  <Check className="h-3.5 w-3.5 shrink-0 text-emerald-300" />
                ) : (
                  <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-sky-300" />
                )}
                <span className="w-[86px] shrink-0 text-white/80">{agent.name}</span>
                <span className="truncate text-white/35">{done ? agent.detail : "working…"}</span>
              </motion.div>
            );
          })}
        </div>

        {/* files written */}
        {showFiles && (
          <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="flex flex-wrap gap-1.5 pt-1">
            {FILES.map((file, i) => (
              <motion.span
                key={file}
                initial={{ opacity: 0, scale: 0.94 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: i * 0.09 }}
                className="flex items-center gap-1.5 rounded-md border border-emerald-300/20 bg-emerald-300/8 px-2 py-1 text-[11px] text-emerald-200/90"
              >
                <FileCode2 className="h-3 w-3" />
                {file}
              </motion.span>
            ))}
          </motion.div>
        )}
      </div>
    </div>
  );
}
