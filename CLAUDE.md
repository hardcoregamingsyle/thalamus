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
bun run check-refs   # scripts/check-convex-refs.mjs — every Convex function reference resolves
bun run format       # Prettier (writes files)
bun test             # bun:test — suites in tests/ (mcpParse, parseAgentOutput, studyPrompt)
bun test --watch     # Watch mode
```

Things that will bite you:

* **No hot reload.** `vite.config.ts` sets `server.hmr: false` — refresh the browser manually after changes.
* **Dual lockfiles.** Both `bun.lock` and `package-lock.json` are committed. Cloudflare Pages deploys the web app with `npm ci`, and CI gates on `npm ci --dry-run` staying in sync — after any `bun add`/`bun remove`, regenerate `package-lock.json` too or the Pages deploy breaks.
* **The build script is POSIX** (`./node_modules/.bin/tsc`, `bash scripts/…`) — run it from Git Bash on Windows.
* **Production is Convex Cloud (`befitting-wildebeest-866`), deployed with `npx convex deploy`.** There is no self-hosted target and no deploy wrapper script in the repo. On this machine `.env.local` points at a *different* (dev) deployment, so a bare `npx convex …` hits the wrong project — use the gitignored `convex-prod.ps1` wrapper, which forces the prod deploy key without touching `.env.local`.
* **`src/convex/_generated/` is committed.** A fresh clone type-checks without running Convex; `npx convex dev` regenerates these files, so commit their diffs together with the schema/function change that caused them.
* **tsc cannot catch a wrong Convex function name.** The generated `api`/`internal` objects blow past TypeScript's instantiation depth and quietly degrade to `any`, and three callers reach the backend by plain string anyway — the shipped `.exe`, the AgentOverflow repo (`makeFunctionReference`), and crons. `bun run check-refs` is the only gate on them.
* **CI (`.github/workflows/ci.yml`)** runs on every push/PR to `main`. Web job: npm-lockfile sync → type-check → lint → `check-refs` → `bun test` → `bun run build`. Desktop job: `dotnet build` of `ThalamusApp`. The web job also checks out the sibling `agentoverflow` repo into the workspace and passes it as `AGENTOVERFLOW_DIR`, so cross-repo string refs are actually verified.
* Desktop release CI (`.github/workflows/release.yml`): a `v*` tag builds and attaches the bare `Thalamus.exe` only. The installer (`ThalamusSetup.exe` / Inno `Thalamus-Setup-*.exe`) exists only via local `thalamus-native/build.ps1` + manual upload.

### Environment Variables

**Required `.env.local`:**

```text
CONVEX_DEPLOYMENT=your-deployment-name
VITE_CONVEX_URL=https://your-deployment.convex.cloud
```

**Server-side secrets** live strictly in the Convex dashboard, *not* `.env`. Verified-referenced in `src/convex/`:

* Pipeline models: `OLLAMA_API_KEY` + `OLLAMA_API_KEY_2`…`_10` (Ollama Cloud — built dynamically in `siliconflow.ts`, so a literal grep misses them), `MODAL_ENDPOINT_URL`/`MODAL_MODEL`/`MODAL_API_KEY` (a single Modal endpoint), `DEADLYSIGNALS_API_KEY` (keyed New API gateway at `myapi.creitingameplays.com/v1` — see `deadlySignalsClient.ts`; the gateway advertises kimi-k3/deepseek-v4-pro/qwen3.8-max but only the catalog's models actually serve tokens), `MODELSCOPE_API_KEY` (Alibaba's official free API-Inference tier at `api-inference.modelscope.ai/v1` — see `modelscopeClient.ts`; tokens are `ms-…` from modelscope.ai/my/myaccesstoken, site-scoped to the `.ai` host — the `.cn` host rejects them; DeepSeek-V4-Pro is the frontier target every other seat fails on, and it works here). OpenCode Zen and OVHcloud need no key at all — anonymous free tiers. NVIDIA NIM was removed from the pipeline; `NVAPI_KEY`/`nimKeys` are dead. All the live ones are *fallbacks* — see DB-beats-env below.
* Legacy chat/study models (still live on `/stream-chat`, `ai.ts` and `study.ts`, not on the pipeline): `AWS_BEDROCK_API_KEY` (an `ABSK…` bearer key or `key:secret:region`), `GEMINI_API_KEY`/`GOOGLE_AI_API_KEY` (**rag.ts embeddings only** — everything else reads Gemini keys from the DB `geminiKeys` table).
* Tools: `GOOGLE_API_KEY` + `GOOGLE_CX` (Google Custom Search behind `performSearch`; without both it degrades to a model-knowledge answer), `SKETCHFAB_API_TOKEN` and optional `SKETCHFAB_MCP_URL` (the built-in Sketchfab 3D-model MCP server at `/sketchfab/mcp`, attached to **every** pipeline run — the agent decides whether to call it; search/model-info work without the token, only `download_model` needs it).
* Auth/infra: `ADMIN_TOKEN`, `BREVO_EMAIL_SENDER` (despite the name, this is the **Brevo API key**), `GITHUB_CLIENT_ID`/`GITHUB_CLIENT_SECRET`, `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`, `GITHUB_TOKEN` (repo-sync fallback), `FRONTEND_URL`, `BMAC_WEBHOOK_SECRET`, `API_KEY_ENCRYPTION_SECRET` (AES-256-GCM for user-supplied provider keys in `codeApiKeys`; `fulfillApiKeyRequest` fails closed without it).
* AgentOverflow: `AO_VM_URL`, `AO_INTERNAL_SECRET`, `AO_FRONTEND_URL` (OAuth redirect allowlist), `AO_MCP_API_KEY` (+ optional `AO_MCP_URL`).
* `CONVEX_SITE_URL` is Convex-built-in (OAuth redirects, sitemap base, MCP default URL).

**DB beats env:** `nimKeys` > `NVAPI_KEY` (dead — NIM removed, table kept for history); `ollamaKeys` > `OLLAMA_API_KEY*`; `modalEndpoints` > `MODAL_ENDPOINT_URL`; `awsCredentials` > `AWS_BEDROCK_API_KEY`; `geminiKeys` is the Gemini source; `paymentsConfig.webhookSecret` > `BMAC_WEBHOOK_SECRET`. Every one of those tables is managed from `/admin` (NVIDIA NIM · Ollama Cloud · Modal · AWS Bedrock · Gemini Keys tabs), so swapping a provider is a click, not a deploy.

---

## 4. Project Architecture

One Convex backend, two frontends (web + native Windows), two products (Thalamus + AgentOverflow) on the same deployment.

### Frontend (React 19 + Vite 7)

* **`src/main.tsx`:** entry — all routes lazy-loaded, chunk-failure auto-reload boundary, iframe route-sync.
* **`src/pages/`:** `Landing`, `Auth`, `AuthDesktop`, `Portal` (modes chat|research|study from `/portal/:mode`), `MobilePortal` (<768px), `CodeProjects` → `CodeBranches` → `CodeWorkspace` (`/portal/code/*`), `Blog` + `BlogPost` (`/blog`, `/blog/:slug` — posts are static in `src/content/blog.ts`, and `public/sitemap.xml` is hand-maintained, so a new post needs both files), `Admin`, `ApiPage` (`/api-keys`), `Sync`, `Refer`, `Legal` (one component serving `/privacy`, `/terms`, `/refund`, `/contact` via a `doc` prop), `NotFound`.
* **Guest mode** is nominally 3 prompts/day (`GUEST_LIMIT` in `Portal.tsx`, `GUEST_DAILY_LIMIT` in `ai.ts`/`aiHelpers.ts`) but currently uncapped — see the free/unlimited switches below. Usage is still counted into `guestUsage` while the switch is on, so flipping it back enforces immediately against real numbers.
* **Auth is custom, not @convex-dev/auth.** The live flow is `src/hooks/use-auth.ts` → `api.customAuth.sendOtp/verifyOtp` + Google/GitHub OAuth via the Convex HTTP router; the session token sits in localStorage `agentai_session_token` and is passed as an explicit `{token}` arg to nearly every Convex call. `ConvexAuthProvider`/`auth.ts` are vestigial wiring — do not migrate code onto `ctx.auth`.
* **UI:** shadcn/ui (new-york) on Radix + Tailwind v4 (CSS-variable oklch theme in `src/index.css`, dark default, no tailwind.config). `src/components/ui/` is vendored — **do not customize**; wrap or pass className.
* **`src/lib/sanitizeHtml.ts`:** AI replies are raw HTML; `sanitizeAiHtml` (DOMPurify) is mandatory before any `dangerouslySetInnerHTML` — session/admin/GitHub tokens live in localStorage.
* Convex hooks are the state management (realtime `watch*` queries). No Redux/Zustand.

### Backend (Convex — `src/convex/`)

* **`schema.ts`:** 50 tables plus the 6 spread in from `authTables`, `schemaValidation: false` (legacy rows would block deploys — don't trust the validator to catch drift, and don't remove optional fields without a migration).
* **`agentCore.ts`:** the model brain — the `FREE_UNLIMITED` switch, `callModel` (the one router; chain Modal → Zen → DeadlySignal → ModelScope → OVHcloud → Ollama, NIM removed), `mapModelIdToOllama`, `calcAgentBucksForTier`, `performSearch`/`performScrape`, the JSON-op output parser (single-line `{"op":…}` ops; legacy `<<TAG>>` markers still parsed as fallback for old stored messages), and every agent system prompt (treat prompt edits like schema migrations). It re-exports the actual provider clients from `siliconflow.ts` (Ollama Cloud — the filename is a leftover, its header and base URL say Ollama), `zenClient.ts`, `deadlySignalsClient.ts`, `modelscopeClient.ts`, `ovhcloudClient.ts` and `modalClient.ts`.
* **`codePipeline.ts`:** the dispatcher-driven dynamic 9-agent pipeline — a Dispatcher picks the minimum agent subset per task (Coder + Critic always forced) from Researcher → Analyser → Planner → Coder → Optimiser → Organizer → Tester → Hacker → Critic. One agent step per invocation, state on the branch doc, self-reschedule via `ctx.scheduler.runAfter(0, …)` — fully resumable. `stopPipeline` sets `stopRequested`; the runner halts without rescheduling and clears the flag.
* **`ai.ts`/`aiHelpers.ts`:** plain chat/research/study portal (no agents). **`rag.ts`:** study-mode vector + GraphRAG (Gemini text-embedding-004, 1536-d).
* **`customAuth.ts`/`customAuthHelpers.ts`:** the real auth (OTP, temp-mail blocking, `customSessions` 64-hex tokens, 30-day expiry, OAuth state, referral wheel, domain auto-ban).
* **`http.ts`:** SSE `/stream-chat`, OAuth callbacks, BMAC payment webhook, OpenAI-compatible `/api/v1/chat/completions` (`thal_` keys), `/ad` proxy, and all `/ao/*` routes.
* **`crons.ts`:** three jobs — daily AgentBucks reset (18:30 UTC = midnight IST), daily AO credit refill + point decay, and a 2-minute AO key push to the corpus VM.
* **`admin.ts`:** `/admin` backend — `adminLogin` (password + 3 security questions, hardcoded salted SHA-256 hashes) returns `ADMIN_TOKEN`; every admin function string-compares it.

### Model Routing (source of truth: `agentCore.ts`, not any doc)

* One entry point: `callModel(prompt, systemPrompt, agentName, …, ctx)`. **The agent name is the routing key.** `agentToTaskType()` (`nimClient.ts`) maps it to a task type — dispatcher | code | reasoning | research | agent | chat — and that picks the model. Pass anything else (an old tier string, a raw model id) and every branch of the map misses, silently landing on the generic chat model.
* Provider order when a `ctx` is passed: **Modal** (admin-registered `modalEndpoints`, primary row first) → **OpenCode Zen** (anonymous free tier, no key) → **DeadlySignal** (keyed New API gateway, `DEADLYSIGNALS_API_KEY`) → **ModelScope** (keyed Alibaba free tier, `MODELSCOPE_API_KEY` — serves DeepSeek-V4-Pro, the frontier seat; `Qwen-Ambassador/Qwen3.8-Max` exists but 403s without per-model approval) → **OVHcloud** (anonymous free tier, 2 RPM) → **Ollama Cloud** (key-backed). Without a `ctx` it goes straight to Zen. **NVIDIA NIM was removed from the pipeline entirely** — the nimKey/NVAPI_KEY seats are dead. `callModel` returns a provider-tagged tier string (`modal:…`/`zen:…`/`deadlysignals:…`/`modelscope:…`/`ovhcloud:…`/`ollama:…`) and the billing helpers branch on that prefix.
* Zen seat (free tier, verified live): the Dispatcher is the ONLY hardcoded model (`deepseek-v4-flash-free`); every other agent's Zen model is chosen by the Dispatcher at runtime via the `assignedModel` override. Free anonymous Zen models: `deepseek-v4-flash-free`, `nemotron-3-ultra-free`, `north-mini-code-free`, `mimo-v2.5-free`, `laguna-s-2.1-free`, `longcat-2.0-free`, `big-pickle` (`ling-3.0-flash-free` is listed but 400s). Paid Zen models (kimi-k3, deepseek-v4-pro, gpt-5.x, claude-x, …) need a $20 balance, which the current free key does not have.
* OVHcloud seat: `mapTaskToOvhModel` (gpt-oss-120b / Qwen3-Coder-30B). Ollama's equivalent is `mapModelIdToOllama` in `agentCore.ts` (gemma4:31b / minimax-m3 / gpt-oss:120b). A Dispatcher-chosen Zen, DeadlySignal or ModelScope model id is honored directly (skips Modal). The Dispatcher call carries a 60s fail-fast deadline so a dead/hung provider surfaces in about a minute instead of burning the whole chain budget.
* Both maps match by substring and both spell it `organiser` (s), while the pipeline agent is `Organizer` (z) — so the Organizer misses every branch and falls through to the chat model. Worth knowing before you debug why one seat behaves oddly.
* **There are no run modes and no model tiers.** `MODE_MATRIX`, `AGENT_MODEL_MAP`, `getAgentTier`, `DIFFICULTY_CODER_MODEL`, `codeBranches.runMode`, the `agentModelConfig` table and the `/admin` Model Config tab are all deleted. `ModelTier` is now just `string`. Nothing to mirror on desktop — the WPF app never had a run-mode control.
* AWS Bedrock and Gemini survive only on the legacy chat/study paths, never in the pipeline: `/stream-chat` in `http.ts` (hand-rolled SigV4 + AWS binary event-stream parsing, falling back Bedrock → Gemini → VLY), `ai.ts` `callAI` (Bedrock → Gemini, with its own `BEDROCK_MODEL_IDS` map), and `study.ts` PDF/image extraction. Each keeps its own credential parser and ID map — check the file you're touching. `rag.ts` embeddings are Gemini `text-embedding-004`.
* Billing is wired on every pipeline call — `credits.deductAgentBucks` for the user, `admin.deductPlatformCost` for the platform — but neither moves a number today, and both now do so honestly. `FREE_UNLIMITED` makes the first a no-op. The second is handed the tier `callModel` actually returned (`modal:<model>`, `zen:<model>`, `deadlysignals:<model>`, `ovhcloud:<model>`, `ollama:<model>`); `calcPlatformCost` strips the provider prefix and anything it does not price contributes 0 **on purpose**, because the current providers are free tiers. The budget guard (`isPlatformBudgetExhausted`, auto-disable under $5) is consulted on every run and cannot trip while nothing costs anything. Exchange rate where it applies: 1 USD provider cost = 1,500,000 AB.

### Free & Unlimited (five kill switches — the product decision, not a temporary state)

Free and unlimited is the product, permanently. It is implemented as five independent booleans, none of which know about each other. A dozen latent billing bugs are harmless only while all five are on, so treat flipping any of them as a coordinated change, not a one-line edit.

| Switch | File | What it gates |
|---|---|---|
| `FREE_UNLIMITED` | `src/convex/agentCore.ts` | AgentBucks deduction (`credits.ts`), the per-user and guest caps (`ai.ts`, `aiHelpers.ts`), the `thal_` API-key credit check (`http.ts`) |
| `AO_FREE_UNLIMITED` | `src/convex/agentoverflow.ts` | AgentOverflow search/answer charge, the 60/min per-key rate limit, the anonymous per-IP daily cap |
| `PAYMENTS_DISABLED` | `src/convex/payments.ts` | Forces `getPublicPaymentsConfig` to `{isEnabled:false}` regardless of the admin toggle — the web credits modal opens straight into "unavailable" and desktop hides the Buy Credits button |
| `GUEST_UNLIMITED` | `src/pages/Portal.tsx` | The client-side guest prompt counter and the copy around it |
| `FREE_UNLIMITED` | `agentoverflow` repo, `api/app/keystore.py` | The corpus VM's own per-key burst and daily quota — the search hot path never calls Convex, so this one has to flip too |

Flip checklist, in order: `agentCore.FREE_UNLIMITED` and `Portal.GUEST_UNLIMITED` together (server + client, or the UI lies); `agentoverflow.AO_FREE_UNLIMITED` and the VM's `keystore.FREE_UNLIMITED` together (cross-repo, both deploys); `PAYMENTS_DISABLED` last, since there is no point re-arming a charge nobody can top up. Before any of that, fix the two things that make metering meaningless anyway — the `PLATFORM_PRICING` miss described above, and `ai.ts` chat billing, which is hardcoded to Gemini-ish rates. **Docs must not advertise purchasable credits or paid tiers as live.**

### Code Mode (one system — the old one is gone)

`codeProjects`/`codeBranches`/`codeMessages`/`codeFiles` — `codePipeline.ts`, the `/portal/code/*` routes, `CodeWorkspace.tsx`. The OLD system (`teamSessions`/`agentMessages`/`projectFiles`, `agentPipeline.ts`, `TeamPortalInline.tsx`) was deleted along with its tables; any doc, comment or memory that still mentions "two code systems" is stale.

Behaviors worth knowing: MCP tool calls (user-connected servers plus the built-in AgentOverflow and Sketchfab servers, bounded rounds), `{"op":"cmd"}` execution (GitHub Actions in the cloud, the user's own machine on desktop), `{"op":"request-api-key"}` pause/resume, Critic retry loop (max 2), simulated streaming (the batch response is drip-fed to `streamingContent` in 300-char chunks — real token streaming was abandoned as unreliable in Convex actions).

The `cmd` op queues into `codeCommands`, parks the branch as `paused`, then schedules `sandbox.executeBranchCommands`, which reschedules `runPipelineAction` from its own `finally` — so it self-resumes even when the sandbox throws. The `request-api-key` op is the one that genuinely blocks on the user; `codeApiKeys.fulfillApiKeyRequest` reschedules it. When a branch looks stuck, check `codeCommands` and `codeApiKeyRequests` first.

### VM & Sandbox Environments (two executors)

* **GitHub Actions** — where cloud `cmd` ops run (`githubActionsRunner.ts`). Each branch already has its own public repo from `githubAutoCreate.ts`, and public repos get unlimited Actions minutes on standard runners, so the repo is also the VM. VMware a persistent **worker** (`thalamus-vm.yml`) per branch: `startPipeline` boots it the moment a message lands (`bootVmForBranch`, idempotent — a live worker heartbeats via `/code/vm-poll` every 10s and is never doubled). The worker polls `/code/vm-poll`, which atomically claims pending commands (`claimPendingCommandsForVm`, one-time nonce each) and posts each result to `/code/command-result`, resuming the pipeline exactly like the old per-command dispatch did. The poll's `keepAlive` is the idle policy the user asked for: work in flight keeps it alive; otherwise the worker shuts down after **300s** of branch inactivity while the task is incomplete, **600s** after it completed (`lastActivityAt` — bumped on every status change, message, and command completion). `runnerOs` on the branch picks ubuntu, windows or macos. The old per-command runner workflow came off the platform; no step-count ceiling remains in the pipeline (the old 2000/500 cap is gone — complex prompts run until done or stopped).
* **The user's own machine** — the desktop app sets `executor: "local"` on `startPipeline`, polls `codeCommands:listPendingForBranch`, runs each command in a per-branch workspace under LocalAppData, and reports back through `completeCommand`. Nothing is scheduled server-side for a local branch, so the two executors can never race.
* The **Sandbox tab** (`SandboxView.tsx`) is a view onto the two executors above — linked repo, runner OS picker, one-off commands, live output. The v86 browser-WASM emulator it used to host is gone; nothing v86-related ships anywhere.
* **QEMU** — desktop only in practice. The web app can still speak the legacy Node bridge protocol on `ws://localhost:5900` via `src/lib/vmLauncher.ts` (JSON, **no request IDs** — listener-order correlation; read the header comment before touching). `qemu-bridge/` is that legacy bridge's source. The native app drives QEMU directly (`QemuBridgeManager.cs`) with no bridge process. Port map: 5900 = bridge socket, VNC displays from 5901 up.

### Desktop & Native Apps (`thalamus-native/`)

* **Parity rule (§1): every website change ships to the desktop app too, in the same task.**
* WPF/.NET 8, self-contained single-file, **zero NuGet packages in the app** (HTTP/SSE/RFB-VNC hand-rolled; installer allows exactly one — System.Text.Json). Build via `build.ps1` (handles the WPF `_wpftmp` publish race); full instructions in `thalamus-native/BUILD.md`.
* It drives the code system through Convex's public HTTP API — function signatures used by shipped builds (`codeProjects:createProject`, `codePipeline:startPipeline`, `codePipeline:stopPipeline`, `codeBranches:getBranch/watchMessages/watchFiles`, `gravityAds:requestAd`, `payments:getPublicPaymentsConfig`, `conversations:*`, `desktopAuthActions:createCode`, `desktopAuth:pollCode`, …) are a public API. Don't break them — and remember `tsc` cannot see those call sites at all, which is what `bun run check-refs` covers.
* `ConvexClient.cs` hardcodes the prod deployment (`befitting-wildebeest-866`); repointing requires a rebuild.
* Version is stamped in **seven** places — `thalamus-native/BUILD.md` has the authoritative table, follow it rather than guessing. Short version: `ThalamusApp.csproj` `<Version>` and `MainWindow.xaml.cs` `APP_VERSION` are the ones that matter (APP_VERSION drives the sidebar label and the update comparison); `build.ps1` and `installer.iss` carry defaults that `-Version` overrides (`installer.iss` is `#ifndef`-guarded); `MainWindow.xaml`'s `VersionLabel` is cosmetic and overwritten at runtime; `ThalamusInstaller` has its own csproj `<Version>` and `InstallerWindow.xaml.cs` `VERSION`.
* The in-app update check is **notify-only** — `MainWindow.CheckForUpdatesAsync` hits the GitHub Releases API and sets a label. It downloads and installs nothing. There is no auto-updater and no update server; don't build one unasked.
* Shared WPF resources go in `App.xaml` `Application.Resources`, never `Window.Resources` (child UserControls crash at parse otherwise).
* ISO catalog (`IsoLibrary.cs` + admin-managed `desktopIsoCatalog` table) is legal-sources-only: verified official URLs, never preactivated Windows/macOS/iOS images.
* The web app is web-only — no desktop-wrapper detection.

### Platform Credits (AgentBucks)

Per-token cost comes from `calcAgentBucksForTier` in `agentCore.ts`, which branches on the provider prefix into `calcModalAgentBucks` / `calcNimAgentBucks` / `calcAgentBucksForModel`. The `modelPricing` table is admin-editable but **no billing path reads it**. The spendable paths touch `dailyAgentBucks` + `purchasedAgentBucks` + `creditBatches` (90-day expiry, soonest-first) — `users.agentBucksBalance` is *not* the spendable balance. Daily reset: 10M AB at midnight IST.

Every deduction is currently a no-op (`FREE_UNLIMITED`, above), and purchases are off (`PAYMENTS_DISABLED`). The inbound Buy Me a Coffee webhook (`/bmac/webhook`) stays live so anyone who already paid still gets credited; promo codes and the referral wheel are unaffected. Admin panel (`/admin`) manages provider keys, pricing rows and budgets.

---

## 5. AgentOverflow

A second product on this same deployment: Stack Overflow for AI agents. The separate repo (`hardcoregamingsyle/agentoverflow`, checked out at `../agentoverflow`, **which has its own CLAUDE.md**) holds the website, corpus ingestion, and the GCP VM search API. **This repo holds its entire backend:**

* `agentoverflow.ts` — `ao_` keys (CSPRNG, SHA-256 hash-only storage), the `aoCredits` economy (10/day refill, search/answer = 1 credit), LLM-scored learning submissions, contribution tiers (`CONTRIB_TIERS`, ~1%/day point decay), `aoLimitRequests`.
* `agentoverflowHttp.ts` — `/ao/v1/*` REST + the shared `run*` operation core (charge-before-fetch, refund on failure). Rate limit: 60 req/min/key by default, overridable per account via `users.aoCustomRateLimit`.
* `agentoverflowMcp.ts` — `/ao/mcp` stateless MCP server. Tool calls are **free** (still metered for rate limiting); keyless callers get the anonymous tier (1000/IP/day, gold docs hidden).
* **`AO_FREE_UNLIMITED = true` currently bypasses all of that.** The charge is forced to 0 (so the insufficient-credits check can never fire), the per-key rate limit is skipped, and the anonymous per-IP cap still counts but never throws. Learning scoring is *not* bypassed — it patches `aoCredits` and contribution points directly, so rewards and spam penalties are live right now. The constants (`COST_SEARCH`/`COST_ANSWER` = 1, `DAILY_REFILL` = 10, `RATE_LIMIT_PER_MIN` = 60, `AO_ANON_DAILY_LIMIT` = 1000) are the design the switch re-arms.
* `agentoverflowPublic.ts` — SEO doc payloads + sitemaps. `agentoverflowAdmin.ts` — admin backend (same `ADMIN_TOKEN`).
* Search/answer proxy to the corpus VM via `AO_VM_URL` + `AO_INTERNAL_SECRET` (15s timeout; unset → `AO_BACKEND_UNCONFIGURED`, endpoints 503 with refunds). A 2-minute cron pushes key-hash snapshots to the VM, so the search hot path never touches Convex — and key changes take up to one interval to land.
* **`aoCredits` and AgentBucks are completely separate economies. Never mix them.**
* Cross-repo blast radius: renaming anything in `customAuth*`, `customAuthHelpers`, `agentoverflow*`, or the `/ao/*` routes breaks the AgentOverflow site **silently at runtime** — it calls Convex functions by string name (`makeFunctionReference`), not codegen.

---

## 6. Known Landmines

* Two auth systems coexist; only the custom-token one is live (§4). Don't "modernize" onto `ctx.auth`. `auth.ts` still registers its `/api/auth/*` routes from `http.ts` and `users.ts` still imports `getAuthUserId`, so it isn't deletable — it's just never the thing that signs anyone in.
* There is now exactly **one** code-mode system (§4). If something tells you otherwise, it's stale.
* `/github/webhook` does no signature verification. `userApiKeys.generateApiKey` uses `Math.random` for the `thal_` key body while `generateAoKey` uses CSPRNG — the asymmetry is known, not yours to normalize unasked. The 6-digit email OTP is also `Math.random`.
* `rag.ts` reads Gemini keys from env while everything else reads the DB — if only DB keys are set, RAG silently returns no context.
* Chat billing in `ai.ts` is hardcoded to Gemini-ish pricing regardless of the answering model, and `admin.deductPlatformCost` can't price any current provider name (§4) — known quirks, both currently masked by free mode.
* `src/lib/vly-integrations.ts` ships a hardcoded fallback `sk_…` key when `VLY_INTEGRATION_KEY` is unset. VLY is the last-resort completion provider for `/stream-chat` and several `study.ts` paths.
* `scripts/study-eval.ts` and `scripts/mcp-smoke.ts` hit the live backend and cost real credits/keys — not free unit tests. `scripts/sync-to-github.sh` force-commits everything with a PAT — don't run casually.
* Deployment targets: web = Cloudflare Pages, backend = Convex Cloud (`npx convex deploy`), desktop = GitHub Releases (`v*` tag). Docs in `docs/` are neutral reference; when a doc and the code disagree, the code wins — fix the doc in passing if it's the file you're already touching.
