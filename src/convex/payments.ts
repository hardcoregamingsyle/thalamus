import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";

// Default rate: $1 = 1.5M AgentBucks, and the platform pegs ₹100 = $1 — so
// 1 rupee = 1 USD cent = 15,000 AB. Overridable from the admin Payments tab.
const DEFAULT_AB_PER_CENT = 15_000;

// ── Admin-managed config (singleton row; payments ship disabled) ─────────────

const ADMIN_TOKEN = process.env.ADMIN_TOKEN ?? "";
function requireAdmin(token: string) {
  if (!ADMIN_TOKEN || token !== ADMIN_TOKEN) throw new Error("Unauthorized");
}

export const savePaymentsConfig = mutation({
  args: {
    adminToken: v.string(),
    isEnabled: v.boolean(),
    bmacPageUrl: v.string(),
    webhookSecret: v.optional(v.string()),
    abPerCent: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    requireAdmin(args.adminToken);
    const existing = await ctx.db.query("paymentsConfig").first();
    const data = {
      isEnabled: args.isEnabled,
      bmacPageUrl: args.bmacPageUrl.trim(),
      webhookSecret: args.webhookSecret?.trim() || undefined,
      abPerCent: args.abPerCent,
      updatedAt: Date.now(),
      updatedBy: "admin",
    };
    if (existing) await ctx.db.patch(existing._id, data);
    else await ctx.db.insert("paymentsConfig", data);
  },
});

export const getPaymentsConfig = query({
  args: { adminToken: v.string() },
  handler: async (ctx, args) => {
    requireAdmin(args.adminToken);
    return await ctx.db.query("paymentsConfig").first();
  },
});

export const getPaymentsConfigInternal = internalQuery({
  args: {},
  handler: async (ctx) => await ctx.db.query("paymentsConfig").first(),
});

// What the buy modal needs — never the webhook secret.
export const getPublicPaymentsConfig = query({
  args: {},
  handler: async (ctx) => {
    const config = await ctx.db.query("paymentsConfig").first();
    if (!config || !config.isEnabled) return { isEnabled: false as const, bmacPageUrl: "" };
    return { isEnabled: true as const, bmacPageUrl: config.bmacPageUrl };
  },
});

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
    const config = await ctx.db.query("paymentsConfig").first();
    const rate = config?.abPerCent ?? DEFAULT_AB_PER_CENT;
    const bucks = Math.max(0, Math.floor(args.priceCents * rate));

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
