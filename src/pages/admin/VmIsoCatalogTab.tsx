// VM ISO catalog tab — admin-managed OS download links merged into the desktop
// app's built-in VM Sandbox catalog at runtime; no rebuild to add or remove one.
// Drives api.desktopIsoCatalog.listIsoEntriesAdmin, api.desktopIsoCatalog.addIsoEntry,
// api.desktopIsoCatalog.setIsoEntryEnabled and api.desktopIsoCatalog.deleteIsoEntry.

import { useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Doc } from "@/convex/_generated/dataModel";
import { toast } from "sonner";
import { Eye, EyeOff, Trash2, Plus, Loader2 } from "lucide-react";
import { errMsg } from "@/lib/errorMessage";

export function VmIsoCatalogTab({ adminToken }: { adminToken: string }) {
  const entries = useQuery(api.desktopIsoCatalog.listIsoEntriesAdmin, { adminToken });
  const addEntry = useMutation(api.desktopIsoCatalog.addIsoEntry);
  const setEnabled = useMutation(api.desktopIsoCatalog.setIsoEntryEnabled);
  const deleteEntry = useMutation(api.desktopIsoCatalog.deleteIsoEntry);

  const [name, setName] = useState("");
  const [category, setCategory] = useState("windows");
  const [downloadUrl, setDownloadUrl] = useState("");
  const [fileName, setFileName] = useState("");
  const [sizeMb, setSizeMb] = useState("");
  const [infoUrl, setInfoUrl] = useState("");
  const [note, setNote] = useState("");
  const [hostSkipVersion, setHostSkipVersion] = useState("");
  const [saving, setSaving] = useState(false);

  const handleAdd = async () => {
    if (!name.trim() || !downloadUrl.trim()) { toast.error("Name and download URL are required"); return; }
    setSaving(true);
    try {
      const mb = Number(sizeMb);
      await addEntry({
        adminToken, name: name.trim(), category, downloadUrl: downloadUrl.trim(),
        fileName: fileName.trim() || undefined,
        sizeBytes: Number.isFinite(mb) && mb > 0 ? Math.round(mb * 1_048_576) : undefined,
        infoUrl: infoUrl.trim() || undefined,
        note: note.trim() || undefined,
        hostSkipVersion: hostSkipVersion || undefined,
      });
      toast.success("Added to the VM ISO catalog");
      setName(""); setDownloadUrl(""); setFileName(""); setSizeMb(""); setInfoUrl(""); setNote(""); setHostSkipVersion("");
    } catch (e) { toast.error(errMsg(e, "Failed to add")); }
    finally { setSaving(false); }
  };

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h2 className="text-lg font-bold text-foreground">VM Sandbox — OS Catalog</h2>
        <p className="text-sm text-muted-foreground mt-1">Direct download links the desktop app's VM Sandbox offers. Added entries show up next time the app opens the sandbox — no rebuild needed.</p>
      </div>

      <div className="bg-card border border-border rounded-xl p-6 space-y-4">
        <p className="text-xs font-bold text-muted-foreground">ADD ENTRY</p>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-[11px] text-muted-foreground mb-1 block">NAME</label>
            <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Windows 11 Pro"
              className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:border-primary/60" />
          </div>
          <div>
            <label className="text-[11px] text-muted-foreground mb-1 block">CATEGORY</label>
            <select value={category} onChange={e => setCategory(e.target.value)}
              className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:border-primary/60">
              <option value="windows">Windows</option>
              <option value="android">Android</option>
              <option value="linux">Linux</option>
              <option value="other">Other</option>
            </select>
          </div>
        </div>
        <div>
          <label className="text-[11px] text-muted-foreground mb-1 block">DIRECT DOWNLOAD URL</label>
          <input value={downloadUrl} onChange={e => setDownloadUrl(e.target.value)} placeholder="https://…/image.iso"
            className="w-full bg-background border border-border rounded-lg px-3 py-2 text-xs font-mono text-foreground focus:outline-none focus:border-primary/60" />
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="text-[11px] text-muted-foreground mb-1 block">FILE NAME <span className="opacity-60">(optional)</span></label>
            <input value={fileName} onChange={e => setFileName(e.target.value)} placeholder="auto from URL"
              className="w-full bg-background border border-border rounded-lg px-3 py-2 text-xs font-mono text-foreground focus:outline-none focus:border-primary/60" />
          </div>
          <div>
            <label className="text-[11px] text-muted-foreground mb-1 block">SIZE (MB) <span className="opacity-60">(optional)</span></label>
            <input value={sizeMb} onChange={e => setSizeMb(e.target.value)} inputMode="numeric" placeholder="e.g. 5800"
              className="w-full bg-background border border-border rounded-lg px-3 py-2 text-xs font-mono text-foreground focus:outline-none focus:border-primary/60" />
          </div>
          <div>
            <label className="text-[11px] text-muted-foreground mb-1 block">SKIP IF HOST IS</label>
            <select value={hostSkipVersion} onChange={e => setHostSkipVersion(e.target.value)}
              className="w-full bg-background border border-border rounded-lg px-3 py-2 text-xs text-foreground focus:outline-none focus:border-primary/60">
              <option value="">Never hide</option>
              <option value="10">Windows 10</option>
              <option value="11">Windows 11</option>
            </select>
          </div>
        </div>
        <div>
          <label className="text-[11px] text-muted-foreground mb-1 block">INFO URL <span className="opacity-60">(optional)</span></label>
          <input value={infoUrl} onChange={e => setInfoUrl(e.target.value)} placeholder="official page, shown as a link"
            className="w-full bg-background border border-border rounded-lg px-3 py-2 text-xs font-mono text-foreground focus:outline-none focus:border-primary/60" />
        </div>
        <div>
          <label className="text-[11px] text-muted-foreground mb-1 block">NOTE <span className="opacity-60">(optional)</span></label>
          <input value={note} onChange={e => setNote(e.target.value)} placeholder="one-line hint shown under the entry"
            className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:border-primary/60" />
        </div>
        <button onClick={handleAdd} disabled={saving}
          className="w-full py-2.5 bg-primary text-primary-foreground rounded-xl text-sm font-bold hover:bg-primary/90 disabled:opacity-50 transition-all flex items-center justify-center gap-2">
          {saving ? <><Loader2 className="h-4 w-4 animate-spin" />Adding…</> : <><Plus className="h-4 w-4" />Add to Catalog</>}
        </button>
      </div>

      <div className="space-y-2">
        <p className="text-xs font-bold text-muted-foreground">CURRENT ENTRIES {entries ? `(${entries.length})` : ""}</p>
        {entries === undefined ? (
          <p className="text-xs text-muted-foreground">Loading…</p>
        ) : entries.length === 0 ? (
          <p className="text-xs text-muted-foreground">No admin-added entries yet — the app still shows its built-in catalog.</p>
        ) : (
          <div className="space-y-2">
            {entries.map((e: Doc<"desktopIsoCatalog">) => (
              <div key={e._id} className="bg-card border border-border rounded-xl p-3 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className={`text-sm font-semibold truncate ${e.isEnabled ? "text-foreground" : "text-muted-foreground line-through"}`}>{e.name}</p>
                  <p className="text-[11px] text-muted-foreground truncate font-mono">{e.downloadUrl}</p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">{e.category}{e.hostSkipVersion ? ` · hidden on Windows ${e.hostSkipVersion}` : ""}</p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => setEnabled({ adminToken, id: e._id, isEnabled: !e.isEnabled })}
                    className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
                    title={e.isEnabled ? "Disable" : "Enable"}
                    aria-label={e.isEnabled ? "Disable ISO entry" : "Enable ISO entry"}
                  >
                    {e.isEnabled ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
                  </button>
                  <button
                    onClick={() => deleteEntry({ adminToken, id: e._id })}
                    className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                    title="Remove"
                    aria-label="Remove ISO entry"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
