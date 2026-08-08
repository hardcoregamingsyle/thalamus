// Landing page navigation bar (feedback, theme toggle, launch/open CTA).
// Rendered by src/pages/Landing.tsx as the fixed top-of-page chrome.

import { ChevronRight, Lightbulb, Moon, Sun } from "lucide-react";

export interface NavBarProps {
  isAuthenticated: boolean;
  isLoading: boolean;
  theme: string;
  onLaunch: () => void;
  onFeedback: () => void;
  onToggleTheme: () => void;
}

export default function NavBar({
  isAuthenticated,
  isLoading,
  theme,
  onLaunch,
  onFeedback,
  onToggleTheme,
}: NavBarProps) {
  return (
    <nav className="fixed left-0 right-0 top-0 z-50 border-b border-foreground/10 bg-background/75 backdrop-blur-2xl">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6">
        <div className="flex items-center gap-3">
          <div className="h-8 w-8 overflow-hidden rounded-lg border border-foreground/15 bg-card shadow-sm">
            <img src="/thalamus-logo.png" alt="Thalamus AI" className="h-full w-full object-cover" />
          </div>
          <div>
            <p className="text-sm font-bold tracking-[0.22em] text-foreground">THALAMUS</p>
            <p className="hidden text-[10px] uppercase tracking-[0.18em] text-muted-foreground sm:block">AI for everyday life, learning, and work</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button onClick={onFeedback} className="hidden items-center gap-1.5 rounded-lg border border-foreground/10 px-3 py-2 text-[11px] font-medium text-muted-foreground transition-all hover:border-accent/40 hover:text-accent sm:flex">
            <Lightbulb className="h-3.5 w-3.5" />
            Feedback
          </button>
          <button
            aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
            onClick={onToggleTheme}
            className="rounded-lg border border-foreground/10 p-2 text-muted-foreground transition-all hover:border-foreground/20 hover:text-foreground"
            title="Toggle theme"
          >
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
