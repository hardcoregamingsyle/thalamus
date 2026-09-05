// Analytics tab — Google Analytics 4 and Tag Manager IDs, one row per product.
// Drives api.analytics.getAnalyticsConfigAdmin and api.analytics.saveAnalyticsConfig.
//
// The IDs live here rather than in build-time env vars because both frontends
// (this app and the AgentOverflow site) read the same backend, and a property
// change should not mean rebuilding and redeploying two Cloudflare projects.

import { useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { errMsg } from "@/lib/errorMessage";

interface Field {
  ga4Id: string;
  gtmId: string;
}

const SITES = [
  { id: "thalamus", label: "Thalamus" },
  { id: "agentoverflow", label: "AgentOverflow" },
] as const;

export function AnalyticsTab({ adminToken }: { adminToken: string }) {
  const rows = useQuery(api.analytics.getAnalyticsConfigAdmin, { adminToken });
  const save = useMutation(api.analytics.saveAnalyticsConfig);
  // Edits only. Anything untouched reads straight from the server row, so there
  // is no effect copying query results into state and no window where a stale
  // copy is shown after a save.
  const [edits, setEdits] = useState<Record<string, Partial<Field>>>({});
  const [saving, setSaving] = useState<string | null>(null);

  const valueFor = (site: string, field: keyof Field): string => {
    const edited = edits[site]?.[field];
    if (edited !== undefined) return edited;
    const row = rows?.find((r) => r.site === site);
    return row?.[field] ?? "";
  };
  const setValue = (site: string, field: keyof Field, value: string) =>
    setEdits((prev) => ({ ...prev, [site]: { ...prev[site], [field]: value } }));

  const submit = async (site: string) => {
    setSaving(site);
    try {
      await save({
        adminToken,
        site,
        ga4Id: valueFor(site, "ga4Id"),
        gtmId: valueFor(site, "gtmId"),
      });
      toast.success(`Saved ${site}`);
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setSaving(null);
    }
  };

  if (!rows) {
    return <div className="flex justify-center py-12"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;
  }

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-border bg-card/60 p-4">
        <p className="text-xs leading-6 text-muted-foreground">
          Leave a field blank to keep that tag off. Set <strong>either</strong> a GA4 ID here
          <strong> or</strong> a GA4 tag inside your GTM container — configuring both counts every
          pageview twice. The consent banner shows only for UK/EU/EEA visitors; everywhere else the
          tags load on first paint.
        </p>
      </div>

      {SITES.map((site) => (
        <div key={site.id} className="rounded-xl border border-border bg-card/60 p-5">
          <h3 className="text-sm font-semibold text-foreground">{site.label}</h3>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="text-xs font-medium text-muted-foreground">GA4 measurement ID</span>
              <input
                value={valueFor(site.id, "ga4Id")}
                onChange={(e) => setValue(site.id, "ga4Id", e.target.value)}
                placeholder="G-XXXXXXXXXX"
                className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 font-mono text-sm text-foreground"
              />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-muted-foreground">GTM container ID</span>
              <input
                value={valueFor(site.id, "gtmId")}
                onChange={(e) => setValue(site.id, "gtmId", e.target.value)}
                placeholder="GTM-XXXXXXX"
                className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 font-mono text-sm text-foreground"
              />
            </label>
          </div>
          <button
            onClick={() => void submit(site.id)}
            disabled={saving === site.id}
            className="mt-4 inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-60"
          >
            {saving === site.id && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Save {site.label}
          </button>
        </div>
      ))}
    </div>
  );
}
