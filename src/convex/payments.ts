import { internalMutation } from "./_generated/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";

// $1 = 1.5M AgentBucks, and the platform pegs ₹100 = $1 — so 1 rupee = 1 USD
// cent = 15,000 AB. Must match the packs shown in CreditModal.tsx. Crediting
// is amount-based, so any amount paid credits proportionally.
const AB_PER_CENT = 15_000;

// The single write path for crediting a sale (Buy Me a Coffee webhook — see
// /bmac/webhook in http.ts). Idempotent on saleId:
// - new sale + email matches an account → credit + "credited" row
// - new sale + unknown buyer email      → "unclaimed" row (recoverable later)
// - existing "credited"                 → no-op (replay attempt)
export const recordPayment = internalMutation({
  args: {
    saleId: v.string(),
    email: v.string(),
    priceCents: v.number(),
    userId: v.optional(v.id("users")),
    provider: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<{ credited: boolean; bucks: number; alreadyProcessed: boolean }> => {
    const bucks = Math.max(0, Math.floor(args.priceCents * AB_PER_CENT));

    const existing = await ctx.db
      .query("payments")
      .withIndex("by_sale_id", (q) => q.eq("saleId", args.saleId))
      .first();

    if (existing) {
      if (existing.status === "credited") return { credited: false, bucks: existing.bucksCredited, alreadyProcessed: true };
      // Unclaimed row being resolved to a known user
      if (args.userId) {
        const user = await ctx.db.get(args.userId);
        if (user) {
          await ctx.db.patch(args.userId, {
            purchasedAgentBucks: ((user as { purchasedAgentBucks?: number }).purchasedAgentBucks ?? 0) + existing.bucksCredited,
          });
          await ctx.db.patch(existing._id, { userId: args.userId, status: "credited", claimedAt: Date.now() });
          return { credited: true, bucks: existing.bucksCredited, alreadyProcessed: false };
        }
      }
      return { credited: false, bucks: existing.bucksCredited, alreadyProcessed: false };
    }

    // Resolve the buyer: explicit userId wins, then account email matching the
    // buyer email — which is why the UI insists on the exact account email.
    let userId: Id<"users"> | undefined = args.userId;
    if (!userId && args.email) {
      const byEmail = await ctx.db
        .query("users")
        .withIndex("email", (q) => q.eq("email", args.email))
        .take(1);
      if (byEmail.length > 0) userId = byEmail[0]._id;
    }

    let credited = false;
    if (userId) {
      const user = await ctx.db.get(userId);
      if (user) {
        await ctx.db.patch(userId, {
          purchasedAgentBucks: ((user as { purchasedAgentBucks?: number }).purchasedAgentBucks ?? 0) + bucks,
        });
        credited = true;
      }
    }

    await ctx.db.insert("payments", {
      provider: args.provider ?? "buymeacoffee",
      saleId: args.saleId,
      email: args.email,
      userId: credited ? userId : undefined,
      priceCents: args.priceCents,
      bucksCredited: bucks,
      status: credited ? "credited" : "unclaimed",
      createdAt: Date.now(),
      ...(credited ? { claimedAt: Date.now() } : {}),
    });
    return { credited, bucks, alreadyProcessed: false };
  },
});
