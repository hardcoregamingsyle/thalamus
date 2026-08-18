// Clean, modern message row for the portal chat (ChatGPT/Claude-style). User
// messages are right-aligned accent bubbles; assistant messages are full-width
// rows with a compact avatar chip and the rendered content. Memoized so
// per-chunk streaming updates don't re-render the whole history.

import { memo } from "react";
import { motion } from "framer-motion";
import { Sparkles } from "lucide-react";
import MathRenderer from "@/components/MathRenderer";
import type { Message } from "@/pages/portal/types";

interface MessageRowProps {
  msg: Message;
  accentColor: string; // tailwind text color for the assistant avatar
}

const MessageRow = memo(function MessageRow({ msg, accentColor }: MessageRowProps) {
  const isUser = msg.role === "user";

  if (isUser) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex justify-end"
      >
        <div className="max-w-[85%] sm:max-w-[75%] rounded-2xl rounded-br-md bg-primary text-primary-foreground px-4 py-3 text-[15px] leading-relaxed shadow-sm whitespace-pre-wrap">
          {msg.content}
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex gap-3"
    >
      <div className={`shrink-0 w-8 h-8 rounded-full flex items-center justify-center bg-muted border border-border mt-0.5 ${accentColor}`}>
        <Sparkles className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1 text-[15px] leading-relaxed text-foreground prose-html max-w-full">
        <MathRenderer
          html={msg.content.startsWith("<") ? msg.content : msg.content.replace(/\n/g, "<br/>")}
        />
        {msg.costCents !== undefined && msg.costCents > 0 && (
          <p className="text-[11px] opacity-40 mt-2 text-right">{Math.ceil(msg.costCents * 15000).toLocaleString()} AB</p>
        )}
      </div>
    </motion.div>
  );
});

export default MessageRow;
