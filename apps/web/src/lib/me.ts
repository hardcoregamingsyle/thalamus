// GET /api/me. This app is a static export with no server runtime, so every
// page fetches this client-side through the same-origin Convex proxy.
import type { MeResponse } from "./types";

export type MeResult = { ok: true; data: MeResponse } | { ok: false };

export async function fetchMe(): Promise<MeResult> {
  try {
    const res = await fetch("/api/me");
    if (!res.ok) return { ok: false };
    const data = (await res.json()) as MeResponse;
    return { ok: true, data };
  } catch {
    // Network error (e.g. Convex isn't reachable) — fail to signed-out
    // rather than throwing and breaking the page.
    return { ok: false };
  }
}
