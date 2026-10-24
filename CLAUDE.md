# Repository guidance

NAMELESS is a prelaunch waitlist at nameless.is, hosted on Cloudflare Pages with Convex for accounts, database, and notification jobs. The AI is still training. Describe context, memory, reasoning, speed, and cost as goals until measured results are available. Never disclose private model internals, training data, or hardware.

## Layout and workflow

- `apps/web`: static Next.js frontend, account status, and administration.
- `functions`: same-origin Pages proxy to Convex and OAuth callback.
- `apps/convex`: authentication, transactional waitlist, and persisted email jobs.
- `scripts/assemble-pages.mjs`: assemble `dist/` for Cloudflare Pages.

Use Bun 1.3.14 and Node 22 or newer. Install with `bun install --frozen-lockfile`. Keep both lockfiles synchronized after dependency changes; Pages uses `npm ci`. Regenerate npm's lockfile from manifests in a clean directory because npm cannot read Bun's node_modules layout.

Required gates: `bun run type-check`, `bun run lint`, `bun run format:check`, `bun run test`, and `bun run build`. Tests exercise Convex transactions, HTTP signup, authorization, and notification persistence without credentials.

## Deployment and data

`convex deploy` replaces the full function and cron set. The owner has confirmed reuse of `befitting-wildebeest-866` for NAMELESS and retirement of its previous AgentOverflow and relay endpoints. Preserve existing account documents and credentials; cleanup must not delete stored data. Optional legacy account fields remain in the schema solely to validate existing accounts. See `docs/nameless-deployment.md` for settings and live verification.

Keep changes focused and neutral. Avoid speculative abstractions and unused features. Credentials belong in secure deployment settings, never tracked files or logs.

## Shipping policy

After a completed coding task and successful gates, commit and push to `main` without waiting for a manual merge. Never force-push. If branch protection prevents a fast-forward push, use a PR. Commit messages use a lowercase area and subject and include an agent Co-Authored-By trailer.
