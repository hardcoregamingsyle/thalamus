import { useState, useEffect, lazy, Suspense } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useQuery, useAction } from "convex/react";
import { api } from "@/convex/_generated/api";
import { toast } from "sonner";
import {
  Shield, Users, Lightbulb, LogOut, ChevronRight,
  Eye, EyeOff, Loader2,
  BookOpen,
  TrendingUp, Activity, Cpu, Search, Server, Wrench, Database, Globe, Zap, Radio,
  type LucideIcon,
} from "lucide-react";
import { useAdminMeta, type ProviderMeta, type ProviderSlug } from "./admin/shared";

type AdminTab = "users" | "suggestion" | "study-materials" | "dau" | "providerD" | "providerE" | "providerB" | "providerC" | "provider-log" | "gravity-ads" | "analytics" | "vm-isos" | "corpus" | "maintenance";

const ADMIN_SESSION_KEY = "thalamus_admin_v2";

// Tab modules are lazy-loaded so the eagerly-downloaded admin chunk stays
// small; each import resolves to a named export that has to be aliased to
// `default` for React.lazy.
const UsersTab = lazy(() => import("./admin/UsersTab").then(m => ({ default: m.UsersTab })));
const DauTab = lazy(() => import("./admin/DauTab").then(m => ({ default: m.DauTab })));
const SuggestionsTab = lazy(() => import("./admin/SuggestionsTab").then(m => ({ default: m.SuggestionsTab })));
const StudyMaterialsTab = lazy(() => import("./admin/StudyMaterialsTab").then(m => ({ default: m.StudyMaterialsTab })));
const ProviderDCredentialsTab = lazy(() => import("./admin/ProviderDCredentialsTab").then(m => ({ default: m.ProviderDCredentialsTab })));
const ProviderEKeysTab = lazy(() => import("./admin/ProviderEKeysTab").then(m => ({ default: m.ProviderEKeysTab })));
const ProviderBKeysTab = lazy(() => import("./admin/ProviderBKeysTab").then(m => ({ default: m.ProviderBKeysTab })));
const ProviderCEndpointsTab = lazy(() => import("./admin/ProviderCEndpointsTab").then(m => ({ default: m.ProviderCEndpointsTab })));
const MaintenanceTab = lazy(() => import("./admin/MaintenanceTab").then(m => ({ default: m.MaintenanceTab })));
const AdsTab = lazy(() => import("./admin/AdsTab").then(m => ({ default: m.AdsTab })));
const AnalyticsTab = lazy(() => import("./admin/AnalyticsTab").then(m => ({ default: m.AnalyticsTab })));
const VmIsoCatalogTab = lazy(() => import("./admin/VmIsoCatalogTab").then(m => ({ default: m.VmIsoCatalogTab })));
const AgentOverflowTab = lazy(() => import("./admin/AgentOverflowTab").then(m => ({ default: m.AgentOverflowTab })));
const ProviderLogTab = lazy(() => import("./admin/ProviderLogTab").then(m => ({ default: m.ProviderLogTab })));

export default function AdminPage() {
  const [adminToken, setAdminToken] = useState(() => {
    try { return localStorage.getItem(ADMIN_SESSION_KEY) ?? ""; } catch { return ""; }
  });
  const [authed, setAuthed] = useState(false);
  const [loginPass, setLoginPass] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [tab, setTab] = useState<AdminTab>("users");
  const uiMeta = useAdminMeta(adminToken);
  const providerLabel = (slug: ProviderSlug) =>
    (uiMeta?.providers?.[slug] as ProviderMeta | undefined)?.tabLabel ?? "Provider";
  // 2FA step: after the password, three security questions gate the login.
  const [loginStep, setLoginStep] = useState<"password" | "questions">("password");
  const [answers, setAnswers] = useState(["", "", ""]);
  const adminLoginAction = useAction(api.admin.adminLogin);

  // Verify stored session by testing against a known admin query.
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
    <div className="min-h-screen bg-background flex flex-col overflow-x-hidden">
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
            { id: "suggestion", label: "Suggestions", icon: Lightbulb },
            { id: "study-materials", label: "Study Materials", icon: BookOpen },
            { id: "providerB", label: providerLabel("providerB"), icon: Cpu },
            { id: "providerC", label: providerLabel("providerC"), icon: Server },
            { id: "providerD", label: providerLabel("providerD"), icon: Zap },
            { id: "providerE", label: providerLabel("providerE"), icon: Activity },
            { id: "provider-log", label: "Provider Log", icon: Radio },
            { id: "gravity-ads", label: "Ads (Gravity)", icon: Globe },
            { id: "analytics", label: "Analytics", icon: TrendingUp },
            { id: "vm-isos", label: "VM ISOs", icon: Database },
            { id: "corpus", label: "Corpus", icon: Search },
            { id: "maintenance", label: "Maintenance", icon: Wrench },
          ] as { id: AdminTab; label: string; icon: LucideIcon }[]).map(item => (
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

        <main className="flex-1 overflow-auto p-6">
          <Suspense fallback={
            <div className="flex items-center justify-center py-20">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          }>
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
                {tab === "suggestion" && <SuggestionsTab adminToken={adminToken} />}
                {tab === "study-materials" && <StudyMaterialsTab adminToken={adminToken} />}
                {tab === "providerD" && <ProviderDCredentialsTab adminToken={adminToken} />}
                {tab === "providerE" && <ProviderEKeysTab adminToken={adminToken} />}
                {tab === "providerB" && <ProviderBKeysTab adminToken={adminToken} />}
                {tab === "providerC" && <ProviderCEndpointsTab adminToken={adminToken} />}
                {tab === "provider-log" && <ProviderLogTab adminToken={adminToken} />}
                {tab === "maintenance" && <MaintenanceTab adminToken={adminToken} />}
                {tab === "gravity-ads" && <AdsTab adminToken={adminToken} />}
                {tab === "analytics" && <AnalyticsTab adminToken={adminToken} />}
                {tab === "vm-isos" && <VmIsoCatalogTab adminToken={adminToken} />}
                {tab === "corpus" && <AgentOverflowTab adminToken={adminToken} />}
              </motion.div>
            </AnimatePresence>
          </Suspense>
        </main>
      </div>
    </div>
  );
}
