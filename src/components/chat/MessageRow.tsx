// Clean, modern message row for the portal chat (ChatGPT/Claude-style). User
// messages are right-aligned accent bubbles; assistant messages are full-width
// rows with a compact avatar chip and the rendered content, plus a copy button.
// Memoized so per-chunk streaming updates don't re-render the whole history.

import { memo, useState } from "react";
import { motion } from "framer-motion";
import { Check, Copy, Sparkles } from "lucide-react";
import MathRenderer from "@/components/MathRenderer";
import type { Message } from "@/pages/portal/types";

interface MessageRowProps {
  msg: Message;
  accentColor: string; // tailwind text color for the assistant avatar
}

const MessageRow = memo(function MessageRow({ msg, accentColor }: MessageRowProps) {
  const [copied, setCopied] = useState(false);
  const isUser = msg.role === "user";

  const copyText = async () => {
    try {
      await navigator.clipboard.writeText(msg.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* clipboard unavailable */ }
  };

  if (isUser) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex justify-end"
      >
        <div className="max-w-[85%] sm:max-w-[75%] rounded-2xl rounded-br-md bg-primary text-primary-foreground px-4 py-2.5 text-[15px] leading-relaxed shadow-sm whitespace-pre-wrap">
          {msg.content}
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="group flex gap-3"
    >
      <div className="shrink-0 w-8 h-8 rounded-lg bg-muted border border-border flex items-center justify-center mt-0.5 shadow-sm">
        <Sparkles className={`h-4 w-4 ${accentColor}`} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 h-8 mb-0.5">
          <span className="text-xs font-medium text-muted-foreground">Thalamus</span>
          <button
            onClick={copyText}
            aria-label="Copy response"
            className="opacity-0 group-hover:opacity-100 transition-opacity rounded-md p-1 text-muted-foreground hover:text-foreground hover:bg-muted"
          >
            {copied ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
          </button>
        </div>
        <div className="text-[15px] leading-relaxed text-foreground prose-html max-w-full">
          <MathRenderer
            html={msg.content.startsWith("<") ? msg.content : msg.content.replace(/\n/g, "<br/>")}
          />
          {msg.costCents !== undefined && msg.costCents > 0 && (
            <p className="text-[11px] opacity-40 mt-2 text-right">{Math.ceil(msg.costCents * 15000).toLocaleString()} AB</p>
          )}
        </div>
      </div>
    </motion.div>
  );
});

export default MessageRow;
