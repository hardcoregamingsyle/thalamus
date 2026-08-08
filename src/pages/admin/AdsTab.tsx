// Ads tab (Gravity) — Gravity publisher config, per-audience toggles, account
// status probe. The shipped .exe calls gravityAds:requestAd by string, so the
// module name is load-bearing.
// Drives api.gravityAds.getGravityAdsConfig, api.gravityAds.saveGravityAdsConfig
// and api.gravityAds.checkGravityStatus.

import { useState, useEffect } from "react";
import { useQuery, useMutation, useAction } from "convex/react";
import { api } from "@/convex/_generated/api";
import { toast } from "sonner";
import { Eye, EyeOff, Check, Loader2 } from "lucide-react";
import { errMsg } from "@/lib/errorMessage";

export function AdsTab({ adminToken }: { adminToken: string }) {
  const existing = useQuery(api.gravityAds.getGravityAdsConfig, { adminToken });
  const saveConfig = useMutation(api.gravityAds.saveGravityAdsConfig);
  const [apiKey, setApiKey] = useState("");
  const [adUnitIds, setAdUnitIds] = useState("");
  const [isEnabled, setIsEnabled] = useState(false);
  const [showToGuests, setShowToGuests] = useState(true);
  const [showToFreeUsers, setShowToFreeUsers] = useState(true);
  const [showToPaidUsers, setShowToPaidUsers] = useState(false);
  const [restrictedCategories, setRestrictedCategories] = useState("");
  const [testAdMode, setTestAdMode] = useState(false);
  const [pixelId, setPixelId] = useState("");
  const [saving, setSaving] = useState(false);
  const [showKey, setShowKey] = useState(false);
  // Account probe — reuses the key typed above rather than asking for it twice.
  const checkGravityStatus = useAction(api.gravityAds.checkGravityStatus);
  const [gravityStatus, setGravityStatus] = useState<{ state: string; http: number; detail: string } | null>(null);
  const [checking, setChecking] = useState(false);

  const handleCheckGravity = async () => {
    setChecking(true);
    setGravityStatus(null);
    try {
      setGravityStatus(await checkGravityStatus({ adminToken, apiKey: apiKey.trim() }));
    } catch (e) { toast.error(errMsg(e, "Status check failed")); }
    finally { setChecking(false); }
  };

  useEffect(() => {
    if (existing) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- seeds the editable ads config form from the DB once it loads; the form is also user-editable so it cannot be derived during render
      setApiKey(existing.apiKey ?? "");
      setAdUnitIds((existing.adUnitIds ?? []).join("\n"));
      setIsEnabled(existing.isEnabled ?? false);
      setShowToGuests(existing.showToGuests ?? true);
      setShowToFreeUsers(existing.showToFreeUsers ?? true);
      setShowToPaidUsers(existing.showToPaidUsers ?? false);
      setRestrictedCategories((existing.restrictedCategories ?? []).join("\n"));
      setTestAdMode(existing.testAdMode ?? false);
      setPixelId(existing.pixelId ?? "");
    }
  }, [existing]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await saveConfig({ adminToken, apiKey,
        adUnitIds: adUnitIds.trim() ? adUnitIds.split("\n").map(s => s.trim()).filter(Boolean) : undefined,
        isEnabled, showToGuests, showToFreeUsers, showToPaidUsers,
        restrictedCategories: restrictedCategories.trim() ? restrictedCategories.split("\n").map(s => s.trim()).filter(Boolean) : undefined,
        testAdMode, pixelId: pixelId.trim() || undefined });
      toast.success("Ads config saved");
    } catch (e) { toast.error(errMsg(e, "Save failed")); }
    finally { setSaving(false); }
  };

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h2 className="text-lg font-bold text-foreground">Gravity Ads</h2>
        <p className="text-sm text-muted-foreground mt-1">Contextual ads from Gravity. Real ads only serve once Gravity approves the publisher account — check the status below.</p>
      </div>
      <div className="bg-card border border-border rounded-xl p-6 space-y-5">
        <div className="flex items-center justify-between">
          <div><p className="text-sm font-semibold text-foreground">Ads Enabled</p><p className="text-xs text-muted-foreground">Master switch</p></div>
          <button onClick={() => setIsEnabled(v => !v)} className={`relative w-10 h-5 rounded-full transition-all ${isEnabled ? "bg-primary" : "bg-muted"}`}>
            <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${isEnabled ? "left-5" : "left-0.5"}`} />
          </button>
        </div>
        <div className="flex items-center justify-between">
          <div><p className="text-sm font-semibold text-amber-400">Test Ads</p><p className="text-xs text-muted-foreground">Fills every slot with built-in placeholders. Never calls Gravity, never bills. Use it to check layout and the ad disclosure — but real visitors see them too, so switch it off when you're done.</p></div>
          <button onClick={() => setTestAdMode(v => !v)} className={`relative w-10 h-5 rounded-full transition-all ${testAdMode ? "bg-amber-500" : "bg-muted"}`}>
            <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${testAdMode ? "left-5" : "left-0.5"}`} />
          </button>
        </div>
        <div>
          <label className="text-xs font-bold text-muted-foreground mb-1.5 block">GRAVITY API KEY</label>
          <div className="relative">
            <input type={showKey ? "text" : "password"} value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder="Enter your Gravity publisher API key"
              className="w-full bg-background border border-border rounded-xl px-3 py-2.5 pr-10 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/60 transition-colors" />
            <button
              onClick={() => setShowKey(v => !v)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
              aria-label={showKey ? "Hide Gravity API key" : "Show Gravity API key"}
            >
              {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </div>
        <div>
          <label className="text-xs font-bold text-muted-foreground mb-1.5 block">PLACEMENT IDs <span className="font-normal">(one per line, in slot order)</span></label>
          <textarea value={adUnitIds} onChange={e => setAdUnitIds(e.target.value)} placeholder={"desktop-response-1\ndesktop-response-2\ndesktop-response-3"} rows={6}
            className="w-full bg-background border border-border rounded-xl px-3 py-2.5 text-xs font-mono text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/60 transition-colors resize-none" />
          <p className="text-xs text-muted-foreground mt-1.5">Line 1 is the in-chat card under the reply; lines 2–6 are the right rail, widest screens first. These must match placements you created in the Gravity dashboard — an unregistered id will not fill. Blank lines fall back to <span className="font-mono">desktop-response-N</span>.</p>
        </div>
        <div>
          <label className="text-xs font-bold text-muted-foreground mb-1.5 block">GRAVITY PIXEL ID <span className="font-normal">(UUID — Settings → Organization)</span></label>
          <input value={pixelId} onChange={e => setPixelId(e.target.value)} placeholder="00000000-0000-0000-0000-000000000000"
            className="w-full bg-background border border-border rounded-xl px-3 py-2.5 text-sm font-mono text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/60 transition-colors" />
          <p className="text-xs text-muted-foreground mt-1.5">Loads the measurement pixel site-wide. Required before Gravity will approve ad serving. Fingerprinting and session replay are forced off in the loader.</p>
        </div>
        <div>
          <label className="text-xs font-bold text-muted-foreground mb-1.5 block">BLOCKED CATEGORIES <span className="font-normal">(one per line — never serve these)</span></label>
          <textarea value={restrictedCategories} onChange={e => setRestrictedCategories(e.target.value)} placeholder={"Cryptocurrency, web3, NFTs and token sales\nDating, matchmaking and companionship apps"} rows={8}
            className="w-full bg-background border border-border rounded-xl px-3 py-2.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/60 transition-colors resize-none" />
          <p className="text-xs text-muted-foreground mt-1.5">Sent as <span className="font-mono">excludedTopics</span> — the only content lever Gravity's API gives us. Covers competitors plus anything nobody comes to Thalamus for. Gravity's own brand-safety rules say nothing at all about minors, so this list is the only thing standing between a student's homework and a crypto ad.</p>
        </div>
        <div className="space-y-2.5">
          <p className="text-xs font-bold text-muted-foreground">SHOW ADS TO</p>
          {([["Guest users (not signed in)", showToGuests, setShowToGuests], ["Free signed-in users", showToFreeUsers, setShowToFreeUsers], ["Paid users", showToPaidUsers, setShowToPaidUsers]] as const).map(([label, val, set]) => (
            <div key={label as string} className="flex items-center justify-between">
              <span className="text-sm text-foreground">{label as string}</span>
              <button onClick={() => set(v => !v)} className={`relative w-9 h-5 rounded-full transition-all ${val ? "bg-primary" : "bg-muted"}`}>
                <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${val ? "left-4" : "left-0.5"}`} />
              </button>
            </div>
          ))}
        </div>
        <button onClick={handleSave} disabled={saving}
          className="w-full py-2.5 bg-primary text-primary-foreground rounded-xl text-sm font-bold hover:bg-primary/90 disabled:opacity-50 transition-all flex items-center justify-center gap-2">
          {saving ? <><Loader2 className="h-4 w-4 animate-spin" />Saving…</> : <><Check className="h-4 w-4" />Save Config</>}
        </button>
      </div>
      <div className="bg-card border border-border rounded-xl p-6 space-y-4">
        <div>
          <p className="text-sm font-semibold text-foreground">Account status</p>
          <p className="text-xs text-muted-foreground mt-1">Gravity's portal shows no approval state and their API has no account endpoint, so the only way to read it is to ask for a real ad. Uses the key above.</p>
        </div>
        <button onClick={handleCheckGravity} disabled={checking || !apiKey.trim()}
          className="w-full py-2.5 bg-primary text-primary-foreground rounded-xl text-sm font-bold hover:bg-primary/90 disabled:opacity-50 transition-all flex items-center justify-center gap-2">
          {checking ? <Loader2 className="h-4 w-4 animate-spin" /> : null}Check account status
        </button>
        {gravityStatus && (() => {
          const map: Record<string, [string, string]> = {
            serving: ["text-emerald-400", "Approved — ads are serving"],
            approved_no_fill: ["text-emerald-400", "Approved — no fill for this request"],
            pending_approval: ["text-amber-400", "Not approved yet — no real ads will serve"],
            bad_key: ["text-red-400", "Key rejected"],
            unreachable: ["text-red-400", "Could not reach Gravity"],
          };
          const [color, label] = map[gravityStatus.state] ?? ["text-muted-foreground", `Unexpected response (${gravityStatus.state})`];
          return (
            <div className="space-y-1.5">
              <p className={`text-sm font-semibold ${color}`}>{label}</p>
              <p className="text-xs text-muted-foreground font-mono break-all">HTTP {gravityStatus.http} {gravityStatus.detail}</p>
            </div>
          );
        })()}
      </div>
      <div className="bg-muted/30 border border-border rounded-xl p-4 text-xs text-muted-foreground">
        Ad requests are proxied through our backend, so the key never reaches an end user's browser — but it is stored as plain text and this admin page does load it, so treat this screen as key material.
      </div>
    </div>
  );
}
