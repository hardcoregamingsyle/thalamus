import { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useQuery, useMutation, useAction } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Doc, Id } from "@/convex/_generated/dataModel";
import { toast } from "sonner";
import {
  Shield, Users, Tag, Lightbulb, DollarSign, LogOut, ChevronRight,
  Plus, Trash2, Check, Edit2, Eye, EyeOff, Loader2,
  Coins, AlertCircle, CheckCircle, Star, TrendingDown, RefreshCw, Zap,
  Database, Globe, BookOpen, Upload, FileText,
  TrendingUp, Activity, Cpu,
} from "lucide-react";

type AdminTab = "credits" | "promo-codes" | "users" | "suggestion" | "convex" | "study-materials" | "dau" | "aws" | "gemini" | "models" | "gravity-ads" | "payments" | "vm-isos";

const ADMIN_SESSION_KEY = "thalamus_admin_v2";

export default function AdminPage() {
  const [adminToken, setAdminToken] = useState(() => {
    try { return localStorage.getItem(ADMIN_SESSION_KEY) ?? ""; } catch { return ""; }
  });
  const [authed, setAuthed] = useState(false);
  const [loginPass, setLoginPass] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [tab, setTab] = useState<AdminTab>("users");
  // 2FA step: after the password, three security questions gate the login.
  const [loginStep, setLoginStep] = useState<"password" | "questions">("password");
  const [answers, setAnswers] = useState(["", "", ""]);
  const adminLoginAction = useAction(api.admin.adminLogin);

  // Verify stored session by testing against a known admin query.
  // We attempt to list promo codes — success means the token is valid.
  const storedTokenValid = useQuery(
    api.admin.verifyAdminToken,
    adminToken ? { token: adminToken } : "skip"
  );

  useEffect(() => {
    if (adminToken && storedTokenValid === true) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- auth state reacts to the async Convex token verification result; not derivable at render time without changing the login flow
      setAuthed(true);
      setIsVerifying(false);
    }
    if (adminToken && storedTokenValid === false) {
      setAdminToken("");
      setIsVerifying(false);
      try { localStorage.removeItem(ADMIN_SESSION_KEY); } catch { /* ignore */ }
      if (loginPass) toast.error("Invalid token");
    }
  }, [storedTokenValid, adminToken, loginPass]);

  const handleLogin = async () => {
    if (loginStep === "password") {
      if (!loginPass.trim()) return;
      setLoginStep("questions");
      return;
    }
    if (answers.some(a => !a.trim())) return;
    setIsVerifying(true);
    try {
      // Server-side check of password + all three answers; returns the admin
      // token only on success. Existing verifyAdminToken flow takes over.
      const result = await adminLoginAction({
        password: loginPass,
        answer1: answers[0],
        answer2: answers[1],
        answer3: answers[2],
      });
      try { localStorage.setItem(ADMIN_SESSION_KEY, result.token); } catch { /* ignore */ }
      setAdminToken(result.token);
    } catch {
      toast.error("Invalid credentials");
      setIsVerifying(false);
      setLoginStep("password");
      setAnswers(["", "", ""]);
    }
  };

  const SECURITY_QUESTIONS = [
    "Favourite game on Roblox",
    "Crush name",
    "Greatest enemy of all times",
  ];

  if (!authed) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <meta name="robots" content="noindex" />
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
            {loginStep === "password" ? (
              <div>
                <label className="text-xs font-bold text-muted-foreground mb-1.5 block">PASSWORD</label>
                <div className="relative">
                  <input
                    type={showPass ? "text" : "password"}
                    value={loginPass}
                    onChange={e => setLoginPass(e.target.value)}
                    onKeyDown={e => { if (e.key === "Enter") handleLogin(); }}
                    placeholder="Enter admin password"
                    className="w-full bg-background border border-border rounded-xl px-3 py-2.5 pr-10 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/60 transition-colors"
                  />
                  <button onClick={() => setShowPass(s => !s)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors">
                    {showPass ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <p className="text-xs font-bold text-muted-foreground">SECURITY VERIFICATION</p>
                {SECURITY_QUESTIONS.map((q, i) => (
                  <div key={q}>
                    <label className="text-[11px] text-muted-foreground mb-1 block">{q}</label>
                    <input
                      type="text"
                      value={answers[i]}
                      onChange={e => setAnswers(prev => prev.map((a, j) => (j === i ? e.target.value : a)))}
                      onKeyDown={e => { if (e.key === "Enter") handleLogin(); }}
                      className="w-full bg-background border border-border rounded-xl px-3 py-2 text-sm text-foreground focus:outline-none focus:border-primary/60 transition-colors"
                    />
                  </div>
                ))}
              </div>
            )}
            <button
              onClick={handleLogin}
              disabled={isVerifying || (loginStep === "password" ? !loginPass.trim() : answers.some(a => !a.trim()))}
              className="w-full bg-primary text-primary-foreground py-2.5 rounded-xl text-sm font-bold hover:bg-primary/90 transition-all disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {isVerifying ? <><Loader2 className="h-4 w-4 animate-spin" /> Verifying…</> : loginStep === "password" ? "Continue" : "Sign In"}
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
            onClick={() => { try { localStorage.removeItem(ADMIN_SESSION_KEY); } catch { /* ignore */ } setAuthed(false); setAdminToken(""); }}
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
            { id: "dau", label: "DAU", icon: TrendingUp },
            { id: "credits", label: "Credits", icon: DollarSign },
            { id: "promo-codes", label: "Promo Codes", icon: Tag },
            { id: "suggestion", label: "Suggestions", icon: Lightbulb },
            { id: "study-materials", label: "Study Materials", icon: BookOpen },
            { id: "convex", label: "Convex", icon: Database },
            { id: "aws", label: "AWS Bedrock", icon: Zap },
            { id: "gemini", label: "Gemini Keys", icon: Activity },
            { id: "models", label: "Model Config", icon: Cpu },
            { id: "gravity-ads", label: "GravityAds", icon: Globe },
            { id: "payments", label: "Payments", icon: Coins },
            { id: "vm-isos", label: "VM ISOs", icon: Database },
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
              {tab === "dau" && <DauTab adminToken={adminToken} />}
              {tab === "credits" && <CreditsTab adminToken={adminToken} />}
              {tab === "promo-codes" && <PromoCodesTab adminToken={adminToken} />}
              {tab === "suggestion" && <SuggestionsTab adminToken={adminToken} />}
              {tab === "study-materials" && <StudyMaterialsTab adminToken={adminToken} />}
              {tab === "aws" && <AwsBedrockTab adminToken={adminToken} />}
              {tab === "gemini" && <GeminiKeysTab adminToken={adminToken} />}
              {tab === "models" && <ModelConfigTab adminToken={adminToken} />}
              {tab === "gravity-ads" && <GravityAdsTab adminToken={adminToken} />}
              {tab === "payments" && <PaymentsTab adminToken={adminToken} />}
              {tab === "vm-isos" && <VmIsoCatalogTab adminToken={adminToken} />}
            </motion.div>
          </AnimatePresence>
        </main>
      </div>
    </div>
  );
}

// ── Users Tab ─────────────────────────────────────────────────────────────────
// Shape returned by api.admin.listUsers
type AdminUser = {
  _id: Id<"users">;
  email?: string;
  name?: string;
  dailyAgentBucks: number;
  purchasedAgentBucks: number;
  isBanned: boolean;
  warningCount: number;
  _creationTime: number;
};

function UsersTab({ adminToken }: { adminToken: string }) {
  const users = useQuery(api.admin.listUsers, { adminToken });
  const setDailyAllowance = useMutation(api.admin.setDailyAllowance);
  const addCredits = useMutation(api.admin.addPurchasedCredits);
  const [editingUser, setEditingUser] = useState<string | null>(null);
  const [newDaily, setNewDaily] = useState("");
  const [addAmount, setAddAmount] = useState("");
  const [search, setSearch] = useState("");

  const filtered = (users ?? []).filter((u: AdminUser) =>
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
          {filtered.map((user: AdminUser) => (
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

// ── DAU Tab ───────────────────────────────────────────────────────────────────
function DauTab({ adminToken }: { adminToken: string }) {
  const [days, setDays] = useState(30);
  const dauStats = useQuery(api.admin.getDauStats, { adminToken, days });
  const todayDau = useQuery(api.admin.getTodayDau, { adminToken });

  const maxDau = dauStats ? Math.max(...dauStats.map((d: { date: string; dau: number }) => d.dau), 1) : 1;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-foreground">Daily Active Users (DAU)</h2>
        <p className="text-sm text-muted-foreground">Real-time tracking of unique active users per day</p>
      </div>

      {/* Today's DAU card */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-card border border-primary/40 rounded-xl p-6 shadow-lg"
      >
        <div className="flex items-center gap-3 mb-2">
          <div className="w-10 h-10 rounded-xl bg-primary/20 border border-primary/40 flex items-center justify-center">
            <Activity className="h-5 w-5 text-primary" />
          </div>
          <div>
            <p className="text-xs font-bold text-muted-foreground">TODAY'S DAU</p>
            <p className="text-xs text-muted-foreground">{new Date().toLocaleDateString()}</p>
          </div>
        </div>
        <p className="text-5xl font-bold text-primary">
          {todayDau !== undefined ? todayDau.toLocaleString() : <Loader2 className="h-10 w-10 animate-spin text-muted-foreground inline-block" />}
        </p>
        <p className="text-xs text-muted-foreground mt-2">Unique users active today</p>
      </motion.div>

      {/* Time range selector */}
      <div className="flex items-center gap-2">
        <p className="text-xs font-bold text-muted-foreground">TIME RANGE:</p>
        {[7, 14, 30, 60, 90].map(d => (
          <button
            key={d}
            onClick={() => setDays(d)}
            className={`px-3 py-1.5 text-xs rounded-lg transition-all ${
              days === d
                ? "bg-primary/15 text-primary border border-primary/30 font-bold"
                : "bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground"
            }`}
          >
            {d} days
          </button>
        ))}
      </div>

      {/* DAU chart */}
      {!dauStats ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="bg-card border border-border rounded-xl p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-bold text-foreground">DAU Trend</h3>
            <div className="flex items-center gap-4 text-xs">
              <div className="flex items-center gap-1.5">
                <TrendingUp className="h-3 w-3 text-emerald-400" />
                <span className="text-muted-foreground">Peak:</span>
                <span className="font-bold text-emerald-400">{maxDau.toLocaleString()}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <Activity className="h-3 w-3 text-primary" />
                <span className="text-muted-foreground">Avg:</span>
                <span className="font-bold text-primary">
                  {dauStats.length > 0 ? Math.round(dauStats.reduce((sum: number, d: { date: string; dau: number }) => sum + d.dau, 0) / dauStats.length).toLocaleString() : 0}
                </span>
              </div>
            </div>
          </div>

          {/* Bar chart */}
          <div className="space-y-1">
            {dauStats.map((stat: { date: string; dau: number }, idx: number) => {
              const pct = maxDau > 0 ? (stat.dau / maxDau) * 100 : 0;
              const isToday = stat.date === new Date().toISOString().slice(0, 10);
              const dateObj = new Date(stat.date + "T00:00:00Z");
              const dateLabel = dateObj.toLocaleDateString("en-US", { month: "short", day: "numeric" });

              return (
                <motion.div
                  key={stat.date}
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: idx * 0.01 }}
                  className="flex items-center gap-3"
                >
                  <div className="w-16 text-[10px] text-muted-foreground text-right shrink-0">
                    {dateLabel}
                  </div>
                  <div className="flex-1 relative">
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ width: `${pct}%` }}
                      transition={{ duration: 0.5, delay: idx * 0.01 }}
                      className={`h-8 rounded-lg flex items-center justify-end px-2 ${
                        isToday
                          ? "bg-primary/20 border border-primary/40"
                          : pct > 70
                          ? "bg-emerald-400/20 border border-emerald-400/30"
                          : pct > 40
                          ? "bg-blue-400/20 border border-blue-400/30"
                          : "bg-muted/60 border border-border"
                      }`}
                    >
                      <span className={`text-xs font-bold ${
                        isToday ? "text-primary" : pct > 40 ? "text-foreground" : "text-muted-foreground"
                      }`}>
                        {stat.dau}
                      </span>
                    </motion.div>
                  </div>
                  {isToday && (
                    <span className="text-[10px] bg-primary/15 text-primary border border-primary/30 px-1.5 py-0.5 rounded-full font-bold shrink-0">
                      TODAY
                    </span>
                  )}
                </motion.div>
              );
            })}
          </div>

          {dauStats.length === 0 && (
            <p className="text-center text-muted-foreground py-12 text-sm">No DAU data available</p>
          )}
        </div>
      )}

      {/* Stats summary */}
      {dauStats && dauStats.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="bg-card border border-border rounded-xl p-5">
            <div className="flex items-center gap-2 mb-2">
              <TrendingUp className="h-4 w-4 text-emerald-400" />
              <p className="text-xs font-bold text-muted-foreground">PEAK DAU</p>
            </div>
            <p className="text-2xl font-bold text-emerald-400">{maxDau.toLocaleString()}</p>
            <p className="text-[10px] text-muted-foreground mt-1">Highest in selected period</p>
          </div>
          <div className="bg-card border border-border rounded-xl p-5">
            <div className="flex items-center gap-2 mb-2">
              <Activity className="h-4 w-4 text-primary" />
              <p className="text-xs font-bold text-muted-foreground">AVERAGE DAU</p>
            </div>
            <p className="text-2xl font-bold text-primary">
              {Math.round(dauStats.reduce((sum: number, d: { date: string; dau: number }) => sum + d.dau, 0) / dauStats.length).toLocaleString()}
            </p>
            <p className="text-[10px] text-muted-foreground mt-1">Mean across {days} days</p>
          </div>
          <div className="bg-card border border-border rounded-xl p-5">
            <div className="flex items-center gap-2 mb-2">
              <Users className="h-4 w-4 text-blue-400" />
              <p className="text-xs font-bold text-muted-foreground">TOTAL DAYS</p>
            </div>
            <p className="text-2xl font-bold text-blue-400">{dauStats.length.toLocaleString()}</p>
            <p className="text-[10px] text-muted-foreground mt-1">Days with activity tracked</p>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Platform pricing rates ($ per million tokens) ─────────────────────────────
const PLATFORM_PRICING = [
  { modelId: "gemini-3.1-flash-lite", displayName: "Gemini 3.1 Flash Lite", input: 0.60, output: 2.40 },
  { modelId: "claude-haiku-4-5",  displayName: "Claude Haiku 4.5",  input: 1.80,  output: 7.20  },
  { modelId: "claude-sonnet-4-6", displayName: "Claude Sonnet 4.6", input: 5.40,  output: 26.50 },
  { modelId: "claude-opus-4-6",   displayName: "Claude Opus 4.6",   input: 7.44,  output: 42.00 },
  { modelId: "claude-opus-4-8",   displayName: "Claude Opus 4.8",   input: 12.00, output: 60.00 },
];

// ── Credits Tab ───────────────────────────────────────────────────────────────
function CreditsTab({ adminToken }: { adminToken: string }) {
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
  // Captured once so render stays pure (react-hooks/purity)
  const [now] = useState(() => Date.now());

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
          {promoCodes.map((code: Doc<"promoCodes">) => (
            <div key={code._id} className="bg-card border border-border rounded-xl p-4 flex items-center justify-between gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1 flex-wrap">
                  <span className="font-bold text-foreground font-mono">{code.code}</span>
                  {code.maxUses != null && code.usedCount >= code.maxUses && (
                    <span className="text-[10px] bg-destructive/15 text-destructive border border-destructive/30 px-1.5 py-0.5 rounded-full font-bold">EXHAUSTED</span>
                  )}
                  {code.expiresAt < now && (
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
// ── Study Materials Tab ───────────────────────────────────────────────────────
function StudyMaterialsTab({ adminToken }: { adminToken: string }) {
  const materials = useQuery(api.admin.listAdminStudyMaterials, { adminToken });
  const addMaterial = useMutation(api.admin.addAdminStudyMaterial);
  const deleteMaterial = useMutation(api.admin.deleteAdminStudyMaterial);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [mode, setMode] = useState<"all" | "study" | "chat" | "research">("study");
  const [isAdding, setIsAdding] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    setTitle(prev => prev || file.name.replace(/\.[^.]+$/, ""));
    setContent(text.slice(0, 50000));
    if (e.target) e.target.value = "";
    toast.success(`Loaded: ${file.name}`);
  };

  const handleAdd = async () => {
    if (!title.trim() || !content.trim()) { toast.error("Title and content required"); return; }
    setIsAdding(true);
    try {
      await addMaterial({ adminToken, title: title.trim(), content: content.trim(), mode });
      toast.success("Study material added");
      setTitle(""); setContent(""); setMode("study");
    } catch (err) { toast.error(err instanceof Error ? err.message : "Failed"); }
    finally { setIsAdding(false); }
  };

  const handleDelete = async (id: Id<"adminStudyMaterials">) => {
    if (!confirm("Delete this material?")) return;
    try { await deleteMaterial({ adminToken, id }); toast.success("Deleted"); }
    catch (err) { toast.error(err instanceof Error ? err.message : "Failed"); }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-foreground">Study Materials</h2>
        <p className="text-sm text-muted-foreground">Upload reference documents that the AI will use as its primary knowledge source when responding in the selected mode.</p>
      </div>

      {/* Upload form */}
      <div className="bg-card border border-border rounded-xl p-5 space-y-4">
        <h3 className="text-sm font-bold text-foreground">Upload New Material</h3>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-bold text-muted-foreground mb-1.5 block">TITLE</label>
            <input value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Physics Chapter 5 Notes"
              className="w-full bg-background border border-border rounded-xl px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/60 transition-colors" />
          </div>
          <div>
            <label className="text-xs font-bold text-muted-foreground mb-1.5 block">APPLIES TO MODE</label>
            <select value={mode} onChange={e => setMode(e.target.value as typeof mode)}
              className="w-full bg-background border border-border rounded-xl px-3 py-2 text-sm text-foreground focus:outline-none focus:border-primary/60 transition-colors">
              <option value="all">All Modes</option>
              <option value="study">Study Mode Only</option>
              <option value="chat">Chat Mode Only</option>
              <option value="research">Research Mode Only</option>
            </select>
          </div>
        </div>
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-xs font-bold text-muted-foreground">CONTENT</label>
            <label className="flex items-center gap-1.5 text-xs text-primary cursor-pointer hover:text-primary/80 transition-colors">
              <Upload className="h-3 w-3" />
              Upload File
              <input ref={fileInputRef} type="file" className="hidden" accept=".txt,.md,.csv,.json,.pdf,.doc,.docx,.html" onChange={handleFileUpload} />
            </label>
          </div>
          <textarea value={content} onChange={e => setContent(e.target.value)} placeholder="Paste content or upload a file above..."
            rows={8} className="w-full bg-background border border-border rounded-xl px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground resize-none focus:outline-none focus:border-primary/60 transition-colors" />
          <p className="text-[10px] text-muted-foreground mt-1">{content.length.toLocaleString()} / 50,000 characters</p>
        </div>
        <button onClick={handleAdd} disabled={isAdding || !title.trim() || !content.trim()}
          className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-xl text-sm font-bold hover:bg-primary/90 disabled:opacity-50 transition-all">
          {isAdding ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          Add Material
        </button>
      </div>

      {/* Materials list */}
      <div>
        <h3 className="text-sm font-bold text-foreground mb-3">Uploaded Materials ({materials?.length ?? 0})</h3>
        {!materials ? (
          <div className="flex items-center justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : materials.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            <BookOpen className="h-10 w-10 mx-auto mb-3 opacity-30" />
            <p className="text-sm">No study materials uploaded yet</p>
          </div>
        ) : (
          <div className="space-y-3">
            {materials.map((m: Doc<"adminStudyMaterials">) => (
              <div key={m._id} className="bg-card border border-border rounded-xl p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <FileText className="h-4 w-4 text-primary shrink-0" />
                      <p className="font-bold text-sm text-foreground truncate">{m.title}</p>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full border font-bold shrink-0 ${
                        (m.mode ?? "all") === "all" ? "bg-primary/10 text-primary border-primary/20" :
                        (m.mode ?? "all") === "study" ? "bg-indigo-400/10 text-indigo-400 border-indigo-400/20" :
                        (m.mode ?? "all") === "chat" ? "bg-emerald-400/10 text-emerald-400 border-emerald-400/20" :
                        "bg-blue-400/10 text-blue-400 border-blue-400/20"
                      }`}>{(m.mode ?? "all").toUpperCase()}</span>
                    </div>
                    <p className="text-[10px] text-muted-foreground line-clamp-2">{m.content.slice(0, 150)}</p>
                    <p className="text-[9px] text-muted-foreground/60 mt-1">{m.content.length.toLocaleString()} chars · Added {new Date(m.createdAt).toLocaleDateString()}</p>
                  </div>
                  <button onClick={() => handleDelete(m._id as Id<"adminStudyMaterials">)}
                    className="shrink-0 p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-all">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function SuggestionsTab({ adminToken }: { adminToken: string }) {
  const suggestions = useQuery(api.admin.listSuggestions, { adminToken });
  const updateStatus = useMutation(api.admin.updateSuggestionStatus);
  const deleteSuggestion = useMutation(api.admin.deleteSuggestion);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [filter, setFilter] = useState<string>("all");

  const filtered = (suggestions ?? []).filter((s: Doc<"suggestions">) => filter === "all" || s.status === filter);

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
          {filtered.map((s: Doc<"suggestions">) => (
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

// ── AWS Bedrock Tab ───────────────────────────────────────────────────────────
function AwsBedrockTab({ adminToken }: { adminToken: string }) {
  const existing = useQuery(api.admin.getAwsCredentials, { adminToken });
  const saveCredentials = useMutation(api.admin.saveAwsCredentials);
  const [accessKeyId, setAccessKeyId] = useState("");
  const [secretAccessKey, setSecretAccessKey] = useState("");
  const [region, setRegion] = useState<string>("ap-southeast-1");
  const [showSecret, setShowSecret] = useState(false);
  const [saving, setSaving] = useState(false);

  // Sync region from DB when credentials load
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- seeds the editable region field from the DB once credentials load; the field is also user-editable so it cannot be derived during render
    if (existing?.region) setRegion(existing.region);
  }, [existing?.region]);

  const handleSave = async () => {
    if (!accessKeyId.trim() || !secretAccessKey.trim()) {
      toast.error("Access Key ID and Secret are required");
      return;
    }
    setSaving(true);
    try {
      await saveCredentials({ adminToken, accessKeyId: accessKeyId.trim(), secretAccessKey: secretAccessKey.trim(), region: region.trim() });
      toast.success("AWS Bedrock credentials saved");
      setAccessKeyId("");
      setSecretAccessKey("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-2xl">
      <div className="mb-6">
        <h2 className="text-xl font-bold text-foreground">AWS Bedrock Credentials</h2>
        <p className="text-sm text-muted-foreground mt-1">IAM credentials used for Claude Bedrock API calls (streaming chat, study mode, code mode)</p>
      </div>

      {/* Current status */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className={`mb-6 p-4 rounded-xl border ${existing ? "bg-emerald-400/10 border-emerald-400/30" : "bg-amber-400/10 border-amber-400/30"}`}
      >
        <div className="flex items-center gap-2">
          {existing ? (
            <>
              <CheckCircle className="h-4 w-4 text-emerald-400" />
              <span className="text-sm font-bold text-emerald-400">Credentials configured</span>
            </>
          ) : (
            <>
              <AlertCircle className="h-4 w-4 text-amber-400" />
              <span className="text-sm font-bold text-amber-400">No credentials set — Bedrock calls will fail</span>
            </>
          )}
        </div>
        {existing && (
          <div className="mt-2 space-y-1 text-xs text-muted-foreground">
            <p>Access Key ID: <span className="font-mono text-foreground">{existing.accessKeyId.slice(0, 4)}...{existing.accessKeyId.slice(-4)}</span></p>
            <p>Region: <span className="font-mono text-foreground">{existing.region}</span></p>
            <p>Last updated: <span className="text-foreground">{existing.updatedAt ? new Date(existing.updatedAt).toLocaleString() : "—"}</span></p>
          </div>
        )}
      </motion.div>

      {/* Credential form */}
      <div className="bg-card border border-border rounded-xl p-6 space-y-4">
        <h3 className="text-sm font-bold text-foreground">Update Credentials</h3>

        <div>
          <label className="text-xs font-bold text-muted-foreground mb-1.5 block">AWS ACCESS KEY ID</label>
          <input
            value={accessKeyId}
            onChange={e => setAccessKeyId(e.target.value)}
            placeholder="AKIAIOSFODNN7EXAMPLE"
            className="w-full bg-background border border-border rounded-xl px-3 py-2.5 text-sm font-mono text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/60 transition-colors"
          />
        </div>

        <div>
          <label className="text-xs font-bold text-muted-foreground mb-1.5 block">AWS SECRET ACCESS KEY</label>
          <div className="relative">
            <input
              type={showSecret ? "text" : "password"}
              value={secretAccessKey}
              onChange={e => setSecretAccessKey(e.target.value)}
              placeholder="wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY"
              className="w-full bg-background border border-border rounded-xl px-3 py-2.5 pr-10 text-sm font-mono text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/60 transition-colors"
            />
            <button onClick={() => setShowSecret(s => !s)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors">
              {showSecret ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </div>

        <div>
          <label className="text-xs font-bold text-muted-foreground mb-1.5 block">AWS REGION</label>
          <select
            value={region}
            onChange={e => setRegion(e.target.value)}
            className="w-full bg-background border border-border rounded-xl px-3 py-2.5 text-sm text-foreground focus:outline-none focus:border-primary/60 transition-colors"
          >
            <option value="us-east-1">us-east-1 (N. Virginia)</option>
            <option value="us-west-2">us-west-2 (Oregon)</option>
            <option value="eu-west-1">eu-west-1 (Ireland)</option>
            <option value="eu-central-1">eu-central-1 (Frankfurt)</option>
            <option value="ap-southeast-1">ap-southeast-1 (Singapore)</option>
            <option value="ap-northeast-1">ap-northeast-1 (Tokyo)</option>
            <option value="ap-south-1">ap-south-1 (Mumbai)</option>
            <option value="ap-southeast-2">ap-southeast-2 (Sydney)</option>
          </select>
        </div>

        <button
          onClick={handleSave}
          disabled={saving || !accessKeyId.trim() || !secretAccessKey.trim()}
          className="w-full py-2.5 bg-primary text-primary-foreground rounded-xl text-sm font-bold hover:bg-primary/90 disabled:opacity-50 transition-all flex items-center justify-center gap-2"
        >
          {saving ? <><Loader2 className="h-4 w-4 animate-spin" />Saving...</> : <><Check className="h-4 w-4" />Save Credentials</>}
        </button>

        <p className="text-xs text-muted-foreground">
          Credentials are stored server-side only. Select the region where your Bedrock model access is enabled.
        </p>
      </div>

      {/* IAM permissions info */}
      <div className="mt-4 bg-muted/30 border border-border rounded-xl p-4">
        <p className="text-xs font-bold text-muted-foreground mb-2">REQUIRED IAM PERMISSIONS</p>
        <pre className="text-xs text-foreground font-mono bg-background rounded-lg p-3 overflow-x-auto">{`{
  "Effect": "Allow",
  "Action": [
    "bedrock:InvokeModel",
    "bedrock:InvokeModelWithResponseStream"
  ],
  "Resource": "arn:aws:bedrock:*::foundation-model/anthropic.claude*"
}`}</pre>
      </div>
    </div>
  );
}

// ── Gemini Keys Tab ───────────────────────────────────────────────────────────
function GeminiKeysTab({ adminToken }: { adminToken: string }) {
  const existing = useQuery(api.admin.getGeminiKeys, { adminToken });
  const saveKeys = useMutation(api.admin.saveGeminiKeys);
  const [keysText, setKeysText] = useState("");
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    const newKeys = keysText
      .split(/[\n,]+/)
      .map(k => k.trim())
      .filter(k => k.startsWith("AIza") && k.length > 20);
    if (newKeys.length === 0) {
      toast.error("No valid Gemini API keys found. Keys must start with 'AIza'.");
      return;
    }
    setSaving(true);
    try {
      await saveKeys({ adminToken, keys: newKeys, append: true });
      toast.success(`Added ${newKeys.length} Gemini API keys`);
      setKeysText("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-2xl">
      <div className="mb-6">
        <h2 className="text-xl font-bold text-foreground">Gemini API Keys</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Keys are stored securely in the database — never in source code or git.
        </p>
      </div>

      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className={`mb-6 p-4 rounded-xl border ${existing && existing.count > 0 ? "bg-emerald-400/10 border-emerald-400/30" : "bg-amber-400/10 border-amber-400/30"}`}
      >
        <div className="flex items-center gap-2">
          {existing && existing.count > 0 ? (
            <>
              <CheckCircle className="h-4 w-4 text-emerald-400" />
              <span className="text-sm font-bold text-emerald-400">{existing.count} keys configured</span>
            </>
          ) : (
            <>
              <AlertCircle className="h-4 w-4 text-amber-400" />
              <span className="text-sm font-bold text-amber-400">No keys set — Gemini fallback will fail</span>
            </>
          )}
        </div>
        {existing && existing.count > 0 && (
          <div className="mt-2 space-y-1 text-xs text-muted-foreground">
            <p>Last updated: <span className="text-foreground">{existing.updatedAt ? new Date(existing.updatedAt).toLocaleString() : "—"}</span></p>
            <div className="mt-2 flex flex-wrap gap-1">
              {existing.maskedKeys.slice(0, 6).map((k: string, i: number) => (
                <span key={i} className="font-mono bg-muted/50 border border-border rounded px-1.5 py-0.5 text-[10px]">{k}</span>
              ))}
              {existing.maskedKeys.length > 6 && (
                <span className="text-[10px] text-muted-foreground">+{existing.maskedKeys.length - 6} more</span>
              )}
            </div>
          </div>
        )}
      </motion.div>

      <div className="bg-card border border-border rounded-xl p-6 space-y-4">
        <h3 className="text-sm font-bold text-foreground">Add Keys (appends to existing)</h3>
        <div>
          <label className="text-xs font-bold text-muted-foreground mb-1.5 block">
            PASTE KEYS (one per line, or comma-separated)
          </label>
          <textarea
            value={keysText}
            onChange={e => setKeysText(e.target.value)}
            placeholder={"AIzaSyXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX\nAIzaSyYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYY"}
            rows={8}
            className="w-full bg-background border border-border rounded-xl px-3 py-2.5 text-xs font-mono text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/60 transition-colors resize-none"
          />
          <p className="text-[10px] text-muted-foreground mt-1">
            This will <strong>replace</strong> all existing keys. Paste all keys you want active.
          </p>
        </div>

        <button
          onClick={handleSave}
          disabled={saving || !keysText.trim()}
          className="w-full py-2.5 bg-primary text-primary-foreground rounded-xl text-sm font-bold hover:bg-primary/90 disabled:opacity-50 transition-all flex items-center justify-center gap-2"
        >
          {saving ? <><Loader2 className="h-4 w-4 animate-spin" />Saving...</> : <><Check className="h-4 w-4" />Save Keys</>}
        </button>

        <div className="p-3 bg-muted/30 border border-border rounded-xl">
          <p className="text-xs font-bold text-muted-foreground mb-1">HOW IT WORKS</p>
          <ul className="text-xs text-muted-foreground space-y-1 list-disc list-inside">
            <li>Keys are stored encrypted in Convex DB — never in source code</li>
            <li>Code reads keys from DB at runtime — no env vars needed</li>
            <li>Add new keys here anytime without touching code or git</li>
            <li>Keys rotate automatically on 429/403 errors</li>
          </ul>
        </div>
      </div>
    </div>
  );
}

// ── Model Config Tab ──────────────────────────────────────────────────────────
const AGENT_NAMES = ["Researcher", "Analyser", "Planner", "Coder", "Optimiser", "Organizer", "Tester", "Hacker", "Critic"];
const RUN_MODES_LIST = ["cheap", "balanced", "powerful"] as const;
const BEDROCK_MODELS = [
  { id: "us.anthropic.claude-haiku-4-5-20251001-v1:0", label: "Claude Haiku 4.5" },
  { id: "us.anthropic.claude-sonnet-4-6-20251001-v1:0", label: "Claude Sonnet 4.6" },
  { id: "us.anthropic.claude-opus-4-6-20250514-v1:0", label: "Claude Opus 4.6" },
  { id: "us.anthropic.claude-opus-4-8-20251101-v1:0", label: "Claude Opus 4.8" },
];
const GEMINI_MODELS_LIST = [
  { id: "gemini-2.0-flash", label: "Gemini 2.0 Flash" },
  { id: "gemini-2.0-flash-lite", label: "Gemini 2.0 Flash Lite" },
  { id: "gemini-3.1-flash-lite", label: "Gemini 3.1 Flash Lite" },
];

function ModelConfigTab({ adminToken }: { adminToken: string }) {
  const existingConfigs = useQuery(api.admin.listAgentModelConfigs, { adminToken });
  const saveConfig = useMutation(api.admin.saveAgentModelConfig);
  const [saving, setSaving] = useState<string | null>(null);
  const [configs, setConfigs] = useState<Record<string, { modelId: string; provider: string; customEndpoint?: string }>>({});

  useEffect(() => {
    if (existingConfigs) {
      const map: typeof configs = {};
      existingConfigs.forEach((c: Doc<"agentModelConfig">) => {
        map[`${c.agentName}::${c.runMode}`] = { modelId: c.modelId, provider: c.provider, customEndpoint: c.customEndpoint };
      });
      // eslint-disable-next-line react-hooks/set-state-in-effect -- seeds the editable config form from the DB once configs load; the form is also user-editable so it cannot be derived during render
      setConfigs(map);
    }
  }, [existingConfigs]);

  const handleSave = async (agentName: string, runMode: string) => {
    const key = `${agentName}::${runMode}`;
    const cfg = configs[key];
    if (!cfg) return;
    setSaving(key);
    try {
      await saveConfig({ adminToken, agentName, runMode, modelId: cfg.modelId, provider: cfg.provider, customEndpoint: cfg.customEndpoint });
      toast.success(`Saved ${agentName} (${runMode})`);
    } catch { toast.error("Save failed"); }
    finally { setSaving(null); }
  };

  const getConfig = (agentName: string, runMode: string) => configs[`${agentName}::${runMode}`] ?? { modelId: "", provider: "bedrock" };
  const setConfig = (agentName: string, runMode: string, field: string, value: string) => {
    const key = `${agentName}::${runMode}`;
    setConfigs(prev => ({ ...prev, [key]: { ...getConfig(agentName, runMode), [field]: value } }));
  };

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h2 className="text-lg font-bold text-foreground">Model Configuration</h2>
        <p className="text-sm text-muted-foreground mt-1">Override the default model for each agent and run mode.</p>
      </div>
      <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-4 text-xs text-amber-400">
        <strong>Note:</strong> Changes take effect on the next pipeline run. Select "Custom Endpoint" for self-hosted or fine-tuned models.
      </div>
      <div className="space-y-3">
        {AGENT_NAMES.map(agentName => (
          <div key={agentName} className="bg-card border border-border rounded-xl overflow-hidden">
            <div className="px-4 py-2.5 border-b border-border bg-muted/30">
              <span className="text-sm font-bold text-foreground">{agentName}</span>
            </div>
            <div className="grid grid-cols-3 divide-x divide-border">
              {RUN_MODES_LIST.map(runMode => {
                const key = `${agentName}::${runMode}`;
                const cfg = getConfig(agentName, runMode);
                return (
                  <div key={runMode} className="p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className={`text-[10px] font-bold uppercase ${runMode === "cheap" ? "text-green-500" : runMode === "balanced" ? "text-blue-400" : "text-purple-400"}`}>{runMode}</span>
                      <button onClick={() => handleSave(agentName, runMode)} disabled={saving === key || !cfg.modelId}
                        className="text-[10px] px-2 py-0.5 rounded bg-primary/20 text-primary hover:bg-primary/30 disabled:opacity-40 flex items-center gap-1">
                        {saving === key ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : <Check className="h-2.5 w-2.5" />}Save
                      </button>
                    </div>
                    <select value={cfg.provider} onChange={e => setConfig(agentName, runMode, "provider", e.target.value)}
                      className="w-full bg-background border border-border rounded-lg px-2 py-1.5 text-xs text-foreground focus:outline-none">
                      <option value="bedrock">Bedrock (Claude)</option><option value="gemini">Gemini</option><option value="custom">Custom Endpoint</option>
                    </select>
                    {cfg.provider === "bedrock" && (
                      <select value={cfg.modelId} onChange={e => setConfig(agentName, runMode, "modelId", e.target.value)}
                        className="w-full bg-background border border-border rounded-lg px-2 py-1.5 text-xs text-foreground focus:outline-none">
                        <option value="">— default —</option>
                        {BEDROCK_MODELS.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
                      </select>
                    )}
                    {cfg.provider === "gemini" && (
                      <select value={cfg.modelId} onChange={e => setConfig(agentName, runMode, "modelId", e.target.value)}
                        className="w-full bg-background border border-border rounded-lg px-2 py-1.5 text-xs text-foreground focus:outline-none">
                        <option value="">— default —</option>
                        {GEMINI_MODELS_LIST.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
                      </select>
                    )}
                    {cfg.provider === "custom" && (
                      <input value={cfg.customEndpoint ?? ""} onChange={e => setConfig(agentName, runMode, "customEndpoint", e.target.value)}
                        placeholder="https://your-model/v1" className="w-full bg-background border border-border rounded-lg px-2 py-1.5 text-[10px] font-mono text-foreground focus:outline-none" />
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── GravityAds Tab ────────────────────────────────────────────────────────────
function GravityAdsTab({ adminToken }: { adminToken: string }) {
  const existing = useQuery(api.gravityAds.getGravityAdsConfig, { adminToken });
  const saveConfig = useMutation(api.gravityAds.saveGravityAdsConfig);
  const [apiKey, setApiKey] = useState("");
  const [publisherId, setPublisherId] = useState("");
  const [adUnitIds, setAdUnitIds] = useState("");
  const [isEnabled, setIsEnabled] = useState(false);
  const [showToGuests, setShowToGuests] = useState(true);
  const [showToFreeUsers, setShowToFreeUsers] = useState(true);
  const [showToPaidUsers, setShowToPaidUsers] = useState(false);
  const [restrictedCategories, setRestrictedCategories] = useState("");
  const [testAdMode, setTestAdMode] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showKey, setShowKey] = useState(false);

  useEffect(() => {
    if (existing) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- seeds the editable ads config form from the DB once it loads; the form is also user-editable so it cannot be derived during render
      setApiKey(existing.apiKey ?? "");
      setPublisherId(existing.publisherId ?? "");
      setAdUnitIds((existing.adUnitIds ?? []).join("\n"));
      setIsEnabled(existing.isEnabled ?? false);
      setShowToGuests(existing.showToGuests ?? true);
      setShowToFreeUsers(existing.showToFreeUsers ?? true);
      setShowToPaidUsers(existing.showToPaidUsers ?? false);
      setRestrictedCategories((existing.restrictedCategories ?? []).join("\n"));
      setTestAdMode(existing.testAdMode ?? false);
    }
  }, [existing]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await saveConfig({ adminToken, apiKey, publisherId: publisherId || undefined,
        adUnitIds: adUnitIds.trim() ? adUnitIds.split("\n").map(s => s.trim()).filter(Boolean) : undefined,
        isEnabled, showToGuests, showToFreeUsers, showToPaidUsers,
        restrictedCategories: restrictedCategories.trim() ? restrictedCategories.split("\n").map(s => s.trim()).filter(Boolean) : undefined,
        testAdMode });
      toast.success("GravityAds config saved");
    } catch (e) { toast.error(e instanceof Error ? e.message : "Save failed"); }
    finally { setSaving(false); }
  };

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h2 className="text-lg font-bold text-foreground">GravityAds Integration</h2>
        <p className="text-sm text-muted-foreground mt-1">Once approved by GravityAds, enter your key here — ads go live immediately.</p>
      </div>
      <div className="bg-card border border-border rounded-xl p-6 space-y-5">
        <div className="flex items-center justify-between">
          <div><p className="text-sm font-semibold text-foreground">Ads Enabled</p><p className="text-xs text-muted-foreground">Master switch</p></div>
          <button onClick={() => setIsEnabled(v => !v)} className={`relative w-10 h-5 rounded-full transition-all ${isEnabled ? "bg-primary" : "bg-muted"}`}>
            <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${isEnabled ? "left-5" : "left-0.5"}`} />
          </button>
        </div>
        <div className="flex items-center justify-between">
          <div><p className="text-sm font-semibold text-amber-400">Test Ads</p><p className="text-xs text-muted-foreground">Show Gravity sample creatives (no billing) — use to verify placements render before real ads fill</p></div>
          <button onClick={() => setTestAdMode(v => !v)} className={`relative w-10 h-5 rounded-full transition-all ${testAdMode ? "bg-amber-500" : "bg-muted"}`}>
            <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${testAdMode ? "left-5" : "left-0.5"}`} />
          </button>
        </div>
        <div>
          <label className="text-xs font-bold text-muted-foreground mb-1.5 block">GRAVITYADS API KEY</label>
          <div className="relative">
            <input type={showKey ? "text" : "password"} value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder="Enter your GravityAds API key"
              className="w-full bg-background border border-border rounded-xl px-3 py-2.5 pr-10 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/60 transition-colors" />
            <button onClick={() => setShowKey(v => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors">
              {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </div>
        <div>
          <label className="text-xs font-bold text-muted-foreground mb-1.5 block">PUBLISHER ID <span className="font-normal">(optional)</span></label>
          <input value={publisherId} onChange={e => setPublisherId(e.target.value)} placeholder="pub-xxxxxxxxxxxxxxxx"
            className="w-full bg-background border border-border rounded-xl px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/60 transition-colors" />
        </div>
        <div>
          <label className="text-xs font-bold text-muted-foreground mb-1.5 block">AD UNIT IDs <span className="font-normal">(one per line)</span></label>
          <textarea value={adUnitIds} onChange={e => setAdUnitIds(e.target.value)} placeholder={"ca-app-pub-xxx/yyy\nca-app-pub-xxx/zzz"} rows={3}
            className="w-full bg-background border border-border rounded-xl px-3 py-2.5 text-xs font-mono text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/60 transition-colors resize-none" />
        </div>
        <div>
          <label className="text-xs font-bold text-muted-foreground mb-1.5 block">RESTRICTED ADVERTISER CATEGORIES <span className="font-normal">(one per line — never serve ads from these)</span></label>
          <textarea value={restrictedCategories} onChange={e => setRestrictedCategories(e.target.value)} placeholder={"AI coding assistants\nThalamus alternatives"} rows={4}
            className="w-full bg-background border border-border rounded-xl px-3 py-2.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/60 transition-colors resize-none" />
        </div>
        <div className="space-y-2.5">
          <p className="text-xs font-bold text-muted-foreground">SHOW ADS TO</p>
          {([["Guest users (not signed in)", showToGuests, setShowToGuests], ["Free signed-in users", showToFreeUsers, setShowToFreeUsers], ["Paid users", showToPaidUsers, setShowToPaidUsers]] as const).map(([label, val, set]) => (
            <div key={label as string} className="flex items-center justify-between">
              <span className="text-sm text-foreground">{label as string}</span>
              <button onClick={() => set(v => !v)} className={`relative w-9 h-5 rounded-full transition-all ${val ? "bg-primary" : "bg-muted"}`}>
                <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${val ? "left-4" : "left-0.5"}`} />
              </button>
            </div>
          ))}
        </div>
        <button onClick={handleSave} disabled={saving}
          className="w-full py-2.5 bg-primary text-primary-foreground rounded-xl text-sm font-bold hover:bg-primary/90 disabled:opacity-50 transition-all flex items-center justify-center gap-2">
          {saving ? <><Loader2 className="h-4 w-4 animate-spin" />Saving…</> : <><Check className="h-4 w-4" />Save Config</>}
        </button>
      </div>
      <div className="bg-muted/30 border border-border rounded-xl p-4 text-xs text-muted-foreground">
        The API key is stored encrypted — never sent to the browser. Ad display is controlled by the toggles above.
      </div>
    </div>
  );
}
// ── Payments Tab ──────────────────────────────────────────────────────────────
function PaymentsTab({ adminToken }: { adminToken: string }) {
  const existing = useQuery(api.payments.getPaymentsConfig, { adminToken });
  const saveConfig = useMutation(api.payments.savePaymentsConfig);
  const [isEnabled, setIsEnabled] = useState(false);
  const [bmacPageUrl, setBmacPageUrl] = useState("");
  const [webhookSecret, setWebhookSecret] = useState("");
  const [abPerCent, setAbPerCent] = useState("15000");
  const [saving, setSaving] = useState(false);
  const [showSecret, setShowSecret] = useState(false);

  useEffect(() => {
    if (existing) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- seeds the editable payments form from the DB once it loads; the form is also user-editable so it cannot be derived during render
      setIsEnabled(existing.isEnabled ?? false);
      setBmacPageUrl(existing.bmacPageUrl ?? "");
      setWebhookSecret(existing.webhookSecret ?? "");
      setAbPerCent(String(existing.abPerCent ?? 15000));
    }
  }, [existing]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const rate = Number(abPerCent);
      await saveConfig({
        adminToken,
        isEnabled,
        bmacPageUrl,
        webhookSecret: webhookSecret || undefined,
        abPerCent: Number.isFinite(rate) && rate > 0 ? rate : undefined,
      });
      toast.success("Payments config saved");
    } catch (e) { toast.error(e instanceof Error ? e.message : "Save failed"); }
    finally { setSaving(false); }
  };

  const webhookUrl = `${(import.meta.env.VITE_CONVEX_URL as string ?? "").replace(".convex.cloud", ".convex.site")}/bmac/webhook`;

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h2 className="text-lg font-bold text-foreground">Payments (Buy Me a Coffee)</h2>
        <p className="text-sm text-muted-foreground mt-1">Purchases stay hidden from users until enabled here. The webhook keeps crediting completed payments regardless of the switch.</p>
      </div>
      <div className="bg-card border border-border rounded-xl p-6 space-y-5">
        <div className="flex items-center justify-between">
          <div><p className="text-sm font-semibold text-foreground">Purchases Enabled</p><p className="text-xs text-muted-foreground">Master switch for the buy-credits UI</p></div>
          <button onClick={() => setIsEnabled(v => !v)} className={`relative w-10 h-5 rounded-full transition-all ${isEnabled ? "bg-primary" : "bg-muted"}`}>
            <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${isEnabled ? "left-5" : "left-0.5"}`} />
          </button>
        </div>
        <div>
          <label className="text-xs font-bold text-muted-foreground mb-1.5 block">BMAC PAGE URL</label>
          <input value={bmacPageUrl} onChange={e => setBmacPageUrl(e.target.value)} placeholder="https://buymeacoffee.com/yourname"
            className="w-full bg-background border border-border rounded-xl px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/60 transition-colors" />
        </div>
        <div>
          <label className="text-xs font-bold text-muted-foreground mb-1.5 block">WEBHOOK SECRET</label>
          <div className="relative">
            <input type={showSecret ? "text" : "password"} value={webhookSecret} onChange={e => setWebhookSecret(e.target.value)} placeholder="From BMAC → Settings → Developers → Webhooks"
              className="w-full bg-background border border-border rounded-xl px-3 py-2.5 pr-10 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/60 transition-colors" />
            <button onClick={() => setShowSecret(v => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors">
              {showSecret ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
          <p className="text-[11px] text-muted-foreground mt-1.5">Point the BMAC webhook at: <span className="font-mono text-foreground">{webhookUrl}</span></p>
        </div>
        <div>
          <label className="text-xs font-bold text-muted-foreground mb-1.5 block">AGENTBUCKS PER ₹1</label>
          <input value={abPerCent} onChange={e => setAbPerCent(e.target.value)} inputMode="numeric"
            className="w-full bg-background border border-border rounded-xl px-3 py-2.5 text-sm font-mono text-foreground focus:outline-none focus:border-primary/60 transition-colors" />
          <p className="text-[11px] text-muted-foreground mt-1.5">Default 15,000 (₹100 = $1 = 1.5M AB). Applies to all future payments.</p>
        </div>
        <button onClick={handleSave} disabled={saving}
          className="w-full py-2.5 bg-primary text-primary-foreground rounded-xl text-sm font-bold hover:bg-primary/90 disabled:opacity-50 transition-all flex items-center justify-center gap-2">
          {saving ? <><Loader2 className="h-4 w-4 animate-spin" />Saving…</> : <><Check className="h-4 w-4" />Save Config</>}
        </button>
      </div>
      <div className="bg-muted/30 border border-border rounded-xl p-4 text-xs text-muted-foreground">
        Payments are matched to accounts by the buyer's email. Mismatches are stored as "unclaimed" in the payments table and can be resolved later.
      </div>
    </div>
  );
}

// ── VM ISO Catalog Tab ────────────────────────────────────────────────────────
// Admin-managed OS download links for the desktop app's VM Sandbox. The
// native app's built-in catalog (Windows own-key, Ubuntu, Debian, Kali,
// Android-x86, BlissOS) ships in IsoLibrary.cs; entries added here are fetched
// by the app at runtime and merged in — no rebuild needed to add or remove one.
function VmIsoCatalogTab({ adminToken }: { adminToken: string }) {
  const entries = useQuery(api.desktopIsoCatalog.listIsoEntriesAdmin, { adminToken });
  const addEntry = useMutation(api.desktopIsoCatalog.addIsoEntry);
  const setEnabled = useMutation(api.desktopIsoCatalog.setIsoEntryEnabled);
  const deleteEntry = useMutation(api.desktopIsoCatalog.deleteIsoEntry);

  const [name, setName] = useState("");
  const [category, setCategory] = useState("windows");
  const [downloadUrl, setDownloadUrl] = useState("");
  const [fileName, setFileName] = useState("");
  const [sizeMb, setSizeMb] = useState("");
  const [infoUrl, setInfoUrl] = useState("");
  const [note, setNote] = useState("");
  const [hostSkipVersion, setHostSkipVersion] = useState("");
  const [saving, setSaving] = useState(false);

  const handleAdd = async () => {
    if (!name.trim() || !downloadUrl.trim()) { toast.error("Name and download URL are required"); return; }
    setSaving(true);
    try {
      const mb = Number(sizeMb);
      await addEntry({
        adminToken, name: name.trim(), category, downloadUrl: downloadUrl.trim(),
        fileName: fileName.trim() || undefined,
        sizeBytes: Number.isFinite(mb) && mb > 0 ? Math.round(mb * 1_048_576) : undefined,
        infoUrl: infoUrl.trim() || undefined,
        note: note.trim() || undefined,
        hostSkipVersion: hostSkipVersion || undefined,
      });
      toast.success("Added to the VM ISO catalog");
      setName(""); setDownloadUrl(""); setFileName(""); setSizeMb(""); setInfoUrl(""); setNote(""); setHostSkipVersion("");
    } catch (e) { toast.error(e instanceof Error ? e.message : "Failed to add"); }
    finally { setSaving(false); }
  };

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h2 className="text-lg font-bold text-foreground">VM Sandbox — OS Catalog</h2>
        <p className="text-sm text-muted-foreground mt-1">Direct download links the desktop app's VM Sandbox offers. Added entries show up next time the app opens the sandbox — no rebuild needed.</p>
      </div>

      <div className="bg-card border border-border rounded-xl p-6 space-y-4">
        <p className="text-xs font-bold text-muted-foreground">ADD ENTRY</p>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-[11px] text-muted-foreground mb-1 block">NAME</label>
            <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Windows 11 Pro"
              className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:border-primary/60" />
          </div>
          <div>
            <label className="text-[11px] text-muted-foreground mb-1 block">CATEGORY</label>
            <select value={category} onChange={e => setCategory(e.target.value)}
              className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:border-primary/60">
              <option value="windows">Windows</option>
              <option value="android">Android</option>
              <option value="linux">Linux</option>
              <option value="other">Other</option>
            </select>
          </div>
        </div>
        <div>
          <label className="text-[11px] text-muted-foreground mb-1 block">DIRECT DOWNLOAD URL</label>
          <input value={downloadUrl} onChange={e => setDownloadUrl(e.target.value)} placeholder="https://…/image.iso"
            className="w-full bg-background border border-border rounded-lg px-3 py-2 text-xs font-mono text-foreground focus:outline-none focus:border-primary/60" />
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="text-[11px] text-muted-foreground mb-1 block">FILE NAME <span className="opacity-60">(optional)</span></label>
            <input value={fileName} onChange={e => setFileName(e.target.value)} placeholder="auto from URL"
              className="w-full bg-background border border-border rounded-lg px-3 py-2 text-xs font-mono text-foreground focus:outline-none focus:border-primary/60" />
          </div>
          <div>
            <label className="text-[11px] text-muted-foreground mb-1 block">SIZE (MB) <span className="opacity-60">(optional)</span></label>
            <input value={sizeMb} onChange={e => setSizeMb(e.target.value)} inputMode="numeric" placeholder="e.g. 5800"
              className="w-full bg-background border border-border rounded-lg px-3 py-2 text-xs font-mono text-foreground focus:outline-none focus:border-primary/60" />
          </div>
          <div>
            <label className="text-[11px] text-muted-foreground mb-1 block">SKIP IF HOST IS</label>
            <select value={hostSkipVersion} onChange={e => setHostSkipVersion(e.target.value)}
              className="w-full bg-background border border-border rounded-lg px-3 py-2 text-xs text-foreground focus:outline-none focus:border-primary/60">
              <option value="">Never hide</option>
              <option value="10">Windows 10</option>
              <option value="11">Windows 11</option>
            </select>
          </div>
        </div>
        <div>
          <label className="text-[11px] text-muted-foreground mb-1 block">INFO URL <span className="opacity-60">(optional)</span></label>
          <input value={infoUrl} onChange={e => setInfoUrl(e.target.value)} placeholder="official page, shown as a link"
            className="w-full bg-background border border-border rounded-lg px-3 py-2 text-xs font-mono text-foreground focus:outline-none focus:border-primary/60" />
        </div>
        <div>
          <label className="text-[11px] text-muted-foreground mb-1 block">NOTE <span className="opacity-60">(optional)</span></label>
          <input value={note} onChange={e => setNote(e.target.value)} placeholder="one-line hint shown under the entry"
            className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:border-primary/60" />
        </div>
        <button onClick={handleAdd} disabled={saving}
          className="w-full py-2.5 bg-primary text-primary-foreground rounded-xl text-sm font-bold hover:bg-primary/90 disabled:opacity-50 transition-all flex items-center justify-center gap-2">
          {saving ? <><Loader2 className="h-4 w-4 animate-spin" />Adding…</> : <><Plus className="h-4 w-4" />Add to Catalog</>}
        </button>
      </div>

      <div className="space-y-2">
        <p className="text-xs font-bold text-muted-foreground">CURRENT ENTRIES {entries ? `(${entries.length})` : ""}</p>
        {entries === undefined ? (
          <p className="text-xs text-muted-foreground">Loading…</p>
        ) : entries.length === 0 ? (
          <p className="text-xs text-muted-foreground">No admin-added entries yet — the app still shows its built-in catalog.</p>
        ) : (
          <div className="space-y-2">
            {entries.map((e: Doc<"desktopIsoCatalog">) => (
              <div key={e._id} className="bg-card border border-border rounded-xl p-3 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className={`text-sm font-semibold truncate ${e.isEnabled ? "text-foreground" : "text-muted-foreground line-through"}`}>{e.name}</p>
                  <p className="text-[11px] text-muted-foreground truncate font-mono">{e.downloadUrl}</p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">{e.category}{e.hostSkipVersion ? ` · hidden on Windows ${e.hostSkipVersion}` : ""}</p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button onClick={() => setEnabled({ adminToken, id: e._id, isEnabled: !e.isEnabled })}
                    className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors" title={e.isEnabled ? "Disable" : "Enable"}>
                    {e.isEnabled ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
                  </button>
                  <button onClick={() => deleteEntry({ adminToken, id: e._id })}
                    className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors" title="Remove">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
