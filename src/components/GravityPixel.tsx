import { useEffect } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";

const PIXEL_SRC = "https://code.trygravity.ai/gr-pix.js";
const SCRIPT_ID = "gravity-pixel";

// We deliberately do not ship Gravity's copy-paste snippet.
//
// Reading gr-pix.js: alongside page/click measurement it carries canvas, WebGL,
// font-enumeration and audio fingerprinting, an rrweb session recorder that
// POSTs DOM recordings to /track/gr-replay, form-field scanning, and optional
// Facebook and OpenAI pixel piggybacks. All of it is driven by
//
//     CONFIG = Object.assign({}, DEFAULT_CONFIG, window.GRAVITY_PIXEL_CONFIG)
//
// so a page-side object wins outright — but only if it exists before the script
// parses, which is why it is set here rather than after the tag is appended.
//
// Today's defaults have replay and raw field capture off and fingerprinting ON.
// Every one of them is pinned below instead of inherited: the script is
// third-party hosted, unversioned, and served with a four-hour cache, so "off
// by default" describes the build we happened to read, not a promise about the
// next one. Pinning costs six lines and survives a vendor default flip.
//
// Fingerprinting stays off because Thalamus tutors school students. Building a
// durable cross-site device identity for minors is a different product from
// counting ad impressions, and only the second one is being asked for.
const PIXEL_CONFIG: Record<string, unknown> = {
  enableFingerprinting: false,
  enableSessionReplay: false,
  captureIdentityFields: false,
  captureDebugFields: false,
  replayMaskAllInputs: true,
  ignoreGPC: false, // honour Global Privacy Control
  openaiPixelId: null,
};

/**
 * Loads the Gravity measurement pixel when an admin has set a Pixel ID.
 *
 * Required for attribution and payouts, and it is what flips their dashboard's
 * Events Manager to "Active" — so it has to run before ad serving is approved,
 * not after. That is why it reads its own query instead of the ads config:
 * gating it on the ads master switch would park approval behind the very thing
 * approval unlocks.
 */
export function GravityPixel() {
  const pixelId = useQuery(api.gravityAds.getPixelId, {});

  useEffect(() => {
    if (!pixelId) return;
    if (document.getElementById(SCRIPT_ID)) return;

    window.GRAVITY_PIXEL_CONFIG = { ...PIXEL_CONFIG };

    // Their loader stub, unminified. The script's processQueue() reads
    // window[window.GravityPixelObject].q as an array of argument arrays, so
    // init survives the script still being in flight.
    const existing = window.gravity;
    let g: GravityFn;
    if (existing) {
      g = existing;
    } else {
      const fn: GravityFn = (...args: unknown[]) => {
        (fn.q = fn.q ?? []).push(args);
      };
      fn.l = Date.now();
      window.gravity = fn;
      g = fn;
    }
    window.GravityPixelObject = "gravity";
    g("init", pixelId);

    const script = document.createElement("script");
    script.id = SCRIPT_ID;
    script.async = true;
    script.src = PIXEL_SRC;
    document.head.appendChild(script);
  }, [pixelId]);

  return null;
}
