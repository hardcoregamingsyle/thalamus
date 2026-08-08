// Study Materials tab — upload reference documents that override the AI's
// default knowledge for the selected mode.
// Drives api.admin.listAdminStudyMaterials, api.admin.addAdminStudyMaterial
// and api.admin.deleteAdminStudyMaterial.

import { useState, useRef } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Doc, Id } from "@/convex/_generated/dataModel";
import { toast } from "sonner";
import {
  Upload, BookOpen, FileText, Trash2, Plus, Loader2,
} from "lucide-react";
import { errMsg } from "@/lib/errorMessage";

export function StudyMaterialsTab({ adminToken }: { adminToken: string }) {
  const materials = useQuery(api.admin.listAdminStudyMaterials, { adminToken });
  const addMaterial = useMutation(api.admin.addAdminStudyMaterial);
  const deleteMaterial = useMutation(api.admin.deleteAdminStudyMaterial);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [mode, setMode] = useState<"all" | "study" | "chat" | "research">("study");
  const [isAdding, setIsAdding] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    setTitle(prev => prev || file.name.replace(/\.[^.]+$/, ""));
    setContent(text.slice(0, 50000));
    if (e.target) e.target.value = "";
    toast.success(`Loaded: ${file.name}`);
  };

  const handleAdd = async () => {
    if (!title.trim() || !content.trim()) { toast.error("Title and content required"); return; }
    setIsAdding(true);
    try {
      await addMaterial({ adminToken, title: title.trim(), content: content.trim(), mode });
      toast.success("Study material added");
      setTitle(""); setContent(""); setMode("study");
    } catch (err) { toast.error(errMsg(err, "Failed")); }
    finally { setIsAdding(false); }
  };

  const handleDelete = async (id: Id<"adminStudyMaterials">) => {
    if (!confirm("Delete this material?")) return;
    try { await deleteMaterial({ adminToken, id }); toast.success("Deleted"); }
    catch (err) { toast.error(errMsg(err, "Failed")); }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-foreground">Study Materials</h2>
        <p className="text-sm text-muted-foreground">Upload reference documents that the AI will use as its primary knowledge source when responding in the selected mode.</p>
      </div>

      {/* Upload form */}
      <div className="bg-card border border-border rounded-xl p-5 space-y-4">
        <h3 className="text-sm font-bold text-foreground">Upload New Material</h3>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-bold text-muted-foreground mb-1.5 block">TITLE</label>
            <input value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Physics Chapter 5 Notes"
              className="w-full bg-background border border-border rounded-xl px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/60 transition-colors" />
          </div>
          <div>
            <label className="text-xs font-bold text-muted-foreground mb-1.5 block">APPLIES TO MODE</label>
            <select value={mode} onChange={e => setMode(e.target.value as typeof mode)}
              className="w-full bg-background border border-border rounded-xl px-3 py-2 text-sm text-foreground focus:outline-none focus:border-primary/60 transition-colors">
              <option value="all">All Modes</option>
              <option value="study">Study Mode Only</option>
              <option value="chat">Chat Mode Only</option>
              <option value="research">Research Mode Only</option>
            </select>
          </div>
        </div>
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-xs font-bold text-muted-foreground">CONTENT</label>
            <label className="flex items-center gap-1.5 text-xs text-primary cursor-pointer hover:text-primary/80 transition-colors">
              <Upload className="h-3 w-3" />
              Upload File
              <input ref={fileInputRef} type="file" className="hidden" accept=".txt,.md,.csv,.json,.pdf,.doc,.docx,.html" onChange={handleFileUpload} />
            </label>
          </div>
          <textarea value={content} onChange={e => setContent(e.target.value)} placeholder="Paste content or upload a file above..."
            rows={8} className="w-full bg-background border border-border rounded-xl px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground resize-none focus:outline-none focus:border-primary/60 transition-colors" />
          <p className="text-[10px] text-muted-foreground mt-1">{content.length.toLocaleString()} / 50,000 characters</p>
        </div>
        <button onClick={handleAdd} disabled={isAdding || !title.trim() || !content.trim()}
          className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-xl text-sm font-bold hover:bg-primary/90 disabled:opacity-50 transition-all">
          {isAdding ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          Add Material
        </button>
      </div>

      {/* Materials list */}
      <div>
        <h3 className="text-sm font-bold text-foreground mb-3">Uploaded Materials ({materials?.length ?? 0})</h3>
        {!materials ? (
          <div className="flex items-center justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : materials.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            <BookOpen className="h-10 w-10 mx-auto mb-3 opacity-30" />
            <p className="text-sm">No study materials uploaded yet</p>
          </div>
        ) : (
          <div className="space-y-3">
            {materials.map((m: Doc<"adminStudyMaterials">) => (
              <div key={m._id} className="bg-card border border-border rounded-xl p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <FileText className="h-4 w-4 text-primary shrink-0" />
                      <p className="font-bold text-sm text-foreground truncate">{m.title}</p>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full border font-bold shrink-0 ${
                        (m.mode ?? "all") === "all" ? "bg-primary/10 text-primary border-primary/20" :
                        (m.mode ?? "all") === "study" ? "bg-indigo-400/10 text-indigo-400 border-indigo-400/20" :
                        (m.mode ?? "all") === "chat" ? "bg-emerald-400/10 text-emerald-400 border-emerald-400/20" :
                        "bg-blue-400/10 text-blue-400 border-blue-400/20"
                      }`}>{(m.mode ?? "all").toUpperCase()}</span>
                    </div>
                    <p className="text-[10px] text-muted-foreground line-clamp-2">{m.content.slice(0, 150)}</p>
                    <p className="text-[9px] text-muted-foreground/60 mt-1">{m.content.length.toLocaleString()} chars · Added {new Date(m.createdAt).toLocaleDateString()}</p>
                  </div>
                  <button
                    onClick={() => handleDelete(m._id as Id<"adminStudyMaterials">)}
                    className="shrink-0 p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-all"
                    aria-label="Delete study material"
                  >
                    <Trash2 className="h-4 w-4" />
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
