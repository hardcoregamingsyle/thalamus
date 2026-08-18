// Renders assistant HTML content (MathRenderer) and, after mount, upgrades every
// <pre><code> block with a small "Copy" button in the corner. Assistant replies
// arrive as HTML (the model is prompted to emit semantic HTML), so code blocks
// are <pre><code> — this finds them in the DOM and adds a convenient copy
// affordance without touching the source.

import { memo, useEffect, useRef } from "react";
import MathRenderer from "@/components/MathRenderer";

interface RichContentProps {
  html: string;
  className?: string;
}

const RichContent = memo(function RichContent({ html, className = "" }: RichContentProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = containerRef.current;
    if (!root) return;
    const pres = root.querySelectorAll("pre");
    pres.forEach((pre) => {
      if (pre.querySelector(".rich-code-copy")) return; // already decorated
      const code = pre.querySelector("code");
      const text = code ? code.textContent ?? pre.textContent ?? "" : pre.textContent ?? "";
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className =
        "rich-code-copy absolute top-2 right-2 rounded-md px-1.5 py-1 text-[11px] font-medium text-muted-foreground bg-muted/70 border border-border hover:text-foreground hover:bg-muted transition-colors";
      btn.textContent = "Copy";
      btn.addEventListener("click", async (e) => {
        e.stopPropagation();
        try {
          await navigator.clipboard.writeText(text);
          btn.textContent = "Copied";
          btn.classList.add("text-emerald-500");
          setTimeout(() => {
            btn.textContent = "Copy";
            btn.classList.remove("text-emerald-500");
          }, 1500);
        } catch { /* clipboard unavailable */ }
      });
      // Make the pre a positioning context and give it room for the button.
      pre.classList.add("relative", "pt-8");
      pre.appendChild(btn);
    });
  }, [html]);

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      <MathRenderer html={html} />
    </div>
  );
});

export default RichContent;
