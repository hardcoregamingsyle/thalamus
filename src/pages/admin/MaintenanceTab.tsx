// Maintenance tab — one-off repair actions safe to re-run.
// Drives api.githubAutoCreate.adminRepairOrphanRepos.

import { useState } from "react";
import { useAction } from "convex/react";
import { api } from "@/convex/_generated/api";
import { toast } from "sonner";
import { Wrench, Loader2 } from "lucide-react";
import { errMsg } from "@/lib/errorMessage";

export function MaintenanceTab({ adminToken }: { adminToken: string }) {
  const repairOrphanRepos = useAction(api.githubAutoCreate.adminRepairOrphanRepos);
  const [repairing, setRepairing] = useState(false);
  const [result, setResult] = useState<{ created: number; skipped: number; errors: string[] } | null>(null);

  const handleRepair = async () => {
    setRepairing(true);
    setResult(null);
    try {
      const r = await repairOrphanRepos({ adminToken });
      setResult(r);
      toast.success(`Repo repair: ${r.created} created, ${r.skipped} already had one, ${r.errors.length} failed`);
    } catch (err) {
      toast.error(errMsg(err, "Repair failed"));
    } finally {
      setRepairing(false);
    }
  };

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h2 className="text-xl font-bold text-foreground">Maintenance</h2>
        <p className="text-sm text-muted-foreground mt-1">One-off repair actions — safe to run repeatedly.</p>
      </div>

      <div className="bg-card border border-border rounded-xl p-6 space-y-3">
        <h3 className="text-sm font-bold text-foreground">Repair missing GitHub repos</h3>
        <p className="text-xs text-muted-foreground">
          Every branch is supposed to get its own platform repo automatically. A branch created while no
          GitHub token was available (no account connected and GITHUB_TOKEN unset) never got one, silently.
          This sweeps every branch, skips ones that already have a repo, and creates one for the rest —
          check the connection first if you expect this to actually succeed.
        </p>
        <button onClick={handleRepair} disabled={repairing}
          className="w-full py-2.5 bg-primary text-primary-foreground rounded-xl text-sm font-bold hover:bg-primary/90 disabled:opacity-50 transition-all flex items-center justify-center gap-2">
          {repairing ? <><Loader2 className="h-4 w-4 animate-spin" />Repairing…</> : <><Wrench className="h-4 w-4" />Run repair</>}
        </button>
        {result && (
          <div className="p-3 bg-muted/30 border border-border rounded-xl text-xs space-y-2">
            <p className="text-foreground font-bold">
              {result.created} created · {result.skipped} already had a repo · {result.errors.length} failed
            </p>
            {result.errors.length > 0 && (
              <div className="space-y-1 max-h-48 overflow-y-auto">
                {result.errors.map((e, i) => (
                  <p key={i} className="text-red-400 font-mono break-all">{e}</p>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
