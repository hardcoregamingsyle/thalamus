import { motion } from "framer-motion";
import { useNavigate } from "react-router";
import { useAuth } from "@/hooks/use-auth";
import { useState, useEffect } from "react";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { toast } from "sonner";
import { useRef } from "react";
import {
  Cpu, Zap, Brain, Code2, Shield, ChevronRight,
  Users, Rocket, Globe, Terminal, Activity, Search, FileCode,
  CheckCircle, ArrowRight, Layers, GitBranch, Eye, Lock,
  MessageSquare, BookOpen, Sparkles, Database, Server,
  Lightbulb, X, Upload, FileText, Send, Loader2, Sun, Moon,
} from "lucide-react";
import { useTheme } from "@/hooks/use-theme";

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
  { name: "Claude Opus 4.7", tier: "APEX", color: "text-primary", border: "border-primary/30", bg: "bg-primary/5", desc: "Extreme difficulty tasks. $12.00/$60.00 per M tokens.", badge: "Bedrock" },
  { name: "Gemini 3.1 Flash-Lite", tier: "FREE", color: "text-emerald-400", border: "border-emerald-400/30", bg: "bg-emerald-400/5", desc: "Research, planning & fallback. Free tier.", badge: "Google" },
];

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
        <div className="w-2 h-2 rounded-full bg-destructive/70" />
        <div className="w-2 h-2 rounded-full bg-accent/70" />
        <div className="w-2 h-2 rounded-full bg-emerald-500/70" />
        <span className="text-[11px] text-muted-foreground ml-2 font-mono">thalamus — code session</span>
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
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Suggestion Form Modal ─────────────────────────────────────────────────────
interface SuggestionFile { name: string; content: string; size: number; }
function SuggestionModal({ onClose, onSubmit, isSubmitting }: { onClose: () => void; onSubmit: (t: string, d: string, f: SuggestionFile[]) => Promise<void>; isSubmitting: boolean }) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [files, setFiles] = useState<SuggestionFile[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const handleFileAdd = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(e.target.files ?? []);
    for (const file of selected) {
      const text = await file.text().catch(() => `[Binary: ${file.name}]`);
      setFiles(prev => [...prev, { name: file.name, content: text.slice(0, 50000), size: file.size }]);
    }
    if (fileRef.current) fileRef.current.value = "";
  };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-background/80 backdrop-blur-sm" onClick={onClose} />
      <motion.div initial={{ opacity: 0, scale: 0.95, y: 10 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95 }}
        className="relative z-10 bg-card border border-border rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-accent/20 border border-accent/30 flex items-center justify-center">
              <Lightbulb className="h-3.5 w-3.5 text-accent" />
            </div>
            <div>
              <p className="text-xs font-bold text-foreground">SUBMIT FEEDBACK</p>
              <p className="text-[9px] text-muted-foreground">Help us build better</p>
            </div>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors p-1"><X className="h-4 w-4" /></button>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <label className="text-[10px] font-bold text-muted-foreground block mb-1.5">TITLE <span className="text-destructive">*</span></label>
            <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Brief title..." className="w-full bg-background border border-border rounded-lg px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/60 transition-colors" />
          </div>
          <div>
            <label className="text-[10px] font-bold text-muted-foreground block mb-1.5">DESCRIPTION <span className="text-destructive">*</span></label>
            <textarea value={description} onChange={e => setDescription(e.target.value)} placeholder="Describe your suggestion or bug report..." rows={4} className="w-full bg-background border border-border rounded-lg px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/60 transition-colors resize-none" />
          </div>
          <div>
            <label className="text-[10px] font-bold text-muted-foreground block mb-1.5">ATTACHMENTS (optional)</label>
            <input ref={fileRef} type="file" multiple onChange={handleFileAdd} className="hidden" />
            <button onClick={() => fileRef.current?.click()} className="w-full py-2 border border-dashed border-border rounded-lg text-[10px] text-muted-foreground hover:border-primary/40 hover:text-primary transition-all flex items-center justify-center gap-2">
              <Upload className="h-3 w-3" />Attach files
            </button>
            {files.length > 0 && (
              <div className="mt-2 space-y-1">
                {files.map((f, i) => (
                  <div key={i} className="flex items-center justify-between px-2 py-1.5 bg-background border border-border rounded-lg">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <FileText className="h-3 w-3 text-muted-foreground shrink-0" />
                      <span className="text-[10px] text-foreground truncate">{f.name}</span>
                    </div>
                    <button onClick={() => setFiles(prev => prev.filter((_, j) => j !== i))} className="text-muted-foreground hover:text-destructive transition-colors shrink-0 ml-2"><X className="h-3 w-3" /></button>
                  </div>
                ))}
              </div>
            )}
          </div>
          <button onClick={async () => { if (!title.trim() || !description.trim()) { toast.error("Fill in title and description"); return; } await onSubmit(title.trim(), description.trim(), files); }}
            disabled={isSubmitting || !title.trim() || !description.trim()}
            className="w-full py-2.5 bg-primary/15 border border-primary/30 text-primary text-xs rounded-xl hover:bg-primary/25 disabled:opacity-50 transition-all font-bold flex items-center justify-center gap-2">
            {isSubmitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
            {isSubmitting ? "Submitting..." : "Submit Feedback"}
          </button>
        </div>
      </motion.div>
    </div>
  );
}

// ── Main Landing ───────────────────────────────────────────────────────────────
export default function Landing() {
  const navigate = useNavigate();
  const { isAuthenticated, isLoading } = useAuth();
  const [activeModeTab, setActiveModeTab] = useState(0);
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const [isSuggestionSubmitting, setIsSuggestionSubmitting] = useState(false);
  const submitSuggestionMutation = useMutation(api.admin.submitSuggestion);

  const { theme, toggleTheme } = useTheme();
  const handleLaunch = () => navigate("/portal/chat");

  return (
    <div className="min-h-screen bg-background font-sans overflow-x-hidden">
      {/* ── Nav ─────────────────────────────────────────────────────────────── */}
      <nav className="fixed top-0 left-0 right-0 z-50 border-b border-border/60 bg-background/95 backdrop-blur-xl">
        <div className="max-w-7xl mx-auto px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-7 h-7 rounded-lg bg-primary/15 border border-primary/30 flex items-center justify-center">
              <Cpu className="h-3.5 w-3.5 text-primary" />
            </div>
            <span className="text-primary font-bold text-sm tracking-widest">THALAMUS_AI</span>
            <span className="hidden sm:block text-[10px] text-muted-foreground border border-border/60 px-2 py-0.5 rounded-full">
              L4.5 Agent · by Aphantic
            </span>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setSuggestionsOpen(true)}
              className="hidden sm:flex items-center gap-1.5 text-[11px] border border-border/60 text-muted-foreground px-3 py-1.5 rounded-lg hover:border-accent/40 hover:text-accent transition-all font-medium"
            >
              <Lightbulb className="h-3 w-3" />
              Feedback
            </button>
            <button onClick={toggleTheme} className="p-2 rounded-lg border border-border/60 text-muted-foreground hover:text-foreground hover:border-border transition-all" title="Toggle theme">
              {theme === "dark" ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
            </button>
            <span className="hidden md:flex items-center gap-1.5 text-[10px] text-muted-foreground">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              LIVE
            </span>
            <button onClick={handleLaunch}
              className="flex items-center gap-1.5 text-xs bg-primary text-primary-foreground px-4 py-1.5 rounded-lg hover:bg-primary/90 transition-all font-semibold shadow-sm shadow-primary/20">
              {isLoading ? "..." : isAuthenticated ? "Open Portal" : "Try Free — No Sign Up"}
              <ChevronRight className="h-3 w-3" />
            </button>
          </div>
        </div>
      </nav>

      {/* ── Hero ────────────────────────────────────────────────────────────── */}
      <section className="pt-32 pb-20 px-6 relative overflow-hidden">
        {/* Subtle background glow */}
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-[600px] h-[400px] rounded-full bg-primary/5 blur-[120px]" />
          <div className="absolute top-1/3 left-1/4 w-[300px] h-[300px] rounded-full bg-accent/4 blur-[100px]" />
        </div>

        <div className="max-w-7xl mx-auto relative">
          <div className="grid lg:grid-cols-2 gap-16 items-center">
            <motion.div initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6 }}>
              <div className="inline-flex items-center gap-2 border border-primary/25 bg-primary/8 text-primary text-[11px] font-semibold px-3 py-1.5 rounded-full mb-6">
                <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
                World's First L4.5 Agent System
              </div>
              <h1 className="text-5xl lg:text-6xl font-bold text-foreground leading-[1.1] tracking-tight mb-6">
                The AI that
                <br />
                <span className="text-primary">builds software</span>
                <br />
                end-to-end.
              </h1>
              <p className="text-base text-muted-foreground leading-relaxed mb-8 max-w-lg">
                9 specialized agents — from research to deployment. One prompt. Production-ready code, security audited, fully tested.
              </p>
              <div className="flex flex-wrap gap-3">
                <motion.button onClick={handleLaunch} whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
                  className="flex items-center gap-2 px-6 py-3 bg-primary text-primary-foreground text-sm font-semibold rounded-xl hover:bg-primary/90 transition-all shadow-lg shadow-primary/20">
                  Launch Portal
                  <ArrowRight className="h-4 w-4" />
                </motion.button>
                <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
                  onClick={() => document.getElementById("how-it-works")?.scrollIntoView({ behavior: "smooth" })}
                  className="flex items-center gap-2 px-6 py-3 border border-border text-foreground text-sm font-medium rounded-xl hover:border-primary/40 hover:bg-primary/5 transition-all">
                  See how it works
                </motion.button>
              </div>

              {/* Stats */}
              <div className="flex flex-wrap gap-6 mt-10 pt-8 border-t border-border/50">
                {[
                  { value: "9", label: "Specialized Agents" },
                  { value: "4", label: "Claude Models" },
                  { value: "L4.5", label: "Agent Level" },
                ].map((stat) => (
                  <div key={stat.label}>
                    <p className="text-2xl font-bold text-foreground">{stat.value}</p>
                    <p className="text-[11px] text-muted-foreground mt-0.5">{stat.label}</p>
                  </div>
                ))}
              </div>
            </motion.div>

            <motion.div initial={{ opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.6, delay: 0.15 }}>
              <LivePipeline />
            </motion.div>
          </div>
        </div>
      </section>

      {/* ── Modes ───────────────────────────────────────────────────────────── */}
      <section className="py-20 px-6 border-t border-border/50">
        <div className="max-w-7xl mx-auto">
          <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} className="text-center mb-12">
            <p className="text-[11px] font-semibold text-primary tracking-widest mb-3">FOUR MODES</p>
            <h2 className="text-3xl font-bold text-foreground">One portal. Every capability.</h2>
          </motion.div>

          {/* Mode tabs */}
          <div className="flex flex-wrap gap-2 justify-center mb-8">
            {MODES_INFO.map((mode, i) => (
              <button key={mode.id} onClick={() => setActiveModeTab(i)}
                className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold border transition-all ${
                  activeModeTab === i ? `${mode.bg} ${mode.color} border-current/30` : "border-border text-muted-foreground hover:border-border/80 hover:text-foreground"
                }`}>
                <mode.icon className="h-3.5 w-3.5" />
                {mode.label}
              </button>
            ))}
          </div>

          <AnimatedModeCard mode={MODES_INFO[activeModeTab]} />
        </div>
      </section>

      {/* ── How it works ────────────────────────────────────────────────────── */}
      <section id="how-it-works" className="py-20 px-6 border-t border-border/50">
        <div className="max-w-7xl mx-auto">
          <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} className="text-center mb-12">
            <p className="text-[11px] font-semibold text-primary tracking-widest mb-3">HOW IT WORKS</p>
            <h2 className="text-3xl font-bold text-foreground">From prompt to production</h2>
          </motion.div>

          <div className="grid md:grid-cols-3 gap-6 mb-12">
            {[
              { step: "01", title: "Describe your project", desc: "Type what you want to build. Thalamus AI handles everything from research to deployment.", icon: Terminal },
              { step: "02", title: "Agents plan & execute", desc: "The Planner breaks it into 12-20 atomic tasks. Each agent runs its specialized role in sequence.", icon: Layers },
              { step: "03", title: "Production-ready output", desc: "Complete codebase, tests, docs, security audit — deployed to a live cloud sandbox.", icon: Rocket },
            ].map((item, i) => (
              <motion.div key={i} initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: i * 0.1 }}
                className="border border-border/60 bg-card rounded-2xl p-6 hover:border-primary/30 transition-all group">
                <div className="flex items-center gap-3 mb-4">
                  <span className="text-[11px] font-bold text-primary/60 font-mono">{item.step}</span>
                  <div className="w-8 h-8 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center group-hover:bg-primary/15 transition-all">
                    <item.icon className="h-4 w-4 text-primary" />
                  </div>
                </div>
                <h3 className="text-sm font-bold text-foreground mb-2">{item.title}</h3>
                <p className="text-xs text-muted-foreground leading-relaxed">{item.desc}</p>
              </motion.div>
            ))}
          </div>

          {/* Agent pipeline detail */}
          <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }}
            className="border border-border/60 bg-card rounded-2xl p-6">
            <p className="text-[11px] font-semibold text-muted-foreground tracking-widest mb-4">AGENT PIPELINE</p>
            <div className="grid grid-cols-3 sm:grid-cols-5 md:grid-cols-9 gap-2">
              {AGENTS.map((agent, i) => (
                <motion.div key={agent.name} initial={{ opacity: 0, scale: 0.9 }} whileInView={{ opacity: 1, scale: 1 }} viewport={{ once: true }} transition={{ delay: i * 0.05 }}
                  className={`flex flex-col items-center gap-1.5 p-2.5 rounded-xl border ${agent.bg} text-center`}>
                  <div className={`w-7 h-7 rounded-lg ${agent.bg} border flex items-center justify-center text-sm`}>
                    {agent.abbr}
                  </div>
                  <span className={`text-[9px] font-bold ${agent.color} leading-tight`}>{agent.name}</span>
                  {agent.subAgents.length > 0 && (
                    <span className="text-[8px] text-muted-foreground/60">{agent.subAgents.length} sub</span>
                  )}
                </motion.div>
              ))}
            </div>
          </motion.div>
        </div>
      </section>

      {/* ── Models ──────────────────────────────────────────────────────────── */}
      <section className="py-20 px-6 border-t border-border/50">
        <div className="max-w-7xl mx-auto">
          <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} className="text-center mb-12">
            <p className="text-[11px] font-semibold text-primary tracking-widest mb-3">MODELS</p>
            <h2 className="text-3xl font-bold text-foreground">Powered by the best</h2>
            <p className="text-sm text-muted-foreground mt-3 max-w-lg mx-auto">
              Thalamus automatically routes each agent to the optimal model based on task difficulty. You pay only for what you use via AgentBucks.
            </p>
          </motion.div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {MODELS.map((model, i) => (
              <motion.div key={model.name} initial={{ opacity: 0, y: 16 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: i * 0.08 }}
                className={`border ${model.border} ${model.bg} rounded-2xl p-5 hover:border-opacity-60 transition-all`}>
                <div className="flex items-center justify-between mb-3">
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${model.border} ${model.color} bg-transparent`}>{model.tier}</span>
                  <span className="text-[9px] text-muted-foreground border border-border/50 px-1.5 py-0.5 rounded">{model.badge}</span>
                </div>
                <p className={`text-sm font-bold ${model.color} mb-1`}>{model.name}</p>
                <p className="text-[11px] text-muted-foreground leading-relaxed">{model.desc}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ── AgentBucks ──────────────────────────────────────────────────────── */}
      <section className="py-20 px-6 border-t border-border/50">
        <div className="max-w-7xl mx-auto">
          <div className="grid md:grid-cols-2 gap-12 items-center">
            <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }}>
              <p className="text-[11px] font-semibold text-primary tracking-widest mb-3">AGENTBUCKS</p>
              <h2 className="text-3xl font-bold text-foreground mb-4">
                Pay only for what you use
              </h2>
              <p className="text-sm text-muted-foreground leading-relaxed mb-6">
                AgentBucks (AB) is the internal currency of Thalamus AI. Every model call deducts AB proportional to actual token usage. Daily free allocation + purchasable credits.
              </p>
              <div className="space-y-3">
                {[
                  { icon: Zap, label: "Daily free allocation", desc: "Every user gets free AB daily — no credit card needed" },
                  { icon: Activity, label: "Usage-proportional billing", desc: "Pay exactly for tokens used, not flat subscriptions" },
                  { icon: Shield, label: "Referral rewards", desc: "Earn bonus AB by referring friends to the platform" },
                ].map((item, i) => (
                  <div key={i} className="flex items-start gap-3 p-3 rounded-xl border border-border/50 bg-card/50">
                    <div className="w-7 h-7 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0 mt-0.5">
                      <item.icon className="h-3.5 w-3.5 text-primary" />
                    </div>
                    <div>
                      <p className="text-xs font-semibold text-foreground">{item.label}</p>
                      <p className="text-[11px] text-muted-foreground mt-0.5">{item.desc}</p>
                    </div>
                  </div>
                ))}
              </div>
            </motion.div>

            <motion.div initial={{ opacity: 0, x: 20 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true }}
              className="border border-border/60 bg-card rounded-2xl p-6">
              <p className="text-[11px] font-semibold text-muted-foreground tracking-widest mb-4">PRICING TIERS</p>
              <div className="space-y-3">
                {[
                  { tier: "Haiku 4.5", ab: "~15,000 AB/msg", color: "text-cyan-400", bg: "bg-cyan-400/10" },
                  { tier: "Sonnet 4.6", ab: "~45,000 AB/msg", color: "text-violet-400", bg: "bg-violet-400/10" },
                  { tier: "Opus 4.6", ab: "~75,000 AB/msg", color: "text-amber-400", bg: "bg-amber-400/10" },
                  { tier: "Opus 4.7", ab: "~120,000 AB/msg", color: "text-primary", bg: "bg-primary/10" },
                ].map((item) => (
                  <div key={item.tier} className={`flex items-center justify-between p-3 rounded-xl ${item.bg} border border-current/10`}>
                    <span className={`text-xs font-bold ${item.color}`}>{item.tier}</span>
                    <span className="text-[11px] text-muted-foreground font-mono">{item.ab}</span>
                  </div>
                ))}
              </div>
              <div className="mt-4 pt-4 border-t border-border/50">
                <p className="text-[10px] text-muted-foreground">Daily free allocation: <span className="text-foreground font-semibold">500,000 AB</span></p>
                <p className="text-[10px] text-muted-foreground mt-1">Purchased credits never expire.</p>
              </div>
            </motion.div>
          </div>
        </div>
      </section>

      {/* ── CTA ─────────────────────────────────────────────────────────────── */}
      <section className="py-24 px-6 border-t border-border/50">
        <div className="max-w-3xl mx-auto text-center">
          <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }}>
            <div className="inline-flex items-center gap-2 border border-primary/25 bg-primary/8 text-primary text-[11px] font-semibold px-3 py-1.5 rounded-full mb-6">
              <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
              THALAMUS AI — L4.5 AGENT SYSTEM
            </div>
            <h2 className="text-4xl font-bold text-foreground mb-4">
              Ready to build with <span className="text-primary">9 agents?</span>
            </h2>
            <p className="text-sm text-muted-foreground mb-8 max-w-lg mx-auto">
              Chat, research, study, or deploy full software — all from one portal. Free daily allocation. No credit card required.
            </p>
            <motion.button onClick={handleLaunch} whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
              className="inline-flex items-center gap-2 px-8 py-4 bg-primary text-primary-foreground text-sm font-semibold rounded-xl hover:bg-primary/90 transition-all shadow-lg shadow-primary/20">
              Launch Thalamus Portal
              <ArrowRight className="h-4 w-4" />
            </motion.button>
          </motion.div>
        </div>
      </section>

      {/* ── Footer ──────────────────────────────────────────────────────────── */}
      <footer className="border-t border-border/50 py-8">
        <div className="max-w-7xl mx-auto px-6 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-6 h-6 rounded bg-primary/15 border border-primary/30 flex items-center justify-center">
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

      {/* Suggestion Modal */}
      {suggestionsOpen && (
        <SuggestionModal
          onClose={() => setSuggestionsOpen(false)}
          onSubmit={async (title, description, files) => {
            setIsSuggestionSubmitting(true);
            try {
              await submitSuggestionMutation({ title, description, files: files.length > 0 ? files : undefined });
              toast.success("Feedback submitted! Thank you.");
              setSuggestionsOpen(false);
            } catch (err) {
              toast.error(err instanceof Error ? err.message : "Failed to submit");
            } finally {
              setIsSuggestionSubmitting(false);
            }
          }}
          isSubmitting={isSuggestionSubmitting}
        />
      )}
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