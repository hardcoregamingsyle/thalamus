# Development Guide

## Prerequisites

- **Bun** 1.2.10+ — package manager and test runner. Install: `curl -fsSL https://bun.sh/install | bash`.
- **Node.js** 20+ — needed for the Convex CLI.
- **.NET 8 SDK** — only for desktop app work.
- **Git**.

## First-time setup

```bash
git clone https://github.com/hardcoregamingsyle/thalamus.git
cd thalamus
bun install
```

Create `.env.local`:

```
CONVEX_DEPLOYMENT=<your-deployment>
VITE_CONVEX_URL=https://<your-deployment>.convex.cloud
```

Server-side secrets live in the Convex dashboard — see [`deployment.md`](./deployment.md#environment-variables). You do not need them locally unless you are running actions that reach external providers.

Start two terminals:

```bash
# Convex backend watcher — regenerates src/convex/_generated/ and pushes function
# changes to the dev deployment.
npx convex dev

# Vite frontend. HMR is OFF (vite.config.ts server.hmr: false) — refresh the
# browser manually after every change.
bun run dev
```

## Available commands

| Command | Purpose |
|---|---|
| `bun run dev` | Vite dev server. |
| `npx convex dev` | Convex dev watcher. |
| `bun run build` | `tsc -b && vite build` → `dist/`. Cross-platform (no bash / no POSIX-only shell). |
| `bun run type-check` | `tsc -b --noEmit`. |
| `bun run lint` | ESLint. |
| `bun run check-refs` | `node scripts/check-convex-refs.mjs`. Verifies every Convex function reference resolves — including the string-based calls from the desktop app, AgentOverflow, and crons. |
| `bun run format` | Prettier — writes files. |
| `bun run format:check` | Prettier — check only. |
| `bun test` | Run tests (see below). |
| `bun test --watch` | Watch mode. |
| `bun run clean` | `node fs.rmSync` of `dist/` and `node_modules/.cache`. |

## Project layout

See [`architecture.md`](./architecture.md#directory-structure).

## Testing

Suites in `tests/`, run with `bun test`:

| Suite | Purpose |
|---|---|
| `mcpParse.test.ts` | MCP output parser edge cases. |
| `parseAgentOutput.test.ts` | JSON-op parser (`{"op":…}` single-line ops + legacy `<<TAG>>` fallback). |
| `studyPrompt.test.ts` | Study-mode prompt assembly. |
| `sanitizeHtml.test.ts` | DOMPurify wrapping. Runs on jsdom (see `bunfig.toml`). |
| `agentRouting.test.ts` | Agent-name → task-type mapping in `lib/taskTypes.ts`. |

```bash
bun test                        # all
bun test --watch                # watch mode
bun test tests/mcpParse.test.ts # single suite
```

`scripts/study-eval.ts` and `scripts/mcp-smoke.ts` are **not** unit tests. They call the live backend and consume real credits / API keys — do not run them in a loop.

## Type checking

```bash
bun run type-check
```

`bun run build` runs type-check first (`tsc -b && vite build`). The generated Convex `api`/`internal` objects exceed TypeScript's instantiation depth and quietly degrade to `any`, and three callers reach the backend by plain string anyway (the shipped desktop `.exe`, the AgentOverflow repo via `makeFunctionReference`, and crons). `bun run check-refs` is the only gate on those. CI checks out the sibling AgentOverflow repo into `AGENTOVERFLOW_DIR` so cross-repo string refs are actually verified.

## Common patterns

### Adding a Convex function

```typescript
// src/convex/myModule.ts
import { query, mutation, action } from "./_generated/server";
import { v } from "convex/values";

export const getItems = query({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => ctx.db.query("items")
    .withIndex("by_user", q => q.eq("userId", args.userId))
    .collect(),
});

export const createItem = mutation({
  args: { name: v.string() },
  handler: async (ctx, args) => ctx.db.insert("items", { name: args.name }),
});
```

Rules: mutations are deterministic and cannot call `fetch`; actions can do anything but cannot read/write the DB directly — they must delegate to internal queries/mutations via `ctx.runQuery` / `ctx.runMutation`.

### Adding a page

1. Create `src/pages/MyPage.tsx`.
2. Register it in `src/main.tsx`:
   ```typescript
   const MyPage = lazy(() => import("./pages/MyPage"));
   // …
   <Route path="/my-page" element={<MyPage />} />
   ```

### Using Convex in components

```typescript
import { useQuery, useMutation, useAction } from "convex/react";
import { api } from "@/convex/_generated/api";

const data = useQuery(api.myModule.getItems, { userId });
const create = useMutation(api.myModule.createItem);
const process = useAction(api.myModule.processItem);
```

Session token: pass as `{ token }` on nearly every call — see [`auth.md`](./auth.md).

### Modifying the pipeline

Agent orchestration is in `src/convex/codePipeline.ts`. Each agent:

1. Has a system prompt in `AGENT_SYSTEM_PROMPTS` (`src/convex/lib/agentPrompts.ts`).
2. Receives context (files, plan, previous output).
3. Produces output parsed for single-line JSON ops (`src/convex/lib/agentOutputParser.ts`, `src/convex/lib/mcpParse.ts`).
4. Results stored on the branch document.

To add a new op:

1. Extend the parser in `agentOutputParser.ts` (add a case in the parser plus a test in `tests/parseAgentOutput.test.ts`).
2. Add extraction / resolution logic in `codePipeline.ts` next to the existing op handlers.
3. Update the agent prompts that should know about the new op.

## Code style

- Prettier for formatting (`bun run format`).
- ESLint for linting (`bun run lint`).
- Match existing patterns; do not introduce new abstractions without need.
- Backend functions use Convex validators (`v.string()`, `v.id("table")`).
- Frontend uses Tailwind classes; do not add custom CSS files.
- No emoji in docs or commit messages; neutral professional voice.

## Desktop development

See [`desktop-app.md`](./desktop-app.md).

Quick loop:

```powershell
cd thalamus-native
dotnet build ThalamusApp/ThalamusApp.csproj -c Debug   # dev
.\build.ps1                                            # full release + installer
```

## Common issues

| Issue | Fix |
|---|---|
| `Cannot find module convex/_generated` | Run `npx convex dev` to regenerate. |
| Convex subscription returns `undefined` | Check auth — the query probably requires a `token` you have not passed. |
| `bun run build` fails on types | Run `bun run type-check` to see specific errors. |
| Pipeline throws `No AI provider configured — add Modal or Ollama keys via /admin, then a Zen/DeadlySignal/ModelScope call can serve.` | Add Modal endpoints or Ollama keys at `/admin`. The keyless legs (Zen, DeadlySignal, ModelScope) only serve after the keyed fallbacks work — the chain fails through them and lands on Ollama at the end. |
| `Rate limited` in chat or study mode | Those paths still run on Bedrock/Gemini — check AWS credentials and Gemini keys in the admin panel or env vars. |
| Convex call fails at runtime but `tsc` was clean | Run `bun run check-refs`. The generated `api` object degrades to `any`, so wrong function names only surface at runtime. |
| Desktop app crashes on launch | Shared resources must be in `App.xaml`, not `Window.Resources` — see [`desktop-app.md`](./desktop-app.md). |
| `VLY_INTEGRATION_KEY is not configured in the Convex dashboard` at deploy time | `src/convex/lib/vlyIntegrations.ts` throws at import if the key is unset. Set the env var in the Convex dashboard. |
| Cloudflare Pages deploy fails on `npm ci` | `package-lock.json` drifted from `package.json`. Regenerate it after any `bun add`/`bun remove`. |
