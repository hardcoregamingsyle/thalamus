// Pure helpers for the "⚠️ Cloud command execution is disabled" transcript
// warning — zero imports (shaped like agentOutputParser.ts) so the whole
// file is unit-testable without a Convex runtime.
//
// The warning used to be deduped only against the LAST transcript message:
// as soon as the user's own prompt landed between two startPipeline runs, the
// identical warning printed again — a "Bad credentials" stamp after every
// single "continue". The branch row now remembers which blocked-reason
// wording was already surfaced (executorBlockWarnedReason) and these helpers
// own the two decisions around that stamp:
//
//   1. startPipeline: should this prompt print the warning? (once per
//      distinct reason, never per prompt)
//   2. setExecutorBlocked: does this reason write re-arm the warning?
//      (any CHANGE of the reason — including clearing it on heal — clears
//      the stamp, so a genuinely new situation is always announced exactly
//      once, while a persistent block stays silent after its first print)

export function shouldWarnExecutorBlocked(
  blockedReason: string | undefined,
  warnedReason: string | undefined,
): boolean {
  return !!blockedReason && blockedReason !== warnedReason;
}

export function warnedStampAfterBlockChange(
  previousReason: string | undefined,
  nextReason: string | undefined,
  currentWarnedReason: string | undefined,
): { changed: boolean; warnedReason: string | undefined } {
  if (previousReason === nextReason) {
    return { changed: false, warnedReason: currentWarnedReason };
  }
  return { changed: true, warnedReason: undefined };
}

// The stamped reason already carries the case-appropriate guidance
// (githubActionsRunner splits its wording by token provenance), so the
// warning only has to recognise a platform-side block to pick the pointer:
// on a platform-hosted failure the "reconnect GitHub" pointer is a loop the
// user can never break out of, so the warning says who actually owns the fix.
export function isPlatformBlockReason(reason: string): boolean {
  return (
    reason.includes("platform's GitHub integration") ||
    reason.includes("platform's GITHUB_TOKEN") ||
    reason.includes("platform build workspace") ||
    reason.includes("platform-side")
  );
}

export function buildExecutorBlockedWarning(blockedReason: string): string {
  const pointer = isPlatformBlockReason(blockedReason)
    ? `This is a platform-side configuration issue, not something your GitHub connection controls — the desktop app runs commands on your own machine instead.`
    : `Open this branch's Git Sync tab to check the GitHub connection and reconnect.`;
  return (
    `⚠️ Cloud command execution is disabled on this branch: ${blockedReason}\n\n`
    + `Agents will keep working on files, but any command they would have run will not execute. `
    + pointer
  );
}
