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

export default crons;
