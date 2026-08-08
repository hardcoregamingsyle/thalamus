// ProviderC endpoints tab — self-hosted endpoint rows, each with an optional
// key, one starred as primary. Adding a new self-hosted model later is a row
// here — no redeploy.
// Drives api.admin.listProviderCEndpoints, api.admin.addProviderCEndpoint,
// api.admin.setProviderCEndpointPrimary, api.admin.setProviderCEndpointEnabled
// and api.admin.deleteProviderCEndpoint.

import { useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { toast } from "sonner";
import { Star, Eye, EyeOff, Trash2, Plus, Loader2 } from "lucide-react";
import { errMsg } from "@/lib/errorMessage";
import { useProviderMeta } from "./shared";

// The row shape is spelled out rather than inferred: listProviderCEndpoints returns
// a masked projection (maskedKey, never apiKey), and this file's api type sits
// at TypeScript's instantiation-depth cliff, so the inferred element goes `any`.
type ModalEndpointRow = {
  _id: Id<"modalEndpoints">;
  name: string;
  baseUrl: string;
  modelId: string;
  maskedKey: string | null;
  isPrimary: boolean;
  isEnabled: boolean;
  createdAt: number;
};

export function ProviderCEndpointsTab({ adminToken }: { adminToken: string }) {
  const meta = useProviderMeta(adminToken, "providerC");
  const endpoints = useQuery(api.admin.listProviderCEndpoints, { adminToken });
  const addEndpoint = useMutation(api.admin.addProviderCEndpoint);
  const setPrimary = useMutation(api.admin.setProviderCEndpointPrimary);
  const setEnabled = useMutation(api.admin.setProviderCEndpointEnabled);
  const deleteEndpoint = useMutation(api.admin.deleteProviderCEndpoint);

  const [name, setName] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [modelId, setModelId] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [saving, setSaving] = useState(false);

  const handleAdd = async () => {
    if (!name.trim() || !baseUrl.trim() || !modelId.trim()) {
      toast.error("Name, base URL and model ID are required");
      return;
    }
    setSaving(true);
    try {
      await addEndpoint({
        adminToken,
        name: name.trim(),
        baseUrl: baseUrl.trim(),
        modelId: modelId.trim(),
        apiKey: apiKey.trim() || undefined,
      });
      toast.success("Endpoint added");
      setName(""); setBaseUrl(""); setModelId(""); setApiKey("");
    } catch (e) { toast.error(errMsg(e, "Failed to add")); }
    finally { setSaving(false); }
  };

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h2 className="text-lg font-bold text-foreground">{meta.title}</h2>
        <p className="text-sm text-muted-foreground mt-1">{meta.subtitle}</p>
      </div>

      <div className="bg-card border border-border rounded-xl p-6 space-y-4">
        <p className="text-xs font-bold text-muted-foreground">ADD ENDPOINT</p>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-[11px] text-muted-foreground mb-1 block">NAME</label>
            <input value={name} onChange={e => setName(e.target.value)} placeholder={meta.namePlaceholder ?? "endpoint name"}
              className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:border-primary/60" />
          </div>
          <div>
            <label className="text-[11px] text-muted-foreground mb-1 block">MODEL ID</label>
            <input value={modelId} onChange={e => setModelId(e.target.value)} placeholder={meta.modelPlaceholder ?? "model id"}
              className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:border-primary/60" />
          </div>
        </div>
        <div>
          <label className="text-[11px] text-muted-foreground mb-1 block">BASE URL</label>
          <input value={baseUrl} onChange={e => setBaseUrl(e.target.value)} placeholder="https://your-endpoint.example.com"
            className="w-full bg-background border border-border rounded-lg px-3 py-2 text-xs font-mono text-foreground focus:outline-none focus:border-primary/60" />
          <p className="text-[11px] text-muted-foreground mt-1">Without the trailing <code>/v1</code> — it gets appended.</p>
        </div>
        <div>
          <label className="text-[11px] text-muted-foreground mb-1 block">API KEY (OPTIONAL)</label>
          <input type="password" value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder="Leave blank for keyless endpoints"
            className="w-full bg-background border border-border rounded-lg px-3 py-2 text-xs font-mono text-foreground focus:outline-none focus:border-primary/60" />
        </div>
        <button onClick={() => void handleAdd()} disabled={saving}
          className="w-full flex items-center justify-center gap-2 bg-primary text-primary-foreground rounded-lg px-4 py-2 text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Plus className="h-4 w-4" /> Add Endpoint</>}
        </button>
      </div>

      <div className="bg-card border border-border rounded-xl p-6">
        <p className="text-xs font-bold text-muted-foreground mb-3">REGISTERED ({endpoints?.length ?? 0})</p>
        {!endpoints || endpoints.length === 0 ? (
          <p className="text-sm text-muted-foreground">{meta.emptyHint ?? "No endpoints yet."}</p>
        ) : (
          <div className="space-y-2">
            {(endpoints as ModalEndpointRow[]).map((ep: ModalEndpointRow) => (
              <div key={ep._id} className={`flex items-center gap-3 p-3 rounded-lg border ${ep.isPrimary ? "border-primary/50 bg-primary/5" : "border-border"} ${ep.isEnabled ? "" : "opacity-50"}`}>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-foreground truncate">{ep.name}</span>
                    {ep.isPrimary && <span className="text-[10px] font-bold text-primary border border-primary/40 rounded px-1.5 py-0.5">PRIMARY</span>}
                  </div>
                  <p className="text-xs text-muted-foreground truncate">{ep.modelId} · {ep.baseUrl}</p>
                  {ep.maskedKey && <p className="text-[11px] text-muted-foreground">key {ep.maskedKey}</p>}
                </div>
                <button
                  title={ep.isPrimary ? "Already primary" : "Make primary"}
                  aria-label={ep.isPrimary ? "Already primary endpoint" : "Set endpoint as primary"}
                  onClick={() => void setPrimary({ adminToken, id: ep._id }).then(() => toast.success(`${ep.name} is now primary`))}
                  className="p-2 rounded-md hover:bg-secondary transition-colors"
                >
                  <Star className={`h-4 w-4 ${ep.isPrimary ? "fill-primary text-primary" : "text-muted-foreground"}`} />
                </button>
                <button
                  title={ep.isEnabled ? "Disable" : "Enable"}
                  aria-label={ep.isEnabled ? "Disable endpoint" : "Enable endpoint"}
                  onClick={() => void setEnabled({ adminToken, id: ep._id, isEnabled: !ep.isEnabled })}
                  className="p-2 rounded-md hover:bg-secondary transition-colors"
                >
                  {ep.isEnabled ? <Eye className="h-4 w-4 text-muted-foreground" /> : <EyeOff className="h-4 w-4 text-muted-foreground" />}
                </button>
                <button
                  title="Delete"
                  aria-label="Delete endpoint"
                  onClick={() => void deleteEndpoint({ adminToken, id: ep._id })}
                  className="p-2 rounded-md hover:bg-destructive/10 transition-colors"
                >
                  <Trash2 className="h-4 w-4 text-destructive" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
