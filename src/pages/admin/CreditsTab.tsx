// Credits tab — platform-wide API budget management and per-model pricing view.
// Drives api.admin.getPlatformBudget, api.admin.setPlatformBudget and
// api.admin.resetPlatformSpend; pricing rows come from api.adminMeta.

import { useState } from "react";
import { motion } from "framer-motion";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { toast } from "sonner";
import {
  DollarSign, TrendingDown, Zap, AlertCircle, Plus, Check, RefreshCw, Loader2,
} from "lucide-react";
import { errMsg } from "@/lib/errorMessage";
import { useAdminMeta } from "./shared";

// Platform pricing rates ($ per million tokens) come from
// adminMeta.getAdminUiMeta — our cost basis is not something to ship in a
// publicly downloadable chunk.
interface PricingRow { modelId: string; displayName: string; input: number; output: number }

export function CreditsTab({ adminToken }: { adminToken: string }) {
  const platformPricing = (useAdminMeta(adminToken)?.platformPricing ?? []) as PricingRow[];
  const budget = useQuery(api.admin.getPlatformBudget, { adminToken });
  const setPlatformBudget = useMutation(api.admin.setPlatformBudget);
  const resetPlatformSpend = useMutation(api.admin.resetPlatformSpend);
  const [budgetInput, setBudgetInput] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [isResetting, setIsResetting] = useState(false);

  const handleSetBudget = async (operation: "add" | "set" | "subtract") => {
    const val = parseFloat(budgetInput);
    if (isNaN(val) || val <= 0) { toast.error("Enter a valid dollar amount"); return; }
    setIsSaving(true);
    try {
      await setPlatformBudget({ adminToken, totalDollars: val, operation });
      const msg = operation === "add" ? `Added $${val.toFixed(2)}` :
                  operation === "subtract" ? `Subtracted $${val.toFixed(2)}` :
                  `Budget set to $${val.toFixed(2)}`;
      toast.success(msg);
      setBudgetInput("");
    } catch (err) { toast.error(errMsg(err, "Failed")); }
    finally { setIsSaving(false); }
  };

  const handleResetSpend = async () => {
    if (!confirm("Reset all spent credits to $0? This does not change the total budget.")) return;
    setIsResetting(true);
    try {
      await resetPlatformSpend({ adminToken });
      toast.success("Spend counter reset to $0");
    } catch (err) { toast.error(errMsg(err, "Failed")); }
    finally { setIsResetting(false); }
  };

  const totalDollars = budget?.totalDollars ?? 0;
  const spentDollars = budget?.spentDollars ?? 0;
  const remaining = budget ? parseFloat((totalDollars - spentDollars).toFixed(8)) : 0;
  const spentPct = totalDollars > 0 ? Math.min(100, (spentDollars / totalDollars) * 100) : 0;
  const isDisabled = budget?.isDisabled ?? false;
  const isLow = remaining > 0 && remaining < 5;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-foreground">Platform Credit Budget</h2>
        <p className="text-sm text-muted-foreground">Set your total API cost budget. Agent requests are blocked when remaining balance drops below $5.00.</p>
      </div>

      {/* Status banner */}
      {isDisabled && (
        <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}
          className="flex items-center gap-3 bg-destructive/10 border border-destructive/30 rounded-xl px-4 py-3">
          <AlertCircle className="h-5 w-5 text-destructive shrink-0" />
          <div>
            <p className="text-sm font-bold text-destructive">Agent Requests Disabled</p>
            <p className="text-xs text-destructive/80">Remaining balance is below $5.00. Add more budget to re-enable.</p>
          </div>
        </motion.div>
      )}
      {isLow && !isDisabled && (
        <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}
          className="flex items-center gap-3 bg-amber-400/10 border border-amber-400/30 rounded-xl px-4 py-3">
          <AlertCircle className="h-5 w-5 text-amber-400 shrink-0" />
          <div>
            <p className="text-sm font-bold text-amber-400">Low Balance Warning</p>
            <p className="text-xs text-amber-400/80">Remaining: ${remaining.toFixed(8)} — requests will be blocked below $5.00</p>
          </div>
        </motion.div>
      )}

      {/* Budget overview cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-card border border-border rounded-xl p-5">
          <div className="flex items-center gap-2 mb-2">
            <DollarSign className="h-4 w-4 text-primary" />
            <p className="text-xs font-bold text-muted-foreground">TOTAL BUDGET</p>
          </div>
          <p className="text-2xl font-bold text-foreground">${totalDollars.toFixed(2)}</p>
        </div>
        <div className="bg-card border border-border rounded-xl p-5">
          <div className="flex items-center gap-2 mb-2">
            <TrendingDown className="h-4 w-4 text-destructive" />
            <p className="text-xs font-bold text-muted-foreground">SPENT</p>
          </div>
          <p className="text-2xl font-bold text-destructive">${spentDollars.toFixed(8)}</p>
        </div>
        <div className={`bg-card border rounded-xl p-5 ${isDisabled ? "border-destructive/40" : isLow ? "border-amber-400/40" : "border-border"}`}>
          <div className="flex items-center gap-2 mb-2">
            <Zap className={`h-4 w-4 ${isDisabled ? "text-destructive" : isLow ? "text-amber-400" : "text-emerald-400"}`} />
            <p className="text-xs font-bold text-muted-foreground">REMAINING</p>
          </div>
          <p className={`text-2xl font-bold ${isDisabled ? "text-destructive" : isLow ? "text-amber-400" : "text-emerald-400"}`}>
            ${remaining.toFixed(8)}
          </p>
        </div>
      </div>

      {/* Progress bar */}
      {totalDollars > 0 && (
        <div className="bg-card border border-border rounded-xl p-5">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-bold text-muted-foreground">BUDGET USAGE</p>
            <p className="text-xs text-muted-foreground">{spentPct.toFixed(1)}% used</p>
          </div>
          <div className="w-full h-3 bg-muted rounded-full overflow-hidden">
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${spentPct}%` }}
              transition={{ duration: 0.5 }}
              className={`h-full rounded-full ${spentPct > 90 ? "bg-destructive" : spentPct > 70 ? "bg-amber-400" : "bg-emerald-400"}`}
            />
          </div>
          <div className="flex justify-between mt-1">
            <p className="text-[10px] text-muted-foreground">$0</p>
            <p className="text-[10px] text-amber-400">$5 threshold</p>
            <p className="text-[10px] text-muted-foreground">${totalDollars.toFixed(2)}</p>
          </div>
        </div>
      )}

      {/* Manage budget */}
      <div className="bg-card border border-border rounded-xl p-5">
        <p className="text-sm font-bold text-foreground mb-1">Manage Budget</p>
        <p className="text-xs text-muted-foreground mb-4">Add, subtract, or set your total budget amount. Spent amount is preserved.</p>
        <div className="flex flex-col gap-3">
          <div className="relative flex-1">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">$</span>
            <input
              value={budgetInput}
              onChange={e => setBudgetInput(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") handleSetBudget("add"); }}
              placeholder="100.00"
              type="number"
              min="0"
              step="0.01"
              className="w-full bg-background border border-border rounded-xl pl-7 pr-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/60 transition-colors"
            />
          </div>
          <div className="flex gap-3">
            <button
              onClick={() => handleSetBudget("add")}
              disabled={isSaving || !budgetInput.trim()}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-emerald-500 text-white rounded-xl text-sm font-bold hover:bg-emerald-600 disabled:opacity-50 transition-all"
            >
              {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              Add Credits
            </button>
            <button
              onClick={() => handleSetBudget("subtract")}
              disabled={isSaving || !budgetInput.trim()}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-red-500 text-white rounded-xl text-sm font-bold hover:bg-red-600 disabled:opacity-50 transition-all"
            >
              {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <TrendingDown className="h-4 w-4" />}
              Subtract Credits
            </button>
            <button
              onClick={() => handleSetBudget("set")}
              disabled={isSaving || !budgetInput.trim()}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-primary text-primary-foreground rounded-xl text-sm font-bold hover:bg-primary/90 disabled:opacity-50 transition-all"
            >
              {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              Set Total
            </button>
            <button
              onClick={handleResetSpend}
              disabled={isResetting}
              title="Reset spent counter to $0"
              className="flex items-center gap-2 px-4 py-2.5 bg-muted/50 border border-border text-muted-foreground rounded-xl text-sm hover:bg-muted hover:text-foreground disabled:opacity-50 transition-all"
            >
              {isResetting ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              Reset Spend
            </button>
          </div>
        </div>
      </div>

      {/* Model pricing reference */}
      <div className="bg-card border border-border rounded-xl p-5">
        <p className="text-sm font-bold text-foreground mb-1">Model Pricing Reference</p>
        <p className="text-xs text-muted-foreground mb-4">Cost rates used for deduction ($ per million tokens, 8 decimal precision)</p>
        <div className="space-y-2">
          {platformPricing.map((m: PricingRow) => (
            <div key={m.modelId} className="flex items-center justify-between py-2 border-b border-border/50 last:border-0">
              <div>
                <p className="text-sm font-bold text-foreground">{m.displayName}</p>
                <p className="text-xs text-muted-foreground font-mono">{m.modelId}</p>
              </div>
              <div className="flex gap-4 text-xs">
                <div className="text-right">
                  <p className="text-muted-foreground">Input</p>
                  <p className="font-bold text-foreground">${m.input}/M</p>
                </div>
                <div className="text-right">
                  <p className="text-muted-foreground">Output</p>
                  <p className="font-bold text-foreground">${m.output}/M</p>
                </div>
              </div>
            </div>
          ))}
        </div>
        <div className="mt-3 bg-amber-400/10 border border-amber-400/20 rounded-lg px-3 py-2">
          <p className="text-[11px] text-amber-400">⚠ Requests are blocked when remaining balance drops below <strong>$5.00</strong>. In-progress requests complete normally.</p>
        </div>
      </div>
    </div>
  );
}
