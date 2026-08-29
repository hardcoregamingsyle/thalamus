import { describe, expect, test } from "bun:test";
import {
  buildExecutorBlockedWarning,
  isPlatformBlockReason,
  shouldWarnExecutorBlocked,
  warnedStampAfterBlockChange,
} from "../src/convex/lib/executorWarnings";

const PLATFORM_REASON =
  "Cloud commands cannot start on this branch: creating the platform build workspace failed (Bad credentials - https://docs.github.com/rest). This is a platform-side issue — the desktop app still runs commands on your own machine.";
const USER_REASON =
  "Cloud commands cannot start on this branch: the connected GitHub token is missing the workflow scope.";

describe("shouldWarnExecutorBlocked — the once-per-reason rule", () => {
  test("a healthy branch never warns, stamped or not", () => {
    expect(shouldWarnExecutorBlocked(undefined, undefined)).toBe(false);
    expect(shouldWarnExecutorBlocked(undefined, PLATFORM_REASON)).toBe(false);
  });

  test("the first occurrence of a blocked reason warns (the branch has no stamp yet)", () => {
    expect(shouldWarnExecutorBlocked(PLATFORM_REASON, undefined)).toBe(true);
  });

  test("a prompt after the warning already printed stays silent — this is the spam the stamp exists to kill", () => {
    expect(shouldWarnExecutorBlocked(PLATFORM_REASON, PLATFORM_REASON)).toBe(false);
  });

  test("a DIFFERENT failure wording warns again — a new situation must never hide behind the old stamp", () => {
    expect(shouldWarnExecutorBlocked(USER_REASON, PLATFORM_REASON)).toBe(true);
  });

  test("heal-then-refail with the same wording warns again because the heal cleared the stamp", () => {
    // setExecutorBlocked(null) clears the stamp, so a refail arrives with
    // warnedReason undefined even though the wording matches history.
    expect(shouldWarnExecutorBlocked(PLATFORM_REASON, undefined)).toBe(true);
  });
});

describe("warnedStampAfterBlockChange — when a reason write re-arms the warning", () => {
  test("re-stamping the identical reason is not a change and keeps the stamp (no patch, no re-warn)", () => {
    const r = warnedStampAfterBlockChange(PLATFORM_REASON, PLATFORM_REASON, PLATFORM_REASON);
    expect(r.changed).toBe(false);
    expect(r.warnedReason).toBe(PLATFORM_REASON);
  });

  test("an identical reason on an unwarned branch stays unchanged with no stamp", () => {
    const r = warnedStampAfterBlockChange(PLATFORM_REASON, PLATFORM_REASON, undefined);
    expect(r.changed).toBe(false);
    expect(r.warnedReason).toBeUndefined();
  });

  test("a changed reason clears the stamp so the next prompt announces it once", () => {
    const r = warnedStampAfterBlockChange(PLATFORM_REASON, USER_REASON, PLATFORM_REASON);
    expect(r.changed).toBe(true);
    expect(r.warnedReason).toBeUndefined();
  });

  test("clearing the reason (a heal) clears the stamp so a later refail is announced again", () => {
    const r = warnedStampAfterBlockChange(PLATFORM_REASON, undefined, PLATFORM_REASON);
    expect(r.changed).toBe(true);
    expect(r.warnedReason).toBeUndefined();
  });

  test("a fresh block on a healthy branch is a change with no stamp", () => {
    const r = warnedStampAfterBlockChange(undefined, PLATFORM_REASON, undefined);
    expect(r.changed).toBe(true);
    expect(r.warnedReason).toBeUndefined();
  });

  test("healthy staying healthy is not a change", () => {
    const r = warnedStampAfterBlockChange(undefined, undefined, undefined);
    expect(r.changed).toBe(false);
    expect(r.warnedReason).toBeUndefined();
  });
});

describe("isPlatformBlockReason — pointer selection", () => {
  test("recognises every platform-side wording githubActionsRunner stamps", () => {
    expect(isPlatformBlockReason(PLATFORM_REASON)).toBe(true);
    expect(isPlatformBlockReason("…the platform's GitHub integration rejected the request…")).toBe(true);
    expect(isPlatformBlockReason("…the platform's GITHUB_TOKEN cannot write workflow files…")).toBe(true);
    expect(isPlatformBlockReason("…creating the platform build workspace failed (…")).toBe(true);
  });

  test("rejects user-token wordings so the reconnect pointer still shows for them", () => {
    expect(isPlatformBlockReason(USER_REASON)).toBe(false);
  });
});

describe("buildExecutorBlockedWarning — the message the user actually reads", () => {
  test("platform-side failures say the platform owns the fix and never point at Git Sync", () => {
    const w = buildExecutorBlockedWarning(PLATFORM_REASON);
    expect(w.startsWith(`⚠️ Cloud command execution is disabled on this branch: ${PLATFORM_REASON}`)).toBe(true);
    expect(w).toContain("platform-side configuration issue, not something your GitHub connection controls");
    expect(w).not.toContain("Git Sync tab");
    expect(w).toContain("any command they would have run will not execute");
  });

  test("user-token failures point at the Git Sync tab and never claim platform ownership", () => {
    const w = buildExecutorBlockedWarning(USER_REASON);
    expect(w).toContain("Open this branch's Git Sync tab");
    expect(w).not.toContain("platform-side configuration issue");
  });
});
