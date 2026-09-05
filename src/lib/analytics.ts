// Loading Google's tags, gated on where the visitor is.
//
// The rule this implements: a consent banner for UK/EU/EEA visitors, and for
// everyone else the tags load immediately with nothing suppressed. That is why
// there is no blanket IP-anonymisation call here — outside the consent regions
// the product decision is untouched analytics, and inside them nothing loads at
// all until the visitor says yes, which is a stronger protection than
// anonymising a hit that fired anyway.
//
// Region comes from functions/geo.js (Cloudflare's edge country). If that call
// fails we fail closed and treat the visitor as needing consent.

const CONSENT_KEY = "thalamus_analytics_consent";
const GEO_KEY = "thalamus_geo_consent_required";

export type Consent = "granted" | "denied";

export interface GeoVerdict {
  consentRequired: boolean;
  country: string | null;
}

export function readConsent(): Consent | null {
  try {
    const v = localStorage.getItem(CONSENT_KEY);
    return v === "granted" || v === "denied" ? v : null;
  } catch {
    return null;
  }
}

export function writeConsent(value: Consent): void {
  try {
    localStorage.setItem(CONSENT_KEY, value);
  } catch {
    /* private mode — the banner simply asks again next visit */
  }
}

/**
 * Ask the edge which regime applies. Cached per tab: the answer cannot change
 * mid-session, and the endpoint is deliberately uncacheable at the edge, so
 * without this every route change would pay for a round trip.
 */
export async function fetchGeoVerdict(): Promise<GeoVerdict> {
  try {
    const cached = sessionStorage.getItem(GEO_KEY);
    if (cached) return JSON.parse(cached) as GeoVerdict;
  } catch {
    /* fall through to the network */
  }
  try {
    const res = await fetch("/geo", { headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error(String(res.status));
    const verdict = (await res.json()) as GeoVerdict;
    try {
      sessionStorage.setItem(GEO_KEY, JSON.stringify(verdict));
    } catch {
      /* not worth failing over */
    }
    return verdict;
  } catch {
    // Fail closed: no answer means we ask before we track.
    return { consentRequired: true, country: null };
  }
}

let loaded = false;

/**
 * Inject GTM and/or GA4. Idempotent — a route change must not stack a second
 * copy of either tag, which is the classic way a SPA doubles its own pageviews.
 *
 * GTM and GA4 are both supported because they are not alternatives: GTM is a
 * container you manage tags from, GA4 is a property. If you configure GA4
 * *inside* GTM as well as setting a GA4 ID here, every pageview is counted
 * twice — set one or the other, not both.
 */
export function loadTags(opts: { ga4Id?: string | null; gtmId?: string | null }): void {
  if (loaded) return;
  const { ga4Id, gtmId } = opts;
  if (!ga4Id && !gtmId) return;
  loaded = true;

  window.dataLayer = window.dataLayer || [];

  if (gtmId) {
    window.dataLayer.push({ "gtm.start": Date.now(), event: "gtm.js" });
    const s = document.createElement("script");
    s.async = true;
    s.src = `https://www.googletagmanager.com/gtm.js?id=${encodeURIComponent(gtmId)}`;
    document.head.appendChild(s);
  }

  if (ga4Id) {
    const s = document.createElement("script");
    s.async = true;
    s.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(ga4Id)}`;
    document.head.appendChild(s);
    // gtag must push `arguments` verbatim: GA reads the arguments object, and a
    // rest-parameter version pushes a plain array which it silently ignores.
    // Hence the cast — the function takes no declared parameters on purpose.
    const gtag = function () {
      // eslint-disable-next-line prefer-rest-params
      window.dataLayer.push(arguments);
    } as (...args: unknown[]) => void;
    window.gtag = gtag;
    gtag("js", new Date());
    // send_page_view stays on: this app routes client-side, and pageviews are
    // re-sent per route by trackPageView below.
    gtag("config", ga4Id);
  }
}

/** Client-side route change — GA4 does not see these on its own. */
export function trackPageView(path: string): void {
  if (!loaded || typeof window.gtag !== "function") return;
  window.gtag("event", "page_view", {
    page_path: path,
    page_location: window.location.href,
    page_title: document.title,
  });
}
