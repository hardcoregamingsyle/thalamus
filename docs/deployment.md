# Deployment & CI/CD

## Deployment Targets

| Component | Where it Deploys | How |
|-----------|-----------------|-----|
| Web Frontend | Cloudflare Pages | Builds from `main` with `npm ci` — keep `package-lock.json` in sync with `package.json` |
| Backend (Convex) | Convex Cloud (`befitting-wildebeest-866`) | `npx convex deploy` |
| Desktop App (.exe) | GitHub Releases | GitHub Actions on `v*` tag push |

## GitHub Actions — CI

**File:** `.github/workflows/ci.yml`

Runs on every push and pull request targeting `main`. Two jobs:

| Job | Steps |
|-----|-------|
| `web` (ubuntu) | Checkout this repo → checkout `hardcoregamingsyle/agentoverflow` into `.agentoverflow` → `npm ci --dry-run` (lockfile sync) → `bun install --frozen-lockfile` → `bun run type-check` → `bun run lint` → `bun run check-refs` (with `AGENTOVERFLOW_DIR` pointed at the sibling checkout) → `bun test` → `bun run build` |
| `desktop` (windows) | Checkout → setup .NET 8 → `dotnet build thalamus-native/ThalamusApp/ThalamusApp.csproj -c Release` |

`check-refs` exists because the generated Convex `api`/`internal` objects exceed TypeScript's instantiation depth and degrade to `any`, and because three callers — the shipped `.exe`, the AgentOverflow repo, and crons — reach the backend by plain string. It is the only gate on those names, which is why CI checks out the other repo.

CI does not run on tags and does not deploy anything.

## GitHub Actions — Desktop Release

**File:** `.github/workflows/release.yml`

### Trigger

- Push a tag matching `v*` (e.g., `v2.0.1`)
- OR manual `workflow_dispatch` with a version input

### Pipeline Steps

| Step | What it Does |
|------|-------------|
| 1. Checkout | Clone repo (`actions/checkout@v4`) |
| 2. Setup .NET | Install .NET 8 SDK (`actions/setup-dotnet@v4`) |
| 3. Get version | Extract version from tag or manual input, validate format |
| 4. Restore | `dotnet restore` the ThalamusApp project |
| 5. Publish | Self-contained single-file build for win-x64 with compression |
| 6. Rename | Output renamed to `Thalamus.exe` |
| 7. Upload artifact | Store as workflow artifact for debugging |
| 8. Create Release | `softprops/action-gh-release@v2` creates release with exe attached |

### Important Settings

```yaml
permissions:
  contents: write    # REQUIRED for GITHUB_TOKEN to create releases
```

Without `contents: write`, the release step fails with "Resource not accessible by integration."

### Release Example

```bash
git tag v2.1.0
git push origin v2.1.0
# GitHub Actions auto-builds and creates release
```

### Local Desktop Build

CI only publishes the bare `Thalamus.exe`. For the installer (`ThalamusSetup.exe` and the optional Inno Setup wrapper), build locally:

```powershell
cd thalamus-native
.\build.ps1 -Version "2.1.0"
```

See `thalamus-native/BUILD.md` for details.

## Convex Backend Deployment

### Production Deploy

```bash
npx convex deploy
```

This pushes all functions in `src/convex/` to the production Convex deployment. It's a zero-downtime deployment — the new functions replace old ones atomically.

Note for the maintainer's machine: `.env.local` points at a different (dev) deployment, so a bare `npx convex …` targets the wrong project. The gitignored `convex-prod.ps1` wrapper forces the production deploy key — `.\convex-prod.ps1 deploy -y`.

### Environment Variables (Server-Side)

Managed in the Convex Dashboard (NOT `.env` files):

| Variable | Purpose |
|----------|---------|
| `NVAPI_KEY` | NVIDIA NIM — fallback when the `nimKeys` table is empty |
| `OLLAMA_API_KEY`, `OLLAMA_API_KEY_2`…`_10` | Ollama Cloud — fallback when the `ollamaKeys` table is empty |
| `MODAL_ENDPOINT_URL` / `MODAL_MODEL` / `MODAL_API_KEY` | A single Modal endpoint — fallback when `modalEndpoints` is empty |
| `AWS_BEDROCK_API_KEY` | Claude via Bedrock — chat, study and `/stream-chat` only |
| `GEMINI_API_KEY` / `GOOGLE_AI_API_KEY` | RAG embeddings (`rag.ts` reads env, not the `geminiKeys` table) |
| `GOOGLE_API_KEY` + `GOOGLE_CX` | Google Custom Search behind `performSearch` |
| `SKETCHFAB_API_TOKEN` / `SKETCHFAB_MCP_URL` | Built-in Sketchfab MCP server |
| `HF_RAG_SPACE_URL` / `HF_RAG_BASE_URL` | GraphRAG space override |
| `ADMIN_TOKEN` | Admin authentication |
| `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` | GitHub OAuth app |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google OAuth app |
| `GITHUB_TOKEN` | Repo-sync fallback token |
| `FRONTEND_URL` | Base URL for OAuth callbacks |
| `BREVO_EMAIL_SENDER` | Brevo API key for OTP emails (the name is misleading) |
| `BMAC_WEBHOOK_SECRET` | Buy Me a Coffee webhook verification |
| `API_KEY_ENCRYPTION_SECRET` | AES-256-GCM key for user-supplied provider keys at rest (storage fails closed without it) |
| `AO_VM_URL` / `AO_INTERNAL_SECRET` / `AO_FRONTEND_URL` / `AO_MCP_API_KEY` / `AO_MCP_URL` | AgentOverflow — corpus VM, OAuth allowlist, built-in MCP key |

`CONVEX_SITE_URL` is provided by Convex itself and does not need to be set.

Every model provider prefers its database table over the environment variable: `nimKeys`, `ollamaKeys`, `modalEndpoints`, `awsCredentials`, `geminiKeys` — all managed through the `/admin` panel. `paymentsConfig.webhookSecret` likewise takes priority over `BMAC_WEBHOOK_SECRET`.

### Dev vs Production

- **Dev:** `npx convex dev` (starts local watcher, pushes on file changes)
- **Prod:** `npx convex deploy` (one-time push, no watcher)

Which deployment each targets comes from `CONVEX_DEPLOYMENT` in `.env.local`, so they do not necessarily point at the same project — confirm the target before deploying.

## Web Frontend Deployment

### Build

```bash
bun run build
# Output: dist/ folder (static assets)
```

### Cloudflare Pages

Pushing to `main` is the deploy. Pages installs with `npm ci`, which is why `package-lock.json` must stay in sync with `package.json` — CI gates on exactly that.

### Any Other Static Host

The app is a pure SPA — upload `dist/` and configure the host to serve `index.html` for all routes (SPA fallback).

Required environment at build time:
```
VITE_CONVEX_URL=https://befitting-wildebeest-866.convex.cloud
```

## Convex Deployment Details

- **Deployment slug:** `befitting-wildebeest-866`
- **URL:** `https://befitting-wildebeest-866.convex.cloud`
- **Dashboard:** `https://dashboard.convex.dev`

## Release Workflow (Full)

1. Make code changes; run the quality gates locally (`type-check`, `lint`, `check-refs`, `bun test`, `bun run build`)
2. `npx convex deploy` (push backend)
3. Push to `main` — Cloudflare Pages builds the frontend
4. If desktop changes: `git tag v2.x.x && git push origin v2.x.x` (triggers `release.yml`)
5. Verify the GitHub Release carries an asset named exactly `Thalamus.exe`

Step 5 is the whole job. Every website download link and the installer's own `URL_APP` point at `releases/latest/download/Thalamus.exe`, so a release published without that asset name 404s for everyone. There is no separate version endpoint to update — the desktop app's update check reads the GitHub Releases API directly and only shows a notice.
