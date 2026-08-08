// Sign-up nudge modal for guests who hit the daily prompt cap or try an
// account-only mode (Code / Research). Extracted verbatim from Portal.tsx —
// GuestPortal is its only consumer.

import { motion } from "framer-motion";
import { Lock, Sparkles } from "lucide-react";

export interface SignUpPromptModalProps {
  reason: "limit" | "mode";
  onClose: () => void;
  onSignUp: () => void;
  pendingMessage?: string;
}

export default function SignUpPromptModal({
  reason,
  onClose,
  onSignUp,
  pendingMessage,
}: SignUpPromptModalProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-background/80 backdrop-blur-sm" onClick={onClose} />
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 10 }}
        transition={{ duration: 0.2 }}
        className="relative z-10 bg-card border border-border rounded-2xl shadow-2xl w-full max-w-sm p-6 text-center"
      >
        <div className="w-14 h-14 rounded-2xl bg-primary/15 border border-primary/30 flex items-center justify-center mx-auto mb-4">
          {reason === "limit" ? <Sparkles className="h-7 w-7 text-primary" /> : <Lock className="h-7 w-7 text-primary" />}
        </div>
        <h3 className="text-xl font-bold text-foreground mb-2">Sign in to continue</h3>
        <p className="text-sm text-muted-foreground mb-1">
          {reason === "mode" ? "Code and Research modes require an account." : "You've used your free prompts. Sign up to keep going — it's free."}
        </p>
        <p className="text-xs text-muted-foreground/60 mb-5">Your conversation is saved and will transfer to your account.</p>
        {pendingMessage && (
          <div className="mb-4 px-3 py-2 bg-muted/30 border border-border rounded-xl text-xs text-muted-foreground text-left line-clamp-2">
            <span className="text-foreground/60 font-bold">Your message: </span>{pendingMessage}
          </div>
        )}
        {/* One CTA — /auth handles both sign-up and sign-in, so two buttons
            wired to the same handler only made users pick a meaningless choice. */}
        <button
          onClick={onSignUp}
          className="w-full py-3 bg-primary text-primary-foreground rounded-xl font-bold text-sm hover:bg-primary/90 transition-all flex items-center justify-center gap-2 mb-3"
        >
          <Sparkles className="h-4 w-4" />
          Sign up or sign in — it's free
        </button>
        <button onClick={onClose} className="w-full py-2 text-xs text-muted-foreground hover:text-foreground transition-colors">
          Maybe later
        </button>
      </motion.div>
    </div>
  );
}
