import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { toast } from "sonner";
import {
  Shield, Users, Tag, Lightbulb, DollarSign, LogOut, ChevronRight,
  Plus, Trash2, Check, X, Edit2, Eye, EyeOff, Loader2, RefreshCw,
  Coins, Calendar, AlertCircle, CheckCircle, Clock, Star,
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

type AdminTab = "credits" | "promo-codes" | "users" | "suggestion";

export default function AdminPage() {
  const [authed, setAuthed] = useState(false);
  const [loginUser, setLoginUser] = useState("");
  const [loginPass, setLoginPass] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [tab, setTab] = useState<AdminTab>("users");

  const handleLogin = () => {
    if (loginUser === ADMIN_USER && loginPass === ADMIN_PASS) {
      setAuthed(true);
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
      {/* Header */}
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
            onClick={() => setAuthed(false)}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-destructive transition-colors"
          >
            <LogOut className="h-3.5 w-3.5" />Sign Out
          </button>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <nav className="w-52 shrink-0 border-r border-border bg-card flex flex-col p-3 gap-1">
          {([
            { id: "users", label: "Users", icon: Users },
            { id: "credits", label: "Credits", icon: DollarSign },
            { id: "promo-codes", label: "Promo Codes", icon: Tag },
            { id: "suggestion", label: "Suggestions", icon: Lightbulb },
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

        {/* Content */}
        <main className="flex-1 overflow-y-auto p-6">
          <AnimatePresence mode="wait">
            <motion.div
              key={tab}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.15 }}
            >
              {tab === "users" && <UsersTab />}
              {tab === "credits" && <CreditsTab />}
              {tab === "promo-codes" && <PromoCodesTab />}
              {tab === "suggestion" && <SuggestionsTab />}
            </motion.div>
          </AnimatePresence>
        </main>
      </div>
    </div>
  );
}

// ── Users Tab ─────────────────────────────────────────────────────────────────
function UsersTab() {
  const users = useQuery(api.admin.listUsers);
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
      await setDailyAllowance({ userId, dailyAgentBucks: val });
      toast.success("Daily allowance updated");
      setEditingUser(null);
      setNewDaily("");
    } catch (err) { toast.error(err instanceof Error ? err.message : "Failed"); }
  };

  const handleAddCredits = async (userId: Id<"users">) => {
    const val = parseInt(addAmount);
    if (isNaN(val) || val <= 0) { toast.error("Invalid amount"); return; }
    try {
      await addCredits({ userId, amount: val, note: "admin_grant" });
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

              {/* Edit panel */}
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

// ── Credits Tab ───────────────────────────────────────────────────────────────
function CreditsTab() {
  const pricing = useQuery(api.admin.listModelPricing);
  const upsertPricing = useMutation(api.admin.upsertModelPricing);
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState({ displayName: "", inputCentsPerMillion: "", outputCentsPerMillion: "", abMultiplier: "15000", isActive: true });

  const models = pricing && pricing.length > 0 ? pricing : DEFAULT_MODELS.map(m => ({ ...m, _id: m.modelId as unknown as Id<"modelPricing">, updatedAt: Date.now() }));

  const handleEdit = (model: typeof models[0]) => {
    setEditing(model.modelId);
    setForm({
      displayName: model.displayName,
      inputCentsPerMillion: String(model.inputCentsPerMillion),
      outputCentsPerMillion: String(model.outputCentsPerMillion),
      abMultiplier: String(model.abMultiplier),
      isActive: model.isActive,
    });
  };

  const handleSave = async (modelId: string) => {
    try {
      await upsertPricing({
        modelId,
        displayName: form.displayName,
        inputCentsPerMillion: parseFloat(form.inputCentsPerMillion),
        outputCentsPerMillion: parseFloat(form.outputCentsPerMillion),
        abMultiplier: parseFloat(form.abMultiplier),
        isActive: form.isActive,
        updatedBy: "admin",
      });
      toast.success("Pricing updated");
      setEditing(null);
    } catch (err) { toast.error(err instanceof Error ? err.message : "Failed"); }
  };

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-xl font-bold text-foreground">Credits — Anthropic Model Pricing</h2>
        <p className="text-sm text-muted-foreground">Configure cost per million tokens and AgentBucks multiplier for each Claude model</p>
      </div>

      <div className="space-y-4">
        {models.map(model => (
          <div key={model.modelId} className="bg-card border border-border rounded-xl p-5">
            <div className="flex items-start justify-between gap-4 mb-3">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <h3 className="font-bold text-foreground">{model.displayName}</h3>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full border font-bold ${model.isActive ? "bg-emerald-400/15 text-emerald-400 border-emerald-400/30" : "bg-muted text-muted-foreground border-border"}`}>
                    {model.isActive ? "ACTIVE" : "INACTIVE"}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground font-mono">{model.modelId}</p>
              </div>
              <button onClick={() => editing === model.modelId ? setEditing(null) : handleEdit(model)} className="p-1.5 rounded-lg text-muted-foreground hover:text-primary hover:bg-primary/10 transition-all">
                <Edit2 className="h-3.5 w-3.5" />
              </button>
            </div>

            {editing === model.modelId ? (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-muted-foreground mb-1 block">Display Name</label>
                    <input value={form.displayName} onChange={e => setForm(f => ({ ...f, displayName: e.target.value }))} className="w-full bg-background border border-border rounded-lg px-2 py-1.5 text-xs text-foreground focus:outline-none focus:border-primary/60" />
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground mb-1 block">AB Multiplier (per cent)</label>
                    <input value={form.abMultiplier} onChange={e => setForm(f => ({ ...f, abMultiplier: e.target.value }))} className="w-full bg-background border border-border rounded-lg px-2 py-1.5 text-xs text-foreground focus:outline-none focus:border-primary/60" />
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground mb-1 block">Input ¢/1M tokens</label>
                    <input value={form.inputCentsPerMillion} onChange={e => setForm(f => ({ ...f, inputCentsPerMillion: e.target.value }))} className="w-full bg-background border border-border rounded-lg px-2 py-1.5 text-xs text-foreground focus:outline-none focus:border-primary/60" />
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground mb-1 block">Output ¢/1M tokens</label>
                    <input value={form.outputCentsPerMillion} onChange={e => setForm(f => ({ ...f, outputCentsPerMillion: e.target.value }))} className="w-full bg-background border border-border rounded-lg px-2 py-1.5 text-xs text-foreground focus:outline-none focus:border-primary/60" />
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
                    <input type="checkbox" checked={form.isActive} onChange={e => setForm(f => ({ ...f, isActive: e.target.checked }))} className="rounded" />
                    Active
                  </label>
                  <button onClick={() => handleSave(model.modelId)} className="px-3 py-1.5 bg-primary/10 border border-primary/30 text-primary text-xs rounded-lg hover:bg-primary/20 transition-all font-bold">Save</button>
                  <button onClick={() => setEditing(null)} className="px-3 py-1.5 bg-muted border border-border text-muted-foreground text-xs rounded-lg hover:bg-muted/80 transition-all">Cancel</button>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-3 text-xs">
                <div className="bg-muted/30 rounded-lg px-3 py-2">
                  <p className="text-muted-foreground mb-0.5">Input cost</p>
                  <p className="font-bold text-foreground">{model.inputCentsPerMillion}¢/1M</p>
                </div>
                <div className="bg-muted/30 rounded-lg px-3 py-2">
                  <p className="text-muted-foreground mb-0.5">Output cost</p>
                  <p className="font-bold text-foreground">{model.outputCentsPerMillion}¢/1M</p>
                </div>
                <div className="bg-muted/30 rounded-lg px-3 py-2">
                  <p className="text-muted-foreground mb-0.5">AB multiplier</p>
                  <p className="font-bold text-amber-400">{model.abMultiplier.toLocaleString()} AB/¢</p>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Promo Codes Tab ───────────────────────────────────────────────────────────
function PromoCodesTab() {
  const codes = useQuery(api.admin.listPromoCodes);
  const createCode = useMutation(api.admin.createPromoCode);
  const deleteCode = useMutation(api.admin.deletePromoCode);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ code: "", purchasedCredits: "", spins: "", expiresAt: "", maxUses: "", createdBy: "" });
  const [isCreating, setIsCreating] = useState(false);

  const handleCreate = async () => {
    if (!form.code.trim()) { toast.error("Code is required"); return; }
    if (!form.expiresAt) { toast.error("Expiry date is required"); return; }
    setIsCreating(true);
    try {
      await createCode({
        code: form.code.trim().toUpperCase(),
        purchasedCredits: form.purchasedCredits ? parseInt(form.purchasedCredits) : undefined,
        spins: form.spins ? parseInt(form.spins) : undefined,
        expiresAt: new Date(form.expiresAt).getTime(),
        maxUses: form.maxUses ? parseInt(form.maxUses) : undefined,
        createdBy: form.createdBy || "admin",
      });
      toast.success("Promo code created");
      setForm({ code: "", purchasedCredits: "", spins: "", expiresAt: "", maxUses: "", createdBy: "" });
      setShowForm(false);
    } catch (err) { toast.error(err instanceof Error ? err.message : "Failed"); }
    finally { setIsCreating(false); }
  };

  const handleDelete = async (id: Id<"promoCodes">) => {
    if (!confirm("Delete this promo code?")) return;
    try { await deleteCode({ id }); toast.success("Deleted"); } catch (err) { toast.error(err instanceof Error ? err.message : "Failed"); }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-bold text-foreground">Promo Codes</h2>
          <p className="text-sm text-muted-foreground">{codes?.length ?? 0} active codes</p>
        </div>
        <button onClick={() => setShowForm(s => !s)} className="flex items-center gap-2 px-4 py-2 bg-primary/10 border border-primary/30 text-primary text-sm rounded-xl hover:bg-primary/20 transition-all font-bold">
          <Plus className="h-4 w-4" />New Code
        </button>
      </div>

      {/* Create form */}
      <AnimatePresence>
        {showForm && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden mb-6"
          >
            <div className="bg-card border border-primary/20 rounded-xl p-5">
              <h3 className="font-bold text-foreground mb-4">New Promo Code</h3>
              <div className="grid grid-cols-2 gap-4 mb-4">
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Code *</label>
                  <input value={form.code} onChange={e => setForm(f => ({ ...f, code: e.target.value.toUpperCase() }))} placeholder="SUMMER2025" className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:border-primary/60 font-mono" />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Expires At *</label>
                  <input type="datetime-local" value={form.expiresAt} onChange={e => setForm(f => ({ ...f, expiresAt: e.target.value }))} className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:border-primary/60" />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Purchased Credits (AB)</label>
                  <input type="number" value={form.purchasedCredits} onChange={e => setForm(f => ({ ...f, purchasedCredits: e.target.value }))} placeholder="e.g. 50000" className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:border-primary/60" />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Spins</label>
                  <input type="number" value={form.spins} onChange={e => setForm(f => ({ ...f, spins: e.target.value }))} placeholder="e.g. 3" className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:border-primary/60" />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Max Uses (blank = unlimited)</label>
                  <input type="number" value={form.maxUses} onChange={e => setForm(f => ({ ...f, maxUses: e.target.value }))} placeholder="unlimited" className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:border-primary/60" />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Note</label>
                  <input value={form.createdBy} onChange={e => setForm(f => ({ ...f, createdBy: e.target.value }))} placeholder="e.g. Summer campaign" className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:border-primary/60" />
                </div>
              </div>
              <div className="flex gap-2">
                <button onClick={handleCreate} disabled={isCreating} className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground text-sm rounded-xl hover:bg-primary/90 disabled:opacity-50 transition-all font-bold">
                  {isCreating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}Create
                </button>
                <button onClick={() => setShowForm(false)} className="px-4 py-2 bg-muted border border-border text-muted-foreground text-sm rounded-xl hover:bg-muted/80 transition-all">Cancel</button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Codes list */}
      {!codes ? (
        <div className="flex items-center justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
      ) : (
        <div className="space-y-3">
          {codes.map(code => {
            const isExpired = code.expiresAt < Date.now();
            const isExhausted = code.maxUses !== undefined && code.usedCount >= code.maxUses;
            return (
              <div key={code._id} className={`bg-card border rounded-xl p-4 ${isExpired || isExhausted ? "border-border/50 opacity-60" : "border-border"}`}>
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="font-bold text-foreground font-mono text-lg">{code.code}</span>
                      {isExpired && <span className="text-[10px] bg-destructive/20 text-destructive border border-destructive/30 px-1.5 py-0.5 rounded-full font-bold">EXPIRED</span>}
                      {isExhausted && <span className="text-[10px] bg-orange-400/20 text-orange-400 border border-orange-400/30 px-1.5 py-0.5 rounded-full font-bold">EXHAUSTED</span>}
                      {!isExpired && !isExhausted && <span className="text-[10px] bg-emerald-400/20 text-emerald-400 border border-emerald-400/30 px-1.5 py-0.5 rounded-full font-bold">ACTIVE</span>}
                    </div>
                    <div className="flex flex-wrap gap-3 text-xs">
                      {code.purchasedCredits && (
                        <div className="flex items-center gap-1 text-amber-400"><Coins className="h-3 w-3" />{code.purchasedCredits.toLocaleString()} AB</div>
                      )}
                      {code.spins && (
                        <div className="flex items-center gap-1 text-primary"><Star className="h-3 w-3" />{code.spins} spins</div>
                      )}
                      <div className="flex items-center gap-1 text-muted-foreground"><RefreshCw className="h-3 w-3" />{code.usedCount}{code.maxUses ? `/${code.maxUses}` : ""} uses</div>
                      <div className="flex items-center gap-1 text-muted-foreground"><Calendar className="h-3 w-3" />Expires {new Date(code.expiresAt).toLocaleDateString()}</div>
                      {code.createdBy && <div className="text-muted-foreground">Note: {code.createdBy}</div>}
                    </div>
                  </div>
                  <button onClick={() => handleDelete(code._id)} className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-all">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
          {codes.length === 0 && <p className="text-center text-muted-foreground py-12 text-sm">No promo codes yet</p>}
        </div>
      )}
    </div>
  );
}

// ── Suggestions Tab ───────────────────────────────────────────────────────────
function SuggestionsTab() {
  const suggestions = useQuery(api.admin.listSuggestions);
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
    try { await updateStatus({ id, status }); toast.success(`Marked as ${status}`); } catch (err) { toast.error(err instanceof Error ? err.message : "Failed"); }
  };

  const handleDelete = async (id: Id<"suggestions">) => {
    if (!confirm("Delete this suggestion?")) return;
    try { await deleteSuggestion({ id }); toast.success("Deleted"); } catch (err) { toast.error(err instanceof Error ? err.message : "Failed"); }
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
