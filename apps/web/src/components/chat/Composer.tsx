"use client";

import { ArrowUp } from "lucide-react";
import { useEffect, useRef, type KeyboardEvent } from "react";

export function Composer({
  value,
  onChange,
  onSend,
  onStop,
  streaming,
  disabled = false,
  autoFocus = false,
}: {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  onStop: () => void;
  streaming: boolean;
  disabled?: boolean;
  autoFocus?: boolean;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);

  useEffect(() => {
    if (autoFocus) textareaRef.current?.focus();
  }, [autoFocus]);

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      if (!disabled && !streaming && value.trim()) onSend();
    }
  }

  const canSend = !disabled && !streaming && value.trim().length > 0;

  return (
    <div>
      <div className="flex items-end gap-2 rounded-3xl border border-border bg-surface px-4 py-2.5 shadow-[0_8px_30px_-16px_rgb(0_0_0/0.5)] transition-colors focus-within:border-border-strong">
        <label htmlFor="chat-composer" className="sr-only">
          Message
        </label>
        <textarea
          id="chat-composer"
          ref={textareaRef}
          rows={1}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={handleKeyDown}
          disabled={disabled || streaming}
          placeholder="Message Thalamus"
          className="max-h-48 min-h-[24px] flex-1 resize-none bg-transparent py-1 text-[15px] leading-6 text-fg placeholder:text-fg-subtle focus:outline-none disabled:opacity-50"
        />
        {streaming ? (
          <button
            type="button"
            onClick={onStop}
            aria-label="Stop generating"
            title="Stop generating"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-fg text-bg transition-transform active:scale-95"
          >
            <span className="h-2.5 w-2.5 rounded-[3px] bg-bg" />
          </button>
        ) : (
          <button
            type="button"
            onClick={onSend}
            disabled={!canSend}
            aria-label="Send message"
            title="Send message"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-fg text-bg transition-[transform,opacity] active:scale-95 disabled:opacity-30"
          >
            <ArrowUp className="h-4 w-4" strokeWidth={2.25} />
          </button>
        )}
      </div>
      <p className="mt-2.5 px-1 text-center text-xs text-fg-subtle">
        Thalamus Sophon is in private beta.
      </p>
    </div>
  );
}
