# CLAUDE.md

Guidance for Claude Code (or any other LLM agent) operating in this repository. Neutral, professional voice — the same voice the shipping docs use. No persona, no first-person swagger.

The governing tradeoff: quality over speed, correctness over shortcuts. Trivial tasks use judgement; nothing else trades correctness for pace.

---

## Current state: rebuild in progress

Thalamus is being rebuilt as a first-party AI provider serving the in-house model family, Thalamus Sophon: an OpenAI-compatible API, a developer console and a web chat app, with a waitlist until the model can take external traffic. The accepted design is [`docs/architecture.md`](docs/architecture.md); the interface to the model server is [`docs/model-server.md`](docs/model-server.md). Read both before building anything.

The previous codebase is preserved at the annotated tag `archive/pre-redo-2026-09` (commit `7573801`). Restore a file with `git checkout archive/pre-redo-2026-09 -- <path>`; never restore from an older local checkout.

Production still runs the archived code until each piece is replaced:

- **Convex `befitting-wildebeest-866`** serves the old Thalamus functions, the AgentOverflow backend, the shared accounts and the session relay. Ownership moves to the `agentoverflow` repository (architecture §3); this repository holds no Convex code and must never deploy to it. `npx convex deploy` replaces a deployment's entire function, route and cron set.
- **Cloudflare Pages** builds the old site from `main` on every push. A failing build leaves the last good deployment live; the first successful build replaces it.
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
