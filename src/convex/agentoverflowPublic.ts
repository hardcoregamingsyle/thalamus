import { httpAction } from "./_generated/server";
import { vmFetch } from "./agentoverflow";

// ── Public, unauthenticated surface for SEO ───────────────────────────────────
// Every corpus document gets a crawlable page on the AgentOverflow site at
// /q/<doc_id>; these endpoints feed those pages and tell crawlers where they
// all live. No credits involved — this half exists to get found.

function publicCors() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

function publicJson(status: number, payload: unknown, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json", ...publicCors(), ...extra },
  });
}

function xml(status: number, body: string, maxAge: number): Response {
  return new Response(body, {
    status,
    headers: {
      "Content-Type": "application/xml",
      "Cache-Control": `public, max-age=${maxAge}`,
      ...publicCors(),
    },
  });
}

const DOC_ID = /^[A-Za-z0-9_-]{3,64}$/;

export const aoPublicOptions = httpAction(
  async () => new Response(null, { status: 204, headers: publicCors() }),
);

// GET /ao/public/doc?id=<doc_id> — one corpus document, cacheable for an hour.
export const aoPublicDoc = httpAction(async (_ctx, request) => {
  const id = new URL(request.url).searchParams.get("id") ?? "";
  if (!DOC_ID.test(id)) {
    return publicJson(400, { error: { code: "bad_request", message: "Invalid doc id." } });
  }
  try {
    const res = await vmFetch(`/internal/doc/${id}`, undefined, "GET");
    if (res.status === 404) {
      return publicJson(404, { error: { code: "not_found", message: "No such document." } });
    }
    if (!res.ok) throw new Error(`VM doc fetch failed: ${res.status}`);
    const doc = (await res.json()) as Record<string, unknown>;
    return publicJson(200, doc, { "Cache-Control": "public, max-age=3600" });
  } catch {
    return publicJson(503, {
      error: { code: "backend_unavailable", message: "The corpus backend is unreachable." },
    });
  }
});

// GET /ao/sitemap.xml — index pointing at the paged sitemaps below.
export const aoSitemapIndex = httpAction(async () => {
  try {
    const res = await vmFetch("/internal/sitemap-index", undefined, "GET");
    if (!res.ok) throw new Error(`VM sitemap-index failed: ${res.status}`);
    const { pages } = (await res.json()) as { pages: number };
    const base = (process.env.CONVEX_SITE_URL ?? "").replace(/\/$/, "");
    const entries = Array.from(
      { length: Math.max(pages, 0) },
      (_, i) => `<sitemap><loc>${base}/ao/sitemaps/${i}.xml</loc></sitemap>`,
    ).join("");
    return xml(
      200,
      `<?xml version="1.0" encoding="UTF-8"?><sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${entries}</sitemapindex>`,
      21600,
    );
  } catch {
    return xml(503, `<?xml version="1.0" encoding="UTF-8"?><error/>`, 60);
  }
});

// GET /ao/sitemaps/<n>.xml — up to 10k /q/ URLs per page, straight from the VM.
export const aoSitemapPage = httpAction(async (_ctx, request) => {
  const match = new URL(request.url).pathname.match(/^\/ao\/sitemaps\/(\d{1,6})\.xml$/);
  if (!match) return xml(404, `<?xml version="1.0" encoding="UTF-8"?><error/>`, 60);
  const site = (process.env.AO_FRONTEND_URL ?? "").replace(/\/$/, "");
  try {
    const res = await vmFetch(`/internal/sitemap/${match[1]}`, undefined, "GET");
    if (res.status === 404) return xml(404, `<?xml version="1.0" encoding="UTF-8"?><error/>`, 60);
    if (!res.ok) throw new Error(`VM sitemap page failed: ${res.status}`);
    const { doc_ids } = (await res.json()) as { doc_ids: string[] };
    const entries = doc_ids
      .filter((id) => DOC_ID.test(id))
      .map((id) => `<url><loc>${site}/q/${id}</loc></url>`)
      .join("");
    return xml(
      200,
      `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${entries}</urlset>`,
      21600,
    );
  } catch {
    return xml(503, `<?xml version="1.0" encoding="UTF-8"?><error/>`, 60);
  }
});
