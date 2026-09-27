"use client";

import { Check, Copy } from "lucide-react";
import { useState } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { highlight, type CodeLang } from "@/lib/highlight";

const LANG_ALIASES: Record<string, CodeLang> = {
  python: "python",
  py: "python",
  typescript: "typescript",
  ts: "typescript",
  tsx: "typescript",
  javascript: "typescript",
  js: "typescript",
  jsx: "typescript",
  bash: "bash",
  sh: "bash",
  shell: "bash",
  zsh: "bash",
  json: "json",
};

function toCodeLang(label: string): CodeLang {
  return LANG_ALIASES[label.toLowerCase()] ?? "text";
}

function CodeFence({ label, code }: { label: string; code: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard blocked: the code is still selectable.
    }
  }

  return (
    <div className="my-3 overflow-hidden rounded-2xl border border-white/10 bg-code-bg text-left">
      <div className="flex items-center justify-between gap-3 border-b border-white/[0.07] px-3 py-1.5">
        <span className="px-1 font-mono text-xs text-white/45">{label}</span>
        <button
          type="button"
          onClick={() => void copy()}
          aria-label="Copy code"
          title="Copy code"
          className="inline-flex h-6 w-6 items-center justify-center rounded-md text-white/45 transition-colors hover:bg-white/10 hover:text-white"
        >
          {copied ? (
            <Check className="h-3.5 w-3.5 text-[#6ee7b7]" />
          ) : (
            <Copy className="h-3.5 w-3.5" />
          )}
        </button>
      </div>
      <pre className="overflow-x-auto p-4 font-mono text-[13px] leading-[1.7] text-white/85">
        <code>{highlight(code, toCodeLang(label))}</code>
      </pre>
    </div>
  );
}

const components: Components = {
  p: ({ children }) => <p className="whitespace-pre-wrap break-words">{children}</p>,
  ul: ({ children }) => (
    <ul className="list-disc space-y-1 pl-5 marker:text-fg-subtle">{children}</ul>
  ),
  ol: ({ children }) => (
    <ol className="list-decimal space-y-1 pl-5 marker:text-fg-subtle">{children}</ol>
  ),
  li: ({ children }) => <li className="break-words">{children}</li>,
  h1: ({ children }) => (
    <h1 className="mt-2 text-xl font-semibold tracking-tight text-fg">{children}</h1>
  ),
  h2: ({ children }) => (
    <h2 className="mt-2 text-lg font-semibold tracking-tight text-fg">{children}</h2>
  ),
  h3: ({ children }) => (
    <h3 className="mt-2 text-base font-semibold tracking-tight text-fg">{children}</h3>
  ),
  a: ({ children, href }) => (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      className="underline decoration-fg-subtle underline-offset-2 hover:decoration-fg"
    >
      {children}
    </a>
  ),
  strong: ({ children }) => <strong className="font-semibold text-fg">{children}</strong>,
  blockquote: ({ children }) => (
    <blockquote className="border-l-2 border-border-strong pl-4 text-fg-muted">
      {children}
    </blockquote>
  ),
  hr: () => <hr className="border-border" />,
  table: ({ children }) => (
    <div className="min-w-0 overflow-x-auto rounded-xl border border-border">
      <table className="w-full min-w-[420px] border-collapse text-left text-sm">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead className="bg-surface">{children}</thead>,
  th: ({ children }) => (
    <th className="border-b border-border px-3 py-2 font-medium text-fg">{children}</th>
  ),
  td: ({ children }) => (
    <td className="border-b border-border px-3 py-2 text-fg-muted">{children}</td>
  ),
  // Fenced blocks arrive as <pre><code class="language-x">...</code></pre>;
  // CodeFence renders its own <pre>, so drop remark's wrapper here.
  pre: ({ children }) => <>{children}</>,
  code: ({ className, children }) => {
    const match = /language-(\w+)/.exec(className ?? "");
    const text = String(children).replace(/\n$/, "");
    if (!match) {
      return (
        <code className="rounded-md bg-surface-strong px-1.5 py-0.5 font-mono text-[0.85em] text-fg">
          {children}
        </code>
      );
    }
    return <CodeFence label={match[1] ?? "text"} code={text} />;
  },
};

export function MarkdownMessage({ content }: { content: string }) {
  return (
    <div className="min-w-0 space-y-3 text-[15px] leading-relaxed text-fg">
      <ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml components={components}>
        {content}
      </ReactMarkdown>
    </div>
  );
}
