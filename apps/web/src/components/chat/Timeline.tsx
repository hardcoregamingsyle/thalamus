"use client";

import { Check, Copy, Info, RotateCcw } from "lucide-react";
import { motion, useReducedMotion, AnimatePresence } from "motion/react";
import { useState, type RefObject } from "react";
import { LogoMark } from "@/components/ui/Logo";
import { EASE_OUT } from "@/components/ui/Reveal";
import type { TimelineItem } from "@/lib/chat-types";
import { MarkdownMessage } from "./MarkdownMessage";

function AssistantActions({
  content,
  onRegenerate,
}: {
  content: string;
  onRegenerate: () => void;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard blocked — nothing to fall back to here.
    }
  }

  return (
    <div className="mt-2 flex items-center gap-1">
      <button
        type="button"
        onClick={() => void copy()}
        title="Copy"
        aria-label="Copy response"
        className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-fg-subtle transition-colors hover:bg-surface-strong hover:text-fg"
      >
        {copied ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />}
      </button>
      <button
        type="button"
        onClick={onRegenerate}
        title="Regenerate response"
        aria-label="Regenerate response"
        className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-fg-subtle transition-colors hover:bg-surface-strong hover:text-fg"
      >
        <RotateCcw className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

function Caret() {
  return (
    <span className="animate-caret ml-0.5 inline-block h-[1.05em] w-[3px] translate-y-[3px] bg-fg-muted" />
  );
}

export function Timeline({
  items,
  streaming,
  onRegenerate,
  scrollRef,
  onScroll,
}: {
  items: TimelineItem[];
  streaming: boolean;
  onRegenerate: () => void;
  scrollRef: RefObject<HTMLDivElement | null>;
  onScroll: () => void;
}) {
  const still = useReducedMotion();
  const lastMessageIndex = items.reduce(
    (found, item, index) => (item.kind === "message" ? index : found),
    -1,
  );

  return (
    <div ref={scrollRef} onScroll={onScroll} className="flex-1 overflow-y-auto">
      <div className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-6 sm:px-6">
        <AnimatePresence initial={false}>
          {items.map((item, index) => {
            const isLast = index === lastMessageIndex;
            const initial = still ? false : { opacity: 0, y: 8 };
            const animate = { opacity: 1, y: 0 };
            const transition = { duration: 0.25, ease: EASE_OUT };

            if (item.kind === "notice") {
              return (
                <motion.div
                  key={item.id}
                  initial={initial}
                  animate={animate}
                  exit={{ opacity: 0 }}
                  transition={transition}
                  className="flex gap-3"
                >
                  <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-surface-strong">
                    <Info className="h-3.5 w-3.5 text-fg-muted" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[15px] leading-relaxed text-fg-muted">{item.text}</p>
                    {item.onRetry ? (
                      <button
                        type="button"
                        onClick={item.onRetry}
                        className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-border-strong px-3 py-1 text-xs font-medium text-fg transition-colors hover:bg-surface-strong"
                      >
                        <RotateCcw className="h-3 w-3" />
                        Retry
                      </button>
                    ) : null}
                  </div>
                </motion.div>
              );
            }

            const { message } = item;
            if (message.role === "user") {
              return (
                <motion.div
                  key={message.id}
                  initial={initial}
                  animate={animate}
                  transition={transition}
                  className="flex justify-end"
                >
                  <div className="min-w-0 max-w-[80%] whitespace-pre-wrap break-words rounded-3xl bg-surface-strong px-4 py-2.5 text-[15px] leading-relaxed text-fg">
                    {message.content}
                  </div>
                </motion.div>
              );
            }

            const isStreamingThis = streaming && isLast;
            return (
              <motion.div
                key={message.id}
                initial={initial}
                animate={animate}
                transition={transition}
                className="flex gap-3"
              >
                <LogoMark className="mt-0.5 h-6 w-6 shrink-0" />
                <div className="min-w-0 flex-1">
                  {message.content ? (
                    <MarkdownMessage content={message.content} />
                  ) : isStreamingThis ? (
                    <p className="text-[15px] leading-relaxed text-fg-subtle">
                      <Caret />
                    </p>
                  ) : null}
                  {isStreamingThis && message.content ? <Caret /> : null}
                  {isLast && !streaming && message.content ? (
                    <AssistantActions content={message.content} onRegenerate={onRegenerate} />
                  ) : null}
                </div>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </div>
  );
}
