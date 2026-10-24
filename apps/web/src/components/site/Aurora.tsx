/** Static CSS glow: no canvas, WebGL context, observers, or render loop. */
export function Aurora({ className = "" }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={`bg-[radial-gradient(ellipse_60%_45%_at_50%_30%,color-mix(in_srgb,var(--raw-grad-2)_22%,transparent),transparent_70%)] ${className}`}
    />
  );
}
