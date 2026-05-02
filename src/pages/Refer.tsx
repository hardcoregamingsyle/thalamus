import { motion, AnimatePresence } from "framer-motion";
import { useNavigate } from "react-router";
import { useAuth } from "@/hooks/use-auth";
import { Gift, Copy, Share2, Users, Zap, ArrowLeft, CheckCircle, RotateCcw } from "lucide-react";
import { useState, useEffect, useRef } from "react";
import { toast } from "sonner";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";

// Spin wheel segments — all look equal, but actual probabilities are hidden
const WHEEL_SEGMENTS = [
  { label: "5M AB",   color: "#06b6d4", prize: 5_000_000 },
  { label: "10M AB",  color: "#8b5cf6", prize: 10_000_000 },
  { label: "20M AB",  color: "#f59e0b", prize: 20_000_000 },
  { label: "50M AB",  color: "#10b981", prize: 50_000_000 },
  { label: "100M AB", color: "#ef4444", prize: 100_000_000 },
  { label: "500M AB", color: "#f97316", prize: 500_000_000 },
  { label: "5M AB",   color: "#06b6d4", prize: 5_000_000 },
  { label: "10M AB",  color: "#8b5cf6", prize: 10_000_000 },
];

const SEGMENT_COUNT = WHEEL_SEGMENTS.length;
const SEGMENT_ANGLE = 360 / SEGMENT_COUNT;

function SpinWheel({ spinning, rotation, onSpinEnd }: { spinning: boolean; rotation: number; onSpinEnd: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const size = canvas.width;
    const center = size / 2;
    const radius = center - 4;

    ctx.clearRect(0, 0, size, size);

    // Draw segments
    for (let i = 0; i < SEGMENT_COUNT; i++) {
      const startAngle = (i * SEGMENT_ANGLE - 90) * (Math.PI / 180);
      const endAngle = ((i + 1) * SEGMENT_ANGLE - 90) * (Math.PI / 180);
      const seg = WHEEL_SEGMENTS[i];

      ctx.beginPath();
      ctx.moveTo(center, center);
      ctx.arc(center, center, radius, startAngle, endAngle);
      ctx.closePath();
      ctx.fillStyle = seg.color;
      ctx.fill();
      ctx.strokeStyle = "rgba(0,0,0,0.3)";
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // Label
      ctx.save();
      ctx.translate(center, center);
      ctx.rotate((startAngle + endAngle) / 2);
      ctx.textAlign = "right";
      ctx.fillStyle = "#fff";
      ctx.font = "bold 11px monospace";
      ctx.fillText(seg.label, radius - 10, 4);
      ctx.restore();
    }

    // Center circle
    ctx.beginPath();
    ctx.arc(center, center, 18, 0, Math.PI * 2);
    ctx.fillStyle = "#1a1a2e";
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.2)";
    ctx.lineWidth = 2;
    ctx.stroke();

    // Center dot
    ctx.beginPath();
    ctx.arc(center, center, 6, 0, Math.PI * 2);
    ctx.fillStyle = "#fff";
    ctx.fill();
  }, []);

  return (
    <div className="relative flex items-center justify-center">
      {/* Pointer */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1 z-10">
        <div className="w-0 h-0 border-l-[8px] border-r-[8px] border-t-[16px] border-l-transparent border-r-transparent border-t-foreground drop-shadow-lg" />
      </div>
      <motion.div
        animate={{ rotate: rotation }}
        transition={spinning ? { duration: 4, ease: [0.17, 0.67, 0.12, 0.99] } : { duration: 0 }}
        onAnimationComplete={onSpinEnd}
        className="rounded-full overflow-hidden shadow-2xl"
        style={{ width: 240, height: 240 }}
      >
        <canvas ref={canvasRef} width={240} height={240} />
      </motion.div>
    </div>
  );
}

export default function ReferPage() {
  const { user, isLoading, isAuthenticated, token } = useAuth();
  const navigate = useNavigate();
  const [copied, setCopied] = useState(false);
  const [spinning, setSpinning] = useState(false);
  const [rotation, setRotation] = useState(0);
  const [lastWon, setLastWon] = useState<number | null>(null);
  const [showWinModal, setShowWinModal] = useState(false);

  const referralInfo = useQuery(api.customAuthHelpers.getReferralInfo, token ? { token } : "skip");
  const ensureReferralCode = useMutation(api.customAuthHelpers.ensureReferralCode);
  const useSpinMutation = useMutation(api.customAuthHelpers.useSpin);

  // Ensure existing users have a referral code
  useEffect(() => {
    if (token && referralInfo !== undefined && !referralInfo?.referralCode) {
      ensureReferralCode({ token }).catch(() => {});
    }
  }, [token, referralInfo, ensureReferralCode]);

  const referCode = referralInfo?.referralCode ?? "......";
  const spinsAvailable = referralInfo?.referralSpins ?? 0;
  const referLink = `${window.location.origin}/auth?ref=${referCode}`;

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      toast.success("Copied to clipboard!");
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const handleSpin = async () => {
    if (spinning || spinsAvailable <= 0 || !token) return;
    setSpinning(true);
    setLastWon(null);

    try {
      const result = await useSpinMutation({ token });
      // Calculate which segment to land on based on won amount
      const segmentIndex = WHEEL_SEGMENTS.findIndex(s => s.prize === result.won);
      const targetSegment = segmentIndex >= 0 ? segmentIndex : 0;
      // Spin 5 full rotations + land on target segment
      const targetAngle = 360 * 5 + (360 - targetSegment * SEGMENT_ANGLE - SEGMENT_ANGLE / 2);
      setRotation(prev => prev + targetAngle);
      setLastWon(result.won);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Spin failed");
      setSpinning(false);
    }
  };

  const handleSpinEnd = () => {
    setSpinning(false);
    if (lastWon !== null) {
      setShowWinModal(true);
    }
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

      <div className="relative z-10 flex-1 p-6">
        <div className="max-w-2xl mx-auto space-y-6">
          {/* Hero */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-center space-y-2"
          >
            <h1 className="text-2xl font-bold text-foreground">Refer & Earn Spins</h1>
            <p className="text-sm text-muted-foreground">
              Share your referral link. Every signup earns you 1 spin on the prize wheel.
            </p>
          </motion.div>

          <div className="grid md:grid-cols-2 gap-6">
            {/* Spin Wheel */}
            <motion.div
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.1 }}
              className="border border-border bg-card rounded-2xl p-6 flex flex-col items-center gap-4"
            >
              <div className="flex items-center justify-between w-full">
                <p className="text-xs font-bold text-muted-foreground tracking-widest">PRIZE WHEEL</p>
                <div className="flex items-center gap-1.5 px-2.5 py-1 bg-amber-400/10 border border-amber-400/30 rounded-lg">
                  <RotateCcw className="h-3 w-3 text-amber-400" />
                  <span className="text-xs font-bold text-amber-400">{spinsAvailable} spin{spinsAvailable !== 1 ? "s" : ""}</span>
                </div>
              </div>

              <SpinWheel spinning={spinning} rotation={rotation} onSpinEnd={handleSpinEnd} />

              <button
                onClick={handleSpin}
                disabled={spinning || spinsAvailable <= 0}
                className="w-full flex items-center justify-center gap-2 bg-primary text-primary-foreground px-4 py-3 rounded-xl text-sm font-bold hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
              >
                {spinning ? (
                  <>
                    <motion.div animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: "linear" }}>
                      <RotateCcw className="h-4 w-4" />
                    </motion.div>
                    Spinning...
                  </>
                ) : spinsAvailable > 0 ? (
                  <>
                    <RotateCcw className="h-4 w-4" />
                    SPIN NOW
                  </>
                ) : (
                  "No Spins Available"
                )}
              </button>

              {spinsAvailable === 0 && (
                <p className="text-[11px] text-muted-foreground text-center">
                  Refer friends to earn more spins!
                </p>
              )}
            </motion.div>

            {/* Referral info */}
            <motion.div
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.15 }}
              className="space-y-4"
            >
              {/* How it works */}
              <div className="border border-border bg-card rounded-2xl p-4 space-y-3">
                <p className="text-xs font-bold text-muted-foreground tracking-widest">HOW IT WORKS</p>
                <div className="space-y-2.5">
                  {[
                    { icon: Share2, step: "01", title: "Share your link", desc: "Send your unique referral link to friends" },
                    { icon: Users, step: "02", title: "Friend signs up", desc: "They create a new account via your link" },
                    { icon: RotateCcw, step: "03", title: "Both get a spin", desc: "You get 1 spin, they get 1 free spin too" },
                  ].map(({ icon: Icon, step, title, desc }) => (
                    <div key={step} className="flex items-start gap-2.5">
                      <div className="w-7 h-7 rounded-lg bg-primary/10 border border-primary/30 flex items-center justify-center shrink-0">
                        <Icon className="h-3 w-3 text-primary" />
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
              <div className="border border-amber-400/30 bg-amber-400/5 rounded-2xl p-4 space-y-2.5">
                <p className="text-xs font-bold text-amber-400 tracking-widest">YOUR REFERRAL CODE</p>
                <div className="flex items-center gap-2">
                  <div className="flex-1 bg-background border border-border rounded-xl px-4 py-2.5 font-mono text-sm text-foreground font-bold tracking-widest">
                    {referCode}
                  </div>
                  <button
                    onClick={() => handleCopy(referCode)}
                    className="p-2.5 bg-amber-400/10 border border-amber-400/30 text-amber-400 rounded-xl hover:bg-amber-400/20 transition-all"
                  >
                    {copied ? <CheckCircle className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              {/* Referral link */}
              <div className="border border-border bg-card rounded-2xl p-4 space-y-2.5">
                <p className="text-xs font-bold text-muted-foreground tracking-widest">YOUR REFERRAL LINK</p>
                <div className="flex items-center gap-2">
                  <div className="flex-1 bg-background border border-border rounded-xl px-3 py-2 text-[11px] text-muted-foreground font-mono truncate">
                    {referLink}
                  </div>
                  <button
                    onClick={() => handleCopy(referLink)}
                    className="p-2 bg-primary/10 border border-primary/30 text-primary rounded-xl hover:bg-primary/20 transition-all"
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
      </div>

      {/* Win Modal */}
      <AnimatePresence>
        {showWinModal && lastWon !== null && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowWinModal(false)}
              className="absolute inset-0 bg-background/80 backdrop-blur-sm"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.8, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.8, y: 20 }}
              className="relative z-10 bg-card border border-amber-400/40 rounded-2xl shadow-2xl p-8 text-center max-w-sm w-full"
            >
              <motion.div
                animate={{ scale: [1, 1.2, 1], rotate: [0, 10, -10, 0] }}
                transition={{ duration: 0.6 }}
                className="text-5xl mb-4"
              >
                🎉
              </motion.div>
              <h2 className="text-xl font-bold text-foreground mb-2">You Won!</h2>
              <div className="text-3xl font-bold text-amber-400 mb-1">
                {(lastWon / 1_000_000).toFixed(0)}M AB
              </div>
              <p className="text-sm text-muted-foreground mb-6">
                {lastWon.toLocaleString()} AgentBucks added to your account!
              </p>
              <button
                onClick={() => setShowWinModal(false)}
                className="w-full bg-primary text-primary-foreground px-4 py-2.5 rounded-xl text-sm font-bold hover:bg-primary/90 transition-all"
              >
                Awesome! 🚀
              </button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}