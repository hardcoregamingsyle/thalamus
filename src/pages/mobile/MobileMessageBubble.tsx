// Mobile completed-message bubble. Memoized so per-chunk streaming updates
// don't re-render the whole history. Kept separate from the desktop
// ChatMessageBubble because the markup / avatar handling differ (mobile shows
// an emoji-in-circle avatar next to the assistant reply).

import { memo } from "react";
import { motion } from "framer-motion";
import { sanitizeAiHtml } from "@/lib/sanitizeHtml";
import type { ModeMeta } from "@/pages/portal/modes";
import type { Message } from "@/pages/portal/types";

const MobileMessageBubble = memo(function MobileMessageBubble({ msg, modeInfo }: { msg: Message; modeInfo: ModeMeta }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18 }}
      className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"} items-end gap-2`}
    >
      {msg.role === "assistant" && (
        <div className={`w-7 h-7 rounded-full ${modeInfo.bg} flex items-center justify-center text-sm shrink-0 mb-0.5`}>
          {modeInfo.emoji}
        </div>
      )}
      <div className={`max-w-[80%] px-3.5 py-2.5 text-[14px] leading-relaxed ${
        msg.role === "user"
          ? "bg-primary text-primary-foreground rounded-[18px] rounded-br-[5px]"
          : "bg-card border border-border/60 text-foreground rounded-[18px] rounded-bl-[5px]"
      }`}>
        {msg.role === "assistant" ? (
          <div className="prose-html text-[13px]" dangerouslySetInnerHTML={{ __html: sanitizeAiHtml(msg.content.startsWith("<") ? msg.content : msg.content.replace(/\n/g, "<br/>")) }} />
        ) : (
          <p className="whitespace-pre-wrap">{msg.content}</p>
        )}
      </div>
    </motion.div>
  );
});

export default MobileMessageBubble;
