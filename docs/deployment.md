# Deployment & CI/CD

## Deployment Targets

| Component | Where it Deploys | How |
|-----------|-----------------|-----|
| Web Frontend | Any static host (Vercel, Netlify, etc.) | `bun run build` → upload `dist/` |
| Backend (Convex) | Convex Cloud | `npx convex deploy` |
| Desktop App (.exe) | GitHub Releases | GitHub Actions on tag push |

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

## Convex Backend Deployment

### Production Deploy

```bash
npx convex deploy
```

This pushes all functions in `src/convex/` to the production Convex deployment. It's a zero-downtime deployment — the new functions replace old ones atomically.

### Environment Variables (Server-Side)

Managed in the Convex Dashboard (NOT `.env` files):

| Variable | Purpose |
|----------|---------|
| `AWS_BEDROCK_API_KEY` | Claude API via Bedrock |
| `AGENTROUTER_API_KEY` | VLY agent router gateway |
| `ADMIN_TOKEN` | Admin authentication |
| `GITHUB_CLIENT_ID` | GitHub OAuth app |
| `GITHUB_CLIENT_SECRET` | GitHub OAuth app |
| `JWKS` | JSON Web Key Set (legacy) |
| `JWT_PRIVATE_KEY` | JWT signing (legacy) |
| `SITE_URL` | Base URL for OAuth callbacks |
| `BREVO_EMAIL_SENDER` | Email sending key |

Additionally, AWS credentials and Gemini keys can be managed through the `/admin` panel and stored in database tables (`awsCredentials`, `geminiKeys`). Database values take priority over environment variables.

### Dev vs Production

- **Dev:** `npx convex dev` (starts local watcher, pushes on file changes)
- **Prod:** `npx convex deploy` (one-time push, no watcher)

Both point at the same cloud deployment but dev mode auto-syncs as you code.

## Web Frontend Deployment

### Build

```bash
bun run build
# Output: dist/ folder (static assets)
```

### Self-Hosted Deploy

```bash
bun run deploy:selfhosted
# Runs scripts/deploy-selfhosted.sh
```

### Static Host Deploy

Upload the `dist/` folder to any static host. The app is a pure SPA — configure the host to serve `index.html` for all routes (SPA fallback).

Required environment at build time:
```
VITE_CONVEX_URL=https://glad-ermine-937.convex.cloud
```

## Convex Deployment Details

- **Deployment slug:** `glad-ermine-937`
- **URL:** `https://glad-ermine-937.convex.cloud`
- **Dashboard:** `https://dashboard.convex.dev`

## Release Workflow (Full)

1. Make code changes, test locally
2. `npx convex deploy` (push backend)
3. `bun run build` + deploy frontend
4. If desktop changes: `git tag v2.x.x && git push origin v2.x.x` (triggers CI)
5. Verify GitHub Release has the new .exe
6. Update download links on the website if needed
