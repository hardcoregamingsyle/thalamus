import { memo, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";

// Live-streaming assistant bubble for the desktop portal.
//
// The model emits markdown (with fenced JSON ops). We want BOTH live formatted
// markdown AND a word-by-word typewriter. Approach:
//   - Render the accumulated markdown through react-markdown every chunk, so
//     headings, bold, lists, tables format the moment their tokens finish.
//   - Fenced JSON-op blocks are stripped from the streaming view so raw JSON
//     never flashes.
//   - A typewriter reveal is layered on top by walking the rendered DOM's text
//     nodes once per content change, wrapping each word in a span, then
//     toggling `visibility` as a reveal counter advances (throttled via rAF).
//     Hidden words keep their space, so formatting stays stable.
const WORDS_PER_FRAME = 8;

// Strip ```json ... ``` op blocks (and bare {"op":...} objects) so interactive
// ops don't appear as raw code while the answer types out.
function stripOpsForStreaming(content: string): string {
  let out = content.replace(/```json[\s\S]*?```/gi, "");
  out = out.replace(/\{\s*"op"\s*:\s*"[^"]*"[\s\S]*?\}/g, "");
  return out;
}

const StreamingBubble = memo(function StreamingBubble({ content }: { content: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [revealed, setRevealed] = useState(0);
  const revealedRef = useRef(0);
  const lastContentRef = useRef<string | null>(null);
  const rafRef = useRef<number | null>(null);

  const markdown = content ? stripOpsForStreaming(content) : "";

  // On content change, rebuild word spans in the rendered markdown DOM and
  // reset the reveal counter. Runs once per change (not per reveal tick).
  useEffect(() => {
    const root = containerRef.current;
    if (!root) return;
    if (lastContentRef.current === markdown) return;
    lastContentRef.current = markdown;

    if (!markdown) {
      revealedRef.current = 0;
      setRevealed(0);
      return;
    }

    // Wrap each text-node word in a span with a running index.
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
        if (w.trim().length > 0) { span.dataset.tw = String(running); running++; }
        frag.appendChild(span);
      }
      tn.parentNode?.replaceChild(frag, tn);
    }

    revealedRef.current = 0;
    setRevealed(0);
  }, [markdown]);

  // Reveal loop: advance the counter and apply visibility. Cheap — only toggles
  // existing spans.
  useEffect(() => {
    const root = containerRef.current;
    if (!root) return;
    const apply = () => {
      root.querySelectorAll<HTMLSpanElement>(".tw-word").forEach((span) => {
        const i = parseInt(span.dataset.tw as string, 10);
        if (!Number.isNaN(i)) span.style.visibility = i < revealed ? "visible" : "hidden";
      });
    };
    apply();
    const total = root.querySelectorAll(".tw-word").length;
    if (revealed < total) {
      rafRef.current = requestAnimationFrame(() => {
        revealedRef.current = Math.min(total, revealedRef.current + WORDS_PER_FRAME);
        setRevealed(revealedRef.current);
      });
    }
    return () => {
      if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
    };
  }, [revealed, markdown]);

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
    <div className="prose-html text-[15px] leading-relaxed">
      <div ref={containerRef}>
        <ReactMarkdown>{markdown}</ReactMarkdown>
      </div>
      <span className="streaming-caret" aria-hidden="true" />
    </div>
  );
});

export default StreamingBubble;
