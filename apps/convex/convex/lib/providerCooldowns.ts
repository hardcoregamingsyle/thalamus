// Pure failure classification for the model-provider chain — zero imports
// (shaped like agentOutputParser.ts / executorWarnings.ts) so the whole file
// is unit-testable without a Convex runtime.
//
// Why this exists: the chain used to retry EVERY seat on EVERY agent turn,
// no matter what the seat answered. A DeadlySignal 403 (the account simply
// has no access to that model group — permanent), a Pollinations 402 (no
// balance — permanent until someone tops up), a Zen 400 "Model is
// unavailable" (gone — permanent), and an OpenRouter free-tier daily-quota
// 429 (permanent until the quota resets) were each re-attempted on every
// turn for 23+ hours straight: three doomed round-trips of pure latency
// before the one healthy seat answered, every single time. The in-isolate
// pollinations guard (outOfPollenUntilRestart) showed the intent but
// evaporates at every isolate boundary — nothing survived between turns.
//
// Now every attempt's outcome is folded into the providerHealth table by
// providerLog.record, and classifier output here decides how long the seat
// stays skipped. The classes are deliberately coarse:
//
//   auth / balance / model-unavailable  — no retry can fix these; only an
//       admin changing a key, topping up, or the provider re-adding the
//       model can. 6h cooldown: bounded so a fixed seat resumes on its own
//       without a redeploy, long enough to stop the every-turn hammering.
//   daily-quota  — OpenRouter's free-models-per-day 429. Cool until the
//       next UTC midnight (+5 min grace), the conventional quota reset.
//   rate  — a plain 429 burst window. 3 minutes.
//   transient  — overloaded, 5xx, timeouts, hollow 200s ("empty output").
//       90 seconds: bursts pass, a seat mid-incident stops eating every
//       turn's budget, and recovery is noticed fast.
//   unconfigured  — "API key not configured" is LOCAL config, not a
//       provider failure. Cooldown 0: no health row is written at all.

export type ProviderFailureClass =
  | "unconfigured"
  | "auth"
  | "balance"
  | "model-unavailable"
  | "daily-quota"
  | "rate"
  | "transient";

export interface FailureVerdict {
  klass: ProviderFailureClass;
  cooldownMs: number;
}

export const AUTH_COOLDOWN_MS = 6 * 3_600_000;
export const BALANCE_COOLDOWN_MS = 6 * 3_600_000;
export const MODEL_UNAVAILABLE_COOLDOWN_MS = 6 * 3_600_000;
export const RATE_COOLDOWN_MS = 3 * 60_000;
export const TRANSIENT_COOLDOWN_MS = 90_000;
// The daily quota is assumed to reset at UTC midnight; the grace covers
// providers that roll the window a little late.
export const DAILY_QUOTA_GRACE_MS = 5 * 60_000;

export function msUntilNextUtcMidnight(now: number): number {
  const d = new Date(now);
  return (
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1) - now
  );
}

export function classifyProviderFailure(
  error: string | undefined,
  now: number = Date.now(),
): FailureVerdict {
  const msg = (error ?? "").toLowerCase();
  if (msg.includes("not configured") || msg.includes("not_configured")) {
    return { klass: "unconfigured", cooldownMs: 0 };
  }
  // Balance BEFORE the numeric 429 check: "ModelScope 429 (key 2/2):
  // insufficient balance" is an empty account, not a rate window.
  if (
    /\b402\b/.test(msg) ||
    msg.includes("insufficient balance") ||
    msg.includes("no pollen") ||
    msg.includes("payment required")
  ) {
    return { klass: "balance", cooldownMs: BALANCE_COOLDOWN_MS };
  }
  // Daily-quota BEFORE the numeric 429 check: "Rate limit exceeded:
  // free-models-per-day" is dead until tomorrow, not for a minute.
  if (
    msg.includes("per-day") ||
    msg.includes("per day") ||
    msg.includes("daily limit") ||
    msg.includes("daily quota")
  ) {
    return {
      klass: "daily-quota",
      cooldownMs: msUntilNextUtcMidnight(now) + DAILY_QUOTA_GRACE_MS,
    };
  }
  // Model-gone BEFORE auth: a 400/404 "model is unavailable" says the
  // catalog id is dead; the credentials were fine.
  if (
    msg.includes("model is unavailable") ||
    msg.includes("model not found") ||
    msg.includes("does not exist") ||
    msg.includes("no endpoints found") ||
    msg.includes("not a valid model") ||
    msg.includes("unknown model")
  ) {
    return { klass: "model-unavailable", cooldownMs: MODEL_UNAVAILABLE_COOLDOWN_MS };
  }
  // 无权访问 = "no access (to this group)" — the gateway's account can never
  // serve this model; same class as any other credential rejection.
  if (
    /\b401\b/.test(msg) ||
    /\b403\b/.test(msg) ||
    msg.includes("unauthorized") ||
    msg.includes("forbidden") ||
    msg.includes("invalid api key") ||
    msg.includes("无权访问")
  ) {
    return { klass: "auth", cooldownMs: AUTH_COOLDOWN_MS };
  }
  if (
    /\b429\b/.test(msg) ||
    msg.includes("rate limit") ||
    msg.includes("too many requests")
  ) {
    return { klass: "rate", cooldownMs: RATE_COOLDOWN_MS };
  }
  return { klass: "transient", cooldownMs: TRANSIENT_COOLDOWN_MS };
}

// The Provider Log row written when a seat is skipped because of a learned
// cooldown (recorded via providerLog.logOnly — never through record, whose
// health fold would otherwise read this very note and re-stamp the cooldown
// it describes). Kept short enough for the log table's 500-char cap.
export function buildSkipNote(input: {
  klass: string;
  reason: string;
  cooldownUntil: number;
  now?: number;
}): string {
  const now = input.now ?? Date.now();
  const minutesLeft = Math.max(
    1,
    Math.ceil((input.cooldownUntil - now) / 60_000),
  );
  return `SKIPPED — learned ${input.klass} cooldown (${minutesLeft} min left) after: ${input.reason.slice(0, 160)}`;
}
