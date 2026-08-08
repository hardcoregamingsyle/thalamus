// Full-screen mode-picker shown to authed users who hit /portal without a
// mode segment in the URL. PortalDesktop renders this when its route param is
// missing; picking a card navigates to /portal/<mode>.

import { useNavigate } from "react-router";
import { motion } from "framer-motion";
import {
  ArrowRight, BookOpen, LogOut, MessageSquare, Moon,
  Search, Sparkles, Sun, Users,
} from "lucide-react";

export interface ModeSelectionProps {
  user: unknown;
  signOut: () => void;
  theme: string;
  toggleTheme: () => void;
}

export default function ModeSelection({ signOut, theme, toggleTheme }: ModeSelectionProps) {
  const navigate = useNavigate();

  const modeCards = [
    {
      id: "chat",
      title: "Chat",
      description: "General conversation and quick questions",
      icon: MessageSquare,
      color: "from-blue-500/20 to-cyan-500/20",
      borderColor: "border-blue-500/30",
      textColor: "text-blue-400",
      features: ["Fast responses", "General knowledge", "Helpful & concise"],
    },
    {
      id: "research",
      title: "Research",
      description: "Deep analysis with web search capabilities",
      icon: Search,
      color: "from-violet-500/20 to-purple-500/20",
      borderColor: "border-violet-500/30",
      textColor: "text-violet-400",
      features: ["Web search", "Citations", "In-depth analysis"],
    },
    {
      id: "study",
      title: "Study",
      description: "Upload materials and get study help",
      icon: BookOpen,
      color: "from-indigo-500/20 to-blue-500/20",
      borderColor: "border-indigo-500/30",
      textColor: "text-indigo-400",
      features: ["Upload files", "RAG-powered", "Answer auditor"],
    },
    {
      id: "code",
      title: "Code",
      description: "Multi-agent system for software development",
      icon: Users,
      color: "from-emerald-500/20 to-teal-500/20",
      borderColor: "border-emerald-500/30",
      textColor: "text-emerald-400",
      features: ["9 specialized agents", "Full stack dev", "GitHub sync"],
    },
  ];

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border bg-card/50 backdrop-blur-md">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary/20 border border-primary/40 flex items-center justify-center">
              <Sparkles className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-foreground">Thalamus AI</h1>
              <p className="text-xs text-muted-foreground">Choose your mode</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button
              aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
              onClick={toggleTheme}
              className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-all"
            >
              {theme === "dark" ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
            </button>
            <button
              onClick={signOut}
              className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-all"
            >
              <LogOut className="h-4 w-4" />
              <span className="hidden sm:inline">Sign Out</span>
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-12">
        <div className="text-center mb-8 sm:mb-12">
          <motion.h2
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-3xl sm:text-4xl font-bold text-foreground mb-3"
          >
            What would you like to do?
          </motion.h2>
          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="text-muted-foreground max-w-2xl mx-auto"
          >
            Select a mode to get started. Each mode is built for a different kind of task.
          </motion.p>
        </div>

        {/* Mode Cards Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6 max-w-5xl mx-auto">
          {modeCards.map((mode, idx) => (
            <motion.button
              key={mode.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: idx * 0.1 }}
              onClick={() => navigate(`/portal/${mode.id}`)}
              className={`group relative bg-gradient-to-br ${mode.color} border ${mode.borderColor} rounded-2xl p-6 text-left hover:scale-[1.02] transition-all duration-300 overflow-hidden`}
            >
              {/* Background glow effect */}
              <div className={`absolute inset-0 bg-gradient-to-br ${mode.color} opacity-0 group-hover:opacity-100 transition-opacity blur-xl`} />

              {/* Content */}
              <div className="relative z-10">
                <div className="flex items-start justify-between mb-4">
                  <div className={`w-14 h-14 rounded-xl bg-background/50 border ${mode.borderColor} flex items-center justify-center backdrop-blur-sm`}>
                    <mode.icon className={`h-7 w-7 ${mode.textColor}`} />
                  </div>
                  <ArrowRight className={`h-5 w-5 ${mode.textColor} opacity-0 group-hover:opacity-100 transition-opacity`} />
                </div>

                <h3 className={`text-xl font-bold ${mode.textColor} mb-2`}>{mode.title}</h3>
                <p className="text-sm text-muted-foreground mb-4">{mode.description}</p>

                <div className="space-y-2">
                  {mode.features.map((feature, i) => (
                    <div key={i} className="flex items-center gap-2 text-xs text-muted-foreground">
                      <div className={`w-1.5 h-1.5 rounded-full ${mode.textColor.replace('text-', 'bg-')}`} />
                      <span>{feature}</span>
                    </div>
                  ))}
                </div>
              </div>
            </motion.button>
          ))}
        </div>
      </main>
    </div>
  );
}
