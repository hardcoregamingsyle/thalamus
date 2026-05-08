import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { toast } from "sonner";
import {
  Shield, Users, Tag, Lightbulb, DollarSign, LogOut, ChevronRight,
  Plus, Trash2, Check, Edit2, Eye, EyeOff, Loader2,
  Coins, AlertCircle, CheckCircle, Star, TrendingDown, RefreshCw, Zap,
  Database, ExternalLink, Copy, Globe,
} from "lucide-react";

// ── Admin auth ────────────────────────────────────────────────────────────────
const ADMIN_USER = "admin";
const ADMIN_PASS = "Aphantic*123";

// ── Default model pricing ─────────────────────────────────────────────────────
const DEFAULT_MODELS = [
  { modelId: "claude-haiku-4-5", displayName: "Claude Haiku 4.5", inputCentsPerMillion: 180, outputCentsPerMillion: 720, abMultiplier: 15000, isActive: true },
  { modelId: "claude-sonnet-4-6", displayName: "Claude Sonnet 4.6", inputCentsPerMillion: 540, outputCentsPerMillion: 2650, abMultiplier: 15000, isActive: true },
  { modelId: "claude-opus-4-6", displayName: "Claude Opus 4.6", inputCentsPerMillion: 744, outputCentsPerMillion: 4200, abMultiplier: 15000, isActive: true },
  { modelId: "claude-opus-4-7", displayName: "Claude Opus 4.7", inputCentsPerMillion: 1200, outputCentsPerMillion: 6000, abMultiplier: 15000, isActive: true },
];

type AdminTab = "credits" | "promo-codes" | "users" | "suggestion" | "convex";

const ADMIN_SESSION_KEY = "thalamus_admin_session";

export default function AdminPage() {
  const [authed, setAuthed] = useState(() => {
    try { return localStorage.getItem(ADMIN_SESSION_KEY) === ADMIN_PASS; } catch { return false; }
  });
  const [adminToken, setAdminToken] = useState(() => {
    try { return localStorage.getItem(ADMIN_SESSION_KEY) === ADMIN_PASS ? ADMIN_PASS : ""; } catch { return ""; }
  });
  const [loginUser, setLoginUser] = useState("");
  const [loginPass, setLoginPass] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [tab, setTab] = useState<AdminTab>("users");

  const handleLogin = () => {
    if (loginUser === ADMIN_USER && loginPass === ADMIN_PASS) {
      try { localStorage.setItem(ADMIN_SESSION_KEY, ADMIN_PASS); } catch {}
      setAuthed(true);
      setAdminToken(ADMIN_PASS);
      toast.success("Welcome, Admin");
    } else {
      toast.error("Invalid credentials");
    }
  };

  if (!authed) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="w-full max-w-sm bg-card border border-border rounded-2xl p-8 shadow-2xl"
        >
          <div className="flex items-center gap-3 mb-8">
            <div className="w-10 h-10 rounded-xl bg-primary/20 border border-primary/40 flex items-center justify-center">
              <Shield className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-foreground">Admin Portal</h1>
              <p className="text-xs text-muted-foreground">Aphantic Corporation</p>
            </div>
          </div>
          <div className="space-y-4">
            <div>
              <label className="text-xs font-bold text-muted-foreground mb-1.5 block">USER ID</label>
              <input
                value={loginUser}
                onChange={e => setLoginUser(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") handleLogin(); }}
                placeholder="admin"
                className="w-full bg-background border border-border rounded-xl px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/60 transition-colors"
              />
            </div>
            <div>
              <label className="text-xs font-bold text-muted-foreground mb-1.5 block">PASSWORD</label>
              <div className="relative">
                <input
                  type={showPass ? "text" : "password"}
                  value={loginPass}
                  onChange={e => setLoginPass(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter") handleLogin(); }}
                  placeholder="••••••••"
                  className="w-full bg-background border border-border rounded-xl px-3 py-2.5 pr-10 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/60 transition-colors"
                />
                <button onClick={() => setShowPass(s => !s)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors">
                  {showPass ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
            <button
              onClick={handleLogin}
              className="w-full bg-primary text-primary-foreground py-2.5 rounded-xl text-sm font-bold hover:bg-primary/90 transition-all"
            >
              Sign In
            </button>
          </div>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="shrink-0 border-b border-border bg-card/90 backdrop-blur-md">
        <div className="flex items-center justify-between px-6 h-14">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-primary/20 border border-primary/40 flex items-center justify-center">
              <Shield className="h-4 w-4 text-primary" />
            </div>
            <span className="font-bold text-foreground">Thalamus Admin</span>
            <span className="text-xs text-muted-foreground">Aphantic Corporation</span>
          </div>
          <button
            onClick={() => { try { localStorage.removeItem(ADMIN_SESSION_KEY); } catch {} setAuthed(false); setAdminToken(""); }}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-destructive transition-colors"
          >
            <LogOut className="h-3.5 w-3.5" />Sign Out
          </button>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        <nav className="w-52 shrink-0 border-r border-border bg-card flex flex-col p-3 gap-1">
          {([
            { id: "users", label: "Users", icon: Users },
            { id: "credits", label: "Credits", icon: DollarSign },
            { id: "promo-codes", label: "Promo Codes", icon: Tag },
            { id: "suggestion", label: "Suggestions", icon: Lightbulb },
            { id: "convex", label: "Convex", icon: Database },
          ] as { id: AdminTab; label: string; icon: React.ElementType }[]).map(item => (
            <button
              key={item.id}
              onClick={() => setTab(item.id)}
              className={`flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm transition-all ${
                tab === item.id ? "bg-primary/15 text-primary border border-primary/20 font-bold" : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
              }`}
            >
              <item.icon className="h-4 w-4 shrink-0" />
              {item.label}
              {tab === item.id && <ChevronRight className="h-3 w-3 ml-auto" />}
            </button>
          ))}
        </nav>

        <main className="flex-1 overflow-y-auto p-6">
          <AnimatePresence mode="wait">
            <motion.div
              key={tab}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.15 }}
            >
              {tab === "users" && <UsersTab adminToken={adminToken} />}
              {tab === "credits" && <CreditsTab adminToken={adminToken} />}
              {tab === "promo-codes" && <PromoCodesTab adminToken={adminToken} />}
              {tab === "suggestion" && <SuggestionsTab adminToken={adminToken} />}
            </motion.div>
          </AnimatePresence>
        </main>
      </div>
    </div>
  );
}

// ── Users Tab ─────────────────────────────────────────────────────────────────
function UsersTab({ adminToken }: { adminToken: string }) {
  const users = useQuery(api.admin.listUsers, { adminToken });
  const setDailyAllowance = useMutation(api.admin.setDailyAllowance);
  const addCredits = useMutation(api.admin.addPurchasedCredits);
  const [editingUser, setEditingUser] = useState<string | null>(null);
  const [newDaily, setNewDaily] = useState("");
  const [addAmount, setAddAmount] = useState("");
  const [search, setSearch] = useState("");

  const filtered = (users ?? []).filter(u =>
    !search || (u.email ?? "").toLowerCase().includes(search.toLowerCase()) || (u.name ?? "").toLowerCase().includes(search.toLowerCase())
  );

  const handleSetDaily = async (userId: Id<"users">) => {
    const val = parseInt(newDaily);
    if (isNaN(val) || val < 0) { toast.error("Invalid amount"); return; }
    try {
      await setDailyAllowance({ adminToken, userId, dailyAgentBucks: val });
      toast.success("Daily allowance updated");
      setEditingUser(null);
      setNewDaily("");
    } catch (err) { toast.error(err instanceof Error ? err.message : "Failed"); }
  };

  const handleAddCredits = async (userId: Id<"users">) => {
    const val = parseInt(addAmount);
    if (isNaN(val) || val <= 0) { toast.error("Invalid amount"); return; }
    try {
      await addCredits({ adminToken, userId, amount: val, note: "admin_grant" });
      toast.success(`Added ${val.toLocaleString()} AB`);
      setAddAmount("");
    } catch (err) { toast.error(err instanceof Error ? err.message : "Failed"); }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-bold text-foreground">Users</h2>
          <p className="text-sm text-muted-foreground">{users?.length ?? 0} total users</p>
        </div>
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search by email or name..."
          className="bg-background border border-border rounded-xl px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/60 transition-colors w-64"
        />
      </div>

      {!users ? (
        <div className="flex items-center justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
      ) : (
        <div className="space-y-3">
          {filtered.map(user => (
            <motion.div
              key={user._id}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="bg-card border border-border rounded-xl p-4"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <p className="font-bold text-sm text-foreground truncate">{user.email ?? "No email"}</p>
                    {user.isBanned && <span className="text-[10px] bg-destructive/20 text-destructive border border-destructive/30 px-1.5 py-0.5 rounded-full font-bold">BANNED</span>}
                  </div>
                  {user.name && <p className="text-xs text-muted-foreground mb-2">{user.name}</p>}
                  <div className="flex flex-wrap gap-3 text-xs">
                    <div className="flex items-center gap-1.5 bg-muted/50 border border-border rounded-lg px-2 py-1">
                      <Coins className="h-3 w-3 text-amber-400" />
                      <span className="text-muted-foreground">Daily:</span>
                      <span className="font-bold text-amber-400">{(user.dailyAgentBucks ?? 0).toLocaleString()} AB</span>
                    </div>
                    <div className="flex items-center gap-1.5 bg-muted/50 border border-border rounded-lg px-2 py-1">
                      <Star className="h-3 w-3 text-primary" />
                      <span className="text-muted-foreground">Purchased:</span>
                      <span className="font-bold text-primary">{(user.purchasedAgentBucks ?? 0).toLocaleString()} AB</span>
                    </div>
                    <div className="flex items-center gap-1.5 bg-muted/50 border border-border rounded-lg px-2 py-1">
                      <AlertCircle className="h-3 w-3 text-orange-400" />
                      <span className="text-muted-foreground">Warnings:</span>
                      <span className="font-bold text-orange-400">{user.warningCount ?? 0}</span>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => { setEditingUser(editingUser === user._id ? null : user._id); setNewDaily(String(user.dailyAgentBucks ?? 0)); }}
                    className="p-1.5 rounded-lg text-muted-foreground hover:text-primary hover:bg-primary/10 transition-all"
                    title="Edit daily allowance"
                  >
                    <Edit2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>

              <AnimatePresence>
                {editingUser === user._id && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    className="overflow-hidden"
                  >
                    <div className="mt-3 pt-3 border-t border-border flex flex-wrap gap-3">
                      <div className="flex items-center gap-2">
                        <label className="text-xs text-muted-foreground">Daily AB:</label>
                        <input
                          value={newDaily}
                          onChange={e => setNewDaily(e.target.value)}
                          className="w-28 bg-background border border-border rounded-lg px-2 py-1 text-xs text-foreground focus:outline-none focus:border-primary/60"
                        />
                        <button onClick={() => handleSetDaily(user._id as Id<"users">)} className="px-2 py-1 bg-primary/10 border border-primary/30 text-primary text-xs rounded-lg hover:bg-primary/20 transition-all">
                          <Check className="h-3 w-3" />
                        </button>
                      </div>
                      <div className="flex items-center gap-2">
                        <label className="text-xs text-muted-foreground">Add Purchased AB:</label>
                        <input
                          value={addAmount}
                          onChange={e => setAddAmount(e.target.value)}
                          placeholder="amount"
                          className="w-28 bg-background border border-border rounded-lg px-2 py-1 text-xs text-foreground focus:outline-none focus:border-primary/60"
                        />
                        <button onClick={() => handleAddCredits(user._id as Id<"users">)} className="px-2 py-1 bg-emerald-400/10 border border-emerald-400/30 text-emerald-400 text-xs rounded-lg hover:bg-emerald-400/20 transition-all">
                          <Plus className="h-3 w-3" />
                        </button>
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          ))}
          {filtered.length === 0 && <p className="text-center text-muted-foreground py-12 text-sm">No users found</p>}
        </div>
      )}
    </div>
  );
}

// ── Platform pricing rates ($ per million tokens) ─────────────────────────────
const PLATFORM_PRICING = [
  { modelId: "claude-haiku-4-5",  displayName: "Claude Haiku 4.5",  input: 1,  output: 5  },
  { modelId: "claude-sonnet-4-6", displayName: "Claude Sonnet 4.6", input: 3,  output: 15 },
  { modelId: "claude-opus-4-6",   displayName: "Claude Opus 4.6",   input: 5,  output: 25 },
  { modelId: "claude-opus-4-7",   displayName: "Claude Opus 4.7",   input: 7,  output: 34 },
];

// ── Credits Tab ───────────────────────────────────────────────────────────────
function CreditsTab({ adminToken }: { adminToken: string }) {
  const budget = useQuery(api.admin.getPlatformBudget, { adminToken });
  const setPlatformBudget = useMutation(api.admin.setPlatformBudget);
  const resetPlatformSpend = useMutation(api.admin.resetPlatformSpend);
  const [budgetInput, setBudgetInput] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [isResetting, setIsResetting] = useState(false);

  const handleSetBudget = async () => {
    const val = parseFloat(budgetInput);
    if (isNaN(val) || val <= 0) { toast.error("Enter a valid dollar amount"); return; }
    setIsSaving(true);
    try {
      await setPlatformBudget({ adminToken, totalDollars: val });
      toast.success(`Budget set to ${val.toFixed(2)}`);
      setBudgetInput("");
    } catch (err) { toast.error(err instanceof Error ? err.message : "Failed"); }
    finally { setIsSaving(false); }
  };

  const handleResetSpend = async () => {
    if (!confirm("Reset all spent credits to $0? This does not change the total budget.")) return;
    setIsResetting(true);
    try {
      await resetPlatformSpend({ adminToken });
      toast.success("Spend counter reset to $0");
    } catch (err) { toast.error(err instanceof Error ? err.message : "Failed"); }
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

      {/* Set budget */}
      <div className="bg-card border border-border rounded-xl p-5">
        <p className="text-sm font-bold text-foreground mb-1">Set Total Budget</p>
        <p className="text-xs text-muted-foreground mb-4">Enter the total dollar amount you want to allocate. This replaces the current total (spent amount is preserved).</p>
        <div className="flex gap-3">
          <div className="relative flex-1">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">$</span>
            <input
              value={budgetInput}
              onChange={e => setBudgetInput(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") handleSetBudget(); }}
              placeholder="100.00"
              type="number"
              min="0"
              step="0.01"
              className="w-full bg-background border border-border rounded-xl pl-7 pr-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/60 transition-colors"
            />
          </div>
          <button
            onClick={handleSetBudget}
            disabled={isSaving || !budgetInput.trim()}
            className="flex items-center gap-2 px-5 py-2.5 bg-primary text-primary-foreground rounded-xl text-sm font-bold hover:bg-primary/90 disabled:opacity-50 transition-all"
          >
            {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
            Set Budget
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

      {/* Model pricing reference */}
      <div className="bg-card border border-border rounded-xl p-5">
        <p className="text-sm font-bold text-foreground mb-1">Model Pricing Reference</p>
        <p className="text-xs text-muted-foreground mb-4">Cost rates used for deduction ($ per million tokens, 8 decimal precision)</p>
        <div className="space-y-2">
          {PLATFORM_PRICING.map(m => (
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

// ── Promo Codes Tab ───────────────────────────────────────────────────────────
function PromoCodesTab({ adminToken }: { adminToken: string }) {
  const promoCodes = useQuery(api.admin.listPromoCodes, { adminToken });
  const createPromoCode = useMutation(api.admin.createPromoCode);
  const deletePromoCode = useMutation(api.admin.deletePromoCode);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    code: "", purchasedCredits: "", spins: "", expiresAt: "", maxUses: "",
  });

  const handleCreate = async () => {
    if (!form.code.trim() || !form.expiresAt) { toast.error("Code and expiry are required"); return; }
    try {
      await createPromoCode({
        adminToken,
        code: form.code.trim().toUpperCase(),
        purchasedCredits: form.purchasedCredits ? parseInt(form.purchasedCredits) : undefined,
        spins: form.spins ? parseInt(form.spins) : undefined,
        expiresAt: new Date(form.expiresAt).getTime(),
        maxUses: form.maxUses ? parseInt(form.maxUses) : undefined,
        createdBy: "admin",
      });
      toast.success("Promo code created");
      setShowForm(false);
      setForm({ code: "", purchasedCredits: "", spins: "", expiresAt: "", maxUses: "" });
    } catch (err) { toast.error(err instanceof Error ? err.message : "Failed"); }
  };

  const handleDelete = async (id: Id<"promoCodes">) => {
    if (!confirm("Delete this promo code?")) return;
    try {
      await deletePromoCode({ adminToken, id });
      toast.success("Deleted");
    } catch (err) { toast.error(err instanceof Error ? err.message : "Failed"); }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-bold text-foreground">Promo Codes</h2>
          <p className="text-sm text-muted-foreground">{promoCodes?.length ?? 0} codes</p>
        </div>
        <button
          onClick={() => setShowForm(s => !s)}
          className="flex items-center gap-1.5 px-3 py-2 bg-primary/10 border border-primary/30 text-primary text-sm rounded-xl hover:bg-primary/20 transition-all font-bold"
        >
          <Plus className="h-4 w-4" />New Code
        </button>
      </div>

      <AnimatePresence>
        {showForm && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden mb-6"
          >
            <div className="bg-card border border-border rounded-xl p-5 space-y-4">
              <h3 className="font-bold text-foreground">Create Promo Code</h3>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">CODE *</label>
                  <input value={form.code} onChange={e => setForm(f => ({ ...f, code: e.target.value.toUpperCase() }))} placeholder="SUMMER2025" className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:border-primary/60 font-mono" />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">EXPIRES AT *</label>
                  <input type="date" value={form.expiresAt} onChange={e => setForm(f => ({ ...f, expiresAt: e.target.value }))} className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:border-primary/60" />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">AGENT BUCKS</label>
                  <input value={form.purchasedCredits} onChange={e => setForm(f => ({ ...f, purchasedCredits: e.target.value }))} placeholder="e.g. 50000000" className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:border-primary/60" />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">SPINS</label>
                  <input value={form.spins} onChange={e => setForm(f => ({ ...f, spins: e.target.value }))} placeholder="e.g. 3" className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:border-primary/60" />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">MAX USES (blank = unlimited)</label>
                  <input value={form.maxUses} onChange={e => setForm(f => ({ ...f, maxUses: e.target.value }))} placeholder="e.g. 100" className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:border-primary/60" />
                </div>
              </div>
              <div className="flex gap-2">
                <button onClick={handleCreate} className="px-4 py-2 bg-primary text-primary-foreground text-sm rounded-xl hover:bg-primary/90 transition-all font-bold">Create</button>
                <button onClick={() => setShowForm(false)} className="px-4 py-2 bg-muted/50 border border-border text-muted-foreground text-sm rounded-xl hover:bg-muted transition-all">Cancel</button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {!promoCodes ? (
        <div className="flex items-center justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
      ) : (
        <div className="space-y-3">
          {promoCodes.map(code => (
            <div key={code._id} className="bg-card border border-border rounded-xl p-4 flex items-center justify-between gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1 flex-wrap">
                  <span className="font-bold text-foreground font-mono">{code.code}</span>
                  {code.maxUses != null && code.usedCount >= code.maxUses && (
                    <span className="text-[10px] bg-destructive/15 text-destructive border border-destructive/30 px-1.5 py-0.5 rounded-full font-bold">EXHAUSTED</span>
                  )}
                  {code.expiresAt < Date.now() && (
                    <span className="text-[10px] bg-muted text-muted-foreground border border-border px-1.5 py-0.5 rounded-full font-bold">EXPIRED</span>
                  )}
                </div>
                <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                  {code.purchasedCredits && <span>{code.purchasedCredits.toLocaleString()} AB</span>}
                  {code.spins && <span>{code.spins} spin(s)</span>}
                  <span>Used: {code.usedCount}{code.maxUses != null ? `/${code.maxUses}` : ""}</span>
                  <span>Expires: {new Date(code.expiresAt).toLocaleDateString()}</span>
                </div>
              </div>
              <button onClick={() => handleDelete(code._id)} className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-all shrink-0">
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
          {promoCodes.length === 0 && <p className="text-center text-muted-foreground py-12 text-sm">No promo codes yet</p>}
        </div>
      )}
    </div>
  );
}

// ── Suggestions Tab ───────────────────────────────────────────────────────────
function SuggestionsTab({ adminToken }: { adminToken: string }) {
  const suggestions = useQuery(api.admin.listSuggestions, { adminToken });
  const updateStatus = useMutation(api.admin.updateSuggestionStatus);
  const deleteSuggestion = useMutation(api.admin.deleteSuggestion);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [filter, setFilter] = useState<string>("all");

  const filtered = (suggestions ?? []).filter(s => filter === "all" || s.status === filter);

  const STATUS_COLORS: Record<string, string> = {
    new: "bg-primary/15 text-primary border-primary/30",
    reviewed: "bg-blue-400/15 text-blue-400 border-blue-400/30",
    implemented: "bg-emerald-400/15 text-emerald-400 border-emerald-400/30",
    rejected: "bg-destructive/15 text-destructive border-destructive/30",
  };

  const handleStatus = async (id: Id<"suggestions">, status: string) => {
    try { await updateStatus({ adminToken, id, status }); toast.success(`Marked as ${status}`); } catch (err) { toast.error(err instanceof Error ? err.message : "Failed"); }
  };

  const handleDelete = async (id: Id<"suggestions">) => {
    if (!confirm("Delete this suggestion?")) return;
    try { await deleteSuggestion({ adminToken, id }); toast.success("Deleted"); } catch (err) { toast.error(err instanceof Error ? err.message : "Failed"); }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-bold text-foreground">Suggestions</h2>
          <p className="text-sm text-muted-foreground">{suggestions?.length ?? 0} total</p>
        </div>
        <div className="flex gap-1">
          {["all", "new", "reviewed", "implemented", "rejected"].map(f => (
            <button key={f} onClick={() => setFilter(f)} className={`px-3 py-1.5 text-xs rounded-lg transition-all capitalize ${filter === f ? "bg-primary/15 text-primary border border-primary/30 font-bold" : "text-muted-foreground hover:bg-muted/50"}`}>
              {f}
            </button>
          ))}
        </div>
      </div>

      {!suggestions ? (
        <div className="flex items-center justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
      ) : (
        <div className="space-y-3">
          {filtered.map(s => (
            <div key={s._id} className="bg-card border border-border rounded-xl overflow-hidden">
              <div
                className="flex items-start justify-between gap-4 p-4 cursor-pointer hover:bg-muted/20 transition-colors"
                onClick={() => setExpanded(expanded === s._id ? null : s._id)}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <h3 className="font-bold text-sm text-foreground">{s.title}</h3>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full border font-bold ${STATUS_COLORS[s.status ?? "new"] ?? STATUS_COLORS.new}`}>
                      {(s.status ?? "new").toUpperCase()}
                    </span>
                    {s.files && s.files.length > 0 && (
                      <span className="text-[10px] bg-muted text-muted-foreground border border-border px-1.5 py-0.5 rounded-full">{s.files.length} file(s)</span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">{s.userEmail ?? "Anonymous"} · {new Date(s.createdAt).toLocaleDateString()}</p>
                </div>
                <ChevronRight className={`h-4 w-4 text-muted-foreground shrink-0 transition-transform ${expanded === s._id ? "rotate-90" : ""}`} />
              </div>

              <AnimatePresence>
                {expanded === s._id && (
                  <motion.div
                    initial={{ height: 0 }}
                    animate={{ height: "auto" }}
                    exit={{ height: 0 }}
                    className="overflow-hidden"
                  >
                    <div className="px-4 pb-4 border-t border-border pt-3 space-y-3">
                      <p className="text-sm text-foreground leading-relaxed whitespace-pre-wrap">{s.description}</p>
                      {s.files && s.files.length > 0 && (
                        <div className="space-y-2">
                          <p className="text-xs font-bold text-muted-foreground">ATTACHED FILES</p>
                          {s.files.map((f, i) => (
                            <div key={i} className="bg-muted/30 border border-border rounded-lg p-3">
                              <p className="text-xs font-bold text-foreground mb-1">{f.name} <span className="text-muted-foreground font-normal">({(f.size / 1024).toFixed(1)} KB)</span></p>
                              <pre className="text-[10px] text-muted-foreground overflow-x-auto max-h-32 whitespace-pre-wrap">{f.content.slice(0, 500)}{f.content.length > 500 ? "..." : ""}</pre>
                            </div>
                          ))}
                        </div>
                      )}
                      <div className="flex flex-wrap gap-2 pt-1">
                        {["new", "reviewed", "implemented", "rejected"].map(st => (
                          <button key={st} onClick={() => handleStatus(s._id, st)} className={`px-2.5 py-1 text-xs rounded-lg border transition-all capitalize font-bold ${s.status === st ? STATUS_COLORS[st] : "text-muted-foreground border-border hover:bg-muted/50"}`}>
                            {st}
                          </button>
                        ))}
                        <button onClick={() => handleDelete(s._id)} className="px-2.5 py-1 text-xs rounded-lg border border-destructive/30 text-destructive hover:bg-destructive/10 transition-all ml-auto">
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          ))}
          {filtered.length === 0 && <p className="text-center text-muted-foreground py-12 text-sm">No suggestions {filter !== "all" ? `with status "${filter}"` : "yet"}</p>}
        </div>
      )}
    </div>
  );
}