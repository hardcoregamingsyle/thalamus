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
    // Gravity placement ids, in slot order: [0] is the in-chat card, the rest
    // are rail slots. Blank falls back to desktop-response-N.
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

// The pixel's id, and nothing else. Deliberately public and independent of the
// ads master switch: Gravity gates ad serving on publisher approval, and their
// dashboard only reports an account active once the pixel has sent events, so
// gating the pixel on `isEnabled` would park approval behind the one thing
// approval unlocks.
export const getPixelId = query({
  args: {},
  handler: async (ctx) => {
    const config = await ctx.db.query("gravityAdsConfig").first();
    return config?.pixelId ?? null;
  },
});

// Internal: full config including the API key, for server-side ad requests.
export const getGravityAdsConfigInternal = internalQuery({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("gravityAdsConfig").first();
  },
});

// ── Account status probe ──────────────────────────────────────────────────────
// Gravity's portal shows no approval state and the API has no account endpoint
// — /api/v1/account, /publisher, /me, /status and /openapi.json all 404, and
// /health reports their server rather than us. The only signal that exists is
// how a real ad request answers, so this asks for one and classifies the reply.
// Deliberately omits testAd: test mode answers 200 for an unapproved account,
// which is precisely the question being asked.

export const checkGravityStatus = action({
  args: { adminToken: v.string(), apiKey: v.string() },
  handler: async (_ctx, args): Promise<{ state: string; http: number; detail: string }> => {
    requireAdmin(args.adminToken);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const res = await fetch(GRAVITY_AD_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${args.apiKey}` },
        body: JSON.stringify({
          messages: [{ role: "user", content: "status probe" }],
          sessionId: `status_${Date.now().toString(36)}`,
          placements: [{ placement: "below_response", placement_id: "status-probe" }],
        }),
        signal: controller.signal,
      });
      const detail = (await res.text().catch(() => "")).slice(0, 400);
      if (res.status === 200) return { state: "serving", http: 200, detail };
      if (res.status === 204) return { state: "approved_no_fill", http: 204, detail };
      if (res.status === 401) return { state: "bad_key", http: 401, detail };
      if (res.status === 403 && detail.includes("publisher_not_approved")) {
        return { state: "pending_approval", http: 403, detail };
      }
      return { state: "unexpected", http: res.status, detail };
    } catch (err) {
      return { state: "unreachable", http: 0, detail: err instanceof Error ? err.message : String(err) };
    } finally {
      clearTimeout(timer);
    }
  },
});

// ── Ad request proxy (Gravity) ────────────────────────────────────────────────
// POST https://server.trygravity.ai/api/v1/ad, Authorization: Bearer <key>.
// The key stays server-side; the client only ever sees the returned ad objects,
// which Gravity already hands back in the exact shape both renderers speak.

const GRAVITY_AD_URL = "https://server.trygravity.ai/api/v1/ad";

// Gravity validates `placement` against a fixed vocabulary and 422s on anything
// else, so these two are not free-form: the in-chat card sits under the reply,
// rail cards sit to the right. `placement_id` is not validated the same way —
// it is resolved against the placements registered in the dashboard, and a
// registered id is preferred over an unregistered one, so only slots you have
// actually created will fill.
const SLOT_IN_CHAT = "below_response";
const SLOT_RAIL = "right_response";

export const requestAd = action({
  args: {
    token: v.optional(v.string()),
    messages: v.array(v.object({ role: v.string(), content: v.string() })),
    sessionId: v.optional(v.string()),
    // How many ads the client can display (1 in-chat + N rail slots on wide
    // screens). Server-clamped to 6, which is Gravity's own per-request cap.
    count: v.optional(v.number()),
    // Real end-user device signals. Gravity uses these — not our server's
    // source IP — for geo targeting and bot filtering, so the /ad HTTP route
    // fills them from the browser's own request headers.
    device: v.optional(v.object({
      ua: v.optional(v.string()),
      ip: v.optional(v.string()),
      country: v.optional(v.string()),
    })),
  },
  handler: async (ctx, args) => {
    // Every miss returns null so chat is never blocked — but each one logs
    // first. Silent nulls made "ads are off" impossible to tell apart from
    // "no fill", which cost a full debugging session once already.
    const config = await ctx.runQuery(internal.gravityAds.getGravityAdsConfigInternal, {});
    if (!config) { console.warn("[ads] no config row — save one in /admin"); return null; }
    if (!config.isEnabled) { console.warn("[ads] master switch is off"); return null; }
    // Test mode never calls Gravity, so it does not need a key.
    if (!config.testAdMode && !config.apiKey) { console.warn("[ads] no api key stored"); return null; }

    // Audience gating: guests vs free vs paid users
    if (!args.token) {
      if (!config.showToGuests) { console.warn("[ads] gated: guests off"); return null; }
    } else {
      const user = await ctx.runQuery(internal.customAuthHelpers.getUserByTokenInternal, { token: args.token });
      if (!user) {
        // Invalid/expired token — treat as guest
        if (!config.showToGuests) { console.warn("[ads] gated: guests off (bad token)"); return null; }
      } else {
        // "Paid" signal: user has purchased AgentBucks at least once
        const isPaid = (user.purchasedAgentBucks ?? 0) > 0;
        if (isPaid ? !config.showToPaidUsers : !config.showToFreeUsers) {
          console.warn(`[ads] gated: ${isPaid ? "paid" : "free"} users off`);
          return null;
        }
      }
    }

    // Trim conversation context: last 6 messages, 1000 chars each
    const messages = args.messages.slice(-6).map((m) => ({
      role: m.role,
      content: m.content.slice(0, 1000),
    }));
    if (messages.length === 0) { console.warn("[ads] no messages to match on"); return null; }

    const count = Math.max(1, Math.min(6, Math.floor(args.count ?? 1)));

    // Test mode: local placeholders, never a Gravity call.
    //
    // Gravity's own testAd=true is not used here on purpose. It returns a real
    // advertiser's creative with a live referral link, fills exactly one slot
    // no matter how many you ask for, and is quota-limited — a burst of test
    // requests starts answering 204 and stays there. None of that is any use
    // for checking that six slots lay out correctly on a 4K screen. These are
    // deterministic, fill every slot, cost nothing, and say "sample" in every
    // field so they can never be mistaken for sold inventory. Gravity's own
    // test path is exercised by checkGravityStatus instead, which is where
    // integration checks belong.
    if (config.testAdMode) {
      const samples = Array.from({ length: count }, (_, i) => ({
        title: `Sample placement ${i + 1} — test ad`,
        brandName: "Test Advertiser",
        adText: "Placeholder used to verify ad slots render. Real ads appear here once Gravity approves the account.",
        cta: "Learn more",
        url: "https://trygravity.ai",
        clickUrl: "https://trygravity.ai",
        impUrl: undefined,
        favicon: undefined,
      }));
      return count === 1 ? samples[0] : samples;
    }

    // Slot 0 is the in-chat card, the rest are rail slots. Ids come from the
    // admin list in the same order so dashboard reporting lines up with where
    // the ad actually rendered.
    const placements = Array.from({ length: count }, (_, i) => ({
      placement: i === 0 ? SLOT_IN_CHAT : SLOT_RAIL,
      placement_id: config.adUnitIds?.[i]?.trim() || `desktop-response-${i + 1}`,
    }));

    const body: Record<string, unknown> = {
      messages,
      sessionId: args.sessionId ?? `anon_${Date.now().toString(36)}`,
      placements,
      // The blocklist. Gravity has no category filter on the request beyond
      // this, so it is the only lever we have over what can appear next to a
      // student's homework.
      ...(config.restrictedCategories?.length ? { excludedTopics: config.restrictedCategories } : {}),
      ...(args.device ? { device: args.device } : {}),
    };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
      const res = await fetch(GRAVITY_AD_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      // 204 is Gravity's no-fill, and it is also what an unapproved account
      // and an exhausted quota look like — the body is empty either way, so
      // do not read anything into it beyond "hide the slot".
      if (res.status === 204) { console.warn("[ads] gravity: 204 no fill"); return null; }
      if (!res.ok) {
        // The body carries the actual reason (unapproved, bad key, bad field).
        const detail = await res.text().catch(() => "");
        console.warn(`[ads] gravity HTTP ${res.status}: ${detail.slice(0, 400)}`);
        return null;
      }
      const ads = await res.json();
      if (!Array.isArray(ads) || ads.length === 0) {
        console.warn("[ads] gravity returned 200 with no ads");
        return null;
      }
      // Backwards compatible: count omitted/1 → single ad object; else array.
      // The shipped .exe depends on this shape.
      return count === 1 ? ads[0] : ads.slice(0, count);
    } catch (err) {
      console.warn(`[ads] gravity request threw: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    } finally {
      clearTimeout(timer);
    }
  },
});
