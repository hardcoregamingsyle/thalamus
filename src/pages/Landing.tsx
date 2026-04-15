import { motion } from "framer-motion";
import { useNavigate } from "react-router";
import { Terminal, MessageSquare, Search, Code2, ChevronRight, Zap, Shield, Cpu } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { useEffect, useState } from "react";

const TYPING_LINES = [
  "> Initializing AgentAI...",
  "> Loading neural networks...",
  "> Connecting to Claude 3.5 Sonnet...",
  "> Research engine: ONLINE",
  "> Code assistant: ONLINE",
  "> Chat interface: ONLINE",
  "> All systems operational.",
  "> Welcome to AGENT_AI v2.0.1",
];

function TypingAnimation() {
  const [lines, setLines] = useState<string[]>([]);
  const [currentLine, setCurrentLine] = useState(0);
  const [currentChar, setCurrentChar] = useState(0);

  useEffect(() => {
    if (currentLine >= TYPING_LINES.length) return;

    const line = TYPING_LINES[currentLine];
    if (currentChar < line.length) {
      const t = setTimeout(() => setCurrentChar((c) => c + 1), 30);
      return () => clearTimeout(t);
    } else {
      const t = setTimeout(() => {
        setLines((l) => [...l, line]);
        setCurrentLine((l) => l + 1);
        setCurrentChar(0);
      }, 200);
      return () => clearTimeout(t);
    }
  }, [currentLine, currentChar]);

  const currentText = currentLine < TYPING_LINES.length ? TYPING_LINES[currentLine].slice(0, currentChar) : "";

  return (
    <div className="font-mono text-xs space-y-1">
      {lines.map((line, i) => (
        <div key={i} className={`${line.includes("ONLINE") ? "text-primary terminal-glow" : line.includes("Welcome") ? "text-amber-400 terminal-glow-amber" : "text-muted-foreground"}`}>
          {line}
        </div>
      ))}
      {currentLine < TYPING_LINES.length && (
        <div className="text-muted-foreground">
          {currentText}
          <span className="animate-pulse text-primary">█</span>
        </div>
      )}
    </div>
  );
}

export default function Landing() {
  const navigate = useNavigate();
  const { isAuthenticated, isLoading } = useAuth();

  const handleLaunch = () => {
    if (isAuthenticated) {
      navigate("/portal");
    } else {
      navigate("/auth");
    }
  };

  return (
    <div className="min-h-screen bg-background font-mono overflow-x-hidden">
      {/* Nav */}
      <nav className="border-b border-border px-6 h-12 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Terminal className="h-4 w-4 text-primary terminal-glow" />
          <span className="text-primary font-bold text-sm tracking-widest terminal-glow">AGENT_AI</span>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-xs text-muted-foreground hidden sm:block">v2.0.1</span>
          <button
            onClick={handleLaunch}
            className="text-xs border border-primary text-primary px-3 py-1 hover:bg-primary hover:text-primary-foreground transition-all terminal-glow"
          >
            {isLoading ? "..." : isAuthenticated ? "OPEN_PORTAL" : "LOGIN"}
          </button>
        </div>
      </nav>

      {/* Hero */}
      <section className="max-w-6xl mx-auto px-6 py-20 grid md:grid-cols-2 gap-12 items-center">
        <motion.div
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.6 }}
        >
          <div className="text-xs text-muted-foreground mb-4 flex items-center gap-2">
            <span className="w-2 h-2 bg-primary rounded-full animate-pulse" />
            SYSTEM_STATUS: OPERATIONAL
          </div>
          <h1 className="text-4xl md:text-5xl font-bold text-primary terminal-glow leading-tight mb-4">
            AGENT_AI
          </h1>
          <p className="text-muted-foreground text-sm leading-relaxed mb-2">
            // Advanced AI research, coding, and conversation portal
          </p>
          <p className="text-foreground text-sm leading-relaxed mb-8">
            Powered by Claude 3.5 Sonnet. Built for researchers, developers, and thinkers who demand more from their AI.
          </p>

          <div className="flex flex-col sm:flex-row gap-3">
            <button
              onClick={handleLaunch}
              className="flex items-center gap-2 px-6 py-3 bg-primary text-primary-foreground text-sm font-bold hover:bg-primary/90 transition-all"
            >
              <Terminal className="h-4 w-4" />
              LAUNCH_PORTAL
              <ChevronRight className="h-4 w-4" />
            </button>
            <button
              onClick={() => document.getElementById("features")?.scrollIntoView({ behavior: "smooth" })}
              className="flex items-center gap-2 px-6 py-3 border border-border text-muted-foreground text-sm hover:border-primary hover:text-primary transition-all"
            >
              VIEW_FEATURES
            </button>
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.6, delay: 0.2 }}
          className="border border-border bg-card p-6"
        >
          <div className="flex items-center gap-2 mb-4 border-b border-border pb-3">
            <div className="w-3 h-3 rounded-full bg-destructive" />
            <div className="w-3 h-3 rounded-full bg-amber-400" />
            <div className="w-3 h-3 rounded-full bg-primary" />
            <span className="text-xs text-muted-foreground ml-2">agent_ai — terminal</span>
          </div>
          <TypingAnimation />
        </motion.div>
      </section>

      {/* Modes */}
      <section id="features" className="border-t border-border py-16">
        <div className="max-w-6xl mx-auto px-6">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="mb-10"
          >
            <p className="text-xs text-muted-foreground mb-2">// AVAILABLE_MODES</p>
            <h2 className="text-2xl font-bold text-primary terminal-glow">THREE MODES. ONE AGENT.</h2>
          </motion.div>

          <div className="grid md:grid-cols-3 gap-4">
            {[
              {
                icon: MessageSquare,
                title: "CHAT_MODE",
                desc: "Natural conversation with Claude 3.5 Sonnet. Ask anything, explore ideas, get instant answers.",
                color: "text-primary",
                border: "border-primary/30 hover:border-primary",
              },
              {
                icon: Search,
                title: "RESEARCH_MODE",
                desc: "Deep analysis and comprehensive research. Structured reports, comparisons, and expert-level breakdowns.",
                color: "text-amber-400",
                border: "border-amber-400/30 hover:border-amber-400",
              },
              {
                icon: Code2,
                title: "CODE_MODE",
                desc: "Vibe coding with AI. Build features, debug issues, refactor code, and ship faster.",
                color: "text-primary",
                border: "border-primary/30 hover:border-primary",
              },
            ].map((item, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.1 }}
                className={`border ${item.border} bg-card p-6 transition-all cursor-pointer group`}
                onClick={handleLaunch}
              >
                <item.icon className={`h-6 w-6 ${item.color} mb-4`} />
                <h3 className={`text-sm font-bold ${item.color} mb-2`}>{item.title}</h3>
                <p className="text-xs text-muted-foreground leading-relaxed">{item.desc}</p>
                <div className="mt-4 flex items-center gap-1 text-xs text-muted-foreground group-hover:text-primary transition-colors">
                  <span>$ access_mode</span>
                  <ChevronRight className="h-3 w-3" />
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Features grid */}
      <section className="border-t border-border py-16">
        <div className="max-w-6xl mx-auto px-6">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="mb-10"
          >
            <p className="text-xs text-muted-foreground mb-2">// SYSTEM_SPECS</p>
            <h2 className="text-2xl font-bold text-primary terminal-glow">BUILT DIFFERENT.</h2>
          </motion.div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {[
              { icon: Cpu, title: "CLAUDE 3.5 SONNET", desc: "State-of-the-art AI model with 200K context window" },
              { icon: Zap, title: "REAL-TIME STREAMING", desc: "Instant responses with live token streaming" },
              { icon: Shield, title: "USAGE TRACKING", desc: "Monitor your AI usage and costs in real-time" },
              { icon: MessageSquare, title: "PERSISTENT HISTORY", desc: "All conversations saved and searchable" },
              { icon: Code2, title: "CODE HIGHLIGHTING", desc: "Syntax-highlighted code blocks for all languages" },
              { icon: Search, title: "RESEARCH ENGINE", desc: "Structured analysis with citations and breakdowns" },
            ].map((item, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 10 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.05 }}
                className="flex items-start gap-3 p-4 border border-border bg-card hover:border-primary/50 transition-all"
              >
                <item.icon className="h-4 w-4 text-primary shrink-0 mt-0.5" />
                <div>
                  <p className="text-xs font-bold text-foreground mb-1">{item.title}</p>
                  <p className="text-xs text-muted-foreground">{item.desc}</p>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="border-t border-border py-16">
        <div className="max-w-2xl mx-auto px-6 text-center">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
          >
            <div className="border border-border bg-card p-8">
              <p className="text-xs text-muted-foreground mb-4">// READY_TO_BEGIN</p>
              <h2 className="text-2xl font-bold text-primary terminal-glow mb-4">
                ACCESS THE PORTAL
              </h2>
              <p className="text-xs text-muted-foreground mb-6">
                Sign in with your email. Verify with OTP. Start building.
              </p>
              <button
                onClick={handleLaunch}
                className="flex items-center gap-2 px-8 py-3 bg-primary text-primary-foreground text-sm font-bold hover:bg-primary/90 transition-all mx-auto"
              >
                <Terminal className="h-4 w-4" />
                INITIALIZE_SESSION
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </motion.div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border py-6 px-6">
        <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <Terminal className="h-3 w-3 text-primary" />
            <span className="text-xs text-muted-foreground">AGENT_AI v2.0.1 — All rights reserved</span>
          </div>
          <div className="text-xs text-muted-foreground">
            Powered by{" "}
            <a href="https://vly.ai" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
              vly.ai
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}