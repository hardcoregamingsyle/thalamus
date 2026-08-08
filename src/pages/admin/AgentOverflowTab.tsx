// AgentOverflow / Corpus tab — overview of the AI search corpus: VM health,
// learning-submission stats, tier breakdown and a recent-learnings feed.
// Drives api.agentoverflowAdmin.adminStats, api.agentoverflowAdmin.adminCorpusHealth
// and api.agentoverflowAdmin.adminLearnings.

import { useState, useEffect } from "react";
import { useQuery, useAction } from "convex/react";
import { api } from "@/convex/_generated/api";
import {
  BookMarked, Users, Star, CheckCircle, Loader2,
} from "lucide-react";

export function AgentOverflowTab({ adminToken }: { adminToken: string }) {
  const adminStats = useAction(api.agentoverflowAdmin.adminStats);
  const corpusHealth = useAction(api.agentoverflowAdmin.adminCorpusHealth);
  const learnings = useQuery(api.agentoverflowAdmin.adminLearnings, { adminToken, limit: 50 });
  const [stats, setStats] = useState<{
    learnings: { total: number; pending: number; scored: number; rejected: number; duplicate: number; byTier: { low: number; medium: number; gold: number } };
    keys: { total: number; active: number };
    users: { total: number; creditsInCirculation: number; totalPoints: number };
  } | null>(null);
  const [health, setHealth] = useState<{ ok: boolean; qdrant?: boolean; postgres?: boolean; points?: number; error?: string } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const [s, h] = await Promise.all([
          adminStats({ adminToken }),
          corpusHealth({ adminToken }),
        ]);
        setStats(s);
        setHealth(h);
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    })();
  }, [adminToken, adminStats, corpusHealth]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-foreground">AgentOverflow Corpus</h2>
        <p className="text-sm text-muted-foreground">Learning submissions powering the AI search corpus</p>
      </div>

      {/* Corpus VM health */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className={`bg-card border rounded-xl p-5 ${health?.ok ? "border-emerald-400/40" : "border-destructive/40"}`}>
          <div className="flex items-center gap-2 mb-2">
            <div className={`w-3 h-3 rounded-full ${health?.ok ? "bg-emerald-400" : "bg-destructive"}`} />
            <p className="text-xs font-bold text-muted-foreground">CORPUS VM STATUS</p>
          </div>
          <p className={`text-lg font-bold ${health?.ok ? "text-emerald-400" : "text-destructive"}`}>
            {health?.ok ? "Healthy" : health?.error ?? "Unknown"}
          </p>
          {health && health.ok && (
            <div className="mt-2 flex flex-wrap gap-3 text-xs">
              <span className="text-muted-foreground">Qdrant: <span className={`font-bold ${health.qdrant ? "text-emerald-400" : "text-destructive"}`}>{health.qdrant ? "✓" : "✗"}</span></span>
              <span className="text-muted-foreground">Postgres: <span className={`font-bold ${health.postgres ? "text-emerald-400" : "text-destructive"}`}>{health.postgres ? "✓" : "✗"}</span></span>
              {health.points !== undefined && (
                <span className="text-muted-foreground">Vector points: <span className="font-bold text-foreground">{health.points.toLocaleString()}</span></span>
              )}
            </div>
          )}
        </div>

        <div className="bg-card border border-border rounded-xl p-5">
          <div className="flex items-center gap-2 mb-2">
            <BookMarked className="h-4 w-4 text-primary" />
            <p className="text-xs font-bold text-muted-foreground">TOTAL LEARNINGS</p>
          </div>
          <p className="text-3xl font-bold text-foreground">{stats?.learnings.total.toLocaleString() ?? "…"}</p>
          <div className="mt-2 flex flex-wrap gap-2 text-xs">
            {stats && (
              <>
                <span className="bg-primary/10 text-primary border border-primary/20 px-1.5 py-0.5 rounded-full">Scored: {stats.learnings.scored.toLocaleString()}</span>
                <span className="bg-amber-400/10 text-amber-400 border border-amber-400/20 px-1.5 py-0.5 rounded-full">Pending: {stats.learnings.pending.toLocaleString()}</span>
                <span className="bg-destructive/10 text-destructive border border-destructive/20 px-1.5 py-0.5 rounded-full">Rejected: {stats.learnings.rejected.toLocaleString()}</span>
                <span className="bg-muted text-muted-foreground border border-border px-1.5 py-0.5 rounded-full">Duplicate: {stats.learnings.duplicate.toLocaleString()}</span>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Tier breakdown */}
      {stats && (
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
          <div className="bg-card border border-border rounded-xl p-4">
            <p className="text-xs font-bold text-muted-foreground mb-1">GOLD</p>
            <p className="text-xl font-bold text-amber-400">{stats.learnings.byTier.gold.toLocaleString()}</p>
          </div>
          <div className="bg-card border border-border rounded-xl p-4">
            <p className="text-xs font-bold text-muted-foreground mb-1">MEDIUM</p>
            <p className="text-xl font-bold text-blue-400">{stats.learnings.byTier.medium.toLocaleString()}</p>
          </div>
          <div className="bg-card border border-border rounded-xl p-4">
            <p className="text-xs font-bold text-muted-foreground mb-1">LOW</p>
            <p className="text-xl font-bold text-muted-foreground">{stats.learnings.byTier.low.toLocaleString()}</p>
          </div>
          <div className="bg-card border border-border rounded-xl p-4">
            <p className="text-xs font-bold text-muted-foreground mb-1">ACTIVE KEYS</p>
            <p className="text-xl font-bold text-emerald-400">{stats.keys.active}/{stats.keys.total}</p>
          </div>
        </div>
      )}

      {/* Users summary */}
      {stats && (
        <div className="bg-card border border-border rounded-xl p-5">
          <div className="flex items-center gap-2 mb-2">
            <Users className="h-4 w-4 text-primary" />
            <p className="text-xs font-bold text-muted-foreground">AO USERS</p>
          </div>
          <div className="flex flex-wrap gap-4 text-sm">
            <span>Total: <strong className="text-foreground">{stats.users.total.toLocaleString()}</strong></span>
            <span>Credits: <strong className="text-amber-400">{stats.users.creditsInCirculation.toLocaleString()}</strong></span>
            <span>Contrib Points: <strong className="text-primary">{stats.users.totalPoints.toLocaleString()}</strong></span>
          </div>
        </div>
      )}

      {/* Recent learnings */}
      <div>
        <h3 className="text-sm font-bold text-foreground mb-3">Recent Learnings ({learnings?.length ?? 0})</h3>
        {!learnings ? (
          <div className="flex items-center justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
        ) : learnings.length === 0 ? (
          <p className="text-center text-muted-foreground py-8 text-sm">No learnings yet</p>
        ) : (
          <div className="space-y-2">
            {learnings.map((l: {
              id: string;
              title: string;
              status: string;
              score: number | null;
              tier: string | null;
              userEmail: string;
              inCorpus: boolean;
              createdAt: number;
            }) => (
              <div key={l.id} className="bg-card border border-border rounded-xl p-3 flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <p className="font-bold text-sm text-foreground truncate">{l.title}</p>
                    {l.tier === "gold" && <Star className="h-3 w-3 text-amber-400 shrink-0" />}
                  </div>
                  <p className="text-[10px] text-muted-foreground">{l.userEmail} · {new Date(l.createdAt).toLocaleDateString()}</p>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full border font-bold ${
                    l.status === "scored" ? "bg-emerald-400/10 text-emerald-400 border-emerald-400/30" :
                    l.status === "pending" ? "bg-amber-400/10 text-amber-400 border-amber-400/30" :
                    l.status === "rejected" ? "bg-destructive/10 text-destructive border-destructive/30" :
                    "bg-muted text-muted-foreground border-border"
                  }`}>{l.status}</span>
                  {l.score !== null && <span className="text-[10px] text-muted-foreground">{l.score}</span>}
                  {l.inCorpus && <CheckCircle className="h-3 w-3 text-emerald-400" />}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
