# NAMELESS on Cloudflare Pages

The public site is NAMELESS at `https://nameless.is`. The model is still training; the landing page presents context, memory, reasoning, and cost as development goals. Signup is free and automatically creates a waitlisted account after successful email-code or OAuth authentication. Existing invited and active accounts keep their access.

## Build and hosting

Use Node 22 or newer and Bun 1.3.14. From the repository root run `bun install --frozen-lockfile`, then `bun run build`. Cloudflare Pages builds with `npm ci` followed by `bun run build`; publish the generated `dist/` directory with the root `functions/` directory. The Pages project name in `wrangler.toml` is `nameless`. Set up the custom domain `nameless.is` in Pages; DNS and domain ownership must be configured in Cloudflare.

The frontend uses system fonts so builds require no Google Fonts connection. The existing internal Worker and workspace names remain unchanged to preserve service and protocol compatibility.

Configure the Pages `GATEWAY` service binding to `thalamus-gateway`. Bundle the Worker with `bun run build:gateway`; deploying it is a separate operation from the Pages build. Do not deploy until the environment bindings are supplied. Existing GitHub deployment remains gated by `DEPLOY_ENABLED`.

## Accounts and data

The gateway requires a development or production Neon `DATABASE_URL`, depending on the environment, and the existing schema migrations from `packages/db`. Apply migrations only to the intended database. Existing Convex shared accounts remain the identity provider. Configure its `FRONTEND_URL` to `https://nameless.is` to allow the new OAuth callback origin. Google/GitHub provider configuration and the existing Convex email-code delivery must also work before public signup can be verified. The shared Convex deployment also serves AgentOverflow; retain its settings and functions.

The Worker also uses `USER_KEY_SECRET`, `ADMIN_TOKEN`, `ADMIN_EMAILS`, `MODEL_SERVER_SECRET`, and `CONVEX_URL` as documented in its configuration. Preserve existing production secrets. Leave `MODEL_SERVER_URL` unset while the model is training: generation remains unavailable and waitlisted accounts cannot use the product. Sign-in and waitlist enrollment can operate independently of the model server.

## Slot notification

Set the Worker secret `BREVO_EMAIL_SENDER` (reuse the existing shared-account Brevo credential through secure deployment settings) and variable `WAITLIST_EMAIL_FROM` to a verified sender address in Brevo. Never commit the API key. For the existing GitHub deployment workflow, bind `BREVO_EMAIL_SENDER` as a repository secret and `WAITLIST_EMAIL_FROM` as a repository variable; the workflow syncs them to the Worker. Verify the sending domain through Brevo before sending real invitations. Both signup verification and slot notifications use the existing Brevo email service; the Worker needs its own secure binding to that credential.

An administrator signs in with an address listed in `ADMIN_EMAILS`, opens `/console/admin`, and chooses Invite when capacity is available. Without a configured notification sender, the operation returns 503 and leaves the account waitlisted. The invitation grants access and sends an email linking to `https://nameless.is/console`.

If delivery is not accepted, the API returns 502 and the entry remains on the admin list for retry; the slot is already granted. After acceptance, the entry is removed. Repeated completed invitations do not send another email. Brevo requests include an account-specific idempotency key. Provider acceptance does not guarantee inbox delivery; monitor bounces and delivery in Brevo. The prelaunch does not automatically allocate slots: the administrator controls capacity.

## Verification

Run `bun run type-check`, `bun run lint`, `bun run format:check`, `bun run test`, `bun run build`, and `bun run build:gateway`. The tests cover automatic enrollment for email/OAuth, notification payload and retry behavior, and the existing database, gateway, and model contracts without live credentials. For the reference gate, set `AGENTOVERFLOW_DIR` to the companion checkout and run `bun run --filter=@thalamus/convex check-refs`.

Before public launch, verify a real signup at `nameless.is`, confirm its waitlist status, invite a test account, and confirm the notification arrives and sign-in shows access. Those live checks require deployment credentials, a database, working shared authentication, and a verified email sender; local tests do not establish those services are configured.
