import { useEffect, useState, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { api } from "@/convex/_generated/api";
import { useAction, useQuery, useMutation } from "convex/react";
import { Id } from "@/convex/_generated/dataModel";
import { toast } from "sonner";
import {
  Loader2, Plus, CheckCircle, Terminal, Box, Globe, ExternalLink,
  Play, Square, Send, FileCode, Monitor, ChevronRight, Activity,
  MessageSquare, StopCircle, ListPlus, Cpu, Shield, Search, Code2,
  CheckSquare, AlertCircle, RefreshCw, Upload, Menu, X, PanelLeftClose, PanelLeftOpen,
  Github, Database,
} from "lucide-react";
import { FileTreeView, FileTreeFile, FileTreeNode } from "@/components/FileTree";
import ReactMarkdown from "react-markdown";

// ── Types ──────────────────────────────────────────────────────────────────────
interface AgentMessage {
  _id: string;
  agent: string;
  content: string;
  round?: number;
  messageIndex?: number;
  isUser?: boolean;
  modelUsed?: string;
  agentBucksDeducted?: number;
}

interface TeamSession {
  _id: Id<"teamSessions">;
  title: string;
  status: string;
  round: number;
  task: string;
  phase: string;
  totalMessages: number;
  loopCount: number;
  currentAgent?: string;
  currentAgentOutput?: string;
  executionPhase?: string;
  currentTaskIndex?: number;
  plannerTasksJson?: string;
  finalReviewCoderEnabled?: boolean;
  deployCommandsJson?: string;
}

interface ProjectFile {
  filepath: string;
  content: string;
  lastModifiedBy: string;
}

interface SandboxRow {
  _id: string;
  sandboxId: string;
  status: string;
  label?: string;
  createdAt: number;
  stoppedAt?: number;
  costCents?: number;
  lastCommand?: string;
  lastOutput?: string;
  sessionId?: string;
  previewUrl?: string;
  customDomain?: string;
  deployedUrl?: string;
}

interface QueuedMessage {
  id: string;
  text: string;
  timestamp: number;
}

interface TeamPortalInlineProps {
  token: string;
  sessionId?: string;
  initialSessionCustomId?: string | null;
  onSessionChange?: (customId: string | null) => void;
}

// ── Agent config ───────────────────────────────────────────────────────────────
const AGENT_COLORS: Record<string, string> = {
  "R&D Team": "text-cyan-400", Researcher: "text-cyan-400", Analyser: "text-blue-400", Planner: "text-violet-400",
  Coder: "text-emerald-400", Optimiser: "text-amber-400", Organizer: "text-orange-400",
  Tester: "text-green-400", Hacker: "text-red-400", "Security Team": "text-red-400", Critic: "text-purple-400", User: "text-primary",
};

const AGENT_BG: Record<string, string> = {
  "R&D Team": "bg-cyan-400/10 border-cyan-400/30", Researcher: "bg-cyan-400/10 border-cyan-400/30", Analyser: "bg-blue-400/10 border-blue-400/30",
  Planner: "bg-violet-400/10 border-violet-400/30", Coder: "bg-emerald-400/10 border-emerald-400/30",
  Optimiser: "bg-amber-400/10 border-amber-400/30", Organizer: "bg-orange-400/10 border-orange-400/30",
  Tester: "bg-green-400/10 border-green-400/30", Hacker: "bg-red-400/10 border-red-400/30", "Security Team": "bg-red-400/10 border-red-400/30",
  Critic: "bg-purple-400/10 border-purple-400/30", User: "bg-primary/10 border-primary/30",
};

const AGENT_ICONS: Record<string, string> = {
  "R&D Team": "🔬", Researcher: "🔬", Analyser: "A", Planner: "P", Coder: "C",
  Optimiser: "O", Organizer: "📝", Tester: "T", Hacker: "🛡️", "Security Team": "🛡️", Critic: "R", User: "U",
};

const PIPELINE = ["Researcher", "Analyser", "Planner", "Coder", "Optimiser", "Organizer", "Tester", "Hacker", "Critic"];

// Team display names and sub-agents for pipeline visualization
const PIPELINE_DISPLAY: Record<string, { displayName: string; subAgents: Array<{ name: string; abbr: string; color: string }> }> = {
  Researcher: {
    displayName: "R&D Team",
    subAgents: [
      { name: "ResearchPlanner", abbr: "RP", color: "text-cyan-300" },
      { name: "DataTaker", abbr: "DT", color: "text-cyan-300" },
      { name: "ResearchOrganiser", abbr: "RO", color: "text-cyan-300" },
    ],
  },
  Hacker: {
    displayName: "Security Team",
    subAgents: [
      { name: "VulnerabilitySpotter", abbr: "VS", color: "text-red-300" },
      { name: "VulnerabilityFixer", abbr: "VF", color: "text-green-300" },
      { name: "DataCorruptor", abbr: "DC", color: "text-red-300" },
      { name: "DataFixer", abbr: "DF", color: "text-green-300" },
      { name: "ZeroDayExploiter", abbr: "ZD", color: "text-red-300" },
      { name: "ZeroDayRemover", abbr: "ZDR", color: "text-green-300" },
      { name: "FrameworkAuditor", abbr: "FA", color: "text-red-300" },
      { name: "FrameworkRefiner", abbr: "FR", color: "text-green-300" },
      { name: "SecurityOrchestrator", abbr: "SO", color: "text-amber-300" },
    ],
  },
};
const MAX_MESSAGES = 100_000; // No practical limit

function playSound(type: "send" | "receive" | "complete" | "error" | "queue") {
  try {
    const ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);
    const configs: Record<string, { freq: number; type: OscillatorType; duration: number; vol: number }> = {
      send: { freq: 880, type: "sine", duration: 0.1, vol: 0.1 },
      receive: { freq: 440, type: "sine", duration: 0.15, vol: 0.08 },
      complete: { freq: 660, type: "sine", duration: 0.3, vol: 0.12 },
      error: { freq: 220, type: "sawtooth", duration: 0.2, vol: 0.1 },
      queue: { freq: 550, type: "triangle", duration: 0.1, vol: 0.08 },
    };
    const c = configs[type];
    osc.type = c.type;
    osc.frequency.setValueAtTime(c.freq, ctx.currentTime);
    gain.gain.setValueAtTime(c.vol, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + c.duration);
    osc.start(ctx.currentTime); osc.stop(ctx.currentTime + c.duration);
  } catch { /* ignore */ }
}


// ── Planner Output Card ────────────────────────────────────────────────────────
interface PlannerTask {
  id: string;
  title: string;
  description: string;
  subpart: boolean;
  dependencies?: string[];
}

interface PlannerData {
  summary: string;
  tasks: PlannerTask[];
}

function parsePlannerContent(content: string): PlannerData | null {
  const jsonBlockMatch = content.match(/```json\s*([\s\S]*?)\s*```/);
  if (jsonBlockMatch) {
    try {
      const data = JSON.parse(jsonBlockMatch[1]);
      if (data && Array.isArray(data.tasks) && data.tasks.length > 0) {
        return { summary: data.summary || "", tasks: data.tasks };
      }
    } catch { /* ignore */ }
  }
  const jsonStart = content.indexOf("{");
  if (jsonStart !== -1) {
    for (let end = content.length; end > jsonStart; end = content.lastIndexOf("}", end - 1)) {
      if (end === -1) break;
      try {
        const candidate = content.slice(jsonStart, end + 1);
        const data = JSON.parse(candidate) as { tasks?: PlannerTask[]; summary?: string };
        if (data.tasks && Array.isArray(data.tasks) && data.tasks.length > 0) {
          return { summary: data.summary || "", tasks: data.tasks };
        }
      } catch { /* keep trying */ }
    }
  }
  return null;
}

function PlannerOutputCard({ data, currentTaskIndex }: { data: PlannerData; currentTaskIndex?: number }) {
  const completedCount = currentTaskIndex ?? 0;
  return (
    <div className="w-full space-y-3">
      {data.summary && (
        <div className="bg-violet-400/10 border border-violet-400/30 rounded-xl px-4 py-3">
          <p className="text-[10px] font-bold text-violet-400 mb-1 tracking-widest">PROJECT PLAN</p>
          <p className="text-xs text-foreground leading-relaxed">{data.summary}</p>
        </div>
      )}
      <div className="flex items-center justify-between px-1">
        <p className="text-[10px] font-bold text-muted-foreground tracking-widest">{data.tasks.length} TASKS PLANNED</p>
        {completedCount > 0 && (
          <p className="text-[10px] text-violet-400">{completedCount}/{data.tasks.length} complete</p>
        )}
      </div>
      <div className="space-y-2">
        {data.tasks.map((task, i) => {
          const isDone = i < completedCount;
          const isActive = i === completedCount;
          return (
            <motion.div
              key={task.id || i}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.04 }}
              className={`flex items-start gap-3 px-3 py-2.5 rounded-xl border transition-all ${
                isDone ? "border-border/30 bg-muted/10 opacity-50"
                : isActive ? "border-violet-400/40 bg-violet-400/8"
                : "border-border/40 bg-card/50"
              }`}
            >
              <div className={`w-6 h-6 rounded-lg flex items-center justify-center text-[10px] font-bold shrink-0 mt-0.5 ${
                isDone ? "bg-emerald-400/20 text-emerald-400" : isActive ? "bg-violet-400/20 text-violet-400" : "bg-muted/30 text-muted-foreground"
              }`}>
                {isDone ? "✓" : i + 1}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap mb-0.5">
                  <p className={`text-xs font-bold ${isDone ? "line-through text-muted-foreground" : isActive ? "text-violet-400" : "text-foreground"}`}>
                    {task.title}
                  </p>
                  {task.subpart && (
                    <span className="text-[9px] bg-amber-400/15 text-amber-400 border border-amber-400/30 px-1.5 py-0.5 rounded-full font-bold">COMPLEX</span>
                  )}
                  {isActive && (
                    <motion.span
                      animate={{ opacity: [1, 0.4, 1] }}
                      transition={{ duration: 1, repeat: Infinity }}
                      className="text-[9px] bg-violet-400/20 text-violet-400 border border-violet-400/40 px-1.5 py-0.5 rounded-full font-bold"
                    >
                      IN PROGRESS
                    </motion.span>
                  )}
                </div>
                {task.description && (
                  <p className="text-[11px] text-muted-foreground leading-relaxed">{task.description}</p>
                )}
              </div>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}

function MessageContent({ msg, currentTaskIndex }: { msg: { _id?: string; agent: string; content: string }; currentTaskIndex?: number }) {
  if (msg.agent === "Planner") {
    const plannerData = parsePlannerContent(msg.content);
    if (plannerData && plannerData.tasks.length > 0) {
      return <PlannerOutputCard data={plannerData} currentTaskIndex={currentTaskIndex} />;
    }
  }
  return (
    <div className="prose prose-sm prose-invert max-w-none text-xs leading-relaxed">
      <ReactMarkdown>{msg.content}</ReactMarkdown>
    </div>
  );
}

// ── GitHub Sync Modal ─────────────────────────────────────────────────────────
function GithubSyncModal({
  onClose,
  onSave,
  onSync,
  isSyncing,
  currentRepo,
  currentBranch,
  lastSyncAt,
}: {
  onClose: () => void;
  onSave: (repo: string, branch: string, token: string) => Promise<void>;
  onSync: () => Promise<void>;
  isSyncing: boolean;
  currentRepo?: string;
  currentBranch?: string;
  lastSyncAt?: number;
}) {
  const [repo, setRepo] = useState(currentRepo ?? "");
  const [branch, setBranch] = useState(currentBranch ?? "main");
  const [ghToken, setGhToken] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const isConnected = !!currentRepo;

  const handleSave = async () => {
    if (!repo.trim() || !branch.trim() || !ghToken.trim()) return;
    setIsSaving(true);
    try {
      await onSave(repo.trim(), branch.trim(), ghToken.trim());
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-background/80 backdrop-blur-sm" onClick={onClose} />
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="relative z-10 bg-card border border-border rounded-2xl p-6 max-w-md w-full shadow-2xl"
      >
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Github className="h-5 w-5 text-foreground" />
            <h3 className="text-sm font-bold text-foreground">GitHub Sync</h3>
            {isConnected && (
              <span className="text-[9px] bg-green-400/15 text-green-400 border border-green-400/30 px-1.5 py-0.5 rounded-full font-bold">CONNECTED</span>
            )}
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors">
            <X className="h-4 w-4" />
          </button>
        </div>

        {isConnected && (
          <div className="mb-4 p-3 bg-green-400/5 border border-green-400/20 rounded-xl">
            <p className="text-[10px] text-green-400 font-bold">{currentRepo} @ {currentBranch}</p>
            {lastSyncAt && (
              <p className="text-[9px] text-muted-foreground mt-0.5">Last sync: {new Date(lastSyncAt).toLocaleString()}</p>
            )}
          </div>
        )}

        <div className="space-y-3">
          <div>
            <label className="text-[10px] text-muted-foreground font-bold block mb-1">REPOSITORY</label>
            <input
              value={repo}
              onChange={e => setRepo(e.target.value)}
              placeholder="owner/repo or https://github.com/owner/repo"
              className="w-full bg-background border border-border rounded-lg px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/60 transition-colors"
            />
          </div>
          <div>
            <label className="text-[10px] text-muted-foreground font-bold block mb-1">BRANCH</label>
            <input
              value={branch}
              onChange={e => setBranch(e.target.value)}
              placeholder="main"
              className="w-full bg-background border border-border rounded-lg px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/60 transition-colors"
            />
          </div>
          <div>
            <label className="text-[10px] text-muted-foreground font-bold block mb-1">GITHUB TOKEN (PAT)</label>
            <input
              type="password"
              value={ghToken}
              onChange={e => setGhToken(e.target.value)}
              placeholder={isConnected ? "Enter new token to update" : "ghp_xxxxxxxxxxxx"}
              className="w-full bg-background border border-border rounded-lg px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/60 transition-colors"
            />
            <p className="text-[9px] text-muted-foreground mt-1">
              Needs <code className="bg-muted px-1 rounded">repo</code> scope.{" "}
              <a href="https://github.com/settings/tokens/new" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">Create token →</a>
            </p>
          </div>
        </div>

        <div className="flex gap-2 mt-4">
          <button
            onClick={handleSave}
            disabled={isSaving || !repo.trim() || !branch.trim() || !ghToken.trim()}
            className="flex-1 py-2 bg-primary/15 border border-primary/30 text-primary text-xs rounded-xl hover:bg-primary/25 disabled:opacity-50 transition-all font-bold flex items-center justify-center gap-1.5"
          >
            {isSaving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Github className="h-3 w-3" />}
            {isConnected ? "Update Config" : "Connect"}
          </button>
          {isConnected && (
            <button
              onClick={onSync}
              disabled={isSyncing}
              className="flex-1 py-2 bg-green-400/15 border border-green-400/30 text-green-400 text-xs rounded-xl hover:bg-green-400/25 disabled:opacity-50 transition-all font-bold flex items-center justify-center gap-1.5"
            >
              {isSyncing ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
              Sync Now
            </button>
          )}
        </div>
      </motion.div>
    </div>
  );
}

// ── Preview Tab ───────────────────────────────────────────────────────────────
function PreviewTab({
  previewUrl, activeSandboxId, activeSandbox, activeSessionId, projectFiles,
  isSandboxLoading, token, onGetPreviewUrl, onAutoDeployAndStart, setCustomDomainAction, onSandboxUpdate,
}: {
  previewUrl: string | null;
  activeSandboxId: Id<"sandboxes"> | null;
  activeSandbox: SandboxRow | null;
  activeSessionId: Id<"teamSessions"> | null;
  projectFiles: ProjectFile[];
  isSandboxLoading: boolean;
  token: string;
  onGetPreviewUrl: () => void;
  onAutoDeployAndStart: () => void;
  setCustomDomainAction: (args: { token: string; sandboxDbId: Id<"sandboxes">; customDomain?: string }) => Promise<{ ok: boolean; message: string }>;
  onSandboxUpdate: (updated: SandboxRow) => void;
}) {
  const [customDomainInput, setCustomDomainInput] = useState("");
  const [isSettingDomain, setIsSettingDomain] = useState(false);
  const [showDomainInput, setShowDomainInput] = useState(false);
  const currentCustomDomain = (activeSandbox as Record<string, unknown> | null)?.customDomain as string | undefined;

  const handleSetCustomDomain = async () => {
    if (!activeSandboxId || !customDomainInput.trim()) return;
    setIsSettingDomain(true);
    try {
      const result = await setCustomDomainAction({ token, sandboxDbId: activeSandboxId, customDomain: customDomainInput.trim() });
      toast.success(result.message || `Custom domain set: ${customDomainInput.trim()}`);
      if (activeSandbox) onSandboxUpdate({ ...activeSandbox, customDomain: customDomainInput.trim() } as SandboxRow);
      setCustomDomainInput("");
      setShowDomainInput(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to set custom domain");
    } finally {
      setIsSettingDomain(false);
    }
  };

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="shrink-0 px-4 py-2 border-b border-border bg-card/50 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Globe className="h-3.5 w-3.5 text-green-400" />
          <span className="text-xs font-bold text-green-400">WEB PREVIEW</span>
          {previewUrl && <span className="text-xs text-muted-foreground truncate max-w-xs">{previewUrl}</span>}
        </div>
        <div className="flex items-center gap-2">
          {previewUrl && (
            <a href={previewUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-xs text-primary hover:underline">
              <ExternalLink className="h-3 w-3" />Open
            </a>
          )}
          {activeSandboxId && (
            <button onClick={onGetPreviewUrl} disabled={isSandboxLoading} className="text-xs text-muted-foreground hover:text-foreground border border-border px-2 py-1 rounded-lg transition-colors">
              {isSandboxLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : "Refresh"}
            </button>
          )}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-6 space-y-4">
        {previewUrl ? (
          <div className="space-y-4">
            {/* Live Preview URL */}
            <div className="bg-green-400/5 border border-green-400/20 rounded-xl p-4">
              <div className="flex items-center gap-2 mb-2">
                <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
                <p className="text-xs font-bold text-green-400">LIVE PREVIEW</p>
              </div>
              <p className="text-[10px] text-muted-foreground mb-2">Your app is running on Daytona cloud sandbox:</p>
              <div className="flex items-center gap-2">
                <p className="text-xs text-primary font-mono break-all flex-1">{previewUrl}</p>
                <a href={previewUrl} target="_blank" rel="noopener noreferrer"
                  className="shrink-0 flex items-center gap-1 px-3 py-1.5 bg-primary text-primary-foreground text-xs rounded-lg hover:bg-primary/90 transition-all font-bold">
                  <ExternalLink className="h-3 w-3" />Open
                </a>
              </div>
            </div>

            {/* Custom Domain */}
            <div className="bg-card border border-border rounded-xl p-4">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <p className="text-xs font-bold text-foreground">Custom Domain</p>
                  <p className="text-[10px] text-muted-foreground">Connect your own domain to this deployment</p>
                </div>
                {!showDomainInput && (
                  <button onClick={() => setShowDomainInput(true)}
                    className="flex items-center gap-1 px-2 py-1 bg-primary/10 border border-primary/30 text-primary text-[10px] rounded-lg hover:bg-primary/20 transition-all font-bold">
                    <Plus className="h-3 w-3" />{currentCustomDomain ? "Change" : "Add Domain"}
                  </button>
                )}
              </div>
              {currentCustomDomain && !showDomainInput && (
                <div className="flex items-center gap-2 p-2 bg-muted/30 rounded-lg">
                  <Globe className="h-3 w-3 text-primary shrink-0" />
                  <p className="text-xs text-primary font-mono">{currentCustomDomain}</p>
                  <span className="text-[9px] bg-amber-400/15 text-amber-400 border border-amber-400/30 px-1.5 py-0.5 rounded-full font-bold ml-auto">PENDING DNS</span>
                </div>
              )}
              {showDomainInput && (
                <div className="space-y-2">
                  <input
                    value={customDomainInput}
                    onChange={e => setCustomDomainInput(e.target.value)}
                    onKeyDown={e => { if (e.key === "Enter") handleSetCustomDomain(); if (e.key === "Escape") setShowDomainInput(false); }}
                    placeholder="yourdomain.com"
                    className="w-full bg-background border border-border rounded-lg px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/60 transition-colors"
                  />
                  <p className="text-[9px] text-muted-foreground">Point your domain's CNAME to: <code className="bg-muted px-1 rounded">proxy.aphantic.io</code></p>
                  <div className="flex gap-2">
                    <button onClick={handleSetCustomDomain} disabled={isSettingDomain || !customDomainInput.trim()}
                      className="flex-1 py-1.5 bg-primary/15 border border-primary/30 text-primary text-xs rounded-lg hover:bg-primary/25 disabled:opacity-50 transition-all font-bold flex items-center justify-center gap-1">
                      {isSettingDomain ? <Loader2 className="h-3 w-3 animate-spin" /> : <Globe className="h-3 w-3" />}
                      Set Domain
                    </button>
                    <button onClick={() => setShowDomainInput(false)} className="px-3 py-1.5 border border-border text-muted-foreground text-xs rounded-lg hover:bg-muted/50 transition-all">
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Deployment Info */}
            <div className="bg-card border border-border rounded-xl p-4">
              <p className="text-xs font-bold text-foreground mb-2">Deployment Info</p>
              <div className="space-y-1.5 text-[10px] text-muted-foreground">
                <div className="flex justify-between"><span>Environment</span><span className="text-foreground font-mono">Daytona Cloud Sandbox</span></div>
                <div className="flex justify-between"><span>Port</span><span className="text-foreground font-mono">3000</span></div>
                <div className="flex justify-between"><span>Status</span><span className={activeSandbox?.status === "running" ? "text-green-400 font-bold" : "text-muted-foreground"}>{activeSandbox?.status ?? "unknown"}</span></div>
                <div className="flex justify-between"><span>Billing</span><span className="text-amber-400 font-mono">{activeSandbox?.costCents ? `${(activeSandbox.costCents / 100).toFixed(4)} USD` : "Free tier"}</span></div>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center h-full gap-4">
            <Monitor className="h-16 w-16 text-muted-foreground/20" />
            <div className="text-center">
              <p className="text-sm font-bold text-foreground mb-1">No Preview Available</p>
              <p className="text-xs text-muted-foreground mb-4">Deploy your project and start the app to see a live preview</p>
              {activeSandboxId && activeSessionId && (
                <button onClick={onAutoDeployAndStart} disabled={isSandboxLoading || projectFiles.length === 0}
                  className="flex items-center gap-2 px-4 py-2 bg-primary/10 border border-primary/30 text-primary text-sm rounded-xl hover:bg-primary/20 disabled:opacity-50 transition-all font-bold mx-auto">
                  {isSandboxLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Globe className="h-4 w-4" />}
                  DEPLOY & START APP
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Files Tab for TeamPortalInline ────────────────────────────────────────────
function FilesTabInline({
  projectFiles, selectedFile, setSelectedFile, activeSessionId, token,
}: {
  projectFiles: ProjectFile[];
  selectedFile: ProjectFile | null;
  setSelectedFile: (f: ProjectFile | null) => void;
  activeSessionId: Id<"teamSessions"> | null;
  token: string;
}) {
  const deleteFileMutation = useMutation(api.agentTeamHelpers.deleteFilePublic);
  const renameFileMutation = useMutation(api.agentTeamHelpers.renameFilePublic);
  const createFileMutation = useMutation(api.agentTeamHelpers.createFilePublic);
  const duplicateFileMutation = useMutation(api.agentTeamHelpers.duplicateFilePublic);
  const importFromGithubAction = useAction(api.agentTeam.importFromGithub);
  const vectorizeSessionAction = useAction(api.agentTeam.vectorizeSessionPublic);
  const [isImporting, setIsImporting] = useState(false);
  const [isVectorizing, setIsVectorizing] = useState(false);
  const [showGithubModal, setShowGithubModal] = useState(false);
  const [githubUrl, setGithubUrl] = useState("");
  const [githubBranch, setGithubBranch] = useState("main");

  const handleGithubImport = async () => {
    if (!activeSessionId || !token || !githubUrl.trim()) return;
    setIsImporting(true);
    try {
      const result = await importFromGithubAction({
        sessionId: activeSessionId,
        repoUrl: githubUrl.trim(),
        branch: githubBranch.trim() || "main",
        token,
      });
      toast.success(`Imported ${result.imported} files from GitHub`);
      if (result.errors.length > 0) toast.warning(`${result.errors.length} file(s) failed to import`);
      setShowGithubModal(false);
      setGithubUrl("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "GitHub import failed");
    } finally {
      setIsImporting(false);
    }
  };

  const handleVectorizeAll = async () => {
    if (!activeSessionId || !token) return;
    setIsVectorizing(true);
    try {
      const result = await vectorizeSessionAction({ sessionId: activeSessionId, token });
      toast.success(`Vectorized ${result.indexed} files into RAG database`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Vectorization failed");
    } finally {
      setIsVectorizing(false);
    }
  };

  const handleDelete = async (node: FileTreeNode) => {
    if (!activeSessionId || !token) return;
    try {
      if (node.type === "folder") {
        // Delete all files under this folder
        const toDelete = projectFiles.filter(f => f.filepath === node.path || f.filepath.startsWith(node.path + "/"));
        await Promise.all(toDelete.map(f => deleteFileMutation({ sessionId: activeSessionId, filepath: f.filepath, token })));
        toast.success(`Folder "${node.name}" deleted`);
      } else {
        await deleteFileMutation({ sessionId: activeSessionId, filepath: node.path, token });
        if (selectedFile?.filepath === node.path) setSelectedFile(null);
        toast.success(`File "${node.name}" deleted`);
      }
    } catch (err) { toast.error(err instanceof Error ? err.message : "Delete failed"); }
  };

  const handleRename = async (node: FileTreeNode, newName: string) => {
    if (!activeSessionId || !token || !newName.trim()) return;
    try {
      if (node.type === "folder") {
        // Rename all files under this folder
        const toRename = projectFiles.filter(f => f.filepath === node.path || f.filepath.startsWith(node.path + "/"));
        const parentDir = node.path.includes("/") ? node.path.substring(0, node.path.lastIndexOf("/")) : "";
        const newFolderPath = parentDir ? `${parentDir}/${newName.trim()}` : newName.trim();
        await Promise.all(toRename.map(f => {
          const newPath = newFolderPath + f.filepath.slice(node.path.length);
          return renameFileMutation({ sessionId: activeSessionId, oldPath: f.filepath, newPath, token });
        }));
        toast.success(`Folder renamed to "${newName}"`);
      } else {
        const dir = node.path.includes("/") ? node.path.substring(0, node.path.lastIndexOf("/")) : "";
        const newPath = dir ? `${dir}/${newName.trim()}` : newName.trim();
        await renameFileMutation({ sessionId: activeSessionId, oldPath: node.path, newPath, token });
        if (selectedFile?.filepath === node.path) setSelectedFile({ ...selectedFile, filepath: newPath });
        toast.success(`Renamed to "${newName}"`);
      }
    } catch (err) { toast.error(err instanceof Error ? err.message : "Rename failed"); }
  };

  const handleDuplicate = async (node: FileTreeNode) => {
    if (!activeSessionId || !token) return;
    try {
      if (node.type === "file") {
        const dir = node.path.includes("/") ? node.path.substring(0, node.path.lastIndexOf("/")) : "";
        const ext = node.name.includes(".") ? node.name.substring(node.name.lastIndexOf(".")) : "";
        const base = node.name.includes(".") ? node.name.substring(0, node.name.lastIndexOf(".")) : node.name;
        const newPath = dir ? `${dir}/${base}_copy${ext}` : `${base}_copy${ext}`;
        await duplicateFileMutation({ sessionId: activeSessionId, sourcePath: node.path, destPath: newPath, token });
        toast.success(`Duplicated as "${base}_copy${ext}"`);
      } else {
        toast.info("Folder duplication not supported yet");
      }
    } catch (err) { toast.error(err instanceof Error ? err.message : "Duplicate failed"); }
  };

  const handleDownload = (node: FileTreeNode) => {
    if (node.type === "file" && node.file) {
      const a = document.createElement("a");
      a.href = `data:text/plain;charset=utf-8,${encodeURIComponent(node.file.content)}`;
      a.download = node.name;
      a.click();
    } else if (node.type === "folder") {
      // Download all files in folder as a zip-like text
      const folderFiles = projectFiles.filter(f => f.filepath.startsWith(node.path + "/") || f.filepath === node.path);
      const content = folderFiles.map(f => `=== ${f.filepath} ===\n${f.content}`).join("\n\n");
      const a = document.createElement("a");
      a.href = `data:text/plain;charset=utf-8,${encodeURIComponent(content)}`;
      a.download = `${node.name}.txt`;
      a.click();
    }
  };

  const handleCreateFile = async (parentPath: string) => {
    if (!activeSessionId || !token) return;
    const name = prompt("File name:");
    if (!name?.trim()) return;
    const filepath = parentPath ? `${parentPath}/${name.trim()}` : name.trim();
    try {
      await createFileMutation({ sessionId: activeSessionId, filepath, content: "", token });
      toast.success(`Created "${name}"`);
    } catch (err) { toast.error(err instanceof Error ? err.message : "Create failed"); }
  };

  const handleCreateFolder = async (parentPath: string) => {
    if (!activeSessionId || !token) return;
    const name = prompt("Folder name:");
    if (!name?.trim()) return;
    const filepath = parentPath ? `${parentPath}/${name.trim()}/.gitkeep` : `${name.trim()}/.gitkeep`;
    try {
      await createFileMutation({ sessionId: activeSessionId, filepath, content: "", token });
      toast.success(`Folder "${name}" created`);
    } catch (err) { toast.error(err instanceof Error ? err.message : "Create failed"); }
  };

  const handleMove = async (sourcePath: string, destFolderPath: string) => {
    if (!activeSessionId || !token) return;
    const fileName = sourcePath.split("/").pop() ?? sourcePath;
    const newPath = destFolderPath ? `${destFolderPath}/${fileName}` : fileName;
    if (newPath === sourcePath) return;
    try {
      await renameFileMutation({ sessionId: activeSessionId, oldPath: sourcePath, newPath, token });
      if (selectedFile?.filepath === sourcePath) setSelectedFile({ ...selectedFile, filepath: newPath });
      toast.success(`Moved to ${destFolderPath || "root"}`);
    } catch (err) { toast.error(err instanceof Error ? err.message : "Move failed"); }
  };

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!activeSessionId || !token) return;
    const files = Array.from(e.target.files ?? []);
    for (const file of files) {
      try {
        const text = await file.text();
        await createFileMutation({ sessionId: activeSessionId, filepath: file.name, content: text, token });
        toast.success(`Uploaded "${file.name}"`);
      } catch { toast.error(`Failed to upload "${file.name}"`); }
    }
    e.target.value = "";
  };

  const treeFiles: FileTreeFile[] = projectFiles.map(f => ({ filepath: f.filepath, content: f.content, lastModifiedBy: f.lastModifiedBy }));

  return (
    <div className="h-full flex overflow-hidden relative">
      {/* GitHub Import Modal */}
      <AnimatePresence>
        {showGithubModal && (
          <div className="absolute inset-0 z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-background/80 backdrop-blur-sm"
              onClick={() => setShowGithubModal(false)}
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              className="relative z-10 bg-card border border-border rounded-2xl shadow-2xl p-6 w-full max-w-md"
            >
              <div className="flex items-center gap-2 mb-4">
                <Github className="h-5 w-5 text-foreground" />
                <h3 className="text-sm font-bold text-foreground">Import from GitHub</h3>
              </div>
              <p className="text-xs text-muted-foreground mb-4">
                Import files from any <strong>public</strong> GitHub repository. No access token required.
              </p>
              <div className="space-y-3">
                <div>
                  <label className="text-[10px] font-bold text-muted-foreground block mb-1">REPOSITORY URL</label>
                  <input
                    value={githubUrl}
                    onChange={e => setGithubUrl(e.target.value)}
                    placeholder="https://github.com/owner/repo or owner/repo"
                    className="w-full bg-background border border-border rounded-lg px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/60 transition-colors"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-bold text-muted-foreground block mb-1">BRANCH (optional)</label>
                  <input
                    value={githubBranch}
                    onChange={e => setGithubBranch(e.target.value)}
                    placeholder="main"
                    className="w-full bg-background border border-border rounded-lg px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/60 transition-colors"
                  />
                </div>
                <div className="bg-amber-400/10 border border-amber-400/20 rounded-lg px-3 py-2">
                  <p className="text-[10px] text-amber-400">
                    ⚠ Files will be imported into the current session. Binary files, node_modules, and files over 100KB are skipped. Max 200 files.
                  </p>
                </div>
              </div>
              <div className="flex gap-2 mt-4">
                <button
                  onClick={() => setShowGithubModal(false)}
                  className="flex-1 px-4 py-2 border border-border text-muted-foreground text-xs rounded-xl hover:bg-muted/50 transition-all"
                >
                  Cancel
                </button>
                <button
                  onClick={handleGithubImport}
                  disabled={isImporting || !githubUrl.trim()}
                  className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-primary text-primary-foreground text-xs rounded-xl hover:bg-primary/90 disabled:opacity-50 transition-all font-bold"
                >
                  {isImporting ? <><Loader2 className="h-3 w-3 animate-spin" />Importing...</> : <><Github className="h-3 w-3" />Import</>}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* File tree sidebar */}
      <div className="w-56 shrink-0 border-r border-border flex flex-col overflow-hidden">
        {/* Header */}
        <div className="shrink-0 px-3 py-2 border-b border-border bg-card/50 flex flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold text-foreground">{projectFiles.length} FILES</span>
            <div className="flex items-center gap-1">
              <button
                onClick={() => handleCreateFile("")}
                className="flex items-center gap-0.5 px-1.5 py-0.5 bg-primary/10 border border-primary/30 text-primary text-[9px] rounded hover:bg-primary/20 transition-all"
                title="New File"
              >+ File</button>
              <button
                onClick={() => handleCreateFolder("")}
                className="flex items-center gap-0.5 px-1.5 py-0.5 bg-amber-400/10 border border-amber-400/30 text-amber-400 text-[9px] rounded hover:bg-amber-400/20 transition-all"
                title="New Folder"
              >+ Folder</button>
              <label className="cursor-pointer flex items-center gap-0.5 px-1.5 py-0.5 bg-muted/50 border border-border text-muted-foreground text-[9px] rounded hover:bg-muted transition-all" title="Upload">
                <Upload className="h-2.5 w-2.5" />
                <input type="file" multiple className="hidden" onChange={handleUpload} />
              </label>
            </div>
          </div>
          {/* GitHub import + Vectorize buttons */}
          <div className="flex gap-1">
            <button
              onClick={() => setShowGithubModal(true)}
              className="flex-1 flex items-center justify-center gap-1 px-2 py-1 bg-muted/50 border border-border text-muted-foreground text-[9px] rounded hover:bg-muted hover:text-foreground transition-all"
            >
              <Github className="h-2.5 w-2.5" />GitHub
            </button>
            <button
              onClick={handleVectorizeAll}
              disabled={isVectorizing || projectFiles.length === 0}
              className="flex-1 flex items-center justify-center gap-1 px-2 py-1 bg-muted/50 border border-border text-muted-foreground text-[9px] rounded hover:bg-muted hover:text-foreground disabled:opacity-50 transition-all"
              title="Vectorize all files into RAG database"
            >
              {isVectorizing ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : <Database className="h-2.5 w-2.5" />}
              RAG
            </button>
          </div>
        </div>
        {/* Tree */}
        <FileTreeView
          files={treeFiles}
          selectedPath={selectedFile?.filepath ?? null}
          onSelect={(f) => setSelectedFile(f)}
          onDelete={handleDelete}
          onDuplicate={handleDuplicate}
          onRename={handleRename}
          onDownload={handleDownload}
          onCreateFile={handleCreateFile}
          onCreateFolder={handleCreateFolder}
          onMove={handleMove}
        />
      </div>
      {/* File content */}
      <div className="flex-1 overflow-y-auto min-w-0">
        {selectedFile ? (
          <div className="p-4">
            <div className="flex items-center gap-2 mb-3">
              <FileCode className="h-4 w-4 text-primary" />
              <span className="text-xs font-bold text-primary truncate">{selectedFile.filepath}</span>
              <span className="text-[10px] text-muted-foreground ml-auto shrink-0">by {selectedFile.lastModifiedBy}</span>
              <a
                href={`data:text/plain;charset=utf-8,${encodeURIComponent(selectedFile.content)}`}
                download={selectedFile.filepath.split("/").pop() ?? "file"}
                className="shrink-0 flex items-center gap-1 px-1.5 py-0.5 bg-primary/10 border border-primary/30 text-primary text-[9px] rounded hover:bg-primary/20 transition-all"
              >DL</a>
            </div>
            <pre className="text-[11px] text-foreground bg-background border border-border rounded-xl p-4 overflow-x-auto whitespace-pre-wrap break-words">
              {selectedFile.content}
            </pre>
          </div>
        ) : (
          <div className="h-full flex items-center justify-center">
            <p className="text-xs text-muted-foreground">Select a file to view</p>
          </div>
        )}
      </div>
    </div>
  );
}

// ── TeamPortalInline — embeddable agent team UI ────────────────────────────────
export default function TeamPortalInline({ token, initialSessionCustomId, onSessionChange }: { token: string; initialSessionCustomId?: string | null; onSessionChange?: (customId: string | null) => void }) {
  const [sessions, setSessions] = useState<TeamSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<Id<"teamSessions"> | null>(null);
  const [task, setTask] = useState("");
  const [isRunning, setIsRunning] = useState(false);
  const [currentAgent, setCurrentAgent] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"chat" | "files" | "sandbox" | "preview">("chat");
  const [selectedFile, setSelectedFile] = useState<ProjectFile | null>(null);
  const [messageInput, setMessageInput] = useState("");
  const [messageQueue, setMessageQueue] = useState<QueuedMessage[]>([]);
  const [userMessages, setUserMessages] = useState<AgentMessage[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const autoRunRef = useRef(false);

  // Sandbox state
  const [sandboxes, setSandboxes] = useState<SandboxRow[]>([]);
  const [activeSandboxId, setActiveSandboxId] = useState<Id<"sandboxes"> | null>(null);
  const [activeSandbox, setActiveSandbox] = useState<SandboxRow | null>(null);
  const [sandboxCommand, setSandboxCommand] = useState("");
  const [sandboxOutput, setSandboxOutput] = useState<Array<{ cmd: string; out: string; code: number }>>([]);
  const [isSandboxLoading, setIsSandboxLoading] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const sandboxOutputEndRef = useRef<HTMLDivElement>(null);

  // Deploy commands state
  const [deployCommands, setDeployCommands] = useState<string[]>([]);
  const [isDeploying, setIsDeploying] = useState(false);
  const [deployLog, setDeployLog] = useState<Array<{ cmd: string; output: string; exitCode: number }>>([]);

  // Reactive queries
  const liveSession = useQuery(api.agentTeamHelpers.watchSession, activeSessionId ? { sessionId: activeSessionId } : "skip");
  const liveMessages = useQuery(api.agentTeamHelpers.watchMessages, activeSessionId ? { sessionId: activeSessionId } : "skip");
  const liveFiles = useQuery(api.agentTeamHelpers.watchFiles, activeSessionId ? { sessionId: activeSessionId } : "skip");

  const sessionInfo = liveSession ? {
    _id: liveSession._id,
    title: liveSession.title,
    status: liveSession.status,
    round: liveSession.round ?? 0,
    task: liveSession.task,
    phase: liveSession.phase ?? "Researcher",
    totalMessages: liveSession.totalMessages ?? 0,
    loopCount: liveSession.loopCount ?? 0,
    currentAgent: liveSession.currentAgent,
    currentAgentOutput: liveSession.currentAgentOutput,
    executionPhase: (liveSession as Record<string, unknown>).executionPhase as string | undefined,
    currentTaskIndex: (liveSession as Record<string, unknown>).currentTaskIndex as number | undefined,
    plannerTasksJson: (liveSession as Record<string, unknown>).plannerTasksJson as string | undefined,
    finalReviewCoderEnabled: (liveSession as Record<string, unknown>).finalReviewCoderEnabled as boolean | undefined,
  } as TeamSession : null;

  const agentMessages: AgentMessage[] = (liveMessages ?? []).map((m) => ({
    _id: m._id as string, agent: m.agent, content: m.content, round: m.round, messageIndex: m.messageIndex,
    modelUsed: (m as Record<string, unknown>).modelUsed as string | undefined,
    agentBucksDeducted: (m as Record<string, unknown>).agentBucksDeducted as number | undefined,
  }));

  // Stable sort: messages with no messageIndex go to the END (not beginning)
  // Use a large fallback value so undefined messageIndex sorts last
  const allMessages: AgentMessage[] = [...agentMessages, ...userMessages].sort((a, b) => {
    const ai = a.messageIndex ?? 999999;
    const bi = b.messageIndex ?? 999999;
    if (ai !== bi) return ai - bi;
    // Tiebreaker: user messages (isUser) go after agent messages at same index
    if (a.isUser && !b.isUser) return 1;
    if (!a.isUser && b.isUser) return -1;
    return 0;
  });

  const projectFiles: ProjectFile[] = (liveFiles ?? []).map((f) => ({
    filepath: f.filepath, content: f.content, lastModifiedBy: f.lastModifiedBy,
  }));

  // Actions
  const createSession = useAction(api.agentTeam.createSession);
  const startBackgroundSession = useAction(api.agentTeam.startBackgroundSession);
  const stopSessionAction = useAction(api.agentTeam.stopSession);
  const resetSessionLimitAction = useAction(api.agentTeam.resetSessionLimit);
  const listSessionsAction = useAction(api.agentTeam.listSessions);
  const continueSessionAction = useAction(api.agentTeam.continueSession);
  const createSandboxAction = useAction(api.sandbox.createSandbox);
  const executeCommandAction = useAction(api.sandbox.executeCommand);
  const stopSandboxAction = useAction(api.sandbox.stopSandbox);
  const listSandboxesAction = useAction(api.sandbox.listSandboxes);
  const getPreviewUrlAction = useAction(api.sandbox.getPreviewUrl);
  const autoDeployAndStartAction = useAction(api.sandbox.autoDeployAndStart);
  const testFileWriteAction = useAction(api.sandbox.testFileWrite);
  const syncSandboxFilesAction = useAction(api.sandbox.syncSandboxFiles);
  const runDeployCommandsAction = useAction(api.sandbox.runDeployCommands);

  useEffect(() => { if (token) { loadSessions(); loadSandboxes(); } }, [token]);

  // Auto-select session from URL when sessions load
  useEffect(() => {
    if (!initialSessionCustomId || activeSessionId) return;
    const match = sessions.find(s => {
      const raw = s as unknown as Record<string, unknown>;
      return raw.customId === initialSessionCustomId;
    });
    if (match) setActiveSessionId(match._id);
  }, [initialSessionCustomId, sessions, activeSessionId]);

  // Update document title based on active session
  useEffect(() => {
    if (sessionInfo?.title) {
      document.title = `${sessionInfo.title} | Thalamus AI`;
    } else {
      document.title = "Thalamus AI";
    }
    return () => { document.title = "Thalamus AI"; };
  }, [sessionInfo?.title]);
  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [allMessages, sessionInfo?.currentAgentOutput]);
  useEffect(() => { sandboxOutputEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [sandboxOutput]);

  const prevMsgCount = useRef(0);
  useEffect(() => {
    if (agentMessages.length > prevMsgCount.current) {
      playSound("receive");
      prevMsgCount.current = agentMessages.length;
    }
  }, [agentMessages.length]);

  const loadSessions = async () => {
    if (!token) return;
    try { const data = await listSessionsAction({ token }); setSessions(data as TeamSession[]); } catch { /* ignore */ }
  };

  const loadSandboxes = async () => {
    if (!token) return;
    try {
      const data = await listSandboxesAction({ token });
      const rows = data as SandboxRow[];
      setSandboxes(rows);
      const running = rows.find(s => s.status === "running");
      if (running && !activeSandboxId) {
        setActiveSandboxId(running._id as Id<"sandboxes">);
        setActiveSandbox(running);
        if (running.previewUrl) setPreviewUrl(running.previewUrl);
      }
    } catch { /* ignore */ }
  };

  const handleSelectSession = (sessionId: Id<"teamSessions">) => {
    setActiveSessionId(sessionId);
    setUserMessages([]);
    setMessageQueue([]);
  };

  const handleCreateSession = async () => {
    if (!task.trim() || !token) return;
    setIsRunning(true);
    try {
      const result = await createSession({ task: task.trim(), token });
      const { sessionId, customId } = result as { sessionId: Id<"teamSessions">; customId: string };
      setActiveSessionId(sessionId);
      onSessionChange?.(customId);
      setTask("");
      setUserMessages([]);
      setMessageQueue([]);
      await loadSessions();
      // Start background execution — continues even when tab is closed
      await startBackgroundSession({ sessionId, token });
      toast.success("Session started! Running in background — you can close this tab.");
      playSound("send");
    } catch { toast.error("Failed to create session"); playSound("error"); }
    finally { setIsRunning(false); }
  };

  const handleQueuedMessage = async (text: string, sid: Id<"teamSessions">) => {
    if (!token) return;
    try {
      await continueSessionAction({ sessionId: sid, newTask: text, token });
      await loadSessions();
      await startBackgroundSession({ sessionId: sid, token });
    } catch { toast.error("Failed to process queued message"); }
  };

  // Watch for session completion to process message queue
  useEffect(() => {
    if (!activeSessionId || !sessionInfo) return;
    if (sessionInfo.status === "completed" || sessionInfo.totalMessages >= MAX_MESSAGES) {
      if (messageQueue.length > 0) {
        const next = messageQueue[0];
        setMessageQueue(prev => prev.slice(1));
        setTimeout(() => handleQueuedMessage(next.text, activeSessionId), 500);
      }
    }
  }, [sessionInfo?.status, sessionInfo?.totalMessages, activeSessionId]);

  const [showGithubModal, setShowGithubModal] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const saveGithubConfigAction = useAction(api.agentTeam.saveGithubConfig);
  const syncGithubAction = useAction(api.agentTeam.syncGithub);
  const setCustomDomainAction = useAction(api.sandbox.setCustomDomain);
  const setManualUpgradeMutation = useMutation(api.agentTeamHelpers.setManualUpgrade);
  const forceActivateUpgradeMutation = useMutation(api.agentTeamHelpers.forceActivateUpgrade);
  const handleAutoRun = async () => {
    if (!activeSessionId || !token) return;
    setIsRunning(true);
    try {
      await startBackgroundSession({ sessionId: activeSessionId, token });
      toast.success("Running in background — you can close this tab.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to start");
    } finally { setIsRunning(false); }
  };
  const handleStopAutoRun = async () => {
    if (!activeSessionId || !token) return;
    try {
      await stopSessionAction({ sessionId: activeSessionId, token });
      toast.success("Session stopped.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to stop session");
    }
  };

  const handleResetLimit = async () => {
    if (!activeSessionId || !token) return;
    try {
      await resetSessionLimitAction({ sessionId: activeSessionId, token });
      toast.success("Message limit reset — session can continue.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to reset limit");
    }
  };

  const handleToggleManualUpgrade = async () => {
    if (!activeSessionId || !token) return;
    const current = (sessionInfo as unknown as Record<string, unknown>)?.manualUpgradeEnabled as boolean | undefined;
    const newVal = !current;
    try {
      await setManualUpgradeMutation({ sessionId: activeSessionId, enabled: newVal, token });
      toast.success(newVal ? "⚡ Upgrade armed — activates on next rejection" : "Upgrade disarmed");
    } catch (err) { toast.error(err instanceof Error ? err.message : "Failed to toggle upgrade"); }
  };

  const handleForceUpgrade = async () => {
    if (!activeSessionId || !token) return;
    try {
      await forceActivateUpgradeMutation({ sessionId: activeSessionId, token });
      toast.success("⚡ Force Upgrade activated — all agents now running at Opus tier");
    } catch (err) { toast.error(err instanceof Error ? err.message : "Failed to force upgrade"); }
  };

  const handleSaveGithubConfig = async (repo: string, branch: string, ghToken: string) => {
    if (!activeSessionId || !token) return;
    try {
      await saveGithubConfigAction({ sessionId: activeSessionId, githubRepo: repo, githubBranch: branch, githubToken: ghToken, token });
      toast.success("GitHub connected! Auto-sync enabled.");
      // Immediately sync after connecting
      setIsSyncing(true);
      try {
        const result = await syncGithubAction({ sessionId: activeSessionId, token });
        toast.success(`Synced: ↑${result.pushed} pushed, ↓${result.pulled} pulled`);
        if (result.conflicts.length > 0) toast.warning(`${result.conflicts.length} conflict(s) — GitHub version kept`);
      } catch (err) { toast.error(err instanceof Error ? err.message : "Sync failed"); }
      finally { setIsSyncing(false); }
    } catch (err) { toast.error(err instanceof Error ? err.message : "Failed to save config"); }
  };

  const handleGithubSync = async () => {
    if (!activeSessionId || !token) return;
    setIsSyncing(true);
    try {
      const result = await syncGithubAction({ sessionId: activeSessionId, token });
      toast.success(`Synced: ↑${result.pushed} pushed, ↓${result.pulled} pulled`);
      if (result.conflicts.length > 0) toast.warning(`${result.conflicts.length} conflict(s) — GitHub version kept`);
    } catch (err) { toast.error(err instanceof Error ? err.message : "Sync failed"); }
    finally { setIsSyncing(false); }
  };

  // Auto-sync every 60 seconds if GitHub is configured
  useEffect(() => {
    if (!activeSessionId || !token) return;
    const githubRepo = (liveSession as Record<string, unknown> | null)?.githubRepo as string | undefined;
    if (!githubRepo) return;
    const interval = setInterval(() => {
      syncGithubAction({ sessionId: activeSessionId, token }).catch(() => {});
    }, 60_000);
    return () => clearInterval(interval);
  }, [activeSessionId, token, (liveSession as Record<string, unknown> | null)?.githubRepo]);

  const handleSendMessage = async () => {
    const text = messageInput.trim();
    if (!text) return;
    setMessageInput("");
    playSound("send");
    if (!activeSessionId) { setTask(text); return; }
    const userMsg: AgentMessage = {
      _id: `user-${Date.now()}`, agent: "User", content: text, isUser: true,
      messageIndex: (sessionInfo?.totalMessages ?? 0) + 0.5,
    };
    setUserMessages(prev => [...prev, userMsg]);
    const bgRunning = sessionInfo?.status === "running";
    if (isRunning || bgRunning) {
      const queued: QueuedMessage = { id: `q-${Date.now()}`, text, timestamp: Date.now() };
      setMessageQueue(prev => [...prev, queued]);
      toast.info(`Message queued (${messageQueue.length + 1} in queue)`);
      playSound("queue");
    } else {
      try {
        await continueSessionAction({ sessionId: activeSessionId, newTask: text, token });
        await loadSessions();
        await startBackgroundSession({ sessionId: activeSessionId, token });
        toast.success("Running in background — you can close this tab.");
      } catch { toast.error("Failed to send message"); }
    }
  };

  const handleQueueMessage = () => {
    const text = messageInput.trim();
    if (!text || !activeSessionId) return;
    setMessageInput("");
    playSound("queue");
    const userMsg: AgentMessage = {
      _id: `user-${Date.now()}`, agent: "User", content: text, isUser: true,
      messageIndex: (sessionInfo?.totalMessages ?? 0) + messageQueue.length + 0.5,
    };
    setUserMessages(prev => [...prev, userMsg]);
    const queued: QueuedMessage = { id: `q-${Date.now()}`, text, timestamp: Date.now() };
    setMessageQueue(prev => [...prev, queued]);
    toast.success(`Message queued (position ${messageQueue.length + 1})`);
  };

  const handleMessageKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) handleQueueMessage();
      else handleSendMessage();
    }
  };

  // Sandbox handlers
  const handleCreateSandbox = async () => {
    if (!token) return;
    setIsSandboxLoading(true);
    try {
      const result = await createSandboxAction({ token, label: activeSessionId ? `session-${activeSessionId.slice(-6)}` : "manual", sessionId: activeSessionId ?? undefined });
      setActiveSandboxId(result.sandboxDbId as Id<"sandboxes">);
      setSandboxOutput([]);
      await loadSandboxes();
      toast.success("Sandbox created!");
    } catch (err: unknown) { toast.error(err instanceof Error ? err.message : "Failed"); }
    finally { setIsSandboxLoading(false); }
  };

  const handleExecuteCommand = async () => {
    if (!sandboxCommand.trim() || !activeSandboxId || !token) return;
    const cmd = sandboxCommand.trim();
    setSandboxCommand("");
    setIsSandboxLoading(true);
    try {
      const result = await executeCommandAction({ token, sandboxDbId: activeSandboxId, command: cmd });
      setSandboxOutput(prev => [...prev, { cmd, out: result.output, code: result.exitCode }]);
    } catch (err: unknown) { toast.error(err instanceof Error ? err.message : "Command failed"); }
    finally { setIsSandboxLoading(false); }
  };

  const handleGetPreviewUrl = async () => {
    if (!activeSandboxId || !token) return;
    setIsSandboxLoading(true);
    try {
      const result = await getPreviewUrlAction({ token, sandboxDbId: activeSandboxId });
      if (result.previewUrl) { setPreviewUrl(result.previewUrl); setActiveTab("preview"); toast.success("Preview ready!"); }
      else toast.error("No preview URL (is the app running on port 3000?)");
    } catch (err: unknown) { toast.error(err instanceof Error ? err.message : "Failed"); }
    finally { setIsSandboxLoading(false); }
  };

  const handleAutoDeployAndStart = async () => {
    if (!activeSandboxId || !activeSessionId || !token) return;
    setIsSandboxLoading(true);
    try {
      const result = await autoDeployAndStartAction({ token, sandboxDbId: activeSandboxId, sessionId: activeSessionId });
      if (result.previewUrl) { setPreviewUrl(result.previewUrl); setActiveTab("preview"); toast.success(`Deployed ${result.deployedFiles} files → Preview ready!`); }
      else toast.success(`Deployed ${result.deployedFiles} files. App starting...`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Deploy failed";
      toast.error(msg.slice(0, 150), { duration: 8000 });
    }
    finally { setIsSandboxLoading(false); }
  };

  const handleStopSandbox = async (sandboxDbId: Id<"sandboxes">) => {
    if (!token) return;
    setIsSandboxLoading(true);
    try {
      const result = await stopSandboxAction({ token, sandboxDbId });
      if (activeSandboxId === sandboxDbId) { setActiveSandboxId(null); setActiveSandbox(null); setPreviewUrl(null); }
      await loadSandboxes();
      toast.success(`Sandbox stopped. Cost: ${Math.ceil(result.costCents * 15).toLocaleString()} AB`);
    } catch (err: unknown) { toast.error(err instanceof Error ? err.message : "Failed"); }
    finally { setIsSandboxLoading(false); }
  };

  const handleTestFileWrite = async () => {
    if (!activeSandboxId || !token) return;
    setIsSandboxLoading(true);
    try {
      const result = await testFileWriteAction({ token, sandboxDbId: activeSandboxId });
      toast[result.success ? "success" : "error"](result.success ? "✓ File write OK" : "✗ File write FAILED");
      setSandboxOutput(prev => [...prev, { cmd: "TEST WRITE", out: result.output, code: result.success ? 0 : 1 }]);
    } catch (err: unknown) { toast.error(err instanceof Error ? err.message : "Test failed"); }
    finally { setIsSandboxLoading(false); }
  };

  // Sync deploy commands from session
  useEffect(() => {
    if (sessionInfo) {
      const raw = (sessionInfo as unknown as Record<string, unknown>).deployCommandsJson as string | undefined;
      if (raw) {
        try {
          const cmds = JSON.parse(raw) as string[];
          if (Array.isArray(cmds)) setDeployCommands(cmds);
        } catch { /* ignore */ }
      }
    }
  }, [sessionInfo]);

  const handleSyncFiles = async () => {
    if (!activeSandboxId || !activeSessionId || !token) return;
    setIsSandboxLoading(true);
    try {
      const result = await syncSandboxFilesAction({ token, sandboxDbId: activeSandboxId, sessionId: activeSessionId });
      toast.success(`Synced ${result.synced} files from sandbox`);
      if (result.errors.length > 0) toast.warning(`${result.errors.length} file(s) failed to sync`);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Sync failed");
    } finally {
      setIsSandboxLoading(false);
    }
  };

  const handleRunDeployCommands = async () => {
    if (!activeSandboxId || !token || deployCommands.length === 0) return;
    setIsDeploying(true);
    setDeployLog([]);
    setActiveTab("sandbox");
    try {
      const result = await runDeployCommandsAction({ token, sandboxDbId: activeSandboxId, commands: deployCommands });
      setDeployLog(result.results);
      const failed = result.results.find(r => r.exitCode !== 0);
      if (failed) {
        toast.error(`Deploy failed at: ${failed.cmd}`);
      } else {
        toast.success("Deploy commands completed successfully!");
        // Try to get preview URL
        if (activeSandboxId) {
          setTimeout(() => handleGetPreviewUrl(), 2000);
        }
      }
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Deploy failed");
    } finally {
      setIsDeploying(false);
    }
  };

  // Derived state
  const streamingAgent = sessionInfo?.currentAgent ?? currentAgent;
  const streamingOutput = sessionInfo?.currentAgentOutput ?? "";
  const execPhase = sessionInfo?.executionPhase ?? "planning";
  const taskIndex = sessionInfo?.currentTaskIndex ?? 0;
  let plannerTasks: Array<{ id: string; title: string; description: string; subpart: boolean }> = [];
  try { if (sessionInfo?.plannerTasksJson) plannerTasks = JSON.parse(sessionInfo.plannerTasksJson); } catch { /* ignore */ }
  const execPhaseLabel = execPhase === "planning" ? "PLANNING" : execPhase === "final_review" ? "FINAL REVIEW" : `TASK ${taskIndex + 1}/${plannerTasks.length || "?"}`;
  const execPhaseColor = execPhase === "planning" ? "text-violet-400" : execPhase === "final_review" ? "text-amber-400" : "text-emerald-400";

  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  return (
    <div className="flex flex-1 overflow-hidden h-full relative">
      {/* Mobile sidebar overlay */}
      <AnimatePresence>
        {mobileSidebarOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-background/60 backdrop-blur-sm z-30 md:hidden"
            onClick={() => setMobileSidebarOpen(false)}
          />
        )}
      </AnimatePresence>

      {/* ── Left sidebar ──────────────────────────────────────────────────── */}
      <div className={`
        ${mobileSidebarOpen ? "translate-x-0" : "-translate-x-full"}
        md:translate-x-0
        fixed md:relative z-40 md:z-auto
        w-64 md:w-52 shrink-0 border-r border-border bg-card flex flex-col overflow-hidden
        transition-transform duration-200 ease-in-out
        h-full
      `}>
        {/* Mobile close button */}
        <div className="md:hidden flex items-center justify-between px-3 py-2 border-b border-border">
          <span className="text-[10px] font-bold text-muted-foreground">NAVIGATION</span>
          <button onClick={() => setMobileSidebarOpen(false)} className="text-muted-foreground hover:text-foreground p-1">
            <X className="h-4 w-4" />
          </button>
        </div>
        {/* Pipeline */}
        <div className="shrink-0 p-3 border-b border-border">
          <p className="text-[10px] text-muted-foreground font-bold mb-2">PIPELINE</p>
          <div className="space-y-0.5">
            {PIPELINE.map((agent) => {
              const isActive = streamingAgent === agent || (agent === "Researcher" && streamingAgent === "R&D Team") || (agent === "Hacker" && streamingAgent === "Red Team");
              const isDone = sessionInfo && PIPELINE.indexOf(agent) < PIPELINE.indexOf(sessionInfo.phase ?? "");
              const isNext = sessionInfo?.phase === agent && !isActive;
              const display = PIPELINE_DISPLAY[agent];
              const displayName = display?.displayName ?? agent;
              const subAgents = display?.subAgents ?? [];
              return (
                <div key={agent}>
                  <div className={`flex items-center gap-2 px-2 py-1 rounded text-[10px] transition-all ${isActive ? "bg-primary/10 border border-primary/20" : "hover:bg-muted/30"}`}>
                    <div className={`w-4 h-4 rounded flex items-center justify-center text-xs font-bold shrink-0 ${AGENT_COLORS[agent]} ${isActive ? "animate-pulse" : ""}`}>
                      {AGENT_ICONS[agent]}
                    </div>
                    <span className={`flex-1 ${isActive ? AGENT_COLORS[agent] + " font-bold" : "text-muted-foreground"}`}>{displayName}</span>
                    {subAgents.length > 0 && (
                      <span className={`text-[8px] ${isActive ? AGENT_COLORS[agent] + "/70" : "text-muted-foreground/40"}`}>({subAgents.length})</span>
                    )}
                    {isDone && <CheckCircle className="h-3 w-3 text-green-400 shrink-0" />}
                    {isNext && !isActive && <ChevronRight className="h-3 w-3 text-amber-400 shrink-0" />}
                    {isActive && <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse shrink-0" />}
                  </div>
                  {/* Show sub-agents when active */}
                  {isActive && subAgents.length > 0 && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: "auto" }}
                      className="ml-6 mt-0.5 space-y-0.5 overflow-hidden"
                    >
                      {subAgents.map((sub) => (
                        <div key={sub.name} className={`flex items-center gap-1.5 px-2 py-0.5 rounded border border-dashed ${AGENT_BG[agent] || "bg-muted/10 border-border"}`}>
                          <span className={`text-[8px] font-bold ${sub.color} shrink-0`}>{sub.abbr}</span>
                          <span className={`text-[8px] ${sub.color}/80 truncate`}>{sub.name}</span>
                        </div>
                      ))}
                    </motion.div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Task progress */}
        {plannerTasks.length > 0 && (
          <div className="shrink-0 p-3 border-b border-border">
            <p className="text-[10px] text-muted-foreground font-bold mb-2">TASKS</p>
            <div className="space-y-1">
              {plannerTasks.slice(0, 8).map((t, i) => (
                <div key={t.id} className="flex items-start gap-1.5">
                  <div className={`w-3.5 h-3.5 rounded-full shrink-0 mt-0.5 flex items-center justify-center ${i < taskIndex ? "bg-green-400" : i === taskIndex ? "bg-primary animate-pulse" : "bg-muted border border-border"}`}>
                    {i < taskIndex && <CheckCircle className="h-2 w-2 text-background" />}
                  </div>
                  <span className={`text-[9px] leading-tight ${i === taskIndex ? "text-primary font-bold" : i < taskIndex ? "text-muted-foreground line-through" : "text-muted-foreground"}`}>
                    {t.title.slice(0, 30)}
                  </span>
                </div>
              ))}
              {plannerTasks.length > 8 && <p className="text-[9px] text-muted-foreground">+{plannerTasks.length - 8} more</p>}
            </div>
          </div>
        )}

        {/* Sessions list */}
        <div className="flex-1 overflow-y-auto p-2 min-h-0">
          <div className="flex items-center justify-between mb-2">
            <p className="text-[10px] text-muted-foreground font-bold">SESSIONS</p>
            <button onClick={loadSessions} className="text-muted-foreground hover:text-primary transition-colors">
              <Activity className="h-3 w-3" />
            </button>
          </div>
          <div className="space-y-0.5">
            {sessions.map((s) => (
              <button
                key={s._id}
                onClick={() => handleSelectSession(s._id)}
                className={`w-full text-left px-2 py-1.5 rounded text-[10px] transition-all ${
                  activeSessionId === s._id ? "bg-primary/15 border border-primary/20 text-primary" : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                }`}
              >
                <div className="flex items-center gap-1.5">
                  <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${s.status === "completed" ? "bg-green-400" : s.status === "running" ? "bg-primary animate-pulse" : "bg-muted-foreground"}`} />
                  <span className="truncate">{s.title}</span>
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* New session input */}
        <div className="shrink-0 p-2 border-t border-border bg-card">
          <div className="flex gap-1">
            <input
              value={task}
              onChange={e => setTask(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") handleCreateSession(); }}
              placeholder="New task..."
              className="flex-1 bg-background border border-border rounded px-2 py-1 text-[10px] text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/60 transition-colors"
            />
            <button
              onClick={handleCreateSession}
              disabled={!task.trim() || isRunning}
              className="px-2 py-1 bg-primary/10 border border-primary/30 text-primary rounded text-[10px] hover:bg-primary/20 disabled:opacity-50 transition-all"
            >
              {isRunning ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
            </button>
          </div>
        </div>
      </div>

      {/* ── Right content area ─────────────────────────────────────────────── */}
      {!activeSessionId ? (
        <div className="flex-1 flex flex-col overflow-hidden min-w-0">
          {/* Mobile top bar for empty state */}
          <div className="md:hidden shrink-0 flex items-center gap-2 px-3 py-2 border-b border-border bg-card/80">
            <button onClick={() => setMobileSidebarOpen(true)} className="text-muted-foreground hover:text-primary transition-colors p-1 rounded hover:bg-primary/10">
              <Menu className="h-4 w-4" />
            </button>
            <span className="text-xs font-bold text-muted-foreground">AGENT TEAMS</span>
          </div>
          <div className="flex-1 flex flex-col items-center justify-center gap-6 p-8">
          <motion.div animate={{ scale: [1, 1.05, 1] }} transition={{ duration: 3, repeat: Infinity }}
            className="w-20 h-20 rounded-2xl border border-primary/30 bg-primary/10 flex items-center justify-center">
            <Cpu className="h-10 w-10 text-primary" />
          </motion.div>
          <div className="text-center">
            <p className="text-sm font-bold text-foreground mb-2">Agent Teams</p>
            <p className="text-xs text-muted-foreground mb-4">Create a new session or select an existing one to start the multi-agent pipeline</p>
          </div>
          <div className="flex flex-wrap gap-2 justify-center">
            {PIPELINE.map(agent => {
              const display = PIPELINE_DISPLAY[agent];
              const displayName = display?.displayName ?? agent;
              const subCount = display?.subAgents.length ?? 0;
              return (
                <div key={agent} className={`flex items-center gap-1.5 px-2 py-1 rounded border text-[10px] ${AGENT_BG[agent]} ${AGENT_COLORS[agent]}`}>
                  <span>{AGENT_ICONS[agent]}</span>
                  <span>{displayName}</span>
                  {subCount > 0 && <span className="text-[8px] opacity-60">({subCount})</span>}
                </div>
              );
            })}
          </div>
          </div>
        </div>
      ) : (
        <div className="flex-1 flex flex-col overflow-hidden min-w-0">
          {/* Session header */}
          <div className="shrink-0 border-b border-border bg-card/80 backdrop-blur-sm z-10">
            <div className="flex items-center justify-between px-2 md:px-4 py-2">
              <div className="flex items-center gap-2 md:gap-3 min-w-0">
                <button onClick={() => setMobileSidebarOpen(true)} className="md:hidden text-muted-foreground hover:text-primary transition-colors p-1 rounded hover:bg-primary/10 shrink-0">
                  <Menu className="h-4 w-4" />
                </button>
                <span className={`text-xs font-bold px-2 py-0.5 rounded-full border ${execPhaseColor} border-current/30 bg-current/5 shrink-0`}>
                  <span className={execPhaseColor}>{execPhaseLabel}</span>
                </span>
                <span className="text-xs text-muted-foreground truncate max-w-[120px] md:max-w-xs">{sessionInfo?.title}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-muted-foreground">{sessionInfo?.totalMessages ?? 0} msgs</span>
                {/* GitHub Sync button */}
                {activeSessionId && (() => {
                  const githubRepo = (liveSession as Record<string, unknown> | null)?.githubRepo as string | undefined;
                  const lastSyncAt = (liveSession as Record<string, unknown> | null)?.githubLastSyncAt as number | undefined;
                  const isConnected = !!githubRepo;
                  return (
                    <button
                      onClick={() => setShowGithubModal(true)}
                      title={isConnected ? `GitHub: ${githubRepo} — click to sync` : "Connect GitHub repository"}
                      className={`flex items-center gap-1 px-2 py-1 text-[10px] rounded border transition-all ${
                        isConnected
                          ? "bg-green-400/10 border-green-400/30 text-green-400 hover:bg-green-400/20"
                          : "bg-muted/50 border-border text-muted-foreground hover:border-primary/50 hover:text-primary"
                      }`}
                    >
                      {isSyncing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Github className="h-3 w-3" />}
                      {isConnected ? (lastSyncAt ? "SYNCED" : "SYNC") : "GITHUB"}
                    </button>
                  );
                })()}
                {/* Reset limit button — shown when session is completed or at limit */}
                {activeSessionId && sessionInfo?.status === "completed" && (
                  <button
                    onClick={handleResetLimit}
                    title="Reset message limit — allows session to continue past 600 messages"
                    className="flex items-center gap-1 px-2 py-1 bg-amber-400/10 border border-amber-400/30 text-amber-400 text-[10px] rounded hover:bg-amber-400/20 transition-all"
                  >
                    <RefreshCw className="h-3 w-3" />RESET
                  </button>
                )}
                {sessionInfo?.status === "running" ? (
                  <button onClick={handleStopAutoRun} className="flex items-center gap-1 px-2 py-1 bg-destructive/10 border border-destructive/30 text-destructive text-[10px] rounded hover:bg-destructive/20 transition-all">
                    <Square className="h-3 w-3" />RUNNING
                  </button>
                ) : (
                  <button onClick={handleAutoRun} disabled={isRunning} className="flex items-center gap-1 px-2 py-1 bg-primary/10 border border-primary/30 text-primary text-[10px] rounded hover:bg-primary/20 disabled:opacity-50 transition-all">
                    {isRunning ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
                    {isRunning ? "STARTING" : "RUN"}
                  </button>
                )}
              </div>
            </div>
            {/* Tabs */}
            <div className="flex border-t border-border">
              {(["chat", "files", "sandbox", "preview"] as const).map(tab => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={`px-4 py-2 text-[10px] font-bold transition-all border-b-2 ${
                    activeTab === tab ? "border-primary text-primary" : "border-transparent hover:text-foreground hover:border-current"
                  }`}
                >
                  {tab.toUpperCase()}
                  {tab === "files" && projectFiles.length > 0 && (
                    <span className="ml-1 text-[9px] bg-primary/20 text-primary px-1 rounded">{projectFiles.length}</span>
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* Tab content */}
          <div className="flex-1 overflow-hidden min-h-0">
            {/* CHAT TAB */}
            {activeTab === "chat" && (
              <div className="h-full flex flex-col overflow-hidden">
                <div className="flex-1 overflow-y-auto min-h-0 p-4">
                  <div className="space-y-4 max-w-3xl mx-auto">
                    {allMessages.map((msg) => (
                      <motion.div
                        key={msg._id}
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        className={`flex gap-3 ${msg.isUser ? "flex-row-reverse" : ""}`}
                      >
                        <div className={`w-8 h-8 rounded-xl flex items-center justify-center text-xs font-bold shrink-0 border ${AGENT_BG[msg.agent] || "bg-muted/20 border-border"}`}>
                          {AGENT_ICONS[msg.agent] || msg.agent[0]}
                        </div>
                        <div className={`flex-1 max-w-2xl flex flex-col gap-0.5 ${msg.isUser ? "items-end" : "items-start"}`}>
                          <span className={`text-[10px] font-bold ${AGENT_COLORS[msg.agent] || "text-muted-foreground"}`}>{msg.agent}</span>
                          {!msg.isUser && msg.modelUsed && (
                            <span className="text-[9px] text-muted-foreground/50 font-mono leading-none mb-1">{msg.modelUsed}</span>
                          )}
                          <div className={`rounded-xl px-4 py-3 text-xs leading-relaxed ${
                            msg.isUser ? "bg-primary/15 border border-primary/30 text-foreground" : "bg-card border border-border text-foreground"
                          }`}>
                            <MessageContent msg={msg} currentTaskIndex={sessionInfo?.currentTaskIndex} />
                          </div>
                          {!msg.isUser && msg.agentBucksDeducted !== undefined && msg.agentBucksDeducted > 0 && (
                            <span className="text-[9px] text-muted-foreground/40 font-mono mt-0.5">
                              -{msg.agentBucksDeducted.toLocaleString()} AB
                            </span>
                          )}
                        </div>
                      </motion.div>
                    ))}

                    {/* Streaming output */}
                    {streamingOutput && streamingAgent && (
                      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex gap-3">
                        <div className={`w-8 h-8 rounded-xl flex items-center justify-center text-xs font-bold shrink-0 border animate-pulse ${AGENT_BG[streamingAgent] || "bg-primary/10 border-primary/20"}`}>
                          {AGENT_ICONS[streamingAgent] || streamingAgent[0]}
                        </div>
                        <div className="flex-1 max-w-2xl flex flex-col gap-1">
                          <span className={`text-[10px] font-bold ${AGENT_COLORS[streamingAgent] || "text-primary"}`}>{streamingAgent} <span className="text-muted-foreground font-normal">is thinking...</span></span>
                          <div className="bg-card border border-border rounded-xl px-4 py-3 text-xs leading-relaxed text-foreground">
                            <ReactMarkdown>{streamingOutput.slice(0, 2000)}</ReactMarkdown>
                            <span className="animate-pulse text-primary">█</span>
                          </div>
                        </div>
                      </motion.div>
                    )}

                    {/* Queue indicator */}
                    {messageQueue.length > 0 && (
                      <div className="flex items-center gap-2 px-3 py-2 bg-amber-400/10 border border-amber-400/20 rounded-lg text-[10px] text-amber-400">
                        <ListPlus className="h-3 w-3" />
                        {messageQueue.length} message(s) queued
                      </div>
                    )}
                    <div ref={messagesEndRef} />
                  </div>
                </div>

                {/* Message input — always visible */}
                <div className="shrink-0 p-3 border-t border-border bg-card">
                  <div className="flex gap-2 max-w-3xl mx-auto">
                    <textarea
                      ref={undefined}
                      value={messageInput}
                      onChange={e => { setMessageInput(e.target.value); e.target.style.height = "auto"; e.target.style.height = Math.min(e.target.scrollHeight, 160) + "px"; }}
                      onKeyDown={handleMessageKeyDown}
                      placeholder={isRunning ? "Agents running... Enter to queue, Ctrl+Enter to force queue" : "Send a message or follow-up..."}
                      rows={1}
                      className="flex-1 bg-background border border-border rounded-xl px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground resize-none focus:outline-none focus:border-primary/60 transition-colors whitespace-pre-wrap"
                      style={{ minHeight: "36px", maxHeight: "160px" }}
                    />
                    {(isRunning || sessionInfo?.status === "running") ? (
                      <>
                        <button onClick={handleStopAutoRun} className="px-3 py-2 bg-destructive/10 border border-destructive/30 text-destructive text-xs rounded-xl hover:bg-destructive/20 transition-all flex items-center gap-1">
                          <Square className="h-3.5 w-3.5" />
                        </button>
                        <button onClick={handleQueueMessage} disabled={!messageInput.trim()} className="px-3 py-2 bg-amber-400/10 border border-amber-400/30 text-amber-400 text-xs rounded-xl hover:bg-amber-400/20 disabled:opacity-50 transition-all flex items-center gap-1">
                          <ListPlus className="h-3.5 w-3.5" />
                        </button>
                      </>
                    ) : (
                      <button onClick={handleSendMessage} disabled={!messageInput.trim()} className="px-3 py-2 bg-primary text-primary-foreground text-xs rounded-xl hover:bg-primary/90 disabled:opacity-50 transition-all flex items-center gap-1">
                        <Send className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* FILES TAB */}
            {activeTab === "files" && (
              <FilesTabInline
                projectFiles={projectFiles}
                selectedFile={selectedFile}
                setSelectedFile={setSelectedFile}
                activeSessionId={activeSessionId}
                token={token}
              />
            )}

            {/* SANDBOX TAB */}
            {activeTab === "sandbox" && (
              <div className="h-full flex flex-col overflow-hidden">
                <div className="shrink-0 px-4 py-2 border-b border-border bg-card/50 flex items-center justify-between flex-wrap gap-2">
                  <div className="flex items-center gap-2">
                    <Terminal className="h-3.5 w-3.5 text-amber-400" />
                    <span className="text-xs font-bold text-amber-400">SANDBOX</span>
                    {activeSandbox && (
                      <span className={`text-[10px] px-1.5 py-0.5 rounded border ${activeSandbox.status === "running" ? "text-green-400 border-green-400/30 bg-green-400/10" : "text-muted-foreground border-border"}`}>
                        {activeSandbox.status}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {!activeSandboxId ? (
                      <button onClick={handleCreateSandbox} disabled={isSandboxLoading} className="flex items-center gap-1 px-2 py-1 bg-amber-400/10 border border-amber-400/30 text-amber-400 text-[10px] rounded hover:bg-amber-400/20 disabled:opacity-50 transition-all">
                        {isSandboxLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
                        CREATE
                      </button>
                    ) : (
                      <>
                        <button onClick={handleGetPreviewUrl} disabled={isSandboxLoading} className="flex items-center gap-1 px-2 py-1 bg-green-400/10 border border-green-400/30 text-green-400 text-[10px] rounded hover:bg-green-400/20 disabled:opacity-50 transition-all">
                          <Globe className="h-3 w-3" />PREVIEW
                        </button>
                        {activeSessionId && (
                          <button onClick={handleSyncFiles} disabled={isSandboxLoading} className="flex items-center gap-1 px-2 py-1 bg-cyan-400/10 border border-cyan-400/30 text-cyan-400 text-[10px] rounded hover:bg-cyan-400/20 disabled:opacity-50 transition-all">
                            <RefreshCw className="h-3 w-3" />SYNC FILES
                          </button>
                        )}
                        {deployCommands.length > 0 && (
                          <button onClick={handleRunDeployCommands} disabled={isSandboxLoading || isDeploying} className="flex items-center gap-1 px-2 py-1 bg-violet-400/10 border border-violet-400/30 text-violet-400 text-[10px] rounded hover:bg-violet-400/20 disabled:opacity-50 transition-all">
                            {isDeploying ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
                            DEPLOY ({deployCommands.length})
                          </button>
                        )}
                        {activeSessionId && (
                          <button onClick={handleAutoDeployAndStart} disabled={isSandboxLoading || projectFiles.length === 0} className="flex items-center gap-1 px-2 py-1 bg-primary/10 border border-primary/30 text-primary text-[10px] rounded hover:bg-primary/20 disabled:opacity-50 transition-all">
                            <Play className="h-3 w-3" />DEPLOY ALL
                          </button>
                        )}
                        <button onClick={() => handleStopSandbox(activeSandboxId)} disabled={isSandboxLoading} className="flex items-center gap-1 px-2 py-1 bg-destructive/10 border border-destructive/30 text-destructive text-[10px] rounded hover:bg-destructive/20 disabled:opacity-50 transition-all">
                          <Square className="h-3 w-3" />STOP
                        </button>
                      </>
                    )}
                  </div>
                </div>
                {activeSandboxId ? (
                  <>
                    <div className="flex-1 overflow-y-auto min-h-0 p-3 font-mono">
                      {sandboxOutput.length === 0 ? (
                        <p className="text-[10px] text-muted-foreground">No commands run yet</p>
                      ) : (
                        sandboxOutput.map((entry, i) => (
                          <div key={i} className="mb-3">
                            <div className="text-[10px] text-primary">$ {entry.cmd}</div>
                            <pre className={`text-[10px] whitespace-pre-wrap break-words ${entry.code === 0 ? "text-foreground" : "text-destructive"}`}>
                              {entry.out.slice(0, 3000)}
                            </pre>
                            <div className={`text-[9px] ${entry.code === 0 ? "text-green-400" : "text-destructive"}`}>[exit: {entry.code}]</div>
                          </div>
                        ))
                      )}
                      <div ref={sandboxOutputEndRef} />
                    </div>
                    <div className="shrink-0 p-3 border-t border-border bg-card flex gap-2">
                      <input
                        value={sandboxCommand}
                        onChange={e => setSandboxCommand(e.target.value)}
                        onKeyDown={e => { if (e.key === "Enter") handleExecuteCommand(); }}
                        placeholder="$ run command..."
                        className="flex-1 bg-background border border-border rounded-lg px-3 py-1.5 text-[10px] font-mono text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/60 transition-colors"
                      />
                      <button onClick={handleExecuteCommand} disabled={!sandboxCommand.trim() || isSandboxLoading} className="px-3 py-1.5 bg-primary/10 border border-primary/30 text-primary text-[10px] rounded-lg hover:bg-primary/20 disabled:opacity-50 transition-all">
                        {isSandboxLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
                      </button>
                    </div>
                  </>
                ) : (
                  <div className="flex-1 flex flex-col items-center justify-center gap-4 p-8">
                    <Box className="h-12 w-12 text-amber-400/20" />
                    <div className="text-center">
                      <p className="text-sm font-bold text-foreground mb-1">No Active Sandbox</p>
                      <p className="text-xs text-muted-foreground">Create a sandbox to execute commands</p>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* PREVIEW TAB */}
            {activeTab === "preview" && (
              <PreviewTab
                previewUrl={previewUrl}
                activeSandboxId={activeSandboxId}
                activeSandbox={activeSandbox}
                activeSessionId={activeSessionId}
                projectFiles={projectFiles}
                isSandboxLoading={isSandboxLoading}
                token={token}
                onGetPreviewUrl={handleGetPreviewUrl}
                onAutoDeployAndStart={handleAutoDeployAndStart}
                setCustomDomainAction={setCustomDomainAction}
                onSandboxUpdate={(updated: SandboxRow) => setActiveSandbox(updated)}
              />
            )}
          </div>
        </div>
      )}
      {/* GitHub Sync Modal */}
      <AnimatePresence>
        {showGithubModal && activeSessionId && (
          <GithubSyncModal
            onClose={() => setShowGithubModal(false)}
            onSave={handleSaveGithubConfig}
            onSync={handleGithubSync}
            isSyncing={isSyncing}
            currentRepo={(liveSession as Record<string, unknown> | null)?.githubRepo as string | undefined}
            currentBranch={(liveSession as Record<string, unknown> | null)?.githubBranch as string | undefined}
            lastSyncAt={(liveSession as Record<string, unknown> | null)?.githubLastSyncAt as number | undefined}
          />
        )}
      </AnimatePresence>
    </div>
  );
}