import { memo, useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";

// Live-streaming assistant bubble for the desktop portal. Renders the model's
// output as a smooth word-by-word typewriter reveal (tags stripped to plain
// text during streaming so the reveal never breaks mid-tag); the completed
// message is then rendered as rich HTML by RichContent/MessageRow once the
// stream ends. A pulsing caret marks the live cursor.

// Minimal tag stripper for the streaming view — enough to show readable text.
function stripTags(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<\/h[1-6]>/gi, "\n\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// How many words to reveal per animation frame while catching up to the stream.
const WORDS_PER_FRAME = 3;

const StreamingBubble = memo(function StreamingBubble({ content }: { content: string }) {
  const text = stripTags(content);
  const words = text ? text.split(/\s+/) : [];
  const [visible, setVisible] = useState(0);
  const rafRef = useRef<number | null>(null);

  // Reveal words up to the full length at a controlled rate, always catching up
  // to the current content so a fast stream doesn't lag behind forever.
  useEffect(() => {
    if (words.length === 0) {
      setVisible(0);
      return;
    }
    let raf: number;
    const step = () => {
      setVisible((v) => {
        const next = Math.min(words.length, v + WORDS_PER_FRAME);
        if (next < words.length) {
          raf = requestAnimationFrame(step);
        } else {
          rafRef.current = null;
        }
        return next;
      });
    };
    raf = requestAnimationFrame(step);
    rafRef.current = raf;
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      cancelAnimationFrame(raf);
    };
  }, [words.length]);

  if (!content) {
    // No text yet — typing dots.
    return (
      <div className="flex items-center gap-1 py-1">
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

  const shown = words.slice(0, visible).join(" ");

  return (
    <div className="text-[15px] leading-relaxed">
      <span className="whitespace-pre-wrap text-foreground">{shown}</span>
      <span className="streaming-caret" aria-hidden="true" />
    </div>
  );
});

export default StreamingBubble;
