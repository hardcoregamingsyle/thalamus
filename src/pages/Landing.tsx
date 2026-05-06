import { motion } from "framer-motion";
import { useNavigate } from "react-router";
import { useAuth } from "@/hooks/use-auth";
import { useState, useEffect } from "react";
import {
  Cpu, Zap, Brain, Code2, Shield, ChevronRight,
  Users, Rocket, Globe, Terminal, Activity, Search, FileCode,
  CheckCircle, ArrowRight, Layers, GitBranch, Eye, Lock,
  MessageSquare, BookOpen, Sparkles, Database, Server,
} from "lucide-react";

// ── Agent pipeline data ────────────────────────────────────────────────────────
const AGENTS = [
  {
    name: "R&D Team", abbr: "🔬", color: "text-cyan-400", bg: "bg-cyan-400/10 border-cyan-400/30",
    desc: "Deep web research & knowledge gathering",
    subAgents: [
      { name: "ResearchPlanner", abbr: "RP", desc: "Breaks topic into subtopics & search queries" },
      { name: "DataTaker", abbr: "DT", desc: "Searches web & scrapes URLs for raw data" },
      { name: "ResearchOrganiser", abbr: "RO", desc: "Synthesizes data into final research report" },
    ],
  },
  { name: "Analyser", abbr: "A", color: "text-blue-400", bg: "bg-blue-400/10 border-blue-400/30", desc: "Architecture planning & tech analysis", subAgents: [] },
  { name: "Planner", abbr: "P", color: "text-violet-400", bg: "bg-violet-400/10 border-violet-400/30", desc: "Task decomposition into 12-20 atomic steps", subAgents: [] },
  { name: "Coder", abbr: "C", color: "text-emerald-400", bg: "bg-emerald-400/10 border-emerald-400/30", desc: "Full production-ready implementation", subAgents: [] },
  { name: "Optimiser", abbr: "O", color: "text-amber-400", bg: "bg-amber-400/10 border-amber-400/30", desc: "Performance, security & bundle optimization", subAgents: [] },
  { name: "Organizer", abbr: "📝", color: "text-orange-400", bg: "bg-orange-400/10 border-orange-400/30", desc: "Human-readable docs & README generation", subAgents: [] },
  { name: "Tester", abbr: "T", color: "text-green-400", bg: "bg-green-400/10 border-green-400/30", desc: "Automated test suite execution & reporting", subAgents: [] },
  {
    name: "Red Team", abbr: "🔴", color: "text-red-400", bg: "bg-red-400/10 border-red-400/30",
    desc: "5-agent security audit pipeline",
    subAgents: [
      { name: "VulnerabilitySpotter", abbr: "VS", desc: "Static code vulnerability scanning" },
      { name: "DataCorruptor", abbr: "DC", desc: "Adversarial data integrity testing" },
      { name: "ZeroDayExploiter", abbr: "ZD", desc: "Logic flaw & boundary analysis" },
      { name: "FrameworkAuditor", abbr: "FA", desc: "Tech stack security audit" },
      { name: "RedTeamOrchestrator", abbr: "RTO", desc: "Consolidates all findings" },
    ],
  },
  { name: "Critic", abbr: "Q", color: "text-purple-400", bg: "bg-purple-400/10 border-purple-400/30", desc: "Final quality gate & completeness review", subAgents: [] },
];

const MODES_INFO = [
  {
    id: "chat", label: "CHAT", icon: MessageSquare, color: "text-primary", bg: "bg-primary/10 border-primary/30",
    desc: "General AI conversation with Claude Haiku 4.5. Fast, accurate, context-aware.",
    features: ["Claude Haiku 4.5 via Bedrock", "Persistent session history", "URL-based session routing"],
  },
  {
    id: "research", label: "RESEARCH", icon: Search, color: "text-accent", bg: "bg-accent/10 border-accent/30",
    desc: "Deep research mode with live web scraping and multi-source synthesis.",
    features: ["Live web search & scraping", "Multi-source synthesis", "Gemini 3.1 Flash-Lite"],
  },
  {
    id: "study", label: "STUDY", icon: BookOpen, color: "text-indigo-400", bg: "bg-indigo-400/10 border-indigo-400/30",
    desc: "Study assistant with resource grounding. Upload files, add notes, get accurate answers.",
    features: ["Live web search per query", "File & image upload (Claude Vision)", "Resource-grounded responses"],
  },
  {
    id: "code", label: "CODE", icon: Users, color: "text-violet-400", bg: "bg-violet-400/10 border-violet-400/30",
    desc: "9-agent multi-agent system. From research to deployment in one prompt.",
    features: ["9 specialized agents", "Daytona cloud sandbox", "Red Team security audit"],
  },
];

const MODELS = [
  { name: "Claude Haiku 4.5", tier: "FAST", color: "text-cyan-400", border: "border-cyan-400/30", bg: "bg-cyan-400/5", desc: "Chat & Study mode. $1.80/$7.20 per M tokens.", badge: "Bedrock" },
  { name: "Claude Sonnet 4.6", tier: "SMART", color: "text-violet-400", border: "border-violet-400/30", bg: "bg-violet-400/5", desc: "Coder & complex tasks. $5.40/$26.50 per M tokens.", badge: "Bedrock" },
  { name: "Claude Opus 4.6", tier: "POWER", color: "text-amber-400", border: "border-amber-400/30", bg: "bg-amber-400/5", desc: "Hard tasks & security audit. $7.44/$42.00 per M tokens.", badge: "Bedrock" },
  { name: "Claude Opus 4.7", tier: "APEX", color: "text-red-400", border: "border-red-400/30", bg: "bg-red-400/5", desc: "Extreme difficulty tasks. $12.00/$60.00 per M tokens.", badge: "Bedrock" },
  { name: "Gemini 3.1 Flash-Lite", tier: "FREE", color: "text-emerald-400", border: "border-emerald-400/30", bg: "bg-emerald-400/5", desc: "Research, planning & fallback. Free tier.", badge: "Google" },
];

// ── Particle background ────────────────────────────────────────────────────────
function ParticleField() {
  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none">
      {Array.from({ length: 20 }).map((_, i) => (
        <motion.div
          key={i}
          className="absolute rounded-full bg-primary/20"
          style={{
            width: i % 3 === 0 ? 2 : 1,
            height: i % 3 === 0 ? 2 : 1,
            left: `${(i * 5.1) % 100}%`,
            top: `${(i * 7.3) % 100}%`,
          }}
          animate={{ y: [0, -30, 0], opacity: [0, 0.6, 0], scale: [0, 1.5, 0] }}
          transition={{ duration: 5 + (i % 4), delay: i * 0.3, repeat: Infinity, repeatDelay: i * 0.1 }}
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
        <span className="text-[11px] text-muted-foreground ml-2 font-mono">aether — code session</span>
        <div className="ml-auto flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
          <span className="text-[10px] text-emerald-400 font-mono">RUNNING</span>
        </div>
      </div>
      <div className="p-3 space-y-1">
        {AGENTS.map((agent, i) => {
          const isDone = i < activeIdx;
          const isActive = i === activeIdx;
          return (
            <div key={agent.name}>
              <motion.div
                animate={isActive ? { scale: [1, 1.01, 1] } : {}}
                transition={{ duration: 0.8, repeat: isActive ? Infinity : 0 }}
                className={`flex items-center gap-3 px-3 py-2 rounded-lg border transition-all ${
                  isActive ? `${agent.bg} shadow-sm` : isDone ? "border-border/30 bg-muted/20 opacity-50" : "border-border/20 bg-transparent opacity-30"
                }`}
              >
                <div className={`w-5 h-5 rounded border flex items-center justify-center text-[9px] font-bold shrink-0 ${agent.bg} ${agent.color}`}>
                  {isDone ? "✓" : agent.abbr}
                </div>
                <span className={`text-[11px] font-bold font-mono ${isActive ? agent.color : isDone ? "text-muted-foreground" : "text-muted-foreground/40"}`}>
                  {agent.name}
                </span>
                {agent.subAgents.length > 0 && (
                  <span className={`text-[9px] font-mono ml-1 ${isActive ? agent.color + "/70" : "text-muted-foreground/30"}`}>
                    ({agent.subAgents.length} sub-agents)
                  </span>
                )}
                <span className={`text-[10px] ml-auto font-mono ${isActive ? "text-emerald-400 animate-pulse" : isDone ? "text-muted-foreground/50" : "text-muted-foreground/20"}`}>
                  {isActive ? "RUNNING..." : isDone ? "✓ DONE" : "QUEUED"}
                </span>
              </motion.div>
              {isActive && agent.subAgents.length > 0 && (
                <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} className="ml-8 mt-1 space-y-0.5">
                  {agent.subAgents.map((sub) => (
                    <div key={sub.name} className={`flex items-center gap-2 px-2 py-1 rounded border border-dashed ${agent.bg} opacity-80`}>
                      <span className={`text-[9px] font-bold font-mono ${agent.color}`}>{sub.abbr}</span>
                      <span className={`text-[9px] font-mono ${agent.color}/80`}>{sub.name}</span>
                    </div>
                  ))}
                </motion.div>
              )}
            </div>
          );
        })}
      </div>
      <div className="px-4 py-2.5 border-t border-border bg-card/50 flex items-center justify-between">
        <span className="text-[10px] text-muted-foreground font-mono">Task 4/14 • TASKS PHASE</span>
        <span className="text-[10px] text-primary font-mono">claude-sonnet-4-6 • Bedrock</span>
      </div>
    </div>
  );
}

// ── Main Landing ───────────────────────────────────────────────────────────────
export default function Landing() {
  const navigate = useNavigate();
  const { isAuthenticated, isLoading } = useAuth();
  const [activeModeTab, setActiveModeTab] = useState(0);

  const handleLaunch = () => navigate(isAuthenticated ? "/portal/chat" : "/auth");

  return (
    <div className="min-h-screen bg-background font-mono overflow-x-hidden">
      {/* ── Nav ─────────────────────────────────────────────────────────────── */}
      <nav className="fixed top-0 left-0 right-0 z-50 border-b border-border bg-background/90 backdrop-blur-md">
        <div className="max-w-7xl mx-auto px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-7 h-7 rounded-lg bg-primary/20 border border-primary/40 flex items-center justify-center">
              <Cpu className="h-3.5 w-3.5 text-primary" />
            </div>
            <span className="text-primary font-bold text-sm tracking-widest amd-glow">THALAMUS_AI</span>
            <span className="hidden sm:block text-[10px] text-muted-foreground border border-border px-2 py-0.5 rounded-full">
              L4.5 Agent · by Aphantic
            </span>
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden md:flex items-center gap-1.5 text-[10px] text-muted-foreground">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              LIVE
            </span>
            <button onClick={handleLaunch}
              className="flex items-center gap-1.5 text-xs border border-primary text-primary px-4 py-1.5 rounded-lg hover:bg-primary hover:text-primary-foreground transition-all font-bold">
              {isLoading ? "..." : isAuthenticated ? "OPEN PORTAL" : "GET STARTED"}
              <ChevronRight className="h-3 w-3" />
            </button>
          </div>
        </div>
      </nav>

      {/* ── Hero ────────────────────────────────────────────────────────────── */}
      <section className="relative min-h-screen flex items-center pt-14 overflow-hidden">
        <ParticleField />
        <div className="absolute inset-0 opacity-[0.02]" style={{
          backgroundImage: "linear-gradient(oklch(0.60 0.22 25) 1px, transparent 1px), linear-gradient(90deg, oklch(0.60 0.22 25) 1px, transparent 1px)",
          backgroundSize: "60px 60px",
        }} />
        <div className="absolute top-1/4 right-1/4 w-96 h-96 rounded-full bg-primary/3 blur-3xl pointer-events-none" />
        <div className="absolute bottom-1/4 left-1/4 w-64 h-64 rounded-full bg-violet-500/3 blur-3xl pointer-events-none" />

        <div className="relative max-w-7xl mx-auto px-6 py-24 grid lg:grid-cols-2 gap-16 items-center">
          <motion.div initial={{ opacity: 0, x: -30 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.7 }}>
            {/* Brand badge */}
            <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}
              className="inline-flex items-center gap-2 border border-primary/30 bg-primary/8 text-primary text-[10px] font-bold px-3 py-1.5 rounded-full mb-6">
              <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
              WORLD'S FIRST L4.5 AGENT SYSTEM
            </motion.div>

            <h1 className="text-5xl md:text-6xl font-bold leading-[1.1] mb-5">
              <span className="text-foreground">Thalamus</span>
              <br />
              <span className="text-primary amd-glow">AI Portal</span>
              <br />
              <span className="text-muted-foreground text-3xl md:text-4xl">by Aphantic</span>
            </h1>

            <p className="text-muted-foreground text-sm leading-relaxed mb-3 max-w-lg">
              Four modes. One platform. <span className="text-foreground font-semibold">Chat, Research, Study, and Code</span> — each powered by the right model for the job. Claude Haiku, Sonnet, Opus 4.6/4.7 via AWS Bedrock.
            </p>

            <p className="text-muted-foreground text-xs leading-relaxed mb-8 max-w-lg">
              Code mode orchestrates <span className="text-primary font-bold">9 specialized agents</span> — R&D Team, Analyser, Planner, Coder, Optimiser, Organizer, Tester, Red Team, and Critic — to build complete, production-ready software from a single prompt.
            </p>

            <div className="flex flex-col sm:flex-row gap-3 mb-10">
              <motion.button onClick={handleLaunch} whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
                className="flex items-center justify-center gap-2 px-7 py-3.5 bg-primary text-primary-foreground text-sm font-bold rounded-xl hover:bg-primary/90 transition-all shadow-lg shadow-primary/20">
                <Terminal className="h-4 w-4" />
                LAUNCH PORTAL
                <ChevronRight className="h-4 w-4" />
              </motion.button>
              <motion.button onClick={() => document.getElementById('modes')?.scrollIntoView({ behavior: 'smooth' })}
                whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
                className="flex items-center justify-center gap-2 px-7 py-3.5 border border-border text-muted-foreground text-sm font-bold rounded-xl hover:border-primary/40 hover:text-foreground transition-all">
                EXPLORE MODES
                <ArrowRight className="h-4 w-4" />
              </motion.button>
            </div>

            {/* Key metrics */}
            <div className="flex items-center gap-6 text-xs flex-wrap">
              {[
                { val: "4", label: "AI Modes", color: "text-primary" },
                { val: "9", label: "Code Agents", color: "text-violet-400" },
                { val: "5", label: "Claude Models", color: "text-cyan-400" },
                { val: "AB", label: "Economy", color: "text-amber-400" },
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

      {/* ── Modes ───────────────────────────────────────────────────────────── */}
      <section id="modes" className="border-t border-border py-20">
        <div className="max-w-7xl mx-auto px-6">
          <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} className="mb-10">
            <p className="text-xs text-muted-foreground mb-2 font-bold tracking-widest">FOUR MODES</p>
            <h2 className="text-3xl font-bold text-foreground">
              The right tool for <span className="text-primary">every task.</span>
            </h2>
          </motion.div>

          {/* Mode tabs */}
          <div className="flex gap-2 mb-6 flex-wrap">
            {MODES_INFO.map((mode, i) => (
              <button key={mode.id} onClick={() => setActiveModeTab(i)}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold border transition-all ${activeModeTab === i ? `${mode.bg} ${mode.color} border-current/30` : "border-border text-muted-foreground hover:text-foreground hover:border-border/80"}`}
              >
                <mode.icon className="h-3.5 w-3.5" />
                {mode.label}
              </button>
            ))}
          </div>

          <AnimatedModeCard mode={MODES_INFO[activeModeTab]} />
        </div>
      </section>

      {/* ── How it works ────────────────────────────────────────────────────── */}
      <section className="border-t border-border py-20">
        <div className="max-w-7xl mx-auto px-6">
          <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} className="mb-12">
            <p className="text-xs text-muted-foreground mb-2 font-bold tracking-widest">CODE MODE</p>
            <h2 className="text-3xl font-bold text-foreground">
              One prompt. <span className="text-primary">Nine agents.</span> Complete software.
            </h2>
          </motion.div>

          <div className="grid md:grid-cols-3 gap-4 mb-12">
            {[
              { step: "01", title: "Describe your project", desc: "Type what you want to build. Thalamus AI handles everything from research to deployment.", icon: Terminal },
              { step: "02", title: "Agents plan & execute", desc: "The Planner breaks it into 12-20 atomic tasks. Each agent runs its specialized role in sequence.", icon: Layers },
              { step: "03", title: "Production-ready output", desc: "Complete codebase, tests, docs, security audit — deployed to a live cloud sandbox.", icon: Rocket },
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
                {agent.subAgents.length > 0 && (
                  <div className={`text-[8px] ${agent.color}/60 mt-0.5`}>{agent.subAgents.length} sub</div>
                )}
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Models ──────────────────────────────────────────────────────────── */}
      <section className="border-t border-border py-20">
        <div className="max-w-7xl mx-auto px-6">
          <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} className="mb-10">
            <p className="text-xs text-muted-foreground mb-2 font-bold tracking-widest">AI MODELS</p>
            <h2 className="text-3xl font-bold text-foreground">
              Right model, <span className="text-primary">right task.</span>
            </h2>
            <p className="text-sm text-muted-foreground mt-2 max-w-xl">
              Thalamus automatically routes each agent to the optimal model based on task difficulty. You pay only for what you use via AgentBucks.
            </p>
          </motion.div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3">
            {MODELS.map((model, i) => (
              <motion.div key={model.name} initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: i * 0.08 }}
                className={`border ${model.border} ${model.bg} rounded-xl p-4 hover:scale-[1.02] transition-all`}>
                <div className="flex items-center justify-between mb-3">
                  <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full border ${model.border} ${model.color}`}>{model.tier}</span>
                  <span className="text-[8px] text-muted-foreground border border-border px-1.5 py-0.5 rounded">{model.badge}</span>
                </div>
                <p className={`text-xs font-bold ${model.color} mb-1`}>{model.name}</p>
                <p className="text-[10px] text-muted-foreground leading-relaxed">{model.desc}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ── AgentBucks Economy ──────────────────────────────────────────────── */}
      <section className="border-t border-border py-20">
        <div className="max-w-7xl mx-auto px-6">
          <div className="grid lg:grid-cols-2 gap-12 items-center">
            <motion.div initial={{ opacity: 0, x: -20 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true }}>
              <p className="text-xs text-muted-foreground mb-2 font-bold tracking-widest">AGENTBUCKS ECONOMY</p>
              <h2 className="text-3xl font-bold text-foreground mb-4">
                Pay per token, <span className="text-amber-400">not per seat.</span>
              </h2>
              <p className="text-sm text-muted-foreground leading-relaxed mb-6">
                AgentBucks (AB) is the internal currency of Thalamus AI. Every model call deducts AB proportional to actual token usage. Daily free allocation + purchasable credits.
              </p>
              <div className="space-y-3">
                {[
                  { label: "Daily free allocation", val: "Refreshes every 24h", color: "text-emerald-400" },
                  { label: "Gemini calls", val: "~900 AB / M input tokens", color: "text-emerald-400" },
                  { label: "Haiku 4.5 calls", val: "~2,700 AB / M input tokens", color: "text-cyan-400" },
                  { label: "Sonnet 4.6 calls", val: "~8,100 AB / M input tokens", color: "text-violet-400" },
                  { label: "Opus 4.7 calls", val: "~18,000 AB / M input tokens", color: "text-red-400" },
                ].map((item, i) => (
                  <div key={i} className="flex items-center justify-between border border-border rounded-lg px-3 py-2">
                    <span className="text-[11px] text-muted-foreground">{item.label}</span>
                    <span className={`text-[11px] font-bold ${item.color}`}>{item.val}</span>
                  </div>
                ))}
              </div>
            </motion.div>
            <motion.div initial={{ opacity: 0, x: 20 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true }}>
              <div className="border border-border bg-card rounded-2xl p-6">
                <div className="flex items-center gap-3 mb-6">
                  <div className="w-10 h-10 rounded-xl bg-amber-400/10 border border-amber-400/30 flex items-center justify-center">
                    <Zap className="h-5 w-5 text-amber-400" />
                  </div>
                  <div>
                    <p className="text-sm font-bold text-foreground">AgentBucks Balance</p>
                    <p className="text-[10px] text-muted-foreground">Your AI compute currency</p>
                  </div>
                </div>
                <div className="text-4xl font-bold text-amber-400 mb-1">306,973,492</div>
                <p className="text-[10px] text-muted-foreground mb-6">Example balance</p>
                <div className="space-y-2">
                  <div className="flex justify-between text-[11px]">
                    <span className="text-muted-foreground">Daily allocation</span>
                    <span className="text-emerald-400 font-bold">+50,000 AB/day</span>
                  </div>
                  <div className="flex justify-between text-[11px]">
                    <span className="text-muted-foreground">Purchased credits</span>
                    <span className="text-amber-400 font-bold">Persistent</span>
                  </div>
                  <div className="flex justify-between text-[11px]">
                    <span className="text-muted-foreground">Referral bonus</span>
                    <span className="text-primary font-bold">Free spins</span>
                  </div>
                </div>
              </div>
            </motion.div>
          </div>
        </div>
      </section>

      {/* ── Tech Stack ──────────────────────────────────────────────────────── */}
      <section className="border-t border-border py-20">
        <div className="max-w-7xl mx-auto px-6">
          <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} className="mb-10">
            <p className="text-xs text-muted-foreground mb-2 font-bold tracking-widest">INFRASTRUCTURE</p>
            <h2 className="text-3xl font-bold text-foreground">
              Built on <span className="text-primary">production-grade</span> infrastructure.
            </h2>
          </motion.div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              { icon: Brain, title: "AWS Bedrock", sub: "Claude 4.5/4.6/4.7", desc: "SigV4-signed REST API. Haiku, Sonnet, Opus models. Automatic fallback to Gemini.", color: "text-primary", border: "border-primary/20 hover:border-primary/50" },
              { icon: Activity, title: "Convex Real-Time", sub: "Reactive database", desc: "Every agent output streams live. No polling — pure reactive subscriptions.", color: "text-cyan-400", border: "border-cyan-400/20 hover:border-cyan-400/50" },
              { icon: Globe, title: "Daytona Sandbox", sub: "Live code execution", desc: "Every project deploys to a real cloud sandbox. Commands run, tests execute, previews go live.", color: "text-emerald-400", border: "border-emerald-400/20 hover:border-emerald-400/50" },
              { icon: Database, title: "GraphRAG + ChromaDB", sub: "Per-session grounding", desc: "Knowledge base grounding for every session. Agents retrieve relevant context before acting.", color: "text-violet-400", border: "border-violet-400/20 hover:border-violet-400/50" },
            ].map((item, i) => (
              <motion.div key={i} initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: i * 0.1 }}
                className={`border ${item.border} bg-card rounded-xl p-5 transition-all`}>
                <item.icon className={`h-5 w-5 ${item.color} mb-3`} />
                <p className={`text-sm font-bold ${item.color} mb-0.5`}>{item.title}</p>
                <p className="text-[10px] text-muted-foreground mb-2">{item.sub}</p>
                <p className="text-[11px] text-muted-foreground leading-relaxed">{item.desc}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA ─────────────────────────────────────────────────────────────── */}
      <section className="border-t border-border py-24">
        <div className="max-w-3xl mx-auto px-6 text-center">
          <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }}>
            <div className="inline-flex items-center gap-2 border border-primary/30 bg-primary/8 text-primary text-[10px] font-bold px-3 py-1.5 rounded-full mb-6">
              <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
              THALAMUS AI — L4.5 AGENT SYSTEM
            </div>
            <h2 className="text-4xl font-bold text-foreground mb-4">
              Ready to build with <span className="text-primary amd-glow">9 agents?</span>
            </h2>
            <p className="text-sm text-muted-foreground mb-8 max-w-lg mx-auto">
              Chat, research, study, or deploy full software — all from one portal. Free daily allocation. No credit card required.
            </p>
            <motion.button onClick={handleLaunch} whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
              className="inline-flex items-center gap-2 px-8 py-4 bg-primary text-primary-foreground text-sm font-bold rounded-xl hover:bg-primary/90 transition-all shadow-lg shadow-primary/20">
              <Terminal className="h-4 w-4" />
              LAUNCH THALAMUS PORTAL
              <ChevronRight className="h-4 w-4" />
            </motion.button>
          </motion.div>
        </div>
      </section>

      {/* ── Footer ──────────────────────────────────────────────────────────── */}
      <footer className="border-t border-border py-8">
        <div className="max-w-7xl mx-auto px-6 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-6 h-6 rounded bg-primary/20 border border-primary/40 flex items-center justify-center">
              <Cpu className="h-3 w-3 text-primary" />
            </div>
            <span className="text-primary font-bold text-xs tracking-widest">THALAMUS_AI</span>
            <span className="text-[10px] text-muted-foreground">by Aphantic Corporations</span>
          </div>
          <div className="flex items-center gap-4 text-[10px] text-muted-foreground">
            <span>L4.5 Agent System</span>
            <span>·</span>
            <span>AWS Bedrock</span>
            <span>·</span>
            <span>Convex</span>
            <span>·</span>
            <span>Daytona</span>
          </div>
        </div>
      </footer>
    </div>
  );
}

// ── Animated Mode Card ─────────────────────────────────────────────────────────
function AnimatedModeCard({ mode }: { mode: typeof MODES_INFO[0] }) {
  return (
    <motion.div key={mode.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}
      className={`border ${mode.bg} rounded-2xl p-6 grid md:grid-cols-2 gap-6`}>
      <div>
        <div className="flex items-center gap-3 mb-4">
          <div className={`w-10 h-10 rounded-xl ${mode.bg} border flex items-center justify-center`}>
            <mode.icon className={`h-5 w-5 ${mode.color}`} />
          </div>
          <div>
            <p className={`text-sm font-bold ${mode.color}`}>{mode.label} MODE</p>
            <p className="text-[10px] text-muted-foreground">Portal route: /portal/{mode.id}</p>
          </div>
        </div>
        <p className="text-sm text-foreground leading-relaxed mb-4">{mode.desc}</p>
        <div className="space-y-2">
          {mode.features.map((f, i) => (
            <div key={i} className="flex items-center gap-2">
              <CheckCircle className={`h-3.5 w-3.5 ${mode.color} shrink-0`} />
              <span className="text-[11px] text-muted-foreground">{f}</span>
            </div>
          ))}
        </div>
      </div>
      <div className={`border ${mode.bg} rounded-xl p-4 flex flex-col justify-center`}>
        <div className="space-y-2">
          {mode.id === "chat" && (
            <>
              <div className="flex justify-end"><div className="bg-primary text-primary-foreground rounded-xl px-3 py-2 text-[11px] max-w-[80%]">What is quantum entanglement?</div></div>
              <div className="flex justify-start"><div className="bg-card border border-border rounded-xl px-3 py-2 text-[11px] max-w-[80%] text-muted-foreground">Quantum entanglement is a phenomenon where two particles become correlated...</div></div>
            </>
          )}
          {mode.id === "research" && (
            <>
              <div className="flex justify-end"><div className="bg-primary text-primary-foreground rounded-xl px-3 py-2 text-[11px] max-w-[80%]">Research: Latest AI breakthroughs 2026</div></div>
              <div className="flex items-center gap-2 text-[10px] text-muted-foreground"><Globe className="h-3 w-3 text-accent" />Scraping 3 sources...</div>
              <div className="flex justify-start"><div className="bg-card border border-border rounded-xl px-3 py-2 text-[11px] max-w-[80%] text-muted-foreground">Based on live web data: Claude Opus 4.7 released April 2026...</div></div>
            </>
          )}
          {mode.id === "study" && (
            <>
              <div className="flex items-center gap-2 text-[10px] text-indigo-400 border border-indigo-400/20 bg-indigo-400/5 rounded-lg px-2 py-1.5"><BookOpen className="h-3 w-3" />3 resources loaded</div>
              <div className="flex justify-end"><div className="bg-primary text-primary-foreground rounded-xl px-3 py-2 text-[11px] max-w-[80%]">Explain NCERT Class 9 Science Chapter 1</div></div>
              <div className="flex items-center gap-2 text-[10px] text-muted-foreground"><Search className="h-3 w-3 text-indigo-400" />Live searching...</div>
            </>
          )}
          {mode.id === "code" && (
            <>
              <div className="text-[10px] text-muted-foreground border border-border rounded-lg px-3 py-2">Task: Build a REST API with auth</div>
              <div className="space-y-1">
                {["R&D Team ✓", "Analyser ✓", "Planner → 14 tasks", "Coder RUNNING..."].map((s, i) => (
                  <div key={i} className={`text-[10px] font-mono ${i === 3 ? "text-emerald-400 animate-pulse" : "text-muted-foreground/60"}`}>{s}</div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </motion.div>
  );
}