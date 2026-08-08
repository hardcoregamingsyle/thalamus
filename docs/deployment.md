# Deployment and CI/CD

## Deploy targets

| Component | Where | How |
|---|---|---|
| Web frontend | Cloudflare Pages | `npm ci` + `bun run build` on push to `main`. Both `bun.lock` and `package-lock.json` must stay in sync — CI gates on `npm ci --dry-run`. |
| Backend (Convex) | Convex Cloud (`befitting-wildebeest-866`) | `.github/workflows/convex-deploy.yml` fires via `workflow_run` after CI passes on `main`. Runs `npx convex deploy --yes` using the `CONVEX_DEPLOY_KEY` repo secret, then a smoke test against `ai:guestSendMessage`. There is no local `convex login` on this machine — production deploys always go through CI. |
| Desktop app | GitHub Releases | `.github/workflows/release.yml` on `v*` tag push builds the bare `Thalamus.exe`. The installer, Inno-wrapped `Thalamus-Setup-*.exe`, and checksums are built locally via `thalamus-native/build.ps1` and uploaded by hand. |

## GitHub Actions

### `ci.yml`

Runs on every push and pull request targeting `main`.

**Web job** (`ubuntu-latest`), in order:

1. Checkout this repo.
2. Checkout `hardcoregamingsyle/agentoverflow` into `.agentoverflow`. Its 27 cross-repo Convex references have no codegen — this checkout lets `check-refs` see them.
3. `bun` setup.
4. `npm ci --dry-run --no-audit --no-fund` — verifies `package-lock.json` is still in sync with `package.json`.
5. `bun install --frozen-lockfile`.
6. `bun run type-check`.
7. `bun run lint`.
8. `bun run check-refs` — env: `AGENTOVERFLOW_DIR: ${{ github.workspace }}/.agentoverflow`. The `AGENTOVERFLOW_DIR` env passthrough is the load-bearing coupling to the sibling repo.
9. `bun test`.
10. `bun run build` — catches Vite-stage failures (lazy chunk resolution, asset imports, plugin config) that `tsc` cannot see.

**Desktop job** (`windows-latest`): `dotnet build thalamus-native/ThalamusApp/ThalamusApp.csproj -c Release`.

CI does not run on tags. CI does not deploy anything — that fires from `convex-deploy.yml` afterwards.

### `convex-deploy.yml`

The single Convex deploy workflow. Triggers:

- `workflow_run` on CI success on `main`.
- `workflow_dispatch` for a manual re-run.

Runs `npx convex deploy --yes` using the `CONVEX_DEPLOY_KEY` repo secret (Settings → Secrets and variables → Actions). Then a smoke test:

```
POST https://befitting-wildebeest-866.convex.cloud/api/action
Content-Type: application/json
{
  "path": "ai:guestSendMessage",
  "args": { "content": "Reply with the single word OK", "mode": "chat", "history": [] },
  "format": "json"
}
```

The workflow fails if the response does not contain `"status":"success"`. A successful `npx convex deploy` proves the push landed; the smoke test proves the deployed backend actually answers.

### `release.yml`

Trigger: push a `v*` tag (e.g. `v2.1.0`), or manual `workflow_dispatch` with a version input. Pipeline:

1. Checkout.
2. Setup .NET 8 SDK.
3. Extract and validate version from tag or input.
4. `dotnet restore` for `ThalamusApp`.
5. Publish self-contained single-file for `win-x64` with compression.
6. Rename output to `Thalamus.exe`.
7. Upload as workflow artifact.
8. `softprops/action-gh-release@v2` creates the release with the exe attached.

Requires `permissions: contents: write` for the `GITHUB_TOKEN` to create releases.

CI only publishes the bare `Thalamus.exe`. Website download links point at `releases/latest/download/Thalamus.exe`, so publishing a Release whose asset is named exactly `Thalamus.exe` is the whole job. The installer (`ThalamusSetup.exe`) and Inno wrapper (`Thalamus-Setup-vX.Y.Z.exe`) are built locally:

```powershell
cd thalamus-native
.\build.ps1 -Version "2.1.0"
```

See [`thalamus-native/BUILD.md`](../thalamus-native/BUILD.md).

## Environment variables

Managed in the Convex dashboard, not in `.env` files. This table is the single source of truth — every entry is verified against a `process.env.*` reference in `src/convex/**`.

### Pipeline model providers

| Variable | Purpose |
|---|---|
| `ZEN_API_KEY` | OpenCode Zen client (`lib/zenClient.ts`). Optional — the free tier works without a key. |
| `DEADLYSIGNALS_API_KEY` | Required for the DeadlySignal leg of the pipeline chain (`lib/deadlySignalsClient.ts`). |
| `MODELSCOPE_API_KEY` | Required for the ModelScope leg (`lib/modelscopeClient.ts`). Token format `ms-…` from modelscope.ai/my/myaccesstoken — the `.cn` host rejects them; the client hits the `.ai` host. |
| `OLLAMA_API_KEY`, `OLLAMA_API_KEY_2` … `_10` | Ollama Cloud pool. Read dynamically by `lib/ollamaClient.ts`, so a literal grep for `OLLAMA_API_KEY_5` misses. |
| `MODAL_ENDPOINT_URL` / `MODAL_MODEL` / `MODAL_API_KEY` | Single Modal endpoint fallback when the `modalEndpoints` table is empty (`lib/modalClient.ts`). |
| `VLY_INTEGRATION_KEY` | VLY completion provider (`lib/vlyIntegrations.ts`). Last-resort leg for `/stream-chat` and several `study.ts` paths. Checked lazily at call time — a module-scope check would fail the whole Convex deploy, since push-time analysis loads every module without env vars. |

OVHcloud is anonymous — no API key needed. NVIDIA NIM is not called from the pipeline; there is no `NVAPI_KEY` reader anywhere. `HF_RAG_SPACE_URL` and `HF_RAG_BASE_URL` do not exist in this codebase.

### Legacy chat/study providers

| Variable | Purpose |
|---|---|
| `AWS_BEDROCK_API_KEY` | Bedrock credentials for `/stream-chat`, `ai.ts` `callAI`, and `study.ts` extraction. Accepts `key:secret:region` or an `ABSK…` bearer token. |
| `GEMINI_API_KEY` / `GOOGLE_AI_API_KEY` | `rag.ts` embeddings only. Everything else reads Gemini keys from the `geminiKeys` DB table. |

### Tools

| Variable | Purpose |
|---|---|
| `GOOGLE_API_KEY` + `GOOGLE_CX` | Google Custom Search behind `performSearch`. Without both, `performSearch` degrades to a model-knowledge answer. |
| `SKETCHFAB_API_TOKEN` | Built-in Sketchfab MCP server. Only `download_model` needs a token; search / model-info work without one. |
| `SKETCHFAB_MCP_URL` | Optional override for the Sketchfab MCP URL (defaults to `${CONVEX_SITE_URL}/sketchfab/mcp`). |
| `AO_MCP_URL` | Optional override for the AgentOverflow MCP URL (defaults to `${CONVEX_SITE_URL}/ao/mcp`). |
| `AO_MCP_API_KEY` | `ao_` key that gives every pipeline run built-in AgentOverflow MCP access. |

### Auth and infra

| Variable | Purpose |
|---|---|
| `ADMIN_TOKEN` | Admin portal access; every admin function string-compares it. |
| `BREVO_EMAIL_SENDER` | Brevo API key for OTP transactional email (misleading name). |
| `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` | GitHub OAuth app. |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google OAuth app. |
| `GITHUB_TOKEN` | Repo-sync fallback token. Must include the `workflow` scope so the per-branch VM/sandbox workflows under `.github/workflows/` can be written; without it, GitHub rejects the write with a bare 404 and cloud commands never run. |
| `FRONTEND_URL` | Public URL for OAuth callbacks. |
| `BMAC_WEBHOOK_SECRET` | Buy Me a Coffee webhook verification (`paymentsConfig.webhookSecret` beats it). |
| `API_KEY_ENCRYPTION_SECRET` | AES-256-GCM key for encrypting `codeApiKeys` at rest. `fulfillApiKeyRequest` fails closed without it. |
| `CONVEX_SITE_URL` | Convex-built-in — OAuth redirects, sitemap base, MCP default URL. Do not set manually. |

### AgentOverflow

| Variable | Purpose |
|---|---|
| `AO_VM_URL` | Corpus VM (`http://<vm-ip>:8080`). Unset → endpoints return 503 with credit refunds. |
| `AO_INTERNAL_SECRET` | Shared secret between Convex and the corpus VM (`X-AO-Internal-Secret` header). |
| `AO_FRONTEND_URL` | AgentOverflow site origin — joins the OAuth redirect allowlist (`oauthRedirectAllowed()` in `http.ts`). |

### Frontend `.env.local`

```
CONVEX_DEPLOYMENT=<your-deployment>
VITE_CONVEX_URL=https://<your-deployment>.convex.cloud
```

`VITE_CONVEX_URL` is the only build-time env var the frontend reads (`import.meta.env.VITE_CONVEX_URL` in `main.tsx`, `lib/convexUrls.ts`, `lib/requestAd.ts`). Cloudflare Pages needs it set in the build environment or the site renders a `ConfigError` page.

## DB beats env

Every model provider prefers its database table over the environment variable, all managed from the `/admin` panel:

- `ollamaKeys` > `OLLAMA_API_KEY*`
- `modalEndpoints` > `MODAL_ENDPOINT_URL`
- `awsCredentials` > `AWS_BEDROCK_API_KEY`
- `geminiKeys` — the Gemini source for everything except `rag.ts`
- `paymentsConfig.webhookSecret` > `BMAC_WEBHOOK_SECRET`

`nimKeys` is kept in the schema but never consulted by the pipeline.

## Convex deployment details

- **Deployment slug:** `befitting-wildebeest-866`
- **URL:** `https://befitting-wildebeest-866.convex.cloud`
- **Dashboard:** `https://dashboard.convex.dev`

`CONVEX_DEPLOYMENT` in `.env.local` picks which deployment `npx convex dev` and any local `npx convex …` call target. The production `.env.local` on the maintainer's machine points at a different (dev) deployment, so production deploys are done through CI.

## Cloudflare Pages

Pushing to `main` is the deploy. Pages installs with `npm ci`, which is why `package-lock.json` must stay in sync with `package.json` — CI gates on that exactly.

The app is a pure SPA. For any other static host: upload `dist/` and configure SPA fallback (all routes serve `index.html`). Required build-time env:

```
VITE_CONVEX_URL=https://befitting-wildebeest-866.convex.cloud
```

## Release workflow (end to end)

1. Make code changes; run local gates (`bun run type-check`, `bun run lint`, `bun run check-refs`, `bun test`, `bun run build`).
2. Commit and push to `main`.
3. CI runs. On success, `convex-deploy.yml` fires automatically and deploys the backend; the smoke test verifies it answers. Cloudflare Pages builds the frontend from the same commit.
4. Desktop release (if there are desktop changes): `git tag vX.Y.Z && git push origin vX.Y.Z` triggers `release.yml`, which publishes a Release with the bare `Thalamus.exe`. If shipping the installer too, build locally via `thalamus-native/build.ps1 -Version "X.Y.Z"` and upload `installer-build\Thalamus.exe`, `dist\Thalamus-Setup-vX.Y.Z.exe`, and `dist\checksums.txt` to the same Release with `gh release upload`.
5. Verify the GitHub Release carries an asset named exactly `Thalamus.exe`. Every website download link and the installer's `URL_APP` point at `releases/latest/download/Thalamus.exe`.

There is no separate version endpoint to update. The desktop app's in-app update check reads the GitHub Releases API directly and only shows a notice — it downloads nothing.
