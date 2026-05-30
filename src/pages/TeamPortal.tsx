import { useAuth } from "@/hooks/use-auth";
import { useEffect, useState, useRef, useCallback } from "react";
import { useNavigate } from "react-router";
import { motion, AnimatePresence } from "framer-motion";
import { api } from "@/convex/_generated/api";
import { useAction, useQuery, useMutation } from "convex/react";
import { FileTreeView, FileTreeFile } from "@/components/FileTree";
import ThinkingPanel from "@/components/ThinkingPanel";
import { Id } from "@/convex/_generated/dataModel";
import { toast } from "sonner";
import { vmLauncher } from "@/lib/vmLauncher";
import {
  Loader2, LogOut, Plus, Users, ArrowLeft, RefreshCw, CheckCircle,
  Terminal, Box, Globe, ExternalLink, Play, Square, Send, FileCode,
  Monitor, Sun, Moon, ChevronRight, ChevronDown, Zap, Activity, Clock, Layers,
  MessageSquare, StopCircle, ListPlus, Sparkles, Cpu, Shield, Search,
  Code2, CheckSquare, AlertCircle, Menu, X, Coins, Folder, FolderOpen, Upload, Download,
  Lightbulb, Paperclip, GitBranch, Trash2, Edit3,
} from "lucide-react";
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
}

interface QueuedMessage {
  id: string;
  text: string;
  timestamp: number;
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
  // Try JSON code block first
  const jsonBlockMatch = content.match(/```json\s*([\s\S]*?)\s*```/);
  if (jsonBlockMatch) {
    try {
      const data = JSON.parse(jsonBlockMatch[1]);
      if (data && Array.isArray(data.tasks) && data.tasks.length > 0) {
        return { summary: data.summary || "", tasks: data.tasks };
      }
    } catch { /* ignore */ }
  }
  // Try raw JSON object in content
  const jsonStart = content.indexOf('{');
  if (jsonStart !== -1) {
    for (let end = content.length; end > jsonStart; end = content.lastIndexOf('}', end - 1)) {
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
      {/* Summary */}
      {data.summary && (
        <div className="bg-violet-400/10 border border-violet-400/30 rounded-xl px-4 py-3">
          <p className="text-[10px] font-bold text-violet-400 mb-1 tracking-widest">PROJECT PLAN</p>
          <p className="text-xs text-foreground leading-relaxed">{data.summary}</p>
        </div>
      )}
      {/* Task count */}
      <div className="flex items-center justify-between px-1">
        <p className="text-[10px] font-bold text-muted-foreground tracking-widest">{data.tasks.length} TASKS PLANNED</p>
        {completedCount > 0 && (
          <p className="text-[10px] text-violet-400">{completedCount}/{data.tasks.length} complete</p>
        )}
      </div>
      {/* Tasks */}
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
                isDone
                  ? "border-border/30 bg-muted/10 opacity-50"
                  : isActive
                  ? "border-violet-400/40 bg-violet-400/8"
                  : "border-border/40 bg-card/50"
              }`}
            >
              {/* Number / check */}
              <div className={`w-6 h-6 rounded-lg flex items-center justify-center text-[10px] font-bold shrink-0 mt-0.5 ${
                isDone ? "bg-emerald-400/20 text-emerald-400" : isActive ? "bg-violet-400/20 text-violet-400" : "bg-muted/30 text-muted-foreground"
              }`}>
                {isDone ? "✓" : i + 1}
              </div>
              {/* Content */}
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

// ── Agent config ───────────────────────────────────────────────────────────────
const AGENT_COLORS: Record<string, string> = {
  "R&D Team": "text-cyan-400", Researcher: "text-cyan-400",
  Analyser: "text-blue-400",
  Planner: "text-violet-400",
  Coder: "text-emerald-400",
  Optimiser: "text-amber-400",
  Organizer: "text-orange-400",
  Tester: "text-green-400",
  "Red Team": "text-red-400",
  Critic: "text-purple-400",
  User: "text-primary",
};

const AGENT_BG: Record<string, string> = {
  "R&D Team": "bg-cyan-400/10 border-cyan-400/30", Researcher: "bg-cyan-400/10 border-cyan-400/30",
  Analyser: "bg-blue-400/10 border-blue-400/30",
  Planner: "bg-violet-400/10 border-violet-400/30",
  Coder: "bg-emerald-400/10 border-emerald-400/30",
  Optimiser: "bg-amber-400/10 border-amber-400/30",
  Organizer: "bg-orange-400/10 border-orange-400/30",
  Tester: "bg-green-400/10 border-green-400/30",
  "Red Team": "bg-red-400/10 border-red-400/30",
  Critic: "bg-purple-400/10 border-purple-400/30",
  User: "bg-primary/10 border-primary/30",
};

const AGENT_ICONS: Record<string, string> = {
  "R&D Team": "🔬", Researcher: "🔬", Analyser: "A", Planner: "P", Coder: "C",
  Optimiser: "O", Organizer: "📝", Tester: "T", "Red Team": "🔴", Critic: "R", User: "U",
};

const AGENT_EMOJI: Record<string, string> = {
  "R&D Team": "🔬", Researcher: "🔬", Analyser: "🧠", Planner: "📋", Coder: "💻",
  Optimiser: "⚡", Organizer: "📝", Tester: "🧪", "Red Team": "🔴", Critic: "🎯", User: "👤",
};

const PIPELINE = ["Researcher", "Analyser", "Planner", "Coder", "Optimiser", "Organizer", "Tester", "Red Team", "Critic"];

// Display names and sub-agents for teams
const PIPELINE_DISPLAY: Record<string, { displayName: string; subAgents: Array<{ name: string; abbr: string; color: string }> }> = {
  Researcher: {
    displayName: "R&D Team",
    subAgents: [
      { name: "ResearchPlanner", abbr: "RP", color: "text-cyan-300" },
      { name: "DataTaker", abbr: "DT", color: "text-cyan-300" },
      { name: "ResearchOrganiser", abbr: "RO", color: "text-cyan-300" },
    ],
  },
  "Red Team": {
    displayName: "Red Team",
    subAgents: [
      { name: "VulnerabilitySpotter", abbr: "VS", color: "text-red-300" },
      { name: "DataCorruptor", abbr: "DC", color: "text-red-300" },
      { name: "ZeroDayExploiter", abbr: "ZD", color: "text-red-300" },
      { name: "FrameworkAuditor", abbr: "FA", color: "text-red-300" },
      { name: "RedTeamOrchestrator", abbr: "RTO", color: "text-red-300" },
    ],
  },
};

const MAX_MESSAGES = 600;

// ── Sound effects ──────────────────────────────────────────────────────────────
function playSound(type: "send" | "receive" | "complete" | "error" | "queue") {
  try {
    const ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    
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
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + c.duration);
  } catch { /* ignore audio errors */ }
}

// ── Particle VFX ──────────────────────────────────────────────────────────────
function ParticleEffect({ active }: { active: boolean }) {
  if (!active) return null;
  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden">
      {Array.from({ length: 8 }).map((_, i) => (
        <motion.div
          key={i}
          className="absolute w-1 h-1 rounded-full bg-primary/60"
          initial={{ x: "50%", y: "50%", opacity: 0, scale: 0 }}
          animate={{
            x: `${30 + Math.random() * 40}%`,
            y: `${20 + Math.random() * 60}%`,
            opacity: [0, 0.8, 0],
            scale: [0, 1.5, 0],
          }}
          transition={{ duration: 1.5 + Math.random(), delay: i * 0.1, repeat: Infinity, repeatDelay: 2 }}
        />
      ))}
    </div>
  );
}

// ── Typing indicator ──────────────────────────────────────────────────────────
function TypingDots() {
  return (
    <div className="flex items-center gap-1 px-3 py-2">
      {[0, 1, 2].map(i => (
        <motion.div
          key={i}
          className="w-1.5 h-1.5 rounded-full bg-primary"
          animate={{ y: [0, -4, 0], opacity: [0.4, 1, 0.4] }}
          transition={{ duration: 0.8, delay: i * 0.15, repeat: Infinity }}
        />
      ))}
    </div>
  );
}

// ── Glow pulse ────────────────────────────────────────────────────────────────
function GlowPulse({ color = "primary" }: { color?: string }) {
  return (
    <motion.div
      className={`absolute inset-0 rounded-xl bg-${color}/5 pointer-events-none`}
      animate={{ opacity: [0, 0.5, 0] }}
      transition={{ duration: 2, repeat: Infinity }}
    />
  );
}

// ── Main Component ─────────────────────────────────────────────────────────────
export default function TeamPortal() {
  const { isLoading, isAuthenticated, user, signOut, token } = useAuth();
  const navigate = useNavigate();
  const [sessions, setSessions] = useState<TeamSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<Id<"teamSessions"> | null>(null);
  const [task, setTask] = useState("");
  const [isRunning, setIsRunning] = useState(false);
  const [currentAgent, setCurrentAgent] = useState<string | null>(null);
  const [autoRun, setAutoRun] = useState(false);
  const [activeTab, setActiveTab] = useState<"chat" | "files" | "sandbox" | "preview">("chat");
  const [selectedFile, setSelectedFile] = useState<ProjectFile | null>(null);
  const [isDark, setIsDark] = useState(true);
  const [messageInput, setMessageInput] = useState("");
  const [messageQueue, setMessageQueue] = useState<QueuedMessage[]>([]);
  const [userMessages, setUserMessages] = useState<AgentMessage[]>([]);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [showProjectCreationModal, setShowProjectCreationModal] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const autoRunRef = useRef(false);
  const messageInputRef = useRef<HTMLTextAreaElement>(null);

  // Context menu state
  const [contextMenu, setContextMenu] = useState<{ sessionId: Id<"teamSessions">; x: number; y: number; isBranch: boolean } | null>(null);
  const [renameModalOpen, setRenameModalOpen] = useState(false);
  const [renameTarget, setRenameTarget] = useState<{ sessionId: Id<"teamSessions">; currentTitle: string; isBranch: boolean } | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [createBranchModalOpen, setCreateBranchModalOpen] = useState(false);
  const [branchPurpose, setBranchPurpose] = useState("");
  const [branchSourceSessionId, setBranchSourceSessionId] = useState<Id<"teamSessions"> | null>(null);
  const [isCreatingBranch, setIsCreatingBranch] = useState(false);
  const [isDeletingSession, setIsDeletingSession] = useState(false);

  // Suggestion modal state
  const [showSuggestion, setShowSuggestion] = useState(false);
  const [suggestionTitle, setSuggestionTitle] = useState("");
  const [suggestionDesc, setSuggestionDesc] = useState("");
  const [suggestionFiles, setSuggestionFiles] = useState<Array<{ name: string; content: string; size: number }>>([]);
  const [isSuggestionLoading, setIsSuggestionLoading] = useState(false);

  // Sandbox state
  const [sandboxes, setSandboxes] = useState<SandboxRow[]>([]);
  const [activeSandboxId, setActiveSandboxId] = useState<Id<"sandboxes"> | null>(null);
  const [activeSandbox, setActiveSandbox] = useState<SandboxRow | null>(null);
  const [sandboxCommand, setSandboxCommand] = useState("");
  const [sandboxOutput, setSandboxOutput] = useState<Array<{ cmd: string; out: string; code: number }>>([]);
  const [isSandboxLoading, setIsSandboxLoading] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const sandboxOutputEndRef = useRef<HTMLDivElement>(null);

  // Bridge status: checks if local QEMU bridge is running
  const [bridgeStatus, setBridgeStatus] = useState<"checking" | "online" | "offline">("checking");
  const [isBootingOs, setIsBootingOs] = useState(false);

  // Theme
  useEffect(() => {
    document.documentElement.classList.toggle("light", !isDark);
  }, [isDark]);

  const bridgeDownloadUrl = vmLauncher.getDownloadUrl();

  // Bridge health check - asks the local executable for a functional ping every 5s.
  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      const status = await vmLauncher.checkStatus();
      if (!cancelled) setBridgeStatus(status.functional ? "online" : "offline");
    };
    check();
    const interval = setInterval(check, 5000);
    return () => { cancelled = true; clearInterval(interval); };
  }, []);

  const handleBootOs = async () => {
    if (bridgeStatus !== "online") return;
    setIsBootingOs(true);
    try {
      const result = await vmLauncher.bootVM("windows-11", 6144, 4);
      if (result.success) {
        toast.success("OS is booting. Check the VM window on your desktop.");
      } else {
        toast.error(result.error || "The local executable responded but boot failed.");
      }
    } catch {
      toast.error("Could not reach the local VM executable.");
    } finally {
      setIsBootingOs(false);
    }
  };

  // Mutations
  const renameSessionMutation = useMutation(api.agentTeamHelpers.renameSessionPublic);
  const deleteSessionMutation = useMutation(api.agentTeamHelpers.deleteSessionPublic);
  const createBranchSessionMutation = useMutation(api.agentTeamHelpers.createBranchSessionPublic);
  const renameBranchMutation = useMutation(api.agentTeamHelpers.renameBranchPublic);

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

  const agentMessages: AgentMessage[] = (liveMessages ?? []).map((m: any) => ({
    _id: m._id as string, agent: m.agent, content: m.content, round: m.round, messageIndex: m.messageIndex,
    modelUsed: (m as Record<string, unknown>).modelUsed as string | undefined,
    agentBucksDeducted: (m as Record<string, unknown>).agentBucksDeducted as number | undefined,
  }));

  // Merge agent messages with user messages, sorted by messageIndex
  const allMessages: AgentMessage[] = [...agentMessages, ...userMessages].sort((a, b) => {
    const ai = a.messageIndex ?? 0;
    const bi = b.messageIndex ?? 0;
    return ai - bi;
  });

  const projectFiles: ProjectFile[] = (liveFiles ?? []).map((f: any) => ({
    filepath: f.filepath, content: f.content, lastModifiedBy: f.lastModifiedBy,
  }));

  // Update document title based on active session
  useEffect(() => {
    if (sessionInfo?.title) {
      document.title = `${sessionInfo.title} | Thalamus AI`;
    } else {
      document.title = "Thalamus AI";
    }
    return () => { document.title = "Thalamus AI"; };
  }, [sessionInfo?.title]);

  // Actions
  const deleteFileMutation = useMutation(api.agentTeamHelpers.deleteFilePublic);
  const renameFileMutation = useMutation(api.agentTeamHelpers.renameFilePublic);
  const createFileMutation = useMutation(api.agentTeamHelpers.createFilePublic);
  const duplicateFileMutation = useMutation(api.agentTeamHelpers.duplicateFilePublic);

  const handleSuggestionFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    const newFiles: Array<{ name: string; content: string; size: number }> = [];
    for (const file of files) {
      try {
        const content = await file.text();
        newFiles.push({ name: file.name, content, size: file.size });
      } catch { /* ignore */ }
    }
    setSuggestionFiles(prev => [...prev, ...newFiles]);
    e.target.value = "";
  };

  const handleSuggestionRemoveFile = (idx: number) => {
    setSuggestionFiles(prev => prev.filter((_, i) => i !== idx));
  };

  const handleSuggestionSubmit = async () => {
    if (!suggestionTitle.trim()) { toast.error("Please enter a title"); return; }
    setIsSuggestionLoading(true);
    try {
      let content = `**Suggestion: ${suggestionTitle.trim()}**\n\n${suggestionDesc.trim()}`;
      if (suggestionFiles.length > 0) {
        content += `\n\n**Attached Files (${suggestionFiles.length}):**\n`;
        for (const f of suggestionFiles) {
          content += `\n--- ${f.name} ---\n\`\`\`\n${f.content.slice(0, 5000)}${f.content.length > 5000 ? "\n...(truncated)" : ""}\n\`\`\`\n`;
        }
      }
      if (activeSessionId && token) {
        await continueSessionAction({ sessionId: activeSessionId, newTask: content, token });
        toast.success("Suggestion submitted to active session!");
      } else {
        const { sessionId } = await createSession({ task: content, token: token ?? "" });
        setActiveSessionId(sessionId);
        await startBackgroundSession({ sessionId, token: token ?? "" });
        toast.success("Suggestion submitted! Starting agents...");
        await loadSessions();
      }
      setShowSuggestion(false);
      setSuggestionTitle("");
      setSuggestionDesc("");
      setSuggestionFiles([]);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to submit suggestion");
    } finally {
      setIsSuggestionLoading(false);
    }
  };

  const handleFileDelete = async (node: import("@/components/FileTree").FileTreeNode) => {
    if (!activeSessionId || !token) return;
    if (!confirm(`Delete "${node.name}"?`)) return;
    try {
      await deleteFileMutation({ sessionId: activeSessionId, filepath: node.path, token });
      if (selectedFile?.filepath === node.path || selectedFile?.filepath.startsWith(node.path + "/")) setSelectedFile(null);
      toast.success(`Deleted "${node.name}"`);
    } catch (err) { toast.error(err instanceof Error ? err.message : "Delete failed"); }
  };

  const handleFileRename = async (node: import("@/components/FileTree").FileTreeNode, newName: string) => {
    if (!activeSessionId || !token || !newName.trim()) return;
    const dir = node.path.includes("/") ? node.path.substring(0, node.path.lastIndexOf("/")) : "";
    const newPath = dir ? `${dir}/${newName.trim()}` : newName.trim();
    try {
      await renameFileMutation({ sessionId: activeSessionId, oldPath: node.path, newPath, token });
      if (selectedFile?.filepath === node.path) setSelectedFile({ ...selectedFile, filepath: newPath });
      toast.success(`Renamed to "${newName}"`);
    } catch (err) { toast.error(err instanceof Error ? err.message : "Rename failed"); }
  };

  const handleFileDuplicate = async (node: import("@/components/FileTree").FileTreeNode) => {
    if (!activeSessionId || !token) return;
    const dir = node.path.includes("/") ? node.path.substring(0, node.path.lastIndexOf("/")) : "";
    const ext = node.name.includes(".") ? node.name.substring(node.name.lastIndexOf(".")) : "";
    const base = node.name.includes(".") ? node.name.substring(0, node.name.lastIndexOf(".")) : node.name;
    const newPath = dir ? `${dir}/${base}_copy${ext}` : `${base}_copy${ext}`;
    try {
      await duplicateFileMutation({ sessionId: activeSessionId, sourcePath: node.path, destPath: newPath, token });
      toast.success(`Duplicated as "${base}_copy${ext}"`);
    } catch (err) { toast.error(err instanceof Error ? err.message : "Duplicate failed"); }
  };

  const handleFileDownload = (node: import("@/components/FileTree").FileTreeNode) => {
    if (node.type === "file") {
      const f = projectFiles.find(pf => pf.filepath === node.path);
      if (f) {
        const a = document.createElement("a");
        a.href = `data:text/plain;charset=utf-8,${encodeURIComponent(f.content)}`;
        a.download = node.name;
        a.click();
      }
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

  const handleFileMove = async (sourcePath: string, destFolderPath: string) => {
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

  const handleUploadFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
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

  const createSession = useMutation(api.agentTeamHelpers.createSessionPublic);
  const runAgentRound = useMutation(api.agentTeamHelpers.runAgentRoundPublic);
  const listSessionsAction = useMutation(api.agentTeamHelpers.listSessionsPublic);
  const continueSessionAction = useMutation(api.agentTeamHelpers.continueSessionPublic);
  const startBackgroundSession = useMutation(api.agentTeamHelpers.startBackgroundSessionPublic);
  const stopSessionMutation = useMutation(api.agentTeamHelpers.stopSessionPublic);
  const createSandboxAction = useAction(api.sandbox.createSandbox);
  const executeCommandAction = useAction(api.sandbox.executeCommand);
  const stopSandboxAction = useAction(api.sandbox.stopSandbox);
  const listSandboxesAction = useAction(api.sandbox.listSandboxes);
  const getPreviewUrlAction = useAction(api.sandbox.getPreviewUrl);
  const autoDeployAndStartAction = useAction(api.sandbox.autoDeployAndStart);
  const testFileWriteAction = useAction(api.sandbox.testFileWrite);

  // Context menu handlers
  const handleContextMenu = (e: React.MouseEvent, session: TeamSession) => {
    e.preventDefault();
    e.stopPropagation();
    const raw = session as unknown as Record<string, unknown>;
    const isBranch = !!(raw.branchGroupId && (raw.branchNumber as number) > 1);
    setContextMenu({ sessionId: session._id, x: e.clientX, y: e.clientY, isBranch });
  };

  const handleRenameSession = (sessionId: Id<"teamSessions">, currentTitle: string, isBranch: boolean) => {
    setRenameTarget({ sessionId, currentTitle, isBranch });
    setRenameValue(currentTitle);
    setRenameModalOpen(true);
    setContextMenu(null);
  };

  const handleRenameSubmit = async () => {
    if (!renameTarget || !renameValue.trim() || !token) return;
    try {
      if (renameTarget.isBranch) {
        await renameBranchMutation({ token, sessionId: renameTarget.sessionId, newBranchName: renameValue.trim() });
      } else {
        await renameSessionMutation({ token, sessionId: renameTarget.sessionId, newTitle: renameValue.trim() });
      }
      toast.success("Renamed successfully");
      setRenameModalOpen(false);
      setRenameTarget(null);
      await loadSessions();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Rename failed");
    }
  };

  const handleDeleteSession = async (sessionId: Id<"teamSessions">) => {
    if (!token) return;
    setIsDeletingSession(true);
    try {
      await deleteSessionMutation({ token, sessionId });
      if (activeSessionId === sessionId) setActiveSessionId(null);
      toast.success("Session deleted");
      await loadSessions();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setIsDeletingSession(false);
      setContextMenu(null);
    }
  };

  const handleCreateBranch = (sessionId: Id<"teamSessions">) => {
    setBranchSourceSessionId(sessionId);
    setBranchPurpose("");
    setCreateBranchModalOpen(true);
    setContextMenu(null);
  };

  const handleCreateBranchSubmit = async () => {
    if (!branchSourceSessionId || !branchPurpose.trim() || !token) return;
    setIsCreatingBranch(true);
    try {
      const result = await createBranchSessionMutation({ token, parentSessionId: branchSourceSessionId, branchPurpose: branchPurpose.trim() });
      const { sessionId } = result as { sessionId: Id<"teamSessions">; customId: string };
      toast.success("Branch created! Starting agents...");
      setCreateBranchModalOpen(false);
      setBranchPurpose("");
      setBranchSourceSessionId(null);
      await loadSessions();
      setActiveSessionId(sessionId);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create branch");
    } finally {
      setIsCreatingBranch(false);
    }
  };

  useEffect(() => { if (!isLoading && !isAuthenticated) navigate("/auth"); }, [isLoading, isAuthenticated, navigate]);
  useEffect(() => { if (token) { loadSessions(); loadSandboxes(); } }, [token]);
  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [allMessages, sessionInfo?.currentAgentOutput]);
  useEffect(() => { sandboxOutputEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [sandboxOutput]);

  // Play sound when new agent message arrives
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
    setAutoRun(false);
    autoRunRef.current = false;
    setUserMessages([]);
    setMessageQueue([]);
  };

  const handleCreateSession = async () => {
    if (!task.trim() || !token) return;
    setIsRunning(true);
    try {
      const { sessionId } = await createSession({ task: task.trim(), token });
      setActiveSessionId(sessionId);
      setTask("");
      setUserMessages([]);
      setMessageQueue([]);
      await loadSessions();
      toast.success("Session created! Press ▶ Run to start agents.");
      playSound("send");
    } catch { toast.error("Failed to create session"); playSound("error"); }
    finally { setIsRunning(false); }
  };

  const agentRetryCountRef = useRef(0);
  const MAX_AGENT_RETRIES = 5;

  const handleRunNextAgent = useCallback(async (sessionIdOverride?: Id<"teamSessions">) => {
    const sid = sessionIdOverride || activeSessionId;
    if (!sid || !token || isRunning) return;
    setIsRunning(true);
    try {
      const result = await runAgentRound({ sessionId: sid, token });
      agentRetryCountRef.current = 0;
      setCurrentAgent(result.agent);
      await loadSessions();
      if (result.fileOpsCount > 0) {
        toast.success(`${result.agent}: ${result.fileOpsCount} file(s) modified`);
        if (activeSandboxId && activeSandbox?.sessionId === sid) {
          try {
            const deployResult = await autoDeployAndStartAction({ token, sandboxDbId: activeSandboxId, sessionId: sid });
            if (deployResult.previewUrl) { setPreviewUrl(deployResult.previewUrl); toast.success(`Deployed → Preview ready`); }
          } catch { /* best-effort */ }
        }
      }
      if (result.done) {
        toast.success("🎉 Project complete!");
        playSound("complete");
        autoRunRef.current = false;
        setAutoRun(false);
        // Process queue after completion
        if (messageQueue.length > 0) {
          const next = messageQueue[0];
          setMessageQueue(prev => prev.slice(1));
          setTimeout(() => handleQueuedMessage(next.text, sid), 500);
        }
      }
      return result;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Agent failed";
      agentRetryCountRef.current += 1;
      if (agentRetryCountRef.current <= MAX_AGENT_RETRIES && autoRunRef.current) {
        const retryDelay = Math.min(3000 * agentRetryCountRef.current, 15000);
        toast.warning(`Retrying (${agentRetryCountRef.current}/${MAX_AGENT_RETRIES})...`);
        setIsRunning(false); setCurrentAgent(null);
        setTimeout(() => { if (autoRunRef.current) handleRunNextAgent(sid); }, retryDelay);
        return;
      }
      toast.error(`Agent failed: ${msg.slice(0, 80)}`);
      playSound("error");
      agentRetryCountRef.current = 0; autoRunRef.current = false; setAutoRun(false);
    } finally { setIsRunning(false); setCurrentAgent(null); }
  }, [activeSessionId, token, isRunning, runAgentRound, loadSessions, activeSandboxId, activeSandbox, autoDeployAndStartAction, messageQueue]);

  const handleQueuedMessage = async (text: string, sid: Id<"teamSessions">) => {
    if (!token) return;
    try {
      await continueSessionAction({ sessionId: sid, newTask: text, token });
      await loadSessions();
      autoRunRef.current = true;
      setAutoRun(true);
      handleRunNextAgent(sid);
    } catch { toast.error("Failed to process queued message"); }
  };

  useEffect(() => {
    if (!autoRun || isRunning || !activeSessionId) return;
    if (sessionInfo && (sessionInfo.status === "completed" || sessionInfo.totalMessages >= MAX_MESSAGES)) {
      setAutoRun(false); autoRunRef.current = false;
      // Process queue
      if (messageQueue.length > 0) {
        const next = messageQueue[0];
        setMessageQueue(prev => prev.slice(1));
        setTimeout(() => handleQueuedMessage(next.text, activeSessionId), 500);
      }
      return;
    }
    const timer = setTimeout(() => { if (autoRunRef.current) handleRunNextAgent(); }, 800);
    return () => clearTimeout(timer);
  }, [autoRun, isRunning, sessionInfo, activeSessionId, handleRunNextAgent]);

  const handleAutoRun = () => { if (!activeSessionId || !token) return; autoRunRef.current = true; setAutoRun(true); handleRunNextAgent(); };
  const handleStopAutoRun = () => { autoRunRef.current = false; setAutoRun(false); toast.info("Stopped after current agent completes"); };

  const handleForceRestart = async () => {
    if (!activeSessionId || !token) return;
    try {
      await stopSessionMutation({ token, sessionId: activeSessionId });
      autoRunRef.current = false;
      setAutoRun(false);
      setIsRunning(false);
      setCurrentAgent(null);
      toast.success("Session reset — click RUN to restart");
    } catch (err) {
      toast.error("Failed to reset session");
    }
  };

  // Message input handlers
  const handleSendMessage = async () => {
    const text = messageInput.trim();
    if (!text) return;
    setMessageInput("");
    playSound("send");

    if (!activeSessionId) {
      // Create new session
      setTask(text);
      return;
    }

    // Add as user message in chat
    const userMsg: AgentMessage = {
      _id: `user-${Date.now()}`,
      agent: "User",
      content: text,
      isUser: true,
      messageIndex: (sessionInfo?.totalMessages ?? 0) + 0.5,
    };
    setUserMessages(prev => [...prev, userMsg]);

    if (isRunning || autoRun) {
      // Queue the message
      const queued: QueuedMessage = { id: `q-${Date.now()}`, text, timestamp: Date.now() };
      setMessageQueue(prev => [...prev, queued]);
      toast.info(`Message queued (${messageQueue.length + 1} in queue)`);
      playSound("queue");
    } else {
      // Send immediately
      try {
        await continueSessionAction({ sessionId: activeSessionId, newTask: text, token: token! });
        await loadSessions();
        autoRunRef.current = true;
        setAutoRun(true);
        handleRunNextAgent();
      } catch { toast.error("Failed to send message"); }
    }
  };

  const handleQueueMessage = () => {
    const text = messageInput.trim();
    if (!text || !activeSessionId) return;
    setMessageInput("");
    playSound("queue");

    const userMsg: AgentMessage = {
      _id: `user-${Date.now()}`,
      agent: "User",
      content: text,
      isUser: true,
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
      if (e.ctrlKey || e.metaKey) {
        handleQueueMessage();
      } else {
        handleSendMessage();
      }
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
    } catch (err: unknown) { toast.error(err instanceof Error ? err.message : "Deploy failed"); }
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

  const handleRunSandboxCommand = async () => {
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

  // Derived state
  const currentPhase = sessionInfo?.phase ?? "Researcher";
  const totalMessages = sessionInfo?.totalMessages ?? 0;
  const loopCount = sessionInfo?.loopCount ?? 0;
  const streamingAgent = sessionInfo?.currentAgent ?? currentAgent;
  const streamingOutput = sessionInfo?.currentAgentOutput ?? "";
  const agentThinkingContent = streamingAgent
    ? [
        `${streamingAgent} is active`,
        sessionInfo?.executionPhase ? `Phase: ${sessionInfo.executionPhase}` : currentPhase ? `Phase: ${currentPhase}` : "",
        streamingOutput && streamingOutput !== `[${streamingAgent} is thinking...]`
          ? "Output stream started below"
          : "Reading project context and preparing the next response",
      ].filter(Boolean).join("\n")
    : "";
  const execPhase = sessionInfo?.executionPhase ?? "planning";
  const taskIndex = sessionInfo?.currentTaskIndex ?? 0;
  let plannerTasks: Array<{ id: string; title: string; description: string; subpart: boolean }> = [];
  try { if (sessionInfo?.plannerTasksJson) plannerTasks = JSON.parse(sessionInfo.plannerTasksJson); } catch { /* ignore */ }

  const execPhaseLabel = execPhase === "planning" ? "PLANNING" : execPhase === "final_review" ? "FINAL REVIEW" : `TASK ${taskIndex + 1}/${plannerTasks.length || "?"}`;
  const execPhaseColor = execPhase === "planning" ? "text-violet-400" : execPhase === "final_review" ? "text-amber-400" : "text-emerald-400";

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <motion.div
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          className="flex flex-col items-center gap-4"
        >
          <div className="relative">
            <motion.div
              className="w-16 h-16 rounded-2xl bg-primary/20 border border-primary/40 flex items-center justify-center"
              animate={{ boxShadow: ["0 0 0px rgba(var(--primary),0)", "0 0 30px rgba(var(--primary),0.3)", "0 0 0px rgba(var(--primary),0)"] }}
              transition={{ duration: 2, repeat: Infinity }}
            >
              <Cpu className="h-8 w-8 text-primary" />
            </motion.div>
          </div>
          <p className="text-primary font-mono text-sm animate-pulse terminal-glow">INITIALIZING THALAMUS_TEAM...</p>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col bg-background font-mono overflow-hidden">
      {/* ── Global Header ─────────────────────────────────────────────────────── */}
      <header className="shrink-0 border-b border-border bg-card/90 backdrop-blur-md z-20 relative">
        {/* Animated top border */}
        <motion.div
          className="absolute top-0 left-0 h-0.5 bg-gradient-to-r from-transparent via-primary to-transparent"
          animate={{ x: ["-100%", "100%"] }}
          transition={{ duration: 3, repeat: Infinity, ease: "linear" }}
          style={{ width: "50%" }}
        />
        <div className="flex items-center justify-between px-3 h-12">
          <div className="flex items-center gap-2">
            {/* Hamburger for mobile */}
            <button
              onClick={() => setSidebarOpen(o => !o)}
              className="md:hidden p-1.5 rounded-lg text-muted-foreground hover:text-primary hover:bg-primary/10 transition-all"
            >
              {sidebarOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
            </button>
            <button onClick={() => navigate("/portal")} className="text-muted-foreground hover:text-primary transition-all p-1.5 rounded-lg hover:bg-primary/10 group">
              <ArrowLeft className="h-4 w-4 group-hover:-translate-x-0.5 transition-transform" />
            </button>
            <div className="flex items-center gap-2">
              <motion.div
                className="w-7 h-7 rounded-lg bg-primary/20 border border-primary/40 flex items-center justify-center relative overflow-hidden"
                whileHover={{ scale: 1.05 }}
              >
                <Users className="h-3.5 w-3.5 text-primary relative z-10" />
                {(isRunning || autoRun) && <ParticleEffect active={true} />}
              </motion.div>
              <span className="text-primary font-bold text-sm tracking-widest terminal-glow">THALAMUS_TEAM</span>
            </div>
            {sessionInfo && (
              <motion.div
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                className="hidden md:flex items-center gap-1.5 ml-1"
              >
                <span className={`text-xs font-bold px-2 py-0.5 rounded-full border ${execPhaseColor} border-current/30 bg-current/5`}>
                  {execPhaseLabel}
                </span>
              </motion.div>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            {sessionInfo && (
              <div className="hidden sm:flex items-center gap-2 text-xs">
                <div className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-muted/50 border border-border">
                  <Activity className="h-3 w-3 text-amber-400" />
                  <span className="text-amber-400 font-bold">{totalMessages}/{MAX_MESSAGES}</span>
                </div>
                {loopCount > 0 && (
                  <div className="flex items-center gap-1 px-2 py-1 rounded-lg bg-red-400/10 border border-red-400/30">
                    <RefreshCw className="h-3 w-3 text-red-400" />
                    <span className="text-red-400 font-bold">loop {loopCount}</span>
                  </div>
                )}
                <motion.div
                  className={`px-2 py-1 rounded-lg text-xs font-bold border ${
                    sessionInfo.status === "completed" ? "bg-green-400/10 text-green-400 border-green-400/30" :
                    sessionInfo.status === "running" ? "bg-primary/10 text-primary border-primary/30" :
                    "bg-muted text-muted-foreground border-border"
                  }`}
                  animate={sessionInfo.status === "running" ? { opacity: [1, 0.6, 1] } : {}}
                  transition={{ duration: 1.5, repeat: Infinity }}
                >
                  {sessionInfo.status.toUpperCase()}
                </motion.div>
              </div>
            )}
            {messageQueue.length > 0 && (
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                className="hidden sm:flex items-center gap-1 px-2 py-1 rounded-lg bg-violet-400/10 border border-violet-400/30 text-xs text-violet-400 font-bold"
              >
                <Clock className="h-3 w-3" />
                {messageQueue.length}
              </motion.div>
            )}
            <motion.button
              onClick={() => setShowSuggestion(true)}
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-amber-400/10 border border-amber-400/30 text-amber-400 text-xs font-bold hover:bg-amber-400/20 transition-all"
            >
              <Lightbulb className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Suggestion</span>
            </motion.button>
            <button
              onClick={() => setIsDark(d => !d)}
              className="p-1.5 rounded-lg text-muted-foreground hover:text-primary hover:bg-primary/10 transition-all"
            >
              {isDark ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
            </button>
            <button onClick={() => signOut()} className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-all">
              <LogOut className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </header>

      {/* ── Suggestion Modal ──────────────────────────────────────────────────── */}
      <AnimatePresence>
        {showSuggestion && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-background/80 backdrop-blur-sm z-50 flex items-center justify-center p-4"
            onClick={e => { if (e.target === e.currentTarget) setShowSuggestion(false); }}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden"
            >
              {/* Header */}
              <div className="flex items-center justify-between px-5 py-4 border-b border-border">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-xl bg-amber-400/15 border border-amber-400/30 flex items-center justify-center">
                    <Lightbulb className="h-4 w-4 text-amber-400" />
                  </div>
                  <div>
                    <p className="text-sm font-bold text-foreground">Submit Suggestion</p>
                    <p className="text-[10px] text-muted-foreground">Share an idea or feedback with the team</p>
                  </div>
                </div>
                <button onClick={() => setShowSuggestion(false)} className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-all">
                  <X className="h-4 w-4" />
                </button>
              </div>

              {/* Body */}
              <div className="p-5 space-y-4 max-h-[70vh] overflow-y-auto">
                {/* Title */}
                <div>
                  <label className="text-[10px] font-bold text-muted-foreground tracking-widest mb-1.5 block">TITLE *</label>
                  <input
                    value={suggestionTitle}
                    onChange={e => setSuggestionTitle(e.target.value)}
                    placeholder="Brief title for your suggestion..."
                    className="w-full bg-background border border-border rounded-xl px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-amber-400/60 transition-colors"
                  />
                </div>

                {/* Description */}
                <div>
                  <label className="text-[10px] font-bold text-muted-foreground tracking-widest mb-1.5 block">DESCRIPTION</label>
                  <textarea
                    value={suggestionDesc}
                    onChange={e => setSuggestionDesc(e.target.value)}
                    placeholder="Describe your suggestion in detail..."
                    rows={4}
                    className="w-full bg-background border border-border rounded-xl px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-amber-400/60 transition-colors resize-none leading-relaxed"
                  />
                </div>

                {/* Files */}
                <div>
                  <label className="text-[10px] font-bold text-muted-foreground tracking-widest mb-1.5 block">ATTACH FILES</label>
                  <label className="flex items-center gap-2 px-3 py-2.5 bg-muted/30 border border-dashed border-border rounded-xl cursor-pointer hover:bg-muted/50 hover:border-amber-400/40 transition-all group">
                    <Paperclip className="h-4 w-4 text-muted-foreground group-hover:text-amber-400 transition-colors" />
                    <span className="text-sm text-muted-foreground group-hover:text-foreground transition-colors">Click to attach files (any type)</span>
                    <input
                      type="file"
                      multiple
                      accept="*/*"
                      className="hidden"
                      onChange={handleSuggestionFileUpload}
                    />
                  </label>
                  {suggestionFiles.length > 0 && (
                    <div className="mt-2 space-y-1.5">
                      {suggestionFiles.map((f, i) => (
                        <div key={i} className="flex items-center gap-2 px-3 py-2 bg-muted/20 border border-border rounded-lg">
                          <FileCode className="h-3.5 w-3.5 text-primary shrink-0" />
                          <span className="text-xs text-foreground flex-1 truncate">{f.name}</span>
                          <span className="text-[10px] text-muted-foreground shrink-0">{(f.size / 1024).toFixed(1)}KB</span>
                          <button
                            onClick={() => handleSuggestionRemoveFile(i)}
                            className="p-0.5 rounded text-muted-foreground hover:text-destructive transition-colors shrink-0"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Footer */}
              <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-border bg-muted/20">
                <button
                  onClick={() => setShowSuggestion(false)}
                  className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground border border-border rounded-xl hover:bg-muted/60 transition-all"
                >
                  Cancel
                </button>
                <motion.button
                  onClick={handleSuggestionSubmit}
                  disabled={isSuggestionLoading || !suggestionTitle.trim()}
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  className="flex items-center gap-2 px-4 py-2 bg-amber-400/15 border border-amber-400/40 text-amber-400 text-sm font-bold rounded-xl hover:bg-amber-400/25 disabled:opacity-50 transition-all"
                >
                  {isSuggestionLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Lightbulb className="h-3.5 w-3.5" />}
                  Submit Suggestion
                </motion.button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Context Menu */}
      <AnimatePresence>
        {contextMenu && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setContextMenu(null)} />
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={{ duration: 0.1 }}
              style={{ position: "fixed", left: contextMenu.x, top: contextMenu.y, zIndex: 50 }}
              className="bg-card border border-border rounded-xl shadow-2xl py-1 min-w-[180px] overflow-hidden"
            >
              <button
                onClick={() => {
                  const session = sessions.find(s => s._id === contextMenu.sessionId);
                  if (session) {
                    const raw = session as unknown as Record<string, unknown>;
                    const isBranch = !!(raw.branchGroupId && (raw.branchNumber as number) > 1);
                    handleRenameSession(session._id, session.title, isBranch);
                  }
                }}
                className="w-full flex items-center gap-2 px-3 py-2 text-[11px] text-foreground hover:bg-muted/50 transition-colors"
              >
                <Edit3 className="h-3.5 w-3.5 text-primary" />
                {contextMenu.isBranch ? "Rename Branch" : "Rename Session"}
              </button>
              {!contextMenu.isBranch && (
                <button
                  onClick={() => handleCreateBranch(contextMenu.sessionId)}
                  className="w-full flex items-center gap-2 px-3 py-2 text-[11px] text-foreground hover:bg-muted/50 transition-colors"
                >
                  <GitBranch className="h-3.5 w-3.5 text-violet-400" />
                  Create Branch
                </button>
              )}
              <div className="border-t border-border/50 my-1" />
              <button
                onClick={() => handleDeleteSession(contextMenu.sessionId)}
                disabled={isDeletingSession}
                className="w-full flex items-center gap-2 px-3 py-2 text-[11px] text-destructive hover:bg-destructive/10 transition-colors"
              >
                {isDeletingSession ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                {contextMenu.isBranch ? "Delete Branch" : "Delete Session"}
              </button>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Rename Modal */}
      <AnimatePresence>
        {renameModalOpen && renameTarget && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-background/80 backdrop-blur-sm" onClick={() => setRenameModalOpen(false)} />
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="relative z-10 bg-card border border-border rounded-2xl shadow-2xl w-full max-w-md p-6"
            >
              <h3 className="text-sm font-bold text-foreground mb-4">
                {renameTarget.isBranch ? "Rename Branch" : "Rename Session"}
              </h3>
              <input
                type="text"
                value={renameValue}
                onChange={e => setRenameValue(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") handleRenameSubmit(); if (e.key === "Escape") setRenameModalOpen(false); }}
                autoFocus
                className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm text-foreground focus:outline-none focus:border-primary/60 transition-colors mb-4"
                placeholder="Enter new name..."
              />
              <div className="flex gap-2">
                <button onClick={() => setRenameModalOpen(false)} className="flex-1 py-2 border border-border text-muted-foreground text-xs rounded-xl hover:bg-muted/50 transition-all">Cancel</button>
                <button onClick={handleRenameSubmit} disabled={!renameValue.trim()} className="flex-1 py-2 bg-primary text-primary-foreground text-xs rounded-xl hover:bg-primary/90 disabled:opacity-50 transition-all font-bold">Rename</button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Create Branch Modal */}
      <AnimatePresence>
        {createBranchModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-background/80 backdrop-blur-sm" onClick={() => setCreateBranchModalOpen(false)} />
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="relative z-10 bg-card border border-border rounded-2xl shadow-2xl w-full max-w-md p-6"
            >
              <div className="flex items-center gap-3 mb-4">
                <div className="w-8 h-8 rounded-xl bg-violet-400/20 border border-violet-400/40 flex items-center justify-center">
                  <GitBranch className="h-4 w-4 text-violet-400" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-foreground">Create Branch</h3>
                  <p className="text-[10px] text-muted-foreground">New codebase with shared context from all branches</p>
                </div>
              </div>
              <div className="bg-violet-400/5 border border-violet-400/20 rounded-xl p-3 mb-4">
                <p className="text-[10px] text-violet-400 font-bold mb-1">BRANCH CONTEXT</p>
                <p className="text-[10px] text-muted-foreground leading-relaxed">
                  This branch will have its own completely new codebase. The AI will have context of all sibling branches and their codebases. Branch-1 (Main) has access to all other branch codebases.
                </p>
              </div>
              <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest block mb-2">Branch Purpose</label>
              <textarea
                value={branchPurpose}
                onChange={e => setBranchPurpose(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleCreateBranchSubmit(); } }}
                autoFocus
                rows={3}
                className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm text-foreground focus:outline-none focus:border-violet-400/60 transition-colors mb-4 resize-none placeholder:text-muted-foreground"
                placeholder="e.g. Build Android APK version, Create Windows installer, Add dark mode theme..."
              />
              <div className="flex gap-2">
                <button onClick={() => setCreateBranchModalOpen(false)} className="flex-1 py-2 border border-border text-muted-foreground text-xs rounded-xl hover:bg-muted/50 transition-all">Cancel</button>
                <button
                  onClick={handleCreateBranchSubmit}
                  disabled={!branchPurpose.trim() || isCreatingBranch}
                  className="flex-1 py-2 bg-violet-400/15 border border-violet-400/40 text-violet-400 text-xs rounded-xl hover:bg-violet-400/25 disabled:opacity-50 transition-all font-bold flex items-center justify-center gap-2"
                >
                  {isCreatingBranch ? <Loader2 className="h-3 w-3 animate-spin" /> : <GitBranch className="h-3 w-3" />}
                  {isCreatingBranch ? "Creating..." : "Create Branch"}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <div className="flex flex-1 overflow-hidden relative">
        {/* ── Mobile overlay backdrop ────────────────────────────────────────── */}
        <AnimatePresence>
          {sidebarOpen && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="md:hidden fixed inset-0 bg-background/80 backdrop-blur-sm z-30"
              onClick={() => setSidebarOpen(false)}
            />
          )}
        </AnimatePresence>

        {/* ── Sidebar ─────────────────────────────────────────────────────────── */}
        <AnimatePresence>
          {(sidebarOpen || typeof window !== "undefined" && window.innerWidth >= 768) && (
            <motion.div
              initial={false}
              className={`
                shrink-0 border-r border-border bg-card flex flex-col overflow-hidden
                md:relative md:translate-x-0 md:w-52
                ${sidebarOpen
                  ? "fixed left-0 top-0 bottom-0 w-72 z-40 translate-x-0"
                  : "fixed left-0 top-0 bottom-0 w-72 z-40 -translate-x-full md:translate-x-0 md:static md:w-52"
                }
                transition-transform duration-200
              `}
            >
              {/* Mobile close button */}
              <div className="md:hidden flex items-center justify-between px-3 py-2 border-b border-border">
                <span className="text-xs font-bold text-primary">THALAMUS_TEAM</span>
                <button onClick={() => setSidebarOpen(false)} className="p-1 rounded text-muted-foreground hover:text-foreground">
                  <X className="h-4 w-4" />
                </button>
              </div>

              {/* Pipeline status */}
              <div className="shrink-0 p-3 border-b border-border">
                <p className="text-xs text-muted-foreground mb-2 font-bold flex items-center gap-1.5">
                  <Layers className="h-3 w-3" />
                  PIPELINE
                </p>
                <div className="space-y-0.5">
                  {PIPELINE.map((agent) => {
                    const isActive = (isRunning || autoRun) && (sessionInfo?.currentAgent === agent || (sessionInfo?.status === "running" && currentPhase === agent));
                    const isNext = !isRunning && sessionInfo && currentPhase === agent && sessionInfo.status !== "completed";
                    const isDone = sessionInfo && sessionInfo.status !== "completed"
                      ? PIPELINE.indexOf(agent) < PIPELINE.indexOf(currentPhase)
                      : sessionInfo?.status === "completed";
                    const display = PIPELINE_DISPLAY[agent];
                    const displayName = display?.displayName ?? agent;
                    const subAgents = display?.subAgents ?? [];
                    return (
                      <div key={agent}>
                        <motion.div
                          className={`flex items-center gap-2 px-2 py-1 rounded-lg text-xs transition-all ${isActive ? "bg-primary/10 border border-primary/20" : "hover:bg-muted/50"}`}
                          animate={isActive ? { x: [0, 1, 0] } : {}}
                          transition={{ duration: 0.5, repeat: Infinity }}
                        >
                          <div className={`w-4 h-4 rounded-md flex items-center justify-center text-xs font-bold shrink-0 ${AGENT_COLORS[agent]} ${isActive ? "animate-pulse" : ""}`}
                            style={{ border: "1px solid currentColor", opacity: isDone ? 0.5 : 1 }}>
                            {AGENT_ICONS[agent]}
                          </div>
                          <span className={`${AGENT_COLORS[agent]} ${isActive ? "font-bold" : isDone ? "opacity-40" : "opacity-70"} flex-1 truncate`}>{displayName}</span>
                          {subAgents.length > 0 && (
                            <span className={`text-[8px] font-mono ${isActive ? AGENT_COLORS[agent] + "/70" : "text-muted-foreground/30"}`}>
                              {subAgents.length}↓
                            </span>
                          )}
                          {isDone && <CheckCircle className="h-3 w-3 text-green-400 shrink-0" />}
                          {isNext && !isActive && <ChevronRight className="h-3 w-3 text-amber-400 shrink-0" />}
                          {isActive && (
                            <motion.div
                              className="w-1.5 h-1.5 rounded-full bg-primary shrink-0"
                              animate={{ scale: [1, 1.5, 1], opacity: [1, 0.5, 1] }}
                              transition={{ duration: 0.8, repeat: Infinity }}
                            />
                          )}
                        </motion.div>
                        {/* Show sub-agents when active */}
                        <AnimatePresence>
                          {isActive && subAgents.length > 0 && (
                            <motion.div
                              initial={{ opacity: 0, height: 0 }}
                              animate={{ opacity: 1, height: "auto" }}
                              exit={{ opacity: 0, height: 0 }}
                              className="ml-6 mt-0.5 space-y-0.5 overflow-hidden"
                            >
                              {subAgents.map((sub) => (
                                <div key={sub.name} className={`flex items-center gap-1.5 px-2 py-0.5 rounded border border-dashed ${AGENT_BG[agent] || "bg-muted/10 border-border/30"} opacity-80`}>
                                  <span className={`text-[8px] font-bold font-mono ${sub.color}`}>{sub.abbr}</span>
                                  <span className={`text-[8px] font-mono ${sub.color}/80 truncate`}>{sub.name}</span>
                                </div>
                              ))}
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Task list */}
              {plannerTasks.length > 0 && (
                <div className="shrink-0 p-3 border-b border-border max-h-40 overflow-y-auto">
                  <p className="text-xs text-muted-foreground mb-2 font-bold flex items-center gap-1.5">
                    <CheckSquare className="h-3 w-3" />
                    TASKS ({taskIndex}/{plannerTasks.length})
                  </p>
                  <div className="space-y-1">
                    {plannerTasks.map((t, i) => (
                      <div key={t.id} className={`flex items-start gap-1.5 text-xs ${i < taskIndex ? "opacity-40" : i === taskIndex ? "opacity-100" : "opacity-60"}`}>
                        <div className={`w-3.5 h-3.5 rounded-full shrink-0 mt-0.5 flex items-center justify-center ${i < taskIndex ? "bg-green-400" : i === taskIndex ? "bg-primary animate-pulse" : "bg-muted border border-border"}`}>
                          {i < taskIndex && <CheckCircle className="h-2 w-2 text-background" />}
                        </div>
                        <span className={`truncate ${i === taskIndex ? "text-foreground font-bold" : "text-muted-foreground"}`}>{t.title}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Sessions list — with right-click context menu */}
              <div className="flex-1 overflow-y-auto p-2 min-h-0">
                <p className="text-xs text-muted-foreground mb-2 font-bold px-1 flex items-center gap-1.5">
                  <MessageSquare className="h-3 w-3" />
                  SESSIONS
                </p>
                <div className="space-y-1">
                  {sessions.map((s) => {
                    const raw = s as unknown as Record<string, unknown>;
                    const isBranch = !!(raw.branchGroupId && (raw.branchNumber as number) > 1);
                    const branchName = raw.branchName as string | undefined;
                    return (
                      <motion.button
                        key={s._id}
                        onClick={() => { handleSelectSession(s._id); setSidebarOpen(false); }}
                        onContextMenu={(e) => handleContextMenu(e, s)}
                        whileHover={{ x: 2 }}
                        className={`w-full text-left px-2 py-2 rounded-lg text-xs transition-all ${activeSessionId === s._id ? "bg-primary/15 text-primary border border-primary/20" : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"}`}
                      >
                        <div className="flex items-center gap-1.5">
                          {isBranch && <GitBranch className="h-2.5 w-2.5 text-violet-400 shrink-0" />}
                          <span className="truncate font-bold">{isBranch ? (branchName || s.title) : s.title}</span>
                        </div>
                        <div className="flex items-center gap-1 mt-0.5">
                          <motion.div
                            className={`w-1.5 h-1.5 rounded-full ${s.status === "completed" ? "bg-green-400" : s.status === "running" ? "bg-primary" : "bg-muted-foreground"}`}
                            animate={s.status === "running" ? { scale: [1, 1.3, 1] } : {}}
                            transition={{ duration: 1, repeat: Infinity }}
                          />
                          <span className="opacity-60 truncate">{s.phase}</span>
                        </div>
                      </motion.button>
                    );
                  })}
                </div>
              </div>

              {/* New session input */}
              <div className="shrink-0 p-2 border-t border-border bg-card">
                <textarea
                  value={task}
                  onChange={(e) => setTask(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleCreateSession(); setSidebarOpen(false); } }}
                  placeholder="New task..."
                  className="w-full bg-background border border-border rounded-lg px-2 py-1.5 text-xs text-foreground placeholder:text-muted-foreground resize-none focus:outline-none focus:border-primary transition-colors whitespace-pre-wrap"
                  rows={2}
                />
                <motion.button
                  onClick={() => { handleCreateSession(); setSidebarOpen(false); }}
                  disabled={!task.trim() || isRunning}
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  className="w-full mt-1 py-1.5 bg-primary/10 border border-primary/30 text-primary text-xs rounded-lg hover:bg-primary/20 disabled:opacity-50 transition-all font-bold flex items-center justify-center gap-1.5"
                >
                  {isRunning ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                  {isRunning ? "RUNNING..." : "START SESSION"}
                </motion.button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* �── Main content ──────────────────────────────────────────────────────── */}
        {!activeSessionId ? (
          <div className="flex-1 flex flex-col overflow-hidden bg-background">
            {/* Header */}
            <div className="shrink-0 px-6 py-4 border-b border-border bg-card/50">
              <h1 className="text-2xl font-bold text-foreground">Code Mode Projects</h1>
              <p className="text-sm text-muted-foreground mt-1">Your AI-powered software development workspace</p>
            </div>
            {/* Project grid */}
            <div className="flex-1 overflow-y-auto p-6">
              <div className="max-w-7xl mx-auto">
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {/* Create new project card */}
                  <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    whileHover={{ scale: 1.02 }}
                    className="relative group"
                    onClick={() => setShowProjectCreationModal(true)}
                  >
                    <div className="h-48 rounded-xl border-2 border-dashed border-primary/30 bg-primary/5 hover:border-primary/50 hover:bg-primary/10 transition-all cursor-pointer flex flex-col items-center justify-center gap-3 p-6">
                      <div className="w-12 h-12 rounded-full bg-primary/20 flex items-center justify-center">
                        <Plus className="h-6 w-6 text-primary" />
                      </div>
                      <div className="text-center">
                        <h3 className="text-sm font-bold text-foreground mb-1">Start New Project</h3>
                        <p className="text-xs text-muted-foreground">Import from GitHub or start from scratch</p>
                      </div>
                      <div className="text-xs px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-all font-medium">
                        Get Started
                      </div>
                    </div>
                  </motion.div>

                  {/* Existing sessions as project cards */}
                  {sessions.map((session, i) => {
                    const raw = session as unknown as Record<string, unknown>;
                    const customId = raw.customId as string | undefined;
                    const isCompleted = session.status === "completed" || raw.executionPhase === "completed";
                    const isRunningSession = session.status === "running";
                    const isBranch = !!(raw.branchGroupId && (raw.branchNumber as number) > 1);
                    const branchName = raw.branchName as string | undefined;
                    const taskCount = (() => {
                      try { return (JSON.parse(session.plannerTasksJson || "[]") as unknown[]).length; } catch { return 0; }
                    })();
                    return (
                      <motion.div
                        key={session._id}
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: i * 0.05 }}
                        whileHover={{ scale: 1.02 }}
                        className="relative group"
                        onContextMenu={(e) => handleContextMenu(e, session)}
                      >
                        <div
                          onClick={() => setActiveSessionId(session._id)}
                          className="h-48 rounded-xl border border-border bg-card hover:border-primary/40 transition-all cursor-pointer overflow-hidden flex flex-col"
                        >
                          {/* Project header */}
                          <div className="p-4 border-b border-border bg-card/50">
                            <div className="flex items-start justify-between gap-2 mb-2">
                              <div className="flex items-center gap-1.5 flex-1 min-w-0">
                                {isBranch && <GitBranch className="h-3 w-3 text-violet-400 shrink-0" />}
                                <h3 className="text-sm font-bold text-foreground line-clamp-2 flex-1">{isBranch ? (branchName || session.title) : session.title}</h3>
                              </div>
                              {isRunningSession && (
                                <div className="shrink-0">
                                  <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
                                </div>
                              )}
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="text-[10px] text-muted-foreground font-mono">{customId || "ID not set"}</span>
                              {isCompleted && (
                                <span className="text-[10px] px-2 py-0.5 bg-green-400/10 text-green-400 rounded border border-green-400/20 font-bold">COMPLETE</span>
                              )}
                              {isBranch && (
                                <span className="text-[10px] px-2 py-0.5 bg-violet-400/10 text-violet-400 rounded border border-violet-400/20 font-bold">BRANCH</span>
                              )}
                            </div>
                          </div>

                          {/* Project stats */}
                          <div className="flex-1 p-4 space-y-2">
                            <div className="flex items-center gap-2 text-xs text-muted-foreground">
                              <Terminal className="h-3 w-3" />
                              <span>{session.phase || "Initializing"}</span>
                            </div>
                            {taskCount > 0 && (
                              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                <ListPlus className="h-3 w-3" />
                                <span>{taskCount} tasks</span>
                              </div>
                            )}
                            <div className="flex items-center gap-2 text-xs text-muted-foreground">
                              <MessageSquare className="h-3 w-3" />
                              <span>{session.totalMessages || 0} messages</span>
                            </div>
                          </div>

                          {/* Footer */}
                          <div className="px-4 py-2 border-t border-border bg-muted/20 flex items-center justify-between">
                            <span className="text-[10px] text-muted-foreground">Click to open</span>
                            <span className="text-[10px] text-muted-foreground">Right-click for options</span>
                          </div>
                        </div>
                      </motion.div>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Project Creation Modal */}
            <AnimatePresence>
              {showProjectCreationModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
                  <div className="absolute inset-0 bg-background/80 backdrop-blur-sm" onClick={() => setShowProjectCreationModal(false)} />
                  <motion.div
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    className="relative z-10 bg-card border border-border rounded-2xl shadow-2xl w-full max-w-md p-6"
                  >
                    <h3 className="text-lg font-bold text-foreground mb-2">New Project</h3>
                    <p className="text-sm text-muted-foreground mb-4">Describe what you want to build</p>
                    <textarea
                      value={task}
                      onChange={e => setTask(e.target.value)}
                      onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleCreateSession(); setShowProjectCreationModal(false); } }}
                      autoFocus
                      rows={4}
                      className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm text-foreground focus:outline-none focus:border-primary/60 transition-colors mb-4 resize-none placeholder:text-muted-foreground"
                      placeholder="e.g. Build a React e-commerce website with Stripe payments..."
                    />
                    <div className="flex gap-2">
                      <button onClick={() => setShowProjectCreationModal(false)} className="flex-1 py-2 border border-border text-muted-foreground text-xs rounded-xl hover:bg-muted/50 transition-all">Cancel</button>
                      <button
                        onClick={() => { handleCreateSession(); setShowProjectCreationModal(false); }}
                        disabled={!task.trim() || isRunning}
                        className="flex-1 py-2 bg-primary text-primary-foreground text-xs rounded-xl hover:bg-primary/90 disabled:opacity-50 transition-all font-bold flex items-center justify-center gap-2"
                      >
                        {isRunning ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
                        Create Project
                      </button>
                    </div>
                  </motion.div>
                </div>
              )}
            </AnimatePresence>
          </div>
        ) : (
          <div className="flex-1 flex flex-col overflow-hidden min-w-0">
            {/* ── Tab header ─────────────────────────────────────────────────── */}
            <div className="shrink-0 border-b border-border bg-card/90 backdrop-blur-sm z-10">
              <div className="flex items-center justify-between px-2 py-2">
                {/* Tabs — scrollable on mobile */}
                <div className="flex items-center gap-1 overflow-x-auto scrollbar-none flex-1 min-w-0">
                  {(["chat", "files", "sandbox", "preview"] as const).map((tab) => {
                    const icons = { chat: MessageSquare, files: FileCode, sandbox: Terminal, preview: Globe };
                    const Icon = icons[tab];
                    const isActive = activeTab === tab;
                    return (
                      <motion.button
                        key={tab}
                        onClick={() => setActiveTab(tab)}
                        whileHover={{ scale: 1.02 }}
                        whileTap={{ scale: 0.98 }}
                        className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-bold transition-all shrink-0 ${
                          isActive
                            ? "bg-primary/15 text-primary border border-primary/30"
                            : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                        }`}
                      >
                        <Icon className="h-3 w-3" />
                        <span className="hidden sm:block">{tab.toUpperCase()}</span>
                        {tab === "files" && projectFiles.length > 0 && (
                          <span className="bg-primary/20 text-primary text-[10px] px-1 rounded-full">{projectFiles.length}</span>
                        )}
                        {tab === "chat" && messageQueue.length > 0 && (
                          <span className="bg-violet-400/20 text-violet-400 text-[10px] px-1 rounded-full">{messageQueue.length}</span>
                        )}
                      </motion.button>
                    );
                  })}
                </div>
                {/* Controls */}
                <div className="flex items-center gap-1 shrink-0 ml-1">
                  {sessionInfo?.status !== "completed" && (
                    <>
                      {autoRun ? (
                        <motion.button
                          onClick={handleStopAutoRun}
                          whileHover={{ scale: 1.05 }}
                          whileTap={{ scale: 0.95 }}
                          className="flex items-center gap-1 px-2 py-1.5 bg-red-400/10 border border-red-400/30 text-red-400 text-xs rounded-lg hover:bg-red-400/20 transition-all font-bold"
                        >
                          <StopCircle className="h-3 w-3" />
                          <span className="hidden sm:block">STOP</span>
                        </motion.button>
                      ) : (
                        <motion.button
                          onClick={handleAutoRun}
                          disabled={isRunning}
                          whileHover={{ scale: 1.05 }}
                          whileTap={{ scale: 0.95 }}
                          className="flex items-center gap-1 px-2 py-1.5 bg-primary/10 border border-primary/30 text-primary text-xs rounded-lg hover:bg-primary/20 disabled:opacity-50 transition-all font-bold"
                        >
                          {isRunning ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
                          <span className="hidden sm:block">RUN</span>
                        </motion.button>
                      )}
                      <motion.button
                        onClick={() => handleRunNextAgent()}
                        disabled={isRunning || autoRun}
                        whileHover={{ scale: 1.05 }}
                        whileTap={{ scale: 0.95 }}
                        className="flex items-center gap-1 px-2 py-1.5 bg-muted border border-border text-muted-foreground text-xs rounded-lg hover:bg-muted/80 disabled:opacity-50 transition-all"
                        title="Step once"
                      >
                        <RefreshCw className="h-3 w-3" />
                      </motion.button>
                      {sessionInfo?.status === "running" && (
                        <motion.button
                          onClick={handleForceRestart}
                          whileHover={{ scale: 1.05 }}
                          whileTap={{ scale: 0.95 }}
                          className="flex items-center gap-1 px-2 py-1.5 bg-orange-400/10 border border-orange-400/30 text-orange-400 text-xs rounded-lg hover:bg-orange-400/20 transition-all font-bold"
                          title="Force reset stuck agent"
                        >
                          <AlertCircle className="h-3 w-3" />
                          <span className="hidden sm:block">RESET</span>
                        </motion.button>
                      )}
                    </>
                  )}
                </div>
              </div>
            </div>

            {/* ── Tab content ───────────────────────────────────────────────────── */}
            <div className="flex-1 overflow-hidden min-h-0">
              {/* CHAT TAB */}
              {activeTab === "chat" && (
                <div className="h-full flex flex-col overflow-hidden">
                  {/* Messages */}
                  <div className="flex-1 overflow-y-auto min-h-0 p-3 space-y-4">
                    {(sessionInfo?.status === "running" || agentThinkingContent) && streamingAgent && (
                      <div className="sticky top-0 z-10 bg-background/90 backdrop-blur-sm rounded-xl">
                        <ThinkingPanel
                          title={`${streamingAgent} thinking`}
                          content={agentThinkingContent}
                          active={sessionInfo?.status === "running" && (!streamingOutput || streamingOutput === `[${streamingAgent} is thinking...]`)}
                          accentClassName={AGENT_BG[streamingAgent] || "bg-primary/10 border-primary/30 text-primary"}
                        />
                      </div>
                    )}
                    {allMessages.length === 0 && !sessionInfo?.currentAgentOutput && (
                      <div className="flex flex-col items-center justify-center h-full gap-3 text-center">
                        <motion.div
                          animate={{ scale: [1, 1.05, 1] }}
                          transition={{ duration: 2, repeat: Infinity }}
                          className="w-12 h-12 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center"
                        >
                          <Sparkles className="h-6 w-6 text-primary/40" />
                        </motion.div>
                        <p className="text-xs text-muted-foreground">Agents will appear here as they work</p>
                      </div>
                    )}

                    {/* All messages (agent + user) */}
                    <AnimatePresence>
                      {allMessages.map((msg) => (
                        <motion.div
                          key={msg._id}
                          initial={{ opacity: 0, y: 10, scale: 0.98 }}
                          animate={{ opacity: 1, y: 0, scale: 1 }}
                          transition={{ type: "spring", stiffness: 300, damping: 30 }}
                          className={`flex items-start gap-2 ${msg.isUser ? "flex-row-reverse" : ""}`}
                        >
                          {!msg.isUser && (
                            <div className={`w-7 h-7 rounded-xl flex items-center justify-center text-xs font-bold shrink-0 border ${AGENT_BG[msg.agent] || "bg-muted/20 border-border"}`}>
                              {AGENT_EMOJI[msg.agent] || msg.agent[0]}
                            </div>
                          )}
                          <div className={`flex-1 min-w-0 ${msg.isUser ? "flex flex-col items-end" : ""}`}>
                            {!msg.isUser && (
                              <>
                                <p className={`text-xs font-bold mb-0 ${AGENT_COLORS[msg.agent] || "text-foreground"}`}>{msg.agent}</p>
                                {msg.modelUsed && (
                                  <span className="text-[9px] text-muted-foreground/50 font-mono leading-none mb-1">{msg.modelUsed}</span>
                                )}
                              </>
                            )}
                            <div className={`rounded-2xl px-3 py-2.5 border shadow-sm ${
                              msg.isUser
                                ? "rounded-tr-sm bg-primary/10 border-primary/30 text-foreground max-w-[90%]"
                                : msg.agent === "Planner"
                                ? "rounded-tl-sm bg-violet-400/5 border-violet-400/20 w-full"
                                : `rounded-tl-sm ${AGENT_BG[msg.agent] || "bg-card border-border"} max-w-[90%]`
                            }`}>
                              <MessageContent msg={msg} currentTaskIndex={sessionInfo?.currentTaskIndex} />
                            </div>
                            {!msg.isUser && msg.agentBucksDeducted !== undefined && msg.agentBucksDeducted > 0 && (
                              <span className="text-[9px] text-muted-foreground/40 font-mono mt-0.5">
                                -{msg.agentBucksDeducted.toLocaleString()} AB
                              </span>
                            )}
                          </div>
                          {msg.isUser && (
                            <div className="w-7 h-7 rounded-xl flex items-center justify-center text-xs font-bold shrink-0 border bg-primary/10 border-primary/30 text-primary">
                              👤
                            </div>
                          )}
                        </motion.div>
                      ))}
                    </AnimatePresence>

                    {/* Live streaming output */}
                    <AnimatePresence>
                      {sessionInfo?.status === "running" && streamingAgent && streamingOutput && streamingOutput !== `[${streamingAgent} is thinking...]` && (
                        <motion.div
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0 }}
                          className="flex items-start gap-2"
                        >
                          <motion.div
                            className={`w-7 h-7 rounded-xl flex items-center justify-center text-xs font-bold shrink-0 border ${AGENT_BG[streamingAgent] || "bg-primary/10 border-primary/20"}`}
                            animate={{ boxShadow: ["0 0 0px rgba(0,0,0,0)", "0 0 12px rgba(var(--primary),0.3)", "0 0 0px rgba(0,0,0,0)"] }}
                            transition={{ duration: 1.5, repeat: Infinity }}
                          >
                            {AGENT_EMOJI[streamingAgent] || streamingAgent[0]}
                          </motion.div>
                          <div className="flex-1 min-w-0">
                            <p className={`text-xs font-bold mb-1 ${AGENT_COLORS[streamingAgent] || "text-primary"}`}>
                              {streamingAgent} <motion.span
                                className="text-muted-foreground font-normal"
                                animate={{ opacity: [1, 0.3, 1] }}
                                transition={{ duration: 1, repeat: Infinity }}
                              >● live</motion.span>
                            </p>
                            <div className={`rounded-2xl rounded-tl-sm px-3 py-2.5 border shadow-sm ${
                              streamingAgent === "Planner"
                                ? "bg-violet-400/5 border-violet-400/20 w-full"
                                : AGENT_BG[streamingAgent] || "bg-card border-border"
                            }`}>
                              <MessageContent
                                msg={{ _id: "streaming", agent: streamingAgent, content: streamingOutput }}
                                currentTaskIndex={sessionInfo?.currentTaskIndex}
                              />
                            </div>
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>

                    {/* Thinking indicator */}
                    <AnimatePresence>
                      {sessionInfo?.status === "running" && streamingAgent && (!streamingOutput || streamingOutput === `[${streamingAgent} is thinking...]`) && (
                        <motion.div
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          exit={{ opacity: 0 }}
                          className="flex items-start gap-2"
                        >
                          <div className={`w-7 h-7 rounded-xl flex items-center justify-center text-xs font-bold shrink-0 border ${AGENT_BG[streamingAgent] || "bg-primary/10 border-primary/20"}`}>
                            {AGENT_EMOJI[streamingAgent] || streamingAgent[0]}
                          </div>
                          <div className="flex-1">
                            <p className={`text-xs font-bold mb-1 ${AGENT_COLORS[streamingAgent] || "text-primary"}`}>{streamingAgent}</p>
                            <div className={`rounded-2xl rounded-tl-sm px-3 py-2 border ${AGENT_BG[streamingAgent] || "bg-card border-border"} inline-flex`}>
                              <TypingDots />
                            </div>
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>

                    <div ref={messagesEndRef} />
                  </div>

                  {/* Message input */}
                  <div className="shrink-0 p-3 border-t border-border bg-card/50">
                    {messageQueue.length > 0 && (
                      <div className="mb-2 flex items-center gap-2 text-xs text-violet-400">
                        <Clock className="h-3 w-3" />
                        <span>{messageQueue.length} message(s) queued</span>
                      </div>
                    )}
                    <div className="flex gap-2">
                      <div className="flex-1 relative">
                        <textarea
                          ref={messageInputRef}
                          value={messageInput}
                          onChange={(e) => { setMessageInput(e.target.value); e.target.style.height = "auto"; e.target.style.height = Math.min(e.target.scrollHeight, 160) + "px"; }}
                          onKeyDown={handleMessageKeyDown}
                          placeholder={isRunning || autoRun ? "Type to queue a message..." : "Send a message or new task..."}
                          rows={1}
                          className="w-full bg-background border border-border rounded-xl px-3 py-2.5 text-xs text-foreground placeholder:text-muted-foreground resize-none focus:outline-none focus:border-primary/60 transition-colors whitespace-pre-wrap"
                          style={{ minHeight: "40px", maxHeight: "160px" }}
                        />
                      </div>
                      <div className="flex flex-col gap-1">
                        <motion.button
                          onClick={handleSendMessage}
                          disabled={!messageInput.trim()}
                          whileHover={{ scale: 1.05 }}
                          whileTap={{ scale: 0.95 }}
                          className="px-3 py-2 bg-primary text-primary-foreground rounded-xl text-xs font-bold hover:bg-primary/90 disabled:opacity-50 transition-all flex items-center gap-1"
                        >
                          <Send className="h-3 w-3" />
                          <span className="hidden sm:block">SEND</span>
                        </motion.button>
                        {(isRunning || autoRun) && (
                          <motion.button
                            onClick={handleQueueMessage}
                            disabled={!messageInput.trim()}
                            whileHover={{ scale: 1.05 }}
                            whileTap={{ scale: 0.95 }}
                            className="px-3 py-2 bg-violet-400/10 border border-violet-400/30 text-violet-400 rounded-xl text-xs font-bold hover:bg-violet-400/20 disabled:opacity-50 transition-all flex items-center gap-1"
                          >
                            <ListPlus className="h-3 w-3" />
                          </motion.button>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* FILES TAB */}
              {activeTab === "files" && (
                <div className="h-full flex flex-col md:flex-row overflow-hidden">
                  {/* File tree sidebar */}
                  <div className="md:w-56 shrink-0 border-b md:border-b-0 md:border-r border-border bg-card/50 max-h-48 md:max-h-none flex flex-col overflow-hidden">
                    {/* Header */}
                    <div className="shrink-0 px-3 py-2 border-b border-border flex items-center justify-between gap-1">
                      <span className="text-[10px] font-bold text-muted-foreground tracking-widest">FILES ({projectFiles.length})</span>
                      <div className="flex items-center gap-1">
                        <button onClick={() => handleCreateFile("")} className="p-1 text-muted-foreground hover:text-primary transition-colors" title="New File">
                          <FileCode className="h-3 w-3" />
                        </button>
                        <button onClick={() => handleCreateFolder("")} className="p-1 text-muted-foreground hover:text-amber-400 transition-colors" title="New Folder">
                          <Folder className="h-3 w-3" />
                        </button>
                        <label className="cursor-pointer p-1 text-muted-foreground hover:text-primary transition-colors" title="Upload">
                          <Upload className="h-3 w-3" />
                          <input type="file" multiple className="hidden" onChange={handleUploadFiles} />
                        </label>
                      </div>
                    </div>
                    {/* Tree */}
                    <FileTreeView
                      files={projectFiles.map(f => ({ filepath: f.filepath, content: f.content, lastModifiedBy: f.lastModifiedBy }))}
                      selectedPath={selectedFile?.filepath ?? null}
                      onSelect={(f) => setSelectedFile(f)}
                      onDelete={handleFileDelete}
                      onDuplicate={handleFileDuplicate}
                      onRename={handleFileRename}
                      onDownload={handleFileDownload}
                      onCreateFile={handleCreateFile}
                      onCreateFolder={handleCreateFolder}
                      onMove={handleFileMove}
                    />
                  </div>
                  {/* File content */}
                  <div className="flex-1 overflow-auto min-h-0 min-w-0">
                    {selectedFile ? (
                      <div className="h-full flex flex-col">
                        <div className="shrink-0 px-3 py-2 border-b border-border bg-card/50 flex items-center justify-between gap-2">
                          <span className="text-xs font-mono text-primary truncate">{selectedFile.filepath}</span>
                          <div className="flex items-center gap-2 shrink-0">
                            <span className="text-[10px] text-muted-foreground">{selectedFile.lastModifiedBy}</span>
                            <a
                              href={`data:text/plain;charset=utf-8,${encodeURIComponent(selectedFile.content)}`}
                              download={selectedFile.filepath.split("/").pop() ?? "file"}
                              className="flex items-center gap-1 px-2 py-1 bg-primary/10 border border-primary/30 text-primary text-[10px] rounded hover:bg-primary/20 transition-all"
                            >
                              <Download className="h-3 w-3" />
                            </a>
                          </div>
                        </div>
                        <pre className="flex-1 overflow-auto p-3 text-xs font-mono text-foreground/80 leading-relaxed whitespace-pre-wrap break-all">
                          {selectedFile.content}
                        </pre>
                      </div>
                    ) : (
                      <div className="h-full flex items-center justify-center">
                        <div className="text-center">
                          <FileCode className="h-8 w-8 text-muted-foreground/20 mx-auto mb-2" />
                          <p className="text-xs text-muted-foreground">Select a file to view</p>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* SANDBOX TAB */}
              {activeTab === "sandbox" && (
                <div className="h-full flex flex-col overflow-hidden">
                  {/* Sandbox header */}
                  <div className="shrink-0 px-3 py-2 border-b border-border bg-card/50 flex items-center justify-between flex-wrap gap-2">
                    <div className="flex items-center gap-2">
                      <Terminal className="h-3.5 w-3.5 text-amber-400" />
                      <span className="text-xs font-bold text-amber-400">SANDBOX</span>
                      {activeSandbox && (
                        <span className={`text-[10px] px-1.5 py-0.5 rounded-full border font-bold ${
                          activeSandbox.status === "running" ? "bg-green-400/10 text-green-400 border-green-400/30" : "bg-muted text-muted-foreground border-border"
                        }`}>
                          {activeSandbox.status.toUpperCase()}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {activeSandboxId && activeSessionId && (
                        <motion.button
                          onClick={handleAutoDeployAndStart}
                          disabled={isSandboxLoading || projectFiles.length === 0}
                          whileHover={{ scale: 1.02 }}
                          whileTap={{ scale: 0.98 }}
                          className="flex items-center gap-1 px-2 py-1 bg-primary/10 border border-primary/30 text-primary text-xs rounded-lg hover:bg-primary/20 disabled:opacity-50 transition-all font-bold"
                        >
                          {isSandboxLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Globe className="h-3 w-3" />}
                          DEPLOY
                        </motion.button>
                      )}
                      {activeSandboxId && (
                        <motion.button
                          onClick={() => activeSandboxId && handleStopSandbox(activeSandboxId)}
                          disabled={isSandboxLoading}
                          whileHover={{ scale: 1.02 }}
                          whileTap={{ scale: 0.98 }}
                          className="flex items-center gap-1 px-2 py-1 bg-red-400/10 border border-red-400/30 text-red-400 text-xs rounded-lg hover:bg-red-400/20 disabled:opacity-50 transition-all font-bold"
                        >
                          <Square className="h-3 w-3" />
                          STOP
                        </motion.button>
                      )}
                    </div>
                  </div>

                  {activeSandboxId ? (
                    <>
                      {/* Output */}
                      <div className="flex-1 overflow-y-auto min-h-0 p-3 font-mono text-xs space-y-2 bg-background/50">
                        {sandboxOutput.length === 0 && (
                          <p className="text-muted-foreground/50">No commands run yet...</p>
                        )}
                        {sandboxOutput.map((entry, i) => (
                          <div key={i} className="space-y-1">
                            <div className="flex items-center gap-2">
                              <span className="text-primary">$</span>
                              <span className="text-foreground">{entry.cmd}</span>
                            </div>
                            <pre className={`pl-4 whitespace-pre-wrap break-all ${entry.code === 0 ? "text-muted-foreground" : "text-red-400"}`}>
                              {entry.out}
                            </pre>
                          </div>
                        ))}
                        <div ref={sandboxOutputEndRef} />
                      </div>
                      {/* Command input */}
                      <div className="shrink-0 p-3 border-t border-border bg-card/50">
                        <div className="flex gap-2">
                          <div className="flex items-center gap-2 flex-1 bg-background border border-border rounded-xl px-3 py-2">
                            <span className="text-primary text-xs font-mono shrink-0">$</span>
                            <input
                              value={sandboxCommand}
                              onChange={(e) => setSandboxCommand(e.target.value)}
                              onKeyDown={(e) => { if (e.key === "Enter") handleRunSandboxCommand(); }}
                              placeholder="Enter command..."
                              className="flex-1 bg-transparent text-xs text-foreground placeholder:text-muted-foreground focus:outline-none font-mono"
                            />
                          </div>
                          <motion.button
                            onClick={handleRunSandboxCommand}
                            disabled={!sandboxCommand.trim() || isSandboxLoading}
                            whileHover={{ scale: 1.05 }}
                            whileTap={{ scale: 0.95 }}
                            className="px-3 py-2 bg-amber-400/10 border border-amber-400/30 text-amber-400 rounded-xl text-xs font-bold hover:bg-amber-400/20 disabled:opacity-50 transition-all"
                          >
                            {isSandboxLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
                          </motion.button>
                        </div>
                      </div>
                    </>
                  ) : (
                    <div className="flex-1 overflow-y-auto p-6 space-y-6">
                      <div className="flex flex-col items-center gap-4">
                        <motion.div
                          animate={{ scale: [1, 1.05, 1] }}
                          transition={{ duration: 2, repeat: Infinity }}
                        >
                          <Box className="h-12 w-12 text-amber-400/20" />
                        </motion.div>
                        <div className="text-center">
                          <p className="text-sm font-bold text-foreground mb-1">No Active Sandbox</p>
                          <p className="text-xs text-muted-foreground">Create a cloud sandbox to execute commands</p>
                        </div>
                        <motion.button
                          onClick={handleCreateSandbox}
                          disabled={isSandboxLoading}
                          whileHover={{ scale: 1.02 }}
                          whileTap={{ scale: 0.98 }}
                          className="flex items-center gap-2 px-4 py-2 bg-amber-400/10 border border-amber-400/30 text-amber-400 text-sm rounded-xl hover:bg-amber-400/20 disabled:opacity-50 transition-all font-bold"
                        >
                          {isSandboxLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                          CREATE CLOUD SANDBOX ($0.075/hr)
                        </motion.button>
                      </div>

                      {/* Local OS Sandbox — bridge-aware */}
                      <div className="border border-border rounded-xl p-4 space-y-3">
                        <div className="flex items-center justify-between mb-1">
                          <div className="flex items-center gap-2">
                            <Monitor className="h-4 w-4 text-primary" />
                            <p className="text-xs font-bold text-foreground">Local OS Sandbox</p>
                          </div>
                          {/* Bridge status indicator */}
                          <div className="flex items-center gap-1.5">
                            {bridgeStatus === "checking" && (
                              <><Loader2 className="h-3 w-3 animate-spin text-muted-foreground" /><span className="text-[9px] text-muted-foreground">Checking...</span></>
                            )}
                            {bridgeStatus === "online" && (
                              <><span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" /><span className="text-[9px] text-green-400 font-bold">SANDBOX READY</span></>
                            )}
                            {bridgeStatus === "offline" && (
                              <><span className="w-2 h-2 rounded-full bg-orange-400" /><span className="text-[9px] text-orange-400 font-bold">FILES REQUIRED</span></>
                            )}
                          </div>
                        </div>

                        <p className="text-[10px] text-muted-foreground leading-relaxed">
                          Run a full OS sandbox directly on your machine — no cloud costs, no setup. One click gets you everything.
                        </p>

                        {bridgeStatus === "online" ? (
                          /* Bridge is running — show Boot OS */
                          <motion.button
                            onClick={handleBootOs}
                            disabled={isBootingOs}
                            whileHover={{ scale: 1.02 }}
                            whileTap={{ scale: 0.98 }}
                            className="flex items-center justify-center gap-2 w-full px-4 py-3 bg-green-400/10 border border-green-400/30 text-green-400 text-sm rounded-xl hover:bg-green-400/20 disabled:opacity-50 transition-all font-bold"
                          >
                            {isBootingOs ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                            BOOT OS
                          </motion.button>
                        ) : (
                          /* Local executable not ready - show Download Required Files */
                          <div className="space-y-2">
                            <a
                              href={bridgeDownloadUrl}
                              download
                              className="flex items-center justify-center gap-2 w-full px-4 py-3 bg-primary/10 border border-primary/30 text-primary text-sm rounded-xl hover:bg-primary/20 transition-all font-bold group"
                            >
                              <Download className="h-4 w-4 group-hover:scale-110 transition-transform" />
                              DOWNLOAD REQUIRED FILES
                            </a>
                            <p className="text-[9px] text-muted-foreground/70 text-center leading-relaxed">
                              Includes QEMU, the Thalamus Bridge, and all required files.<br />
                              Run the executable, then return here. The button will change to <span className="text-green-400 font-bold">Boot OS</span>.
                            </p>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* PREVIEW TAB */}
              {activeTab === "preview" && (
                <div className="h-full flex flex-col overflow-hidden">
                  <div className="shrink-0 px-3 py-2 border-b border-border bg-card/50 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Globe className="h-3.5 w-3.5 text-green-400" />
                      <span className="text-xs font-bold text-green-400">WEB PREVIEW</span>
                      {previewUrl && <span className="text-xs text-muted-foreground truncate max-w-[120px] sm:max-w-xs">{previewUrl}</span>}
                    </div>
                    <div className="flex items-center gap-2">
                      {previewUrl && (
                        <a href={previewUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-xs text-primary hover:underline">
                          <ExternalLink className="h-3 w-3" />
                          Open
                        </a>
                      )}
                      {activeSandboxId && (
                        <button onClick={handleGetPreviewUrl} disabled={isSandboxLoading} className="text-xs text-muted-foreground hover:text-foreground border border-border px-2 py-1 rounded-lg transition-colors">
                          {isSandboxLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : "Refresh"}
                        </button>
                      )}
                    </div>
                  </div>
                  {previewUrl ? (
                    <div className="flex-1 flex flex-col items-center justify-center gap-4 p-6">
                      <Globe className="h-12 w-12 text-green-400/40" />
                      <div className="text-center max-w-sm w-full">
                        <p className="text-sm font-bold text-foreground mb-2">Preview Ready</p>
                        <div className="bg-card border border-border rounded-xl p-3 mb-4 text-left">
                          <p className="text-xs text-muted-foreground mb-1">Preview URL:</p>
                          <p className="text-xs text-primary font-mono break-all">{previewUrl}</p>
                        </div>
                        <motion.a
                          href={previewUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          whileHover={{ scale: 1.02 }}
                          whileTap={{ scale: 0.98 }}
                          className="inline-flex items-center gap-2 bg-primary text-primary-foreground px-5 py-2.5 rounded-xl text-sm font-bold hover:bg-primary/90 transition-all"
                        >
                          <ExternalLink className="h-4 w-4" />
                          Open Preview
                        </motion.a>
                      </div>
                    </div>
                  ) : (
                    <div className="flex-1 flex flex-col items-center justify-center gap-4 p-6">
                      <Monitor className="h-12 w-12 text-muted-foreground/20" />
                      <div className="text-center">
                        <p className="text-sm font-bold text-foreground mb-1">No Preview Available</p>
                        <p className="text-xs text-muted-foreground mb-4">Deploy your project to see a live preview</p>
                        {activeSandboxId && activeSessionId && (
                          <motion.button
                            onClick={handleAutoDeployAndStart}
                            disabled={isSandboxLoading || projectFiles.length === 0}
                            whileHover={{ scale: 1.02 }}
                            whileTap={{ scale: 0.98 }}
                            className="flex items-center gap-2 px-4 py-2 bg-primary/10 border border-primary/30 text-primary text-sm rounded-xl hover:bg-primary/20 disabled:opacity-50 transition-all font-bold mx-auto"
                          >
                            {isSandboxLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Globe className="h-4 w-4" />}
                            DEPLOY & START APP
                          </motion.button>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
