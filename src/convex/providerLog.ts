// Provider call log — which model provider was tried, what it answered, and
// which errors it returned. Written from inside callModel (lib/agentCore.ts) at
// every provider attempt, read from the admin panel's Provider Log tab.
//
// The pipeline's chain is: Modal → Zen → OpenRouter → DeadlySignal → ModelScope
// → Ollama. Each attempt is one row; a failed attempt carries the error message
// so the admin can see exactly which provider rejected which request instead of
// guessing from the last successful tier.
//
// `record` also folds every attempt into the providerHealth table: a failure
// classified by lib/providerCooldowns.ts stamps a cooldown (permanent-ish
// classes like a 403, a 402 balance or a dead model id skip the seat for
// hours instead of being retried on every turn), and any success clears it.
// `logOnly` exists for the chain's SKIP notes — writing a skip through
// `record` would let the classifier read its own cooldown note and re-stamp
// the very cooldown the note describes.

import { internalMutation, internalQuery, query } from "./_generated/server";
import { v } from "convex/values";
import { classifyProviderFailure } from "./lib/providerCooldowns";

const ADMIN_TOKEN = process.env.ADMIN_TOKEN ?? "";

async function requireAdmin(_ctx: unknown, adminToken: string) {
  if (!ADMIN_TOKEN) throw new Error("ADMIN_TOKEN not configured on server");
  if (!adminToken || adminToken !== ADMIN_TOKEN) throw new Error("Unauthorized");
}

// Bound the table with two bounded take() prunes (convex 1.39 has no
// query .count()): age-based (drop rows older than RETENTION_MS) and a hard
// row cap (when the newest MAX_ROWS+1 all exist, delete the oldest batch).
// Single ranged queries only — never a pagination loop.
const MAX_ROWS = 2000;
const RETENTION_MS = 30 * 86_400_000;
const LIST_LIMIT = 200;

export const record = internalMutation({
  args: {
    provider: v.string(),
    model: v.string(),
    ok: v.boolean(),
    error: v.optional(v.string()),
    agent: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const ts = Date.now();
    await ctx.db.insert("providerCallLogs", {
      ts,
      provider: args.provider,
      model: args.model,
      ok: args.ok,
      error: args.error ? args.error.slice(0, 500) : undefined,
      agent: args.agent ? args.agent.slice(0, 60) : undefined,
    });

    // Fold the outcome into providerHealth — the chain's memory of which
    // seats are learned-dead. A success clears the seat (it's provably
    // alive); a failure stamps a cooldown by class (permanent-ish failures
    // stop the every-turn hammering, transient ones only slow it). An
    // "unconfigured" verdict (cooldownMs 0) writes nothing: a missing key is
    // local config, and no amount of waiting changes it.
    const seat = `${args.provider}:${args.model}`;
    const learned = await ctx.db
      .query("providerHealth")
      .withIndex("by_seat", (q) => q.eq("seat", seat))
      .first();
    if (args.ok) {
      if (learned) await ctx.db.delete(learned._id);
    } else {
      const verdict = classifyProviderFailure(args.error);
      if (verdict.cooldownMs > 0) {
        const fields = {
          seat,
          klass: verdict.klass,
          reason: (args.error ?? "unknown error").slice(0, 200),
          cooldownUntil: ts + verdict.cooldownMs,
          updatedAt: ts,
        };
        if (learned) await ctx.db.patch(learned._id, fields);
        else await ctx.db.insert("providerHealth", fields);
      } else if (learned) {
        await ctx.db.delete(learned._id);
      }
    }

    // Age prune — usually an empty range, one cheap query.
    const cutoff = ts - RETENTION_MS;
    const stale = await ctx.db
      .query("providerCallLogs")
      .withIndex("by_ts", (q) => q.lt("ts", cutoff))
      .take(250);
    for (const row of stale) {
      await ctx.db.delete(row._id);
    }

    // Row-cap prune — fires only once the table actually exceeds MAX_ROWS.
    const newest = await ctx.db
      .query("providerCallLogs")
      .withIndex("by_ts")
      .order("desc")
      .take(MAX_ROWS + 1);
    if (newest.length > MAX_ROWS) {
      const oldestKeptTs = newest[newest.length - 1].ts;
      const atOrBefore = await ctx.db
        .query("providerCallLogs")
        .withIndex("by_ts", (q) => q.lte("ts", oldestKeptTs))
        .take(300);
      for (const row of atOrBefore) {
        await ctx.db.delete(row._id);
      }
    }
  },
});

// Insert a log row WITHOUT the providerHealth fold — for the chain's own
// skip notes ("SKIPPED — learned auth cooldown ..."). A skip note passing
// through `record` would be classified by its embedded status code and
// re-stamp the very cooldown it describes, extending it forever. Pruning is
// left to `record` (the dominant writer) deliberately: this path stays one
// cheap insert.
export const logOnly = internalMutation({
  args: {
    provider: v.string(),
    model: v.string(),
    ok: v.boolean(),
    error: v.optional(v.string()),
    agent: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("providerCallLogs", {
      ts: Date.now(),
      provider: args.provider,
      model: args.model,
      ok: args.ok,
      error: args.error ? args.error.slice(0, 500) : undefined,
      agent: args.agent ? args.agent.slice(0, 60) : undefined,
    });
  },
});

// The chain's read side: every seat with a live (not yet expired) cooldown.
// The table is tiny by construction — one row per "provider:model" that has
// ever failed — so a bounded scan beats an index the writes don't need.
export const liveInternal = internalQuery({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const rows = await ctx.db.query("providerHealth").take(64);
    return rows
      .filter((r) => r.cooldownUntil > now)
      .map((r) => ({
        seat: r.seat,
        klass: r.klass,
        reason: r.reason,
        cooldownUntil: r.cooldownUntil,
      }));
  },
});

export const list = query({
  args: { adminToken: v.string() },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.adminToken);

    const entries = await ctx.db
      .query("providerCallLogs")
      .withIndex("by_ts")
      .order("desc")
      .take(LIST_LIMIT);

    const summary = new Map<string, { provider: string; calls: number; failures: number; lastModel: string; lastTs: number; lastOk: boolean; lastError: string }>();
    for (const e of entries) {
      const s = summary.get(e.provider) ?? {
        provider: e.provider, calls: 0, failures: 0, lastModel: e.model, lastTs: e.ts, lastOk: e.ok, lastError: e.error ?? "",
      };
      s.calls++;
      if (!e.ok) s.failures++;
      if (e.ts > s.lastTs) { s.lastTs = e.ts; s.lastModel = e.model; s.lastOk = e.ok; s.lastError = e.error ?? ""; }
      summary.set(e.provider, s);
    }

    return {
      entries: entries.map((e) => ({
        ts: e.ts,
        provider: e.provider,
        model: e.model,
        ok: e.ok,
        error: e.error ?? null,
        agent: e.agent ?? null,
      })),
      summary: [...summary.values()],
    };
  },
});
