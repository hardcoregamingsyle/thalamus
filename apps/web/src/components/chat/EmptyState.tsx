"use client";

import { useReducedMotion, motion } from "motion/react";
import { LogoMark } from "@/components/ui/Logo";
import { EASE_OUT } from "@/components/ui/Reveal";
import { Composer } from "./Composer";

export function EmptyState({
  value,
  onChange,
  onSend,
  onStop,
  streaming,
  disabled,
  error,
}: {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  onStop: () => void;
  streaming: boolean;
  disabled: boolean;
  error: string | null;
}) {
  const still = useReducedMotion();
  return (
    <motion.div
      initial={still ? false : { opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: EASE_OUT }}
      className="flex flex-1 flex-col items-center justify-center px-4 pb-24"
    >
      <LogoMark className="h-10 w-10" />
      <h1 className="mt-5 text-2xl font-semibold tracking-tight text-fg sm:text-3xl">
        What&apos;s on your mind?
      </h1>
      <div className="mt-8 w-full max-w-3xl">
        <Composer
          value={value}
          onChange={onChange}
          onSend={onSend}
          onStop={onStop}
          streaming={streaming}
          disabled={disabled}
          autoFocus
        />
        {error ? (
          <p role="alert" className="mt-3 text-center text-sm text-danger">
            {error}
          </p>
        ) : null}
      </div>
    </motion.div>
  );
}
