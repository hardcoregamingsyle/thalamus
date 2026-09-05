// Which privacy regime is this visitor under?
//
// The consent banner is deliberately not shown worldwide: the product decision
// is a banner for UK/EU visitors and untouched analytics everywhere else. That
// needs the visitor's country before any tag loads, and the only place that is
// known for free and reliably is the edge — Cloudflare puts it on
// `request.cf.country`, so there is no IP database to ship or geo-IP call to
// make. The client asks once, caches the answer for the session, and loads
// tags accordingly.
//
// Deliberately not cached at the edge: a shared cache entry would hand one
// country's answer to the next visitor, which in this case means showing the
// wrong privacy regime.

// EU 27 + the three non-EU EEA states (GDPR applies via the EEA agreement) + UK
// (UK GDPR). Switzerland is included too: the revised FADP is close enough in
// consent expectations that the cheap answer is to treat it the same.
const CONSENT_REQUIRED = new Set([
  "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR",
  "HU", "IE", "IT", "LV", "LT", "LU", "MT", "NL", "PL", "PT", "RO", "SK",
  "SI", "ES", "SE",
  "IS", "LI", "NO",
  "GB", "CH",
]);

export function onRequestGet(context) {
  const country = context.request.cf?.country ?? null;
  // Unknown country fails safe: ask for consent rather than assume it is not
  // needed. `T1` is Cloudflare's marker for Tor exits, which is exactly the
  // visitor least likely to want an untouched analytics tag.
  const required = country === null || country === "T1" || CONSENT_REQUIRED.has(country);
  return new Response(JSON.stringify({ country, consentRequired: required }), {
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}
