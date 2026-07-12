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

    const body = {
      messages,
      sessionId: args.sessionId ?? `anon_${Date.now().toString(36)}`,
      placements: [{ placement: "below_response", placement_id: config.adUnitIds?.[0] ?? "main" }],
      ...(config.restrictedCategories?.length ? { excludedTopics: config.restrictedCategories } : {}),
    };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    try {
      const res = await fetch("https://server.trygravity.ai/api/v1/ad", {
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
      const ads = await res.json();
      if (!Array.isArray(ads) || ads.length === 0) return null;
      return ads[0];
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  },
});
