// Production builds ship as a static export: Cloudflare Pages serves
// dist/ (assembled from apps/web/out, see scripts/assemble-pages.mjs) and
// Pages Functions (repo-root functions/) forward /api/* to Convex — this app
// never runs a Node/Workers server at request time. `next dev` is the
// opposite: there's no static export and no Pages Functions, so it rewrites
// straight to the configured Convex HTTP backend instead. Rewrites and `output: "export"` are
// mutually exclusive (Next rejects rewrites during an export build), hence
// the branch rather than one merged config.
const isDev = process.env.NODE_ENV === "development";

/** @type {import('next').NextConfig} */
const nextConfig = isDev
  ? {
      async rewrites() {
        const convexSite =
          process.env.CONVEX_SITE_URL ?? "https://befitting-wildebeest-866.convex.site";
        return [{ source: "/api/:path*", destination: `${convexSite}/nameless/api/:path*` }];
      },
    }
  : {
      output: "export",
      images: { unoptimized: true },
    };

export default nextConfig;
