# NAMELESS: Cloudflare Pages and Convex

NAMELESS at `https://nameless.is` is a prelaunch waitlist. The model is still training. Account signup automatically joins the waitlist; administrators reserve slots and Convex schedules notification emails.

## Deployment target

The confirmed target is the existing `befitting-wildebeest-866` deployment. The owner has chosen to reuse it for NAMELESS and retire AgentOverflow. This source cleanup removes AgentOverflow and relay functions, routes, crons, model-provider clients, API keys, and product logic. Deploying the cleaned backend disables those retired endpoints.

The cleanup contains no deletion of stored production documents. Optional legacy profile fields remain typed, and the pre-existing `schemaValidation: false` setting is preserved so older records do not block deployment. Enabling full database schema validation requires a separate data migration; API argument validation and authentication checks remain in place. Old product tables are no longer declared or used; any removal of their stored records is a separate data operation. No external SQL waitlist data was accessible or imported; export and migrate any such entries before switching production traffic.

## Cloudflare Pages

Use Node 22 or newer and Bun 1.3.14. Install with `npm ci` or `bun install --frozen-lockfile`, build with `bun run build`, and publish `dist/`. Root `functions/` supplies the account proxy and OAuth callback. Configure custom domain `nameless.is` and its DNS records in Pages.

`wrangler.toml` names the Pages project `nameless`. Its `CONVEX_SITE_URL` selects the backend HTTP site; `NEXT_PUBLIC_CONVEX_SITE_URL` selects that same site for browser OAuth links at build time. Both default to the existing deployment. Override both for a separate or development backend. Remove obsolete GATEWAY bindings from Pages settings. No standalone Worker, Postgres, Neon, chat API, or model-server credential is required.

System fonts, static CSS background effects, server-rendered landing content, native FAQ disclosure, and a native navigation dialog avoid external fonts, a WebGL render loop, and an animation runtime.

## Convex accounts and database

The exact `https://nameless.is/auth/callback` redirect is always allowed, including when `FRONTEND_URL` still contains an old domain. Optional `FRONTEND_URL` adds a trusted frontend origin and is normalized to its origin; callback paths, query strings, fragments, and user information are validated. Set it to `https://nameless.is` to keep configuration current. Google callback URLs are derived from the incoming Convex request origin, without depending on a second `CONVEX_SITE_URL` variable in Convex. Retain the existing Google and GitHub provider credentials and registered Convex callback URLs, updating provider callbacks if moving deployments. Email-code authentication continues to use the existing Brevo service. Valid, unexpired sessions and non-banned users are required for waitlist access. Administrators have the existing `admin` role or an email listed in optional Convex `ADMIN_EMAILS`.

Tables `namelessWaitlist` and `namelessCounters` store enrollment. Positions use a transactional counter, so concurrent signups do not scan the waitlist or receive duplicate positions. Administrator listings read an indexed page of at most 50 unsent entries. Cookies are HttpOnly, Secure, and SameSite=Lax; account responses are not cached. OTP resends have a 30-second cooldown; five incorrect verification attempts lock a code until a new code is issued.

## Notifications

Reuse Convex `BREVO_EMAIL_SENDER`; do not duplicate the credential in Pages or source. Optional `WAITLIST_EMAIL_FROM` selects a verified sender. The default is the existing sender address used before cleanup, with NAMELESS as the display name.

Invitations and scheduled jobs persist atomically. Repeating an invitation while pending or sent does not create another job. Failed sends retry up to three times with delays, then remain visible for administrator retry. Refresh delivery status on `/console/admin`. Provider acceptance does not prove inbox delivery; monitor bounces in Brevo. Stable notification keys deduplicate provider retries within its supported window. Generation is not enabled by an invitation; the model remains in training.

## Validation and publication

Run `bun run type-check`, `bun run lint`, `bun run format:check`, `bun run test`, and `bun run build`. Convex tests use an in-memory backend without live credentials.

Each verified push to `main` deploys the backend using the existing repository secret `CONVEX_DEPLOY_KEY`. The workflow explicitly permits removal of retired product indexes without deleting their documents. A missing key fails with an explicit error; the obsolete `DEPLOY_ENABLED` switch no longer silently skips deployment. The post-deploy smoke test verifies account routes and both real NAMELESS OAuth initiation URLs. Ensure the deployment key targets `befitting-wildebeest-866`. Pages publishes separately through its Git integration. Deploy the Convex functions before switching Pages traffic, then verify a real signup, waitlist status, invitation, and delivered email at `nameless.is`. Local tests do not establish successful production deployment or inbox delivery.

### Diagnosing “Invalid redirect”

If the production OAuth endpoints reject `https://nameless.is/auth/callback` while the same URL passes tests, check the deployed backend revision. A 404 from `/nameless/api/me` confirms the NAMELESS route set is not active; a current deployment returns 401 without a session. Passing the Pages build alone does not deploy Convex. Check the GitHub backend deployment job, its `CONVEX_DEPLOY_KEY` binding, and the exact target deployment before retrying sign-in. The smoke test follows no provider redirects; a 302 to Google or GitHub verifies initiation, while a full user sign-in still needs valid provider configuration.
