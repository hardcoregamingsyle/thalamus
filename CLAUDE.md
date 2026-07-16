# CLAUDE.md

This file provides behavioral guidelines and repository context for Claude Code (claude.ai/code) or any LLM agent working within this repository.

**Tradeoff:** Bias toward caution over speed. For trivial tasks, use judgment, but always prioritize stability and accuracy.

---

## 1. Core Behavioral Guidelines

### Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

* State your assumptions explicitly. If uncertain, stop and ask.
* If multiple interpretations exist, present them—don't pick silently.
* If a simpler approach exists, propose it. Push back when warranted.
* **Never** generate random/hallucinated links or assume domain ownership.

### Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

* Build exactly what was asked—no extra features, single-use abstractions, or unrequested "flexibility."
* If you write 200 lines and it could be 50, rewrite it.
* Ask yourself: *"Would a senior engineer say this is overcomplicated?"* If yes, simplify.

### Surgical Changes & Refactoring

**Touch only what you must. Clean up only your own mess.**

* Match existing style exactly, even if you prefer a different format.
* Do not "improve" adjacent code, comments, or formatting. Don't refactor unbroken systems.
* **Dependency Check:** When refactoring or modifying a file, rigorously check and update all files that directly or indirectly depend on it.
* When your changes create orphans, remove the imports/variables/functions that *your* changes made unused. Do not remove pre-existing dead code unless asked.
* *The test:* Every changed line must trace directly to the user's request.

### Goal-Driven Autonomy

**Define success criteria. Loop until verified.**

* Transform tasks into verifiable goals (e.g., "Add validation" → "Write tests for invalid inputs, then make them pass").
* For multi-step tasks, state a brief plan and verify each step.
* **Proactive Tooling:** If a required software or package is not installed, install it automatically via the command line. Do not wait for the user to do it.
* **Desktop App Releases:** If releasing a new desktop app, you *must* ensure the endpoint at the original website is updated accordingly.

---

## 2. Development Commands & Environment

Both the Vite frontend and Convex backend must run simultaneously during development. The frontend reads `VITE_CONVEX_URL` to connect to the live backend.

```bash
bun run dev          # Start Vite dev server (frontend only)
npx convex dev       # Start Convex backend (required alongside dev server)
bun run build        # Type-check + production build → dist/
bun run type-check   # TypeScript check only (no emit)
bun run lint         # ESLint
bun run format       # Prettier (writes files)
bun test             # Run tests
bun test --watch     # Watch mode

```

### Environment Variables

**Required `.env.local`:**

```text
CONVEX_DEPLOYMENT=your-deployment-name
VITE_CONVEX_URL=https://your-deployment.convex.cloud

```

**Server-side Secrets:** Managed strictly via the Convex Dashboard, *not* `.env`. These include: `AWS_BEDROCK_API_KEY`, `AGENTROUTER_API_KEY`, `ADMIN_TOKEN`, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `JWKS`, `JWT_PRIVATE_KEY`, `SITE_URL`, `BREVO_EMAIL_SENDER`, `API_KEY_ENCRYPTION_SECRET` (AES-256-GCM key material for encrypting user-supplied provider keys at rest in `codeApiKeys`; `fulfillApiKeyRequest` fails closed if it is unset), and the AgentOverflow trio `AO_VM_URL` / `AO_INTERNAL_SECRET` / `AO_FRONTEND_URL` (corpus VM endpoint, its shared secret, and the AgentOverflow site origin for the OAuth redirect allowlist).
*Note:* AWS Bedrock credentials can also be managed through the `/admin` panel and stored in the `awsCredentials` table (the database takes priority over environment variables). Gemini keys are managed through the `/admin` → Gemini Keys tab and stored in the `geminiKeys` table.

---

## 3. Project Architecture

### Frontend (React + Vite)

* **`src/main.tsx`:** Entry point. Sets up routing, Convex auth provider, and desktop app detection (`window.NL_PORT` = Neutralinojs).
* **`src/pages/`:** Route-level components (`Portal`, `CodeProjects`, `CodeBranches`, `CodeWorkspace`, `Admin`, `Auth`, `Landing`).
* **`src/components/`:** Feature components. The `src/components/ui/` folder contains the Shadcn UI layer—**do not customize these directly**.
* **`src/lib/vmLauncher.ts`:** WebSocket client communicating with the local VM Bridge on `ws://localhost:5900`.

### Backend (Convex — `src/convex/`)

All backend logic lives here as Convex functions. The `convex.json` file points to this directory.

* **`schema.ts`:** Full database schema, standard indexes, and vector indexes.
* **`agentCore.ts`:** Model call primitives, credit deduction, and AWS Bedrock + Gemini fallback routing.
* **`agentPipeline.ts`:** The 9-agent sequential pipeline (Researcher → Analyser → Planner → Coder → Optimiser → Organizer → Tester → Hacker → Critic), running as Convex scheduled functions.
* **`agentTeamHelpers.ts`:** Shared helpers for agent coordination.
* **`ai.ts` / `aiHelpers.ts`:** AI functions for chat, research, and study modes.
* **`rag.ts`:** Vector search over `ragChunks` and `graphNodes` for study mode.
* **`auth.ts` / `auth.config.ts`:** Email OTP auth via `@convex-dev/auth`.
* **`github.ts`:** GitHub OAuth flow and repo syncing.
* **`http.ts`:** HTTP routes (OAuth callbacks, etc.).
* **`crons.ts`:** Scheduled database jobs.

---

## 4. Key Subsystems

### Two Parallel "Code Mode" Systems

The codebase currently maintains two overlapping systems. Be highly conscious of which one you are modifying:

1. **Original System:** `teamSessions` / `agentMessages` / `projectFiles` (Rendered inline by `src/pages/TeamPortalInline.tsx` inside `Portal`/`MobilePortal`; the standalone `/team` page and `TeamPortal.tsx` have been removed).
2. **Newer System:** `codeProjects` / `codeBranches` / `codeMessages` / `codeFiles` (Used in `/portal/code` routes, `src/pages/CodeWorkspace.tsx`, and powered by `codePipeline.ts`, `codeBranches.ts`, `codeCommands.ts`).
*Both use the 9-agent pipeline but rely on different entry points and data models.*

### Model Routing

AI calls route through `agentCore.ts`.

* **Priority Chain:** Claude tiers go AWS Bedrock (Opus 4.8/4.6, Sonnet, Haiku) → AgentRouter fallback. The `gemini` tier tries Google Gemini first (DB-managed keys) and falls back to Bedrock Haiku. See `callModel`/`callClaude` in `agentCore.ts`.
* Each agent in the pipeline uses a specific, hardcoded model tier (refer to `README` for the exact mapping).

### VM & Sandbox Environments

* **Browser VMs:** Utilizes the `v86` npm package for x86 WebAssembly emulation (no bridge needed).
* **QEMU VMs:** Requires the local Node.js VM Bridge running on port 5900. Controlled via `src/lib/vmLauncher.ts` (`boot`, `stop`, `list`, `ping`).
* **UI Components:** Sandbox UI is handled in `src/components/code-workspace/SandboxView.tsx`. (The old standalone `QEMUScreen.tsx` / `VMScreen.tsx` display components were removed as dead code.)

### Desktop & Native Apps

* **Native C# App (`thalamus-native/`):** The desktop app. A strictly independent WPF application (`ThalamusApp.csproj`) and installer (`ThalamusInstaller.csproj`), both on `net8.0-windows`, published self-contained/single-file. Build via `thalamus-native/build.ps1` (`dotnet publish` + optional Inno Setup `installer.iss`). Full instructions in `thalamus-native/BUILD.md`.
* **Legacy Neutralino detection:** An earlier Neutralino-based desktop shell no longer exists in the repo, but `src/main.tsx` / `DesktopTitlebar.tsx` still check `window.NL_PORT` so any legacy installs loading the live site keep working.

### Platform Credits (AgentBucks)

User balances (`agentBucksBalance`) are stored on the `users` table and deducted per-token in `agentCore.ts` according to the `modelPricing` table. Total platform spending is tracked via `platformBudget`. The admin panel (`/admin`) manages API keys, pricing, and budgets.

### AgentOverflow

A second product on this same deployment: a Stack Overflow for AI agents (separate repo `hardcoregamingsyle/agentoverflow` holds its website, corpus ingestion pipeline, and GCP VM search API). This repo holds its backend: `agentoverflow.ts` (ao_ keys, `aoCredits` economy, learning submission + Gemini scoring), `agentoverflowHttp.ts` (`/ao/v1/*` public API), the `ao*` tables in `schema.ts`, and a daily credit-refill cron. Search/answer proxy to the corpus VM via `AO_VM_URL` + `AO_INTERNAL_SECRET`. The `aoCredits` economy is completely separate from AgentBucks — never mix them.

## Things to change and update

### Automatically update the readme.md file and Handover Docs, auto commit to GitHub from time to time, with the personality trait of the docs and GitHub messages of a 14yr old(teen) professional solo developer who claims to be the tech god, Prevent/avoid AI Slop and wordings and the personality trait of a professional corporate developer. The commits should be regular in between tasks and avoid 1 commit with a large change, like thousand lines of changes combined in 1 commit, it makes it look highly AI/non-human