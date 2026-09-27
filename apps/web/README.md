# @thalamus/web

The marketing site, waitlist, developer console, chat app and API docs. Ships as a static
export — no server runtime — deployed to the Cloudflare Pages project `thalamus`. `/api/*` and
`/v1/*` are handled by the repo-root `functions/` (Pages Functions), which forward to the
`thalamus-gateway` Worker through a service binding; `/auth/callback` is its own Pages Function
that exchanges an OAuth token for a session cookie server-side.

## Dev workflow

```
bun run dev
```

Starts `next dev` on port 5173. There's no Pages runtime in dev, so `next.config.mjs` rewrites
`/api/:path*` and `/v1/:path*` to a local gateway instead — by default `http://localhost:8787`,
overridable with `GATEWAY_DEV_ORIGIN`. Run the gateway alongside it:

```
bun run --filter=@thalamus/gateway dev
```

`bun run build` (from the repo root) produces the static export (`apps/web/out`) and assembles
the Cloudflare Pages deploy directory (`dist/`, plus `dist/_headers`) — see
`scripts/assemble-pages.mjs`.

## Testing the OAuth callback

**In production**, `/auth/callback` is a Pages Function (`functions/auth/callback.ts`): Convex
redirects there with `?token=`, the function exchanges it for a session cookie against the
gateway (through the `GATEWAY` service binding) and 302s to `/console`, copying every
`Set-Cookie`. The token never reaches client-side JS or stays in the URL/history.

**Locally**, `next dev` doesn't run Pages Functions, so exercise the real path with Wrangler
instead:

1. Build the static export: `bun run --filter=@thalamus/web build`.
2. Run the gateway: `bunx wrangler dev` (from `apps/gateway`).
3. Serve the export with Pages Functions: `bunx wrangler pages dev apps/web/out` (from the repo
   root, so it also picks up the root `wrangler.toml` and `functions/`), bound to the gateway
   Worker started in step 2.
4. Visit `/auth`, sign in, and follow the OAuth redirect through to `/auth/callback` for real.
