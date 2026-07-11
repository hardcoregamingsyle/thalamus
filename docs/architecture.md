# Architecture

## High-Level Overview

Thalamus is split into three main deployable units:

1. **Web App** — React SPA served via Vite, deployed anywhere static hosting works
2. **Backend** — Convex serverless platform (functions + real-time database + file storage)
3. **Desktop App** — Standalone Windows exe (WPF/C#, .NET 8, self-contained)

All three clients talk to the same Convex backend.

## Directory Structure

```
thalamus/
├── src/
│   ├── main.tsx                 # App entry, routing, auth provider
│   ├── pages/                   # Route-level page components (14 pages)
│   ├── components/              # Feature components + Shadcn UI
│   │   ├── ui/                  # Shadcn primitives (DO NOT customize)
│   │   ├── code/                # Code project management UI
│   │   └── code-workspace/      # Build mode workspace panels
│   ├── lib/                     # Utilities (vmLauncher, etc.)
│   └── convex/                  # ALL backend logic lives here
│       ├── schema.ts            # Database schema (40+ tables)
│       ├── agentCore.ts         # Model routing, API calls, agent prompts
│       ├── codePipeline.ts      # 9-agent execution pipeline
│       ├── codeBranches.ts      # Branch/file CRUD + mutations
│       ├── ai.ts                # Chat/research mode AI functions
│       ├── http.ts              # HTTP routes (streaming, webhooks, OAuth)
│       ├── auth.ts              # Convex auth setup
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
│   │   ├── Services/            # ConvexClient, StreamingClient
│   │   └── Controls/            # Reusable controls (MessageBubble)
│   ├── ThalamusInstaller/       # WPF installer project (ThalamusSetup.exe)
│   ├── build.ps1                # One-shot build script (publish both + Inno Setup)
│   └── installer.iss            # Optional Inno Setup wrapper
├── .github/workflows/           # CI/CD (release.yml is the live one)
├── scripts/                     # deploy-selfhosted.sh and friends
└── CLAUDE.md                    # AI agent instructions for this repo
```

## Data Flow

### Chat Mode
```
User types message
  → Frontend calls `sendMessage` action (Convex)
  → Action checks auth, saves user message
  → Calls callAI() → tries Bedrock Claude → falls back to Gemini
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
  → Schedules Dispatcher agent (cheapest model)
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
  → SSE events sent to browser:
    { type: "thinking" | "answer_start" | "answer" | "done" }
```

## Two Parallel Code Systems

The codebase has TWO overlapping code-mode implementations. Be careful which one you're modifying:

| | Original System | Newer System |
|---|---|---|
| **Tables** | teamSessions, agentMessages, projectFiles | codeProjects, codeBranches, codeMessages, codeFiles |
| **UI** | `TeamPortalInline` (rendered inside Portal) | `/portal/code/*` (CodeWorkspace) |
| **Pipeline** | agentPipeline.ts | codePipeline.ts |
| **Status** | Legacy, still functional | Active development |

The newer system is what users interact with. The original system's UI lives in `src/pages/TeamPortalInline.tsx` and is rendered inside the Portal — the standalone `/team` route was removed.

## Model Routing

All AI calls go through `agentCore.ts`. The fallback chain:

```
AWS Bedrock (Claude, with region retry) → Google Gemini (gemini-3.1-flash-lite, rotating key pool) → AgentRouter (agentrouter.org, last resort)
```

Each agent in the pipeline uses a specific model tier based on the "run mode" (cheap/balanced/powerful) stored per-branch. The Dispatcher always runs on the cheapest Claude model (Haiku). In "powerful" mode the Coder runs on Opus.

## Real-Time Updates

Convex provides built-in real-time subscriptions. The frontend subscribes to queries like `getBranch(branchId)` and receives instant updates when any mutation modifies that branch document. This is how streaming agent output, file changes, and status updates appear live in the UI without polling.
