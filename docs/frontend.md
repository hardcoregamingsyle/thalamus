# Frontend

React 19 + Vite 7 + TypeScript, deployed as a static SPA to Cloudflare Pages.

## Tech stack

- **React 19** with TypeScript 5.9.
- **Vite 7** as build tool and dev server.
- **TailwindCSS 4** (CSS-variable oklch theme in `src/index.css`, dark default, no `tailwind.config.*`).
- **shadcn/ui** (new-york) on Radix primitives — vendored, trimmed to 13 components in `src/components/ui/`.
- **Framer Motion** for animations.
- **Convex React client** for real-time data subscriptions.
- **React Router 7** for routing.

`src/components/ui/` currently contains: `badge`, `button`, `card`, `checkbox`, `collapsible`, `dialog`, `input`, `input-otp`, `label`, `scroll-area`, `select`, `sonner`, `textarea`. Do not edit these in place; wrap or pass `className`.

## Entry point (`src/main.tsx`)

Provider hierarchy (outermost to innermost):

1. `StrictMode`
2. `InstrumentationProvider`
3. `ConvexProvider` — wraps `new ConvexReactClient(VITE_CONVEX_URL)`. `ConvexAuthProvider` was removed; auth actually runs on the custom-token path in `src/hooks/use-auth.ts` (see [`auth.md`](./auth.md)).
4. `ThemeProvider` — single source of truth for light/dark (`src/hooks/use-theme.tsx`).
5. `BrowserRouter` with all route definitions.

A build without `VITE_CONVEX_URL` renders a visible `ConfigError` page instead of failing silently at module scope.

The `RouteErrorBoundary` catches failed lazy chunks (typical after a deploy purges old hashed assets while a stale `index.html` is cached) and reloads once within a 30-second window before falling back to a visible error screen. There is no `RouteSyncer`; the instrumentation error-modal and vly telemetry surfaces were removed.

## Pages and routes

All route components are lazy-loaded via `React.lazy()`.

| Route | Page | Description |
|---|---|---|
| `/` | `Landing` | Marketing page — composed from 9 sections in `pages/landing/` |
| `/auth` | `Auth` | Email OTP login |
| `/auth/desktop` | `AuthDesktop` | Desktop app device-code authorization |
| `/portal`, `/portal/:mode`, `/portal/:mode/:sessionId` | `Portal` | Dispatches to `GuestPortal` / `PortalDesktop` / `MobilePortal` |
| `/portal/code` | `CodeProjects` | List of user's coding projects (auth-gated) |
| `/portal/code/:projectId` | `CodeBranches` | Branches within a project (auth-gated) |
| `/portal/code/:projectId/:branchId(/…)` | `CodeWorkspace` | Full build workspace with live agent output — Claude Code-style verbose activity blocks + word-by-word typewriter live view (auth-gated) |
| `/blog`, `/blog/:slug` | `Blog`, `BlogPost` | Static posts from `src/content/blog.ts` |
| `/privacy`, `/terms`, `/refund`, `/contact` | `Legal` | One component, four routes, selected by a `doc` prop |
| `/admin` | `Admin` | Provider keys, credits, budgets, ads, ISOs (admin only, hidden in desktop builds) |
| `/api-keys` | `ApiPage` | `thal_` API key management |
| `/refer` | `Refer` | Referral program (auth-gated) |
| `*` | `NotFound` | Catch-all |

`public/sitemap.xml` is a committed file, not generated. Adding a blog post to `src/content/blog.ts` without editing the sitemap leaves it unindexed.

## Portal split

`src/pages/Portal.tsx` is a 20-line dispatcher (source: file top comment). Auth is checked **before** the mobile split — unauthenticated visitors get `GuestPortal` on every device.

```
Portal.tsx
  ├── !isAuthenticated  → GuestPortal (pages/portal/GuestPortal.tsx)
  ├── isMobile          → MobilePortal (pages/MobilePortal.tsx)
  └── otherwise         → PortalDesktop (pages/portal/PortalDesktop.tsx)
```

`pages/portal/` also holds:

- `ModeSelection.tsx` — mode picker chip row.
- `modes.ts` — `Mode` union, `VALID_MODES`, `ALL_MODES` (10 items), `MODES` (4 primary), `MORE_MODES` (6 niche). Fields cover both desktop chip look and mobile card look.
- `guestSession.ts` — guest constants (`GUEST_LIMIT = 3`, `GUEST_UNLIMITED = true`), storage keys, `getOrCreateGuestId`.
- `types.ts` — shared types (`Message`, etc.).
- `suggestions.ts` — suggestion chip data.

`MobilePortal.tsx` dispatches to `pages/mobile/`: `MobileHomeScreen`, `MobileChatView`, `MobileMessageBubble`.

## Landing split

`Landing.tsx` composes 9 section components under `pages/landing/`: `NavBar`, `Hero`, `ModeGrid`, `PipelineSection`, `StudySection`, `CapabilityBand`, `FaqSection`, `FinalCta`, `Footer`. `FaqSection` renders items from `src/content/faq.ts`; the same items must stay in sync with the `FAQPage` JSON-LD block in `/index.html` (search engines and the visible page must tell the same story).

## Admin split

`Admin.tsx` is a 264-line shell. The `AdminTab` union has 15 tabs; each is lazy-loaded from `pages/admin/`:

`UsersTab`, `DauTab`, `CreditsTab`, `PromoCodesTab`, `SuggestionsTab`, `StudyMaterialsTab`, `ProviderBKeysTab` (Ollama Cloud), `ProviderCEndpointsTab` (Modal), `ProviderDCredentialsTab` (AWS Bedrock), `ProviderEKeysTab` (Gemini Keys), `AdsTab` (labelled "Ads (Gravity)"), `PaymentsTab`, `VmIsoCatalogTab`, `AgentOverflowTab` (labelled "Corpus"), `MaintenanceTab`. `shared.ts` contains the `useAdminMeta` hook and `ProviderSlug` types.

Provider tabs use neutral slugs (`providerB` … `providerE`) and ask the server for real labels via `adminMeta.ts`, so a leaked admin chunk does not publish the provider stack. There is no dedicated NIM tab (NIM is out of the pipeline; the slot is available for future use) and no "Convex" tab.

## Student suite

`src/components/StudentSuite.tsx` is a shell over `src/components/student-suite/`: `MenuView`, `ConceptMapView`, `FlashcardsView`, `InterleaveView`, `QuizView`, `MockTestView`, `ErrorsView`, `SpacedView`, `TeachbackView`, plus `ToolCard.tsx`, `types.ts`, `utils.ts`.

## Code workspace

`src/pages/CodeWorkspace.tsx` composes views from `src/components/code-workspace/`:

| Component | Purpose |
|---|---|
| `EditorView` | Code file viewer/editor |
| `DataView` | Database/state viewer |
| `DeployView` | Deployment management (requires a projectId — no orphan deploys). Calls `src/convex/deployments.ts` |
| `GitSyncView` | GitHub sync status |
| `SandboxView` | View onto the two command executors: GitHub Actions cloud worker or the desktop local executor. Runner-OS picker, one-off commands, live output. No v86 emulator (removed); no Connect Bridge button (removed) |
| `LogsView` | Build logs |
| `UsageView` | Credit / token usage stats |
| `KeysView` | API key management |
| `VersionView` | Version control |
| `VerboseBlocks.tsx` | Claude Code-style verbose rendering of every committed transcript message: activity markers (`[CMD: …]`, `[FILE CREATED: …]`, test/security verdicts, …) become icon + verb + mono-argument blocks, hand-offs (`[OVER TO: …]`, `⇄ …`) become gradient hero banners naming both ends with the reason on a `⎿` line, commands become terminal `$` blocks. `VerboseMessageContent` (agent messages) + `SystemLineContent` (System routing lines) |

The chat view's own rendering follows the same verbose language end to end:
committed messages go through `VerboseMessageContent` (Agent/Terminal) or
`SystemLineContent` (System) — raw `[…]` bracket markers never print as plain
text; the in-flight command gets the same `$` terminal block as committed RUN
rows; and the live stream renders through `StreamingBubble` with the code-mode
`preprocess` (`streamVisibleText` — extracts the growing `message` string from
the partial `{message, ops}` doc), so the reply types out word-by-word as
formatted markdown, never as raw JSON. `TRANSCRIPT_MD_CLASSES` (exported from
`VerboseBlocks.tsx`) is the one typography constant both bubbles share. All
parsing is framework-free in `src/lib/verboseTranscript.ts` and guarded by
`tests/verboseTranscript.test.ts`.

Real-time updates: `useQuery(api.codeBranches.getBranch, { branchId })` subscribes to the branch document; when any mutation writes to it (streaming content, file changes, status updates), the workspace re-renders instantly.

## Shared client libs (`src/lib/`)

| Module | Responsibility |
|---|---|
| `session.ts` | `SESSION_KEY` = `"agentai_session_token"`, `getSessionToken` / `setSessionToken` / `clearSessionToken`. Single source of truth for the auth token in localStorage. |
| `convexUrls.ts` | `convexCloudUrl()` (`*.convex.cloud` origin), `convexSiteUrl(path?)` (`*.convex.site` origin for HTTP actions — the two Convex hosts). |
| `errorMessage.ts` | `errMsg(err)` — normalizes any thrown value to a readable string. |
| `fileEncoding.ts` | Base64 / text file helpers for uploads. |
| `streamChat.ts` | SSE consumer for `/stream-chat`. |
| `dateFormat.ts` | Formatting helpers. |
| `sanitizeHtml.ts` | `sanitizeAiHtml` (DOMPurify) — **mandatory** before any `dangerouslySetInnerHTML`. Session, admin, and GitHub tokens live in localStorage. |
| `requestAd.ts` | Sponsored-ad request helper. |
| `verboseTranscript.ts` | Verbose transcript parsing (framework-free, unit-tested): `segmentVerboseContent` splits messages into prose + typed activity markers, `classifySystemLine` parses `⇄`/`✔`/`[ROUTING]`/`⚠️`/`⏳` System lines, `extractStreamingMessage` pulls the growing message string out of the partial JSON doc agents stream, `streamVisibleText`/`stripOpsForStreaming` decide what the live bubble types out. Rendered by `components/code-workspace/VerboseBlocks.tsx` + `components/StreamingBubble.tsx`. |
| `utils.ts` | `cn()` etc. |

`src/content/systemPrompts.ts` holds `chatStreamSystemPrompts()` — client-side system prompts posted to `/stream-chat` by both `Portal.tsx` and `MobilePortal.tsx`. Study mode's prompt optionally folds in grade / board / language from a `StudyProfile`.

## Convex integration

Convex hooks are the state management — no Redux, no Zustand.

```typescript
import { useQuery, useMutation, useAction } from "convex/react";
import { api } from "@/convex/_generated/api";

// Reactive subscription — re-renders on any relevant mutation.
const branch = useQuery(api.codeBranches.getBranch, { branchId, token });

// Mutation.
const createProject = useMutation(api.codeProjects.createProject);

// Action (external I/O or long work).
const sendMsg = useAction(api.ai.sendMessage);
```

The session token is passed as an explicit `{ token }` argument to nearly every Convex call; nothing is inferred from the connection.

## Build and dev

```bash
bun run build        # tsc -b && vite build → dist/  (cross-platform)
bun run type-check   # tsc -b --noEmit
bun run dev          # Vite dev server — HMR is OFF (vite.config.ts server.hmr: false), refresh manually
bun run format:check # Prettier check
```

`src/convex/_generated/` is committed so a fresh clone type-checks without running Convex. `npx convex dev` regenerates it.
