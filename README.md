# NAMELESS

NAMELESS is an AI model under training on our own architecture. The site at `nameless.is` is a prelaunch waitlist: creating an account automatically enrolls the user, and an administrator grants a slot and sends an email notification.

The product goals are unlimited context, persistent memory, stronger reasoning, and low ongoing costs, with response speed as a tradeoff. Measurements and final pricing remain pending evaluation.

The preferred deployment is Cloudflare Pages. See [NAMELESS deployment](docs/nameless-deployment.md) for bindings, authentication, slot notifications, and deployment checks. The older architecture documents describe the existing backend; internal package names and API model identifiers remain compatible.

## Layout

| Path | What it is |
|---|---|
| `apps/gateway` | Cloudflare Worker serving the public `/v1` API and the web app's `/api` |
| `apps/web` | Next.js static export served by Cloudflare Pages |
| `functions/` | Pages Functions forwarding `/api/*` and `/v1/*` to the gateway |
| `apps/convex` | The shared Convex backend: accounts, the AgentOverflow backend, the session relay |
| `packages/contract`, `packages/db` | Shared types and signing; Postgres schema and migrations |
| `tools/mock-model-server` | Local model server for development and tests |

## Development

Requirements: [Bun](https://bun.sh) 1.3 and Node 22 or later.

```bash
bun install
bun run test
bun run --filter=@thalamus/mock-model-server dev   # model server on :8788
bun run --filter=@thalamus/gateway dev             # gateway on :8787 (needs DATABASE_URL)
bun run --filter=@thalamus/web dev                 # web app on :5173
```

## Previous codebase

The Thalamus codebase before the rebuild is preserved at the tag [`archive/pre-redo-2026-09`](https://github.com/hardcoregamingsyle/thalamus/tree/archive/pre-redo-2026-09). Restore a file from it with:

```bash
git checkout archive/pre-redo-2026-09 -- <path>
```
