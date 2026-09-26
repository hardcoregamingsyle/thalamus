# CLAUDE.md

Guidance for Claude Code (or any other LLM agent) operating in this repository. Neutral, professional voice — the same voice the shipping docs use. No persona, no first-person swagger.

The governing tradeoff: quality over speed, correctness over shortcuts. Trivial tasks use judgement; nothing else trades correctness for pace.

---

## Current state: rebuild in progress

`main` was emptied on 2026-09-26 for a from-scratch rebuild. The previous codebase is preserved at the annotated tag `archive/pre-redo-2026-09` (commit `7573801`). Restore a file with `git checkout archive/pre-redo-2026-09 -- <path>`; never restore from an older local checkout.

Production was not touched and still runs the archived code:

- **Convex `befitting-wildebeest-866`** serves the old Thalamus functions, the entire AgentOverflow backend, and the session relay (`relay.ts`, `/relay/mcp/<key>`, used by live scheduled routines). The AgentOverflow site calls its functions by string name — the contract is `frontend/src/lib/thalamusApi.ts` in the sibling `agentoverflow` repo.
- **Cloudflare Pages** builds production from `main` on every push. A failing build leaves the last good deployment live; the first successful build replaces it.
- **GitHub Releases** — the shipped installer downloads `releases/latest/download/Thalamus.exe` and `releases/download/vm-bridge-v3.5.0/thalamus-vm-bridge-v3.5.0.exe`, and the shipped app reads `releases/latest` for its update check. Do not delete or rename existing Releases.

`npx convex deploy` replaces a deployment's entire function, HTTP-route and cron set. Before the rebuild's first deploy to `befitting-wildebeest-866`, the new backend must carry, or deliberately retire with the owner's sign-off:

- the AgentOverflow closure: `agentoverflow*.ts`, `customAuth*`, `admin:adminLogin`, `analytics:getAnalyticsConfig`, the `/ao/*` HTTP routes, and the `refill agentoverflow credits` and `sync agentoverflow keys to vm` crons;
- the session relay (`relay.ts`, `lib/relayProtocol.ts`, the `relayMessages` table);
- the OAuth routes (`/auth/google`, `/auth/google/callback`, `/auth/github`, `/github/callback`), which are registered in the Google and GitHub OAuth apps;
- row compatibility with existing tables, above all the shared `users` table and its AgentOverflow columns.

Rotate `CONVEX_DEPLOY_KEY` before a new deploy workflow references it, and do not gate deploys on `workflow_run` with a `branches: [main]` filter — a fork PR from a branch named `main` matches it.

---

## 1. Core behaviours

### Think before coding
- State assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, surface them — do not pick silently.
- Never fabricate links, model names, environment variables, or file paths.

### Best over fastest
- Prefer the better-engineered approach when two exist.
- Desktop software is natively built. Do not propose Electron, Tauri, or any web-shell packaging.
- "Best" is not "over-engineered": no speculative features, no single-use abstractions, no unrequested flexibility.

### Web/desktop parity
Any user-facing change made to the website must ship to the desktop app in the same task. If a web change genuinely has no desktop counterpart (SEO copy, landing page, guest mode), say so explicitly rather than silently skipping the desktop side.

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
- Update every dependent when modifying a file — including the sibling `agentoverflow` repo and the shipped desktop `.exe`.
- Remove imports/variables/functions your change orphaned. Leave pre-existing dead code alone unless asked.
- Every changed line must trace to the user's request.

### Goal-driven autonomy
Turn requests into verifiable goals ("add validation" → "write tests for invalid inputs, then make them pass"). For multi-step tasks, state a brief plan and verify each step. If a required tool is missing, install it.

---

## 2. Voice and commits

Documentation (`README.md`, `docs/**`) and commit messages are written in a neutral, professional voice. Tables and prose. No emoji, no first-person, no character.

Commit format matches existing history: lowercase `scope: subject`, where scope is an area name (`convex`, `landing`, `desktop`, `ci`, `docs`, `seo`, `cleanup`, …). Subject is short, lowercase, sometimes with an em-dash clause. Bodies are plain prose explaining the why. No conventional-commit strictness, no emoji. Agent-authored commits carry a `Co-Authored-By` attribution trailer.

Commit small and frequently, between tasks — not one giant thousand-line commit. Push to `main` directly; there is no PR flow on this repository.

Website download links point at `github.com/hardcoregamingsyle/thalamus/releases/latest/download/Thalamus.exe`. Publishing a Release whose asset is named exactly `Thalamus.exe` is the whole job; only if the asset name changes must the web links change.
