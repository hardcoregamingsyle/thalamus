# CLAUDE.md

Guidance for Claude Code (or any other LLM agent) operating in this repository. Neutral, professional voice — the same voice the shipping docs use. No persona, no first-person swagger.

The governing tradeoff: quality over speed, correctness over shortcuts. Trivial tasks use judgement; nothing else trades correctness for pace.

---

## Current state: rebuild in progress

Thalamus is being rebuilt as a first-party AI provider serving the in-house model family, Thalamus Sophon: an OpenAI-compatible API, a developer console and a web chat app, with a waitlist until the model can take external traffic. The accepted design is [`docs/architecture.md`](docs/architecture.md); the interface to the model server is [`docs/model-server.md`](docs/model-server.md). Read both before building anything.

The previous codebase is preserved at the annotated tag `archive/pre-redo-2026-09` (commit `7573801`). Restore a file with `git checkout archive/pre-redo-2026-09 -- <path>`; never restore from an older local checkout.

Deploy paths, all triggered by a push to `main`:

- **Convex `befitting-wildebeest-866`** is deployed from `apps/convex` by CI, only when that directory changed. It carries the AgentOverflow backend (the AgentOverflow repository is paused; its site calls these functions by string name), the shared accounts and the session relay (architecture §3). `npx convex deploy` replaces the deployment's entire function, route and cron set, so `bun run --filter=@thalamus/convex check-refs` must pass before any change there. Roll back with the `Convex restore` workflow.
- **Neon and the gateway Worker** are migrated and deployed by the CI deploy job, which runs only while the repository variable `DEPLOY_ENABLED` is `true`.
- **Cloudflare Pages** (project `thalamus`, domain `thalamus.aphantic.skinticals.com`) builds the web app from `main` on its own: `npm ci`, then `bun run build`, publishing `dist/` and the root `functions/`. Keep `package-lock.json` in sync with `package.json`; CI checks it.
- **GitHub Releases** of the old desktop app are to be deleted once the owner confirms the list (architecture §11). Do not delete any before that confirmation.

The model is described publicly only as a non-transformer architecture. This repository is public: never describe the model's internals, size, training hardware or training data in any file, commit, comment or doc, and never claim performance, context length or memory capabilities until the model lab has published measured results.

---

## 1. Core behaviours

### Think before coding
- State assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, surface them — do not pick silently.
- Never fabricate links, model names, environment variables, or file paths.

### Best over fastest
- Prefer the better-engineered approach when two exist.
- "Best" is not "over-engineered": no speculative features, no single-use abstractions, no unrequested flexibility.

### Simplicity first
Minimum code that solves the stated problem. If a 200-line change could be 50 lines, rewrite it.

### Always ship
After every completed task, commit and push to `main` without being asked.

Sandboxed sessions may start on a per-session feature branch rather than `main` (for example `arena/<id>`). That is an environment detail, not a change to the shipping policy: the owner wants every commit to land on `main` directly with no manual merge. When the working branch is not `main`, fast-forward `main` to the session commit and push it as part of the same task:

```bash
git fetch origin
# after committing on the session branch:
git branch -f main origin/main
git merge --ff-only main   # or: git branch -f main <session-commit> when main is an ancestor
git push origin main
git push origin <session-branch>   # keep the session ref in sync too
```

Only fall back to a PR if `main` is branch-protected and rejects the push; do not silently stop at a feature branch.

### Surgical changes
- Match existing style. Do not "improve" adjacent code, comments, or formatting.
- Update every dependent when modifying a file — including the sibling `agentoverflow` repo.
- Remove imports/variables/functions your change orphaned. Leave pre-existing dead code alone unless asked.
- Every changed line must trace to the user's request.

### Goal-driven autonomy
Turn requests into verifiable goals ("add validation" → "write tests for invalid inputs, then make them pass"). For multi-step tasks, state a brief plan and verify each step. If a required tool is missing, install it.

---

## 2. Voice and commits

Documentation (`README.md`, `docs/**`) and commit messages are written in a neutral, professional voice. Tables and prose. No emoji, no first-person, no character.

Commit format matches existing history: lowercase `scope: subject`, where scope is an area name (`convex`, `landing`, `desktop`, `ci`, `docs`, `seo`, `cleanup`, …). Subject is short, lowercase, sometimes with an em-dash clause. Bodies are plain prose explaining the why. No conventional-commit strictness, no emoji. Agent-authored commits carry a `Co-Authored-By` attribution trailer.

Commit small and frequently, between tasks — not one giant thousand-line commit. Push to `main` directly; there is no PR flow on this repository.

---

## 3. Layout, commands and gates

| Path | What it is |
|---|---|
| `apps/gateway` | Cloudflare Worker `thalamus-gateway`: the public `/v1` API and the web app's `/api` |
| `apps/web` | Next.js static export served by Cloudflare Pages |
| `functions/` | Pages Functions: forward `/api/*` and `/v1/*` to the gateway, OAuth callback |
| `apps/convex` | The shared Convex backend (accounts, AgentOverflow, relay) |
| `packages/contract` | OpenAI and model-server types, request signing, SSE, transcript hashing |
| `packages/db` | Drizzle schema, migrations and the SQL functions for rate limits and leases |
| `tools/mock-model-server` | Local implementation of `docs/model-server.md` for development and tests |

| Gate | Command |
|---|---|
| Types | `bun run type-check` |
| Lint and format | `bun run lint`, `bun run format:check` |
| Tests | `bun run test` |
| Convex references | `bun run --filter=@thalamus/convex check-refs` (needs the sibling `agentoverflow` checkout or `AGENTOVERFLOW_DIR`) |
| Web build (what Pages runs) | `bun run build` |
| Gateway build | `bun run build:gateway` |

All gates must pass before a push. Dependencies are installed with bun; after changing any `package.json`, regenerate `package-lock.json` from the manifests alone (npm cannot read bun's `node_modules`) and keep both lockfiles committed. `apps/convex/convex` is carried verbatim from the archive tag and is excluded from formatting so it stays diffable against it. Gateway secrets live in GitHub Actions secrets and are re-applied to the Worker on every deploy; `USER_KEY_SECRET` must never change.
