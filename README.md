# Thalamus

Thalamus is being rebuilt from scratch. The previous codebase — the React web app, the native Windows desktop app, and the Convex backend — has been removed from `main` and is preserved at the tag [`archive/pre-redo-2026-09`](https://github.com/hardcoregamingsyle/thalamus/tree/archive/pre-redo-2026-09).

## Production during the rebuild

Removing the source changed nothing in production.

| Surface | State |
|---|---|
| Convex backend (`befitting-wildebeest-866`) | Still runs the archived code, including the AgentOverflow backend and the session relay. |
| Website (Cloudflare Pages) | Still serves the last successful build. |
| Desktop app | Existing Releases and their assets are unchanged. |

## Restoring archived code

```bash
git checkout archive/pre-redo-2026-09 -- src/convex/agentoverflow.ts
```

Restore from the tag, not from an older local checkout — the tag is the exact commit production was last deployed from.
