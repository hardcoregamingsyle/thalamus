# NAMELESS web

Next.js static export for the NAMELESS waitlist. From the repository root, use `bun run --filter=@thalamus/web dev` on port 5173 or `bun run build` for Cloudflare Pages output in `dist/`.

Account requests use same-origin `/api/*` endpoints. In production, Pages Functions proxy them to `/nameless/api/*` on `CONVEX_SITE_URL`; `next dev` applies the same mapping through rewrites. OAuth returns to the Pages `/auth/callback` function, which enrolls the account through Convex and sets an HttpOnly cookie before redirecting to `/console`.

There is no chat UI, public model API, separate gateway Worker, or SQL database dependency. Backend details and deployment checks are in [the deployment guide](../../docs/nameless-deployment.md).
