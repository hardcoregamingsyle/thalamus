import { memo, useEffect, useRef, useState } from "react";
import { sanitizeAiHtml } from "@/lib/sanitizeHtml";

// Live-streaming assistant bubble for the desktop portal.
//
// It renders the accumulated reply as sanitized HTML every chunk, so
// formatting (headings, code, bold, tables) is always correct and reflows the
// moment tags finish. On top, a lightweight typewriter reveal shows words
// progressively. To keep this fast under a rapid stream:
//   - The word spans are built ONCE per content change (when React resets the
//     innerHTML), never re-walked on every reveal tick.
//   - Reveal ticks only toggle `visibility` on the already-existing spans, and
//     are throttled so a fast stream catches up without freezing.
//   - As a safety net, the reveal always converges to "all visible", so content
//     is never stuck hidden.
const WORDS_PER_FRAME = 6;

const StreamingBubble = memo(function StreamingBubble({ content }: { content: string }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [revealed, setRevealed] = useState(0);
  const revealedRef = useRef(0);
  const totalRef = useRef(0);
  const lastHtmlRef = useRef<string | null>(null);
  const rafRef = useRef<number | null>(null);

  const sanitized = content ? sanitizeAiHtml(content.startsWith("<") ? content : content.replace(/\n/g, "<br/>")) : "";

  // On content change: rebuild the word spans once and reset the reveal counter.
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    if (lastHtmlRef.current === sanitized) return;
    lastHtmlRef.current = sanitized;

    if (!sanitized) {
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

    // Build word spans across the whole subtree.
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

    revealedRef.current = 0;
    setRevealed(0);
  }, [sanitized]);

  // Reveal loop: advance the revealed count toward total, throttled, and apply
  // visibility. Runs whenever revealed or the html changes.
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    if (totalRef.current === 0) {
      return;
    }
    const apply = () => {
      root.querySelectorAll<HTMLSpanElement>(".tw-word").forEach((span) => {
        const i = parseInt(span.dataset.tw as string, 10);
        if (!Number.isNaN(i)) span.style.visibility = i < revealed ? "visible" : "hidden";
      });
    };
    apply();
    if (revealed < totalRef.current) {
      rafRef.current = requestAnimationFrame(() => {
        revealedRef.current = Math.min(totalRef.current, revealedRef.current + WORDS_PER_FRAME);
        setRevealed(revealedRef.current);
      });
    }
    return () => {
      if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
    };
  }, [revealed, sanitized]);

  if (!content) {
    return (
      <div className="flex items-center gap-1 py-1">
        {[0, 1, 2].map(i => (
          <span
            key={i}
            className="h-2 w-2 rounded-full bg-primary"
            style={{ animation: `streamingDotBounce 1.2s ease-in-out ${i * 0.15}s infinite` }}
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
