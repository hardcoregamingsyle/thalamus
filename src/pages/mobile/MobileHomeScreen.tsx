// Mobile home screen — greeting, mode picker, sign-out. Shown when the URL is
// /portal with no mode segment; picking a card navigates to /portal/<mode>,
// which flips MobilePortal into MobileChatView.

import { motion } from "framer-motion";
import { ChevronRight, LogOut, Moon, Sun } from "lucide-react";
import { useTheme } from "@/hooks/use-theme";
import { ALL_MODES, type Mode } from "@/pages/portal/modes";

export interface MobileHomeScreenProps {
  token: string;
  user: unknown;
  onModeSelect: (mode: Mode) => void;
  onSignOut: () => void;
}

export default function MobileHomeScreen({
  user,
  onModeSelect,
  onSignOut,
}: MobileHomeScreenProps) {
  const { theme, toggleTheme } = useTheme();
  const typedUser = user as { email?: string; name?: string } | null;

  const displayName = typedUser?.name ?? typedUser?.email?.split("@")[0] ?? "there";

  return (
    <div className="flex flex-col h-full bg-background overflow-auto" style={{ paddingTop: "env(safe-area-inset-top)" }}>
      {/* Header */}
      <div className="px-4 pt-5 pb-4">
        <div className="flex items-center justify-between mb-4">
          <img src="/thalamus-logo.png" alt="Thalamus AI" className="h-8 object-contain" />
          <div className="flex items-center gap-2">
            <button
              aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
              onClick={toggleTheme}
              className="w-10 h-10 flex items-center justify-center rounded-xl bg-card border border-border hover:bg-muted/50 transition-colors"
              title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
            >
              {theme === 'dark' ? <Sun className="h-4 w-4 text-muted-foreground" /> : <Moon className="h-4 w-4 text-muted-foreground" />}
            </button>
          </div>
        </div>
        <div>
          <p className="text-sm text-muted-foreground">Good {new Date().getHours() < 12 ? "morning" : new Date().getHours() < 17 ? "afternoon" : "evening"}</p>
          <p className="text-2xl font-semibold text-foreground capitalize mt-0.5">{displayName}</p>
        </div>
      </div>

      {/* Mode cards */}
      <div className="px-4 py-6 flex-1">
        <p className="text-xs text-muted-foreground mb-4 font-medium">Select a mode</p>
        <div className="space-y-3">
          {ALL_MODES.map((mode, i) => (
            <motion.button
              key={mode.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05, duration: 0.2 }}
              whileTap={{ scale: 0.98 }}
              onClick={() => onModeSelect(mode.id)}
              className="w-full flex items-center gap-3 p-4 bg-card border border-border rounded-xl text-left active:bg-muted/50 transition-colors"
            >
              <div className={`w-11 h-11 rounded-lg ${mode.bg} flex items-center justify-center text-xl shrink-0`}>
                {mode.emoji}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-base font-semibold text-foreground">{mode.mobileLabel}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{mode.mobileDesc}</p>
              </div>
              <ChevronRight className="h-5 w-5 text-muted-foreground shrink-0" />
            </motion.button>
          ))}
        </div>
      </div>

      {/* Bottom section */}
      <div className="px-4 pb-6 pt-4 border-t border-border bg-card/50">
        <div className="flex items-center justify-between mb-3">
          <div>
            <p className="text-sm font-medium text-foreground">Thalamus AI</p>
            <p className="text-xs text-muted-foreground">Multi-agent intelligence</p>
          </div>
          <button onClick={onSignOut}
            className="flex items-center gap-2 px-3 py-2 text-sm text-muted-foreground hover:text-foreground rounded-lg active:bg-muted/30 transition-colors">
            <LogOut className="h-4 w-4" />
            Sign out
          </button>
        </div>
        {typedUser?.email && (
          <p className="text-xs text-muted-foreground/60">{typedUser.email}</p>
        )}
      </div>

    </div>
  );
}
