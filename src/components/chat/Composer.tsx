// The center-stage composer. A large, focused, ChatGPT/Claude-style prompt box
// pinned at the bottom of the chat view. Auto-grows up to a max height, supports
// Enter-to-send / Shift+Enter for newlines, text-file attachments (button +
// paste), and shows an animated send/stop affordance.

import { memo, useRef } from "react";
import { motion } from "framer-motion";
import { ArrowUp, Paperclip, X } from "lucide-react";

export interface AttachedFile {
  name: string;
  content: string;
  size: number;
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
  accentText: string; // tailwind text color for the send button accent
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
  accentText,
  attachedFiles,
  onRemoveFile,
}: ComposerProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const canSend = (value.trim().length > 0 || attachedFiles.length > 0) && !disabled;

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

      <div className="rounded-2xl border border-border bg-card shadow-sm focus-within:border-ring/60 focus-within:ring-4 focus-within:ring-ring/10 transition-all">
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          placeholder={placeholder}
          rows={1}
          className="w-full resize-none bg-transparent px-4 pt-3.5 text-[15px] leading-relaxed text-foreground placeholder:text-muted-foreground focus:outline-none"
          style={{ maxHeight: "200px" }}
          disabled={disabled}
        />
        <div className="flex items-center justify-between px-2 pb-2 pt-1">
          {/* Attach */}
          <button
            onClick={() => fileRef.current?.click()}
            aria-label="Attach a text file"
            className="rounded-lg p-2 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            <Paperclip className="h-4.5 w-4.5" />
          </button>
          <input
            ref={fileRef}
            type="file"
            multiple
            className="hidden"
            accept=".txt,.md,.csv,.json,.js,.ts,.py,.html,.css,.xml,.yaml,.yml,.pdf,.doc,.docx"
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
                ? `${accentText} bg-primary text-primary-foreground hover:opacity-90`
                : "bg-muted text-muted-foreground/60"
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
