# Thalamus

**AI-powered coding platform with a 9-agent pipeline, VM sandbox, and native desktop app.**

Built by Aphantic Corporation. Two surfaces, one backend: a React/Convex web app and a self-contained Windows desktop application.

---

## What it does

Thalamus gives you a full agentic coding environment in the browser or as a native app. Describe what you want to build. A sequential team of nine specialized AI agents — Researcher, Analyser, Planner, Coder, Optimiser, Organizer, Tester, Hacker, and Critic — plans, implements, tests, and secures your project in an isolated VM sandbox. Files are written directly, shell commands are executed, and results flow back to the agents for iteration.

Alongside code mode, there are chat, research, and study modes powered by the same model stack.

---

## Architecture

### Web app (`src/`)

React 19 + Vite + Convex. The frontend is a single-page app; all backend logic lives in Convex serverless functions.

```
src/
├── convex/                   ← backend (Convex serverless)
│   ├── schema.ts             ← full database schema and indexes
│   ├── agentCore.ts          ← model routing: Bedrock → Gemini → fallback
│   ├── agentPipeline.ts      ← 9-agent pipeline for Team Portal
│   ├── codePipeline.ts       ← 9-agent pipeline for Code Mode
│   ├── ai.ts                 ← chat / research / study request handlers
│   ├── admin.ts              ← admin portal: users, credits, model config
│   ├── userApiKeys.ts        ← external API key management
│   ├── gravityAds.ts         ← ad config (server-side only)
│   ├── auth.ts               ← email OTP auth via @convex-dev/auth
│   └── github.ts             ← GitHub OAuth + repo sync
├── components/
│   ├── ui/                   ← shadcn/ui base components (do not modify)
│   ├── code-workspace/       ← code mode workspace panels
│   └── ThinkingPanel.tsx     ← Gemini-style collapsible thinking panel
└── pages/
    ├── Landing.tsx           ← public landing page
    ├── Portal.tsx            ← chat / research / study mode
    ├── CodeWorkspace.tsx     ← code mode workspace
    ├── Admin.tsx             ← admin portal
    └── ApiPage.tsx           ← external API key management
```

### Native Windows app (`thalamus-native/`)

A WPF (.NET 8) application that embeds the web app in a WebView2 control. It adds native window chrome, system tray integration, and an auto-updater that checks GitHub Releases.

```
thalamus-native/
├── ThalamusApp/
│   ├── MainWindow.xaml(.cs)  ← main window, WebView2 host
│   ├── TrayIcon.cs           ← system tray
│   └── AutoUpdater.cs        ← GitHub Releases update check
├── ThalamusInstaller/
│   ├── Product.wxs           ← WiX MSI definition
│   └── Bundle.wxs            ← bootstrapper bundle
└── BUILD.md                  ← complete Windows build instructions
```

---

## Model routing

AI calls route through `agentCore.ts` in priority order:

1. **AWS Bedrock** — Claude Haiku 4.5 / Sonnet 4.6 / Opus 4.6 / Opus 4.8
2. **Google Gemini** — 2.0 Flash / 3.1 Flash Lite (DB-managed keys via Admin panel)
3. **AgentRouter** — fallback gateway (AGENTROUTER_API_KEY env var)

Each agent in the pipeline has a default model tier. The Admin panel exposes a Model Config tab to override any agent's model per run mode (Cheap / Balanced / Powerful).

---

## Agent pipeline

Both pipeline systems (Team Portal and Code Mode) run the same nine agents:

| Agent | Role |
|---|---|
| Researcher | Searches the web and scrapes docs for context |
| Analyser | Produces a detailed architecture and implementation plan |
| Planner | Decomposes the project into atomic tasks with difficulty ratings |
| Coder | Writes complete, production-ready file implementations |
| Optimiser | Reviews and improves code for performance and security |
| Organizer | Adds documentation, improves structure, creates README |
| Tester | Writes and runs tests; reports pass/fail |
| Hacker | Security audit; fixes critical vulnerabilities |
| Critic | Final gatekeeper; triggers retry loops on failures |

The Critic agent triggers up to two retry passes if it rejects a task — the Coder receives the Critic's specific feedback and must fix all issues before the task advances.

---

## Development setup

Both the Vite dev server and the Convex backend must run simultaneously.

**Prerequisites:** Node.js 20+, Bun, a Convex account.

```bash
# 1. Install dependencies
bun install

# 2. Configure environment
cp .env.local.example .env.local
# Fill in CONVEX_DEPLOYMENT and VITE_CONVEX_URL

# 3. Start the Convex backend (separate terminal)
npx convex dev

# 4. Start the frontend dev server
bun run dev
```

**Other commands:**

```bash
bun run build        # TypeScript check + production build → dist/
bun run type-check   # TypeScript only, no emit
bun run lint         # ESLint
bun run format       # Prettier (writes files)
bun test             # Run tests
```

---

## Environment variables

**Required in `.env.local`:**

```env
CONVEX_DEPLOYMENT=your-deployment-name
VITE_CONVEX_URL=https://your-deployment.convex.cloud
```

**Server-side secrets (set via Convex Dashboard or Admin panel):**

| Variable | Description |
|---|---|
| `AWS_BEDROCK_API_KEY` | AWS Bedrock credentials (key:secret:region or ABSK token) |
| `ADMIN_TOKEN` | Admin portal access token |
| `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` | GitHub OAuth app |
| `JWKS` / `JWT_PRIVATE_KEY` | Auth token signing |
| `BREVO_EMAIL_SENDER` | Transactional email for OTP |
| `AGENTROUTER_API_KEY` | Fallback model gateway |
| `SITE_URL` | Public URL (used in OAuth callbacks) |

Gemini API keys and AWS credentials can also be managed through the Admin panel and are stored in the database, which takes priority over environment variables.

---

## Admin panel

Access at `/admin` (web only — hidden in desktop mode). Requires the `ADMIN_TOKEN` server env var.

Tabs: Users · DAU · Credits · Promo Codes · Suggestions · Study Materials · AWS Bedrock · Gemini Keys · **Model Config** · **GravityAds**

---

## External API

Users can create API keys at `/api-keys`. Keys are prefixed `thal_`, SHA-256 hashed before storage, and scoped to a credit allocation drawn from the user's AgentBucks balance. The API is OpenAI-compatible and can be used as a custom endpoint in Cursor, Claude Code, Codex, and similar tools.

---

## Desktop app (v2.0.0)

The desktop app is a self-contained `.exe` (no installer required). Download from the latest GitHub Release:

```
https://github.com/hardcoregamingsyle/thalamus/releases/latest
```

Builds are produced automatically by `.github/workflows/release.yml` when a `v*` tag is pushed. The workflow compiles the WPF project with `dotnet publish` as a single-file self-contained binary targeting `win-x64`.

---

## VM sandbox

Code Mode can execute shell commands in an isolated sandbox environment. Two backends are supported:

- **Browser VMs** — `v86` npm package, x86 WebAssembly emulation, no external setup
- **QEMU VMs** — requires the local VM Bridge (Node.js, port 5900). Controlled via `src/lib/vmLauncher.ts`

---

## CI/CD

| Workflow | Trigger | Output |
|---|---|---|
| `release.yml` | Push `v*` tag or manual dispatch | `Thalamus.exe` GitHub Release |

---

## Tech stack

| Layer | Technologies |
|---|---|
| Frontend | React 19, Vite, TypeScript, Tailwind CSS, shadcn/ui, Framer Motion |
| Backend | Convex (serverless functions + reactive DB) |
| AI | AWS Bedrock (Claude), Google Gemini, AgentRouter |
| Auth | Convex Auth (email OTP) |
| Desktop | WPF (.NET 8), WebView2, WiX Toolset |
| VM | v86 (WASM), QEMU |
