# Thalamus Documentation

Reference documentation for the Thalamus codebase — one Convex backend, two clients (React web app + WPF/.NET 8 desktop app), two products (Thalamus + AgentOverflow) on the same deployment.

Start with [Architecture](./architecture.md) for the layout, then follow the links below for whichever subsystem you need.

## Index

| Document | What it covers |
|---|---|
| [Architecture](./architecture.md) | Directory map, high-level data flow, deploy targets, known debt |
| [Frontend](./frontend.md) | Pages, routes, Portal/Landing/Admin/MobilePortal splits, providers, UI stack |
| [Backend](./backend.md) | Convex modules, schema tables, HTTP routes, cron jobs, `src/convex/lib/` |
| [AI Pipeline](./ai-pipeline.md) | The dynamic agent pipeline, provider chain, JSON-op contract |
| [Executors](./executors.md) | The two command executors: GitHub Actions cloud worker + desktop local |
| [Auth](./auth.md) | Custom-token auth, email OTP, Google/GitHub OAuth, desktop pairing |
| [Deployment](./deployment.md) | CI, deploy workflows, single environment-variable reference |
| [Development](./development.md) | Local setup, scripts, tests, common issues |
| [AgentOverflow](./agentoverflow.md) | The AgentOverflow product surface on this deployment |
| [Desktop App](./desktop-app.md) | WPF app internals — layout, services, VM sandbox, build |

Desktop build instructions: [`thalamus-native/BUILD.md`](../thalamus-native/BUILD.md).

## System at a glance

```
┌─ Clients ──────────────────────────────────────────────────────┐
│  Web (React 19 + Vite 7)   Desktop (WPF/.NET 8)               │
│                                                                │
│  External tools via /api/v1/chat/completions (thal_ keys)     │
│  AgentOverflow website (separate repo, same backend)          │
└──────────────────────┬─────────────────────────────────────────┘
                       │  Convex functions + HTTP actions
┌──────────────────────▼─────────────────────────────────────────┐
│                    Convex Cloud                                │
│  (befitting-wildebeest-866, deployed by CI on push to main)   │
│                                                                │
│  Chat / Research / Study : /stream-chat (SSE)                  │
│  Code (agent pipeline)    : codePipeline.runPipelineAction     │
│  Auth (custom token)      : customAuth, customSessions         │
│  AgentOverflow            : /ao/v1/* + /ao/mcp                 │
│                                                                │
│  Pipeline provider chain (callModel in lib/agentCore.ts):     │
│    Modal → OpenCode Zen → DeadlySignal → ModelScope           │
│      → OVHcloud → Ollama Cloud                                 │
│                                                                │
│  Legacy chat/study chain (ai.ts, study.ts, /stream-chat):     │
│    AWS Bedrock → Gemini → VLY                                 │
└──────────────────────┬─────────────────────────────────────────┘
                       │
        ┌──────────────┼──────────────┐
        ▼              ▼              ▼
  GitHub Actions   GitHub API    AgentOverflow VM
  (cloud runner)   (OAuth, sync,  (Qdrant + Postgres,
                    webhooks)     AO_VM_URL)
```

## Tech stack

| Layer | Technology |
|---|---|
| Frontend | React 19, Vite 7, TailwindCSS 4, shadcn (trimmed to 13 primitives), Framer Motion, React Router 7 |
| Backend | Convex — 309 exported functions across ~50 modules + `src/convex/lib/` |
| Pipeline models | Modal (admin-registered), OpenCode Zen, DeadlySignal, ModelScope, OVHcloud, Ollama Cloud |
| Legacy chat/study models | AWS Bedrock (Claude Haiku default), Google Gemini Flash Lite, VLY (last resort) |
| Desktop | WPF, .NET 8, self-contained single-file `Thalamus.exe`, zero NuGet dependencies in the shipping project |
| Auth | Custom-token — email OTP via Brevo, Google/GitHub OAuth, desktop device-code pairing |
| Package manager | Bun 1.2.10+ |
| CI/CD | GitHub Actions — `ci.yml`, `convex-deploy.yml` (post-CI), `release.yml` (`v*` tag) |
| VM Sandbox | GitHub Actions runner (cloud); QEMU driven directly by the WPF app (desktop only) |
