/* eslint-disable @typescript-eslint/ban-ts-comment -- Convex generated api types are self-referential here and exceed TS instantiation depth (TS2589); checked builds require this suppression. */
// @ts-nocheck
import { action, mutation, query, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";

// ── Admin mutations ───────────────────────────────────────────────────────────

const ADMIN_TOKEN = process.env.ADMIN_TOKEN ?? "";

function requireAdmin(token: string) {
  if (!ADMIN_TOKEN || token !== ADMIN_TOKEN) throw new Error("Unauthorized");
}

export const saveGravityAdsConfig = mutation({
  args: {
    adminToken: v.string(),
    apiKey: v.string(),
    publisherId: v.optional(v.string()),
    adUnitIds: v.optional(v.array(v.string())),
    isEnabled: v.boolean(),
    showToGuests: v.boolean(),
    showToFreeUsers: v.boolean(),
    showToPaidUsers: v.boolean(),
    restrictedCategories: v.optional(v.array(v.string())),
    testAdMode: v.optional(v.boolean()),
    pixelId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    requireAdmin(args.adminToken);
    const existing = await ctx.db.query("gravityAdsConfig").first();
    const data = {
      apiKey: args.apiKey,
      publisherId: args.publisherId,
      adUnitIds: args.adUnitIds,
      isEnabled: args.isEnabled,
      showToGuests: args.showToGuests,
      showToFreeUsers: args.showToFreeUsers,
      showToPaidUsers: args.showToPaidUsers,
      restrictedCategories: args.restrictedCategories,
      testAdMode: args.testAdMode ?? false,
      pixelId: args.pixelId,
      updatedAt: Date.now(),
      updatedBy: "admin",
    };
    if (existing) {
      await ctx.db.patch(existing._id, data);
    } else {
      await ctx.db.insert("gravityAdsConfig", data);
    }
  },
});

export const getGravityAdsConfig = query({
  args: { adminToken: v.string() },
  handler: async (ctx, args) => {
    requireAdmin(args.adminToken);
    return await ctx.db.query("gravityAdsConfig").first();
  },
});

// ── Public config for clients (no admin token, only safe fields) ──────────────

export const getPublicAdsConfig = query({
  args: {},
  handler: async (ctx) => {
    const config = await ctx.db.query("gravityAdsConfig").first();
    if (!config || !config.isEnabled) return null;
    // Never expose the API key to the client — only what's needed for display logic
    return {
      isEnabled: config.isEnabled,
      showToGuests: config.showToGuests,
      showToFreeUsers: config.showToFreeUsers,
      showToPaidUsers: config.showToPaidUsers,
      publisherId: config.publisherId,
      adUnitIds: config.adUnitIds,
      restrictedCategories: config.restrictedCategories,
      pixelId: config.pixelId,
      // API key is server-side only — ad requests are proxied through our backend
    };
  },
});

// Internal: get full config including API key (for server-side ad requests)
export const getGravityAdsConfigInternal = internalQuery({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("gravityAdsConfig").first();
  },
});

// ── Ad request proxy (Gravity REST API) ───────────────────────────────────────
// POST https://server.trygravity.ai/api/v1/ad — docs.trygravity.ai/engine/contextual-ads
// The API key stays server-side; the client only ever sees the returned ad object.

export const requestAd = action({
  args: {
    token: v.optional(v.string()),
    messages: v.array(v.object({ role: v.string(), content: v.string() })),
    sessionId: v.optional(v.string()),
    // How many ads the client can display (1 in-chat + N right-rail slots on
    // wide screens). Server-clamped to 6.
    count: v.optional(v.number()),
    // Real end-user device signals. Gravity uses these (not our server's source
    // IP) for geo/targeting and bot-filtering in server-side fetching, so the
    // /ad HTTP route fills them from the browser's own request headers.
    device: v.optional(v.object({
      ua: v.optional(v.string()),
      ip: v.optional(v.string()),
      country: v.optional(v.string()),
    })),
  },
  handler: async (ctx, args) => {
    const config = await ctx.runQuery(internal.gravityAds.getGravityAdsConfigInternal, {});
    if (!config?.isEnabled || !config.apiKey) return null;

    // Audience gating: guests vs free vs paid users
    if (!args.token) {
      if (!config.showToGuests) return null;
    } else {
      const user = await ctx.runQuery(internal.customAuthHelpers.getUserByTokenInternal, { token: args.token });
      if (!user) {
        // Invalid/expired token — treat as guest
        if (!config.showToGuests) return null;
      } else {
        // "Paid" signal: user has purchased AgentBucks at least once
        const isPaid = (user.purchasedAgentBucks ?? 0) > 0;
        if (isPaid ? !config.showToPaidUsers : !config.showToFreeUsers) return null;
      }
    }

    // Trim conversation context: last 6 messages, 1000 chars each
    const messages = args.messages.slice(-6).map((m) => ({
      role: m.role,
      content: m.content.slice(0, 1000),
    }));
    if (messages.length === 0) return null;

    const count = Math.max(1, Math.min(6, Math.floor(args.count ?? 1)));

    // AdMesh matches on a natural-language query, not a placement vocabulary —
    // so the conversation gets flattened into one. The last user turn carries
    // the intent; a little assistant context sharpens it.
    const lastUser = [...messages].reverse().find((m) => m.role === "user")?.content ?? "";
    const query = (lastUser || messages[messages.length - 1].content).slice(0, 1000);

    const body: Record<string, unknown> = {
      query,
      format: "auto",
      ...(config.restrictedCategories?.length ? { exclude_categories: config.restrictedCategories } : {}),
      ...(args.device ? { device: args.device } : {}),
    };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    try {
      const res = await fetch("https://api.useadmesh.com/recommend", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      // 204 = no matching ad; anything non-OK = hide the slot. Ads must never break chat.
      if (res.status === 204 || !res.ok) return null;
      const data = await res.json();
      const recs = data?.response?.recommendations ?? data?.recommendations;
      if (!Array.isArray(recs) || recs.length === 0) return null;
      const ads = recs.slice(0, count).map(normalizeAd).filter(Boolean);
      if (ads.length === 0) return null;
      // Backwards compatible: count omitted/1 → single ad object; else array.
      return count === 1 ? ads[0] : ads;
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  },
});

// Map one AdMesh recommendation onto the card shape both renderers already
// speak — web (Portal SponsoredAdCard) and desktop (SponsoredAdCard.xaml.cs).
// Keeping the output shape identical is what makes the provider swap surgical:
// neither renderer, the /ad route, nor requestAd.ts changes at all.
//
// title / reason / admesh_link are the fields AdMesh's own SDK documents. The
// rest aren't in the public docs, so they're read defensively across the
// plausible spellings and simply omitted when absent — both renderers already
// guard every optional field, so a missing one degrades instead of breaking.
function normalizeAd(rec: Record<string, unknown> | null): Record<string, unknown> | null {
  if (!rec || typeof rec !== "object") return null;
  const pick = (...keys: string[]): string | undefined => {
    for (const k of keys) {
      const v = rec[k];
      if (typeof v === "string" && v.trim()) return v;
    }
    return undefined;
  };

  const link = pick("admesh_link", "url", "redirect_url", "link");
  const title = pick("title", "product_name", "name");
  if (!link || !title) return null; // nothing clickable or nothing to show

  return {
    title,
    brandName: pick("brand_name", "brand", "advertiser", "company"),
    adText: pick("reason", "description", "adText", "summary"),
    cta: pick("cta", "call_to_action", "cta_text") ?? "Learn more",
    url: link,
    clickUrl: link,
    // AdMesh tracks exposure through its own link; only set impUrl if it ever
    // hands us a real pixel, otherwise the renderers skip the impression fetch.
    impUrl: pick("impression_url", "impUrl", "tracking_url"),
    favicon: pick("image_url", "favicon", "logo_url", "icon"),
  };
}
