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

export default crons;
