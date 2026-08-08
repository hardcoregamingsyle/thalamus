declare global {
  /** Gravity's analytics stub: calls queue on `.q` until the script drains them. */
  type GravityFn = ((...args: unknown[]) => void) & { q?: unknown[][]; l?: number };

  interface Window {
    /** Gravity measurement pixel — see components/GravityPixel.tsx. */
    gravity?: GravityFn;
    /** Name of the global the pixel script drains its queue from. */
    GravityPixelObject?: string;
    /** Read once at script parse; overrides the pixel's built-in defaults. */
    GRAVITY_PIXEL_CONFIG?: Record<string, unknown>;
  }
}

export {};