# CLAUDE.md

This file provides behavioral guidelines and repository context for Claude Code (claude.ai/code) or any LLM agent working within this repository.

**The governing tradeoff: we don't ask what the fastest way is, we ask what the best way is.** Quality over speed, stability over shortcuts. For trivial tasks use judgment, but never trade correctness for pace.

---

## 0. Who Works Here

* One person: **Nitish Goel** — solo developer, owns every line in this repo and in the sibling `agentoverflow` repo. Git identity: user `hardcoregamingsyle`, email `hardcorgamingstyle@gmail.com` (both spellings are intentional — do not "fix" them).
* No PRs, no feature branches, no review queue. **Commit directly to `main` and push straight to `main`.**
* Commits are small and frequent, made between tasks — never one giant thousand-line commit. A single massive commit reads as AI-generated; several focused ones read as a human shipping.

---

## 1. Core Behavioral Guidelines

### Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

* State your assumptions explicitly. If uncertain, stop and ask.
* If multiple interpretations exist, present them—don't pick silently.
* If a simpler approach exists, propose it. Push back when warranted.
* **Never** generate random/hallucinated links or assume domain ownership.

### Best Way Over Fastest Way

* When two approaches exist, take the better-engineered one even when it costs more time.
* Desktop software is **natively built** — the WPF/.NET app in `thalamus-native/` with zero NuGet dependencies. Never propose a bundled web wrapper (no Electron, no Tauri, no WebView shell posing as an app).
* "Best" does not mean over-engineered: no speculative features, no single-use abstractions, no unrequested flexibility.

### Web/Desktop Parity

**Any change made to the website must also be made to the desktop app.**

* The WPF app (`thalamus-native/`) mirrors the web portal's surfaces (Chat, Research, Study, Code, Sandbox). When you change user-facing behavior, UI flows, or backend contracts on the web side, port the same change to the native app in the same task — the desktop is never allowed to lag behind the site.
* If a web change genuinely has no desktop counterpart (e.g. SEO, landing page, guest mode), say so explicitly instead of silently skipping the desktop side.

### Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

* Build exactly what was asked. If you write 200 lines and it could be 50, rewrite it.
* Ask yourself: *"Would a senior engineer say this is overcomplicated?"* If yes, simplify.

### Surgical Changes & Refactoring

**Touch only what you must. Clean up only your own mess.**

* Match existing style exactly, even if you prefer a different format.
* Do not "improve" adjacent code, comments, or formatting. Don't refactor unbroken systems.
* **Dependency check:** when modifying a file, rigorously check and update everything that depends on it — including the *other* repo (see §5, AgentOverflow) and the shipped desktop app (see §4).
* Remove imports/variables/functions that *your* change orphaned. Leave pre-existing dead code alone unless asked.
* *The test:* every changed line must trace directly to the user's request.

### Goal-Driven Autonomy

**Define success criteria. Loop until verified.**

* Transform tasks into verifiable goals ("Add validation" → "write tests for invalid inputs, then make them pass").
* For multi-step tasks, state a brief plan and verify each step.
* **Proactive tooling:** if a required package or tool is missing, install it via the command line yourself.
* Quality gates are non-negotiable: `bun run type-check` exit 0, `bun run lint` 0 problems, build green, desktop build 0 warnings / 0 errors, no TODO/FIXME markers left behind.

---

## 2. Docs, Commits & the Persona

`README.md`, `HANDOVER.md`, and **all commit messages** are written in one voice: **a 14-year-old full-time professional solo developer** with quiet tech-god confidence. Semi-corporate tone, low-to-medium slang. Never AI-slop wording, never the fully corporate-developer voice.

* Commit format (matches existing history): lowercase `scope: subject` — scope is an area name (`convex`, `landing`, `desktop`, `ci`, `docs`, `seo`, `cleanup`, …), subject short and lowercase, often with an em-dash clause carrying attitude. Bodies are 1–6 sentences of plain prose explaining the *why*.
  * Real examples: `convex: mcp is free now — the moat wants traffic, not tolls` · `desktop: the exe finally has a face` · `cleanup: drop 18 dead dependencies`
* No emoji, no conventional-commit strictness, no `Co-Authored-By` trailers — history must read human.
* The `docs/` folder is neutral professional reference material (tables, no swagger). The persona lives in README, HANDOVER, and commits.
* Keep `README.md` and `HANDOVER.md` current as you work and commit regularly in between tasks — don't batch a day of changes into one push.
* **Desktop releases:** all website download links point at `github.com/hardcoregamingsyle/thalamus/releases/latest/download/Thalamus.exe`, which tracks the newest GitHub Release automatically. Publishing a Release whose asset is named exactly `Thalamus.exe` is the whole job; only if the asset name/scheme changes must the web links change (`src/pages/Landing.tsx`, `src/lib/vmLauncher.ts`, `src/components/code-workspace/VMSetupDialog.tsx`).

---

## 3. Development Commands & Environment

Frontend and backend run side by side in dev. The frontend reads `VITE_CONVEX_URL` (its only env var) to reach the live backend.

```bash
bun run dev          # Vite dev server (frontend only)
npx convex dev       # Convex backend — required alongside the dev server
bun run build        # bun install + tsc -b + vite build → dist/
bun run type-check   # tsc -b --noEmit
bun run lint         # ESLint
bun run format       # Prettier (writes files)
bun test             # bun:test — suites in tests/ (mcpParse, studyPrompt)
bun test --watch     # Watch mode
```

Things that will bite you:

* **No hot reload.** `vite.config.ts` sets `server.hmr: false` — refresh the browser manually after changes.
* **Dual lockfiles.** Both `bun.lock` and `package-lock.json` are committed. Cloudflare Pages deploys the web app with `npm ci`, and CI gates on `npm ci --dry-run` staying in sync — after any `bun add`/`bun remove`, regenerate `package-lock.json` too or the Pages deploy breaks.
* **The build script is POSIX** (`./node_modules/.bin/tsc`, `bash scripts/…`) — run it from Git Bash on Windows.
* **`bun run convex:deploy` does NOT deploy production.** It (and its alias `deploy:selfhosted`) runs `scripts/deploy-selfhosted.sh`, which targets a *self-hosted* Convex instance and hard-fails without `CONVEX_SELF_HOSTED_URL` + `CONVEX_SELF_HOSTED_ADMIN_KEY`. Production backend is Convex Cloud (`befitting-wildebeest-866`), deployed with plain `npx convex deploy`.
* **`src/convex/_generated/` is committed.** A fresh clone type-checks without running Convex; `npx convex dev` regenerates these files, so commit their diffs together with the schema/function change that caused them.
* **CI (`.github/workflows/ci.yml`)** runs lockfile-sync check + type-check + lint + a desktop `dotnet build`. It does **not** run `bun test` — run tests yourself before pushing.
* Desktop release CI (`.github/workflows/release.yml`): a `v*` tag builds and attaches the bare `Thalamus.exe` only. The installer (`ThalamusSetup.exe` / Inno `Thalamus-Setup-*.exe`) exists only via local `thalamus-native/build.ps1` + manual upload.

### Environment Variables

**Required `.env.local`:**

```text
CONVEX_DEPLOYMENT=your-deployment-name
VITE_CONVEX_URL=https://your-deployment.convex.cloud
```

**Server-side secrets** live strictly in the Convex dashboard, *not* `.env`. Verified-referenced in `src/convex/`:

* Models: `AWS_BEDROCK_API_KEY` (an `ABSK…` bearer key, preferred over SigV4), `AGENTROUTER_API_KEY` (last-resort fallback), `GEMINI_API_KEY`/`GOOGLE_AI_API_KEY` (**rag.ts embeddings only** — everything else reads Gemini keys from the DB `geminiKeys` table), `DAYTONA_API_KEY` (cloud sandbox), `HF_RAG_SPACE_URL`/`HF_RAG_BASE_URL`.
* Auth/infra: `ADMIN_TOKEN`, `BREVO_EMAIL_SENDER` (despite the name, this is the **Brevo API key**), `GITHUB_CLIENT_ID`/`GITHUB_CLIENT_SECRET`, `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`, `GITHUB_TOKEN` (repo-sync fallback), `FRONTEND_URL`, `BMAC_WEBHOOK_SECRET`, `API_KEY_ENCRYPTION_SECRET` (AES-256-GCM for user-supplied provider keys in `codeApiKeys`; `fulfillApiKeyRequest` fails closed without it).
* AgentOverflow: `AO_VM_URL`, `AO_INTERNAL_SECRET`, `AO_FRONTEND_URL` (OAuth redirect allowlist), `AO_MCP_API_KEY` (+ optional `AO_MCP_URL`).
* `CONVEX_SITE_URL` is Convex-built-in (OAuth redirects, sitemap base, MCP default URL).

**DB beats env:** `awsCredentials` table > `AWS_BEDROCK_API_KEY`; `geminiKeys` table is the Gemini source; `paymentsConfig.webhookSecret` > `BMAC_WEBHOOK_SECRET`. AWS/Gemini keys are managed via `/admin`.

---

## 4. Project Architecture

One Convex backend, two frontends (web + native Windows), two products (Thalamus + AgentOverflow) on the same deployment.

### Frontend (React 19 + Vite 7)

* **`src/main.tsx`:** entry — all routes lazy-loaded, chunk-failure auto-reload boundary, iframe route-sync.
* **`src/pages/`:** `Landing`, `Auth`, `AuthDesktop`, `Portal` (modes chat|research|code|study from `/portal/:mode`; guest mode 3 prompts/day), `MobilePortal` (<768px), `TeamPortalInline` (legacy code mode, embedded — no standalone route), `CodeProjects` → `CodeBranches` → `CodeWorkspace` (`/portal/code/*`), `Admin`, `ApiPage`, `Sync`, `Refer`, `Legal`, `NotFound`.
* **Auth is custom, not @convex-dev/auth.** The live flow is `src/hooks/use-auth.ts` → `api.customAuth.sendOtp/verifyOtp` + Google/GitHub OAuth via the Convex HTTP router; the session token sits in localStorage `agentai_session_token` and is passed as an explicit `{token}` arg to nearly every Convex call. `ConvexAuthProvider`/`auth.ts` are vestigial wiring — do not migrate code onto `ctx.auth`.
* **UI:** shadcn/ui (new-york) on Radix + Tailwind v4 (CSS-variable oklch theme in `src/index.css`, dark default, no tailwind.config). `src/components/ui/` is vendored — **do not customize**; wrap or pass className.
* **`src/lib/sanitizeHtml.ts`:** AI replies are raw HTML; `sanitizeAiHtml` (DOMPurify) is mandatory before any `dangerouslySetInnerHTML` — session/admin/GitHub tokens live in localStorage.
* Convex hooks are the state management (realtime `watch*` queries). No Redux/Zustand.

### Backend (Convex — `src/convex/`)

* **`schema.ts`:** ~40 tables, `schemaValidation: false` (legacy rows would block deploys — don't trust the validator to catch drift, and don't remove optional fields without a migration).
* **`agentCore.ts`:** the model brain — pricing, `MODE_MATRIX`/`AGENT_MODEL_MAP` tier tables, SigV4 signer, `callModel`/`callClaude`/`callGemini`/`callAgentRouter`, the inline `<<TAG>>` tool-marker parser, and every agent system prompt (treat prompt edits like schema migrations).
* **`agentPipeline.ts`** (OLD system) / **`codePipeline.ts`** (NEW system): dispatcher-driven dynamic 9-agent pipelines — a Haiku Dispatcher picks the minimum agent subset per task (Coder + Critic always forced) from Researcher → Analyser → Planner → Coder → Optimiser → Organizer → Tester → Hacker → Critic. One agent step per invocation, state on the session/branch doc, self-reschedule via `ctx.scheduler.runAfter(0, …)` — fully resumable.
* **`ai.ts`/`aiHelpers.ts`:** plain chat/research/study portal (no agents). **`rag.ts`:** study-mode vector + GraphRAG (Gemini text-embedding-004, 1536-d).
* **`customAuth.ts`/`customAuthHelpers.ts`:** the real auth (OTP, temp-mail blocking, `customSessions` 64-hex tokens, 30-day expiry, OAuth state, referral wheel, domain auto-ban).
* **`http.ts`:** SSE `/stream-chat`, OAuth callbacks, BMAC payment webhook, OpenAI-compatible `/api/v1/chat/completions` (`thal_` keys), `/ad` proxy, and all `/ao/*` routes.
* **`crons.ts`:** three jobs — daily AgentBucks reset (18:30 UTC = midnight IST), daily AO credit refill + point decay, and a 2-minute AO key push to the corpus VM.
* **`admin.ts`:** `/admin` backend — `adminLogin` (password + 3 security questions, hardcoded salted SHA-256 hashes) returns `ADMIN_TOKEN`; every admin function string-compares it.

### Model Routing (source of truth: `agentCore.ts`, not any doc)

* Tiers: `gemini | haiku | sonnet | opus46 | opus48`. Per-agent tier = `MODE_MATRIX[runMode][agent]` (cheap/balanced/powerful) falling back to `AGENT_MODEL_MAP`. Balanced mode: Dispatcher haiku, Researcher gemini, Organizer haiku, everything else sonnet. Powerful promotes the heavy seats to opus48. `DIFFICULTY_CODER_MODEL` overrides the Coder **in the OLD pipeline only**.
* Claude tiers: Bedrock → AgentRouter. The `gemini` tier: Gemini DB-key pool → AgentRouter (inside `callGemini`); only if that throws/returns empty does it fall back to Bedrock Haiku, billed as haiku.
* Bedrock model IDs are intentionally inconsistent: `agentCore.ts` maps opus-4-6/opus-4-8 → the opus-4-1 profile and sonnet-4-6 → sonnet-4-5 (4.6/4.8 aren't on Bedrock yet); `ai.ts` keeps its own separate ID map. Check the file you're touching.
* Every model call bills twice: user AgentBucks (`deductAgentBucks`) **and** `platformBudget` (`deductPlatformCost`; serving auto-disables under $5 remaining). Exchange rate: 1 USD provider cost = 1,500,000 AB.

### Two Parallel "Code Mode" Systems

1. **OLD:** `teamSessions`/`agentMessages`/`projectFiles` — `agentPipeline.ts`, rendered inline by `TeamPortalInline` inside Portal/MobilePortal.
2. **NEW (canonical):** `codeProjects`/`codeBranches`/`codeMessages`/`codeFiles` — `codePipeline.ts`, `/portal/code` routes, `CodeWorkspace.tsx`.

New features go into the NEW system only. The two pipeline files are near-duplicates — always confirm which one you're editing. NEW-only behaviors: MCP tool calls (built-in AgentOverflow server, bounded rounds), `<<RUN-CMD>>` Daytona execution and `<<REQUEST-API-KEY>>` pause/resume (branch pauses without rescheduling; `codeCommands.completeCommand`/`codeApiKeys` resume it — check those two tables first when a branch looks stuck), Critic retry loop (max 2), simulated streaming (batch response drip-fed in 300-char chunks — real token streaming was abandoned as unreliable in Convex actions).

### VM & Sandbox Environments (three backends)

* **Daytona** — cloud sandbox for pipeline `<<RUN-CMD>>` (`sandbox.ts`).
* **v86** — browser WASM x86. **Not an npm package:** `SandboxView.tsx` injects `libv86.js` from the copy.sh CDN at runtime (`window.V86`).
* **QEMU** — web app speaks the legacy Node bridge protocol on `ws://localhost:5900` via `src/lib/vmLauncher.ts` (JSON, **no request IDs** — listener-order correlation; read the header comment before touching). `qemu-bridge/` is that legacy bridge's source. The native app drives QEMU directly (`QemuBridgeManager.cs`) with no bridge process. Port map: 5900 = bridge socket, VNC displays from 5901 up.

### Desktop & Native Apps (`thalamus-native/`)

* **Parity rule (§1): every website change ships to the desktop app too, in the same task.**
* WPF/.NET 8, self-contained single-file, **zero NuGet packages in the app** (HTTP/SSE/RFB-VNC hand-rolled; installer allows exactly one — System.Text.Json). Build via `build.ps1` (handles the WPF `_wpftmp` publish race); full instructions in `thalamus-native/BUILD.md`.
* It drives the NEW code system through Convex's public HTTP API — public function signatures used by shipped builds (`codeProjects:createProject`, `codePipeline:startPipeline`, `codeBranches:getBranch/watchMessages/watchFiles`, …) are a public API. Don't break them.
* `ConvexClient.cs` hardcodes the prod deployment (`befitting-wildebeest-866`); repointing requires a rebuild.
* Version is stamped in four places (`ThalamusApp.csproj`, `MainWindow` `APP_VERSION`, `build.ps1` default, `installer.iss`) — keep them in sync on release. In-app update check is notify-only; `AutoUpdateSystem.cs` is dead code polling a domain we don't own — don't wire it up.
* Shared WPF resources go in `App.xaml` `Application.Resources`, never `Window.Resources` (child UserControls crash at parse otherwise).
* ISO catalog (`IsoLibrary.cs` + admin-managed `desktopIsoCatalog` table) is legal-sources-only: verified official URLs, never preactivated Windows/macOS/iOS images.
* The web app is web-only — no desktop-wrapper detection.

### Platform Credits (AgentBucks)

Deducted per-token per the `modelPricing`/`TIER_PRICING` tables. The live spendable paths touch `dailyAgentBucks` + `purchasedAgentBucks` + `creditBatches` (90-day expiry, soonest-first) — `users.agentBucksBalance` is *not* the spendable balance. Daily reset: 10M AB at midnight IST. Top-ups: Buy Me a Coffee webhook (`/bmac/webhook`), promo codes, referral wheel. Admin panel (`/admin`) manages keys, pricing, budgets.

---

## 5. AgentOverflow

A second product on this same deployment: Stack Overflow for AI agents. The separate repo (`hardcoregamingsyle/agentoverflow`, checked out at `../agentoverflow`, **which has its own CLAUDE.md**) holds the website, corpus ingestion, and the GCP VM search API. **This repo holds its entire backend:**

* `agentoverflow.ts` — `ao_` keys (CSPRNG, SHA-256 hash-only storage), the `aoCredits` economy (10/day refill, search/answer = 1 credit), LLM-scored learning submissions, contribution tiers (`CONTRIB_TIERS`, ~1%/day point decay), `aoLimitRequests`.
* `agentoverflowHttp.ts` — `/ao/v1/*` REST + the shared `run*` operation core (charge-before-fetch, refund on failure). Rate limit: 60 req/min/key.
* `agentoverflowMcp.ts` — `/ao/mcp` stateless MCP server. Tool calls are **free** (still metered for rate limiting); keyless callers get the anonymous tier (1000/IP/day, gold docs hidden).
* `agentoverflowPublic.ts` — SEO doc payloads + sitemaps. `agentoverflowAdmin.ts` — admin backend (same `ADMIN_TOKEN`).
* Search/answer proxy to the corpus VM via `AO_VM_URL` + `AO_INTERNAL_SECRET` (15s timeout; unset → `AO_BACKEND_UNCONFIGURED`, endpoints 503 with refunds). A 2-minute cron pushes key-hash snapshots to the VM, so the search hot path never touches Convex — and key changes take up to one interval to land.
* **`aoCredits` and AgentBucks are completely separate economies. Never mix them.**
* Cross-repo blast radius: renaming anything in `customAuth*`, `customAuthHelpers`, `agentoverflow*`, or the `/ao/*` routes breaks the AgentOverflow site **silently at runtime** — it calls Convex functions by string name (`makeFunctionReference`), not codegen.

---

## 6. Known Landmines

* Two auth systems coexist; only the custom-token one is live (§4). Don't "modernize" onto `ctx.auth`.
* Two code-mode systems coexist; NEW is canonical (§4). Don't add features to both.
* `/github/webhook` does no signature verification. `userApiKeys.generateApiKey` uses `Math.random` while `generateAoKey` uses CSPRNG — the asymmetry is known, not yours to normalize unasked.
* `rag.ts` reads Gemini keys from env while everything else reads the DB — if only DB keys are set, RAG silently returns no context.
* Chat billing in `ai.ts` is hardcoded to Gemini-ish pricing regardless of the answering model — known quirk.
* `scripts/study-eval.ts` and `scripts/mcp-smoke.ts` hit the live backend and cost real credits/keys — not free unit tests. `scripts/sync-to-github.sh` force-commits everything with a PAT — don't run casually.
* Deployment targets: web = Cloudflare Pages, backend = Convex Cloud (`npx convex deploy`), desktop = GitHub Releases (`v*` tag). Docs in `docs/` are neutral reference but several pages lag the code — when a doc and the code disagree, the code wins; fix the doc in passing only if it's the file you're already touching.
