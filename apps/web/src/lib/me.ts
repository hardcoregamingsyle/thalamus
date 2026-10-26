// GET /api/me. This app is a static export with no server runtime, so every
// page fetches this client-side through the same-origin Convex proxy.
import type { MeResponse } from "./types";

export type MeResult = { ok: true; data: MeResponse } | { ok: false };

async function requestMe(): Promise<MeResult> {
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

// Share only pending reads. Explicit reloads after a mutation start a fresh
// request, and settled account data is never cached across auth transitions.
let inFlight: Promise<MeResult> | undefined;

export function fetchMe({ refresh = false }: { refresh?: boolean } = {}): Promise<MeResult> {
  if (inFlight && !refresh) return inFlight;
  const request = requestMe();
  inFlight = request;
  void request.then(() => {
    if (inFlight === request) inFlight = undefined;
  });
  return request;
}
