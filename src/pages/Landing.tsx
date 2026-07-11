import { motion } from "framer-motion";
import { useNavigate } from "react-router";
import { useAuth } from "@/hooks/use-auth";
import { useRef, useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { toast } from "sonner";
import {
  ArrowRight,
  BookOpen,
  Brain,
  CheckCircle,
  ChevronRight,
  Code2,
  Download,
  FileText,
  Globe2,
  Layers3,
  Lightbulb,
  Loader2,
  MessageSquare,
  Moon,
  Search,
  Send,
  ShieldCheck,
  Sparkles,
  Sun,
  Upload,
  X,
  Zap,
} from "lucide-react";
import { useTheme } from "@/hooks/use-theme";

type ModeId = "chat" | "research" | "study" | "code";

interface SuggestionFile {
  name: string;
  content: string;
  size: number;
}

const MODE_CARDS: Array<{
  id: ModeId;
  label: string;
  icon: typeof MessageSquare;
  tone: string;
  metric: string;
  headline: string;
  desc: string;
  examples: string[];
}> = [
  {
    id: "chat",
    label: "Chat",
    icon: MessageSquare,
    tone: "text-sky-300 border-sky-300/25 bg-sky-300/8",
    metric: "quick answers",
    headline: "Ask anything and feel understood",
    desc: "Get clear help with everyday questions, writing, planning, decisions, and ideas.",
    examples: ["Explain anything", "Write with confidence", "Plan your day"],
  },
  {
    id: "research",
    label: "Research",
    icon: Search,
    tone: "text-amber-300 border-amber-300/25 bg-amber-300/8",
    metric: "fresh information",
    headline: "Understand any topic faster",
    desc: "Turn messy information into simple explanations, comparisons, summaries, and next steps.",
    examples: ["Compare options", "Catch up quickly", "Learn what matters"],
  },
  {
    id: "study",
    label: "Study",
    icon: BookOpen,
    tone: "text-indigo-300 border-indigo-300/25 bg-indigo-300/8",
    metric: "study help",
    headline: "A patient tutor for every learner",
    desc: "Upload notes or ask a question and get explanations that are easy to follow and ready to revise.",
    examples: ["School lessons", "College topics", "Practice questions"],
  },
  {
    id: "code",
    label: "Build",
    icon: Code2,
    tone: "text-emerald-300 border-emerald-300/25 bg-emerald-300/8",
    metric: "make things",
    headline: "Bring apps and ideas to life",
    desc: "Describe what you want to create, and Thalamus helps plan, build, check, and improve it.",
    examples: ["Websites", "Apps", "Useful tools"],
  },
];

const CAPABILITIES = [
  { icon: Brain, label: "Helpful for everything", detail: "Use one AI for questions, learning, research, writing, planning, and building." },
  { icon: Layers3, label: "Made for real life", detail: "Switch between quick help, deeper learning, and bigger projects without changing tools." },
  { icon: ShieldCheck, label: "Private by default", detail: "Your work stays in your session, so you can think, learn, and create with confidence." },
  { icon: Zap, label: "Fast and easy", detail: "Responses appear as they are written, so the experience feels immediate and natural." },
];

const SIGNALS = [
  "Answers for everyday questions",
  "Help with school and college",
  "Fresh research when you need it",
  "Tools for building apps and websites",
  "Clear thinking notes you can open or close",
];

const CONSOLE_LINES = [
  { agent: "Ask", text: "Understanding what you need and choosing the best way to help." },
  { agent: "Learn", text: "Breaking difficult ideas into clear steps and simple language." },
  { agent: "Explore", text: "Finding the important points and turning them into a useful answer." },
  { agent: "Create", text: "Helping turn plans, notes, and ideas into finished work." },
];

function SuggestionModal({
  onClose,
  onSubmit,
  isSubmitting,
}: {
  onClose: () => void;
  onSubmit: (title: string, description: string, files: SuggestionFile[]) => Promise<void>;
  isSubmitting: boolean;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [files, setFiles] = useState<SuggestionFile[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleFileAdd = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(event.target.files ?? []);
    for (const file of selected) {
      const text = await file.text().catch(() => `[Binary: ${file.name}]`);
      setFiles(prev => [...prev, { name: file.name, content: text.slice(0, 50000), size: file.size }]);
    }
    if (fileRef.current) fileRef.current.value = "";
  };

  const handleSubmit = async () => {
    if (!title.trim() || !description.trim()) {
      toast.error("Fill in title and description");
      return;
    }
    await onSubmit(title.trim(), description.trim(), files);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-background/80 backdrop-blur-sm" onClick={onClose} />
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96 }}
        className="relative z-10 w-full max-w-md max-h-[90vh] overflow-y-auto rounded-lg border border-border bg-card shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-accent/30 bg-accent/15">
              <Lightbulb className="h-4 w-4 text-accent" />
            </div>
            <div>
              <p className="text-xs font-bold text-foreground">Submit Feedback</p>
              <p className="text-[10px] text-muted-foreground">Help improve Thalamus AI</p>
            </div>
          </div>
          <button onClick={onClose} className="rounded-md p-1 text-muted-foreground transition-colors hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4 p-5">
          <div>
            <label className="mb-1.5 block text-[10px] font-bold text-muted-foreground">TITLE</label>
            <input
              value={title}
              onChange={event => setTitle(event.target.value)}
              placeholder="Brief title"
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-xs text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-primary/60"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-[10px] font-bold text-muted-foreground">DESCRIPTION</label>
            <textarea
              value={description}
              onChange={event => setDescription(event.target.value)}
              placeholder="Describe the suggestion or bug report"
              rows={4}
              className="w-full resize-none rounded-lg border border-border bg-background px-3 py-2 text-xs text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-primary/60"
            />
          </div>
          <div>
            <input ref={fileRef} type="file" multiple onChange={handleFileAdd} className="hidden" />
            <button
              onClick={() => fileRef.current?.click()}
              className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-border py-2 text-[10px] text-muted-foreground transition-all hover:border-primary/40 hover:text-primary"
            >
              <Upload className="h-3 w-3" />
              Attach files
            </button>
            {files.length > 0 && (
              <div className="mt-2 space-y-1">
                {files.map((file, index) => (
                  <div key={`${file.name}-${index}`} className="flex items-center justify-between rounded-lg border border-border bg-background px-2 py-1.5">
                    <div className="flex min-w-0 items-center gap-1.5">
                      <FileText className="h-3 w-3 shrink-0 text-muted-foreground" />
                      <span className="truncate text-[10px] text-foreground">{file.name}</span>
                    </div>
                    <button onClick={() => setFiles(prev => prev.filter((_, i) => i !== index))} className="ml-2 shrink-0 text-muted-foreground transition-colors hover:text-destructive">
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
          <button
            onClick={handleSubmit}
            disabled={isSubmitting || !title.trim() || !description.trim()}
            className="flex w-full items-center justify-center gap-2 rounded-lg border border-primary/30 bg-primary text-primary-foreground py-2.5 text-xs font-bold transition-all hover:bg-primary/90 disabled:opacity-50"
          >
            {isSubmitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
            {isSubmitting ? "Submitting" : "Submit Feedback"}
          </button>
        </div>
      </motion.div>
    </div>
  );
}

function NavBar({
  isAuthenticated,
  isLoading,
  theme,
  onLaunch,
  onFeedback,
  onToggleTheme,
}: {
  isAuthenticated: boolean;
  isLoading: boolean;
  theme: string;
  onLaunch: () => void;
  onFeedback: () => void;
  onToggleTheme: () => void;
}) {
  return (
    <nav className="fixed left-0 right-0 top-0 z-50 border-b border-white/10 bg-background/75 backdrop-blur-2xl">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6">
        <div className="flex items-center gap-3">
          <div className="h-8 w-8 overflow-hidden rounded-lg border border-white/15 bg-card shadow-sm">
            <img src="/thalamus-logo.png" alt="Thalamus AI" className="h-full w-full object-cover" />
          </div>
          <div>
            <p className="text-sm font-bold tracking-[0.22em] text-foreground">THALAMUS</p>
            <p className="hidden text-[10px] uppercase tracking-[0.18em] text-muted-foreground sm:block">AI for everyday life, learning, and work</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button onClick={onFeedback} className="hidden items-center gap-1.5 rounded-lg border border-white/10 px-3 py-2 text-[11px] font-medium text-muted-foreground transition-all hover:border-accent/40 hover:text-accent sm:flex">
            <Lightbulb className="h-3.5 w-3.5" />
            Feedback
          </button>
          <button onClick={onToggleTheme} className="rounded-lg border border-white/10 p-2 text-muted-foreground transition-all hover:border-white/20 hover:text-foreground" title="Toggle theme">
            {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </button>
          <button onClick={onLaunch} className="flex items-center gap-1.5 rounded-lg bg-foreground px-4 py-2 text-xs font-bold text-background shadow-lg shadow-black/20 transition-all hover:bg-foreground/90">
            {isLoading ? "Loading" : isAuthenticated ? "Open Portal" : "Try Free"}
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </nav>
  );
}

function IntelligenceConsole({ onLaunch }: { onLaunch: () => void }) {
  return (
    <div className="pointer-events-auto mx-auto w-full max-w-5xl">
      <div className="grid gap-3 border-y border-white/10 bg-background/65 px-3 py-3 backdrop-blur-xl md:grid-cols-[1.15fr_0.85fr] md:rounded-lg md:border">
        <div className="rounded-lg border border-white/10 bg-black/30 p-3">
          <div className="mb-3 flex items-center justify-between border-b border-white/10 pb-2">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" />
              <span className="text-[11px] font-bold uppercase tracking-[0.22em] text-foreground">How Thalamus Helps</span>
            </div>
            <span className="rounded-full border border-emerald-300/25 bg-emerald-300/10 px-2 py-0.5 text-[10px] font-bold text-emerald-300">Online</span>
          </div>
          <div className="space-y-2">
            {CONSOLE_LINES.map((line, index) => (
              <motion.div
                key={line.agent}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.12 * index }}
                className="grid grid-cols-[88px_1fr] gap-3 rounded-lg border border-white/8 bg-white/[0.03] px-3 py-2"
              >
                <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-primary">{line.agent}</span>
                <span className="text-[11px] leading-relaxed text-muted-foreground">{line.text}</span>
              </motion.div>
            ))}
          </div>
        </div>

        <div className="grid gap-3">
          <div className="rounded-lg border border-white/10 bg-white/[0.035] p-4">
            <div className="mb-3 flex items-center gap-2">
              <Globe2 className="h-4 w-4 text-amber-300" />
              <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-foreground">What You Can Do</p>
            </div>
            <div className="space-y-2">
              {SIGNALS.map(signal => (
                <div key={signal} className="flex items-center gap-2 text-[11px] text-muted-foreground">
                  <CheckCircle className="h-3.5 w-3.5 shrink-0 text-emerald-300" />
                  <span>{signal}</span>
                </div>
              ))}
            </div>
          </div>
          <button
            onClick={onLaunch}
            className="group flex items-center justify-between rounded-lg border border-primary/30 bg-primary px-4 py-4 text-left text-primary-foreground shadow-xl shadow-primary/15 transition-all hover:bg-primary/90"
          >
            <span>
              <span className="block text-xs font-bold uppercase tracking-[0.18em]">Start now</span>
              <span className="mt-1 block text-[11px] opacity-80">Choose Chat, Research, Study, or Build.</span>
            </span>
            <ArrowRight className="h-5 w-5 transition-transform group-hover:translate-x-1" />
          </button>
        </div>
      </div>
    </div>
  );
}

// Always points to the latest release — no hardcoded version tag that goes stale.
const EXE_URL = "https://github.com/hardcoregamingsyle/thalamus/releases/latest/download/Thalamus.exe";

function Hero({ onLaunch }: { onLaunch: () => void }) {
  return (
    <section className="relative min-h-[92vh] overflow-hidden px-4 pt-28 sm:px-6">
      <div className="absolute inset-0 -z-10 opacity-80">
        <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.055)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.055)_1px,transparent_1px)] bg-[size:80px_80px]" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_10%,rgba(125,180,255,0.18),transparent_38%),radial-gradient(circle_at_85%_35%,rgba(245,190,90,0.10),transparent_30%),linear-gradient(180deg,transparent_0%,var(--background)_88%)]" />
      </div>

      <div className="mx-auto max-w-7xl">
        <div className="mx-auto max-w-5xl text-center">
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-8 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-4 py-2 text-[11px] font-bold uppercase tracking-[0.18em] text-muted-foreground backdrop-blur-xl"
          >
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-300" />
            AI workspace · By Aphantic Corporations
          </motion.div>

          <motion.h1
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.65 }}
            className="mx-auto max-w-5xl text-balance text-5xl font-semibold leading-[0.94] tracking-normal text-foreground/80 sm:text-7xl lg:text-8xl"
          >
            <span className="block text-foreground/55">Everything you need</span>
            <span className="block bg-[linear-gradient(110deg,#f8fafc_0%,#93c5fd_32%,#fcd34d_66%,#d9f99d_100%)] bg-clip-text text-transparent drop-shadow-[0_0_28px_rgba(147,197,253,0.18)]">
              in one AI workspace.
            </span>
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.12, duration: 0.55 }}
            className="mx-auto mt-6 max-w-3xl text-base leading-7 text-muted-foreground sm:text-lg"
          >
            Thalamus helps you ask, learn, research, write, plan, and build from one beautiful place.
          </motion.p>


          <motion.div
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row"
          >
            <button onClick={onLaunch} className="group flex items-center gap-2 rounded-lg bg-foreground px-6 py-3 text-sm font-bold text-background shadow-2xl shadow-black/30 transition-all hover:bg-foreground/90">
              Launch Thalamus
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
            </button>
            <a
              href={EXE_URL}
              download="Thalamus.exe"
              className="group flex items-center gap-2 rounded-lg border border-primary/40 bg-primary/10 px-6 py-3 text-sm font-bold text-primary backdrop-blur-xl transition-all hover:bg-primary/20 hover:border-primary/60"
            >
              <Download className="h-4 w-4" />
              Download for Windows
            </a>
            <button onClick={() => document.getElementById("modes")?.scrollIntoView({ behavior: "smooth" })} className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.035] px-6 py-3 text-sm font-bold text-foreground backdrop-blur-xl transition-all hover:border-white/20 hover:bg-white/[0.06]">
              See what it can do
              <Layers3 className="h-4 w-4" />
            </button>
          </motion.div>
        </div>

        <motion.div
          initial={{ opacity: 0, y: 28 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.28, duration: 0.65 }}
          className="mt-14"
        >
          <IntelligenceConsole onLaunch={onLaunch} />
        </motion.div>
      </div>
    </section>
  );
}

function ModeGrid({ onSelect }: { onSelect: (mode: ModeId) => void }) {
  return (
    <section id="modes" className="px-4 py-18 sm:px-6">
      <div className="mx-auto max-w-7xl">
        <div className="mb-8 flex flex-col justify-between gap-4 border-b border-white/10 pb-6 md:flex-row md:items-end">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-primary">Four ways to get help</p>
            <h2 className="mt-3 max-w-3xl text-3xl font-semibold tracking-normal text-foreground sm:text-5xl">The right kind of help for whatever you are doing.</h2>
          </div>
          <p className="max-w-md text-sm leading-6 text-muted-foreground">
            Pick the mode that matches your goal. Thalamus handles the rest in clear, friendly language.
          </p>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          {MODE_CARDS.map((mode, index) => (
            <motion.button
              key={mode.id}
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: index * 0.06 }}
              onClick={() => onSelect(mode.id)}
              className={`group rounded-lg border p-5 text-left transition-all hover:-translate-y-0.5 hover:bg-white/[0.045] ${mode.tone}`}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-start gap-4">
                  <div className="flex h-11 w-11 items-center justify-center rounded-lg border border-current/20 bg-background/45">
                    <mode.icon className="h-5 w-5" />
                  </div>
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-xs font-bold uppercase tracking-[0.2em]">{mode.label}</p>
                      <span className="rounded-full border border-current/20 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.12em] opacity-75">{mode.metric}</span>
                    </div>
                    <h3 className="mt-3 text-xl font-semibold text-foreground">{mode.headline}</h3>
                  </div>
                </div>
                <ArrowRight className="mt-1 h-4 w-4 shrink-0 opacity-45 transition-transform group-hover:translate-x-1 group-hover:opacity-100" />
              </div>
              <p className="mt-4 max-w-2xl text-sm leading-6 text-muted-foreground">{mode.desc}</p>
              <div className="mt-5 grid gap-2 sm:grid-cols-3">
                {mode.examples.map(example => (
                  <div key={example} className="flex items-center gap-2 text-[11px] text-muted-foreground">
                    <CheckCircle className="h-3.5 w-3.5 shrink-0 text-current" />
                    <span>{example}</span>
                  </div>
                ))}
              </div>
            </motion.button>
          ))}
        </div>
      </div>
    </section>
  );
}

function CapabilityBand() {
  return (
    <section className="border-y border-white/10 bg-white/[0.025] px-4 py-16 sm:px-6">
      <div className="mx-auto grid max-w-7xl gap-3 md:grid-cols-4">
        {CAPABILITIES.map((item, index) => (
          <motion.div
            key={item.label}
            initial={{ opacity: 0, y: 14 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: index * 0.05 }}
            className="rounded-lg border border-white/10 bg-background/55 p-5"
          >
            <item.icon className="h-5 w-5 text-primary" />
            <p className="mt-5 text-sm font-bold text-foreground">{item.label}</p>
            <p className="mt-2 text-xs leading-5 text-muted-foreground">{item.detail}</p>
          </motion.div>
        ))}
      </div>
    </section>
  );
}

function FinalCta({ onLaunch, onSelect }: { onLaunch: () => void; onSelect: (mode: ModeId) => void }) {
  return (
    <section className="px-4 py-20 sm:px-6">
      <div className="mx-auto max-w-7xl">
        <div className="grid gap-8 border-y border-white/10 py-12 md:grid-cols-[1fr_auto] md:items-center">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-primary">Start with anything</p>
            <h2 className="mt-3 max-w-3xl text-3xl font-semibold tracking-normal text-foreground sm:text-5xl">
              Powerful enough for big work. Simple enough for everyone.
            </h2>
            <p className="mt-4 max-w-2xl text-sm leading-6 text-muted-foreground">
              Start with a question, a lesson, a topic, an idea, or a project. Thalamus will guide you from there.
            </p>
          </div>
          <button onClick={onLaunch} className="group flex items-center justify-center gap-2 rounded-lg bg-foreground px-6 py-3 text-sm font-bold text-background shadow-2xl shadow-black/30 transition-all hover:bg-foreground/90">
            Launch now
            <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
          </button>
        </div>

        <div className="mt-8 grid gap-2 sm:grid-cols-4">
          {MODE_CARDS.map(mode => (
            <button key={mode.id} onClick={() => onSelect(mode.id)} className={`flex items-center justify-between rounded-lg border px-3 py-3 text-xs font-bold transition-all hover:bg-white/[0.045] ${mode.tone}`}>
              <span>{mode.label}</span>
              <mode.icon className="h-4 w-4" />
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="border-t border-white/10 px-4 py-8 sm:px-6">
      <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-4 sm:flex-row">
        <div className="flex items-center gap-3">
          <div className="h-7 w-7 overflow-hidden rounded-lg border border-white/15 bg-card">
            <img src="/thalamus-logo.png" alt="Thalamus AI" className="h-full w-full object-cover" />
          </div>
          <span className="text-xs font-bold tracking-[0.22em] text-foreground">THALAMUS</span>
          <span className="text-[10px] text-muted-foreground">by Aphantic Corporations</span>
        </div>
        <div className="flex flex-wrap items-center justify-center gap-3 text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
          <span>AI workspace</span>
          <span>Build help</span>
          <span>Live research</span>
          <span>Study help</span>
        </div>
      </div>
    </footer>
  );
}

export default function Landing() {
  const navigate = useNavigate();
  const { isAuthenticated, isLoading } = useAuth();
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const [isSuggestionSubmitting, setIsSuggestionSubmitting] = useState(false);
  const submitSuggestionMutation = useMutation(api.admin.submitSuggestion);
  const { theme, toggleTheme } = useTheme();

  const handleLaunch = () => navigate("/portal");
  const handleModeSelect = (_mode: ModeId) => navigate(`/portal`);

  const handleSuggestionSubmit = async (title: string, description: string, files: SuggestionFile[]) => {
    setIsSuggestionSubmitting(true);
    try {
      await submitSuggestionMutation({ title, description, files: files.length > 0 ? files : undefined });
      toast.success("Feedback submitted");
      setSuggestionsOpen(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to submit");
    } finally {
      setIsSuggestionSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen overflow-x-hidden bg-background font-sans text-foreground">
      <NavBar
        isAuthenticated={isAuthenticated}
        isLoading={isLoading}
        theme={theme}
        onLaunch={handleLaunch}
        onFeedback={() => setSuggestionsOpen(true)}
        onToggleTheme={toggleTheme}
      />
      <Hero onLaunch={handleLaunch} />
      <ModeGrid onSelect={handleModeSelect} />
      <CapabilityBand />
      <FinalCta onLaunch={handleLaunch} onSelect={handleModeSelect} />
      <Footer />

      {suggestionsOpen && (
        <SuggestionModal
          onClose={() => setSuggestionsOpen(false)}
          onSubmit={handleSuggestionSubmit}
          isSubmitting={isSuggestionSubmitting}
        />
      )}
    </div>
  );
}
