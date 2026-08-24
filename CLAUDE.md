# CLAUDE.md

Guidance for Claude Code (or any other LLM agent) operating in this repository. Neutral, professional voice — the same voice the shipping docs use. No persona, no first-person swagger.

The governing tradeoff: quality over speed, correctness over shortcuts. Trivial tasks use judgement; nothing else trades correctness for pace.

---

## 1. Core behaviours

### Think before coding
- State assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, surface them — do not pick silently.
- Never fabricate links, model names, environment variables, or file paths.

### Best over fastest
- Prefer the better-engineered approach when two exist.
- Desktop software is natively built. The WPF/.NET 8 app in `thalamus-native/` has zero NuGet dependencies in the shipping project. Do not propose Electron, Tauri, or any web-shell packaging.
- "Best" is not "over-engineered": no speculative features, no single-use abstractions, no unrequested flexibility.

### Web/desktop parity
Any user-facing change made to the website must ship to the desktop app in the same task. The WPF app mirrors the web portal's surfaces (Chat, Research, Study, Code, Sandbox) and drives the same Convex backend through the same public HTTP API. If a web change genuinely has no desktop counterpart (SEO copy, landing page, guest mode), say so explicitly rather than silently skipping the desktop side.

### Simplicity first
Minimum code that solves the stated problem. If a 200-line change could be 50 lines, rewrite it.

### Always ship
After every completed task, commit and push to `main` without being asked. Pushing to `main` triggers CI, which gates the automatic Convex deploy — committing is the deploy path.

Sandboxed sessions may start on a per-session feature branch rather than `main` (for example `arena/<id>`). That is an environment detail, not a change to the shipping policy: the owner wants every commit to land on `main` directly with no manual merge. When the working branch is not `main`, fast-forward `main` to the session commit and push it as part of the same task:

```bash
git fetch origin
# after committing on the session branch:
git branch -f main origin/main
git merge --ff-only main   # or: git branch -f main <session-commit> when main is an ancestor
git push origin main
git push origin <session-branch>   # keep the session ref in sync too
```

Only fall back to a PR if `main` is branch-protected and rejects the push; do not silently stop at a feature branch.

### Surgical changes
- Match existing style. Do not "improve" adjacent code, comments, or formatting.
- Update every dependent when modifying a file — including the sibling `agentoverflow` repo and the shipped desktop `.exe` (§5).
- Remove imports/variables/functions your change orphaned. Leave pre-existing dead code alone unless asked.
- Every changed line must trace to the user's request.

### Goal-driven autonomy
Turn requests into verifiable goals ("add validation" → "write tests for invalid inputs, then make them pass"). For multi-step tasks, state a brief plan and verify each step. If a required tool is missing, install it. The quality gates in §5 are non-negotiable.

---

## 2. Voice and commits

Documentation (`README.md`, `docs/**`) and commit messages are written in a neutral, professional voice. Tables and prose. No emoji, no first-person, no character.

Commit format matches existing history: lowercase `scope: subject`, where scope is an area name (`convex`, `landing`, `desktop`, `ci`, `docs`, `seo`, `cleanup`, …). Subject is short, lowercase, sometimes with an em-dash clause. Bodies are plain prose explaining the why. No conventional-commit strictness, no emoji. Agent-authored commits carry a `Co-Authored-By` attribution trailer.

Commit small and frequently, between tasks — not one giant thousand-line commit. Push to `main` directly; there is no PR flow on this repository.

Website download links point at `github.com/hardcoregamingsyle/thalamus/releases/latest/download/Thalamus.exe`. Publishing a Release whose asset is named exactly `Thalamus.exe` is the whole job; only if the asset name changes must the web links change.

---

## 3. Development commands and environment

```bash
bun run dev            # Vite dev server (HMR disabled — refresh manually)
npx convex dev         # Convex backend watcher — required alongside the dev server
bun run build          # tsc -b && vite build (cross-platform)
bun run type-check     # tsc -b --noEmit
bun run lint           # ESLint
bun run check-refs     # scripts/check-convex-refs.mjs
bun run format         # Prettier — writes files
bun run format:check   # Prettier — check only
bun test               # bun:test — suites in tests/ (see §5)
bun test --watch       # Watch mode
bun run clean          # node fs.rmSync of dist/ and node_modules/.cache
```

Notes:
- **No hot reload.** `vite.config.ts` sets `server.hmr: false`.
- **Dual lockfiles.** Both `bun.lock` and `package-lock.json` are committed. Cloudflare Pages deploys the frontend with `npm ci`; CI verifies `npm ci --dry-run` stays in sync.
- **`src/convex/_generated/` is committed.** A fresh clone type-checks without running Convex; `npx convex dev` regenerates these files.
- **tsc cannot catch a wrong Convex function name.** The generated `api`/`internal` objects exceed TS instantiation depth and degrade to `any`, and three callers reach the backend by plain string — the shipped `.exe`, the AgentOverflow repo via `makeFunctionReference`, and crons. `bun run check-refs` is the only gate. It currently validates 605 references against 312 exported functions (27 of them from the sibling repo).
- **Production deploys go through CI.** `.github/workflows/convex-deploy.yml` runs after CI passes on `main` and executes `npx convex deploy --yes` using the `CONVEX_DEPLOY_KEY` repo secret, then hits `POST /api/action` on `ai:guestSendMessage` as a smoke test. There is no local `convex login` on this machine.
- **Desktop release CI** (`.github/workflows/release.yml`): a `v*` tag builds and attaches the bare `Thalamus.exe`. The installer (`ThalamusSetup.exe` / Inno-wrapped `Thalamus-Setup-*.exe`) is built locally via `thalamus-native/build.ps1` and uploaded by hand.

### `.env.local` (frontend / dev)

```
CONVEX_DEPLOYMENT=<your-deployment>
VITE_CONVEX_URL=https://<your-deployment>.convex.cloud
```

### Server-side secrets (Convex dashboard)

Full table in [`docs/deployment.md`](docs/deployment.md#environment-variables). Verified against `process.env.*` in `src/convex/`:

| Variable | Consumer |
|---|---|
| `ZEN_API_KEY` | OpenCode Zen client (`lib/zenClient.ts`) |
| `ORCAROUTER_API_KEY` | OrcaRouter gateway (`lib/orcaRouterClient.ts`) — `qwen/qwen3.8-27b-free` coding seat, chain leg between Zen and OpenRouter |
| `DEADLYSIGNALS_API_KEY` | DeadlySignal gateway (`lib/deadlySignalsClient.ts`) |
| `HF_TOKEN` | Hugging Face Inference Providers router (`lib/huggingFaceClient.ts`) — one free token reaches 100+ open-weight models (incl. the Qwen 3.8 Max-class 2.4T); thin monthly credit, chain leg between ModelScope and Pollinations |
| `MODELSCOPE_API_KEY` | ModelScope free tier (`lib/modelscopeClient.ts`) |
| `OLLAMA_API_KEY`, `OLLAMA_API_KEY_2` … `_10` | Ollama Cloud pool (`lib/ollamaClient.ts` — built dynamically, a literal grep misses it) |
| `MODAL_ENDPOINT_URL` / `MODAL_MODEL` / `MODAL_API_KEY` | Single Modal endpoint fallback when `modalEndpoints` table is empty |
| `VLY_INTEGRATION_KEY` | VLY completion provider (`lib/vlyIntegrations.ts`) — checked lazily at call time, never at import (a module-scope throw fails the whole Convex deploy) |
| `AWS_BEDROCK_API_KEY` | Legacy chat/study path (`ai.ts`, `study.ts`, `/stream-chat`) |
| `GEMINI_API_KEY` / `GOOGLE_AI_API_KEY` | `rag.ts` embeddings only — everything else reads Gemini keys from the `geminiKeys` table |
| `GOOGLE_API_KEY` + `GOOGLE_CX` | Google Custom Search behind `performSearch` |
| `SKETCHFAB_API_TOKEN` / `SKETCHFAB_MCP_URL` | Built-in Sketchfab MCP server |
| `ADMIN_TOKEN` | Admin panel gate |
| `BREVO_EMAIL_SENDER` | Brevo API key for OTP email (misleading name) |
| `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` / `GITHUB_TOKEN` | GitHub OAuth app + the platform's GitHub identity. `GITHUB_TOKEN` owns the per-branch build mirrors (the only repos where workflow files are written — user repos are code-only by design), so it must include the `workflow` scope; without it, GitHub rejects the write with a bare 404 and cloud commands never run. User OAuth tokens never need `workflow` — their repo carries no workflows. The runner no longer *guesses* scope problems from a 404 — it reads `x-oauth-scopes` off a `GET /user` before blaming the scope (see §4). |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google OAuth app |
| `FRONTEND_URL` | OAuth callback base |
| `BMAC_WEBHOOK_SECRET` | Buy Me a Coffee webhook |
| `API_KEY_ENCRYPTION_SECRET` | AES-256-GCM secret for `codeApiKeys`; write path fails closed if unset |
| `AO_VM_URL` / `AO_INTERNAL_SECRET` / `AO_FRONTEND_URL` / `AO_MCP_API_KEY` / `AO_MCP_URL` | AgentOverflow |
| `CONVEX_SITE_URL` | Convex-built-in; used for OAuth redirects, sitemap base, MCP default URL |

There is no `NVAPI_KEY` reader anywhere — NIM is fully removed from the pipeline and `nimKeys`/`NVAPI_KEY` are not consulted by `callModel`.

**DB beats env** for every provider that has a table: `ollamaKeys` > `OLLAMA_API_KEY*`, `modalEndpoints` > `MODAL_ENDPOINT_URL`, `awsCredentials` > `AWS_BEDROCK_API_KEY`, `geminiKeys` is the Gemini source for everything except `rag.ts`, `paymentsConfig.webhookSecret` > `BMAC_WEBHOOK_SECRET`. All tables are managed from the `/admin` panel.

---

## 4. Project architecture

One Convex backend, two frontends (web + native Windows), two products (Thalamus + AgentOverflow) on the same deployment.

### Frontend (React 19 + Vite 7)

- `src/main.tsx` — entry, lazy routes, chunk-error auto-reload boundary. Providers: `StrictMode` → `InstrumentationProvider` → `ConvexProvider` (pointed at `VITE_CONVEX_URL`) → `ThemeProvider` → `BrowserRouter`. `ConvexAuthProvider` was removed; auth runs on the custom-token path.
- `src/pages/` — top-level routes. Several are shells over subdirectories:
  - `Portal.tsx` dispatches to `pages/portal/` (GuestPortal, PortalDesktop, ModeSelection) with `modes.ts`, `guestSession.ts`, `types.ts`, `suggestions.ts`. Auth is checked before the mobile split, so guest mode works on mobile.
  - `MobilePortal.tsx` dispatches to `pages/mobile/` (MobileHomeScreen, MobileChatView, MobileMessageBubble).
  - `Landing.tsx` composes 9 sections from `pages/landing/` (Hero, ModeGrid, PipelineSection, StudySection, CapabilityBand, FaqSection, FinalCta, NavBar, Footer). FAQ items are single-sourced in `src/content/faq.ts` and mirrored by an FAQPage JSON-LD block in `index.html`.
  - `Admin.tsx` is a 264-line shell over 15 lazy-loaded tabs under `pages/admin/`. Provider tabs ship neutral slugs (`providerB` … `providerE`) and ask the server for real labels via `adminMeta.ts`, so a leaked chunk does not publish the provider stack.
- `src/components/student-suite/` — Study-mode tools (Menu, Concept Map, Flashcards, Interleave, Quiz, Mock Test, Errors, Spaced, Teachback), driven by `components/StudentSuite.tsx`.
- `src/components/ui/` — 13 vendored shadcn primitives (badge, button, card, checkbox, collapsible, dialog, input, input-otp, label, scroll-area, select, sonner, textarea). Do not edit in place; wrap or pass className.
- Shared client libs: `src/lib/session.ts` (`SESSION_KEY` + helpers), `convexUrls.ts` (`convexSiteUrl`), `errorMessage.ts` (`errMsg`), `fileEncoding.ts`, `streamChat.ts`, `dateFormat.ts`, `sanitizeHtml.ts` (DOMPurify — mandatory before any `dangerouslySetInnerHTML`; session/admin/GitHub tokens live in localStorage).
- Client-side system prompts for `/stream-chat` live in `src/content/systemPrompts.ts`.
- Guest mode is nominally 3 prompts/day (`GUEST_LIMIT` in `pages/portal/guestSession.ts`, `GUEST_DAILY_LIMIT` in `ai.ts`/`aiHelpers.ts`), currently uncapped — see the free/unlimited switches below.
- Auth is custom, not `@convex-dev/auth`. The live flow is `src/hooks/use-auth.ts` → `api.customAuth.sendOtp/verifyOtp` + Google/GitHub OAuth via the Convex HTTP router. The session token sits in localStorage under `agentai_session_token` and is passed as an explicit `{token}` argument to nearly every Convex call. `/portal/code*` and `/refer` are auth-gated via `useAuth`. There is no `/sync` route: connecting and disconnecting GitHub lives on a branch's Git Sync tab (`components/code-workspace/GitSyncView.tsx`), because that is the only place the connection has a concrete meaning.
- Theme is a single `ThemeProvider` context (`src/hooks/use-theme.tsx`); no more instrumentation error-modal, no `RouteSyncer`, no vly telemetry — just a plain React error boundary in `main.tsx`.

### Backend (Convex — `src/convex/`)

- 312 exported functions across ~50 modules plus `lib/`. `schema.ts` defines the tables (10-literal `conversations.mode` union among them); `schemaValidation: false` so legacy rows do not block deploys.
- **`src/convex/lib/`** holds pure helper modules (no Convex framework imports):
  - `agentCore.ts` — `FREE_UNLIMITED`, `callModel` (the router), `mapModelIdToOllama`, `calcAgentBucksForTier`, `performSearch`, `performScrape`. Re-exports `agentPrompts` (per-agent system prompts), `modePrompts` (`MODE_ADHD`, `MODE_SYSTEM_PROMPTS`, `adhdToTemperature`), `agentOutputParser`. The parser's canonical input is deliberately escape-free: files are raw `<<FILE "path">> … <<END>>` blocks (verbatim content; bodies are masked out of the op scan so op-shaped file text can never execute), everything else is a one-line JSON op (`{"op":"cmd",…}` and friends). The JSON document envelope, inline JSON file ops and legacy `<<TAG>>` markers still parse as compatibility fallbacks, but no prompt teaches them — the old "whole file in one JSON string" format is what produced the chronic `[REJECTED OPS]`/`[MALFORMED OP]` loops.
  - Provider clients: `ollamaClient.ts` (formerly `siliconflow.ts` — export names unchanged), `zenClient.ts`, `openrouterClient.ts`, `deadlySignalsClient.ts`, `modelscopeClient.ts`, `modalClient.ts`.
  - `taskTypes.ts` (formerly `nimClient.ts`) — only `agentToTaskType` + `TaskType` remain; every NIM-specific export was deleted with NIM itself.
  - `mcpClient.ts` / `mcpParse.ts` — MCP server plumbing shared by the pipeline.
  - `codeAuth.ts` — helpers for Code-mode auth checks.
  - `obscureRepoGenerator.ts` — generates the obscure per-branch repo name.
  - `studyPrompt.ts` — study-mode prompt assembly.
  - `vlyIntegrations.ts` (formerly `src/lib/vly-integrations.ts`) — no hardcoded fallback key; `VLY_INTEGRATION_KEY` is read lazily inside `getVly()`. The check must never move to module scope: Convex's push-time analysis loads every module without env vars, so a top-level throw fails the entire production deploy.
- Top-level modules: `codePipeline.ts` (the pipeline runner), `codeBranches.ts`, `codeCommands.ts`, `codeApiKeys.ts`, `codeProjects.ts`, `codeDeletion.ts`, `ai.ts`/`aiHelpers.ts` (plain chat/research/study handlers), `rag.ts` (Gemini embeddings, 1536-d), `customAuth.ts`/`customAuthHelpers.ts`, `desktopAuth.ts`/`desktopAuthActions.ts`, `http.ts`, `crons.ts`, `admin.ts`, `adminMeta.ts`, `payments.ts`, `credits.ts`, `dailyReset.ts`, `github*.ts`, `deployments.ts` (user-invoked Vercel/Cloudflare/Netlify deploy actions), `agentoverflow.ts` + friends, `sketchfabMcp.ts`, `userApiKeys.ts`, `study.ts`/`studyHelpers.ts`.

### Model routing (source of truth: `src/convex/lib/agentCore.ts`)

- One entry point: `callModel(prompt, systemPrompt, agentName, …ctx/assignedModel/deadlineMs)`. The agent name is the routing key: `agentToTaskType()` in `lib/taskTypes.ts` maps it (by lowercase substring) to a task type — dispatcher | code | reasoning | research | agent | factcheck | chat. Both `organiser` and `organizer` match `dispatcher`, so the Organizer routes to the dispatcher task type.
- Provider chain when a `ctx` is passed: **Modal** (admin-registered `modalEndpoints`, primary row first) → **OpenCode Zen** (anonymous free tier, optional `ZEN_API_KEY`) → **OrcaRouter** (keyed, `ORCAROUTER_API_KEY`; `qwen/qwen3.8-27b-free`, skipped fast when unconfigured) → **OpenRouter** (keyed, `OPENROUTER_API_KEY`; defaults to the `openrouter/free` auto-router because the `:free` roster rotates) → **DeadlySignal** (keyed, `DEADLYSIGNALS_API_KEY`) → **ModelScope** (keyed, `MODELSCOPE_API_KEY`, `.ai` host — `.cn` host rejects tokens) → **HuggingFace** (keyed, `HF_TOKEN`; Inference Providers router — `Qwen/Qwen3.8-2.4T-A95B` and 100+ open models, thin free monthly credit, skipped fast when unconfigured) → **Ollama Cloud** (keyed). Without a `ctx` the chain still runs from Zen onward.
- Dispatcher short-circuits: if `assignedModel` matches `findZenModel` / `findOpenRouterModel` / `findDeadlySignalsModel` / `findModelScopeModel`, that provider is tried first and only falls back to the full chain if it errors — Modal is skipped for that call because it does not know those catalog ids.
- `callModel` returns a provider-tagged tier string: `modal:<model>`, `zen:<model>`, `openrouter:<model>`, `deadlysignals:<model>`, `modelscope:<model>`, `ollama:<model>`. `calcAgentBucksForTier` branches on the prefix; the four keyless/free-tier prefixes cost 0, Modal delegates to `calcModalAgentBucks`, Ollama delegates to `calcAgentBucksForModel`.
- Provider chain fits inside Convex's 10-minute action kill — the shared deadline is 7 minutes; the Dispatcher call carries a 60s fail-fast deadline so a dead provider surfaces in about a minute.
- **NVIDIA NIM is fully gone.** The `NVAPI_KEY` reader, the `nimKeys` schema table's use in the pipeline, the `/admin` NIM tab, and every `callNim` invocation were removed. The only survivor is `agentToTaskType`, still exported from `lib/taskTypes.ts`.
- AWS Bedrock and Gemini survive only on the legacy chat/study paths: `/stream-chat` in `http.ts` (hand-rolled SigV4 + AWS event-stream parser, chain Bedrock → Gemini → VLY), `ai.ts` `callAI` (Bedrock → Gemini, own `BEDROCK_MODEL_IDS` map, `claude-haiku-4-5` default), `study.ts` extraction (Bedrock → VLY, own SigV4 signer). `rag.ts` embeddings are Gemini `text-embedding-004`.
- Billing is wired on every pipeline call. `credits.deductAgentBucks` charges the user; `admin.deductPlatformCost` charges the platform. Neither moves a number today. The user path is a no-op under `FREE_UNLIMITED`. The platform path is called with the exact tier `callModel` returned; `calcPlatformCost` strips the prefix and only prices `gemini-3.1-flash-lite` / `claude-haiku-4-5` / `claude-sonnet-4-6` / `claude-opus-4-6` / `claude-opus-4-8` (see `admin.ts` `PLATFORM_PRICING`). Every current pipeline provider prices at 0 by design — the current chain is free tiers.

### Free & unlimited (five kill switches)

Free and unlimited is the product decision, not a temporary state. It is implemented as five independent booleans that do not know about each other. Latent billing quirks are harmless only while all five are on; treat flipping any as a coordinated change.

| Switch | File | What it gates |
|---|---|---|
| `FREE_UNLIMITED` | `src/convex/lib/agentCore.ts` | AgentBucks deduction (`credits.ts`), per-user and guest caps (`ai.ts`, `aiHelpers.ts`), `thal_` API-key credit check (`http.ts`) |
| `AO_FREE_UNLIMITED` | `src/convex/agentoverflow.ts` | AgentOverflow search/answer charge, 60/min per-key rate limit, anonymous per-IP daily cap |
| `PAYMENTS_DISABLED` | `src/convex/payments.ts` | Forces `getPublicPaymentsConfig` to `{isEnabled:false}` regardless of the admin toggle |
| `GUEST_UNLIMITED` | `src/pages/portal/guestSession.ts` | Client-side guest prompt counter and its copy |
| `FREE_UNLIMITED` | `agentoverflow` repo, `api/app/keystore.py` | The corpus VM's own per-key burst and daily quota |

Before flipping any of them, fix the two things that make metering meaningless anyway: `admin.deductPlatformCost` prices no current provider (by design while free), and `ai.ts` chat billing is hardcoded to Gemini-ish rates. Docs must not advertise purchasable credits or paid tiers as live.

### Code mode

`codeProjects` → `codeBranches` → `codeMessages` / `codeFiles` / `codeCommands` / `codeApiKeys*` / `mcpServers`. Driven by `src/convex/codePipeline.ts` at `/portal/code/*` in `CodeProjects` → `CodeBranches` → `CodeWorkspace`. A Dispatcher runs before EVERY run — a fresh user prompt always re-enters through it (interrupting any in-flight run) — but it is a background MODEL-SEAT PICKER only: it writes per-agent model assignments on `dispatchedModelsJson` and routes nothing. The cast is fixed (`lib/pipelineAgents.ts`); every run then enters as the Analyser with one synthetic task, and agents pass work with `{"op":"over-to"}`. The four research agents run only as the Research Team (over-to "ResearchTeam", fixed order, tracked on `codeBranches.researchTeamIndex`). Run exit: Critic `security-pass`, Analyser naming nobody, or KnowItAll finishing an answer. Roster-era columns (`dispatchedAgentsJson`/`customAgentsJson`/`skipAgentsJson`/`skipActive`) remain in the schema for old branches but are neither written nor read. `userPromptGen` is bumped per prompt; all phase transitions go through the `advance()` helper, which refuses when the generation moved so a newer prompt's dispatch can never be clobbered by a superseded chain.

Behaviours to know:
- KnowItAll answers any question directly (questions dispatch to `["KnowItAll"]` alone) and is the only agent that can hand back to the Dispatcher: `{"op":"dispatch","reason":"..."}` re-runs the dispatch with the reason carried into its prompt. The Critic is NOT forced — the Dispatcher decides per task. Custom agents (max 2) run after the standard set with their own system prompt; `skipAgents` skips agents on the first pass of a continuation run only.
- MCP tool calls: user-connected servers + built-in AgentOverflow + Sketchfab, bounded rounds. Handled **before** the command pause, so a message that both calls a tool and queues a command keeps both. Server names resolve fuzzily (`findMcpServer` — case/separator-insensitive, then prefix) because models write "AgentOverflow" and "sketchfab-mcp" constantly. When a call cannot be made (no server attached, round budget spent) the agent is told so in its own message instead of the call vanishing. The Keys tab lists the two built-ins and can live-handshake them (`codePipeline.checkBuiltInMcpServers`).
- `{"op":"cmd"}` execution: two executors (see `docs/executors.md`).
- `{"op":"request-api-key"}`: pauses the branch until the user submits the key (`codeApiKeys.fulfillApiKeyRequest` resumes it).
- Critic gate: **no cap, pass-or-stay**. The task advances ONLY on an explicit `{"op":"security-pass"}` — an explicit fail OR a reply with no verdict op keeps the task open (a prose rejection without the op used to read as "no verdict" and let the run silently complete a rejected task). The fix goes to the teammate the Critic names with `over-to` (Coder when it names no one), never blindly back to Coder. `branch.criticRetryCount` is still persisted, but purely as input to the Critic's own prompt — it is told how many times it has rejected the task and instructed to pass when what remains is minor, out of scope, or has resisted repeated fixes. Same reasoning as the removed per-run message ceiling: the natural break is the user (`stopPipeline`), not a number. Do not reintroduce a numeric limit.
- Simulated streaming: the batch response is drip-fed to `streamingContent` in 300-char chunks for seats without a streaming path. Streaming seats (OpenRouter) deliver true SSE tokens through `callModel`'s `streaming` override and write deltas live to `streamingContent`, skipping the drip.
- `cmd` op queues into `codeCommands`, parks the branch as `paused`, self-resumes when nothing is outstanding. `request-api-key` is the only op that genuinely blocks on the user.

### VM & sandbox executors

- **The build mirror (`ensureVmMirror` / `resolveVmTarget`).** The user's repo is **code-only** by product decision — no `.thalamus/` transcript, no workflow files, nothing Thalamus-made (every push filters system paths via `projectFilesOnly`/`isSystemPath` in `githubPushUtils.ts`, and `doPull` refuses to pull them back in). Cloud execution therefore cannot run on the user's repo (GitHub needs the workflow file beside the code it runs): commands instead run on a platform-owned **build mirror** (`<repo>-vm`, public for free Actions minutes — the tradeoff is recorded in `schema.ts` and disclosed in the Git Sync tab) that carries the same code plus the managed VM/sandbox workflows. `githubConfigs.vmOwner/vmRepo/vmRepoUrl` record it; for legacy platform-hosted repos the mirror is the repo itself, which already held the system files. `resolveVmTarget` is the single choke point boot/sandbox/stop use to learn where to act and with which token (distinct mirror → `GITHUB_TOKEN` only; self-mirror → `resolveTokenForBranch`). `ensureVmMirror` seeds the mirror's working branch with the branch's current code *before* saving the config — a mirror saved without code is the empty-clone bug reborn, so a seed failure leaves nothing configured and the next boot retries creation (name suffixes absorb the orphan). The push side keeps the mirror fresh: `autoPushToGithub`/`pushToGithub` push the user repo's default branch **and then** the mirror's working branch (`pushMirrorCopy`), failing loudly when the mirror leg fails — a fresh user repo with a stale mirror reads to the user exactly like "agents ignore my edits".
- **GitHub Actions cloud runner** — `githubActionsRunner.ts` + `.github/workflows/thalamus-vm.yml` (on the build mirror). `startPipeline` boots the worker via `bootVmForBranch` (idempotent — heartbeat prevents doubles). The worker polls `/code/vm-poll` every ~10s, atomically claims pending commands via `claimPendingCommandsForVm`, and posts each result to `/code/command-result` with a single-use nonce. `keepAlive` policy: work in flight or `lastActivityAt` within 300s of `now` while incomplete / 600s once completed. `runnerOs` on the branch picks ubuntu / windows / macos.
- **Token resolution is live, not snapshotted — and provenance-aware.** `githubConfigs.githubToken` is written once when a branch's repo is created. Reading it directly meant a user who reconnected GitHub kept dispatching with the *old* token forever, so a branch could sit permanently on "reconnect GitHub" that reconnecting could never clear. Every runner path resolves its target via `resolveVmTarget` (mirror coordinates + token), which for self-mirrors delegates to `resolveTokenForBranch`: that returns `{token, source}` — the branch owner's current `users.githubAccessToken` only when that account actually owns `cfg.owner` (`source: "user"`), otherwise the stored snapshot/`GITHUB_TOKEN` (`source: "platform"` — the user token has no access there at all). Distinct mirrors skip the question entirely (platform token or nothing). Callers must check `source` before printing reconnect advice: on a `"platform"` token failure, reconnecting the user's GitHub can never change anything — the user-loop version of this bug is exactly the "I keep reconnecting and nothing changes" report.
- **`executorBlockedReason` is only set on a *proven* block, and its wording is ownership-aware.** A 403/404 writing under `.github/workflows/` is put to GitHub via `x-oauth-scopes` before it is called a scope problem; a missing branch ref is created and retried; anything else stays retryable and sets nothing. `startPipeline` awaits `bootVmForBranch` so the warning it prints reflects this prompt, not a stale one. In the mirror era the only identity that ever writes a workflow file is the platform's `GITHUB_TOKEN`, so a genuine scope failure can only be admin-side (`PLATFORM_WORKFLOW_SCOPE_MSG`) — a user-facing "reconnect GitHub" instruction is never printed for it, which is the point of the mirror: user tokens no longer need `workflow` at all, and the reconnect loop is gone for good.
- **`workflow_dispatch` requires the workflow file on the repo's DEFAULT branch, not just the working branch.** GitHub only registers the trigger via the default branch; a copy that exists solely on the working branch makes `createWorkflowDispatch` 404 unconditionally, forever — confirmed by dispatching against a live throwaway branch/workflow on this repo. `ensureWorkflowOnRepo` (`githubActionsRunner.ts`) writes the workflow to both the mirror's default branch (to register it) and its working branch (which is what actually executes — the run's `head_branch` matches the working branch, not main). This was the real cause of every prior "workflow-scope-missing" / VM-boot failure on a freshly created branch; it had nothing to do with OAuth scopes. Do not revert to writing only `cfg.branch`.
- **A queued command that never gets a result must not go unanswered forever.** `STALE_COMMAND_MS = 15 * 60 * 1000` inside `runPipelineAction` fails a pending command and lets the pipeline continue past it — but that check only runs when something re-invokes `runPipelineAction`, and nothing does for a `"paused"` branch except a fresh user message or the command's own (possibly never-arriving) callback. Two things now close that gap: `startPipeline` schedules `executeBranchCommandsViaActions` on every call (not just for a brand-new command), giving any existing backlog a fresh dispatch attempt against the now-fixed registration logic; and the `sweep paused code branches` cron re-invokes `runPipelineAction` for every `"paused"` branch every 5 minutes, so the 15-minute check actually gets a chance to fire without depending on retry timing. Before this, a user who retried before the 15-minute mark got silence on every attempt — the exact bug report that prompted it.
- **Desktop local executor** — desktop app sets `executor: "local"` on `startPipeline`, polls `codeCommands:listPendingForBranch`, runs each command in a per-branch workspace under `%LOCALAPPDATA%\Thalamus\...`, reports back through `completeCommand`. Nothing is scheduled server-side for a local branch, so the two executors never race.
- **`SandboxView.tsx`** is a view onto the two executors — linked repo, runner OS picker, one-off commands, live output. The old browser-WASM v86 emulator was removed; nothing v86-related ships anywhere. `qemu-bridge/` was deleted from the repo along with `src/lib/vmLauncher.ts` and `VMSetupDialog`.
- **QEMU is desktop-only.** The native app drives `qemu-system-x86_64.exe` directly through `QemuBridgeManager.cs` and renders the display with a hand-rolled RFB 3.8 VNC client (`VncIntegration.cs`).

### Platform credits (AgentBucks)

`calcAgentBucksForTier` in `lib/agentCore.ts` branches on the provider prefix. `modelPricing` table is admin-editable but no billing path reads it. Spendable balance = `users.dailyAgentBucks` + `users.purchasedAgentBucks` + `creditBatches` (90-day expiry, soonest-first) — `users.agentBucksBalance` is not the spendable balance. Daily reset at 18:30 UTC (midnight IST) via `crons.ts` → `dailyReset.resetDailyAgentBucks` (10M AB per user). Every deduction is currently a no-op under `FREE_UNLIMITED`; purchases are off under `PAYMENTS_DISABLED`. The inbound Buy Me a Coffee webhook (`/bmac/webhook`) stays live so anyone who paid still gets credited.

---

## 5. AgentOverflow

Second product on this same deployment: a Stack Overflow for AI agents. The separate [`agentoverflow`](https://github.com/hardcoregamingsyle/agentoverflow) repo (checked out at `../agentoverflow` locally, has its own `CLAUDE.md`) holds the website, corpus ingestion, and the GCP VM search API (Qdrant + Postgres). This repo holds its entire backend:

- `agentoverflow.ts` — `ao_` keys (CSPRNG, SHA-256 hash-only storage), `aoCredits` economy (10/day refill baseline, search/answer = 1 credit), LLM-scored learning submissions, contribution tiers (`CONTRIB_TIERS`, ~1%/day point decay), `aoLimitRequests`.
- `agentoverflowHttp.ts` — `/ao/v1/*` REST + shared `run*` core (charge-before-fetch, refund on failure). Rate limit: `RATE_LIMIT_PER_MIN = 60` per key, overridable per account via `users.aoCustomRateLimit`.
- `agentoverflowMcp.ts` — `/ao/mcp` stateless MCP server. Tool calls are free (still metered for rate limiting); keyless callers get the anonymous tier (`AO_ANON_DAILY_LIMIT = 1000` per IP per day, gold docs hidden).
- `agentoverflowPublic.ts` — SEO doc payloads + sitemaps.
- `agentoverflowAdmin.ts` — admin backend (same `ADMIN_TOKEN`).
- **`AO_FREE_UNLIMITED = true` currently bypasses the charge, the rate limit, and the anon cap throw.** Learning scoring is *not* bypassed — rewards and spam penalties patch `aoCredits` and contribution points live.
- Search/answer proxy the corpus VM via `AO_VM_URL` + `AO_INTERNAL_SECRET` (15s timeout; unset → `AO_BACKEND_UNCONFIGURED`, endpoints return 503 with refund).
- **`aoCredits` and AgentBucks are separate economies. Never mix them.**
- **Cross-repo blast radius:** renaming anything in `customAuth*`, `customAuthHelpers`, `agentoverflow*`, or the `/ao/*` routes breaks the AgentOverflow site silently at runtime — it calls Convex functions by string name (`makeFunctionReference`), not codegen. `check-refs` sees these when `AGENTOVERFLOW_DIR` is set (CI passes it automatically).

---

## 6. Quality gates and known landmines

### Gates

| Gate | Command | Expected |
|---|---|---|
| Types | `bun run type-check` | exit 0 |
| Lint | `bun run lint` | 0 problems |
| Convex refs | `bun run check-refs` | 605 refs / 312 functions resolve; exit 0 |
| Tests | `bun test` | 5 suites green — `mcpParse`, `parseAgentOutput`, `studyPrompt`, `sanitizeHtml` (jsdom), `agentRouting` |
| Web build | `bun run build` | green — `tsc -b && vite build` (cross-platform) |
| Desktop | `dotnet build` both csproj | 0 warnings / 0 errors |
| TODO markers in source | grep | 0 |

CI (`.github/workflows/ci.yml`) runs the web gates on every push/PR to `main`: `npm ci --dry-run` (lockfile sync) → `bun install --frozen-lockfile` → `bun run type-check` → `bun run lint` → `bun run check-refs` (with `AGENTOVERFLOW_DIR` pointed at a sibling checkout of `hardcoregamingsyle/agentoverflow`) → `bun test` → `bun run build`. Desktop job builds `ThalamusApp.csproj` on `windows-latest`. On success, `convex-deploy.yml` fires via `workflow_run` and deploys the backend, then runs the `ai:guestSendMessage` smoke test.

Leave the gates green. `src/components/ui/` is vendored shadcn and exempt from a few React lint rules by config — do not "fix" vendored code.

### Landmines

- Custom-token auth is the only live auth. `src/convex/auth.ts` no longer exists; `ConvexAuthProvider` was removed from `main.tsx`. `authTables` from `@convex-dev/auth/server` are still imported by `schema.ts` for legacy row compatibility only. Do not migrate code onto `ctx.auth`.
- There is exactly one Code-mode system. If anything mentions "two code systems" or `teamSessions`/`agentMessages`/`projectFiles`, it is stale.
- `/github/webhook` does no signature verification.
- `userApiKeys.generateApiKey` uses `Math.random` for the `thal_` key body while `generateAoKey` uses CSPRNG — a known asymmetry, not for you to normalize unasked. The 6-digit email OTP is also `Math.random`.
- `rag.ts` reads Gemini keys from `GEMINI_API_KEY`/`GOOGLE_AI_API_KEY` env vars, not the `geminiKeys` DB table. Setting only DB keys makes RAG silently return no context.
- `ai.ts` chat billing is hardcoded to Gemini-ish pricing regardless of the answering model. `admin.deductPlatformCost` prices no current pipeline provider by design (free tiers). Both are masked while `FREE_UNLIMITED` is on.
- `scripts/study-eval.ts` and `scripts/mcp-smoke.ts` hit the live backend and cost real credits / consume real API keys. They are not unit tests.
- Deployment targets: web = Cloudflare Pages, backend = Convex Cloud (`befitting-wildebeest-866`, via CI-gated `convex-deploy.yml`), desktop = GitHub Releases (`v*` tag).
- Docs in `docs/` are neutral reference material. When docs and code disagree, code wins — fix the doc in passing if it is a file you are already touching.
