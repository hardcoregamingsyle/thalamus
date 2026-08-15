# Thalamus

Thalamus is one Convex backend with two clients: a React 19 + Vite web app and a native Windows desktop app (WPF, .NET 8). It ships four primary conversation modes — Chat, Research, Study, Code — plus six niche modes that share the same backend surface. The Code mode drives a dynamic pipeline of up to nine agents; the other modes are single-call streaming handlers.

## Modes

The `conversations.mode` union in `src/convex/schema.ts` lists ten literals; `src/pages/portal/modes.ts` marks four of them `primary: true` and shows the rest under "MORE MODES".

| Mode | Kind | What it does |
|---|---|---|
| `chat` | primary | Streaming HTML conversation via `POST /stream-chat` (SSE). |
| `research` | primary | Same streaming path with a research-report system prompt and search-tool loop. |
| `study` | primary | Vector + GraphRAG over user-uploaded materials (`ragChunks`, Gemini `text-embedding-004`). |
| `code` | primary | Dispatcher-driven agent pipeline. Chosen agents are persisted on `codeBranches.dispatchedAgentsJson`. |
| `designing` `strategising` `creative-writing` `marketing` `idea-generation` `naming` | niche | Streaming handlers with their own mode system prompts in `src/convex/lib/modePrompts.ts`. |

## Agent pipeline (Code mode)

The pipeline lives in `src/convex/codePipeline.ts`. A Dispatcher runs first, classifies the task, and returns the minimum agent set. Coder and Critic are always forced in; every other agent has to earn its slot. The full roster (`src/convex/lib/agentPrompts.ts`, `AGENT_SYSTEM_PROMPTS`): Dispatcher, ResearchPlanner, Researcher, ReportMaker, FactCheck, Analyser, Planner, Coder, Optimiser, Organizer, Tester, Hacker, Critic. Critic can reject a task and loop back to the Coder as many times as it judges necessary — there is no retry cap. The task advances only when the Critic passes it, and the Critic is told on each attempt how long it has been holding the task so it can weigh shipping something imperfect against blocking the rest of the build.

Provider chain (`src/convex/lib/agentCore.ts`, `callModel`): Modal → OpenCode Zen → OpenRouter → DeadlySignal → ModelScope → Ollama Cloud. A Dispatcher-assigned model id that `findZenModel` / `findOpenRouterModel` / `findDeadlySignalsModel` / `findModelScopeModel` recognises short-circuits directly to that provider. NVIDIA NIM and OVHcloud (whose anonymous tier stopped being free) have been removed from the pipeline. See [`docs/ai-pipeline.md`](docs/ai-pipeline.md).

## Quickstart

Requirements: [Bun](https://bun.sh) 1.2.10+, Node 20+ for the Convex CLI, .NET 8 SDK for the desktop app.

```bash
bun install
npx convex dev     # backend watcher — keep running
bun run dev        # Vite dev server (HMR disabled — refresh manually)
```

`.env.local`:

```
CONVEX_DEPLOYMENT=<your-deployment>
VITE_CONVEX_URL=https://<your-deployment>.convex.cloud
```

`VITE_CONVEX_URL` is the frontend's only build-time variable. Server-side secrets are set in the Convex dashboard — full list in [`docs/deployment.md`](docs/deployment.md#environment-variables).

Desktop build:

```powershell
cd thalamus-native
.\build.ps1
```

See [`thalamus-native/BUILD.md`](thalamus-native/BUILD.md).

## Repo layout

```
src/
  main.tsx                  entry; lazy routes; chunk-error reload boundary
  pages/                    Landing, Auth, Portal (10-mode), CodeWorkspace, Admin, Blog, Legal, ...
    portal/                 Portal dispatcher split — GuestPortal, PortalDesktop, ModeSelection, modes.ts, guestSession.ts
    mobile/                 MobilePortal split — MobileHomeScreen, MobileChatView, MobileMessageBubble
    landing/                Landing sections (9) — Hero, ModeGrid, PipelineSection, StudySection, CapabilityBand, FaqSection, FinalCta, NavBar, Footer
    admin/                  15 lazy-loaded admin tabs (Users, DAU, Credits, PromoCodes, Suggestions, StudyMaterials, ProviderB/C/D/E, Ads, Payments, VmIsos, Corpus (AgentOverflow), Maintenance)
  convex/                   backend — 312 exported Convex functions
    lib/                    pure helper modules — agentCore, agentPrompts, modePrompts, agentOutputParser, ollamaClient, zenClient, deadlySignalsClient, modelscopeClient, modalClient, mcpClient, mcpParse, taskTypes, codeAuth, obscureRepoGenerator, studyPrompt, vlyIntegrations
  components/
    ui/                     shadcn (trimmed to 13 primitives) — do not customize
    student-suite/          Study-mode toolset shell over 8 view files
    code-workspace/         Build-mode views — EditorView, DataView, DeployView, GitSyncView, SandboxView, LogsView, UsageView, KeysView, VersionView
  content/                  faq.ts (mirrored by index.html JSON-LD), blog.ts, systemPrompts.ts
  hooks/                    use-auth (custom-token), use-theme (light/dark), use-mobile
  lib/                      session.ts (SESSION_KEY), convexUrls.ts, errorMessage.ts, fileEncoding.ts, streamChat.ts, dateFormat.ts, sanitizeHtml.ts (DOMPurify)
tests/                      bun test — mcpParse, parseAgentOutput, studyPrompt, sanitizeHtml (jsdom), agentRouting
scripts/                    check-convex-refs.mjs, mcp-smoke.ts (live), study-eval.ts (live)
thalamus-native/            WPF/.NET 8 desktop app (separate solution)
docs/                       subsystem reference documentation
.github/workflows/          ci.yml (type-check, lint, check-refs, bun test, build, dotnet build) + convex-deploy.yml (post-CI) + release.yml (v* tag)
```

`src/components/ui/` contains 13 vendored shadcn primitives (badge, button, card, checkbox, collapsible, dialog, input, input-otp, label, scroll-area, select, sonner, textarea) — override via className, do not edit in place.

## Quality gates

Every push to `main` runs the same gates that CI enforces (`.github/workflows/ci.yml`).

| Gate | Command | Notes |
|---|---|---|
| Types | `bun run type-check` | `tsc -b --noEmit` |
| Lint | `bun run lint` | ESLint |
| Convex refs | `bun run check-refs` | 605 references across 312 functions; the only gate on string-called APIs (see below) |
| Tests | `bun test` | 5 suites in `tests/` |
| Web build | `bun run build` | `tsc -b && vite build` (cross-platform) |
| Desktop build | `dotnet build thalamus-native/ThalamusApp/ThalamusApp.csproj -c Release` | CI runs this on `windows-latest` |
| Format check | `bun run format:check` | Prettier — local convenience, not CI-enforced (the codebase predates a formatter and a repo-wide rewrap would bury history) |

`check-refs` matters because the generated Convex `api`/`internal` objects exceed TypeScript's instantiation depth and degrade to `any`, and three callers reach the backend by plain string: the shipped desktop `.exe`, the sibling AgentOverflow repo (via `makeFunctionReference`), and crons. Renaming any string-called `module:function` path breaks a running caller silently. CI checks out `hardcoregamingsyle/agentoverflow` into `AGENTOVERFLOW_DIR` so cross-repo references are verified.

## Deployment

- **Web frontend** — Cloudflare Pages, `npm ci` + `bun run build`. Both `bun.lock` and `package-lock.json` are committed; CI gates on `npm ci --dry-run` staying in sync.
- **Backend (Convex)** — `.github/workflows/convex-deploy.yml` runs after CI passes on `main` (via `workflow_run`), executes `npx convex deploy --yes` with the `CONVEX_DEPLOY_KEY` secret, then hits `POST /api/action` on `ai:guestSendMessage` as a smoke test and fails the run if that call does not return `"status":"success"`. There is no local `convex login` on this machine; production deploys go through CI.
- **Desktop app** — `.github/workflows/release.yml` publishes on `v*` tag push. Installer + checksums are built locally via `thalamus-native/build.ps1`.

Details: [`docs/deployment.md`](docs/deployment.md).

## Further reading

| Document | Covers |
|---|---|
| [`docs/architecture.md`](docs/architecture.md) | High-level architecture, directory map, data flow, known debt |
| [`docs/frontend.md`](docs/frontend.md) | Pages, routing, providers, Portal/Admin/Landing splits, UI stack |
| [`docs/backend.md`](docs/backend.md) | Convex modules, schema tables, HTTP routes, cron jobs |
| [`docs/ai-pipeline.md`](docs/ai-pipeline.md) | Agent pipeline internals, provider chain, JSON-op contract |
| [`docs/executors.md`](docs/executors.md) | The two command executors (GitHub Actions worker + desktop local) |
| [`docs/auth.md`](docs/auth.md) | Custom-token auth, OTP, GitHub OAuth, desktop pairing |
| [`docs/deployment.md`](docs/deployment.md) | CI workflows, environment variables, deploy targets |
| [`docs/development.md`](docs/development.md) | Local setup, patterns, tests, common issues |
| [`docs/agentoverflow.md`](docs/agentoverflow.md) | The AgentOverflow product surface on this deployment |
| [`docs/desktop-app.md`](docs/desktop-app.md) | WPF/.NET 8 desktop app internals |
| [`thalamus-native/BUILD.md`](thalamus-native/BUILD.md) | Desktop build instructions |
