// ProviderE keys tab — manage the pooled API-key list for the embedding /
// legacy-fallback provider; keys rotate on 429/403 at runtime.
// Drives api.admin.getProviderEKeys and api.admin.saveProviderEKeys.

import { useState } from "react";
import { motion } from "framer-motion";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { toast } from "sonner";
import { CheckCircle, AlertCircle, Check, Loader2 } from "lucide-react";
import { errMsg } from "@/lib/errorMessage";
import { useProviderMeta } from "./shared";

export function ProviderEKeysTab({ adminToken }: { adminToken: string }) {
  const meta = useProviderMeta(adminToken, "providerE");
  const existing = useQuery(api.admin.getProviderEKeys, { adminToken });
  const saveKeys = useMutation(api.admin.saveProviderEKeys);
  const [keysText, setKeysText] = useState("");
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    const newKeys = keysText
      .split(/[\n,]+/)
      .map(k => k.trim())
      .filter(k => k.startsWith(meta.keyPrefix ?? "") && k.length > 20);
    if (newKeys.length === 0) {
      toast.error("No valid API keys found.");
      return;
    }
    setSaving(true);
    try {
      await saveKeys({ adminToken, keys: newKeys, append: true });
      toast.success(`Added ${newKeys.length} keys`);
      setKeysText("");
    } catch (err) {
      toast.error(errMsg(err, "Failed to save"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-2xl">
      <div className="mb-6">
        <h2 className="text-xl font-bold text-foreground">{meta.title}</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Keys are stored securely in the database — never in source code or git.
        </p>
      </div>

      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className={`mb-6 p-4 rounded-xl border ${existing && existing.count > 0 ? "bg-emerald-400/10 border-emerald-400/30" : "bg-amber-400/10 border-amber-400/30"}`}
      >
        <div className="flex items-center gap-2">
          {existing && existing.count > 0 ? (
            <>
              <CheckCircle className="h-4 w-4 text-emerald-400" />
              <span className="text-sm font-bold text-emerald-400">{existing.count} keys configured</span>
            </>
          ) : (
            <>
              <AlertCircle className="h-4 w-4 text-amber-400" />
              <span className="text-sm font-bold text-amber-400">{meta.emptyWarning ?? "No keys set"}</span>
            </>
          )}
        </div>
        {existing && existing.count > 0 && (
          <div className="mt-2 space-y-1 text-xs text-muted-foreground">
            <p>Last updated: <span className="text-foreground">{existing.updatedAt ? new Date(existing.updatedAt).toLocaleString() : "—"}</span></p>
            <div className="mt-2 flex flex-wrap gap-1">
              {existing.maskedKeys.slice(0, 6).map((k: string, i: number) => (
                <span key={i} className="font-mono bg-muted/50 border border-border rounded px-1.5 py-0.5 text-[10px]">{k}</span>
              ))}
              {existing.maskedKeys.length > 6 && (
                <span className="text-[10px] text-muted-foreground">+{existing.maskedKeys.length - 6} more</span>
              )}
            </div>
          </div>
        )}
      </motion.div>

      <div className="bg-card border border-border rounded-xl p-6 space-y-4">
        <h3 className="text-sm font-bold text-foreground">Add Keys (appends to existing)</h3>
        <div>
          <label className="text-xs font-bold text-muted-foreground mb-1.5 block">
            PASTE KEYS (one per line, or comma-separated)
          </label>
          <textarea
            value={keysText}
            onChange={e => setKeysText(e.target.value)}
            placeholder={meta.keyPlaceholder ?? "one key per line"}
            rows={8}
            className="w-full bg-background border border-border rounded-xl px-3 py-2.5 text-xs font-mono text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/60 transition-colors resize-none"
          />
          <p className="text-[10px] text-muted-foreground mt-1">
            This will <strong>replace</strong> all existing keys. Paste all keys you want active.
          </p>
        </div>

        <button
          onClick={handleSave}
          disabled={saving || !keysText.trim()}
          className="w-full py-2.5 bg-primary text-primary-foreground rounded-xl text-sm font-bold hover:bg-primary/90 disabled:opacity-50 transition-all flex items-center justify-center gap-2"
        >
          {saving ? <><Loader2 className="h-4 w-4 animate-spin" />Saving...</> : <><Check className="h-4 w-4" />Save Keys</>}
        </button>

        <div className="p-3 bg-muted/30 border border-border rounded-xl">
          <p className="text-xs font-bold text-muted-foreground mb-1">HOW IT WORKS</p>
          <ul className="text-xs text-muted-foreground space-y-1 list-disc list-inside">
            <li>Keys are stored encrypted in Convex DB — never in source code</li>
            <li>Code reads keys from DB at runtime — no env vars needed</li>
            <li>Add new keys here anytime without touching code or git</li>
            <li>Keys rotate automatically on 429/403 errors</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
