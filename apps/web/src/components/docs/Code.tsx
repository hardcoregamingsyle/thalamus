import type { ReactNode } from "react";

// Inline code, styled with tokens (distinct from ui/CodeBlock, which is for
// multi-line examples).
export function Code({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <code className={`rounded-md bg-surface-strong px-1.5 py-0.5 font-mono text-[13px] text-fg ${className}`}>
      {children}
    </code>
  );
}
