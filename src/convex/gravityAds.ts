import { action, mutation, query, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";

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
// else. `placement_id` is not validated the same way — it is resolved against
// the placements registered in the dashboard, and a registered id is preferred
// over an unregistered one, so only slots that actually exist there will fill.
//
// Both halves have to match the dashboard, which is why the admin list carries
// `type:id` per line rather than just an id: a slot registered as "Right of
// Page" will not fill a request that declares right_response.
const GRAVITY_PLACEMENTS = new Set([
  "above_response", "below_response", "inline_response", "left_response",
  "right_response", "search_result", "center_page", "top_page", "bottom_page",
  "left_page", "right_page", "group_chat", "search_suggest",
]);

// Where our UI actually puts each slot, used when a line omits the type.
// Slot 0 is the card under the reply; the rest live in the right-hand rail.
const DEFAULT_SLOT_TYPE = (i: number) => (i === 0 ? "below_response" : "right_page");

// "below_response:desktop-response-1" → both halves. A bare id keeps the
// positional default. An unknown type falls back rather than 422ing the whole
// request and taking every other slot down with it.
function parseSlot(line: string | undefined, i: number): { placement: string; placement_id: string } {
  const raw = (line ?? "").trim();
  const at = raw.indexOf(":");
  const type = at > 0 ? raw.slice(0, at).trim() : "";
  const id = at > 0 ? raw.slice(at + 1).trim() : raw;
  return {
    placement: GRAVITY_PLACEMENTS.has(type) ? type : DEFAULT_SLOT_TYPE(i),
    placement_id: id || `desktop-response-${i + 1}`,
  };
}

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
  handler: async (ctx, args): Promise<Record<string, unknown> | Record<string, unknown>[] | null> => {
    // Every miss returns null so chat is never blocked — but each one logs
    // first. Silent nulls made "ads are off" impossible to tell apart from
    // "no fill", which cost a full debugging session once already.
    const config: Doc<"gravityAdsConfig"> | null = await ctx.runQuery(internal.gravityAds.getGravityAdsConfigInternal, {});
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
      } else if (!config.showToFreeUsers) {
        // All accounts are free now (the AgentBucks paid tier was removed).
        console.warn("[ads] gated: free users off");
        return null;
      }
    }

    // Trim conversation context: last 6 messages, 1000 chars each
    const messages = args.messages.slice(-6).map((m) => ({
      role: m.role,
      content: m.content.slice(0, 1000),
    }));
    if (messages.length === 0) { console.warn("[ads] no messages to match on"); return null; }

    const count = Math.max(1, Math.min(6, Math.floor(args.count ?? 1)));

    // Test mode asks Gravity for its own test creative — a real advertiser,
    // real copy, real logo — rather than inventing one. Fabricating a
    // convincing ad for a company that never bought it would put a brand's
    // name in front of users under false pretences, which is not ours to do.
    //
    // Their test path is quota-limited though: a burst of requests starts
    // answering 204 and stays there for a while. So when it gives us nothing
    // we fall back to an obvious placeholder rather than an empty slot, which
    // is what made this look broken before. Real ad when there is one, clearly
    // labelled sample when there is not, and never a fake brand.
    const placeholders = () => {
      const samples = Array.from({ length: count }, (_, i) => ({
        title: `Sample placement ${i + 1} — test ad`,
        brandName: "Test Advertiser",
        adText: "Placeholder shown because Gravity returned no test creative. Real ads appear here once the account is approved.",
        cta: "Learn more",
        url: "https://trygravity.ai",
        clickUrl: "https://trygravity.ai",
        impUrl: undefined,
        favicon: undefined,
      }));
      return count === 1 ? samples[0] : samples;
    };
    if (config.testAdMode && !config.apiKey) return placeholders();

    // Slot 0 is the in-chat card, the rest are rail slots, in the same order as
    // the admin list so dashboard reporting lines up with where the ad rendered.
    const placements = Array.from({ length: count }, (_, i) => parseSlot(config.adUnitIds?.[i], i));

    const body: Record<string, unknown> = {
      messages,
      sessionId: args.sessionId ?? `anon_${Date.now().toString(36)}`,
      placements,
      // The blocklist. Gravity has no category filter on the request beyond
      // this, so it is the only lever we have over what can appear next to a
      // student's homework.
      ...(config.restrictedCategories?.length ? { excludedTopics: config.restrictedCategories } : {}),
      ...(args.device ? { device: args.device } : {}),
      // Gravity's own sample creative, and the only thing that fills while the
      // publisher account is still pending approval.
      ...(config.testAdMode ? { testAd: true } : {}),
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
      // A miss hides the slot in production, but in test mode it falls back to
      // a labelled placeholder — an empty rail is exactly what "the ads are
      // broken" looks like, and test mode exists to prove the opposite.
      const miss = () => (config.testAdMode ? placeholders() : null);

      // 204 is Gravity's no-fill, and it is also what an unapproved account
      // and an exhausted test quota look like — the body is empty either way,
      // so do not read anything into it beyond "nothing to show".
      if (res.status === 204) { console.warn("[ads] gravity: 204 no fill"); return miss(); }
      if (!res.ok) {
        // The body carries the actual reason (unapproved, bad key, bad field).
        const detail = await res.text().catch(() => "");
        console.warn(`[ads] gravity HTTP ${res.status}: ${detail.slice(0, 400)}`);
        return miss();
      }
      const ads = await res.json();
      if (!Array.isArray(ads) || ads.length === 0) {
        console.warn("[ads] gravity returned 200 with no ads");
        return miss();
      }
      // Backwards compatible: count omitted/1 → single ad object; else array.
      // The shipped .exe depends on this shape.
      return count === 1 ? ads[0] : ads.slice(0, count);
    } catch (err) {
      console.warn(`[ads] gravity request threw: ${err instanceof Error ? err.message : String(err)}`);
      return config.testAdMode ? placeholders() : null;
    } finally {
      clearTimeout(timer);
    }
  },
});
