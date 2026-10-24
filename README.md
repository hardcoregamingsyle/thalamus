# NAMELESS

NAMELESS is an AI model under training on our own architecture. This repository ships its prelaunch waitlist at `nameless.is` on Cloudflare Pages, with Convex for accounts and database.

Creating an account automatically enrolls the user. Convex assigns waitlist positions transactionally and schedules slot notification emails through the existing Brevo service. An administrator chooses when capacity is available. Context, memory, reasoning, and cost capabilities remain development goals pending evaluation.

## Development

Requirements: Node 22 or newer and Bun 1.3.14.

```bash
bun install --frozen-lockfile
bun run test
bun run type-check
bun run --filter=@thalamus/web dev
bun run build
```

The frontend runs on port 5173 and forwards account requests to `CONVEX_SITE_URL`. The default points at the existing Convex deployment; use a development deployment for signup testing. No Postgres, model server, chat API, or gateway Worker is required.

| Path | Purpose |
|---|---|
| `apps/web` | Static waitlist, account status, and administration UI |
| `functions` | Cloudflare Pages account proxy and OAuth callback |
| `apps/convex/convex` | Account authentication, transactional waitlist, and email jobs |
| `apps/convex/test` | Credential-free Convex database and HTTP tests |
| `scripts/assemble-pages.mjs` | Assemble Pages output and security headers |

See [deployment instructions](docs/nameless-deployment.md). Legacy internal workspace names remain compatible. Removed application code remains available in Git history.
