import { useState } from "react";
import { useQuery, useMutation, useAction } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useAuth } from "@/hooks/use-auth";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import {
  Key, Plus, Trash2, Copy,
  Terminal, Shield, Check, X,
  Loader2,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

export default function ApiPage() {
  const { user, token, isLoading } = useAuth();
  const navigate = useNavigate();

  const keys = useQuery(api.userApiKeys.listApiKeys, token ? { token } : "skip");
  const revokeKey = useMutation(api.userApiKeys.revokeApiKey);
  const createKey = useAction(api.userApiKeys.createApiKey);

  const [showCreate, setShowCreate] = useState(false);
  const [newKeyName, setNewKeyName] = useState("");
  const [newKeyCredits, setNewKeyCredits] = useState(1000);
  const [creating, setCreating] = useState(false);
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  // Captured once so render stays pure (react-hooks/purity)
  const [now] = useState(() => Date.now());

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="text-center max-w-sm">
          <div className="w-16 h-16 rounded-2xl bg-primary/15 border border-primary/30 flex items-center justify-center mx-auto mb-4">
            <Shield className="h-8 w-8 text-primary" />
          </div>
          <h1 className="text-xl font-bold text-foreground mb-2">Sign in required</h1>
          <p className="text-sm text-muted-foreground mb-6">You need to be signed in to manage API keys.</p>
          <button
            onClick={() => navigate("/auth")}
            className="px-6 py-2.5 bg-primary text-primary-foreground rounded-xl text-sm font-semibold hover:bg-primary/90 transition-all"
          >
            Sign In
          </button>
        </div>
      </div>
    );
  }

  const handleCreate = async () => {
    if (!newKeyName.trim() || !token) return;
    setCreating(true);
    try {
      const result = await createKey({
        token,
        name: newKeyName.trim(),
        creditsAllocated: newKeyCredits,
      });
      setCreatedKey(result.fullKey);
      setShowCreate(false);
      setNewKeyName("");
      toast.success("API key created");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create key");
    } finally {
      setCreating(false);
    }
  };

  const handleRevoke = async (keyId: string, keyName: string) => {
    if (!token) return;
    if (!confirm(`Revoke "${keyName}"? Unused credits will be refunded.`)) return;
    try {
      await revokeKey({ token, keyId });
      toast.success("Key revoked — credits refunded");
    } catch {
      toast.error("Failed to revoke key");
    }
  };

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(id);
      setTimeout(() => setCopied(null), 2000);
    });
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="border-b border-border bg-card/60 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button onClick={() => navigate("/portal")} className="text-muted-foreground hover:text-foreground transition-colors text-sm">
              ← Portal
            </button>
            <span className="text-border">|</span>
            <div className="flex items-center gap-2">
              <Key className="h-4 w-4 text-primary" />
              <span className="font-semibold text-foreground text-sm">API</span>
            </div>
          </div>
          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-primary text-primary-foreground rounded-lg text-xs font-semibold hover:bg-primary/90 transition-all"
          >
            <Plus className="h-3.5 w-3.5" />
            New Key
          </button>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8">
        {/* Hero */}
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-foreground mb-2">Thalamus API</h1>
          <p className="text-sm text-muted-foreground max-w-2xl">
            Use your API keys to connect Thalamus to Cursor, Claude Code, GitHub Copilot, and other AI coding tools.
            Keys run on your AgentBucks balance.
          </p>
        </div>

        {/* Integration cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-8">
          {[
            {
              name: "Cursor",
              icon: "⚡",
              desc: "Use as OpenAI-compatible endpoint",
              docs: "Settings → Models → Add Custom Model",
            },
            {
              name: "Claude Code",
              icon: "🤖",
              desc: "Plug in via ANTHROPIC_API_KEY override",
              docs: "ANTHROPIC_API_KEY=thal_... ANTHROPIC_BASE_URL=...",
            },
            {
              name: "Codex / GPT",
              icon: "🧠",
              desc: "OpenAI-compatible REST API",
              docs: "Point base_url to your Thalamus endpoint",
            },
          ].map((item) => (
            <div key={item.name} className="rounded-xl border border-border bg-card/40 p-4">
              <div className="text-2xl mb-2">{item.icon}</div>
              <div className="font-semibold text-foreground text-sm mb-1">{item.name}</div>
              <div className="text-xs text-muted-foreground mb-2">{item.desc}</div>
              <div className="font-mono text-[10px] bg-muted/50 rounded-lg px-2 py-1.5 text-muted-foreground">
                {item.docs}
              </div>
            </div>
          ))}
        </div>

        {/* Base URL */}
        <div className="rounded-xl border border-border bg-card/40 p-4 mb-6">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Base URL</span>
            <button
              onClick={() => copyToClipboard(`${window.location.origin}/api/v1`, "base_url")}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              {copied === "base_url" ? <Check className="h-3 w-3 text-green-500" /> : <Copy className="h-3 w-3" />}
              {copied === "base_url" ? "Copied" : "Copy"}
            </button>
          </div>
          <code className="font-mono text-sm text-foreground">{window.location.origin}/api/v1</code>
        </div>

        {/* One-time key reveal */}
        <AnimatePresence>
          {createdKey && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="rounded-xl border border-green-500/30 bg-green-500/10 p-4 mb-6"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-2">
                    <Check className="h-4 w-4 text-green-500 shrink-0" />
                    <span className="text-sm font-semibold text-green-400">Key created — save it now</span>
                  </div>
                  <p className="text-xs text-muted-foreground mb-2">This is the only time you'll see the full key.</p>
                  <div className="flex items-center gap-2">
                    <code className="font-mono text-xs bg-background/60 rounded-lg px-3 py-2 text-foreground flex-1 overflow-x-auto">
                      {createdKey}
                    </code>
                    <button
                      onClick={() => copyToClipboard(createdKey, "new_key")}
                      className="shrink-0 p-2 rounded-lg bg-background/60 hover:bg-background transition-colors"
                    >
                      {copied === "new_key" ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4 text-muted-foreground" />}
                    </button>
                  </div>
                </div>
                <button onClick={() => setCreatedKey(null)} className="text-muted-foreground hover:text-foreground transition-colors shrink-0">
                  <X className="h-4 w-4" />
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Keys table */}
        <div className="rounded-xl border border-border overflow-hidden">
          <div className="bg-card/60 px-4 py-3 border-b border-border flex items-center justify-between">
            <span className="text-sm font-semibold text-foreground">Your API Keys</span>
            <span className="text-xs text-muted-foreground">{keys?.length ?? 0} key{keys?.length !== 1 ? "s" : ""}</span>
          </div>

          {!keys || keys.length === 0 ? (
            <div className="p-12 text-center">
              <Key className="h-8 w-8 text-muted-foreground/40 mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">No API keys yet. Create one to get started.</p>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {keys.map((key: NonNullable<typeof keys>[number]) => (
                <div key={key._id} className="flex items-center gap-4 px-4 py-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="text-sm font-medium text-foreground truncate">{key.name}</span>
                      {!key.isActive && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-destructive/20 text-destructive font-medium">revoked</span>
                      )}
                      {key.expiresAt && key.expiresAt < now && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-500 font-medium">expired</span>
                      )}
                    </div>
                    <code className="text-xs text-muted-foreground font-mono">{key.keyPrefix}</code>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-xs text-foreground font-medium">
                      {(key.creditsAllocated - key.creditsUsed).toLocaleString()} AB left
                    </div>
                    <div className="text-[10px] text-muted-foreground">
                      {key.creditsUsed.toLocaleString()} used
                    </div>
                  </div>
                  {key.isActive && (
                    <button
                      onClick={() => handleRevoke(key.keyId, key.name)}
                      className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-all"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Quick start */}
        <div className="mt-8 rounded-xl border border-border bg-card/40 p-5">
          <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
            <Terminal className="h-4 w-4 text-primary" />
            Quick start
          </h3>
          <pre className="text-xs text-muted-foreground bg-background/60 rounded-lg p-3 overflow-x-auto font-mono">
{`curl ${window.location.origin}/api/v1/chat/completions \\
  -H "Authorization: Bearer thal_your_key_here" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "thalamus-sonnet",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'`}
          </pre>
        </div>
      </div>

      {/* Create key modal */}
      <AnimatePresence>
        {showCreate && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-background/80 backdrop-blur-sm" onClick={() => setShowCreate(false)} />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              className="relative z-10 bg-card border border-border rounded-2xl shadow-2xl w-full max-w-sm p-6"
            >
              <h2 className="text-base font-bold text-foreground mb-4">Create API Key</h2>
              <div className="space-y-4">
                <div>
                  <label className="text-xs font-semibold text-muted-foreground mb-1.5 block">KEY NAME</label>
                  <input
                    value={newKeyName}
                    onChange={(e) => setNewKeyName(e.target.value)}
                    placeholder="e.g. Cursor dev machine"
                    className="w-full bg-background border border-border rounded-xl px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/60 transition-colors"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-muted-foreground mb-1.5 block">
                    AGENTBUCKS TO ALLOCATE
                    <span className="ml-2 font-normal text-muted-foreground/60">(min 100)</span>
                  </label>
                  <input
                    type="number"
                    min={100}
                    step={100}
                    value={newKeyCredits}
                    onChange={(e) => setNewKeyCredits(Number(e.target.value))}
                    className="w-full bg-background border border-border rounded-xl px-3 py-2.5 text-sm text-foreground focus:outline-none focus:border-primary/60 transition-colors"
                  />
                  <p className="text-[10px] text-muted-foreground mt-1">Credits are deducted from your balance and allocated to this key.</p>
                </div>
              </div>
              <div className="flex gap-2 mt-5">
                <button
                  onClick={() => setShowCreate(false)}
                  className="flex-1 py-2.5 rounded-xl text-sm text-muted-foreground border border-border hover:bg-muted/40 transition-all"
                >
                  Cancel
                </button>
                <button
                  onClick={handleCreate}
                  disabled={creating || !newKeyName.trim() || newKeyCredits < 100}
                  className="flex-1 py-2.5 rounded-xl text-sm font-semibold bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-all flex items-center justify-center gap-2"
                >
                  {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  Create Key
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
