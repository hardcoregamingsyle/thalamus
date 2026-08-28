# Authentication

Thalamus uses one auth system end to end: custom email OTP with server-issued session tokens. GitHub OAuth is layered on top for repo access only. The desktop app uses a device-code pairing flow that lands users on the same session token.

`src/convex/auth.ts` does not exist. `ConvexAuthProvider` was removed from `src/main.tsx`. `authTables` from `@convex-dev/auth/server` is still imported by `schema.ts` for legacy row compatibility, but no live path populates `ctx.auth`. There is no `auth.addHttpRoutes(http)` call and no `/api/auth/*` route family. Do not migrate code onto `ctx.auth`.

## Email OTP (primary login)

### Flow

1. User enters email on the login page.
2. Frontend calls `customAuth.sendOtp` action.
3. Server generates a 6-digit numeric code (`Math.floor(100000 + Math.random() * 900000)`).
4. Code is stored in `otpCodes` with a 15-minute expiry.
5. Email sent via Brevo (`api.brevo.com/v3/smtp/email`, API key in the `BREVO_EMAIL_SENDER` env var — the name is misleading).
6. User enters the code.
7. Frontend calls `customAuth.verifyOtp`.
8. Server looks up the code by email, checks it is unused and unexpired, marks it used.
9. User located by email (or created with defaults: 10M daily AgentBucks, referral code).
10. Session token generated: 32 bytes from `crypto.getRandomValues`, hex-encoded (64 chars).
11. Token stored in `customSessions` with a 30-day `expiresAt`.
12. Client stores the token in `localStorage` under `agentai_session_token` (see `src/lib/session.ts`, `SESSION_KEY`).

### Key details

- OTP sender: `thalamus-onboarding@mail.aphantic.skinticals.com`.
- Max 10 concurrent sessions per user (oldest pruned on new login).
- Special accounts: `@stkabir.co.in` emails auto-flagged as school/teacher accounts.
- Codes are single-use.

## Session management

### Lifecycle

```
Login → customSessions row (expiresAt = now + 30 days)
      → localStorage[agentai_session_token] on the client

Each request → { token } passed explicitly to nearly every Convex call
             → getUserByToken validates against by_token index + expiresAt

Logout → delete customSessions row + clearSessionToken()
```

### Client hook

`src/hooks/use-auth.ts` reads and writes the token via `SESSION_KEY` helpers in `src/lib/session.ts`. It listens for `StorageEvent` on `SESSION_KEY` to sync auth state across tabs — logging out in one tab redirects all other tabs. Every render, a reactive `getUserByToken` query revalidates the token, so an admin-revoked or expired session takes effect immediately.

Routes gated via `useAuth`: `/portal/code*`, `/refer`. `Portal.tsx` checks auth **before** the mobile/desktop split, so guest mode (`GuestPortal`) works on mobile — the old order used to redirect unauthenticated mobile visitors straight to `/auth`.

## GitHub OAuth (repo access)

GitHub OAuth is used only for connecting user repositories to code projects. It is not used for login.

**Connecting GitHub is strictly opt-in, and it only ever syncs code.** Cloud command execution never requires it: a branch whose user never connected GitHub runs on a standalone platform-owned build workspace (`thalamus-vm-*`) that `ensureVmMirror` provisions from the branch's own Convex file store (see `executors.md` and `CLAUDE.md` §4). The user is never told to connect GitHub to make commands run — any execution block they can see is a platform-side issue for the admin. Connecting exists so the user can keep a copy of the code in *their own* repository, and nothing else depends on it.

1. User clicks "Connect GitHub" on a branch's **Git Sync** tab, which also carries Reconnect and Disconnect. There is no separate `/sync` page.
2. Frontend calls `github.getAuthorizationUrl` with the current branch path as `returnPath`, so the user lands back where they started.
3. Server generates state parameter (`hex(userId).randomHex`) — encodes the user identity so no server-side state table is needed.
4. User is redirected to `https://github.com/login/oauth/authorize?scope=repo+user&state=…`. The `workflow` scope is deliberately NOT requested any more: the user's repo is code-only, and workflow files are written exclusively to the platform's build mirror (see `ensureVmMirror`) with the platform token — so a user token never touches `.github/workflows/`, and the old "reconnect and approve `workflow`" dance is gone. Tokens issued while it was still requested keep working (the surplus scope is simply unused).
5. GitHub redirects back to the callback route (registered in `http.ts`).
6. Server decodes state to recover the `userId`.
7. Exchanges code for an access token.
8. Token stored on `users.githubAccessToken`; the `x-oauth-scopes` header from the `GET /user` call is stored alongside it on `users.githubScopes`.
9. `listUserRepos` uses the token to fetch repos from the GitHub API.

Scopes:

- `repo` — full access to private/public repos (needed for push).
- `user` — read user profile info.

What GitHub *reports* (via `x-oauth-scopes`) is recorded rather than assumed — `githubHelpers.getGithubStatus` returns `scopes` and `hasWorkflowScope` (`true` / `false` / `null` for "unknown"). `hasWorkflowScope` is now only a diagnostic for the PLATFORM token: server-side, `githubActionsRunner` performs the same check before it will attribute a 403/404 under `.github/workflows/` on the build mirror to a missing scope of the platform's `GITHUB_TOKEN`.

**A missing `workflow` scope was never the common failure mode.** The far more common cause of a stuck VM/sandbox boot was that `workflow_dispatch` only resolves via the repo's *default* branch — writing the workflow file solely to the working branch made every dispatch 404 forever, regardless of token scope. `githubActionsRunner.ensureWorkflowOnRepo` writes the file to both the mirror's default branch (registers the trigger) and its working branch (what actually runs). See `CLAUDE.md` §4.

The connected token is read live from `users.githubAccessToken` on every runner dispatch. `githubConfigs.githubToken` is a snapshot taken at repo-creation time and is only a fallback — reading it as the source of truth is what made reconnecting unable to fix a stuck branch.

## Desktop app auth

The WPF app uses a device-code style flow — it never asks for the OTP itself.

1. `LoginWindow.xaml` shows a short auth code and status while waiting.
2. `LoginHandler.cs` calls `desktopAuthActions:createCode`, opens the default browser at `/auth/desktop?code=…`, then polls `desktopAuth:pollCode` every 2s with a 5-minute timeout. The code is 8 alphanumeric characters with the ambiguous ones (`I`, `O`, `0`, `1`) removed, generated with `crypto.getRandomValues`.
3. The user signs in on the website (normal email OTP) and authorizes the code. `desktopAuth.authorizeCode` mints a session token and attaches it to the code.
4. `AuthManager.cs` persists the returned token DPAPI-encrypted at `%LOCALAPPDATA%\Thalamus\session.dat`.
5. Token is injected into `ConvexClient` and `StreamingClient` requests as `{ token }`.

The desktop app ends up with the same `customSessions` token as the web app — only the handoff differs.

`desktopAuthActions:createCode` is a public action; the 8-character code is the only thing standing between a caller and a 30-day session token. Rate-limit and expiry defaults live in `desktopAuth.ts`.

## Auth tables

| Table | Fields | Purpose |
|---|---|---|
| `otpCodes` | email, code, expiresAt, used | Pending verification codes |
| `customSessions` | userId, token, email, expiresAt | Active sessions (30-day expiry, `by_token` and `by_user` indexes) |
| `desktopAuthCodes` | code, status, sessionToken, … | Pending desktop app auth codes |
| `users` | email, githubAccessToken, role, … | User accounts |
| `oauthStates` | (Google) OAuth flow state |

## Security notes

- OTP codes expire in 15 minutes. The 6-digit code itself is generated with `Math.random`, unlike the desktop auth code and `ao_` keys which use `crypto.getRandomValues` — known asymmetry.
- Sessions expire in 30 days. Max 10 sessions per user.
- `/auth?token=` (the OAuth hand-back) validates the token against `/^[0-9a-f]{64}$/` before adopting it, so a malformed query string cannot be stored as a session.
- The session token is passed as an explicit `{ token }` argument to nearly every Convex call — nothing is inferred from the connection.
- GitHub state parameter encodes userId directly (stateless verification).
- No password storage anywhere.
- Admin role is checked server-side for all admin operations; `/admin` functions string-compare `ADMIN_TOKEN` (set in the Convex dashboard).
- User-supplied provider keys (`codeApiKeys`) are AES-256-GCM encrypted with `API_KEY_ENCRYPTION_SECRET`. The write path fails closed if the secret is missing.
- `thal_` platform API keys and `ao_` AgentOverflow keys are SHA-256 hashed; only the hash is stored.
