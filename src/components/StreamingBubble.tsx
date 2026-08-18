import { memo } from "react";
import { motion } from "framer-motion";
import { sanitizeAiHtml } from "@/lib/sanitizeHtml";

// Live-streaming assistant bubble for the desktop portal. Rendered once per
// accumulated chunk, so it must stay cheap: we sanitize directly here (fast)
// and leave the heavier LaTeX processing (MathRenderer) to completed messages.
// A blinking caret marks the live cursor while tokens are still arriving.
const StreamingBubble = memo(function StreamingBubble({ content }: { content: string }) {
  if (!content) {
    // No text yet — typing dots.
    return (
      <div className="flex items-center gap-1">
        {[0, 1, 2].map(i => (
          <motion.span
            key={i}
            className="h-2 w-2 rounded-full bg-primary"
            animate={{ y: [0, -5, 0], opacity: [0.4, 1, 0.4] }}
            transition={{ duration: 0.7, delay: i * 0.15, repeat: Infinity }}
          />
        ))}
      </div>
    );
  }
  const html = content.startsWith("<") ? content : content.replace(/\n/g, "<br/>");
  return (
    <div className="prose-html text-[15px] leading-relaxed">
      <span dangerouslySetInnerHTML={{ __html: sanitizeAiHtml(html) }} />
      <span className="streaming-caret" aria-hidden="true" />
    </div>
  );
});

export default StreamingBubble;
