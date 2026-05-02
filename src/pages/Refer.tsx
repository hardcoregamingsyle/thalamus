import { motion } from "framer-motion";
import { useNavigate } from "react-router";
import { useAuth } from "@/hooks/use-auth";
import { Gift, Copy, Share2, Users, Zap, ArrowLeft, CheckCircle } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

export default function ReferPage() {
  const { user, isLoading, isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const [copied, setCopied] = useState(false);

  const typedUser = user as { email?: string } | null;
  const referCode = typedUser?.email
    ? `THAL-${typedUser.email.split("@")[0].toUpperCase().slice(0, 8)}`
    : "THAL-XXXXXX";

  const referLink = `${window.location.origin}/auth?ref=${referCode}`;

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      toast.success("Copied to clipboard!");
      setTimeout(() => setCopied(false), 2000);
    });
  };

  if (isLoading) return null;
  if (!isAuthenticated) { navigate("/auth"); return null; }

  return (
    <div className="min-h-screen bg-background font-mono flex flex-col">
      {/* Background grid */}
      <div className="fixed inset-0 opacity-[0.03] pointer-events-none" style={{
        backgroundImage: "linear-gradient(oklch(0.60 0.22 25) 1px, transparent 1px), linear-gradient(90deg, oklch(0.60 0.22 25) 1px, transparent 1px)",
        backgroundSize: "60px 60px",
      }} />

      {/* Nav */}
      <nav className="relative z-10 border-b border-border px-6 h-14 flex items-center gap-3">
        <button onClick={() => navigate(-1)} className="text-muted-foreground hover:text-primary transition-colors p-1.5 rounded hover:bg-primary/10">
          <ArrowLeft className="h-4 w-4" />
        </button>
        <div className="flex items-center gap-2">
          <Zap className="h-4 w-4 text-amber-400" />
          <span className="text-primary font-bold text-sm tracking-widest">REFER & EARN</span>
        </div>
      </nav>

      <div className="relative z-10 flex-1 flex items-center justify-center p-6">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="w-full max-w-lg space-y-6"
        >
          {/* Hero */}
          <div className="text-center space-y-3">
            <motion.div
              animate={{ scale: [1, 1.05, 1] }}
              transition={{ duration: 2, repeat: Infinity }}
              className="w-16 h-16 rounded-2xl bg-amber-400/10 border border-amber-400/30 flex items-center justify-center mx-auto"
            >
              <Gift className="h-8 w-8 text-amber-400" />
            </motion.div>
            <h1 className="text-2xl font-bold text-foreground">Refer & Earn AgentBucks</h1>
            <p className="text-sm text-muted-foreground">
              Share Thalamus AI with friends. When they sign up and use the platform, you both earn AgentBucks.
            </p>
          </div>

          {/* How it works */}
          <div className="border border-border bg-card rounded-2xl p-5 space-y-4">
            <p className="text-xs font-bold text-muted-foreground tracking-widest">HOW IT WORKS</p>
            <div className="space-y-3">
              {[
                { icon: Share2, step: "01", title: "Share your referral link", desc: "Send your unique link to friends" },
                { icon: Users, step: "02", title: "Friend signs up", desc: "They create an account using your link" },
                { icon: Zap, step: "03", title: "Both earn AgentBucks", desc: "You get 50,000 AB, they get 25,000 AB" },
              ].map(({ icon: Icon, step, title, desc }) => (
                <div key={step} className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-lg bg-primary/10 border border-primary/30 flex items-center justify-center shrink-0">
                    <Icon className="h-3.5 w-3.5 text-primary" />
                  </div>
                  <div>
                    <p className="text-xs font-bold text-foreground">{step}. {title}</p>
                    <p className="text-[11px] text-muted-foreground">{desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Referral code */}
          <div className="border border-amber-400/30 bg-amber-400/5 rounded-2xl p-5 space-y-3">
            <p className="text-xs font-bold text-amber-400 tracking-widest">YOUR REFERRAL CODE</p>
            <div className="flex items-center gap-2">
              <div className="flex-1 bg-background border border-border rounded-xl px-4 py-3 font-mono text-sm text-foreground font-bold tracking-widest">
                {referCode}
              </div>
              <button
                onClick={() => handleCopy(referCode)}
                className="p-3 bg-amber-400/10 border border-amber-400/30 text-amber-400 rounded-xl hover:bg-amber-400/20 transition-all"
              >
                {copied ? <CheckCircle className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              </button>
            </div>
          </div>

          {/* Referral link */}
          <div className="border border-border bg-card rounded-2xl p-5 space-y-3">
            <p className="text-xs font-bold text-muted-foreground tracking-widest">YOUR REFERRAL LINK</p>
            <div className="flex items-center gap-2">
              <div className="flex-1 bg-background border border-border rounded-xl px-3 py-2.5 text-[11px] text-muted-foreground font-mono truncate">
                {referLink}
              </div>
              <button
                onClick={() => handleCopy(referLink)}
                className="p-2.5 bg-primary/10 border border-primary/30 text-primary rounded-xl hover:bg-primary/20 transition-all"
              >
                {copied ? <CheckCircle className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              </button>
            </div>
            <button
              onClick={() => {
                if (navigator.share) {
                  navigator.share({ title: "Thalamus AI", text: "Try Thalamus AI — the world's first L4.5 agent!", url: referLink });
                } else {
                  handleCopy(referLink);
                }
              }}
              className="w-full flex items-center justify-center gap-2 bg-primary text-primary-foreground px-4 py-2.5 rounded-xl text-sm font-bold hover:bg-primary/90 transition-all"
            >
              <Share2 className="h-4 w-4" />
              Share Link
            </button>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
