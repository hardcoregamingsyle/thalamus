# Frontend (React + Vite)

## Tech Stack

- **React 19** with TypeScript 5.9
- **Vite 7** as build tool and dev server
- **TailwindCSS 4** for styling
- **Shadcn UI** (Radix primitives) for component library — lives in `src/components/ui/`
- **Framer Motion** for animations
- **Convex React Client** for real-time data subscriptions
- **React Router 7** for routing

## Entry Point (src/main.tsx)

Provider hierarchy (outermost to innermost):
1. `StrictMode`
2. `InstrumentationProvider`
3. `ConvexAuthProvider` (wraps Convex client pointed at `VITE_CONVEX_URL`) — the provider is mounted, but auth actually runs on the custom-token path in `src/hooks/use-auth.ts`; see [auth.md](./auth.md)
4. `BrowserRouter` with all route definitions

## Pages & Routes

| Route | Page | Description |
|-------|------|-------------|
| `/` | Landing | Marketing page with download button |
| `/auth` | Auth | Email OTP login |
| `/auth/desktop` | AuthDesktop | Desktop app OAuth code authorization |
| `/portal/code` | CodeProjects | List of user's coding projects |
| `/portal/code/:projectId` | CodeBranches | Branches (builds) within a project |
| `/portal/code/:projectId/:branchId` | CodeWorkspace | Full build workspace with live agent output |
| `/portal/code/:projectId/:branchId/:subpage` | CodeWorkspace | Workspace sub-views (editor, deploy, logs, ...) |
| `/portal`, `/portal/:mode`, `/portal/:mode/:sessionId` | Portal | Chat, Research, Study modes |
| `/blog`, `/blog/:slug` | Blog, BlogPost | Static posts from `src/content/blog.ts` |
| `/privacy`, `/terms`, `/refund`, `/contact` | Legal | One component, four routes, selected by a `doc` prop |
| `/admin` | Admin | Provider keys, credits, budgets, ads, ISOs (admin only, hidden in desktop mode) |
| `/api-keys` | ApiPage | External API key management |
| `/sync` | Sync | GitHub sync status |
| `/refer` | Refer | Referral program |
| `*` | NotFound | Catch-all |

All route components are lazy-loaded via `React.lazy()`. `MobilePortal` is not a route — `Portal` swaps to it under 768px.

`public/sitemap.xml` is a committed file, not generated. Adding a blog post to `src/content/blog.ts` without editing the sitemap leaves it unindexed.

## Key Components

### Code Workspace (`src/pages/CodeWorkspace.tsx`)
The main build mode UI. Contains:
- Real-time agent output streaming (subscribes to branch.streamingContent)
- File tree (generated files)
- Code editor view
- Agent progress dots (which agents have run)
- Command approval panel
- Git sync controls

### Portal (`src/pages/Portal.tsx`)
Unified page for Chat, Research, and Study modes; the mode comes from the route parameter. Code mode is not part of Portal — it has its own `/portal/code/*` routes and pages. The legacy inline team-code UI was removed along with its backend.

Guest mode has a `GUEST_LIMIT` of 3 prompts/day, currently unenforced because `GUEST_UNLIMITED` is `true` (mirroring `FREE_UNLIMITED` in the backend). Usage still counts into `guestUsage`, so re-arming the flag enforces immediately against real numbers.

### Code Workspace Sub-Views (`src/components/code-workspace/`)

| Component | Purpose |
|-----------|---------|
| EditorView | Code file viewer/editor |
| DataView | Database/state viewer |
| DeployView | Deployment management (requires a projectId — no orphan deploys) |
| GitSyncView | GitHub sync status |
| SandboxView | Browser-based VM (v86) |
| VMSetupDialog | Native VM setup instructions |
| LogsView | Build logs |
| UsageView | Credit/token usage stats |
| KeysView | API key management |
| VersionView | Version control |

### UI Components (`src/components/ui/`)
Standard Shadcn UI components. **Do not customize these directly** — they're meant to be used as-is. Override via className props or wrapper components.

## Convex Integration

The frontend uses Convex's React hooks for real-time data:

```typescript
// Subscribe to live data (re-renders on change)
const branch = useQuery(api.codeBranches.getBranch, { branchId });

// Call a mutation
const createProject = useMutation(api.codeProjects.createProject);

// Call an action
const sendMsg = useAction(api.ai.sendMessage);
```

Subscriptions are the killer feature — when any agent writes to a branch document (streaming content, file changes, status updates), all subscribed UIs update instantly without polling.

## VM Integration

### Browser VMs (v86)
- x86 WebAssembly emulation via v86. **Not an npm dependency and not a local asset** — `libv86.js`, `v86.wasm`, the SeaBIOS/VGA BIOS blobs and every disk image are all fetched from the copy.sh CDN at runtime (`window.V86`)
- No server-side bridge needed
- Component: `src/components/code-workspace/SandboxView.tsx` (the old standalone QEMUScreen/VMScreen components were removed)

### Native QEMU VMs
- Requires local VM Bridge running on port 5900
- Controlled via `src/lib/vmLauncher.ts` (WebSocket: boot, stop, list, ping)
- Setup dialog: `src/components/code-workspace/VMSetupDialog.tsx`

## State Management

No Redux/Zustand — Convex IS the state management. All shared state lives in the database and is accessed via real-time subscriptions. Local UI state uses React's `useState`/`useReducer`.

## Build & Type Check

```bash
bun run build        # Full production build (type-check + Vite build → dist/)
bun run type-check   # TypeScript only (no emit)
bun run dev          # Dev server — HMR is OFF (vite.config.ts sets server.hmr: false), refresh manually
```
