// Completed-message bubble for the desktop Portal chat view. Memoized so
// per-chunk streaming updates do not re-render the whole history — MathRenderer
// re-processing every completed message on each streamed chunk caused visible
// lag. Extracted verbatim from Portal.tsx; PortalDesktop is the sole consumer
// (MobilePortal renders its own smaller variant, MobileMessageBubble).

import { memo } from "react";
import { motion } from "framer-motion";
import MathRenderer from "@/components/MathRenderer";
import type { Message } from "@/pages/portal/types";

const ChatMessageBubble = memo(function ChatMessageBubble({ msg }: { msg: Message }) {
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
      className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
    >
      <div className={`max-w-[82%] rounded-2xl px-4 py-3 text-xs leading-relaxed ${msg.role === "user" ? "bg-primary text-primary-foreground" : "bg-card border border-border text-foreground"}`}>
        {msg.role === "assistant" ? (
          <MathRenderer html={msg.content.startsWith("<") ? msg.content : msg.content.replace(/\n/g, "<br/>")} />
        ) : (
          <p className="whitespace-pre-wrap">{msg.content}</p>
        )}
        {msg.costCents !== undefined && msg.costCents > 0 && (
          <p className="text-[9px] opacity-40 mt-1.5 text-right">{Math.ceil(msg.costCents * 15000).toLocaleString()} AB</p>
        )}
      </div>
    </motion.div>
  );
});

export default ChatMessageBubble;
