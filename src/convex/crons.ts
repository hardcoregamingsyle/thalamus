import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Reset daily AgentBucks at midnight IST = 18:30 UTC
crons.cron(
  "reset daily agent bucks",
  "30 18 * * *", // 18:30 UTC = 00:00 IST
  internal.dailyReset.resetDailyAgentBucks,
);

export default crons;
