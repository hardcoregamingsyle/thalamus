import { memo, useEffect, useRef, useState } from "react";

// Live-streaming assistant bubble for the desktop portal. During streaming the
// model emits markdown text (possibly with fenced JSON ops). We render it as
// plain text with a word-by-word typewriter reveal, hiding fenced JSON-op
// blocks so the raw JSON doesn't flash. Once the stream completes, the finished
// message is rendered as formatted markdown + widgets by MessageRow's
// StudyQuestionHydrator. A pulsing caret marks the live cursor.
const WORDS_PER_FRAME = 8;

// Strip ```json ... ``` op blocks (and their braces) from the plain-text view
// so interactive ops don't appear as raw code while typing.
function stripOpsForStreaming(content: string): string {
  let out = content.replace(/```json[\s\S]*?```/gi, "");
  out = out.replace(/\{"op":"[^"]*"[\s\S]*?\}/g, "");
  return out;
}

const StreamingBubble = memo(function StreamingBubble({ content }: { content: string }) {
  const text = content ? stripOpsForStreaming(content).trim() : "";
  const words = text ? text.split(/\s+/) : [];
  const [visible, setVisible] = useState(0);
  const visibleRef = useRef(0);
  const rafRef = useRef<number | null>(null);

  // On content change, cap the visible count (so it never exceeds the current
  // word total as earlier chunks are re-split) and keep revealing.
  useEffect(() => {
    if (words.length === 0) {
      visibleRef.current = 0;
      setVisible(0);
      return;
    }
    if (visibleRef.current > words.length) visibleRef.current = words.length;
    setVisible(visibleRef.current);
  }, [words.length]);

  // Reveal loop, throttled.
  useEffect(() => {
    if (words.length === 0) return;
    const step = () => {
      if (visibleRef.current < words.length) {
        visibleRef.current = Math.min(words.length, visibleRef.current + WORDS_PER_FRAME);
        setVisible(visibleRef.current);
        rafRef.current = requestAnimationFrame(step);
      }
    };
    rafRef.current = requestAnimationFrame(step);
    return () => {
      if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
    };
  }, [words.length]);

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

  const shown = words.slice(0, visible).join(" ");

  return (
    <div className="text-[15px] leading-relaxed">
      <span className="whitespace-pre-wrap text-foreground">{shown}</span>
      <span className="streaming-caret" aria-hidden="true" />
    </div>
  );
});

export default StreamingBubble;
