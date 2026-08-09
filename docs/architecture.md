# Architecture

## Overview

Thalamus has three deployable units:

1. **Web app** — React 19 + Vite 7 SPA, deployed to Cloudflare Pages.
2. **Backend** — Convex serverless functions + real-time database + file storage. Convex Cloud (`befitting-wildebeest-866`), deployed by CI on push to `main`.
3. **Desktop app** — Standalone Windows single-file exe (WPF/C#, .NET 8, self-contained). GitHub Releases on `v*` tag.

All three clients talk to the same Convex backend. A fourth client, the [AgentOverflow](./agentoverflow.md) website in a separate repository, drives the same backend by string reference over the public HTTP API.

## Directory structure

```
thalamus/
├── src/
│   ├── main.tsx                    entry — lazy routes, chunk-error reload boundary
│   ├── pages/                      route components (lazy-loaded)
│   │   ├── Landing.tsx             composes pages/landing/ sections
│   │   ├── landing/                Hero, ModeGrid, PipelineSection, StudySection,
│   │   │                           CapabilityBand, FaqSection, FinalCta, NavBar, Footer
│   │   ├── Portal.tsx              dispatches to portal/ based on auth + viewport
│   │   ├── portal/                 GuestPortal, PortalDesktop, ModeSelection,
│   │   │                           modes.ts (10 modes), guestSession.ts,
│   │   │                           types.ts, suggestions.ts
│   │   ├── MobilePortal.tsx        dispatches to mobile/
│   │   ├── mobile/                 MobileHomeScreen, MobileChatView, MobileMessageBubble
│   │   ├── Admin.tsx               264-line shell over 15 lazy admin tabs
│   │   ├── admin/                  UsersTab, DauTab, CreditsTab, PromoCodesTab,
│   │   │                           SuggestionsTab, StudyMaterialsTab,
│   │   │                           ProviderB/C/D/E KeysTab, AdsTab, PaymentsTab,
│   │   │                           VmIsoCatalogTab, AgentOverflowTab, MaintenanceTab,
│   │   │                           shared.ts
│   │   ├── CodeProjects / CodeBranches / CodeWorkspace / ApiPage / Auth /
│   │   │   AuthDesktop / Refer / Legal / Blog / BlogPost / NotFound
│   ├── components/
│   │   ├── ui/                     13 vendored shadcn primitives — do not edit
│   │   ├── student-suite/          Study-mode toolset (9 view files) driven by
│   │   │                           components/StudentSuite.tsx
│   │   ├── code-workspace/         EditorView, DataView, DeployView, GitSyncView,
│   │   │                           SandboxView, LogsView, UsageView, KeysView, VersionView
│   │   └── code/                   Code project list UI
│   ├── content/
│   │   ├── blog.ts                 static blog posts
│   │   ├── faq.ts                  single source of truth for FAQ
│   │   │                           (mirrored in index.html JSON-LD)
│   │   └── systemPrompts.ts        client-side system prompts for /stream-chat
│   ├── hooks/
│   │   ├── use-auth.ts             custom-token auth hook
│   │   ├── use-theme.tsx           single ThemeProvider context
│   │   └── use-mobile.ts           viewport hook
│   ├── lib/                        session.ts (SESSION_KEY), convexUrls.ts,
│   │                               errorMessage.ts, fileEncoding.ts, streamChat.ts,
│   │                               dateFormat.ts, sanitizeHtml.ts (DOMPurify),
│   │                               requestAd.ts, utils.ts
│   └── convex/                     ALL backend logic — 311 exported functions
│       ├── schema.ts               tables + indexes (10-literal conversations.mode
│       │                           union; schemaValidation: false)
│       ├── codePipeline.ts         dispatcher-driven agent pipeline runner
│       ├── codeBranches.ts         branch/file CRUD + state transitions
│       ├── codeCommands.ts         command queue + executor endpoints
│       ├── codeApiKeys.ts          encrypted user-supplied provider keys
│       ├── codeProjects.ts / codeDeletion.ts
│       ├── ai.ts / aiHelpers.ts    non-pipeline chat/research/study handlers
│       ├── study.ts / studyHelpers.ts   study-mode extraction + prompts
│       ├── rag.ts / ragHelpers.ts  vector + GraphRAG for study mode
│       ├── customAuth.ts / customAuthHelpers.ts   live auth (OTP + sessions)
│       ├── desktopAuth.ts / desktopAuthActions.ts   desktop device-code pairing
│       ├── http.ts                 every HTTP route (37 registrations)
│       ├── crons.ts                three scheduled jobs
│       ├── admin.ts / adminMeta.ts   /admin backend + neutral-slug label lookup
│       ├── payments.ts / credits.ts / dailyReset.ts
│       ├── github*.ts              OAuth, repo sync, auto-create, webhooks,
│       │                           GitHub Actions runner orchestration
│       ├── deployments.ts          user-invoked Vercel / Netlify / Cloudflare deploys
│       ├── mcpServers.ts / sketchfabMcp.ts    MCP servers
│       ├── userApiKeys.ts          thal_ API keys for /api/v1/chat/completions
│       ├── agentoverflow.ts / agentoverflowHttp.ts / agentoverflowMcp.ts /
│       │   agentoverflowPublic.ts / agentoverflowAdmin.ts    AO backend
│       ├── desktopIsoCatalog.ts    admin-managed ISO catalog for the desktop VM tab
│       ├── antiEvasionDb.ts        signup abuse controls
│       ├── gravityAds.ts
│       └── lib/                    pure helper modules — see below
├── tests/                          bun test — 5 suites
├── scripts/                        check-convex-refs.mjs (build gate);
│                                   mcp-smoke.ts, study-eval.ts (both hit live backend)
├── thalamus-native/                WPF/.NET 8 desktop app (separate solution)
├── .github/workflows/              ci.yml + convex-deploy.yml + release.yml
├── docs/                           this directory
├── CLAUDE.md                       agent guidance
└── README.md                       project index
```

### `src/convex/lib/`

Pure helper modules with no Convex framework imports — load fast, easy to test.

| Module | Responsibility |
|---|---|
| `agentCore.ts` | `FREE_UNLIMITED`, `callModel` (the router), `mapModelIdToOllama`, `calcAgentBucksForTier`, `performSearch`, `performScrape`. Re-exports the three modules below so old `from "./lib/agentCore"` imports keep working. |
| `agentPrompts.ts` | `AGENT_SYSTEM_PROMPTS` — per-agent system prompts for the pipeline (Dispatcher, ResearchPlanner, Researcher, ReportMaker, FactCheck, Analyser, Planner, Coder, Optimiser, Organizer, Tester, Hacker, Critic). Treat every edit like a schema migration. |
| `modePrompts.ts` | `MODE_ADHD`, `MODE_SYSTEM_PROMPTS`, `adhdToTemperature` — per-conversation-mode prompts + temperature mapping. |
| `agentOutputParser.ts` | JSON-op parser (single-line `{"op":…}`), legacy `<<TAG>>` marker fallback for old stored messages. |
| `taskTypes.ts` | `TaskType` union + `agentToTaskType()` — the routing key for `callModel`. Only surviving export of the old `nimClient.ts`; every NIM-specific export was deleted with NIM itself. |
| `ollamaClient.ts` | Ollama Cloud client — formerly `siliconflow.ts`, export names unchanged. |
| `zenClient.ts` | OpenCode Zen client — anonymous free tier, `ZEN_API_KEY` optional. |
| `deadlySignalsClient.ts` | Keyed New API gateway (`DEADLYSIGNALS_API_KEY`). |
| `modelscopeClient.ts` | Alibaba's free API-Inference (`MODELSCOPE_API_KEY`, `.ai` host). |
| `ovhcloudClient.ts` | OVHcloud AI Endpoints — anonymous free tier, 2 RPM. |
| `modalClient.ts` | Modal endpoint client. |
| `mcpClient.ts` / `mcpParse.ts` | MCP server plumbing shared by the pipeline. |
| `codeAuth.ts` | Shared auth checks for Code-mode functions. |
| `obscureRepoGenerator.ts` | Per-branch obscure repo name generator. |
| `studyPrompt.ts` | Study-mode prompt assembly. |
| `vlyIntegrations.ts` | VLY completion provider. Throws at import if `VLY_INTEGRATION_KEY` is unset — no hardcoded fallback. |

## Data flow

### Chat / Research / Study (single-call streaming)

```
Browser
  → POST /stream-chat (http.ts SSE handler)
    → chatStreamSystemPrompts() picks the mode prompt
    → Bedrock SigV4 stream → falls back to Gemini → falls back to VLY
  → Frontend consumes SSE events (thinking / answer_start / answer / done)
  → aiHelpers.saveMessage persists the final HTML for reactive redisplay
```

### Code mode

```
User types a task in CodeWorkspace
  → codeProjects.createProject (if none)
  → codePipeline.startPipeline
    → codeBranches insert (dispatchedAgentsJson populated after Dispatcher runs)
    → scheduler.runAfter(0, internal.codePipeline.runPipelineAction)
    → bootVmForBranch (idempotent — only for executor: "cloud")
  → runPipelineAction (one agent step per invocation, self-reschedules)
    → callModel(prompt, systemPrompt, agentName, ctx, assignedModel, deadlineMs)
    → JSON ops parsed:
        create-file / edit-file / delete-file  → codeFiles + githubSync.autoPushToGithub
        search / scrape                        → performSearch / performScrape
        cmd                                    → codeCommands.queueCommand
                                                (branch → paused; executor picks it up)
        request-api-key                        → codeApiKeyRequests (blocks on user)
        mcp                                    → mcpClient roundtrip
        test/security/critic verdicts          → status transitions
    → Critic fail → loop back to Coder (no cap — the Critic decides when to pass)
  → status "completed" → files pushed to GitHub if configured
```

Real-time UI updates: `useQuery(api.codeBranches.getBranch, { branchId })` in `CodeWorkspace.tsx` subscribes to the branch document; Convex pushes updates whenever any mutation touches it, including the ~300-char `streamingContent` drip-feed.

### The two executors

`{"op":"cmd"}` execution goes to one of two backends depending on `codeBranches.executor`:

- `cloud` (default) — GitHub Actions worker per branch (`.github/workflows/thalamus-vm.yml` inside the branch's obscure per-branch repo). Polls `/code/vm-poll`, posts results to `/code/command-result`. See [`executors.md`](./executors.md).
- `local` — Desktop app polls `codeCommands:listPendingForBranch`, executes on the user's machine, reports back via `completeCommand`. Nothing is scheduled server-side; no race with the cloud path.

## Deploy targets

| Component | Where | How |
|---|---|---|
| Web frontend | Cloudflare Pages | `npm ci` + `bun run build` on push to `main`. |
| Backend (Convex) | Convex Cloud (`befitting-wildebeest-866`) | `.github/workflows/convex-deploy.yml` fires via `workflow_run` after CI passes on `main`. Runs `npx convex deploy --yes` with the `CONVEX_DEPLOY_KEY` secret, then a smoke test against `ai:guestSendMessage`. There is no local `convex login` on this machine. |
| Desktop app | GitHub Releases | `.github/workflows/release.yml` on `v*` tag builds the bare `Thalamus.exe`; the installer + Inno wrapper + checksums are built locally via `thalamus-native/build.ps1` and uploaded by hand. |

Full details: [`deployment.md`](./deployment.md).

## Real-time updates

Convex provides built-in subscriptions. Any `useQuery` re-renders when a mutation modifies data it depends on. This is how streaming agent output, file changes, and branch status updates appear live without polling.

## Known debt

Deliberately kept — the current failure modes are known and either harmless under the free-and-unlimited product decision or intentional trade-offs.

- **Chat billing is hardcoded to Gemini rates** (`ai.ts`) regardless of which model answered. Masked by `FREE_UNLIMITED`.
- **`admin.deductPlatformCost` prices no current pipeline provider by design.** `PLATFORM_PRICING` in `admin.ts` only knows `gemini-3.1-flash-lite`, `claude-haiku-4-5`, `claude-sonnet-4-6`, `claude-opus-4-6`, `claude-opus-4-8`. Every current pipeline provider (Modal, Zen, DeadlySignal, ModelScope, OVHcloud, Ollama) is free-tier and costs 0. The `platformBudget` auto-disable-at-$5 guard cannot trip on Thalamus usage; it only trips on the two AgentOverflow paths that still charge Bedrock rates (`agentoverflow.ts:908`, `agentoverflowHttp.ts:312` — they bill the `result.tier` string against `PLATFORM_PRICING`, which resolves to 0 for every current tier prefix).
- **`rag.ts` reads Gemini keys from env, not the DB.** `GEMINI_API_KEY`/`GOOGLE_AI_API_KEY` env vars only. Setting only DB `geminiKeys` rows makes RAG silently return no context.
- **`/github/webhook` performs no signature verification.**
- **`userApiKeys.generateApiKey` uses `Math.random`** for the `thal_` key body while `agentoverflow.generateAoKey` uses CSPRNG. Known asymmetry. The 6-digit email OTP is also `Math.random`.
- **`modelPricing` is an orphan table** — admin-editable but no billing path reads it.

## Historical notes

- The old `teamSessions` / `agentMessages` / `projectFiles` / `sessionBranchGroups` / `sandboxes` Code-mode system was deleted. If anything mentions "two code systems", it is stale.
- The v86 browser-WASM emulator was removed from `SandboxView.tsx`. `qemu-bridge/`, `src/lib/vmLauncher.ts`, and `VMSetupDialog` were deleted from the repository. QEMU only runs on the desktop, via `QemuBridgeManager.cs`.
- NVIDIA NIM was removed from the pipeline entirely. `NVAPI_KEY`, `nimKeys`, the admin NIM tab, and every `callNim` call are gone. Only `agentToTaskType` survives from the old `nimClient.ts` and now lives in `lib/taskTypes.ts`.
- `src/convex/auth.ts` no longer exists. `ConvexAuthProvider` was removed from `main.tsx`. `authTables` from `@convex-dev/auth/server` are still imported by `schema.ts` for row compatibility only; no live path populates `ctx.auth`.
- Frontend was split: `Portal.tsx` over `pages/portal/`; `MobilePortal.tsx` over `pages/mobile/`; `Landing.tsx` over 9 sections in `pages/landing/`; `Admin.tsx` over 16 lazy-loaded tabs in `pages/admin/`; `StudentSuite.tsx` over `components/student-suite/`. `shadcn/ui` was trimmed to 13 primitives; 29 npm dependencies were removed. Two deploy workflows collapsed to one (`convex-deploy.yml`).
