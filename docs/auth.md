# Authentication

Thalamus uses three auth mechanisms depending on the client: Email OTP (primary), GitHub OAuth (for repo access), and a custom session token system.

## Email OTP (Primary Login)

### Flow

1. User enters email on the login page
2. Frontend calls `customAuth.sendOtp` action
3. Server generates a 6-digit numeric code using `@oslojs/crypto/random`
4. Code stored in `otpCodes` table with 15-minute expiry
5. Email sent via Brevo SMTP API (`api.brevo.com/v3/smtp/email`)
6. User enters the 6-digit code
7. Frontend calls `customAuth.verifyOtp`
8. Server looks up code by email, checks it's unused and unexpired, marks it used
9. User found by email (or created with defaults: 10M AgentBucks, referral code)
10. Session token generated: 32-byte random hex (64 chars)
11. Token stored in `customSessions` table with 30-day expiry
12. Client stores token in `localStorage` under key `agentai_session_token`

### Key Details

- OTP sender: `thalamus-onboarding@mail.aphantic.skinticals.com`
- Email template: branded dark terminal aesthetic
- Max 10 concurrent sessions per user (oldest pruned on new login)
- Special accounts: `@stkabir.co.in` emails auto-flagged as school/teacher accounts
- Codes are single-use (marked `used: true` after verification)

## Session Management

### Token Lifecycle

```
Login → Generate token → Store in customSessions (30-day TTL)
                       → Store in localStorage (client)
                       
Each request → Token sent as header → getUserByToken query validates:
              - Token exists in customSessions table
              - Token not expired (createdAt + 30 days > now)
              - Returns full user document if valid
              
Logout → Delete from customSessions table
       → Clear localStorage
```

### Multi-Tab Support

The frontend `use-auth.ts` hook listens for `StorageEvent` to sync auth state across browser tabs. If one tab logs out, all tabs detect the localStorage change and redirect to login.

### Token Validation (Every Render)

A reactive Convex query (`getUserByToken`) runs on mount and re-evaluates whenever the sessions table changes. This means:
- Expired sessions are immediately invalidated
- Admin-revoked sessions take effect in real-time
- No stale auth state possible

## GitHub OAuth (Repo Access)

### Purpose

GitHub OAuth is used solely for connecting user repositories to code projects. It is NOT used for login — email OTP handles authentication.

### Flow

1. User clicks "Connect GitHub" in project settings
2. Frontend calls `github.getAuthorizationUrl` action
3. Server generates state parameter: `hex(userId).randomHex` (encodes user identity)
4. User redirected to `https://github.com/login/oauth/authorize?scope=repo+user&state=...`
5. User approves on GitHub
6. GitHub redirects to callback URL (handled by `http.ts` route)
7. Server decodes state to recover userId (no server-side state table needed)
8. Exchanges code for access token via GitHub API
9. Token stored on user document (`users.githubAccessToken`)
10. `listUserRepos` action uses token to fetch repos from GitHub API

### Scopes
- `repo` — Full access to private/public repos (needed for push)
- `user` — Read user profile info

## Desktop App Auth

### Neutralinojs (Legacy Desktop Wrapper)
Uses the same web auth flow. Detects desktop mode via `window.NL_PORT`. Token stored in same localStorage.

### WPF Native App
The native Windows app (`thalamus-native/`) has its own auth UI:

1. `LoginWindow.xaml` — Dark-themed OTP entry dialog
2. `AuthManager.cs` — Stores session token in Windows user profile (file-based)
3. `LoginHandler.cs` — HTTP calls to Convex `sendOtp`/`verifyOtp` actions
4. Token injected into `ConvexClient` and `StreamingClient` headers

The flow is identical (email → OTP → session token) but uses native WPF UI and Windows file storage instead of browser localStorage.

## Auth Tables

| Table | Fields | Purpose |
|-------|--------|---------|
| `otpCodes` | email, code, expiresAt, used | Pending verification codes |
| `customSessions` | userId, token, createdAt | Active sessions (30-day TTL) |
| `users` | email, githubAccessToken, role, ... | User accounts |

## Security Notes

- OTP codes expire in 15 minutes
- Sessions expire in 30 days
- Max 10 sessions per user (prevents token accumulation)
- GitHub state parameter encodes userId directly (stateless verification)
- No password storage anywhere in the system
- Admin role checked server-side for all admin operations
