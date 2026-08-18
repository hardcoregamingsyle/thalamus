import { memo, useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { sanitizeAiHtml } from "@/lib/sanitizeHtml";

// Live-streaming assistant bubble for the desktop portal.
//
// Two goals must hold at once:
//   1. "Perfectly formatted" — the accumulated reply is rendered as sanitized
//      HTML every chunk, so headings, code blocks, tables, bold, etc. appear
//      and reflow correctly the moment their tags finish streaming.
//   2. "Typewriter" — words are revealed progressively, not dumped as one wall.
//
// We render the whole sanitized HTML (formatting always live) and then reveal
// words by walking the rendered DOM's text nodes: each word is wrapped in a
// span and set to `visibility:hidden` until its turn. Hidden words still occupy
// their space, so the layout — and therefore the formatting — is identical to
// the final message the whole way through. As new chunks arrive the HTML is
// re-rendered and the reveal count carries over.
const WORDS_PER_FRAME = 3;

const StreamingBubble = memo(function StreamingBubble({ content }: { content: string }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [revealed, setRevealed] = useState(0);
  const revealedRef = useRef(0);
  const totalRef = useRef(0);
  const rafRef = useRef<number | null>(null);

  const sanitized = content ? sanitizeAiHtml(content.startsWith("<") ? content : content.replace(/\n/g, "<br/>")) : "";

  // Recompute total word count whenever content changes, and keep revealing.
  useEffect(() => {
    if (!content) {
      totalRef.current = 0;
      revealedRef.current = 0;
      setRevealed(0);
      return;
    }
    // Count words from the sanitized HTML's text.
    const tmp = document.createElement("div");
    tmp.innerHTML = sanitized;
    const text = (tmp.textContent ?? "").trim();
    totalRef.current = text ? text.split(/\s+/).length : 0;
    if (revealedRef.current > totalRef.current) revealedRef.current = totalRef.current;
    setRevealed(revealedRef.current);
  }, [content, sanitized]);

  // Reveal loop: advance revealedRef toward total.
  useEffect(() => {
    if (totalRef.current === 0) return;
    const step = () => {
      if (revealedRef.current < totalRef.current) {
        revealedRef.current = Math.min(totalRef.current, revealedRef.current + WORDS_PER_FRAME);
        setRevealed(revealedRef.current);
        rafRef.current = requestAnimationFrame(step);
      }
    };
    rafRef.current = requestAnimationFrame(step);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [content]);

  // Apply the reveal to the rendered DOM. When the sanitized HTML changes React
  // resets the root's innerHTML, wiping any word spans — so we rebuild them from
  // scratch each time, assigning fresh sequential word indices, then hide words
  // beyond the current `revealed` count. On reveal-count ticks (no content
  // change) the spans already exist and we only toggle visibility.
  const lastHtmlRef = useRef<string | null>(null);
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    const htmlChanged = lastHtmlRef.current !== sanitized;
    lastHtmlRef.current = sanitized;

    if (htmlChanged) {
      // Rebuild spans across the whole subtree with sequential indices.
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      const textNodes: Text[] = [];
      let n: Node | null = walker.nextNode();
      while (n) {
        if ((n.textContent ?? "").trim().length > 0) textNodes.push(n as Text);
        n = walker.nextNode();
      }
      let running = 0;
      for (const tn of textNodes) {
        const words = (tn.textContent ?? "").split(/(\s+)/);
        const frag = document.createDocumentFragment();
        for (const w of words) {
          if (w === "") continue;
          const span = document.createElement("span");
          span.className = "tw-word";
          span.textContent = w;
          if (w.trim().length > 0) {
            span.dataset.tw = String(running);
            running++;
          }
          frag.appendChild(span);
        }
        tn.parentNode?.replaceChild(frag, tn);
      }
    }

    root.querySelectorAll<HTMLSpanElement>(".tw-word").forEach((span) => {
      const i = parseInt(span.dataset.tw as string, 10);
      if (!Number.isNaN(i)) span.style.visibility = i < revealed ? "visible" : "hidden";
    });
  }, [revealed, sanitized]);

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

  return (
    <div className="text-[15px] leading-relaxed prose-html">
      <div ref={rootRef} dangerouslySetInnerHTML={{ __html: sanitized }} />
      <span className="streaming-caret" aria-hidden="true" />
    </div>
  );
});

export default StreamingBubble;
