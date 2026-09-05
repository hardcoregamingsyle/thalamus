import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

// Google Analytics 4 + Tag Manager IDs, stored server-side rather than baked in
// at build time. Same reasoning as the Gravity pixel next door: the IDs are not
// secret, but they change independently of the code, and both frontends
// (thalamus and the AgentOverflow site) read the same row — so a rebuild and a
// redeploy of two Cloudflare projects is the wrong cost for changing a string.

const ADMIN_TOKEN = process.env.ADMIN_TOKEN ?? "";

function requireAdmin(token: string) {
  if (!ADMIN_TOKEN || token !== ADMIN_TOKEN) throw new Error("Unauthorized");
}

// GTM-XXXXXXX / G-XXXXXXXXXX. Validated on write so a typo fails at the admin
// panel rather than silently never firing a tag.
const GTM_RE = /^GTM-[A-Z0-9]{4,10}$/;
const GA4_RE = /^G-[A-Z0-9]{6,12}$/;

/**
 * Public: the IDs the browser needs. Returns nulls when unset, which is what
 * keeps the tags off entirely until someone configures them.
 *
 * `site` lets the two products carry different properties on one backend.
 */
export const getAnalyticsConfig = query({
  args: { site: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const site = args.site ?? "thalamus";
    const row = await ctx.db
      .query("analyticsConfig")
      .withIndex("by_site", (q) => q.eq("site", site))
      .first();
    return {
      ga4Id: row?.ga4Id ?? null,
      gtmId: row?.gtmId ?? null,
    };
  },
});

export const getAnalyticsConfigAdmin = query({
  args: { adminToken: v.string() },
  handler: async (ctx, args) => {
    requireAdmin(args.adminToken);
    return await ctx.db.query("analyticsConfig").collect();
  },
});

export const saveAnalyticsConfig = mutation({
  args: {
    adminToken: v.string(),
    site: v.string(),
    ga4Id: v.optional(v.string()),
    gtmId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    requireAdmin(args.adminToken);

    // Empty string is how the admin form clears a field; treat it as unset
    // rather than storing a value no tag can use.
    const ga4Id = args.ga4Id?.trim() || undefined;
    const gtmId = args.gtmId?.trim() || undefined;
    if (ga4Id && !GA4_RE.test(ga4Id)) {
      throw new Error(`Not a GA4 measurement ID: ${ga4Id} (expected G-XXXXXXXXXX)`);
    }
    if (gtmId && !GTM_RE.test(gtmId)) {
      throw new Error(`Not a GTM container ID: ${gtmId} (expected GTM-XXXXXXX)`);
    }

    const existing = await ctx.db
      .query("analyticsConfig")
      .withIndex("by_site", (q) => q.eq("site", args.site))
      .first();
    const patch = { site: args.site, ga4Id, gtmId, updatedAt: Date.now() };
    if (existing) await ctx.db.patch(existing._id, patch);
    else await ctx.db.insert("analyticsConfig", patch);
    return { ok: true };
  },
});
