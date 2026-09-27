import Link from "next/link";
import { useId } from "react";

// The mark is a theta: a ring with a bar through it, in the brand gradient.
export function LogoMark({ className = "h-6 w-6" }: { className?: string }) {
  const id = useId();
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true">
      <defs>
        <linearGradient id={id} x1="4" y1="4" x2="28" y2="28" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="var(--raw-grad-1)" />
          <stop offset="0.55" stopColor="var(--raw-grad-2)" />
          <stop offset="1" stopColor="var(--raw-grad-3)" />
        </linearGradient>
      </defs>
      <ellipse
        cx="16"
        cy="16"
        rx="10"
        ry="12.5"
        fill="none"
        stroke={`url(#${id})`}
        strokeWidth="3"
      />
      <rect x="7.5" y="14.5" width="17" height="3" rx="1.5" fill={`url(#${id})`} />
    </svg>
  );
}

export function Logo({ href = "/" }: { href?: string }) {
  return (
    <Link href={href} className="flex items-center gap-2.5 rounded-md" aria-label="Thalamus home">
      <LogoMark />
      <span className="text-[15px] font-semibold tracking-tight text-fg">Thalamus</span>
    </Link>
  );
}
