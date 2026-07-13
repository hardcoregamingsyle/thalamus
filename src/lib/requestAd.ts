// Fetch a contextual ad through our /ad HTTP endpoint (a Convex httpAction),
// NOT the Convex action directly. Going over plain fetch means the request
// carries the real end user's User-Agent and IP in its headers, which the
// endpoint forwards to Gravity as device signals — so ads target/fill for the
// actual user instead of our datacenter. The Gravity key stays server-side.
//
// Returns the ad (a single object, or an array when count > 1) or null.
// Never throws — ads must never break chat.

function adEndpoint(): string {
  const convexUrl = (import.meta.env.VITE_CONVEX_URL as string) || "";
  return convexUrl.replace(".convex.cloud", ".convex.site") + "/ad";
}

export async function fetchSponsoredAd(args: {
  token?: string;
  messages: Array<{ role: string; content: string }>;
  sessionId?: string;
  count?: number;
}): Promise<unknown | null> {
  try {
    const res = await fetch(adEndpoint(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(args),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { ad?: unknown };
    return data.ad ?? null;
  } catch {
    return null;
  }
}
