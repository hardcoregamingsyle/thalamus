import { internalMutation } from "./_generated/server";
import { Doc } from "./_generated/dataModel";

// Reset dailyAgentBucks to 10,000,000 for all users at midnight IST
export const resetDailyAgentBucks = internalMutation({
  args: {},
  handler: async (ctx) => {
    let cursor: string | null = null;
    let processed = 0;

    while (true) {
      const batch: { page: Doc<"users">[]; isDone: boolean; continueCursor: string } = await ctx.db
        .query("users")
        .order("asc")
        .paginate({ cursor, numItems: 100 });

      await Promise.all(
        batch.page.map((user: Doc<"users">) =>
          ctx.db.patch(user._id, { dailyAgentBucks: 10_000_000 })
        )
      );

      processed += batch.page.length;
      if (batch.isDone) break;
      cursor = batch.continueCursor;
    }

    console.log(`[DailyReset] Reset dailyAgentBucks for ${processed} users`);
  },
});