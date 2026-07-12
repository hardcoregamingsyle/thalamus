# Development Guide

## Prerequisites

- **Bun** (v1.2.10+) — Package manager and test runner. Install: `curl -fsSL https://bun.sh/install | bash`
- **Node.js** (v20+) — Required for Convex CLI
- **.NET 8 SDK** — Only needed for desktop app development
- **Git** — Version control

## First-Time Setup

### 1. Clone & Install

```bash
git clone https://github.com/hardcoregamingsyle/thalamus.git
cd thalamus
bun install
```

### 2. Environment Variables

Create `.env.local` in the project root:

```
CONVEX_DEPLOYMENT=befitting-wildebeest-866
VITE_CONVEX_URL=https://befitting-wildebeest-866.convex.cloud
```

Server-side secrets are managed in the Convex Dashboard — you don't need them locally unless you're deploying.

### 3. Start Development Servers

You need TWO terminals running simultaneously:

```bash
# Terminal 1: Convex backend (watches for changes, syncs to cloud)
npx convex dev

# Terminal 2: Vite frontend (hot reload)
bun run dev
```

The frontend connects to the Convex deployment specified in `VITE_CONVEX_URL`. Both dev servers must be running for the app to work.

## Available Commands

| Command | Purpose |
|---------|---------|
| `bun run dev` | Start Vite dev server (frontend) |
| `npx convex dev` | Start Convex dev mode (backend, watches files) |
| `bun run build` | Type-check + production build → `dist/` |
| `bun run type-check` | TypeScript check only (no emit) |
| `bun run lint` | ESLint |
| `bun run format` | Prettier (writes files in-place) |
| `bun test` | Run tests |
| `bun test --watch` | Watch mode for tests |
| `npx convex deploy` | Deploy backend to production |
| `bun run deploy:selfhosted` | Deploy frontend (self-hosted) |

## Project Layout

```
src/
├── main.tsx           # App entry + routing
├── pages/             # Route-level components
├── components/        # Feature components
│   ├── ui/            # Shadcn primitives (don't touch)
│   ├── code/          # Code project UI
│   └── code-workspace/ # Build workspace panels
├── hooks/             # Custom React hooks (useAuth, etc.)
├── lib/               # Utilities (vmLauncher, utils)
└── convex/            # ALL backend code (Convex functions)
    ├── schema.ts      # Database schema
    ├── agentCore.ts   # AI model routing
    ├── codePipeline.ts # 9-agent pipeline
    └── ...
```

## Key Development Patterns

### Adding a New Backend Function

```typescript
// src/convex/myModule.ts
import { query, mutation, action } from "./_generated/server";
import { v } from "convex/values";

// Query (read-only, reactive — UI auto-updates)
export const getItems = query({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    return await ctx.db.query("items")
      .withIndex("by_user", q => q.eq("userId", args.userId))
      .collect();
  },
});

// Mutation (read-write, deterministic — no API calls)
export const createItem = mutation({
  args: { name: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db.insert("items", { name: args.name });
  },
});

// Action (can do anything — API calls, network, but no direct DB)
export const processItem = action({
  args: { itemId: v.id("items") },
  handler: async (ctx, args) => {
    const item = await ctx.runQuery(internal.myModule.getItem, { itemId: args.itemId });
    const result = await fetch("https://api.example.com/process", { ... });
    await ctx.runMutation(internal.myModule.updateItem, { itemId: args.itemId, result });
  },
});
```

### Adding a New Page

1. Create `src/pages/MyPage.tsx`
2. Add route in `src/main.tsx`:
   ```typescript
   const MyPage = lazy(() => import("./pages/MyPage"));
   // In routes:
   <Route path="/my-page" element={<MyPage />} />
   ```
3. Page components are lazy-loaded automatically.

### Using Convex in Components

```typescript
import { useQuery, useMutation, useAction } from "convex/react";
import { api } from "../convex/_generated/api";

function MyComponent() {
  // Reactive subscription (re-renders on DB change)
  const data = useQuery(api.myModule.getItems, { userId });
  
  // Mutation trigger
  const create = useMutation(api.myModule.createItem);
  
  // Action trigger  
  const process = useAction(api.myModule.processItem);
}
```

### Modifying the AI Pipeline

The pipeline agents are orchestrated in `src/convex/codePipeline.ts`. Each agent:
1. Has a system prompt (`AGENT_SYSTEM_PROMPTS` in `agentCore.ts`)
2. Receives context (files, plan, previous output)
3. Produces output parsed for tool markers (`<<CREATEFILE>>`, `<<SEARCH-TOOL>>`, etc.)
4. Results stored in the branch document

To add a new tool marker:
1. Define the regex pattern (file/search/scrape/command markers live in `agentCore.ts`; `<<REQUEST-API-KEY>>` parsing lives in `codePipeline.ts`)
2. Add extraction logic after the AI call
3. Implement the handler (file write, API call, etc.)

## Testing

```bash
bun test                 # Run all tests
bun test --watch         # Watch mode
bun test src/convex/     # Test specific directory
```

## Type Checking

```bash
bun run type-check       # Full TypeScript check
```

The build command (`bun run build`) runs type-check automatically before building.

## Code Style

- **Prettier** for formatting (run `bun run format`)
- **ESLint** for linting (run `bun run lint`)
- Match existing patterns — don't introduce new abstractions without need
- Backend functions use Convex's validator types (`v.string()`, `v.id("table")`, etc.)
- Frontend uses Tailwind classes, not custom CSS

## Desktop App Development

See [desktop-app.md](./desktop-app.md) for the full WPF development guide.

Quick start:
```powershell
cd thalamus-native
dotnet build ThalamusApp/ThalamusApp.csproj -c Debug   # dev loop
.\build.ps1                                            # full release build (both projects + installer)
```

## Common Issues

| Issue | Fix |
|-------|-----|
| "Cannot find module convex/_generated" | Run `npx convex dev` to generate types |
| Convex subscription shows `undefined` | Check auth — user might not be logged in |
| Vite build fails on types | Run `bun run type-check` to see specific errors |
| "Rate limited" from Bedrock | Check AWS credentials in admin panel or env vars |
| Desktop app crashes on launch | Resources must be in App.xaml, not Window.Resources |
