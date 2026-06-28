<div align="center">
  <img src="public/assets/Untitled_design.png" alt="Thalamus" width="96" />

  # Thalamus

  **An AI platform that doesn't just answer questions — it builds software.**

  Chat · Research · Study · Code · VM Sandbox

  [![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178c6?style=flat-square&logo=typescript)](https://www.typescriptlang.org/)
  [![React](https://img.shields.io/badge/React-19-61dafb?style=flat-square&logo=react)](https://react.dev/)
  [![Convex](https://img.shields.io/badge/Convex-1.39-f97316?style=flat-square)](https://convex.dev/)
  [![Vite](https://img.shields.io/badge/Vite-7-646cff?style=flat-square&logo=vite)](https://vitejs.dev/)

</div>

---

Thalamus started from a simple frustration: every AI tool either answers questions *or* writes code, but never actually *delivers* software. You still have to copy-paste, debug, structure files, write tests, check for security holes, and iterate. The gap between "AI wrote this" and "this runs in production" is enormous.

Code Mode closes that gap. Describe what you want in plain English. Nine specialized agents architect, build, test, security-audit, and critique the result — running in the background via Convex scheduled functions, without blocking your browser.

The other three modes (Chat, Research, Study) are genuinely useful too, but Code Mode is where the interesting engineering lives.

---

## The four modes

**Chat** — multi-turn conversation with full context. Good for writing, planning, explaining, translating.

**Research** — live web search synthesized into coherent answers. Cites sources. Useful when training-data answers aren't fresh enough.

**Study** — upload your notes, textbook chapters, or PDFs. The system chunks them, embeds them into a vector store, and builds a knowledge graph from the content. Ask questions, get explanations tuned to what's actually in your materials, not generic web content.

**Code (Build Mode)** — describe a project. Nine agents build it. More on this below.

---

## The 9-agent pipeline

Every Code Mode task runs through this sequence. Each stage has a specific job and uses the model appropriate for that job's cost/capability tradeoff.

```
┌─────────────┐
│  Researcher │  Finds context, existing solutions, relevant docs
└──────┬──────┘
       │
┌──────▼──────┐
│   Analyser  │  Breaks requirements into subtasks, identifies edge cases
└──────┬──────┘
       │
┌──────▼──────┐
│   Planner   │  Ordered task list with per-task difficulty ratings
└──────┬──────┘
       │
┌──────▼──────┐
│    Coder    │  Writes the code — Opus 4.8 on hard/extreme tasks
└──────┬──────┘
       │
┌──────▼──────┐
│  Optimiser  │  Performance, readability, dead code, obvious improvements
└──────┬──────┘
       │
┌──────▼──────┐
│  Organizer  │  File structure, naming, exports, consistency
└──────┬──────┘
       │
┌──────▼──────┐
│   Tester    │  Writes tests, validates behavior, catches regressions
└──────┬──────┘
       │
┌──────▼──────┐
│   Hacker    │  Security: injection, auth gaps, exposed secrets
└──────┬──────┘
       │
┌──────▼──────┐
│   Critic    │  Final review — rejects incomplete work, loops back
└─────────────┘
```

The Critic can reject output and send the pipeline back to any earlier stage. This is what prevents the "looks done but doesn't actually work" problem.

Agents communicate through three embedded commands parsed directly from their output:

```
CREATEFILE src/utils/auth.ts
  <file content here>

<<RUN-COMMAND="npm install && npm test">>

<<REQUEST-API-KEY name="STRIPE_SECRET_KEY" description="needed to process payments" howToGet="dashboard.stripe.com">>
```

The pipeline parses these and acts — writing files to the branch, queuing shell commands for the sandbox, or surfacing an API key request to the user.

**Researcher** and **Hacker** are both team agents: they internally run 3 and 9 sub-agents respectively before returning a single output to the main pipeline.

---

## Model routing

Not every task needs the most powerful model. The routing matrix maps agent × run-mode to the cheapest model that handles it reliably:

| Mode | Research | Code | Security |
|---|---|---|---|
| Cheap | Gemini Flash Lite | Sonnet | Sonnet |
| Balanced | Gemini Flash Lite | Sonnet / Opus 4.6 | Sonnet |
| Powerful | Gemini Flash Lite | Opus 4.8 | Opus 4.8 |

Fallback chain when a provider is unavailable:
```
AWS Bedrock (Opus 4.8 → 4.6 → Sonnet → Haiku)
    ↓ credentials missing or rate-limited
Gemini 2.0 Flash (keys from DB, rotating pool)
    ↓ all keys exhausted
AgentRouter (agentrouter.org)
    ↓ AGENTROUTER_API_KEY missing
throw — no AI available
```

Bedrock credential priority: `ABSK*` env key > DB credentials > standard IAM key.

---

## OS virtualization

The sandbox runs real operating systems. Architecture:

```
Browser ──WebSocket──► VM Bridge (ws://localhost:5900)
                              │
                         QEMU process
                              │
                         QCOW2 disk (thin-provisioned — 200KB until written)
                              │
                         VNC on :5901
                              ▲
Browser ──VNC viewer──────────┘
```

The bridge is a compiled Node.js exe running as a Windows service. It deduplicates — if you request an OS already running, it returns the existing VM.

Thin-provisioned disks mean a "60GB Windows 11" image takes 200KB on disk until you write to it. QCOW2 pages allocate on write.

**Browser-based VMs** (v86, no bridge needed): Alpine Linux, Arch Linux, Windows 98, KolibriOS. These run in WebAssembly in the browser tab.

**QEMU-based VMs** (bridge required): Windows 11 Pro, Windows 10 Pro, macOS Sequoia–Big Sur, Android 14/13, Ubuntu, Debian, Kali.

---

## Getting started

```bash
git clone https://github.com/hardcoregamingsyle/thalamus
cd thalamus
bun install
```

Both processes need to run in parallel:

```bash
# Terminal 1 — backend
npx convex dev

# Terminal 2 — frontend
bun run dev
```

Minimum `.env.local`:

```
CONVEX_DEPLOYMENT=your-deployment-name
VITE_CONVEX_URL=https://your-deployment.convex.cloud
```

For auth you also need these set as Convex environment variables (Convex Dashboard → Settings → Environment Variables):
- `JWKS` — JSON Web Key Set
- `JWT_PRIVATE_KEY` — for signing tokens
- `SITE_URL` — your public URL

Everything else — AWS credentials, Gemini keys, GitHub OAuth — goes through `/admin` and is stored in the database. You don't need env vars for these.

---

## Project layout

```
src/
├── convex/                  # Entire backend
│   ├── schema.ts            # DB tables — start here
│   ├── agentCore.ts         # Model calls, pricing, Bedrock/Gemini/AgentRouter
│   ├── agentPipeline.ts     # 9-agent pipeline (Team system, /team route)
│   ├── codePipeline.ts      # 9-agent pipeline (Code system, /portal/code)
│   ├── agentTeamHelpers.ts  # Session/file/branch mutations for Team system
│   ├── codeBranches.ts      # Branch/file/message mutations for Code system
│   ├── ai.ts                # Chat, research, study AI handlers
│   ├── rag.ts               # Vector search + GraphRAG for Study Mode
│   ├── github*.ts           # OAuth, sync, webhook, auto-create repos
│   ├── antiEvasionDb.ts     # Repo ID + structure fingerprinting
│   └── crons.ts             # Scheduled jobs
│
├── pages/
│   ├── Portal.tsx           # Chat / Research / Study hub
│   ├── TeamPortal.tsx       # Original code workspace
│   ├── CodeWorkspace.tsx    # Current code workspace
│   └── Admin.tsx
│
├── components/
│   ├── ui/                  # Shadcn primitives — don't edit
│   └── code-workspace/      # Tabs: editor, sandbox, git, keys, deploy...
│
└── lib/
    └── vmLauncher.ts        # WebSocket client for QEMU bridge
```

### Two parallel pipeline systems

`agentPipeline.ts` / `teamSessions` / `TeamPortal.tsx` — the original system, still live on the `/team` route.

`codePipeline.ts` / `codeProjects` / `CodeWorkspace.tsx` — the current system, active on `/portal/code`. This is where new development happens.

Both run the same 9 agents. The newer system has per-branch file isolation, run modes (cheap/balanced/powerful), command queuing, and API key requests. Migration from the old system is handled by `codeMigration.ts` if needed.

---

## AgentBucks (credits)

Every AI call deducts credits proportional to tokens. The conversion: cost-in-cents × 1,500,000 = AgentBucks deducted.

| Model | Input / 1M | Output / 1M |
|---|---|---|
| Gemini Flash Lite | $0.006 | $0.024 |
| Claude Haiku 4.5 | $0.018 | $0.072 |
| Claude Sonnet 4.6 | $0.054 | $0.265 |
| Claude Opus 4.6 | $0.074 | $0.420 |
| Claude Opus 4.8 | $0.120 | $0.600 |

Credits reset daily. Purchased credits don't expire. The admin panel shows platform spend vs. budget in real time and lets you disable the platform if spend exceeds budget.

---

## Anti-abuse

Two mechanisms prevent free-tier farming via account rotation, implemented in `antiEvasionDb.ts`:

**GitHub repo ID** — GitHub assigns every repo a permanent integer ID that survives renames. On import, we fetch `repoData.id` and check it against `repoFingerprints`. If the repo already exhausted free tier, the clone is blocked regardless of which account requests it.

**Structure fingerprint** — On import we compute SHA-256 over the sorted file path list (excluding `node_modules/`, `.git/`, `dist/`, build artifacts). Same codebase under a different repo name produces the same hash, checked against `structureFingerprints`.

Both fingerprints are marked exhausted either manually from the admin panel or automatically when a user's balance hits zero with no remaining daily or purchased credits.

---

## Deployment

**Frontend** → Cloudflare Pages. `bun run build`, deploy `dist/`.

**Backend** → `npx convex deploy` (or `bash scripts/deploy-selfhosted.sh` for self-hosted Convex).

**Desktop app** → Neutralinojs (2.2MB exe + resources.neu). Requires Windows Edge WebView2 — ships with every Windows 10/11 machine.

**VM bridge** → Compiled with `pkg`, runs as a Windows startup service via Task Scheduler. Installed automatically by the installer.

**Installer** → `pkg` bundle. Downloads QEMU, the bridge, the desktop app, TightVNC, aria2, and optional OS ISOs. Registers `thalamus://` URI scheme and Add/Remove Programs entry.

---

## FAQ

**Pipeline stalls at Researcher?**
AWS Bedrock credentials not configured. Add them via `/admin` → AWS tab. Without Bedrock it falls to Gemini — if those keys are also exhausted, it stalls at `callAgentRouter`. Check the Convex function logs for the specific error.

**Works on macOS/Linux?**
Web app: yes. Desktop app and VM bridge: Windows only.

**Why are there two code workspaces?**
`teamSessions` came first. `codeProjects` was built to fix its design limitations (no branch isolation, no command queuing, no run modes). Both are live during migration.

**VM bridge phones home?**
No. It's a local WebSocket server on `localhost:5900` that talks only to your machine's QEMU process. The website sends commands to your local bridge — nothing goes to a remote server.

**Windows Defender flags the installer?**
It's unsigned. Click "More info" → "Run anyway". Source is in `installer-v7.cjs`.

---

*Thalamus — built by Aphantic Corporations.*
