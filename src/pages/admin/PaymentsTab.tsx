// Payments tab — Buy Me a Coffee configuration and AB-per-rupee rate. The
// webhook keeps crediting completed payments regardless of the master switch.
// Drives api.payments.getPaymentsConfig and api.payments.savePaymentsConfig.

import { useState, useEffect } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { toast } from "sonner";
import { Eye, EyeOff, Check, Loader2 } from "lucide-react";
import { errMsg } from "@/lib/errorMessage";

export function PaymentsTab({ adminToken }: { adminToken: string }) {
  const existing = useQuery(api.payments.getPaymentsConfig, { adminToken });
  const saveConfig = useMutation(api.payments.savePaymentsConfig);
  const [isEnabled, setIsEnabled] = useState(false);
  const [bmacPageUrl, setBmacPageUrl] = useState("");
  const [webhookSecret, setWebhookSecret] = useState("");
  const [abPerCent, setAbPerCent] = useState("15000");
  const [saving, setSaving] = useState(false);
  const [showSecret, setShowSecret] = useState(false);

  useEffect(() => {
    if (existing) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- seeds the editable payments form from the DB once it loads; the form is also user-editable so it cannot be derived during render
      setIsEnabled(existing.isEnabled ?? false);
      setBmacPageUrl(existing.bmacPageUrl ?? "");
      setWebhookSecret(existing.webhookSecret ?? "");
      setAbPerCent(String(existing.abPerCent ?? 15000));
    }
  }, [existing]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const rate = Number(abPerCent);
      await saveConfig({
        adminToken,
        isEnabled,
        bmacPageUrl,
        webhookSecret: webhookSecret || undefined,
        abPerCent: Number.isFinite(rate) && rate > 0 ? rate : undefined,
      });
      toast.success("Payments config saved");
    } catch (e) { toast.error(errMsg(e, "Save failed")); }
    finally { setSaving(false); }
  };

  const webhookUrl = `${(import.meta.env.VITE_CONVEX_URL as string ?? "").replace(".convex.cloud", ".convex.site")}/bmac/webhook`;

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h2 className="text-lg font-bold text-foreground">Payments (Buy Me a Coffee)</h2>
        <p className="text-sm text-muted-foreground mt-1">Purchases stay hidden from users until enabled here. The webhook keeps crediting completed payments regardless of the switch.</p>
      </div>
      <div className="bg-card border border-border rounded-xl p-6 space-y-5">
        <div className="flex items-center justify-between">
          <div><p className="text-sm font-semibold text-foreground">Purchases Enabled</p><p className="text-xs text-muted-foreground">Master switch for the buy-credits UI</p></div>
          <button onClick={() => setIsEnabled(v => !v)} className={`relative w-10 h-5 rounded-full transition-all ${isEnabled ? "bg-primary" : "bg-muted"}`}>
            <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${isEnabled ? "left-5" : "left-0.5"}`} />
          </button>
        </div>
        <div>
          <label className="text-xs font-bold text-muted-foreground mb-1.5 block">BMAC PAGE URL</label>
          <input value={bmacPageUrl} onChange={e => setBmacPageUrl(e.target.value)} placeholder="https://buymeacoffee.com/yourname"
            className="w-full bg-background border border-border rounded-xl px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/60 transition-colors" />
        </div>
        <div>
          <label className="text-xs font-bold text-muted-foreground mb-1.5 block">WEBHOOK SECRET</label>
          <div className="relative">
            <input type={showSecret ? "text" : "password"} value={webhookSecret} onChange={e => setWebhookSecret(e.target.value)} placeholder="From BMAC → Settings → Developers → Webhooks"
              className="w-full bg-background border border-border rounded-xl px-3 py-2.5 pr-10 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/60 transition-colors" />
            <button
              onClick={() => setShowSecret(v => !v)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
              aria-label={showSecret ? "Hide webhook secret" : "Show webhook secret"}
            >
              {showSecret ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
          <p className="text-[11px] text-muted-foreground mt-1.5">Point the BMAC webhook at: <span className="font-mono text-foreground">{webhookUrl}</span></p>
        </div>
        <div>
          <label className="text-xs font-bold text-muted-foreground mb-1.5 block">AGENTBUCKS PER ₹1</label>
          <input value={abPerCent} onChange={e => setAbPerCent(e.target.value)} inputMode="numeric"
            className="w-full bg-background border border-border rounded-xl px-3 py-2.5 text-sm font-mono text-foreground focus:outline-none focus:border-primary/60 transition-colors" />
          <p className="text-[11px] text-muted-foreground mt-1.5">Default 15,000 (₹100 = $1 = 1.5M AB). Applies to all future payments.</p>
        </div>
        <button onClick={handleSave} disabled={saving}
          className="w-full py-2.5 bg-primary text-primary-foreground rounded-xl text-sm font-bold hover:bg-primary/90 disabled:opacity-50 transition-all flex items-center justify-center gap-2">
          {saving ? <><Loader2 className="h-4 w-4 animate-spin" />Saving…</> : <><Check className="h-4 w-4" />Save Config</>}
        </button>
      </div>
      <div className="bg-muted/30 border border-border rounded-xl p-4 text-xs text-muted-foreground">
        Payments are matched to accounts by the buyer's email. Mismatches are stored as "unclaimed" in the payments table and can be resolved later.
      </div>
    </div>
  );
}
