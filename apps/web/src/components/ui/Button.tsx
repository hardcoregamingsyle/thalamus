import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md" | "lg";

const base =
  "group inline-flex shrink-0 items-center justify-center gap-2 rounded-full font-medium whitespace-nowrap select-none transition-[background-color,border-color,color,box-shadow,transform] duration-200 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50";

const variants: Record<Variant, string> = {
  primary: "bg-fg text-bg shadow-[0_8px_30px_-12px_rgb(0_0_0/0.6)] hover:bg-fg/90",
  secondary: "border border-border-strong text-fg hover:border-fg/30 hover:bg-surface-strong",
  ghost: "text-fg-muted hover:bg-surface-strong hover:text-fg",
  danger: "border border-danger/40 text-danger hover:bg-danger/10",
};

const sizes: Record<Size, string> = {
  sm: "h-8 px-3.5 text-[13px]",
  md: "h-10 px-5 text-sm",
  lg: "h-12 px-7 text-[15px]",
};

type Common = { variant?: Variant; size?: Size; className?: string; children: ReactNode };

export function buttonClass({
  variant = "primary",
  size = "md",
  className = "",
}: Omit<Common, "children">) {
  return `${base} ${variants[variant]} ${sizes[size]} ${className}`;
}

export function Button({ variant, size, className, ...rest }: Common & ComponentProps<"button">) {
  return <button type="button" className={buttonClass({ variant, size, className })} {...rest} />;
}

export function ButtonLink({
  variant,
  size,
  className,
  href,
  ...rest
}: Common & ComponentProps<typeof Link>) {
  return <Link href={href} className={buttonClass({ variant, size, className })} {...rest} />;
}
