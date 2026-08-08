// ProviderD credentials tab — save an access-key/secret/region triple for the
// legacy-path provider whose labels come from adminMeta.
// Drives api.admin.getProviderDCredentials and api.admin.saveProviderDCredentials.

import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { toast } from "sonner";
import {
  CheckCircle, AlertCircle, Eye, EyeOff, Check, Loader2,
} from "lucide-react";
import { errMsg } from "@/lib/errorMessage";
import { useProviderMeta } from "./shared";

export function ProviderDCredentialsTab({ adminToken }: { adminToken: string }) {
  const meta = useProviderMeta(adminToken, "providerD");
  const existing = useQuery(api.admin.getProviderDCredentials, { adminToken });
  const saveCredentials = useMutation(api.admin.saveProviderDCredentials);
  const [accessKeyId, setAccessKeyId] = useState("");
  const [secretAccessKey, setSecretAccessKey] = useState("");
  const [region, setRegion] = useState<string>("ap-southeast-1");
  const [showSecret, setShowSecret] = useState(false);
  const [saving, setSaving] = useState(false);

  // Sync region from DB when credentials load
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- seeds the editable region field from the DB once credentials load; the field is also user-editable so it cannot be derived during render
    if (existing?.region) setRegion(existing.region);
  }, [existing?.region]);

  const handleSave = async () => {
    if (!accessKeyId.trim() || !secretAccessKey.trim()) {
      toast.error("Access Key ID and Secret are required");
      return;
    }
    setSaving(true);
    try {
      await saveCredentials({ adminToken, accessKeyId: accessKeyId.trim(), secretAccessKey: secretAccessKey.trim(), region: region.trim() });
      toast.success("Credentials saved");
      setAccessKeyId("");
      setSecretAccessKey("");
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
        <p className="text-sm text-muted-foreground mt-1">{meta.subtitle}</p>
      </div>

      {/* Current status */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className={`mb-6 p-4 rounded-xl border ${existing ? "bg-emerald-400/10 border-emerald-400/30" : "bg-amber-400/10 border-amber-400/30"}`}
      >
        <div className="flex items-center gap-2">
          {existing ? (
            <>
              <CheckCircle className="h-4 w-4 text-emerald-400" />
              <span className="text-sm font-bold text-emerald-400">Credentials configured</span>
            </>
          ) : (
            <>
              <AlertCircle className="h-4 w-4 text-amber-400" />
              <span className="text-sm font-bold text-amber-400">{meta.emptyWarning ?? "No credentials set"}</span>
            </>
          )}
        </div>
        {existing && (
          <div className="mt-2 space-y-1 text-xs text-muted-foreground">
            <p>Access Key ID: <span className="font-mono text-foreground">{existing.accessKeyId.slice(0, 4)}...{existing.accessKeyId.slice(-4)}</span></p>
            <p>Region: <span className="font-mono text-foreground">{existing.region}</span></p>
            <p>Last updated: <span className="text-foreground">{existing.updatedAt ? new Date(existing.updatedAt).toLocaleString() : "—"}</span></p>
          </div>
        )}
      </motion.div>

      {/* Credential form */}
      <div className="bg-card border border-border rounded-xl p-6 space-y-4">
        <h3 className="text-sm font-bold text-foreground">Update Credentials</h3>

        <div>
          <label className="text-xs font-bold text-muted-foreground mb-1.5 block">AWS ACCESS KEY ID</label>
          <input
            value={accessKeyId}
            onChange={e => setAccessKeyId(e.target.value)}
            placeholder="AKIAIOSFODNN7EXAMPLE"
            className="w-full bg-background border border-border rounded-xl px-3 py-2.5 text-sm font-mono text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/60 transition-colors"
          />
        </div>

        <div>
          <label className="text-xs font-bold text-muted-foreground mb-1.5 block">AWS SECRET ACCESS KEY</label>
          <div className="relative">
            <input
              type={showSecret ? "text" : "password"}
              value={secretAccessKey}
              onChange={e => setSecretAccessKey(e.target.value)}
              placeholder="wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY"
              className="w-full bg-background border border-border rounded-xl px-3 py-2.5 pr-10 text-sm font-mono text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/60 transition-colors"
            />
            <button
              onClick={() => setShowSecret(s => !s)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
              aria-label={showSecret ? "Hide secret access key" : "Show secret access key"}
            >
              {showSecret ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </div>

        <div>
          <label className="text-xs font-bold text-muted-foreground mb-1.5 block">AWS REGION</label>
          <select
            value={region}
            onChange={e => setRegion(e.target.value)}
            className="w-full bg-background border border-border rounded-xl px-3 py-2.5 text-sm text-foreground focus:outline-none focus:border-primary/60 transition-colors"
          >
            <option value="us-east-1">us-east-1 (N. Virginia)</option>
            <option value="us-west-2">us-west-2 (Oregon)</option>
            <option value="eu-west-1">eu-west-1 (Ireland)</option>
            <option value="eu-central-1">eu-central-1 (Frankfurt)</option>
            <option value="ap-southeast-1">ap-southeast-1 (Singapore)</option>
            <option value="ap-northeast-1">ap-northeast-1 (Tokyo)</option>
            <option value="ap-south-1">ap-south-1 (Mumbai)</option>
            <option value="ap-southeast-2">ap-southeast-2 (Sydney)</option>
          </select>
        </div>

        <button
          onClick={handleSave}
          disabled={saving || !accessKeyId.trim() || !secretAccessKey.trim()}
          className="w-full py-2.5 bg-primary text-primary-foreground rounded-xl text-sm font-bold hover:bg-primary/90 disabled:opacity-50 transition-all flex items-center justify-center gap-2"
        >
          {saving ? <><Loader2 className="h-4 w-4 animate-spin" />Saving...</> : <><Check className="h-4 w-4" />Save Credentials</>}
        </button>

        <p className="text-xs text-muted-foreground">
          {meta.regionHint ?? "Credentials are stored server-side only."}
        </p>
      </div>

      {/* IAM permissions info */}
      <div className="mt-4 bg-muted/30 border border-border rounded-xl p-4">
        <p className="text-xs font-bold text-muted-foreground mb-2">REQUIRED IAM PERMISSIONS</p>
        <pre className="text-xs text-foreground font-mono bg-background rounded-lg p-3 overflow-x-auto">{meta.iamPolicy ?? "—"}</pre>
      </div>
    </div>
  );
}
