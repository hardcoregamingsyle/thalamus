import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Zap, Gift, Tag, MessageCircle, Mail, ExternalLink, ChevronRight } from "lucide-react";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";

// Credit packs — price in ₹ ($1 = ₹100)
const CREDIT_PACKS = [
  { name: "Starter", ab: 1_500_000, usd: 1, inr: 100, desc: "1M AB — great for trying out" },
  { name: "Builder", ab: 7_500_000, usd: 5, inr: 500, desc: "7.5M AB — for regular builders", popular: true },
  { name: "Pro", ab: 16_500_000, usd: 11, inr: 1100, desc: "16.5M AB — 10% bonus included" },
  { name: "Studio", ab: 45_000_000, usd: 30, inr: 3000, desc: "45M AB — for power users" },
];

interface CreditModalProps {
  open: boolean;
  onClose: () => void;
  totalAB: number;
  dailyAB: number;
  purchasedAB: number;
}

function BuyCreditsModal({ onClose }: { onClose: () => void }) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-5"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Zap className="h-4 w-4 text-amber-400" />
          <span className="text-sm font-bold text-foreground">Contact to Buy Credits</span>
        </div>
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors p-1 rounded hover:bg-muted/50">
          <X className="h-4 w-4" />
        </button>
      </div>

      <p className="text-xs text-muted-foreground leading-relaxed">
        To purchase AgentBucks, contact the owner directly via WhatsApp or email. Payments are processed manually and credits are added within minutes.
      </p>

      <div className="space-y-3">
        <a
          href="https://wa.me/917009205057"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-3 p-4 bg-green-400/10 border border-green-400/30 rounded-xl hover:bg-green-400/20 transition-all group"
        >
          <div className="w-10 h-10 rounded-xl bg-green-400/20 flex items-center justify-center shrink-0">
            <MessageCircle className="h-5 w-5 text-green-400" />
          </div>
          <div className="flex-1">
            <p className="text-sm font-bold text-green-400">WhatsApp</p>
            <p className="text-[11px] text-muted-foreground">+91 7009205057</p>
          </div>
          <ExternalLink className="h-3.5 w-3.5 text-green-400/60 group-hover:text-green-400 transition-colors" />
        </a>

        <a
          href="mailto:hardcorgamingstyle@gmail.com?subject=Thalamus AI - Buy AgentBucks"
          className="flex items-center gap-3 p-4 bg-primary/10 border border-primary/30 rounded-xl hover:bg-primary/20 transition-all group"
        >
          <div className="w-10 h-10 rounded-xl bg-primary/20 flex items-center justify-center shrink-0">
            <Mail className="h-5 w-5 text-primary" />
          </div>
          <div className="flex-1">
            <p className="text-sm font-bold text-primary">Email</p>
            <p className="text-[11px] text-muted-foreground">hardcorgamingstyle@gmail.com</p>
          </div>
          <ExternalLink className="h-3.5 w-3.5 text-primary/60 group-hover:text-primary transition-colors" />
        </a>
      </div>

      <p className="text-[10px] text-muted-foreground text-center">
        Mention your account email and the credit pack you want.
      </p>
    </motion.div>
  );
}

interface CreditModalPropsExtended extends CreditModalProps {
  token?: string;
}

export default function CreditModal({ open, onClose, totalAB, dailyAB, purchasedAB, token }: CreditModalPropsExtended) {
  const navigate = useNavigate();
  const [promoCode, setPromoCode] = useState("");
  const [showBuyModal, setShowBuyModal] = useState(false);
  const [selectedPack, setSelectedPack] = useState<typeof CREDIT_PACKS[0] | null>(null);
  const [isApplyingPromo, setIsApplyingPromo] = useState(false);
  const applyPromoMutation = useMutation(api.customAuthHelpers.applyPromoCode);

  const handlePromoSubmit = async () => {
    if (!promoCode.trim() || !token) return;
    setIsApplyingPromo(true);
    try {
      const result = await applyPromoMutation({ token, code: promoCode.trim() });
      if (result.success) {
        toast.success(result.message);
        setPromoCode("");
      } else {
        toast.error(result.message);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to apply promo code");
    } finally {
      setIsApplyingPromo(false);
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={showBuyModal ? () => setShowBuyModal(false) : onClose}
            className="absolute inset-0 bg-background/80 backdrop-blur-sm"
          />

          {/* Buy Credits sub-modal */}
          <AnimatePresence>
            {showBuyModal && (
              <div className="relative z-10">
                <BuyCreditsModal
                  onClose={() => setShowBuyModal(false)}
                />
              </div>
            )}
          </AnimatePresence>

          {/* Main modal */}
          {!showBuyModal && (
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              className="relative z-10 bg-card border border-border rounded-2xl shadow-2xl w-full max-w-md overflow-hidden"
            >
              {/* Header */}
              <div className="flex items-center justify-between px-5 py-4 border-b border-border">
                <div className="flex items-center gap-2">
                  <Zap className="h-4 w-4 text-amber-400" />
                  <span className="text-sm font-bold text-foreground">AgentBucks Wallet</span>
                </div>
                <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors p-1 rounded hover:bg-muted/50">
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="p-5 space-y-5">
                {/* Balance display */}
                <div className="bg-amber-400/5 border border-amber-400/20 rounded-xl p-4">
                  <p className="text-[10px] text-amber-400/70 font-bold tracking-widest mb-2">CURRENT BALANCE</p>
                  <div className="flex items-end gap-2">
                    <span className="text-2xl font-bold text-amber-400">{totalAB.toLocaleString()}</span>
                    <span className="text-sm text-amber-400/70 mb-0.5">AB</span>
                  </div>
                  <div className="flex gap-4 mt-2">
                    <div>
                      <p className="text-[10px] text-muted-foreground">Daily</p>
                      <p className="text-xs font-bold text-foreground">{dailyAB.toLocaleString()} AB</p>
                    </div>
                    <div>
                      <p className="text-[10px] text-muted-foreground">Purchased</p>
                      <p className="text-xs font-bold text-foreground">{purchasedAB.toLocaleString()} AB</p>
                    </div>
                  </div>
                </div>

                {/* Buy Credits */}
                <div className="space-y-2">
                  <p className="text-[10px] font-bold text-muted-foreground tracking-widest">BUY CREDITS</p>
                  <div className="grid grid-cols-2 gap-2">
                    {CREDIT_PACKS.map(pack => (
                      <button
                        key={pack.name}
                        onClick={() => { setSelectedPack(pack); setShowBuyModal(true); }}
                        className={`relative text-left p-3 rounded-xl border transition-all hover:border-primary/50 hover:bg-primary/5 ${
                          pack.popular ? "border-primary/40 bg-primary/5" : "border-border bg-card"
                        }`}
                      >
                        {pack.popular && (
                          <span className="absolute -top-2 left-3 text-[9px] bg-primary text-primary-foreground px-1.5 py-0.5 rounded-full font-bold">POPULAR</span>
                        )}
                        <p className="text-xs font-bold text-foreground">{pack.name}</p>
                        <p className="text-[10px] text-muted-foreground">{(pack.ab / 1_000_000).toFixed(1)}M AB</p>
                        <div className="mt-1.5">
                          <p className="text-sm font-bold text-primary">₹{pack.inr.toLocaleString()}</p>
                          <p className="text-[9px] text-muted-foreground">${pack.usd}</p>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Refer & Earn */}
                <button
                  onClick={() => { onClose(); navigate("/refer"); }}
                  className="w-full flex items-center gap-3 p-3 bg-violet-400/10 border border-violet-400/30 rounded-xl hover:bg-violet-400/20 transition-all"
                >
                  <Gift className="h-4 w-4 text-violet-400 shrink-0" />
                  <div className="flex-1 text-left">
                    <p className="text-xs font-bold text-violet-400">Refer & Earn</p>
                    <p className="text-[10px] text-muted-foreground">Earn 50,000 AB per referral</p>
                  </div>
                  <ChevronRight className="h-3.5 w-3.5 text-violet-400/60" />
                </button>

                {/* Promo Code */}
                <div className="space-y-2">
                  <p className="text-[10px] font-bold text-muted-foreground tracking-widest flex items-center gap-1.5">
                    <Tag className="h-3 w-3" />
                    PROMO CODE
                  </p>
                  <div className="flex gap-2">
                    <input
                      value={promoCode}
                      onChange={e => setPromoCode(e.target.value.toUpperCase())}
                      onKeyDown={e => { if (e.key === "Enter") handlePromoSubmit(); }}
                      placeholder="ENTER CODE"
                      className="flex-1 bg-background border border-border rounded-xl px-3 py-2 text-xs font-mono text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/60 transition-colors uppercase"
                    />
                    <button
                      onClick={handlePromoSubmit}
                      disabled={!promoCode.trim() || isApplyingPromo}
                      className="px-4 py-2 bg-primary/10 border border-primary/30 text-primary text-xs font-bold rounded-xl hover:bg-primary/20 disabled:opacity-50 transition-all"
                    >
                      {isApplyingPromo ? "..." : "Apply"}
                    </button>
                  </div>
                </div>
              </div>
            </motion.div>
          )}
        </div>
      )}
    </AnimatePresence>
  );
}