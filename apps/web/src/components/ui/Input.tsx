import { forwardRef, useId, type ComponentProps } from "react";

type Props = ComponentProps<"input"> & {
  label?: string;
  hint?: string;
  error?: string;
};

export const Input = forwardRef<HTMLInputElement, Props>(function Input(
  { label, hint, error, id, className = "", ...rest },
  ref,
) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const hintId = `${inputId}-hint`;
  const errorId = `${inputId}-error`;

  return (
    <div className="flex flex-col gap-1.5">
      {label ? (
        <label htmlFor={inputId} className="text-sm font-medium text-fg">
          {label}
        </label>
      ) : null}
      <input
        id={inputId}
        ref={ref}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : hint ? hintId : undefined}
        className={`h-11 rounded-xl border bg-surface px-3.5 text-[15px] text-fg outline-none transition-colors placeholder:text-fg-subtle focus:border-fg/30 disabled:opacity-50 ${
          error ? "border-danger/50" : "border-border-strong"
        } ${className}`}
        {...rest}
      />
      {error ? (
        <p id={errorId} role="alert" className="text-[13px] text-danger">
          {error}
        </p>
      ) : hint ? (
        <p id={hintId} className="text-[13px] text-fg-subtle">
          {hint}
        </p>
      ) : null}
    </div>
  );
});
