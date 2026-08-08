// ProviderB keys tab — pooled backup-provider API keys, appended one paste at
// a time; masking is CSS-only to avoid overwriting the real key with asterisks.
// Drives api.admin.getProviderBKeys and api.admin.saveProviderBKeys.

import { useState } from "react";
import { motion } from "framer-motion";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { toast } from "sonner";
import { CheckCircle, AlertCircle, Eye, EyeOff, Check, Loader2 } from "lucide-react";
import { errMsg } from "@/lib/errorMessage";
import { useProviderMeta } from "./shared";

export function ProviderBKeysTab({ adminToken }: { adminToken: string }) {
  const meta = useProviderMeta(adminToken, "providerB");
  const existing = useQuery(api.admin.getProviderBKeys, { adminToken });
  const saveKeys = useMutation(api.admin.saveProviderBKeys);
  const [keysText, setKeysText] = useState("");
  const [saving, setSaving] = useState(false);
  const [showKey, setShowKey] = useState(false);

  const handleSave = async () => {
    const newKeys = keysText.split(/[\n,]+/).map(k => k.trim()).filter(k => k.length > 10);
    if (newKeys.length === 0) { toast.error("No valid API keys found."); return; }
    setSaving(true);
    try { await saveKeys({ adminToken, keys: newKeys, append: true }); toast.success(`Added ${newKeys.length} keys`); setKeysText(""); }
    catch (err) { toast.error(errMsg(err, "Failed to save")); }
    finally { setSaving(false); }
  };

  return (
    <div className="max-w-2xl">
      <div className="mb-6">
        <h2 className="text-xl font-bold text-foreground">{meta.title}</h2>
        <p className="text-sm text-muted-foreground mt-1">{meta.subtitle}</p>
      </div>
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
        className={`mb-6 p-4 rounded-xl border ${existing && existing.count > 0 ? "bg-blue-400/10 border-blue-400/30" : "bg-muted/10 border-border"}`}>
        <div className="flex items-center gap-2">
          {existing && existing.count > 0 ? (
            <><CheckCircle className="h-4 w-4 text-blue-400" /><span className="text-sm font-bold text-blue-400">{existing.count} {meta.readyLabel ?? "keys active"}</span></>) : (
            <><AlertCircle className="h-4 w-4 text-muted-foreground" /><span className="text-sm font-bold text-muted-foreground">No keys set — only NIM will be used</span></>)}
        </div>
        {existing && existing.count > 0 && (
          <div className="mt-2 space-y-1 text-xs text-muted-foreground">
            <p>Last updated: <span className="text-foreground">{existing.updatedAt ? new Date(existing.updatedAt).toLocaleString() : "—"}</span></p>
            <div className="mt-2 flex flex-wrap gap-1">
              {existing.maskedKeys.slice(0, 6).map((k: string, i: number) => <span key={i} className="font-mono bg-muted/50 border border-border rounded px-1.5 py-0.5 text-[10px]">{k}</span>)}
              {existing.maskedKeys.length > 6 && <span className="text-[10px] text-muted-foreground">+{existing.maskedKeys.length - 6} more</span>}
            </div>
          </div>
        )}
      </motion.div>
      <div className="bg-card border border-border rounded-xl p-6 space-y-4">
        <h3 className="text-sm font-bold text-foreground">Add Keys</h3>
        <div>
          <label className="text-xs font-bold text-muted-foreground mb-1.5 block">PASTE API KEYS (one per line)</label>
          {/* Masking is CSS-only. Rewriting `value` with asterisks fed the
              asterisks back into state on the next keystroke and destroyed the
              real key as the admin typed it — saving "**********" to the DB. */}
          <textarea value={keysText} onChange={e => setKeysText(e.target.value)}
            placeholder={"one key per line"} rows={8}
            style={showKey ? undefined : ({ WebkitTextSecurity: "disc" } as React.CSSProperties)}
            className="w-full bg-background border border-border rounded-xl px-3 py-2.5 text-xs font-mono text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/60 transition-colors resize-none" />
          <button onClick={() => setShowKey(v => !v)} className="text-[10px] text-muted-foreground hover:text-foreground mt-1.5 flex items-center gap-1">
            {showKey ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}{showKey ? "hide keys" : "show keys"}
          </button>
        </div>
        <button onClick={handleSave} disabled={saving || !keysText.trim()}
          className="w-full py-2.5 bg-primary text-primary-foreground rounded-xl text-sm font-bold hover:bg-primary/90 disabled:opacity-50 transition-all flex items-center justify-center gap-2">
          {saving ? <><Loader2 className="h-4 w-4 animate-spin" />Saving...</> : <><Check className="h-4 w-4" />Save Keys</>}
        </button>
        <div className="p-3 bg-muted/30 border border-border rounded-xl text-xs text-muted-foreground">
          <p className="font-bold mb-1">BACKUP PROVIDER</p>
          <ul className="space-y-1 list-disc list-inside">
            {meta.help.map((line, i) => <li key={i}>{line}</li>)}
            <li>Env-var keys in the Convex dashboard are also checked</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
