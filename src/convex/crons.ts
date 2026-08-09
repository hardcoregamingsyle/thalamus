import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Reset daily AgentBucks at midnight IST = 18:30 UTC
crons.cron(
  "reset daily agent bucks",
  "30 18 * * *", // 18:30 UTC = 00:00 IST
  internal.dailyReset.resetDailyAgentBucks,
);

// AgentOverflow credits top back up to 10 on the same clock; earned balances
// above 10 are left alone (see agentoverflow.ts).
crons.cron(
  "refill agentoverflow credits",
  "30 18 * * *",
  internal.agentoverflow.dailyRefillAoCredits,
);

// Push the active API-key snapshot to the corpus VM so it can authorize search
// locally. Every 2 min keeps a freshly issued key working within the interval
// and a revocation propagating just as fast, while the search path itself
// never calls Convex.
crons.interval(
  "sync agentoverflow keys to vm",
  { minutes: 2 },
  internal.agentoverflow.syncKeysToVm,
);

// Watchdog for stalled Code-mode pipelines. Convex hard-kills a
// runPipelineAction at its 600s action limit with an error no in-code
// try/catch can observe, which leaves the branch stuck at status "running"
// with nothing scheduled to resume it — the UI shows "thinking" forever
// with no work happening. This sweep reschedules the pipeline for any
// branch that has been running longer than the stale threshold without
// being legitimately parked on a command or an API-key request. See
// codeBranches.sweepStalledBranches for STALE_MS, MAX_REVIVES and the
// terminal-give-up rule.
crons.interval(
  "sweep stalled code branches",
  { minutes: 5 },
  internal.codeBranches.sweepStalledBranches,
);

// Different stall class than the sweep above: a branch correctly "paused" on
// a command whose result never arrives (dead VM worker, crashed runner). See
// codeBranches.sweepPausedBranches for why this can't just be folded into the
// "running" sweep above and why a fresh user retry alone doesn't reliably
// unstick it.
crons.interval(
  "sweep paused code branches",
  { minutes: 5 },
  internal.codeBranches.sweepPausedBranches,
);

export default crons;
