# Architecture

Thalamus is a first-party AI provider. It serves the in-house model family, Thalamus Sophon, through an OpenAI-compatible API, a developer console, and a web chat app. The model is built on a non-transformer architecture and is operated by the model lab behind the contract in [model-server.md](model-server.md).

Status: design accepted 2026-09-27. Nothing below is deployed yet. Until the model can take external traffic (not before November 2026), the product runs a waitlist.

## 1. Product decisions

| Decision | Choice |
|---|---|
| Surfaces | OpenAI-compatible API, developer console, web chat app. No desktop app. |
| Models served | Thalamus Sophon only. No third-party model routing. |
| Launch | Waitlist until the model is ready; invited accounts first. |
| Pricing | Free beta with rate limits. Usage is metered from day one; paid billing is switched on later. |
| Accounts | One account shared with AgentOverflow. |
| Domain | `thalamus.aphantic.skinticals.com` (web), `api.thalamus.aphantic.skinticals.com` (API) |

## 2. System overview

| Component | Technology | Responsibility |
|---|---|---|
| API gateway | Cloudflare Worker (TypeScript, Hono) | `/v1/chat/completions`, `/v1/models`, the console and chat-app backend routes. Auth, rate limits, session resolution, the per-user write lease, SSE relay to the model server, usage events. |
| Product database | Postgres on Neon, reached through Cloudflare Hyperdrive | API keys, sessions, chat transcripts (chat app only), waitlist, usage ledger, plan limits, later billing state. |
| Accounts | Shared Convex deployment `befitting-wildebeest-866` | Sign-in (email code, Google, GitHub) and the `users` table shared with AgentOverflow. Thalamus reads it through a fixed set of functions (§4). |
| Model server | Operated by the model lab on Modal | Generates streamed text and owns every per-user and per-session memory file. |
| Metering pipeline | Cloudflare Queues → consumer Worker | Writes the billing ledger in Postgres and a parallel, dashboard-only copy to Workers Analytics Engine. |
| Web app | Next.js on Cloudflare Workers (OpenNext) | Marketing and waitlist pages, developer console, chat app, API docs. One app, one deploy. |
| CI/CD | GitHub Actions | Test-gated deploys on push to `main`; migrations dry-run on a throwaway Neon branch. |

Hot-path design rule: nothing holds a stateful primitive open for the length of a generation. The gateway relays the stream from a stateless Worker, which is billed for CPU time rather than wall-clock time, so a long reply spent waiting on the model costs almost nothing to relay.

## 3. Ownership of the shared Convex deployment

`npx convex deploy` replaces a deployment's entire function, route and cron set, so exactly one repository can own a deployment. From the cutover onwards the `agentoverflow` repository owns `befitting-wildebeest-866`. It carries:

- the AgentOverflow backend (`agentoverflow*.ts`, its crons, the `/ao/*` routes);
- the shared accounts (`customAuth*`, the OAuth routes, `users`, sessions, OTP tables), `admin:adminLogin`, `analytics`;
- the session relay (`relay.ts`, `lib/relayProtocol.ts`, `relayMessages`).

The old Thalamus product functions (chat, research, study, code mode, desktop endpoints) are not carried over; the old web and desktop apps are retired (§11). This repository holds no Convex code.

Cutover order, each step gated on the previous one:

1. Restore the carried set from tag `archive/pre-redo-2026-09` into `agentoverflow/convex/`, with a reference check that every string-named call from both frontends resolves.
2. Deploy it to a scratch Convex deployment and diff the resulting function, route and cron list against the intended set.
3. Rotate `CONVEX_DEPLOY_KEY`, store it only in the `agentoverflow` repository, and deploy to production from a push-triggered workflow (no `workflow_run` trigger).
4. Smoke-test sign-in on both sites, the AgentOverflow API and MCP server, the relay, and the crons.

## 4. Accounts

Thalamus uses the shared accounts exactly as AgentOverflow does. The contract, pinned by name in `apps/web` and checked in the `agentoverflow` CI:

| Function or route | Use |
|---|---|
| `customAuth:sendOtp`, `customAuth:verifyOtp` | Email-code sign-in |
| `GET /auth/google`, `GET /auth/github` on `befitting-wildebeest-866.convex.site` | OAuth sign-in; the callback redirects back with `?token=` to an allowlisted origin (`FRONTEND_URL`) |
| `customAuthHelpers:getUserByToken` | Resolve a session token to a user |
| `customAuthHelpers:signOut` | End the session |

After sign-in the web app exchanges the Convex session token with the gateway for an `HttpOnly`, `Secure`, `SameSite=Lax` cookie on the Thalamus domain. The gateway validates it with `getUserByToken`, cached for 60 seconds. Thalamus-specific account state (waitlist status, plan, API keys) lives in Postgres, keyed by the Convex user id; the shared `users` table is never written by Thalamus.

API keys are a separate credential: `th_` prefix, 32 random bytes from the Web Crypto CSPRNG, stored only as a SHA-256 hash with the last four characters for display. The raw key is shown once.

## 5. `POST /v1/chat/completions`

1. Resolve the API key (or the chat-app cookie) to an account. A key hash cache in the Worker isolate absorbs repeat lookups; revocation takes effect within 60 seconds.
2. Reject accounts that are not yet invited with an OpenAI-shaped 403 (`code: "waitlisted"`).
3. In one Postgres round trip, a SQL function applies the account's rate limit (token bucket) and takes the per-user write lease (§6). An exceeded limit returns 429 with `Retry-After`; a held lease returns 409.
4. Resolve the session (§6) and forward only the new turns to the model server.
5. Relay the model server's stream to the client as standard `chat.completion.chunk` events, then a final chunk with `usage`.
6. Release the lease, record the committed turn on the session, and enqueue one usage event. Errors become OpenAI-shaped errors; whatever streamed before an error is still metered.

`/v1/models` lists the models the account may use. `usage` reports characters in and out, plus `prompt_tokens` and `completion_tokens` computed as `ceil(chars / 4)` for SDK compatibility; billing uses characters.

## 6. Sessions on an OpenAI-compatible API

The model keeps the conversation in its session memory, so it receives only the turns it has not yet seen. Unmodified OpenAI SDKs resend the whole `messages` array each call; the gateway maps that onto sessions without any client change:

- Each committed turn stores a rolling hash of the transcript so far. An incoming request's prefix (every message up to and including the last assistant message) is hashed and matched against the account's sessions for that end user.
- Match on the latest hash: the remaining messages are new turns.
- Match on the previous hash with no new user message: a regenerate of the last reply.
- No match, or a changed earlier message: a new session with the full transcript, since an edit or branch starts from a fresh session.
- Clients may instead pass `session_id` (body field or `X-Thalamus-Session-Id` header) to skip hashing. The response returns the session id in the same header.

The OpenAI `user` field identifies an API customer's end user. The model server receives only a pseudonymous `user_key`, an HMAC of the account id and end-user id, never an email or raw id.

**Single writer.** At most one generation or session-end call is in flight per `user_key`, enforced by a lease row in Postgres with a 15-minute expiry that is released on completion. This is what lets the model server update a user's memory without write races.

**Session end.** The chat app ends a session when the user closes the conversation; API sessions end after 30 minutes idle. A scheduled Worker finds idle sessions and calls the model server's session-end endpoint, which merges the session into the user's memory.

**Retention.** The gateway stores message text only for the chat app, so users can reopen conversations. For API traffic it stores hashes and counts, never content.

## 7. Data model (Postgres)

| Table | Key columns | Purpose |
|---|---|---|
| `accounts` | `id`, `convex_user_id`, `status` (waitlisted, invited, active, suspended), `plan` | Thalamus state for a shared account |
| `waitlist` | `email`, `convex_user_id`, `position`, `invited_at`, `source` | Pre-launch queue |
| `api_keys` | `id`, `account_id`, `hash`, `last4`, `name`, `created_at`, `revoked_at` | Programmatic access |
| `end_users` | `account_id`, `external_id`, `user_key` | Maps the OpenAI `user` field to a pseudonymous key |
| `sessions` | `id`, `account_id`, `user_key`, `model`, `head_hash`, `prev_hash`, `turns`, `last_activity_at`, `ended_at` | Session resolution |
| `user_leases` | `user_key`, `request_id`, `expires_at` | Single-writer lease |
| `rate_buckets` | `account_id`, `tokens`, `updated_at` | Token bucket |
| `conversations`, `messages` | chat-app transcript | Chat app only |
| `usage_events` | `account_id`, `request_id`, `model`, `chars_in`, `chars_out`, `duration_ms`, `status`, `created_at` | Append-only billing ledger, unique on `request_id` |
| `usage_daily` | `account_id`, `day`, `model`, totals | Console charts and future invoices |
| `plans` | `id`, rate and quota limits, future price fields | Configuration |

## 8. Metering and billing

Every request that streamed anything produces one usage event, delivered through Cloudflare Queues with retries and written idempotently (`request_id` is unique). A nightly job rolls events into `usage_daily`. Analytics Engine receives a copy for dashboards only; it samples at volume and is never used for billing.

During the free beta, usage feeds rate limits and the console. Paid billing is additive: prices attach to `plans` and invoices are built from `usage_daily`. Stripe is the target processor; new India-registered businesses need an invitation, so the application goes in early, with Paddle (merchant of record) as the fallback against the same data.

## 9. Waitlist

Signing in with the shared account and pressing "Join" creates the `accounts` row (status `waitlisted`) and a `waitlist` row. An admin invite flips the status; invited accounts can create API keys and use the chat app. Until then the console shows the position and docs, and the API returns the 403 from §5.

## 10. Deploy safety and operations

- One workflow per repository, triggered on `push` to `main` and on pull requests. Deploy jobs depend on the test job, run only on `push`, and read secrets that fork pull requests never receive. No `workflow_run` triggers.
- Migrations run first against a throwaway Neon branch in CI; production migrations are additive, with destructive changes split across releases.
- Secrets live in Cloudflare and GitHub encrypted secrets. The repository is public, so public text never describes model internals.
- Observability: Workers logs and analytics for the gateway, the model lab's dashboard for the model server, Sentry for exceptions, and a synthetic check on `/v1/models` feeding a status page. On-call paging is added before paid billing goes live.
- Backups: Neon point-in-time restore for Postgres. The model server backs up its own memory storage.

## 11. Retiring the old apps

1. The new web app takes over `thalamus.aphantic.skinticals.com`, and the old Cloudflare Pages project is deleted.
2. The Convex cutover (§3) drops the old Thalamus functions, which ends every installed old desktop app.
3. The old desktop GitHub Releases are deleted after the owner confirms the list.

## 12. Cost estimates

Platform only, from published unit prices, not measurements; inference is billed separately by the model lab's host.

| Scale | Platform per month | Main lines |
|---|---|---|
| Waitlist | about $5–20 | Workers Paid base; Neon, Queues and Analytics Engine within free allowances |
| Free beta, a few hundred daily users | about $25–45 | Neon compute for bursts |
| About 1,000 daily users, 200,000 completions a day | about $350–600 | Neon Scale compute, Queues operations, Sentry Team |

## 13. Risks

| Risk | Mitigation |
|---|---|
| The model is not ready by the target date | The waitlist is the product until it is; nothing else depends on the date. |
| Postgres is on the hot path (lease and rate limit) | One round trip per request through Hyperdrive; Neon compute kept warm once traffic starts. A database outage stops new generations but never corrupts memory. |
| Login depends on the shared Convex deployment | API keys do not; only console and chat sign-in are affected by a Convex outage. |
| One inference host | The model server sits behind a plain HTTP contract, so a host change is a redeploy of the model server only. |
| Public repository and a confidential model | Public text describes the model only functionally, and every commit is reviewed against that rule. |
