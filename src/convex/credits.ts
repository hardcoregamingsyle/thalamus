// AgentBucks deduction. This lived in sandboxHelpers.ts back when it shared a
// file with the Daytona plumbing; that plumbing is gone and the name was only
// ever misleading. Purchased credits drain first, closest expiry first, then
// the daily allowance.
import { internalMutation } from "./_generated/server";
import { v } from "convex/values";
// Free+unlimited switch lives in agentCore (the one pure module every runtime
// can import). While true, this is a no-op.
import { FREE_UNLIMITED } from "./lib/agentCore";

export const deductAgentBucks = internalMutation({
  args: {
    userId: v.id("users"),
    agentBucksToDeduct: v.number(),
  },
  handler: async (ctx, args) => {
    if (FREE_UNLIMITED) return; // platform is free — no per-call AgentBucks charge
    const user = await ctx.db.get(args.userId);
    if (!user) return;
    const now = Date.now();
    let remaining = args.agentBucksToDeduct;

    // Deduct from batches (closest expiry first)
    const batches = await ctx.db
      .query("creditBatches")
      .withIndex("by_user_and_expiry", (q) => q.eq("userId", args.userId))
      .order("asc")
      .take(200);

    const expiredBatches = batches.filter(b => b.expiresAt <= now);
    for (const b of expiredBatches) await ctx.db.delete(b._id);

    const activeBatches = batches.filter(b => b.expiresAt > now && b.remaining > 0);
    for (const batch of activeBatches) {
      if (remaining <= 0) break;
      const deduct = Math.min(batch.remaining, remaining);
      await ctx.db.patch(batch._id, { remaining: batch.remaining - deduct });
      remaining -= deduct;
    }

    // Remaining from daily
    const daily = (user as { dailyAgentBucks?: number }).dailyAgentBucks ?? 0;
    const newDaily = Math.max(0, daily - remaining);

    // Recalculate total purchased
    const updatedBatches = await ctx.db
      .query("creditBatches")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .take(200);
    const totalPurchased = updatedBatches
      .filter(b => b.expiresAt > now)
      .reduce((sum, b) => sum + b.remaining, 0);

    await ctx.db.patch(args.userId, {
      dailyAgentBucks: newDaily,
      purchasedAgentBucks: totalPurchased,
    });
  },
});
