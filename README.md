# Thalamus

Thalamus is a first-party AI provider serving the in-house Thalamus Sophon models, built on a non-transformer architecture: an OpenAI-compatible API, a developer console and a web chat app at [thalamus.aphantic.skinticals.com](https://thalamus.aphantic.skinticals.com). It is in private beta with a waitlist until the model can take external traffic.

The design is in [docs/architecture.md](docs/architecture.md); the interface to the model server is [docs/model-server.md](docs/model-server.md).

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
