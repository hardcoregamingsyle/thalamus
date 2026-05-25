import { motion } from "framer-motion";
import { useNavigate } from "react-router";
import { useAuth } from "@/hooks/use-auth";
import { useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { toast } from "sonner";
import { useRef } from "react";
import {
  ChevronRight, CheckCircle, ArrowRight,
  Lightbulb, X, Upload, FileText, Send, Loader2, Sun, Moon,
} from "lucide-react";
import { useTheme } from "@/hooks/use-theme";

// ── 4 Modes — equally prominent ───────────────────────────────────────────────
const FOUR_MODES = [
  {
    id: "chat", emoji: "💬", label: "CHAT", color: "text-blue-400", border: "border-blue-400/30", bg: "bg-blue-400/8", glow: "shadow-blue-500/10",
    headline: "Talk to the smartest AI alive",
    desc: "Ask anything. Get answers that actually make sense. Claude Haiku 4.5 via AWS Bedrock — fast, accurate, context-aware. Streaming responses.",
    examples: ["Explain quantum computing simply", "Write a cover letter for me", "What's the best diet for energy?", "Help me plan my week"],
    badge: "INSTANT",
  },
  {
    id: "research", emoji: "🔬", label: "RESEARCH", color: "text-amber-400", border: "border-amber-400/30", bg: "bg-amber-400/8", glow: "shadow-amber-500/10",
    headline: "Research anything with live web data",
    desc: "Not just training data. Live web scraping, multi-source synthesis, structured reports. Like having a PhD researcher on demand.",
    examples: ["Latest AI breakthroughs 2026", "Market analysis: EV industry", "CRISPR gene editing advances", "Geopolitical risk assessment"],
    badge: "LIVE WEB",
  },
  {
    id: "study", emoji: "📚", label: "STUDY", color: "text-indigo-400", border: "border-indigo-400/30", bg: "bg-indigo-400/8", glow: "shadow-indigo-500/10",
    headline: "Study smarter, not harder",
    desc: "Upload your notes, textbooks, or any resource. Get notebook-ready explanations that teach you the concept while you read.",
    examples: ["NCERT Class 10 Science", "Calculus derivatives explained", "World War I causes & effects", "Python OOP concepts"],
    badge: "GROUNDED",
  },
  {
    id: "code", emoji: "⚡", label: "CODE", color: "text-violet-400", border: "border-violet-400/30", bg: "bg-violet-400/8", glow: "shadow-violet-500/10",
    headline: "Build entire software products",
    desc: "9 specialized agents — Researcher, Analyser, Planner, Coder, Optimiser, Tester, Red Team, Critic. One prompt. Production-ready.",
    examples: ["Full-stack SaaS app", "REST API with auth", "Mobile-first dashboard", "E-commerce platform"],
    badge: "9 AGENTS",
  },
];

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
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const [isSuggestionSubmitting, setIsSuggestionSubmitting] = useState(false);
  const submitSuggestionMutation = useMutation(api.admin.submitSuggestion);
  const { theme, toggleTheme } = useTheme();
  const handleLaunch = () => navigate("/portal/chat");

  return (
    <div className="min-h-screen font-sans overflow-x-hidden">
      {/* ── Nav ─────────────────────────────────────────────────────────────── */}
      <nav className="fixed top-0 left-0 right-0 z-50 border-b border-border/60 backdrop-blur-xl bg-background/90">
        <div className="max-w-7xl mx-auto px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-7 h-7 rounded-lg border border-primary/30 overflow-hidden bg-card">
              <img src="/thalamus-logo.png" alt="Thalamus AI" className="h-full w-full object-cover" />
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
      <section className="pt-32 pb-12 px-6 relative overflow-hidden">
        <div className="max-w-5xl mx-auto text-center">
          {/* Badge */}
          <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}
            className="flex justify-center mb-8">
            <div className="inline-flex items-center gap-2 border border-primary/25 bg-primary/8 text-primary text-[11px] font-semibold px-4 py-2 rounded-full">
              <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
              Study Mode replies fixed · World's First L4.5 Agent System
            </div>
          </motion.div>

          {/* Headline */}
          <motion.div initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6 }}>
            <h1 className="text-5xl lg:text-7xl font-bold text-foreground leading-[1.05] tracking-tight mb-6">
              The AI that does
              <br />
              <span className="text-primary">everything.</span>
            </h1>
            <p className="text-lg text-muted-foreground leading-relaxed mb-3 max-w-2xl mx-auto">
              Chat. Research. Study. Build software. One AI, four superpowers. Free to try — no sign-up required.
            </p>
            <p className="text-sm text-muted-foreground/60 mb-8 max-w-xl mx-auto">
              Powered by Claude Haiku 4.5, Sonnet 4.6, Opus 4.6/4.7 via AWS Bedrock · Gemini 3.1 Flash-Lite · Daytona cloud sandboxes
            </p>
            <motion.button onClick={handleLaunch} whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
              className="inline-flex items-center gap-2 px-8 py-4 bg-primary text-primary-foreground text-sm font-semibold rounded-xl hover:bg-primary/90 transition-all shadow-lg shadow-primary/20">
              Launch Thalamus — Free
              <ArrowRight className="h-4 w-4" />
            </motion.button>
          </motion.div>
        </div>
      </section>

      {/* ── 4 Mode Cards — equally prominent ────────────────────────────────── */}
      <section className="px-6 pb-16">
        <div className="max-w-7xl mx-auto">
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.2 }}
            className="text-center mb-10">
            <p className="text-[11px] font-bold text-muted-foreground tracking-widest mb-2">FOUR MODES. ONE AI.</p>
            <h2 className="text-2xl font-bold text-foreground">Whatever you need, Thalamus has a mode for it</h2>
          </motion.div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {FOUR_MODES.map((mode, i) => (
              <motion.div key={mode.id}
                initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, delay: 0.1 * i }}
                whileHover={{ y: -2 }}
                onClick={() => navigate(`/portal/${mode.id}`)}
                className={`cursor-pointer border ${mode.border} ${mode.bg} rounded-2xl p-6 hover:shadow-lg ${mode.glow} transition-all group`}
              >
                <div className="flex items-start justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <div className="text-3xl">{mode.emoji}</div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className={`text-xs font-bold ${mode.color}`}>{mode.label}</span>
                        <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full border ${mode.border} ${mode.color} opacity-70`}>{mode.badge}</span>
                      </div>
                      <p className="text-sm font-bold text-foreground mt-0.5">{mode.headline}</p>
                    </div>
                  </div>
                  <ArrowRight className={`h-4 w-4 ${mode.color} opacity-0 group-hover:opacity-100 transition-opacity shrink-0 mt-1`} />
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed mb-4">{mode.desc}</p>
                <div className="grid grid-cols-2 gap-1.5">
                  {mode.examples.map((ex, j) => (
                    <div key={j} className="flex items-center gap-1.5">
                      <CheckCircle className={`h-3 w-3 ${mode.color} shrink-0`} />
                      <span className="text-[10px] text-muted-foreground truncate">{ex}</span>
                    </div>
                  ))}
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Why Thalamus ─────────────────────────────────────────────────────── */}
      <section className="px-6 pb-16">
        <div className="max-w-5xl mx-auto">
          <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }}
            className="border border-border bg-card/50 rounded-2xl p-8">
            <div className="text-center mb-8">
              <p className="text-[11px] font-bold text-muted-foreground tracking-widest mb-2">WHY THALAMUS</p>
              <h2 className="text-2xl font-bold text-foreground">Not just another chatbot</h2>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
              {[
                { icon: "🧠", title: "Streaming responses", desc: "First tokens appear in under 500ms. No waiting. No loading spinners. Just instant answers." },
                { icon: "🌐", title: "Live web grounding", desc: "Research and Study modes search the live web before answering. Always up-to-date, never stale." },
                { icon: "🔒", title: "Enterprise-grade AI", desc: "Claude Haiku 4.5 to Opus 4.7 via AWS Bedrock. The same models used by Fortune 500 companies." },
              ].map((item, i) => (
                <motion.div key={i} initial={{ opacity: 0, y: 10 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: i * 0.1 }}
                  className="text-center">
                  <div className="text-3xl mb-3">{item.icon}</div>
                  <p className="text-sm font-bold text-foreground mb-2">{item.title}</p>
                  <p className="text-xs text-muted-foreground leading-relaxed">{item.desc}</p>
                </motion.div>
              ))}
            </div>
          </motion.div>
        </div>
      </section>

      {/* ── CTA ──────────────────────────────────────────────────────────────── */}
      <section className="px-6 pb-20">
        <div className="max-w-2xl mx-auto text-center">
          <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }}>
            <h2 className="text-3xl font-bold text-foreground mb-4">Ready to try the best AI for everything?</h2>
            <p className="text-sm text-muted-foreground mb-8">Free daily allocation. No credit card. No sign-up required to try.</p>
            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              {FOUR_MODES.map(mode => (
                <motion.button key={mode.id} onClick={() => navigate(`/portal/${mode.id}`)}
                  whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}
                  className={`flex items-center gap-2 px-4 py-2.5 border ${mode.border} ${mode.bg} ${mode.color} text-xs font-bold rounded-xl hover:opacity-90 transition-all`}>
                  <span>{mode.emoji}</span>
                  {mode.label}
                </motion.button>
              ))}
            </div>
          </motion.div>
        </div>
      </section>

      {/* ── Footer ──────────────────────────────────────────────────────────── */}
      <footer className="border-t border-border/50 py-8">
        <div className="max-w-7xl mx-auto px-6 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-6 h-6 rounded border border-primary/30 overflow-hidden bg-card">
              <img src="/thalamus-logo.png" alt="Thalamus AI" className="h-full w-full object-cover" />
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
