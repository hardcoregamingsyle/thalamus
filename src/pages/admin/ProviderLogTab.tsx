// Provider Log tab — which model provider was last called and which provider
// returned which error. Reads providerCallLogs, written by callModel at every
// chain attempt (src/convex/lib/agentCore.ts).

import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { CheckCircle2, XCircle, Loader2 } from "lucide-react";

function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return new Date(ts).toLocaleString();
}

export function ProviderLogTab({ adminToken }: { adminToken: string }) {
  const data = useQuery(api.providerLog.list, adminToken ? { adminToken } : "skip");

  if (data === undefined) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-foreground">Provider Log</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Every attempt inside the model chain (Modal → Zen → OpenRouter → DeadlySignal → ModelScope → Ollama),
          newest first. A failed row shows the exact error that provider returned.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {data.summary.map((s) => (
          <div key={s.provider} className="bg-card border border-border rounded-xl p-4 space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-sm font-bold text-foreground">{s.provider}</span>
              <span className={`text-[11px] px-2 py-0.5 rounded-full font-bold ${s.failures > 0 ? "bg-red-500/15 text-red-400" : "bg-emerald-500/15 text-emerald-400"}`}>
                {s.failures > 0 ? `${s.failures}/${s.calls} failed` : `${s.calls} ok`}
              </span>
            </div>
            <p className="text-xs text-muted-foreground truncate font-mono" title={s.lastModel}>
              last: {s.lastModel}
            </p>
            <p className="text-[11px] text-muted-foreground">{timeAgo(s.lastTs)}</p>
            {s.lastError && (
              <p className="text-[11px] text-red-400 font-mono break-all line-clamp-2">{s.lastError}</p>
            )}
          </div>
        ))}
        {data.summary.length === 0 && (
          <p className="text-sm text-muted-foreground col-span-full">
            No calls recorded yet — the log starts filling the first time a model call runs with a pipeline context.
          </p>
        )}
      </div>

      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-border">
          <h3 className="text-sm font-bold text-foreground">Recent calls</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-muted-foreground border-b border-border">
                <th className="px-4 py-2 font-bold">Time</th>
                <th className="px-4 py-2 font-bold">Provider</th>
                <th className="px-4 py-2 font-bold">Model</th>
                <th className="px-4 py-2 font-bold">Agent</th>
                <th className="px-4 py-2 font-bold">Result</th>
              </tr>
            </thead>
            <tbody>
              {data.entries.map((e, i) => (
                <tr key={i} className="border-b border-border/50 last:border-b-0 align-top">
                  <td className="px-4 py-2 text-muted-foreground whitespace-nowrap">{timeAgo(e.ts)}</td>
                  <td className="px-4 py-2 font-bold text-foreground whitespace-nowrap">{e.provider}</td>
                  <td className="px-4 py-2 font-mono text-muted-foreground">{e.model}</td>
                  <td className="px-4 py-2 text-muted-foreground">{e.agent ?? "—"}</td>
                  <td className="px-4 py-2">
                    {e.ok ? (
                      <span className="flex items-center gap-1 text-emerald-400">
                        <CheckCircle2 className="h-3.5 w-3.5" /> ok
                      </span>
                    ) : (
                      <span className="flex items-start gap-1 text-red-400">
                        <XCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                        <span className="font-mono break-all">{e.error ?? "failed"}</span>
                      </span>
                    )}
                  </td>
                </tr>
              ))}
              {data.entries.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-muted-foreground">No calls recorded yet.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
