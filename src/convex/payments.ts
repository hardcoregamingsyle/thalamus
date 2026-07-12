import { internalMutation, action } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";

// $1 = 1.5M AgentBucks — must match the packs shown in CreditModal.tsx.
// Credit is computed from the actual amount paid, so pay-what-you-want and
// any future pack sizes work without code changes.
const AB_PER_CENT = 15_000;

// Server-to-Gumroad license verification. This is the trust anchor: we never
// credit anything based on a webhook alone — the license key is verified
// directly with Gumroad, which also tells us about refunds and chargebacks.
export async function verifyGumroadLicense(licenseKey: string, incrementUses: boolean): Promise<{
  ok: boolean;
  error?: string;
  saleId?: string;
  email?: string;
  priceCents?: number;
}> {
  const productId = process.env.GUMROAD_PRODUCT_ID;
  if (!productId) return { ok: false, error: "Payments are not configured (GUMROAD_PRODUCT_ID missing)" };

  const res = await fetch("https://api.gumroad.com/v2/licenses/verify", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      product_id: productId,
      license_key: licenseKey,
      increment_uses_count: incrementUses ? "true" : "false",
    }),
  });
  const data = await res.json().catch(() => null) as {
    success?: boolean;
    message?: string;
    purchase?: {
      sale_id?: string;
      email?: string;
      price?: number; // cents
      refunded?: boolean;
      chargebacked?: boolean;
      disputed?: boolean;
    };
  } | null;

  if (!data?.success || !data.purchase?.sale_id) {
    return { ok: false, error: data?.message || "That license key is not valid for this product" };
  }
  const p = data.purchase;
  if (p.refunded || p.chargebacked || p.disputed) {
    return { ok: false, error: "This purchase was refunded or disputed" };
  }
  return { ok: true, saleId: p.sale_id, email: (p.email ?? "").toLowerCase().trim(), priceCents: p.price ?? 0 };
}

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

// The single write path for crediting a sale. Idempotent on saleId:
// - new sale + resolvable user  → credit + "credited" row
// - new sale + unknown buyer    → "unclaimed" row (license claim resolves it)
// - existing "unclaimed" + user → credit now, mark claimed
// - existing "credited"         → no-op (replay attempt)
export const recordPayment = internalMutation({
  args: {
    saleId: v.string(),
    licenseKeyHash: v.optional(v.string()),
    email: v.string(),
    priceCents: v.number(),
    userId: v.optional(v.id("users")),
  },
  handler: async (ctx, args): Promise<{ credited: boolean; bucks: number; alreadyProcessed: boolean }> => {
    const bucks = Math.max(0, Math.floor(args.priceCents * AB_PER_CENT));

    const existing = await ctx.db
      .query("payments")
      .withIndex("by_sale_id", (q) => q.eq("saleId", args.saleId))
      .first();

    if (existing) {
      if (existing.status === "credited") return { credited: false, bucks: existing.bucksCredited, alreadyProcessed: true };
      // Unclaimed row being claimed now
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

    // Resolve the buyer: explicit userId (claim flow / uid url param) wins,
    // then account email matching the buyer email.
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
      provider: "gumroad",
      saleId: args.saleId,
      licenseKeyHash: args.licenseKeyHash,
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

// Manual claim: the signed-in user pastes the license key from their Gumroad
// receipt. Covers every webhook-miss and paid-with-a-different-email case.
export const claimLicense = action({
  args: { token: v.string(), licenseKey: v.string() },
  handler: async (ctx, args): Promise<{ success: boolean; message: string; bucks?: number }> => {
    const user = await ctx.runQuery(internal.customAuthHelpers.getUserByTokenInternal, { token: args.token });
    if (!user) return { success: false, message: "Sign in first, then claim your purchase." };

    const key = args.licenseKey.trim();
    if (key.length < 8) return { success: false, message: "That doesn't look like a license key." };

    const verified = await verifyGumroadLicense(key, true);
    if (!verified.ok || !verified.saleId) return { success: false, message: verified.error ?? "Verification failed" };

    const result = await ctx.runMutation(internal.payments.recordPayment, {
      saleId: verified.saleId,
      licenseKeyHash: await sha256Hex(key),
      email: verified.email ?? "",
      priceCents: verified.priceCents ?? 0,
      userId: user._id,
    });

    if (result.alreadyProcessed) return { success: false, message: "This purchase has already been credited." };
    if (!result.credited) return { success: false, message: "Could not credit this purchase — contact support." };
    return { success: true, message: `${(result.bucks / 1_000_000).toFixed(1)}M AgentBucks added!`, bucks: result.bucks };
  },
});
