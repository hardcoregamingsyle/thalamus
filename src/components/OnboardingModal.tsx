import { motion, AnimatePresence } from "framer-motion";
import { useState } from "react";
import {
  Cpu, MessageSquare, Code2, BookOpen,
  ChevronRight, ChevronLeft, X, Sparkles,
  Globe, Brain, Check,
} from "lucide-react";

interface OnboardingModalProps {
  onComplete: () => void;
  userName?: string;
}

const STEPS = [
  {
    id: "welcome",
    title: "Welcome to Thalamus AI",
    subtitle: "An AI workspace for chat, research, study, and building",
    content: null,
  },
  {
    id: "modes",
    title: "Four Modes",
    subtitle: "Each mode is built for a different kind of work",
    content: null,
  },
  {
    id: "code",
    title: "Code Mode — Dynamic Agent Pipeline",
    subtitle: "A dispatcher picks the right agents for your task — up to nine of them",
    content: null,
  },
  {
    id: "economy",
    title: "Agent Bucks",
    subtitle: "Free credits, refreshed every day",
    content: null,
  },
  {
    id: "ready",
    title: "You're All Set",
    subtitle: "Start building, researching, studying, or just chatting",
    content: null,
  },
];

const MODES = [
  {
    id: "chat",
    icon: MessageSquare,
    label: "Chat",
    color: "text-emerald-400",
    accent: "bg-emerald-400/10 border-emerald-400/30",
    desc: "Ask questions and get clear answers, with your conversation kept in context.",
    badge: "Free for guests",
  },
  {
    id: "research",
    icon: Globe,
    label: "Research",
    color: "text-blue-400",
    accent: "bg-blue-400/10 border-blue-400/30",
    desc: "Live web search that pulls current sources into a structured report.",
    badge: "Requires account",
  },
  {
    id: "code",
    icon: Code2,
    label: "Code",
    color: "text-violet-400",
    accent: "bg-violet-400/10 border-violet-400/30",
    desc: "9-agent pipeline: Planner → Coder → Optimiser → Tester → Red Team → Critic → and more.",
    badge: "Requires account",
  },
  {
    id: "study",
    icon: BookOpen,
    label: "Study",
    color: "text-indigo-400",
    accent: "bg-indigo-400/10 border-indigo-400/30",
    desc: "Upload PDFs and notes, then get explanations and practice based on them.",
    badge: "Free for guests",
  },
];

const CODE_AGENTS = [
  { name: "Researcher", role: "Gathers context and requirements", color: "text-blue-400" },
  { name: "Planner", role: "Breaks task into structured steps", color: "text-amber-400" },
  { name: "Coder", role: "Writes the application code", color: "text-violet-400" },
  { name: "Optimiser", role: "Improves performance & security", color: "text-emerald-400" },
  { name: "Tester", role: "Writes and runs test suites", color: "text-cyan-400" },
  { name: "Red Team", role: "Finds vulnerabilities & edge cases", color: "text-red-400" },
  { name: "Critic", role: "Reviews and challenges decisions", color: "text-orange-400" },
  { name: "Summarizer", role: "Distills key insights", color: "text-pink-400" },
  { name: "Organizer", role: "Structures final output", color: "text-teal-400" },
];

export default function OnboardingModal({ onComplete, userName }: OnboardingModalProps) {
  const [step, setStep] = useState(0);
  const [direction, setDirection] = useState(1);

  const goNext = () => {
    if (step < STEPS.length - 1) {
      setDirection(1);
      setStep(s => s + 1);
    } else {
      onComplete();
    }
  };

  const goPrev = () => {
    if (step > 0) {
      setDirection(-1);
      setStep(s => s - 1);
    }
  };

  const variants = {
    enter: (dir: number) => ({ opacity: 0, x: dir > 0 ? 40 : -40 }),
    center: { opacity: 1, x: 0 },
    exit: (dir: number) => ({ opacity: 0, x: dir > 0 ? -40 : 40 }),
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="absolute inset-0 bg-background/90 backdrop-blur-md"
      />

      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.3, ease: "easeOut" }}
        className="relative z-10 w-full max-w-2xl bg-card border border-border rounded-2xl shadow-2xl overflow-hidden"
      >
        {/* Progress bar */}
        <div className="h-0.5 bg-border">
          <motion.div
            className="h-full bg-primary"
            animate={{ width: `${((step + 1) / STEPS.length) * 100}%` }}
            transition={{ duration: 0.4, ease: "easeOut" }}
          />
        </div>

        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-5 pb-2">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-primary/15 border border-primary/30 flex items-center justify-center">
              <Cpu className="h-3.5 w-3.5 text-primary" />
            </div>
            <span className="text-primary font-bold text-xs tracking-widest">THALAMUS_AI</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-[10px] text-muted-foreground">{step + 1} / {STEPS.length}</span>
            <button
              onClick={onComplete}
              className="text-muted-foreground hover:text-foreground transition-colors p-1 rounded-lg hover:bg-muted/50"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Step dots */}
        <div className="flex items-center justify-center gap-1.5 pb-4">
          {STEPS.map((_, i) => (
            <motion.div
              key={i}
              animate={{
                width: i === step ? 20 : 6,
                backgroundColor: i === step ? "hsl(var(--primary))" : i < step ? "hsl(var(--primary) / 0.5)" : "hsl(var(--border))",
              }}
              transition={{ duration: 0.3 }}
              className="h-1.5 rounded-full"
            />
          ))}
        </div>

        {/* Content */}
        <div className="px-6 pb-6 min-h-[380px] flex flex-col">
          <AnimatePresence mode="wait" custom={direction}>
            <motion.div
              key={step}
              custom={direction}
              variants={variants}
              initial="enter"
              animate="center"
              exit="exit"
              transition={{ duration: 0.25, ease: "easeOut" }}
              className="flex-1 flex flex-col"
            >
              {/* Step 0: Welcome */}
              {step === 0 && (
                <div className="flex flex-col items-center text-center gap-6 py-4">
                  <motion.div
                    initial={{ scale: 0.8, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ delay: 0.1, duration: 0.4 }}
                    className="relative"
                  >
                    <div className="w-24 h-24 rounded-3xl bg-primary/10 border border-primary/30 flex items-center justify-center">
                      <Brain className="h-12 w-12 text-primary" />
                    </div>
                    <motion.div
                      animate={{ rotate: 360 }}
                      transition={{ duration: 20, repeat: Infinity, ease: "linear" }}
                      className="absolute -inset-3 rounded-full border border-primary/10 border-dashed"
                    />
                  </motion.div>
                  <div>
                    <h2 className="text-2xl font-bold text-foreground mb-2">
                      {userName ? `Welcome, ${userName.split(" ")[0]}!` : "Welcome to Thalamus AI"}
                    </h2>
                    <p className="text-sm text-muted-foreground max-w-md">
                      Thalamus brings chat, research, study, and <span className="text-primary font-bold">software building</span> together in one workspace.
                    </p>
                  </div>
                  <div className="grid grid-cols-3 gap-3 w-full max-w-sm">
                    {[
                      { icon: "", label: "9 specialized agents" },
                      { icon: "", label: "Real-time responses" },
                      { icon: "", label: "Live web search" },
                    ].map((item, i) => (
                      <motion.div
                        key={i}
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.2 + i * 0.1 }}
                        className="bg-muted/30 border border-border rounded-xl p-3 text-center"
                      >
                        <div className="text-xl mb-1">{item.icon}</div>
                        <p className="text-[10px] text-muted-foreground font-medium">{item.label}</p>
                      </motion.div>
                    ))}
                  </div>
                </div>
              )}

              {/* Step 1: Modes */}
              {step === 1 && (
                <div className="flex flex-col gap-4 py-2">
                  <div className="text-center mb-2">
                    <h2 className="text-xl font-bold text-foreground mb-1">{STEPS[1].title}</h2>
                    <p className="text-xs text-muted-foreground">{STEPS[1].subtitle}</p>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    {MODES.map((mode, i) => (
                      <motion.div
                        key={mode.id}
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: i * 0.08 }}
                        className={`p-3.5 rounded-xl border ${mode.accent} flex flex-col gap-2`}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <mode.icon className={`h-4 w-4 ${mode.color}`} />
                            <span className={`text-sm font-bold ${mode.color}`}>{mode.label}</span>
                          </div>
                          <span className="text-[8px] text-muted-foreground border border-border/50 px-1.5 py-0.5 rounded-full">{mode.badge}</span>
                        </div>
                        <p className="text-[10px] text-muted-foreground leading-relaxed">{mode.desc}</p>
                      </motion.div>
                    ))}
                  </div>
                </div>
              )}

              {/* Step 2: Code Mode Deep Dive */}
              {step === 2 && (
                <div className="flex flex-col gap-4 py-2">
                  <div className="text-center mb-1">
                    <h2 className="text-xl font-bold text-foreground mb-1">{STEPS[2].title}</h2>
                    <p className="text-xs text-muted-foreground">{STEPS[2].subtitle}</p>
                  </div>
                  <div className="bg-muted/20 border border-border rounded-xl p-3">
                    <p className="text-[10px] text-muted-foreground mb-3 text-center">Each agent has a specialized role in the pipeline:</p>
                    <div className="grid grid-cols-3 gap-2">
                      {CODE_AGENTS.map((agent, i) => (
                        <motion.div
                          key={agent.name}
                          initial={{ opacity: 0, scale: 0.9 }}
                          animate={{ opacity: 1, scale: 1 }}
                          transition={{ delay: i * 0.06 }}
                          className="bg-card border border-border rounded-lg p-2 text-center"
                        >
                          <p className={`text-[10px] font-bold ${agent.color} mb-0.5`}>{agent.name}</p>
                          <p className="text-[8px] text-muted-foreground leading-tight">{agent.role}</p>
                        </motion.div>
                      ))}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 bg-violet-400/5 border border-violet-400/20 rounded-xl p-3">
                    <Sparkles className="h-4 w-4 text-violet-400 shrink-0" />
                    <p className="text-[10px] text-muted-foreground">
                      Agents work in sequence, each reviewing and improving the previous agent's work, and hand back <span className="text-violet-400 font-bold">code you can run and deploy</span>.
                    </p>
                  </div>
                </div>
              )}

              {/* Step 3: Agent Bucks */}
              {step === 3 && (
                <div className="flex flex-col gap-4 py-2">
                  <div className="text-center mb-1">
                    <h2 className="text-xl font-bold text-foreground mb-1">{STEPS[3].title}</h2>
                    <p className="text-xs text-muted-foreground">{STEPS[3].subtitle}</p>
                  </div>
                  <div className="grid grid-cols-1 gap-3">
                    {[
                      {
                        icon: "",
                        title: "Daily Free Allocation",
                        desc: "Every day you get a fresh allocation of Agent Bucks — no credit card needed.",
                        color: "border-amber-400/30 bg-amber-400/5",
                      },
                      {
                        icon: "",
                        title: "Pay Per Use",
                        desc: "Agent Bucks are deducted based on the AI model used. Lighter models cost less; powerful models cost more.",
                        color: "border-blue-400/30 bg-blue-400/5",
                      },
                      {
                        icon: "",
                        title: "Earn More",
                        desc: "Refer friends to earn bonus spins. Each spin can award extra Agent Bucks.",
                        color: "border-emerald-400/30 bg-emerald-400/5",
                      },
                      {
                        icon: "",
                        title: "Purchase Credits",
                        desc: "Need more? Purchase additional Agent Bucks anytime from the Credits panel.",
                        color: "border-primary/30 bg-primary/5",
                      },
                    ].map((item, i) => (
                      <motion.div
                        key={i}
                        initial={{ opacity: 0, x: -10 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: i * 0.08 }}
                        className={`flex items-start gap-3 p-3 rounded-xl border ${item.color}`}
                      >
                        <span className="text-lg shrink-0">{item.icon}</span>
                        <div>
                          <p className="text-xs font-bold text-foreground mb-0.5">{item.title}</p>
                          <p className="text-[10px] text-muted-foreground leading-relaxed">{item.desc}</p>
                        </div>
                      </motion.div>
                    ))}
                  </div>
                </div>
              )}

              {/* Step 4: Ready */}
              {step === 4 && (
                <div className="flex flex-col items-center text-center gap-5 py-4">
                  <motion.div
                    initial={{ scale: 0.5, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ type: "spring", stiffness: 200, damping: 15 }}
                    className="w-20 h-20 rounded-full bg-emerald-400/10 border border-emerald-400/30 flex items-center justify-center"
                  >
                    <Check className="h-10 w-10 text-emerald-400" />
                  </motion.div>
                  <div>
                    <h2 className="text-2xl font-bold text-foreground mb-2">You're All Set!</h2>
                    <p className="text-sm text-muted-foreground max-w-md">
                      Thalamus is ready. Start a chat, run some research, build something in Code Mode, or upload your study materials.
                    </p>
                  </div>
                  <div className="grid grid-cols-2 gap-2 w-full max-w-sm">
                    {[
                      { icon: MessageSquare, label: "Start Chatting", color: "text-emerald-400", accent: "bg-emerald-400/10 border-emerald-400/30" },
                      { icon: Code2, label: "Build Something", color: "text-violet-400", accent: "bg-violet-400/10 border-violet-400/30" },
                      { icon: Globe, label: "Research a Topic", color: "text-blue-400", accent: "bg-blue-400/10 border-blue-400/30" },
                      { icon: BookOpen, label: "Study Mode", color: "text-indigo-400", accent: "bg-indigo-400/10 border-indigo-400/30" },
                    ].map((item, i) => (
                      <motion.div
                        key={i}
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.2 + i * 0.08 }}
                        className={`flex items-center gap-2 p-2.5 rounded-xl border ${item.accent}`}
                      >
                        <item.icon className={`h-3.5 w-3.5 ${item.color} shrink-0`} />
                        <span className={`text-[10px] font-bold ${item.color}`}>{item.label}</span>
                      </motion.div>
                    ))}
                  </div>
                  <p className="text-[10px] text-muted-foreground/60">
                    You can revisit this guide anytime from the Help menu.
                  </p>
                </div>
              )}
            </motion.div>
          </AnimatePresence>
        </div>

        {/* Footer navigation */}
        <div className="flex items-center justify-between px-6 pb-6 pt-2 border-t border-border/50">
          <button
            onClick={goPrev}
            disabled={step === 0}
            className="flex items-center gap-1.5 px-4 py-2 text-xs text-muted-foreground hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed transition-all rounded-lg hover:bg-muted/50"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
            Back
          </button>

          <button
            onClick={goNext}
            className="flex items-center gap-2 px-5 py-2.5 bg-primary text-primary-foreground text-xs font-bold rounded-xl hover:bg-primary/90 transition-all"
          >
            {step === STEPS.length - 1 ? (
              <>
                <Sparkles className="h-3.5 w-3.5" />
                Get Started
              </>
            ) : (
              <>
                Next
                <ChevronRight className="h-3.5 w-3.5" />
              </>
            )}
          </button>
        </div>
      </motion.div>
    </div>
  );
}
