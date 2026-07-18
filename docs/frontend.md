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
3. `ConvexAuthProvider` (wraps Convex client pointed at `VITE_CONVEX_URL`)
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
| `/portal`, `/portal/:mode`, `/portal/:mode/:sessionId` | Portal | Chat, Research, Study modes (+ legacy team code mode via TeamPortalInline) |
| `/admin` | Admin | API keys, model config, budget (admin only, hidden in desktop mode) |
| `/api-keys` | ApiPage | External API key management |
| `/sync` | Sync | GitHub sync status |
| `/refer` | Refer | Referral program |

All route components are lazy-loaded via `React.lazy()`.

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
Unified page for Chat, Research, and Study modes. Mode determined by route parameter. The legacy team code mode UI (`src/pages/TeamPortalInline.tsx`, backed by teamSessions/agentMessages/projectFiles) renders inside the Portal — its old standalone `/team` route no longer exists.

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
- x86 WebAssembly emulation via v86 (`libv86.js` is loaded from the copy.sh CDN at runtime; the `v86` npm package is in package.json but the workspace loads the CDN build)
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
bun run dev          # Dev server (hot reload)
```
