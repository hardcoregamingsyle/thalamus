// Production builds ship as a static export: Cloudflare Pages serves
// dist/ (assembled from apps/web/out, see scripts/assemble-pages.mjs) and
// Pages Functions (repo-root functions/) handle /api/* and /v1/* — this app
// never runs a Node/Workers server at request time. `next dev` is the
// opposite: there's no static export and no Pages Functions, so it rewrites
// straight to a local gateway instead. Rewrites and `output: "export"` are
// mutually exclusive (Next rejects rewrites during an export build), hence
// the branch rather than one merged config.
const isDev = process.env.NODE_ENV === "development";

/** @type {import('next').NextConfig} */
const nextConfig = isDev
  ? {
      async rewrites() {
        const gateway = process.env.GATEWAY_DEV_ORIGIN ?? "http://localhost:8787";
        return [
          { source: "/api/:path*", destination: `${gateway}/api/:path*` },
          { source: "/v1/:path*", destination: `${gateway}/v1/:path*` },
        ];
      },
    }
  : {
      output: "export",
      images: { unoptimized: true },
    };

export default nextConfig;
