# HANDOVER

Everything you need to run, extend, and not break Thalamus. Written by the guy who built it, for whoever touches it next. Read this before you "refactor" anything — half the things that look weird in here are load-bearing, and the other half are documented below as debt with a plan.

---

## 1. The ten-second mental model

- **One backend**: Convex (`src/convex/`). Every serverless function, the schema, the cron jobs, the model routing — all of it.
- **Two frontends**: the web app (`src/`, React 19 + Vite) and a native Windows app (`thalamus-native/`, WPF on .NET 8). The desktop app is NOT a web wrapper — it's real XAML talking to the same Convex backend over HTTP/SSE. Feature parity is a standing rule: the desktop shows the live AgentBucks balance, lists and reopens cloud conversations per mode (same `conversations`/`messages` tables), and has a runtime light/dark toggle (`Theme.xaml` dark + `Theme.Light.xaml` overlay via `ThemeManager`, everything DynamicResource).
- **Four modes**: Chat, Research, Study, Build. Build runs the dynamic agent pipeline — a Dispatcher picks which of the nine agents a task actually needs (Coder and Critic are always in).
- **Money**: AgentBucks — and right now, nothing. The platform is free and unlimited on purpose (`FREE_UNLIMITED` in `agentCore.ts`, `PAYMENTS_DISABLED` in `payments.ts`), so the per-token deduction is a no-op and the buy flow is off. The meter still computes real numbers — per-token rates live in `calcAgentBucksForTier`, not in the `modelPricing` table, which nothing reads. `/admin` is mission control.
- **AgentOverflow**: a second product riding this same backend — a Stack Overflow for AI agents with its own site (separate repo), its own `ao_` keys, and its own credit economy (`aoCredits`, not AgentBucks). Backend half, one file per concern: `agentoverflow.ts` (economy + keys + learnings), `agentoverflowHttp.ts` (REST, and the shared `run*` core both transports use), `agentoverflowMcp.ts` (MCP server — free calls, still rate-limited), `agentoverflowPublic.ts` (SEO surface: public docs + sitemaps), `agentoverflowAdmin.ts` (admin panel backend), plus the `ao*` tables.

If you remember nothing else: **`agentCore.ts` is the heart.** Model routing, credit deduction, and every agent's system prompt live there. Break it and everything breaks.

---

## 2. Things that will bite you if nobody tells you

### There is ONE code-mode system now

There used to be two. The old Team Portal half — `teamSessions`/`agentMessages`/`projectFiles`, `agentPipeline.ts`, `agentTeamHelpers.ts`, `TeamPortalInline.tsx`, and the tables behind them — is deleted. React-router had already made its UI unreachable (`/portal/code` matched the static route, so the inline mount never rendered), so it was dead weight pretending to be a migration problem. If you find a doc, comment or memory that says "two code systems", it's stale.

What's left: `codeProjects`/`codeBranches`/`codeMessages`/`codeFiles`, driven by `codePipeline.ts`, at `/portal/code/*` in `CodeProjects` → `CodeBranches` → `CodeWorkspace`. A Dispatcher phase runs first and picks the agent subset; the pick is persisted as `dispatchedAgentsJson` on the branch and the pipeline filters its phase lists against it.

**The desktop app's Build mode drives this same system** over Convex's public HTTP API — `codeProjects:createProject` → `codePipeline:startPipeline`, then polls `codeBranches:getBranch` / `watchMessages` / `watchFiles`, and stops with `codePipeline:stopPipeline` (see `thalamus-native/.../Modes/CodeView.xaml.cs`). Changing those public signatures breaks shipped desktop builds. Treat them as API — and remember `tsc` cannot see those call sites at all, which is what `bun run check-refs` is for.

### The sandbox has two executors

`<<RUN-CMD>>` runs on GitHub Actions from the web (`githubActionsRunner.ts`) or on your own machine from the desktop app — and the Sandbox tab now shows exactly that: which runner the branch builds on, links into its repo and build history, a box for one-off commands, and the live output of everything that has run. It used to be a v86 screen asking you to start a bridge that had nothing to do with how commands actually execute; that's gone, along with every v86 asset. QEMU survives on the desktop, where `QemuBridgeManager` launches it directly.

### Everything is free, and that's five switches

Free and unlimited is the product, permanently — but it's five separate booleans that don't know about each other: `FREE_UNLIMITED` (`agentCore.ts`), `AO_FREE_UNLIMITED` (`agentoverflow.ts`), `PAYMENTS_DISABLED` (`payments.ts`), `GUEST_UNLIMITED` (`Portal.tsx`), and `FREE_UNLIMITED` in the agentoverflow repo's `api/app/keystore.py`. CLAUDE.md §4 has the full table and the flip checklist. The reason it matters: several billing paths are quietly broken (platform-cost pricing doesn't recognise any current model name, chat billing is hardcoded to Gemini rates), and they're only harmless while every switch is on. Don't flip one in isolation.

### The desktop installer is picky

WPF single-file publish creates a temp `*_wpftmp` project. Stale `obj/`/`bin/` makes it fail with confusing errors. `build.ps1` nukes them before publishing — if you build by hand and it gets weird, delete both folders and go again. Also: both csproj files target `net8.0-windows`. Keep them in lockstep; they drifted once (installer on net10, SDK on 8) and the installer silently couldn't build at all.

### AgentOverflow rides this deployment

The [`agentoverflow`](https://github.com/hardcoregamingsyle/agentoverflow) repo has no backend of its own — its website and its `/ao/v1/*` API authenticate, meter, and store everything through THIS Convex deployment. Renaming or "cleaning up" anything in `customAuth*`, `userApiKeys.getSessionUserId`, or the `/ao/v1/*` routes breaks a whole separate website that doesn't live in this repo. The corpus search itself happens on a GCP VM (Qdrant + Postgres); until `AO_VM_URL` and `AO_INTERNAL_SECRET` are set in the Convex dashboard, search/answer return 503 (with the credit refunded) and learning submissions retry for a while, then settle without payout. Deploy the VM first — the RUNBOOK in the agentoverflow repo is the order of operations.

### Prompts are code

The giant template literals in `agentCore.ts` are the agents' system prompts. They are tuned. Whitespace, ordering, the ALL-CAPS rules — the pipeline's output quality depends on them. Treat any prompt edit like a schema migration: deliberate, tested, one at a time.

---

## 3. Security model (the short version)

- **Auth**: custom token auth end-to-end. `customAuth.sendOtp`/`verifyOtp` mint a 64-hex `customSessions` token (30-day expiry) that web, desktop and API all pass as an explicit `{token}` argument — nothing is inferred from the connection. `@convex-dev/auth` (`auth.ts`, `ConvexAuthProvider`) is vestigial: its routes are still mounted and two dead fallbacks still read `ctx.auth`, but no live sign-in ever populates it. GitHub OAuth for repo sync.
- **User provider keys** (`codeApiKeys`): AES-256-GCM encrypted at rest with `API_KEY_ENCRYPTION_SECRET`. The write path **fails closed** — no secret configured, no key stored. `listApiKeys` never returns values.
- **Platform API keys** (`/api-keys`, `thal_*`): SHA-256 hashed before storage; only the hash is kept.
- **AgentOverflow keys** (`ao_*`): same rule — SHA-256 hashed, hash-only storage, 60 req/min per key by default (overridable per account via `users.aoCustomRateLimit`, and currently bypassed entirely by `AO_FREE_UNLIMITED`). Their credits (`aoCredits`) are a separate economy from AgentBucks; the two never mix.
- **Admin**: gated by `ADMIN_TOKEN` (Convex env var). The `/admin` route is hidden in desktop builds.
- **Model keys**: NIM / Ollama / Modal credentials come first (`nimKeys`, `ollamaKeys`, `modalEndpoints` tables, env vars as fallback); Bedrock and Gemini are still live for chat, study and `/stream-chat`. DB beats env everywhere. Never in the repo — with one exception worth knowing about: `src/lib/vly-integrations.ts` carries a hardcoded fallback key for the VLY completion provider.

---

## 4. Ops runbook

### Deploy

Push to main and both halves ship themselves: Cloudflare Pages builds the
frontend from `package-lock.json` with `npm ci`, and
`.github/workflows/convex-deploy.yml` runs `npx convex deploy` on GitHub's own
runners once the CI workflow goes green on that commit — needs a
`CONVEX_DEPLOY_KEY` repo secret (Settings → Secrets and variables → Actions)
or it just fails loudly instead of shipping nothing silently. Also wired to
`workflow_dispatch` for a manual re-run.

```bash
bun run build                  # verify green locally first
npx convex deploy              # backend → Convex Cloud (befitting-wildebeest-866), manual/local path
```

On this machine `.env.local` points at a different (dev) deployment, so a bare `npx convex …` targets the wrong project. Use the gitignored `convex-prod.ps1` wrapper — `.\convex-prod.ps1 deploy -y` — which forces the prod deploy key without touching `.env.local`.

### Ship a desktop release

```powershell
cd thalamus-native
.\build.ps1 -Version "X.Y.Z"   # builds app + installer + Inno + checksums
gh release create vX.Y.Z installer-build\Thalamus.exe dist\Thalamus-Setup-vX.Y.Z.exe dist\checksums.txt --repo hardcoregamingsyle/thalamus
```

Or push a `vX.Y.Z` tag and let `.github/workflows/release.yml` do it — that path attaches the bare `Thalamus.exe` and nothing else.

**The bare `Thalamus.exe` asset is not optional.** Every download link on the site — and the installer's own `URL_APP` — points at `releases/latest/download/Thalamus.exe`, so a release carrying only the Setup exe 404s for every visitor and every install. `build.ps1` leaves the bare exe in `installer-build\`, not `dist\`; the hint it prints at the end lists only the `dist\` artifacts, so don't copy-paste it blindly. Get that asset name right and there is nothing to update on the website.

### When the pipeline stalls

A branch's pipeline pauses for two legit reasons: waiting on API keys (`codeApiKeyRequests` with status `pending`) or waiting on commands (`codeCommands` status `pending`). When the last pending item resolves, the pipeline reschedules itself (`scheduler.runAfter → runPipelineAction`). If a branch looks stuck, check those two tables first — nine times out of ten something's sitting in `pending` that the sandbox never picked up.

### Credits misbehaving

Daily AgentBucks reset is a cron at 18:30 UTC (midnight IST) — `crons.ts` → `dailyReset.resetDailyAgentBucks`. Per-token rates are computed by `calcAgentBucksForTier` in `agentCore.ts` from actual token counts, branching on the provider prefix (`modal:` / `nim:` / `ollama:`). The `modelPricing` table is editable from `/admin` but read by nothing, so don't debug a billing number by looking at it. And while `FREE_UNLIMITED` is on, the deduction never lands — if someone reports "my credits went down", that's the bug, not the other way round.

AgentOverflow credits refill on the same cron clock (`agentoverflow.dailyRefillAoCredits`) — a top-up to the user's tier refill (10–50/day by `aoContribPoints`, ladder in `CONTRIB_TIERS`), never a reset down. The same cron decays contribution points ~1%/day, so tiers slide when people stop contributing; trash submissions also cost a point at settlement. Every credit movement lands in `aoCreditLedger`, so when someone claims they were shorted a credit, the ledger settles it.

---

## 5. Quality gates (non-negotiable)

| Gate | Command | Expected |
|---|---|---|
| Types | `bun run type-check` | exit 0 |
| Lint | `bun run lint` | 0 problems |
| Convex refs | `bun run check-refs` | exit 0 — the only thing tsc can't do for you |
| Tests | `bun test` | green |
| Web build | `bun run build` | green |
| Desktop | `dotnet build` both csproj | 0 warnings / 0 errors |
| TODOs | grep the repo | 0 |

CI (`.github/workflows/ci.yml`) runs all of these on every push to `main`, and checks out the sibling `agentoverflow` repo so `check-refs` can see its string-based calls too. These were all driven to green the hard way. The bar is: leave them green. A PR that adds a warning is a PR that isn't done. `src/components/ui/` is vendored shadcn and exempt from a few React lint rules by config — that's intentional, don't "fix" vendored code.

---

## 6. Known debt (honest list)

1. **Platform cost tracking is blind.** `admin.deductPlatformCost` prices against `PLATFORM_PRICING`, which only knows Claude and Gemini names, while every pipeline call now hands it something like `Coder-nim:deepseek-v4-flash`. It scores 0, logs a warning, and `platformBudget` never moves — so the "auto-disable under $5" guard can't trip on Thalamus usage. Harmless while everything is free; the first thing to fix if that ever changes.
2. **Chat billing in `ai.ts`** is hardcoded to Gemini-ish rates no matter which model answered. Same category, same excuse.
3. **`modelPricing` is an orphan table** — an admin can edit rows that nothing reads.
5. **`src/lib/vly-integrations.ts` carries a hardcoded fallback API key** for the VLY completion provider. It shouldn't.

That's the whole list. Everything else that looked like debt was deleted, not documented.

---

## 7. Map of who talks to what

```
Browser ──HTTP/WS──> Convex (src/convex) ──HTTPS──> Modal / NVIDIA NIM / Ollama Cloud   (pipeline)
   │                        │                 └──> Bedrock / Gemini / VLY              (chat, study)
   │                        └── GitHub API (OAuth, repo sync, webhooks)
   └─WS──> qemu-bridge (localhost:5900) ──> QEMU

Thalamus.exe ──HTTP/SSE──> same Convex backend
   └── QemuBridgeManager ──spawns──> QEMU ──RFB 3.8──> embedded VNC widget

AgentOverflow site + AI agents ──HTTPS──> same Convex (/ao/v1/*) ──> GCP VM (Qdrant + Postgres corpus)
```

One backend. Everything else is a client. Keep it that way and this stays maintainable by one person — which is the whole point.
