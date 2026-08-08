// Suggestion / feedback submission modal. One implementation shared by the
// Portal desktop header (was Portal.SuggestionFormModal) and the Landing page
// (was Landing.SuggestionModal). The Portal variant was richer — full-size
// icon-labelled form with an accepted-file allowlist and required-field
// asterisks — so we kept that shape. Landing's version was a plainer clone;
// what it lost was strictly stylistic (smaller title box, no `accept=` on the
// file input, no "*" on required labels, no bottom disclosure line).
//
// Callers wire `onSubmit(title, description, files)` to
// `api.admin.submitSuggestion` and control the busy state via `isSubmitting`.

import { useRef, useState } from "react";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { FileText, Lightbulb, Loader2, Send, Upload, X } from "lucide-react";

export interface SuggestionFile {
  name: string;
  content: string;
  size: number;
}

export interface SuggestionFormModalProps {
  onClose: () => void;
  onSubmit: (title: string, description: string, files: SuggestionFile[]) => Promise<void>;
  isSubmitting: boolean;
}

export default function SuggestionFormModal({
  onClose,
  onSubmit,
  isSubmitting,
}: SuggestionFormModalProps) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [files, setFiles] = useState<SuggestionFile[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleFileAdd = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(e.target.files ?? []);
    for (const file of selected) {
      const text = await file.text().catch(() => `[Binary file: ${file.name}]`);
      setFiles(prev => [...prev, { name: file.name, content: text.slice(0, 50000), size: file.size }]);
    }
    if (fileRef.current) fileRef.current.value = "";
  };

  const handleSubmit = async () => {
    if (!title.trim() || !description.trim()) {
      toast.error("Please fill in Title and Description");
      return;
    }
    await onSubmit(title.trim(), description.trim(), files);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-background/80 backdrop-blur-sm" onClick={onClose} />
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 10 }}
        transition={{ duration: 0.2 }}
        className="relative z-10 bg-card border border-border rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] overflow-auto"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-amber-400/20 border border-amber-400/30 flex items-center justify-center">
              <Lightbulb className="h-3.5 w-3.5 text-amber-400" />
            </div>
            <div>
              <p className="text-xs font-bold text-foreground">SUBMIT SUGGESTION</p>
              <p className="text-[9px] text-muted-foreground">Help us improve Thalamus AI</p>
            </div>
          </div>
          <button
            aria-label="Close suggestion form"
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground transition-colors p-1"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/* Title */}
          <div>
            <label className="text-[10px] font-bold text-muted-foreground block mb-1.5">TITLE <span className="text-destructive">*</span></label>
            <input
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="Brief title for your suggestion..."
              className="w-full bg-background border border-border rounded-lg px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-amber-400/60 transition-colors"
            />
          </div>

          {/* Description */}
          <div>
            <label className="text-[10px] font-bold text-muted-foreground block mb-1.5">DESCRIPTION <span className="text-destructive">*</span></label>
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="Describe your suggestion, bug report, or feature request in detail..."
              rows={5}
              className="w-full bg-background border border-border rounded-lg px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-amber-400/60 transition-colors resize-none"
            />
          </div>

          {/* File attachments */}
          <div>
            <label className="text-[10px] font-bold text-muted-foreground block mb-1.5">ATTACHMENTS (optional)</label>
            <input ref={fileRef} type="file" multiple onChange={handleFileAdd} className="hidden" accept=".txt,.md,.json,.csv,.log,.ts,.tsx,.js,.jsx,.py,.html,.css,.xml,.yaml,.yml" />
            <button
              onClick={() => fileRef.current?.click()}
              className="w-full py-2 border border-dashed border-border rounded-lg text-[10px] text-muted-foreground hover:border-amber-400/40 hover:text-amber-400 transition-all flex items-center justify-center gap-2"
            >
              <Upload className="h-3 w-3" />
              Click to attach files (text, code, logs)
            </button>
            {files.length > 0 && (
              <div className="mt-2 space-y-1">
                {files.map((f, i) => (
                  <div key={i} className="flex items-center justify-between px-2 py-1.5 bg-background border border-border rounded-lg">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <FileText className="h-3 w-3 text-muted-foreground shrink-0" />
                      <span className="text-[10px] text-foreground truncate">{f.name}</span>
                      <span className="text-[9px] text-muted-foreground shrink-0">({(f.size / 1024).toFixed(1)}KB)</span>
                    </div>
                    <button
                      aria-label={`Remove attachment ${f.name}`}
                      onClick={() => setFiles(prev => prev.filter((_, j) => j !== i))}
                      className="text-muted-foreground hover:text-destructive transition-colors shrink-0 ml-2"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Submit */}
          <button
            onClick={handleSubmit}
            disabled={isSubmitting || !title.trim() || !description.trim()}
            className="w-full py-2.5 bg-amber-400/15 border border-amber-400/30 text-amber-400 text-xs rounded-xl hover:bg-amber-400/25 disabled:opacity-50 transition-all font-bold flex items-center justify-center gap-2"
          >
            {isSubmitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
            {isSubmitting ? "Submitting..." : "Submit Suggestion"}
          </button>

          <p className="text-[9px] text-muted-foreground/60 text-center">
            Your feedback goes directly to the Thalamus AI team. We read every submission.
          </p>
        </div>
      </motion.div>
    </div>
  );
}
