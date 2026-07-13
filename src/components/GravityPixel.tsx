import { useEffect } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";

type GravityFn = ((...args: unknown[]) => void) & { q?: unknown[][]; l?: number };

// Loads the Gravity measurement pixel (attribution + payouts) exactly once, when
// an admin has set a Pixel ID in /admin → GravityAds. The Pixel ID is a Gravity
// dashboard UUID, separate from the ad API key. No-op until one is configured.
export default function GravityPixel() {
  const config = useQuery(api.gravityAds.getPublicAdsConfig) as { pixelId?: string } | null | undefined;
  const pixelId = config?.pixelId;

  useEffect(() => {
    if (!pixelId) return;
    const w = window as Window & { GravityPixelObject?: string; gravity?: GravityFn };
    // Gravity's official loader snippet, once — then (re)init with the id.
    if (!w.gravity) {
      const g = ((...args: unknown[]) => { (g.q = g.q || []).push(args); }) as GravityFn;
      g.l = Number(new Date());
      w.GravityPixelObject = "gravity";
      w.gravity = g;
      const s = document.createElement("script");
      s.async = true;
      s.src = "https://code.trygravity.ai/gr-pix.js";
      document.head.appendChild(s);
    }
    w.gravity("init", pixelId);
  }, [pixelId]);

  return null;
}
