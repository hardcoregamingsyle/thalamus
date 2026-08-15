// Provider call log — which model provider was tried, what it answered, and
// which errors it returned. Written from inside callModel (lib/agentCore.ts) at
// every provider attempt, read from the admin panel's Provider Log tab.
//
// The pipeline's chain is: Modal → Zen → OpenRouter → DeadlySignal → ModelScope
// → Ollama. Each attempt is one row; a failed attempt carries the error message
// so the admin can see exactly which provider rejected which request instead of
// guessing from the last successful tier.

import { internalMutation, query } from "./_generated/server";
import { v } from "convex/values";

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
