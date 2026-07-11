# HANDOVER

Everything you need to run, extend, and not break Thalamus. Written by the guy who built it, for whoever touches it next. Read this before you "refactor" anything — half the things that look weird in here are load-bearing, and the other half are documented below as debt with a plan.

---

## 1. The ten-second mental model

- **One backend**: Convex (`src/convex/`). Every serverless function, the schema, the cron jobs, the model routing — all of it.
- **Two frontends**: the web app (`src/`, React 19 + Vite) and a native Windows app (`thalamus-native/`, WPF on .NET 8). The desktop app is NOT a web wrapper — it's real XAML talking to the same Convex backend over HTTP/SSE.
- **Four modes**: Chat, Research, Study, Build. Build runs the nine-agent pipeline.
- **Money**: AgentBucks. Users burn credits per token; pricing lives in the `modelPricing` table; `/admin` is mission control.

If you remember nothing else: **`agentCore.ts` is the heart.** Model routing, credit deduction, and every agent's system prompt live there. Break it and everything breaks.

---

## 2. Things that will bite you if nobody tells you

### There are TWO code-mode systems. Yes, two.

| | OLD (Team Portal) | NEW (Code Mode) |
|---|---|---|
| Tables | `teamSessions`, `agentMessages`, `projectFiles` | `codeProjects`, `codeBranches`, `codeMessages`, `codeFiles` |
| Pipeline | `agentPipeline.ts` | `codePipeline.ts` |
| UI | `TeamPortalInline.tsx` (rendered inside `Portal`) | `CodeProjects/CodeBranches/CodeWorkspace` at `/portal/code` |

Both run the same nine agents. They evolved in parallel and both hold live user data. **Direction: NEW is canonical.** The old system keeps working until its data is migrated, but new features go into `codePipeline.ts` / the `code*` tables only. Don't add features to both. Don't "quickly fix" something in one and forget the twin exists.

Consolidation plan when you're ready: (1) write a migration for `teamSessions` → `codeProjects` (a dead-code migration file existed once — `codeMigration.ts` — resurrect the idea, not the code), (2) point Portal's code mode at the NEW UI, (3) delete `agentPipeline.ts`, `agentTeamHelpers.ts`, `TeamPortalInline.tsx` (~7k lines gone). Do it in that order, verify at each step, and do NOT do it the week of a launch.

### The sandbox has three backends

`sandboxType` in the schema is `daytona | v86 | qemu`. Daytona (`sandbox.ts`) runs cloud sandboxes; v86 runs x86-in-WASM in the browser; QEMU needs the local bridge (`qemu-bridge/`, port 5900) or, on desktop, `QemuBridgeManager` launches QEMU directly. Three ways to do one job is two too many — v86 is the weakest and least used. If you're looking for something to delete, start your investigation there, but *measure usage first*.

### Schema has fossil fields

`teamSessions` carries both the live branch model (`currentBranch`, `branchesJson`) and a deprecated branch-group model (`branchGroupId`, `branchNumber`, `parentSessionId`, plus the `sessionBranchGroups` table). The deprecated fields exist so old rows don't explode. When the OLD system dies, they die with it.

### The desktop installer is picky

WPF single-file publish creates a temp `*_wpftmp` project. Stale `obj/`/`bin/` makes it fail with confusing errors. `build.ps1` nukes them before publishing — if you build by hand and it gets weird, delete both folders and go again. Also: both csproj files target `net8.0-windows`. Keep them in lockstep; they drifted once (installer on net10, SDK on 8) and the installer silently couldn't build at all.

### Prompts are code

The giant template literals in `agentCore.ts` are the agents' system prompts. They are tuned. Whitespace, ordering, the ALL-CAPS rules — the pipeline's output quality depends on them. Treat any prompt edit like a schema migration: deliberate, tested, one at a time.

---

## 3. Security model (the short version)

- **Auth**: email OTP via `@convex-dev/auth`, plus `customSessions` tokens for the desktop app and API. GitHub OAuth for repo sync.
- **User provider keys** (`codeApiKeys`): AES-256-GCM encrypted at rest with `API_KEY_ENCRYPTION_SECRET`. The write path **fails closed** — no secret configured, no key stored. `listApiKeys` never returns values.
- **Platform API keys** (`/api-keys`, `thal_*`): SHA-256 hashed before storage; only the hash is kept.
- **Admin**: gated by `ADMIN_TOKEN` (Convex env var). The `/admin` route is hidden in desktop builds.
- **Model keys**: Bedrock/Gemini credentials live in the Convex dashboard or the DB (DB wins). Never in the repo. The repo has zero secrets and it stays that way.

---

## 4. Ops runbook

### Deploy the web app

```bash
bun run build                  # verify green locally first
bash scripts/deploy-selfhosted.sh
```

### Ship a desktop release

```powershell
cd thalamus-native
.\build.ps1 -Version "X.Y.Z"   # builds app + installer + Inno + checksums
gh release create vX.Y.Z dist\Thalamus-Setup-vX.Y.Z.exe dist\checksums.txt --repo hardcoregamingsyle/thalamus
```

Or push a `vX.Y.Z` tag and let `.github/workflows/release.yml` do it. **Either way: update the website's download links after.** A release nobody can download didn't happen.

### When the pipeline stalls

A branch's pipeline pauses for two legit reasons: waiting on API keys (`codeApiKeyRequests` with status `pending`) or waiting on commands (`codeCommands` status `pending`). When the last pending item resolves, the pipeline reschedules itself (`scheduler.runAfter → runPipelineAction`). If a branch looks stuck, check those two tables first — nine times out of ten something's sitting in `pending` that the sandbox never picked up.

### Credits misbehaving

Daily AgentBucks reset is a cron at 18:30 UTC (midnight IST) — `crons.ts` → `dailyReset.resetDailyAgentBucks`. Pricing per model tier is the `modelPricing` table, editable from `/admin`. Deduction happens inside `agentCore.ts` after each call, from actual token counts.

---

## 5. Quality gates (non-negotiable)

| Gate | Command | Expected |
|---|---|---|
| Types | `bun run type-check` | exit 0 |
| Lint | `bun run lint` | 0 problems |
| Web build | `bun run build` | green |
| Desktop | `dotnet build` both csproj | 0 warnings / 0 errors |
| TODOs | grep the repo | 0 |

These were all driven to green the hard way. The bar is: leave them green. A PR that adds a warning is a PR that isn't done. `src/components/ui/` is vendored shadcn and exempt from a few React lint rules by config — that's intentional, don't "fix" vendored code.

---

## 6. Known debt (honest list)

1. **Two code-mode systems** — biggest item, plan in §2. ~8k lines of duplication with a live-data migration in the way.
2. **Triple sandbox stack** — consolidation candidate after usage measurement.
3. **`teamSessions` fossil fields + `sessionBranchGroups`** — dies with the OLD system.
4. **`TeamPortalInline.tsx` is ~3.9k lines** — it works, but it's a monolith. If you must touch it, extract as you go; don't grow it.

That's the whole list. Everything else that looked like debt was deleted, not documented.

---

## 7. Map of who talks to what

```
Browser ──HTTP/WS──> Convex (src/convex) ──HTTPS──> Bedrock / AgentRouter / Gemini
   │                        │
   │ v86 (WASM, in-tab)     └── GitHub API (OAuth, repo sync, webhooks)
   └─WS──> qemu-bridge (localhost:5900) ──> QEMU

Thalamus.exe ──HTTP/SSE──> same Convex backend
   └── QemuBridgeManager ──spawns──> QEMU ──RFB 3.8──> embedded VNC widget
```

One backend. Everything else is a client. Keep it that way and this stays maintainable by one person — which is the whole point.
