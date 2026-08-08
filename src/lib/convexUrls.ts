/**
 * URL helpers for the two Convex hosts.
 *
 * VITE_CONVEX_URL points at the *.convex.cloud origin (queries/mutations via
 * the Convex client). HTTP actions — SSE streaming, OAuth callbacks, the
 * OpenAI-compatible /api/v1 endpoint, webhooks — are served from the sibling
 * *.convex.site origin. This rewrite used to be inlined in six different
 * files; it lives here so the scheme can change in one place.
 */

/** The *.convex.cloud origin the Convex client talks to. */
export function convexCloudUrl(): string {
  return (import.meta.env.VITE_CONVEX_URL as string | undefined) ?? "";
}

/**
 * The *.convex.site origin that serves HTTP actions, with an optional path
 * appended (leading slash added if missing).
 */
export function convexSiteUrl(path = ""): string {
  const base = convexCloudUrl().replace(".convex.cloud", ".convex.site");
  if (!path) return base;
  return `${base}${path.startsWith("/") ? "" : "/"}${path}`;
}
