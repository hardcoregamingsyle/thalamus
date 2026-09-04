// The center-stage composer. A large, focused, ChatGPT/Claude-style prompt box
// pinned at the bottom of the chat view. Auto-grows up to a max height, supports
// Enter-to-send / Shift+Enter for newlines, native PDF/image and text-file
// attachments (button + paste), and shows an animated send affordance.

import { memo, useEffect, useRef } from "react";
import { motion } from "framer-motion";
import { ArrowUp, Paperclip, X } from "lucide-react";

export interface AttachedFile {
  name: string;
  size: number;
  content?: string;
  mimeType?: string;
  dataBase64?: string;
}

interface ComposerProps {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  onPaste: (e: React.ClipboardEvent<HTMLTextAreaElement>) => void;
  onAttach: (e: React.ChangeEvent<HTMLInputElement>) => void;
  placeholder: string;
  disabled?: boolean;
  attachedFiles: AttachedFile[];
  onRemoveFile: (i: number) => void;
}

const Composer = memo(function Composer({
  value,
  onChange,
  onSend,
  onKeyDown,
  onPaste,
  onAttach,
  placeholder,
  disabled = false,
  attachedFiles,
  onRemoveFile,
}: ComposerProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const canSend = (value.trim().length > 0 || attachedFiles.length > 0) && !disabled;

  // Auto-grow with content up to a max height.
  useEffect(() => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 200) + "px";
  }, [value]);

  return (
    <div className="w-full">
      {/* Attachment chips */}
      {attachedFiles.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-2">
          {attachedFiles.map((f, i) => (
            <div
              key={i}
              className="flex items-center gap-2 rounded-lg bg-muted border border-border px-2.5 py-1.5 text-xs"
            >
              <Paperclip className="h-3 w-3 text-muted-foreground" />
              <span className="max-w-[140px] truncate text-foreground">{f.name}</span>
              <button
                aria-label={`Remove ${f.name}`}
                onClick={() => onRemoveFile(i)}
                className="text-muted-foreground hover:text-destructive"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="composer-accent rounded-2xl border border-border bg-card shadow-sm transition-all">
        <textarea
          ref={taRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          placeholder={placeholder}
          rows={1}
          className="w-full resize-none bg-transparent px-4 pt-4 text-[15px] leading-relaxed text-foreground placeholder:text-muted-foreground focus:outline-none"
          style={{ maxHeight: "200px" }}
          disabled={disabled}
        />
        <div className="flex items-center justify-between px-2 pb-2 pt-1">
          {/* Left: attach + helper hint */}
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => fileRef.current?.click()}
              aria-label="Attach a file"
              className="rounded-lg p-2 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            >
              <Paperclip className="h-[18px] w-[18px]" />
            </button>
            <span className="hidden sm:inline pl-1 text-[11px] text-muted-foreground/70 select-none">
              Enter to send · Shift+Enter for newline
            </span>
          </div>
          <input
            ref={fileRef}
            type="file"
            multiple
            className="hidden"
            accept="image/png,image/jpeg,image/gif,image/webp,.pdf,.txt,.md,.csv,.json,.js,.ts,.py,.html,.css,.xml,.yaml,.yml"
            onChange={onAttach}
          />

          {/* Send */}
          <motion.button
            onClick={onSend}
            disabled={!canSend}
            whileTap={{ scale: 0.9 }}
            aria-label="Send message"
            className={`rounded-xl p-2.5 transition-all ${
              canSend
                ? "bg-primary text-primary-foreground shadow-sm hover:opacity-90"
                : "bg-muted text-muted-foreground/50"
            }`}
          >
            <ArrowUp className="h-5 w-5" />
          </motion.button>
        </div>
      </div>
    </div>
  );
});

export default Composer;
