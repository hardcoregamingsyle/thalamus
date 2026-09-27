"use client";

import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { highlight, type CodeLang } from "@/lib/highlight";

export type { CodeLang };
export type CodeTab = { label: string; lang: CodeLang; code: string };

export function CodeBlock({
  tabs,
  className = "",
  title,
}: {
  tabs: CodeTab[];
  className?: string;
  title?: string;
}) {
  const [active, setActive] = useState(0);
  const [copied, setCopied] = useState(false);
  const tab = (tabs[active] ?? tabs[0])!;

  async function copy() {
    try {
      await navigator.clipboard.writeText(tab.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard blocked: the code is still selectable.
    }
  }

  return (
    <div
      className={`overflow-hidden rounded-2xl border border-white/10 bg-code-bg text-left shadow-2xl shadow-black/40 ${className}`}
    >
      <div className="flex items-center justify-between gap-3 border-b border-white/[0.07] px-3 py-2">
        <div className="flex items-center gap-1" role="tablist">
          {title && tabs.length === 1 ? (
            <span className="px-2 font-mono text-xs text-white/45">{title}</span>
          ) : (
            tabs.map((t, i) => (
              <button
                key={t.label}
                type="button"
                role="tab"
                aria-selected={i === active}
                onClick={() => setActive(i)}
                className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                  i === active ? "bg-white/10 text-white" : "text-white/45 hover:text-white/80"
                }`}
              >
                {t.label}
              </button>
            ))
          )}
        </div>
        <button
          type="button"
          onClick={copy}
          aria-label="Copy code"
          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-white/45 transition-colors hover:bg-white/10 hover:text-white"
        >
          {copied ? (
            <Check className="h-3.5 w-3.5 text-[#6ee7b7]" />
          ) : (
            <Copy className="h-3.5 w-3.5" />
          )}
        </button>
      </div>
      <pre className="overflow-x-auto p-4 font-mono text-[13px] leading-[1.7] text-white/85">
        <code>{highlight(tab.code, tab.lang)}</code>
      </pre>
    </div>
  );
}
