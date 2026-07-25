/* eslint-disable @typescript-eslint/ban-ts-comment -- Convex generated api types are self-referential here and exceed TS instantiation depth (TS2589); checked builds require this suppression. */
// @ts-nocheck
import { action, mutation, query, internalQuery, internalMutation } from "./_generated/server";
import type { ActionCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
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

// ── AdMesh session handling ───────────────────────────────────────────────────
// /agent/recommend rejects a request with no session_id (400), and sessions are
// issued by POST /agent/session/new. That endpoint takes no body and is authed
// by our publisher key, so the session belongs to us, not to an end user — one
// is cached in the config row and shared until it nears expiry.

// Refresh this far ahead of expiry so a session can't lapse mid-request.
const AD_SESSION_MARGIN_MS = 60_000;

export const saveAdSessionInternal = internalMutation({
  args: { sessionId: v.string(), expiresAt: v.number() },
  handler: async (ctx, args) => {
    const existing = await ctx.db.query("gravityAdsConfig").first();
    if (!existing) return;
    await ctx.db.patch(existing._id, {
      adSessionId: args.sessionId,
      adSessionExpiresAt: args.expiresAt,
    });
  },
});

async function mintAdSession(ctx: ActionCtx, apiKey: string, signal: AbortSignal): Promise<string | null> {
  const res = await fetch("https://api.useadmesh.com/agent/session/new", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: "{}",
    signal,
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    console.warn(`[ads] session/new HTTP ${res.status}: ${detail.slice(0, 300)}`);
    return null;
  }
  const data = await res.json();
  const sessionId = data?.session_id;
  if (typeof sessionId !== "string" || !sessionId) {
    console.warn(`[ads] session/new gave no session_id; keys=${Object.keys(data ?? {}).join(",")}`);
    return null;
  }
  // Fall back to 30 min if they stop sending a ttl; the 400-retry covers us.
  const ttlMs = (Number(data?.ttl_seconds) || 1800) * 1000;
  await ctx.runMutation(internal.gravityAds.saveAdSessionInternal, {
    sessionId,
    expiresAt: Date.now() + ttlMs,
  });
  return sessionId;
}

async function ensureAdSession(ctx: ActionCtx, config: Doc<"gravityAdsConfig">, signal: AbortSignal): Promise<string | null> {
  const fresh = config.adSessionId && (config.adSessionExpiresAt ?? 0) > Date.now() + AD_SESSION_MARGIN_MS;
  if (fresh) return config.adSessionId;
  return await mintAdSession(ctx, config.apiKey, signal);
}

// ── Ad request proxy (AdMesh REST API) ────────────────────────────────────────
// POST https://api.useadmesh.com/agent/recommend, Authorization: Bearer <key>.
// Path and request schema taken from https://api.useadmesh.com/openapi.json —
// there is no bare /recommend route, it 404s. The API key stays server-side;
// the client only ever sees the returned ad object.

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
    // Every miss below returns null so chat is never blocked — but each one logs
    // first. Silent nulls made "no ads" impossible to tell apart from "no fill".
    const config = await ctx.runQuery(internal.gravityAds.getGravityAdsConfigInternal, {});
    if (!config) { console.warn("[ads] no config row — save one in /admin"); return null; }
    if (!config.isEnabled) { console.warn("[ads] master switch is off"); return null; }
    // Test mode never calls AdMesh, so it doesn't need a key.
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

    // Test mode: hand back placeholders instead of calling AdMesh, so the card
    // and its ad disclosure can be checked on web and desktop while real fill
    // is zero. Admin-only switch, and every field says "sample" out loud — this
    // must never be mistakable for a real advertiser.
    if (config.testAdMode) {
      const samples = Array.from({ length: count }, (_, i) => ({
        title: `Sample placement ${i + 1} — test ad`,
        brandName: "Test Advertiser",
        adText: "Placeholder used to verify ad slots render. Real ads appear here once AdMesh returns inventory.",
        cta: "Learn more",
        url: "https://useadmesh.com",
        clickUrl: "https://useadmesh.com",
        impUrl: undefined,
        favicon: undefined,
      }));
      return count === 1 ? samples[0] : samples;
    }

    // AdMesh matches on a natural-language query, not a placement vocabulary —
    // so the conversation gets flattened into one. The last user turn carries
    // the intent; a little assistant context sharpens it.
    const lastUser = [...messages].reverse().find((m) => m.role === "user")?.content ?? "";
    const query = (lastUser || messages[messages.length - 1].content).slice(0, 1000);

    // Only the fields AdMesh's own schema declares. Its request model is
    // FastAPI/pydantic, so unknown keys are at best ignored and at worst a 422 —
    // restrictedCategories and args.device have no counterpart there and are
    // deliberately not sent. `device` stays in the arg list because the /ad
    // route and the shipped .exe still pass it and Convex rejects undeclared
    // args. Our own chat sessionId isn't AdMesh's session_id — that one has to
    // be minted by them.
    // message_id identifies this turn to AdMesh (it dedupes and attributes
    // against it). The spec calls it optional; the server 400s without it, same
    // as session_id. One per request is right — each ad request is one turn.
    // source defaults to admesh_ui_sdk, which we are not — we call from the
    // backend, so the weave value is the honest one for attribution.
    const body: Record<string, unknown> = {
      query,
      format: "auto",
      message_id: crypto.randomUUID(),
      source: "admesh_weave_node",
    };

    // Two fetches worst case (session mint + recommend, or a retry), so the
    // budget is wider than the single call it used to wrap.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    try {
      let session = await ensureAdSession(ctx, config, controller.signal);
      if (!session) return null; // already logged

      const post = (sid: string) => fetch("https://api.useadmesh.com/agent/recommend", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify({ ...body, session_id: sid }),
        signal: controller.signal,
      });

      let res = await post(session);
      // A cached session can be killed server-side before its TTL runs out, so
      // mint once and retry — otherwise ads stay dark until the stale TTL
      // lapses. Only for 400s that actually name the session: AdMesh returns
      // 400 for any missing field, and reminting won't fix those. Not on 401
      // either; that means the key is bad and a retry just burns a call.
      if (res.status === 400) {
        const detail = await res.text().catch(() => "");
        if (detail.toLowerCase().includes("session")) {
          console.warn(`[ads] recommend 400 (${detail.slice(0, 200)}) — reminting session`);
          session = await mintAdSession(ctx, config.apiKey, controller.signal);
          if (!session) return null;
          res = await post(session);
        } else {
          console.warn(`[ads] recommend 400: ${detail.slice(0, 400)}`);
          return null;
        }
      }
      // 204 = no matching ad; anything non-OK = hide the slot. Ads must never break chat.
      if (res.status === 204) { console.warn("[ads] admesh: 204 no fill"); return null; }
      if (!res.ok) {
        // The body carries the actual reason (bad key, bad field, quota) — a
        // bare status code sent me hunting last time.
        const detail = await res.text().catch(() => "");
        console.warn(`[ads] admesh HTTP ${res.status}: ${detail.slice(0, 400)}`);
        return null;
      }
      const data = await res.json();
      const recs = data?.response?.recommendations ?? data?.recommendations;
      if (!Array.isArray(recs) || recs.length === 0) {
        console.warn(`[ads] admesh returned no recommendations; keys=${Object.keys(data ?? {}).join(",")}`);
        return null;
      }
      const ads = recs.slice(0, count).map(normalizeAd).filter(Boolean);
      if (ads.length === 0) {
        // Got results but couldn't map them — means the field names moved.
        console.warn(`[ads] ${recs.length} recs all dropped in normalize; first keys=${Object.keys(recs[0] ?? {}).join(",")}`);
        return null;
      }
      // Backwards compatible: count omitted/1 → single ad object; else array.
      return count === 1 ? ads[0] : ads;
    } catch (err) {
      console.warn(`[ads] admesh request threw: ${err instanceof Error ? err.message : String(err)}`);
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
