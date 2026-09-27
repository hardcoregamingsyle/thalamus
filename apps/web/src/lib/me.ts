// GET /api/me. This app is a static export with no server runtime, so every
// page fetches this client-side (same origin in production, rewritten to
// the local gateway under `next dev`) rather than during a server render.
import type { MeResponse } from "./types";

export type MeResult = { ok: true; data: MeResponse } | { ok: false };

export async function fetchMe(): Promise<MeResult> {
  try {
    const res = await fetch("/api/me");
    if (!res.ok) return { ok: false };
    const data = (await res.json()) as MeResponse;
    return { ok: true, data };
  } catch {
    // Network error (e.g. the gateway isn't reachable) — fail to signed-out
    // rather than throwing and breaking the page.
    return { ok: false };
  }
}
