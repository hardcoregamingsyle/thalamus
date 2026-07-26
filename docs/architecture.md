# Architecture

## High-Level Overview

Thalamus is split into three main deployable units:

1. **Web App** — React SPA built with Vite, deployed to Cloudflare Pages
2. **Backend** — Convex serverless platform (functions + real-time database + file storage)
3. **Desktop App** — Standalone Windows exe (WPF/C#, .NET 8, self-contained)

All three clients talk to the same Convex backend.

## Directory Structure

```
thalamus/
├── src/
│   ├── main.tsx                 # App entry, routing, auth provider
│   ├── pages/                   # Route-level page components (16 pages)
│   ├── components/              # Feature components + Shadcn UI
│   │   ├── ui/                  # Shadcn primitives (DO NOT customize)
│   │   ├── code/                # Code project management UI
│   │   └── code-workspace/      # Build mode workspace panels
│   ├── content/blog.ts          # Static blog post source
│   ├── lib/                     # Utilities (vmLauncher, sanitizeHtml, etc.)
│   └── convex/                  # ALL backend logic lives here
│       ├── schema.ts            # Database schema (50 tables + authTables)
│       ├── agentCore.ts         # Model routing, agent prompts, output parsing
│       ├── nimClient.ts         # NVIDIA NIM client + task-type model map
│       ├── siliconflow.ts       # Ollama Cloud client (filename is a leftover)
│       ├── modalClient.ts       # Modal endpoint client
│       ├── codePipeline.ts      # 9-agent execution pipeline
│       ├── codeBranches.ts      # Branch/file CRUD + mutations
│       ├── ai.ts                # Chat/research mode AI functions
│       ├── http.ts              # HTTP routes (streaming, webhooks, OAuth, /ao/*)
│       ├── customAuth.ts        # The live auth (OTP + customSessions tokens)
│       ├── auth.ts              # Vestigial @convex-dev/auth setup
│       ├── github.ts            # GitHub OAuth + repo sync
│       ├── rag.ts               # Vector search for study mode
│       ├── crons.ts             # Scheduled jobs
│       └── ...                  # Many more modules
├── thalamus-native/             # Windows desktop app (separate solution)
│   ├── ThalamusApp/             # Main WPF project
│   │   ├── MainWindow.xaml      # Shell (sidebar + mode panels)
│   │   ├── App.xaml             # Application resources (colors, brushes)
│   │   ├── Modes/               # Chat, Code, Research, Study views
│   │   ├── Auth/                # Login window + handler
│   │   ├── Services/            # ConvexClient, StreamingClient, ThemeManager
│   │   ├── Styles/              # Theme.xaml (dark) + Theme.Light.xaml overlay
│   │   └── Controls/            # HtmlToWpf, BuyCreditsWindow, SponsoredAdCard
│   ├── ThalamusInstaller/       # WPF installer project (ThalamusSetup.exe)
│   ├── build.ps1                # One-shot build script (publish both + Inno Setup)
│   └── installer.iss            # Optional Inno Setup wrapper
├── .github/workflows/           # ci.yml (every push) + release.yml (v* tags)
├── scripts/                     # check-convex-refs.mjs and friends
└── CLAUDE.md                    # AI agent instructions for this repo
```

## Data Flow

### Chat Mode
```
User types message
  → Frontend calls `sendMessage` action (Convex)
  → Action checks auth, saves user message
  → Calls callAI() → tries Bedrock Claude → falls back to Gemini
    (chat mode only — the agent pipeline does not use Bedrock)
  → If response contains <<SEARCH-TOOL="...">> tags:
      → Executes web searches via performSearch()
      → Re-calls AI with search results
  → Saves assistant response to DB
  → Frontend reactively updates via Convex subscription
```

### Build/Code Mode
```
User enters a coding task
  → Frontend calls startBuild (codePipeline)
  → Creates branch record in codeBranches table
  → Schedules the Dispatcher agent
  → Dispatcher classifies task complexity, picks agents
  → If not trivial: Planning phase runs (Researcher → Analyser → Planner)
  → Planner outputs task list as JSON
  → Execution loop begins:
      For each task:
        Selected agents run in order (e.g. Coder → Tester → Critic)
        Coder creates/edits files (stored in codeFiles table)
        Critic validates; if <<Fail>>, loops back to Coder (max 2 retries)
      If all tasks done: branch status = "completed"
  → Files auto-pushed to GitHub if configured
  → Frontend shows real-time progress via Convex subscriptions
```

### Streaming Chat (SSE)
```
Browser → POST /stream-chat (HTTP route in http.ts)
  → SigV4-signed request to Bedrock streaming endpoint
  → Binary event-stream response parsed chunk by chunk
  → On failure: Gemini (gemini-2.5-flash), then VLY
  → SSE events sent to browser:
    { type: "thinking" | "answer_start" | "answer" | "done" }
```

## Code Mode

There is one code-mode implementation: `codeProjects` / `codeBranches` / `codeMessages` / `codeFiles`, driven by `codePipeline.ts`, surfaced at `/portal/code/*` (`CodeProjects` → `CodeBranches` → `CodeWorkspace`).

Older material may describe a second, parallel "Team Portal" system (`teamSessions`, `agentPipeline.ts`, `TeamPortalInline.tsx`). Those files and tables do not exist.

## Model Routing

Pipeline calls go through `callModel()` in `agentCore.ts`:

```
Modal (admin-registered modalEndpoints, when present)
  → NVIDIA NIM (default primary)
    → Ollama Cloud (backup; also the only path when no Convex ctx is passed)
```

The model is selected by **agent name**, not by a tier. `agentToTaskType()` in `nimClient.ts` maps the agent name to a task type — dispatcher, code, reasoning, research, agent, or chat — and each task type has its own model. `mapModelIdToOllama()` in `agentCore.ts` does the equivalent for the Ollama leg. There are no run modes and no model tiers; `MODE_MATRIX`, `AGENT_MODEL_MAP`, `getAgentTier` and `codeBranches.runMode` were all removed.

`callModel` returns a provider-tagged tier string (`modal:…`, `nim:…`, `ollama:…`) which the billing helpers branch on.

### Legacy provider paths (not the pipeline)

| Path | Chain | Notes |
|------|-------|-------|
| `/stream-chat` (`http.ts`) | Bedrock → Gemini (`gemini-2.5-flash`) → VLY | Hand-rolled SigV4 + AWS binary event-stream parsing; its own env-only credential parser (no ABSK bearer support) |
| Chat `sendMessage` (`ai.ts`) | Bedrock → Gemini | Own `BEDROCK_MODEL_IDS` map; `gemini-2.5-flash` for chat, `gemini-3.1-flash-lite` for research-mode search |
| Study PDF/image extraction (`study.ts`) | Bedrock → VLY | Own SigV4 signer and credential parser; `gemini-3.1-flash-lite` for grounded search |
| RAG embeddings (`rag.ts`) | Gemini `text-embedding-004` | Reads `GEMINI_API_KEY`/`GOOGLE_AI_API_KEY` from env, **not** the `geminiKeys` table |

## Real-Time Updates

Convex provides built-in real-time subscriptions. The frontend subscribes to queries like `getBranch(branchId)` and receives instant updates when any mutation modifies that branch document. This is how streaming agent output, file changes, and status updates appear live in the UI without polling.
