import { motion } from "framer-motion";
import { useNavigate } from "react-router";
import { useAuth } from "@/hooks/use-auth";
import { useState, useEffect } from "react";
import {
  Cpu, Zap, Brain, Code2, Shield, ChevronRight, ExternalLink,
  Users, Rocket, Globe, Terminal, Activity, Search, FileCode,
  CheckCircle, ArrowRight, Layers, GitBranch, Eye, Lock,
} from "lucide-react";

// ── Judges ────────────────────────────────────────────────────────────────────
const JUDGES = [
  { name: "Sanem Avcil", role: "AI & Blockchain Advisor", company: "Kaisvault", img: "https://cdn.builder.io/api/v1/image/assets%2F972274c44a2d4c658b0fa440848d24a1%2F65da17e9ad4b415da2e398b2efa2002d" },
  { name: "Rahul Gupta", role: "Head of AI Foundry", company: "Evergreen", img: "https://cdn.builder.io/api/v1/image/assets%2F972274c44a2d4c658b0fa440848d24a1%2Fb3c2d7b34eac49b5a2a0f563fdd91b69" },
  { name: "Vishal Paul", role: "Senior Software Engineer", company: "PayPal", img: "https://cdn.builder.io/api/v1/image/assets%2F972274c44a2d4c658b0fa440848d24a1%2Fff0c43e7c97847f8be0f2f439fecd290" },
  { name: "Pawel Czech", role: "CEO", company: "NativelyAI", img: "https://cdn.builder.io/api/v1/image/assets%2F972274c44a2d4c658b0fa440848d24a1%2F3debee6a46d44a2da556a6564c7bd7bd" },
];

// ── Agent pipeline data ────────────────────────────────────────────────────────
const AGENTS = [
  { name: "Researcher", abbr: "R", color: "text-cyan-400", bg: "bg-cyan-400/10 border-cyan-400/30", desc: "Deep web research & knowledge gathering" },
  { name: "Analyser", abbr: "A", color: "text-blue-400", bg: "bg-blue-400/10 border-blue-400/30", desc: "Architecture planning & tech analysis" },
  { name: "Planner", abbr: "P", color: "text-violet-400", bg: "bg-violet-400/10 border-violet-400/30", desc: "Task decomposition into 12-20 atomic steps" },
  { name: "Coder", abbr: "C", color: "text-emerald-400", bg: "bg-emerald-400/10 border-emerald-400/30", desc: "Full production-ready implementation" },
  { name: "Optimiser", abbr: "O", color: "text-amber-400", bg: "bg-amber-400/10 border-amber-400/30", desc: "Performance, security & bundle optimization" },
  { name: "Organizer", abbr: "📝", color: "text-orange-400", bg: "bg-orange-400/10 border-orange-400/30", desc: "Human-readable docs & README generation" },
  { name: "Tester", abbr: "T", color: "text-green-400", bg: "bg-green-400/10 border-green-400/30", desc: "Automated test suite execution & reporting" },
  { name: "Hacker", abbr: "H", color: "text-red-400", bg: "bg-red-400/10 border-red-400/30", desc: "Security audit & vulnerability reporting" },
  { name: "Critic", abbr: "Q", color: "text-purple-400", bg: "bg-purple-400/10 border-purple-400/30", desc: "Final quality gate & completeness review" },
];

const FEATURES = [
  {
    icon: Layers,
    title: "9-Agent Orchestration",
    desc: "A full pipeline from research to deployment. Each agent has a specialized role — no shortcuts, no hallucinations.",
    color: "text-primary",
    border: "border-primary/20 hover:border-primary/50",
  },
  {
    icon: Brain,
    title: "Gemini 3.1 Flash-Lite",
    desc: "Highest thinking mode enabled. Maximum reasoning budget for every agent call — deep, deliberate outputs.",
    color: "text-violet-400",
    border: "border-violet-400/20 hover:border-violet-400/50",
  },
  {
    icon: GitBranch,
    title: "Planner-Driven Tasks",
    desc: "The Planner decomposes every project into 12-20 atomic tasks. No vague instructions — just precise execution.",
    color: "text-cyan-400",
    border: "border-cyan-400/20 hover:border-cyan-400/50",
  },
  {
    icon: FileCode,
    title: "Live Daytona Sandbox",
    desc: "Code runs in a real cloud sandbox. Tests execute, commands run, previews deploy — all live.",
    color: "text-emerald-400",
    border: "border-emerald-400/20 hover:border-emerald-400/50",
  },
  {
    icon: Eye,
    title: "Real-Time Streaming",
    desc: "Watch every agent think in real time. Live output streaming via Convex reactive queries.",
    color: "text-amber-400",
    border: "border-amber-400/20 hover:border-amber-400/50",
  },
  {
    icon: Lock,
    title: "Security-First Pipeline",
    desc: "Dedicated Hacker agent audits every codebase. Vulnerabilities reported, Coder fixes — never skipped.",
    color: "text-red-400",
    border: "border-red-400/20 hover:border-red-400/50",
  },
];

// ── Particle background ────────────────────────────────────────────────────────
function ParticleField() {
  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none">
      {Array.from({ length: 16 }).map((_, i) => (
        <motion.div
          key={i}
          className="absolute w-px h-px rounded-full bg-primary/30"
          style={{ left: `${(i * 6.25) % 100}%`, top: `${(i * 11.3) % 100}%` }}
          animate={{ y: [0, -20, 0], opacity: [0, 0.5, 0], scale: [0, 2, 0] }}
          transition={{ duration: 4 + (i % 3), delay: i * 0.4, repeat: Infinity, repeatDelay: i * 0.2 }}
        />
      ))}
    </div>
  );
}

// ── Animated pipeline ─────────────────────────────────────────────────────────
function LivePipeline() {
  const [activeIdx, setActiveIdx] = useState(3);
  useEffect(() => {
    const t = setInterval(() => setActiveIdx(i => (i + 1) % AGENTS.length), 1800);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="border border-border bg-card rounded-2xl overflow-hidden shadow-2xl">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border bg-card/80">
        <div className="w-2.5 h-2.5 rounded-full bg-destructive" />
        <div className="w-2.5 h-2.5 rounded-full bg-accent" />
        <div className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
        <span className="text-[11px] text-muted-foreground ml-2 font-mono">agent_team — live session</span>
        <div className="ml-auto flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
          <span className="text-[10px] text-emerald-400 font-mono">RUNNING</span>
        </div>
      </div>
      <div className="p-4 space-y-1.5">
        {AGENTS.map((agent, i) => {
          const isDone = i < activeIdx;
          const isActive = i === activeIdx;
          return (
            <motion.div
              key={agent.name}
              animate={isActive ? { scale: [1, 1.01, 1] } : {}}
              transition={{ duration: 0.8, repeat: isActive ? Infinity : 0 }}
              className={`flex items-center gap-3 px-3 py-2 rounded-lg border transition-all ${
                isActive
                  ? `${agent.bg} shadow-sm`
                  : isDone
                  ? "border-border/30 bg-muted/20 opacity-60"
                  : "border-border/20 bg-transparent opacity-40"
              }`}
            >
              <div className={`w-5 h-5 rounded border flex items-center justify-center text-[9px] font-bold shrink-0 ${agent.bg} ${agent.color}`}>
                {isDone ? "✓" : agent.abbr}
              </div>
              <span className={`text-[11px] font-bold font-mono ${isActive ? agent.color : isDone ? "text-muted-foreground" : "text-muted-foreground/40"}`}>
                {agent.name}
              </span>
              <span className={`text-[10px] ml-auto font-mono ${isActive ? "text-emerald-400 animate-pulse" : isDone ? "text-muted-foreground/50" : "text-muted-foreground/20"}`}>
                {isActive ? "RUNNING..." : isDone ? "✓ DONE" : "QUEUED"}
              </span>
            </motion.div>
          );
        })}
      </div>
      <div className="px-4 py-3 border-t border-border bg-card/50 flex items-center justify-between">
        <span className="text-[10px] text-muted-foreground font-mono">Task 4/14 • TASKS PHASE</span>
        <span className="text-[10px] text-primary font-mono">gemini-3.1-flash-lite ✦ thinking:high</span>
      </div>
    </div>
  );
}

// ── Main Landing ───────────────────────────────────────────────────────────────
export default function Landing() {
  const navigate = useNavigate();
  const { isAuthenticated, isLoading } = useAuth();

  const handleLaunch = () => navigate(isAuthenticated ? "/portal" : "/auth");

  return (
    <div className="min-h-screen bg-background font-mono overflow-x-hidden">
      {/* ── Nav ─────────────────────────────────────────────────────────────── */}
      <nav className="fixed top-0 left-0 right-0 z-50 border-b border-border bg-background/90 backdrop-blur-md">
        <div className="max-w-7xl mx-auto px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-7 h-7 rounded-lg bg-primary/20 border border-primary/40 flex items-center justify-center">
              <Cpu className="h-3.5 w-3.5 text-primary" />
            </div>
            <span className="text-primary font-bold text-sm tracking-widest amd-glow">AGENT_AI</span>
            <span className="hidden sm:block text-[10px] text-muted-foreground border border-border px-2 py-0.5 rounded-full">
              AMD Developer Hackathon 2025
            </span>
          </div>
          <div className="flex items-center gap-3">
            <a href="https://lablab.ai/ai-hackathons/amd-developer" target="_blank" rel="noopener noreferrer"
              className="hidden sm:flex items-center gap-1 text-[11px] text-muted-foreground hover:text-primary transition-colors">
              <ExternalLink className="h-3 w-3" />lablab.ai
            </a>
            <button onClick={handleLaunch}
              className="flex items-center gap-1.5 text-xs border border-primary text-primary px-4 py-1.5 rounded-lg hover:bg-primary hover:text-primary-foreground transition-all font-bold">
              {isLoading ? "..." : isAuthenticated ? "OPEN PORTAL" : "TRY IT"}
              <ChevronRight className="h-3 w-3" />
            </button>
          </div>
        </div>
      </nav>

      {/* ── Hero ────────────────────────────────────────────────────────────── */}
      <section className="relative min-h-screen flex items-center pt-14 overflow-hidden">
        <ParticleField />
        <div className="absolute inset-0 opacity-[0.025]" style={{
          backgroundImage: "linear-gradient(oklch(0.60 0.22 25) 1px, transparent 1px), linear-gradient(90deg, oklch(0.60 0.22 25) 1px, transparent 1px)",
          backgroundSize: "50px 50px",
        }} />
        <div className="absolute top-1/3 right-1/3 w-80 h-80 rounded-full bg-primary/4 blur-3xl pointer-events-none" />

        <div className="relative max-w-7xl mx-auto px-6 py-24 grid lg:grid-cols-2 gap-16 items-center">
          <motion.div initial={{ opacity: 0, x: -30 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.7 }}>
            {/* Hackathon badge */}
            <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}
              className="inline-flex items-center gap-2 border border-primary/30 bg-primary/8 text-primary text-[10px] font-bold px-3 py-1.5 rounded-full mb-6">
              <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
              AMD DEVELOPER HACKATHON 2025 — TRACK 2: FINE-TUNING
            </motion.div>

            <h1 className="text-5xl md:text-6xl font-bold leading-[1.1] mb-5">
              <span className="text-foreground">A 9-Agent</span>
              <br />
              <span className="text-primary amd-glow">AI Coding</span>
              <br />
              <span className="text-foreground">System</span>
            </h1>

            <p className="text-muted-foreground text-sm leading-relaxed mb-3 max-w-lg">
              AgentAI orchestrates <span className="text-foreground font-semibold">9 specialized AI agents</span> — Researcher, Analyser, Planner, Coder, Optimiser, Organizer, Tester, Hacker, and Critic — to build complete, production-ready software from a single prompt.
            </p>

            <p className="text-muted-foreground text-xs leading-relaxed mb-8 max-w-lg">
              Built on <span className="text-accent font-bold">AMD Instinct MI300X GPUs</span> with ROCm. 
              Fine-tuning <span className="text-primary font-bold">Llama 3 8B</span> for domain-specific coding intelligence — custom API endpoints coming soon.
            </p>

            <div className="flex flex-col sm:flex-row gap-3 mb-10">
              <motion.button onClick={handleLaunch} whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
                className="flex items-center justify-center gap-2 px-7 py-3.5 bg-primary text-primary-foreground text-sm font-bold rounded-xl hover:bg-primary/90 transition-all shadow-lg shadow-primary/20">
                <Terminal className="h-4 w-4" />
                LAUNCH AGENT PORTAL
                <ChevronRight className="h-4 w-4" />
              </motion.button>
              <motion.a href="https://lablab.ai/ai-hackathons/amd-developer" target="_blank" rel="noopener noreferrer"
                whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
                className="flex items-center justify-center gap-2 px-5 py-3.5 border border-border text-muted-foreground text-sm rounded-xl hover:border-primary/50 hover:text-primary transition-all">
                <ExternalLink className="h-4 w-4" />
                Hackathon Page
              </motion.a>
            </div>

            {/* Key metrics */}
            <div className="flex items-center gap-6 text-xs">
              {[
                { val: "9", label: "Specialized Agents", color: "text-primary" },
                { val: "600", label: "Max Messages/Session", color: "text-accent" },
                { val: "Llama 3 8B", label: "Fine-Tuned Model", color: "text-violet-400" },
              ].map((m, i) => (
                <div key={i} className={i > 0 ? "border-l border-border pl-6" : ""}>
                  <div className={`font-bold text-base ${m.color}`}>{m.val}</div>
                  <div className="text-muted-foreground text-[10px]">{m.label}</div>
                </div>
              ))}
            </div>
          </motion.div>

          {/* Right: Live pipeline */}
          <motion.div initial={{ opacity: 0, x: 30 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.7, delay: 0.2 }}>
            <LivePipeline />
          </motion.div>
        </div>
      </section>

      {/* ── How it works ────────────────────────────────────────────────────── */}
      <section className="border-t border-border py-20">
        <div className="max-w-7xl mx-auto px-6">
          <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} className="mb-12">
            <p className="text-xs text-muted-foreground mb-2 font-bold tracking-widest">HOW IT WORKS</p>
            <h2 className="text-3xl font-bold text-foreground">
              One prompt. <span className="text-primary amd-glow">Nine agents.</span> Complete software.
            </h2>
          </motion.div>

          <div className="grid md:grid-cols-3 gap-4 mb-12">
            {[
              { step: "01", title: "You describe the project", desc: "Type what you want to build. AgentAI handles everything from research to deployment.", icon: Terminal },
              { step: "02", title: "Agents plan & execute", desc: "The Planner breaks it into 12-20 atomic tasks. Each agent runs its specialized role in sequence.", icon: Layers },
              { step: "03", title: "Production-ready output", desc: "Complete codebase, tests, docs, security audit — deployed to a live Daytona sandbox.", icon: Rocket },
            ].map((item, i) => (
              <motion.div key={i} initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: i * 0.1 }}
                className="border border-border bg-card rounded-xl p-6 relative overflow-hidden group hover:border-primary/40 transition-all">
                <div className="absolute top-4 right-4 text-5xl font-bold text-muted-foreground/5 group-hover:text-primary/5 transition-colors">{item.step}</div>
                <item.icon className="h-5 w-5 text-primary mb-4" />
                <h3 className="text-sm font-bold text-foreground mb-2">{item.title}</h3>
                <p className="text-xs text-muted-foreground leading-relaxed">{item.desc}</p>
              </motion.div>
            ))}
          </div>

          {/* Agent grid */}
          <div className="grid grid-cols-3 sm:grid-cols-5 lg:grid-cols-9 gap-2">
            {AGENTS.map((agent, i) => (
              <motion.div key={agent.name} initial={{ opacity: 0, scale: 0.8 }} whileInView={{ opacity: 1, scale: 1 }} viewport={{ once: true }} transition={{ delay: i * 0.05 }}
                className={`border ${agent.bg} rounded-xl p-3 text-center group hover:scale-105 transition-all cursor-default`}>
                <div className={`text-lg font-bold ${agent.color} mb-1`}>{agent.abbr}</div>
                <div className={`text-[9px] font-bold ${agent.color}`}>{agent.name}</div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Features ────────────────────────────────────────────────────────── */}
      <section className="border-t border-border py-20 bg-card/20">
        <div className="max-w-7xl mx-auto px-6">
          <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} className="mb-12">
            <p className="text-xs text-muted-foreground mb-2 font-bold tracking-widest">CAPABILITIES</p>
            <h2 className="text-3xl font-bold text-foreground">
              Built to be a <span className="text-primary amd-glow">Level 4.5 Agent</span>
            </h2>
            <p className="text-sm text-muted-foreground mt-2 max-w-xl">
              Not a chatbot. Not a code autocomplete. A full autonomous software engineering system.
            </p>
          </motion.div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {FEATURES.map((f, i) => (
              <motion.div key={f.title} initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: i * 0.08 }}
                className={`border ${f.border} bg-card rounded-xl p-5 transition-all group`}>
                <f.icon className={`h-5 w-5 ${f.color} mb-3`} />
                <h3 className={`text-sm font-bold ${f.color} mb-1.5`}>{f.title}</h3>
                <p className="text-xs text-muted-foreground leading-relaxed">{f.desc}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ── AMD Tech Stack ───────────────────────────────────────────────────── */}
      <section className="border-t border-border py-20">
        <div className="max-w-7xl mx-auto px-6">
          <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} className="mb-10">
            <p className="text-xs text-muted-foreground mb-2 font-bold tracking-widest">INFRASTRUCTURE</p>
            <h2 className="text-3xl font-bold text-foreground">
              Powered by <span className="text-accent amd-glow-orange">AMD Hardware</span>
            </h2>
          </motion.div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              { title: "AMD Instinct MI300X", sub: "192GB HBM3 memory", desc: "World's most powerful AI accelerator. Fine-tuning Llama 3 8B with full parameter training.", color: "border-accent/40 hover:border-accent", icon: Cpu },
              { title: "ROCm Platform", sub: "Open-source GPU compute", desc: "AMD's answer to CUDA. Full PyTorch support, HIP kernels, and optimized ML primitives.", color: "border-primary/40 hover:border-primary", icon: Code2 },
              { title: "Llama 3 8B Fine-Tune", sub: "Domain-specific training", desc: "Custom fine-tuned model for coding intelligence. Trained on AMD hardware, served via vLLM.", color: "border-violet-400/40 hover:border-violet-400", icon: Brain },
              { title: "Daytona Sandbox", sub: "Live code execution", desc: "Every generated project runs in a real cloud environment. Tests pass, previews deploy.", color: "border-emerald-400/40 hover:border-emerald-400", icon: Globe },
            ].map((item, i) => (
              <motion.div key={item.title} initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: i * 0.1 }}
                className={`border ${item.color} bg-card rounded-xl p-5 transition-all`}>
                <item.icon className="h-5 w-5 text-muted-foreground mb-3" />
                <h3 className="text-sm font-bold text-foreground mb-0.5">{item.title}</h3>
                <p className="text-[10px] text-primary font-bold mb-2">{item.sub}</p>
                <p className="text-xs text-muted-foreground leading-relaxed">{item.desc}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Judges ──────────────────────────────────────────────────────────── */}
      <section className="border-t border-border py-20 bg-card/20">
        <div className="max-w-7xl mx-auto px-6">
          <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} className="mb-10">
            <p className="text-xs text-muted-foreground mb-2 font-bold tracking-widest">JUDGING PANEL</p>
            <h2 className="text-3xl font-bold text-foreground">
              Who's <span className="text-primary amd-glow">Evaluating</span>
            </h2>
          </motion.div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-5">
            {JUDGES.map((judge, i) => (
              <motion.div key={judge.name} initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: i * 0.1 }}
                className="border border-border bg-card rounded-xl p-5 text-center hover:border-primary/30 transition-all group">
                <div className="w-14 h-14 rounded-full overflow-hidden border-2 border-border group-hover:border-primary/30 transition-all mx-auto mb-3">
                  <img src={judge.img} alt={judge.name} className="w-full h-full object-cover"
                    onError={(e) => { (e.target as HTMLImageElement).src = `https://ui-avatars.com/api/?name=${encodeURIComponent(judge.name)}&background=1a1a1a&color=ed1c24&size=56`; }} />
                </div>
                <p className="text-xs font-bold text-foreground mb-0.5">{judge.name}</p>
                <p className="text-[10px] text-muted-foreground mb-2">{judge.role}</p>
                <span className="text-[10px] bg-primary/10 text-primary border border-primary/20 px-2 py-0.5 rounded-full">{judge.company}</span>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA ─────────────────────────────────────────────────────────────── */}
      <section className="border-t border-border py-20">
        <div className="max-w-2xl mx-auto px-6 text-center">
          <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }}>
            <div className="border border-primary/20 bg-primary/5 rounded-2xl p-10">
              <div className="w-14 h-14 rounded-2xl bg-primary/20 border border-primary/30 flex items-center justify-center mx-auto mb-5">
                <Rocket className="h-7 w-7 text-primary" />
              </div>
              <h2 className="text-2xl font-bold text-foreground mb-2">
                See it in <span className="text-primary amd-glow">action</span>
              </h2>
              <p className="text-sm text-muted-foreground mb-6 max-w-md mx-auto">
                Give AgentAI a project description. Watch 9 agents plan, build, test, and deploy it — live.
              </p>
              <motion.button onClick={handleLaunch} whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
                className="flex items-center justify-center gap-2 px-8 py-3.5 bg-primary text-primary-foreground text-sm font-bold rounded-xl hover:bg-primary/90 transition-all shadow-lg shadow-primary/20 mx-auto">
                <Terminal className="h-4 w-4" />
                LAUNCH AGENT PORTAL
                <ArrowRight className="h-4 w-4" />
              </motion.button>
            </div>
          </motion.div>
        </div>
      </section>

      {/* ── Footer ──────────────────────────────────────────────────────────── */}
      <footer className="border-t border-border py-6 px-6">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <div className="w-5 h-5 rounded bg-primary/20 border border-primary/30 flex items-center justify-center">
              <Cpu className="h-2.5 w-2.5 text-primary" />
            </div>
            <span className="text-xs text-muted-foreground">AgentAI — AMD Developer Hackathon 2025</span>
          </div>
          <div className="flex items-center gap-4 text-xs text-muted-foreground">
            <a href="https://lablab.ai/ai-hackathons/amd-developer" target="_blank" rel="noopener noreferrer" className="hover:text-primary transition-colors flex items-center gap-1">
              <ExternalLink className="h-3 w-3" />lablab.ai
            </a>
            <a href="https://www.amd.com/en/developer/ai-dev-program.html" target="_blank" rel="noopener noreferrer" className="hover:text-accent transition-colors flex items-center gap-1">
              <ExternalLink className="h-3 w-3" />AMD Developer
            </a>
            <span>© 2025 AgentAI</span>
          </div>
        </div>
      </footer>
    </div>
  );
}