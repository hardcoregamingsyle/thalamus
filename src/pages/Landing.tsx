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

  const FOUR_MODES = [
    {
      id: "chat", emoji: "💬", label: "CHAT", color: "text-primary", border: "border-primary/30", bg: "bg-primary/8",
      headline: "Talk to the smartest AI alive",
      desc: "Ask anything. Get answers that actually make sense. Claude Haiku 4.5 via AWS Bedrock — fast, accurate, context-aware.",
      examples: ["Explain quantum computing", "Write a cover letter", "Debug my code", "Plan my week"],
    },
    {
      id: "research", emoji: "🔬", label: "RESEARCH", color: "text-amber-400", border: "border-amber-400/30", bg: "bg-amber-400/8",
      headline: "Research anything with live web data",
      desc: "Not just training data. Live web scraping, multi-source synthesis, structured reports. Like having a PhD researcher on demand.",
      examples: ["Latest AI breakthroughs 2026", "Market analysis: EV industry", "CRISPR gene editing advances", "Geopolitical risk assessment"],
    },
    {
      id: "study", emoji: "📚", label: "STUDY", color: "text-indigo-400", border: "border-indigo-400/30", bg: "bg-indigo-400/8",
      headline: "Study smarter, not harder",
      desc: "Upload your notes, textbooks, or any resource. Get notebook-ready explanations that teach you the concept while you read.",
      examples: ["NCERT Class 10 Science", "Calculus derivatives explained", "World War I causes", "Python OOP concepts"],
    },
    {
      id: "code", emoji: "⚡", label: "CODE", color: "text-violet-400", border: "border-violet-400/30", bg: "bg-violet-400/8",
      headline: "Build entire software products",
      desc: "9 specialized agents — Researcher, Analyser, Planner, Coder, Optimiser, Tester, Red Team, Critic. One prompt. Production-ready.",
      examples: ["Full-stack SaaS app", "REST API with auth", "Mobile-first dashboard", "E-commerce platform"],
    },
  ];

  return (
    <div className="min-h-screen font-sans overflow-x-hidden" style={{
      background: "radial-gradient(ellipse 120% 80% at 50% -20%, oklch(0.62 0.20 250 / 0.18) 0%, transparent 60%), radial-gradient(ellipse 60% 50% at 90% 50%, oklch(0.72 0.16 65 / 0.08) 0%, transparent 60%), radial-gradient(ellipse 50% 40% at 10% 90%, oklch(0.65 0.18 280 / 0.07) 0%, transparent 60%), var(--color-background)"
    }}>
      {/* ── Nav ─────────────────────────────────────────────────────────────── */}
      <nav className="fixed top-0 left-0 right-0 z-50 border-b border-border/60 backdrop-blur-xl" style={{ background: "oklch(0.08 0.008 240 / 0.92)" }}>
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
            <button onClick={() => setSuggestionsOpen(true)} className="hidden sm:flex items-center gap-1.5 text-[11px] border border-border/60 text-muted-foreground px-3 py-1.5 rounded-lg hover:border-accent/40 hover:text-accent transition-all font-medium">
              <Lightbulb className="h-3 w-3" />Feedback
            </button>
            <button onClick={toggleTheme} className="p-2 rounded-lg border border-border/60 text-muted-foreground hover:text-foreground hover:border-border transition-all" title="Toggle theme">
              {theme === "dark" ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
            </button>
            <span className="hidden md:flex items-center gap-1.5 text-[10px] text-muted-foreground">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />LIVE
            </span>
            <button onClick={handleLaunch} className="flex items-center gap-1.5 text-xs bg-primary text-primary-foreground px-4 py-1.5 rounded-lg hover:bg-primary/90 transition-all font-semibold shadow-sm shadow-primary/20">
              {isLoading ? "..." : isAuthenticated ? "Open Portal" : "Try Free — No Sign Up"}
              <ChevronRight className="h-3 w-3" />
            </button>
          </div>
        </div>
      </nav>

      {/* ── Hero ────────────────────────────────────────────────────────────── */}
      <section className="pt-32 pb-16 px-6 relative overflow-hidden">
        <div className="max-w-5xl mx-auto text-center relative">
          {/* Badge */}
          <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }} className="flex justify-center mb-8">
            <div className="inline-flex items-center gap-2 border border-primary/25 bg-primary/8 text-primary text-[11px] font-semibold px-4 py-2 rounded-full">
              <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
              World's First L4.5 Agent System · by Aphantic Corporations
            </div>
          </motion.div>

          {/* Main headline */}
          <motion.div initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6 }}>
            <h1 className="text-5xl lg:text-7xl font-bold text-foreground leading-[1.05] tracking-tight mb-6">
              One AI.
              <br />
              <span className="text-primary">Every task.</span>
              <br />
              <span className="text-muted-foreground text-4xl lg:text-5xl font-semibold">No limits.</span>
            </h1>
            <p className="text-lg text-muted-foreground leading-relaxed mb-3 max-w-2xl mx-auto">
              Chat with the world's most advanced AI. Research anything with live web data. Study smarter with AI-grounded explanations. Build entire software products with 9 specialized agents.
            </p>
            <p className="text-sm text-muted-foreground/70 mb-8 max-w-xl mx-auto">
              All in one place. Free daily allocation. No credit card. No sign-up required to try.
            </p>
            <div className="flex flex-wrap items-center justify-center gap-3 mb-12">
              <motion.button onClick={handleLaunch} whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
                className="flex items-center gap-2 px-8 py-3.5 bg-primary text-primary-foreground text-sm font-semibold rounded-xl hover:bg-primary/90 transition-all shadow-lg shadow-primary/25">
                Start for Free — No Sign Up
                <ArrowRight className="h-4 w-4" />
              </motion.button>
              <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
                onClick={() => document.getElementById("modes")?.scrollIntoView({ behavior: "smooth" })}
                className="flex items-center gap-2 px-6 py-3.5 border border-border text-foreground text-sm font-medium rounded-xl hover:border-primary/40 hover:bg-primary/5 transition-all">
                See all 4 modes
                <ChevronRight className="h-4 w-4" />
              </motion.button>
            </div>
          </motion.div>

          {/* Stats row */}
          <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7, delay: 0.2 }}
            className="flex flex-wrap items-center justify-center gap-8 text-center">
            {[
              { value: "4", label: "Specialized Modes" },
              { value: "9", label: "AI Agents (Code)" },
              { value: "5", label: "Claude Models" },
              { value: "Free", label: "Daily Allocation" },
            ].map((s, i) => (
              <div key={i} className="flex flex-col items-center">
                <span className="text-2xl font-bold text-primary">{s.value}</span>
                <span className="text-[11px] text-muted-foreground mt-0.5">{s.label}</span>
              </div>
            ))}
          </motion.div>
        </div>
      </section>

      {/* ── 4 Modes Grid ─────────────────────────────────────────────────────── */}
      <section id="modes" className="py-16 px-6">
        <div className="max-w-7xl mx-auto">
          <motion.div initial={{ opacity: 0, y: 16 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.5 }}
            className="text-center mb-12">
            <h2 className="text-3xl lg:text-4xl font-bold text-foreground mb-3">Four modes. One platform.</h2>
            <p className="text-muted-foreground max-w-xl mx-auto">Whether you're a student, researcher, developer, or just curious — Thalamus AI has a mode built for you.</p>
          </motion.div>

          <div className="grid md:grid-cols-2 gap-6">
            {FOUR_MODES.map((mode, i) => (
              <motion.div key={mode.id}
                initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.4, delay: i * 0.1 }}
                className={`border ${mode.border} rounded-2xl p-6 cursor-pointer hover:scale-[1.01] transition-all group`}
                style={{ background: `oklch(0.11 0.010 240 / 0.8)` }}
                onClick={() => navigate(`/portal/${mode.id}`)}
              >
                <div className="flex items-start gap-4 mb-4">
                  <div className={`w-12 h-12 rounded-xl ${mode.bg} border ${mode.border} flex items-center justify-center text-2xl shrink-0`}>
                    {mode.emoji}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`text-[10px] font-bold ${mode.color} tracking-widest`}>{mode.label}</span>
                      <span className="text-[9px] text-muted-foreground/50 border border-border/40 px-1.5 py-0.5 rounded">FREE</span>
                    </div>
                    <h3 className="text-base font-bold text-foreground leading-tight">{mode.headline}</h3>
                  </div>
                </div>
                <p className="text-sm text-muted-foreground leading-relaxed mb-4">{mode.desc}</p>
                <div className="flex flex-wrap gap-1.5">
                  {mode.examples.map((ex, j) => (
                    <span key={j} className={`text-[10px] px-2 py-1 rounded-lg border ${mode.border} ${mode.color} bg-transparent`}>{ex}</span>
                  ))}
                </div>
                <div className={`mt-4 flex items-center gap-1.5 text-[11px] ${mode.color} font-semibold group-hover:gap-2.5 transition-all`}>
                  Try {mode.label} mode <ArrowRight className="h-3 w-3" />
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Code Mode Deep Dive ───────────────────────────────────────────────── */}
      <section id="how-it-works" className="py-16 px-6">
        <div className="max-w-7xl mx-auto">
          <motion.div initial={{ opacity: 0, y: 16 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.5 }}
            className="text-center mb-12">
            <h2 className="text-3xl lg:text-4xl font-bold text-foreground mb-3">Code Mode: 9 agents, one prompt</h2>
            <p className="text-muted-foreground max-w-xl mx-auto">The most advanced AI coding system ever built. From research to deployment — fully automated.</p>
          </motion.div>
          <div className="grid lg:grid-cols-2 gap-12 items-center">
            <motion.div initial={{ opacity: 0, x: -20 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true }} transition={{ duration: 0.5 }}>
              <LivePipeline />
            </motion.div>
            <motion.div initial={{ opacity: 0, x: 20 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true }} transition={{ duration: 0.5 }} className="space-y-4">
              {AGENTS.slice(0, 5).map((agent, i) => (
                <div key={agent.name} className={`flex items-start gap-3 p-3 rounded-xl border ${agent.bg}`}>
                  <div className={`w-8 h-8 rounded-lg ${agent.bg} border flex items-center justify-center text-sm shrink-0`}>{agent.abbr}</div>
                  <div>
                    <p className={`text-xs font-bold ${agent.color}`}>{agent.name}</p>
                    <p className="text-[11px] text-muted-foreground">{agent.desc}</p>
                  </div>
                </div>
              ))}
              <button onClick={() => navigate("/portal/code")} className="w-full py-3 bg-violet-500/15 border border-violet-500/30 text-violet-400 text-sm font-bold rounded-xl hover:bg-violet-500/25 transition-all flex items-center justify-center gap-2">
                Launch Code Mode <ArrowRight className="h-4 w-4" />
              </button>
            </motion.div>
          </div>
        </div>
      </section>

      {/* ── Models ───────────────────────────────────────────────────────────── */}
      <section className="py-16 px-6">
        <div className="max-w-7xl mx-auto">
          <motion.div initial={{ opacity: 0, y: 16 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.5 }}
            className="text-center mb-10">
            <h2 className="text-3xl font-bold text-foreground mb-3">Powered by the world's best models</h2>
            <p className="text-muted-foreground">Claude 4.x via AWS Bedrock. Gemini 3.1 Flash-Lite. Always the right model for the task.</p>
          </motion.div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3">
            {MODELS.map((model, i) => (
              <motion.div key={model.name} initial={{ opacity: 0, y: 12 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.3, delay: i * 0.08 }}
                className={`border ${model.border} ${model.bg} rounded-xl p-4`}>
                <div className="flex items-center justify-between mb-2">
                  <span className={`text-[9px] font-bold ${model.color} tracking-widest`}>{model.tier}</span>
                  <span className="text-[9px] text-muted-foreground/60 border border-border/40 px-1.5 py-0.5 rounded">{model.badge}</span>
                </div>
                <p className={`text-xs font-bold ${model.color} mb-1`}>{model.name}</p>
                <p className="text-[10px] text-muted-foreground leading-relaxed">{model.desc}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA ─────────────────────────────────────────────────────────────── */}
      <section className="py-20 px-6">
        <div className="max-w-3xl mx-auto text-center">
          <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.5 }}>
            <h2 className="text-4xl lg:text-5xl font-bold text-foreground mb-4">
              The only AI you'll ever need.
            </h2>
            <p className="text-muted-foreground mb-8 max-w-lg mx-auto">
              Chat, research, study, build — all from one portal. Free daily allocation. No credit card required.
            </p>
            <motion.button onClick={handleLaunch} whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
              className="inline-flex items-center gap-2 px-8 py-4 bg-primary text-primary-foreground text-sm font-semibold rounded-xl hover:bg-primary/90 transition-all shadow-lg shadow-primary/20">
              Launch Thalamus Portal — Free
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
            <span>L4.5 Agent System</span><span>·</span><span>AWS Bedrock</span><span>·</span><span>Convex</span><span>·</span><span>Daytona</span>
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