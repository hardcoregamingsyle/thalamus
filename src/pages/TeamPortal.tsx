import { useAuth } from "@/hooks/use-auth";
import { useEffect, useState, useRef, useCallback } from "react";
import { useNavigate } from "react-router";
import { motion, AnimatePresence } from "framer-motion";
import { api } from "@/convex/_generated/api";
import { useAction, useQuery } from "convex/react";
import { Id } from "@/convex/_generated/dataModel";
import { toast } from "sonner";
import {
  Loader2, LogOut, Plus, Users, ArrowLeft, RefreshCw, CheckCircle,
  Terminal, Box, Globe, ExternalLink, Play, Square, Send, FileCode,
  Monitor, Sun, Moon, ChevronRight, Zap, Code2, Search, Cpu,
  CheckSquare, Clock, AlertCircle, Layers, Activity,
} from "lucide-react";
import ReactMarkdown from "react-markdown";

// ── Types ──────────────────────────────────────────────────────────────────────
interface AgentMessage {
  _id: string;
  agent: string;
  content: string;
  round?: number;
  messageIndex?: number;
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

// ── Agent config ───────────────────────────────────────────────────────────────
const AGENT_COLORS: Record<string, string> = {
  Researcher: "text-cyan-400",
  Analyser: "text-blue-400",
  Planner: "text-violet-400",
  Coder: "text-emerald-400",
  Optimiser: "text-amber-400",
  Tester: "text-green-400",
  Hacker: "text-red-400",
  Critic: "text-purple-400",
};

const AGENT_BG: Record<string, string> = {
  Researcher: "bg-cyan-400/10 border-cyan-400/30",
  Analyser: "bg-blue-400/10 border-blue-400/30",
  Planner: "bg-violet-400/10 border-violet-400/30",
  Coder: "bg-emerald-400/10 border-emerald-400/30",
  Optimiser: "bg-amber-400/10 border-amber-400/30",
  Tester: "bg-green-400/10 border-green-400/30",
  Hacker: "bg-red-400/10 border-red-400/30",
  Critic: "bg-purple-400/10 border-purple-400/30",
};

const AGENT_ICONS: Record<string, string> = {
  Researcher: "🔍", Analyser: "A", Planner: "P", Coder: "C",
  Optimiser: "O", Tester: "T", Hacker: "H", Critic: "R",
};

const AGENT_DOT: Record<string, string> = {
  Researcher: "bg-cyan-400", Analyser: "bg-blue-400", Planner: "bg-violet-400",
  Coder: "bg-emerald-400", Optimiser: "bg-amber-400", Tester: "bg-green-400",
  Hacker: "bg-red-400", Critic: "bg-purple-400",
};

const PIPELINE = ["Researcher", "Analyser", "Planner", "Coder", "Optimiser", "Tester", "Hacker", "Critic"];
const MAX_MESSAGES = 600;

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
  const [newTask, setNewTask] = useState("");
  const [isContinuing, setIsContinuing] = useState(false);
  const [isDark, setIsDark] = useState(true);
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

  // Theme
  useEffect(() => {
    document.documentElement.classList.toggle("light", !isDark);
  }, [isDark]);

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

  const messages: AgentMessage[] = (liveMessages ?? []).map((m) => ({
    _id: m._id as string, agent: m.agent, content: m.content, round: m.round, messageIndex: m.messageIndex,
  }));

  const projectFiles: ProjectFile[] = (liveFiles ?? []).map((f) => ({
    filepath: f.filepath, content: f.content, lastModifiedBy: f.lastModifiedBy,
  }));

  // Actions
  const createSession = useAction(api.agentTeam.createSession);
  const runAgentRound = useAction(api.agentTeam.runAgentRound);
  const listSessionsAction = useAction(api.agentTeam.listSessions);
  const continueSessionAction = useAction(api.agentTeam.continueSession);
  const createSandboxAction = useAction(api.sandbox.createSandbox);
  const executeCommandAction = useAction(api.sandbox.executeCommand);
  const stopSandboxAction = useAction(api.sandbox.stopSandbox);
  const listSandboxesAction = useAction(api.sandbox.listSandboxes);
  const getPreviewUrlAction = useAction(api.sandbox.getPreviewUrl);
  const autoDeployAndStartAction = useAction(api.sandbox.autoDeployAndStart);
  const testFileWriteAction = useAction(api.sandbox.testFileWrite);

  useEffect(() => { if (!isLoading && !isAuthenticated) navigate("/auth"); }, [isLoading, isAuthenticated, navigate]);
  useEffect(() => { if (token) { loadSessions(); loadSandboxes(); } }, [token]);
  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, sessionInfo?.currentAgentOutput]);
  useEffect(() => { sandboxOutputEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [sandboxOutput]);

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
  };

  const handleCreateSession = async () => {
    if (!task.trim() || !token) return;
    setIsRunning(true);
    try {
      const sessionId = await createSession({ task: task.trim(), token });
      setActiveSessionId(sessionId);
      setTask("");
      await loadSessions();
      toast.success("Session created! Starting agents...");
      autoRunRef.current = true;
      setAutoRun(true);
    } catch { toast.error("Failed to create session"); }
    finally { setIsRunning(false); }
  };

  const handleContinueSession = async () => {
    if (!newTask.trim() || !activeSessionId || !token) return;
    setIsContinuing(true);
    try {
      await continueSessionAction({ sessionId: activeSessionId, newTask: newTask.trim(), token });
      setNewTask("");
      await loadSessions();
      toast.success("New task set! Starting agents...");
      autoRunRef.current = true;
      setAutoRun(true);
    } catch { toast.error("Failed to continue session"); }
    finally { setIsContinuing(false); }
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
      if (result.done) { toast.success("🎉 Project complete!"); autoRunRef.current = false; setAutoRun(false); }
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
      agentRetryCountRef.current = 0; autoRunRef.current = false; setAutoRun(false);
    } finally { setIsRunning(false); setCurrentAgent(null); }
  }, [activeSessionId, token, isRunning, runAgentRound, loadSessions, activeSandboxId, activeSandbox, autoDeployAndStartAction]);

  useEffect(() => {
    if (!autoRun || isRunning || !activeSessionId) return;
    if (sessionInfo && (sessionInfo.status === "completed" || sessionInfo.totalMessages >= MAX_MESSAGES)) {
      setAutoRun(false); autoRunRef.current = false; return;
    }
    const timer = setTimeout(() => { if (autoRunRef.current) handleRunNextAgent(); }, 800);
    return () => clearTimeout(timer);
  }, [autoRun, isRunning, sessionInfo, activeSessionId, handleRunNextAgent]);

  const handleAutoRun = () => { if (!activeSessionId || !token) return; autoRunRef.current = true; setAutoRun(true); handleRunNextAgent(); };
  const handleStopAutoRun = () => { autoRunRef.current = false; setAutoRun(false); };

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
      toast.success(`Sandbox stopped. Cost: $${(result.costCents / 100).toFixed(4)}`);
    } catch (err: unknown) { toast.error(err instanceof Error ? err.message : "Failed"); }
    finally { setIsSandboxLoading(false); }
  };

  // Derived state
  const currentPhase = sessionInfo?.phase ?? "Researcher";
  const totalMessages = sessionInfo?.totalMessages ?? 0;
  const loopCount = sessionInfo?.loopCount ?? 0;
  const streamingAgent = sessionInfo?.currentAgent ?? currentAgent;
  const streamingOutput = sessionInfo?.currentAgentOutput ?? "";
  const execPhase = sessionInfo?.executionPhase ?? "planning";
  const taskIndex = sessionInfo?.currentTaskIndex ?? 0;
  let plannerTasks: Array<{ id: string; title: string; description: string; subpart: boolean }> = [];
  try { if (sessionInfo?.plannerTasksJson) plannerTasks = JSON.parse(sessionInfo.plannerTasksJson); } catch { /* ignore */ }

  const execPhaseLabel = execPhase === "planning" ? "PLANNING" : execPhase === "final_review" ? "FINAL REVIEW" : `TASK ${taskIndex + 1}/${plannerTasks.length || "?"}`;
  const execPhaseColor = execPhase === "planning" ? "text-violet-400" : execPhase === "final_review" ? "text-amber-400" : "text-emerald-400";

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="h-8 w-8 text-primary animate-spin" />
          <p className="text-primary font-mono text-sm animate-pulse">INITIALIZING AGENT_TEAM...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col bg-background font-mono overflow-hidden">
      {/* ── Global Header ─────────────────────────────────────────────────────── */}
      <header className="shrink-0 border-b border-border bg-card/80 backdrop-blur-sm z-20">
        <div className="flex items-center justify-between px-4 h-12">
          <div className="flex items-center gap-3">
            <button onClick={() => navigate("/portal")} className="text-muted-foreground hover:text-primary transition-colors p-1 rounded hover:bg-primary/10">
              <ArrowLeft className="h-4 w-4" />
            </button>
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded bg-primary/20 border border-primary/40 flex items-center justify-center">
                <Users className="h-3 w-3 text-primary" />
              </div>
              <span className="text-primary font-bold text-sm tracking-widest">AGENT_TEAM</span>
            </div>
            {sessionInfo && (
              <div className="hidden md:flex items-center gap-1.5 ml-2">
                <span className={`text-xs font-bold px-2 py-0.5 rounded-full border ${execPhaseColor} bg-current/10 border-current/30`} style={{ color: "inherit" }}>
                  <span className={execPhaseColor}>{execPhaseLabel}</span>
                </span>
              </div>
            )}
          </div>
          <div className="flex items-center gap-2">
            {sessionInfo && (
              <div className="hidden sm:flex items-center gap-3 text-xs">
                <div className="flex items-center gap-1.5 px-2 py-1 rounded bg-muted/50 border border-border">
                  <Activity className="h-3 w-3 text-amber-400" />
                  <span className="text-amber-400 font-bold">{totalMessages}</span>
                  <span className="text-muted-foreground">/{MAX_MESSAGES}</span>
                </div>
                {loopCount > 0 && (
                  <div className="flex items-center gap-1 px-2 py-1 rounded bg-red-400/10 border border-red-400/30">
                    <span className="text-red-400 font-bold">loop {loopCount}</span>
                  </div>
                )}
                <div className={`flex items-center gap-1.5 px-2 py-1 rounded border text-xs font-bold ${
                  sessionInfo.status === "completed" ? "bg-green-400/10 border-green-400/30 text-green-400" :
                  sessionInfo.status === "running" ? "bg-primary/10 border-primary/30 text-primary" :
                  "bg-muted border-border text-muted-foreground"
                }`}>
                  {sessionInfo.status === "running" && <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />}
                  {sessionInfo.status === "completed" && <CheckCircle className="h-3 w-3" />}
                  {sessionInfo.status.toUpperCase()}
                </div>
              </div>
            )}
            <button
              onClick={() => setIsDark(!isDark)}
              className="p-1.5 rounded border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              title="Toggle theme"
            >
              {isDark ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
            </button>
            <span className="text-xs text-muted-foreground hidden sm:block truncate max-w-[100px]">{user?.email?.split("@")[0] || "guest"}</span>
            <button onClick={() => signOut()} className="p-1.5 rounded border border-border text-muted-foreground hover:text-destructive hover:border-destructive/50 transition-colors">
              <LogOut className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </header>

      {/* ── Body ──────────────────────────────────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden">

        {/* ── Left Sidebar ──────────────────────────────────────────────────── */}
        <div className="w-52 shrink-0 border-r border-border bg-card flex flex-col overflow-hidden">
          {/* Pipeline section */}
          <div className="shrink-0 p-3 border-b border-border">
            <div className="flex items-center gap-1.5 mb-2.5">
              <Layers className="h-3 w-3 text-muted-foreground" />
              <p className="text-xs text-muted-foreground font-bold tracking-wider">PIPELINE</p>
            </div>
            <div className="space-y-0.5">
              {PIPELINE.map((agent) => {
                const isActive = (sessionInfo?.status === "running" && sessionInfo?.currentAgent === agent) || (isRunning && currentAgent === agent);
                const isDone = sessionInfo && sessionInfo.status !== "completed"
                  ? PIPELINE.indexOf(agent) < PIPELINE.indexOf(currentPhase)
                  : sessionInfo?.status === "completed";
                const isNext = !isRunning && sessionInfo && currentPhase === agent && sessionInfo.status !== "completed";
                return (
                  <div key={agent} className={`flex items-center gap-2 px-2 py-1.5 rounded-md text-xs transition-all ${isActive ? "bg-primary/10 border border-primary/20" : "border border-transparent"}`}>
                    <div className={`w-4 h-4 rounded flex items-center justify-center text-xs font-bold shrink-0 ${AGENT_COLORS[agent]} ${isActive ? "animate-pulse" : ""}`}
                      style={{ background: isActive ? "currentColor" : "transparent", border: "1px solid currentColor", color: isActive ? "var(--background)" : "inherit" }}>
                      {AGENT_ICONS[agent]}
                    </div>
                    <span className={`flex-1 ${AGENT_COLORS[agent]} ${isActive ? "font-bold" : isDone ? "opacity-50 line-through" : "opacity-70"}`}>{agent}</span>
                    {isDone && <CheckCircle className="h-3 w-3 text-green-400 shrink-0" />}
                    {isNext && !isActive && <ChevronRight className="h-3 w-3 text-amber-400 shrink-0" />}
                    {isActive && <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse shrink-0" />}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Task list (when planner has run) */}
          {plannerTasks.length > 0 && (
            <div className="shrink-0 p-3 border-b border-border">
              <div className="flex items-center gap-1.5 mb-2">
                <CheckSquare className="h-3 w-3 text-muted-foreground" />
                <p className="text-xs text-muted-foreground font-bold tracking-wider">TASKS</p>
                <span className="ml-auto text-xs text-muted-foreground">{taskIndex}/{plannerTasks.length}</span>
              </div>
              <div className="space-y-1">
                {plannerTasks.map((t, i) => (
                  <div key={t.id} className={`flex items-start gap-1.5 px-1.5 py-1 rounded text-xs ${i < taskIndex ? "opacity-40" : i === taskIndex ? "bg-primary/10 border border-primary/20" : "opacity-60"}`}>
                    <div className={`w-3.5 h-3.5 rounded-full shrink-0 mt-0.5 flex items-center justify-center ${i < taskIndex ? "bg-green-400" : i === taskIndex ? "bg-primary animate-pulse" : "bg-muted border border-border"}`}>
                      {i < taskIndex && <CheckCircle className="h-2.5 w-2.5 text-background" />}
                    </div>
                    <span className={`leading-tight ${i === taskIndex ? "text-foreground font-medium" : "text-muted-foreground"}`}>{t.title}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Sessions list — scrollable */}
          <div className="flex-1 overflow-y-auto p-2 min-h-0">
            <div className="flex items-center gap-1.5 mb-2 px-1">
              <Clock className="h-3 w-3 text-muted-foreground" />
              <p className="text-xs text-muted-foreground font-bold tracking-wider">SESSIONS</p>
            </div>
            <div className="space-y-1">
              {sessions.map((s) => (
                <button
                  key={s._id}
                  onClick={() => handleSelectSession(s._id)}
                  className={`w-full text-left px-2 py-2 rounded-md text-xs transition-all ${activeSessionId === s._id ? "bg-primary/15 border border-primary/30 text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground border border-transparent"}`}
                >
                  <div className="truncate font-bold mb-0.5">{s.title}</div>
                  <div className="flex items-center gap-1.5">
                    <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${s.status === "completed" ? "bg-green-400" : s.status === "running" ? "bg-primary animate-pulse" : "bg-muted-foreground"}`} />
                    <span className="opacity-60 truncate">{s.phase}</span>
                  </div>
                </button>
              ))}
              {sessions.length === 0 && (
                <p className="text-xs text-muted-foreground px-2 py-4 text-center opacity-50">No sessions yet</p>
              )}
            </div>
          </div>

          {/* New session input */}
          <div className="shrink-0 p-2 border-t border-border bg-card">
            <textarea
              value={task}
              onChange={(e) => setTask(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleCreateSession(); } }}
              placeholder="Describe your task..."
              className="w-full bg-background border border-border rounded-md px-2 py-1.5 text-xs text-foreground placeholder:text-muted-foreground resize-none focus:outline-none focus:border-primary transition-colors"
              rows={2}
            />
            <button
              onClick={handleCreateSession}
              disabled={!task.trim() || isRunning}
              className="w-full mt-1.5 py-1.5 bg-primary text-primary-foreground text-xs rounded-md hover:bg-primary/90 disabled:opacity-50 transition-colors font-bold flex items-center justify-center gap-1.5"
            >
              {isRunning ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
              {isRunning ? "RUNNING..." : "NEW SESSION"}
            </button>
          </div>
        </div>

        {/* ── Main Content ───────────────────────────────────────────────────── */}
        {!activeSessionId ? (
          <div className="flex-1 flex items-center justify-center bg-background">
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="text-center max-w-sm px-6">
              <div className="w-16 h-16 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center mx-auto mb-4">
                <Users className="h-8 w-8 text-primary/40" />
              </div>
              <p className="text-sm font-bold text-foreground mb-2">No Session Selected</p>
              <p className="text-xs text-muted-foreground">Create a new task or select an existing session from the sidebar</p>
            </motion.div>
          </div>
        ) : (
          <div className="flex-1 flex flex-col overflow-hidden min-w-0">
            {/* ── Tab Header (fixed, never scrolls) ─────────────────────────── */}
            <div className="shrink-0 border-b border-border bg-card/80 backdrop-blur-sm z-10">
              <div className="flex items-center justify-between px-3 h-10">
                {/* Tabs */}
                <div className="flex items-center gap-0.5">
                  {(["chat", "files", "sandbox", "preview"] as const).map((tab) => (
                    <button
                      key={tab}
                      onClick={() => setActiveTab(tab)}
                      className={`px-3 py-1.5 text-xs font-bold rounded-md transition-all ${activeTab === tab ? "bg-primary/15 text-primary border border-primary/30" : "text-muted-foreground hover:text-foreground hover:bg-muted"}`}
                    >
                      {tab === "chat" && <span className="flex items-center gap-1.5"><Terminal className="h-3 w-3" />CHAT</span>}
                      {tab === "files" && <span className="flex items-center gap-1.5"><FileCode className="h-3 w-3" />FILES {projectFiles.length > 0 && <span className="bg-primary/20 text-primary px-1 rounded text-xs">{projectFiles.length}</span>}</span>}
                      {tab === "sandbox" && <span className="flex items-center gap-1.5"><Box className="h-3 w-3" />SANDBOX</span>}
                      {tab === "preview" && <span className="flex items-center gap-1.5"><Globe className="h-3 w-3" />PREVIEW</span>}
                    </button>
                  ))}
                </div>
                {/* Controls */}
                <div className="flex items-center gap-1.5">
                  {sessionInfo?.status !== "completed" && (
                    <>
                      {autoRun ? (
                        <button onClick={handleStopAutoRun} className="flex items-center gap-1.5 px-2.5 py-1 bg-red-400/10 border border-red-400/30 text-red-400 text-xs rounded-md hover:bg-red-400/20 transition-colors font-bold">
                          <Square className="h-3 w-3" />STOP
                        </button>
                      ) : (
                        <button onClick={handleAutoRun} disabled={isRunning} className="flex items-center gap-1.5 px-2.5 py-1 bg-primary/10 border border-primary/30 text-primary text-xs rounded-md hover:bg-primary/20 disabled:opacity-50 transition-colors font-bold">
                          {isRunning ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
                          {isRunning ? "RUNNING" : "AUTO RUN"}
                        </button>
                      )}
                      <button onClick={() => handleRunNextAgent()} disabled={isRunning || autoRun} className="flex items-center gap-1 px-2.5 py-1 bg-muted border border-border text-muted-foreground text-xs rounded-md hover:bg-muted/80 disabled:opacity-50 transition-colors">
                        <RefreshCw className="h-3 w-3" />STEP
                      </button>
                    </>
                  )}
                </div>
              </div>
            </div>

            {/* ── Tab Content ───────────────────────────────────────────────── */}
            <div className="flex-1 overflow-hidden min-h-0">

              {/* CHAT TAB */}
              {activeTab === "chat" && (
                <div className="h-full flex flex-col overflow-hidden">
                  {/* Messages — own scrollbar */}
                  <div className="flex-1 overflow-y-auto min-h-0 p-4">
                    <div className="space-y-4 max-w-4xl mx-auto">
                      {/* Session banner */}
                      {sessionInfo && (
                        <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}
                          className="bg-card border border-border rounded-xl p-3 text-xs">
                          <p className="font-bold text-foreground mb-1 truncate">{sessionInfo.task}</p>
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className={`font-bold ${execPhaseColor}`}>{execPhaseLabel}</span>
                            <span className="text-muted-foreground">•</span>
                            <span className="text-muted-foreground">8 agents</span>
                            <span className="text-muted-foreground">•</span>
                            <span className="text-muted-foreground">{totalMessages}/{MAX_MESSAGES} msgs</span>
                          </div>
                        </motion.div>
                      )}

                      {/* Messages */}
                      <AnimatePresence initial={false}>
                        {messages.map((msg) => (
                          <motion.div key={msg._id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex items-start gap-3">
                            <div className={`w-8 h-8 rounded-xl flex items-center justify-center text-xs font-bold shrink-0 border ${AGENT_BG[msg.agent] || "bg-muted/20 border-border"}`}>
                              <span className={AGENT_COLORS[msg.agent] || "text-foreground"}>{AGENT_ICONS[msg.agent] || msg.agent[0]}</span>
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-1">
                                <p className={`text-xs font-bold ${AGENT_COLORS[msg.agent] || "text-foreground"}`}>{msg.agent}</p>
                                {msg.round !== undefined && <span className="text-xs text-muted-foreground opacity-50">round {msg.round + 1}</span>}
                              </div>
                              <div className={`rounded-2xl rounded-tl-sm px-4 py-3 border ${AGENT_BG[msg.agent] || "bg-card border-border"}`}>
                                <div className="prose prose-sm max-w-none text-xs leading-relaxed text-foreground">
                                  <ReactMarkdown>{msg.content}</ReactMarkdown>
                                </div>
                              </div>
                            </div>
                          </motion.div>
                        ))}
                      </AnimatePresence>

                      {/* Live streaming output */}
                      {sessionInfo?.status === "running" && streamingAgent && streamingOutput && !streamingOutput.startsWith("[") && (
                        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex items-start gap-3">
                          <div className={`w-8 h-8 rounded-xl flex items-center justify-center text-xs font-bold shrink-0 border animate-pulse ${AGENT_BG[streamingAgent] || "bg-primary/10 border-primary/20"}`}>
                            <span className={AGENT_COLORS[streamingAgent] || "text-primary"}>{AGENT_ICONS[streamingAgent] || streamingAgent[0]}</span>
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                              <p className={`text-xs font-bold ${AGENT_COLORS[streamingAgent] || "text-primary"}`}>{streamingAgent}</p>
                              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                                <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />live
                              </span>
                            </div>
                            <div className={`rounded-2xl rounded-tl-sm px-4 py-3 border ${AGENT_BG[streamingAgent] || "bg-card border-border"}`}>
                              <div className="prose prose-sm max-w-none text-xs leading-relaxed text-foreground">
                                <ReactMarkdown>{streamingOutput}</ReactMarkdown>
                              </div>
                            </div>
                          </div>
                        </motion.div>
                      )}

                      {/* Thinking indicator */}
                      {sessionInfo?.status === "running" && streamingAgent && (!streamingOutput || streamingOutput.startsWith("[")) && (
                        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex items-start gap-3">
                          <div className={`w-8 h-8 rounded-xl flex items-center justify-center text-xs font-bold shrink-0 border animate-pulse ${AGENT_BG[streamingAgent] || "bg-primary/10 border-primary/20"}`}>
                            <span className={AGENT_COLORS[streamingAgent] || "text-primary"}>{AGENT_ICONS[streamingAgent] || "?"}</span>
                          </div>
                          <div className={`rounded-2xl rounded-tl-sm px-4 py-3 border ${AGENT_BG[streamingAgent] || "bg-card border-border"}`}>
                            <div className="flex items-center gap-2 text-xs text-muted-foreground">
                              <Loader2 className="h-3 w-3 animate-spin" />
                              <span>{streamingAgent} is thinking...</span>
                              {streamingOutput && <span className="opacity-60">{streamingOutput}</span>}
                            </div>
                          </div>
                        </motion.div>
                      )}

                      <div ref={messagesEndRef} />
                    </div>
                  </div>

                  {/* Continue session input */}
                  {sessionInfo?.status === "completed" && (
                    <div className="shrink-0 p-3 border-t border-border bg-card">
                      <p className="text-xs text-green-400 font-bold mb-2 flex items-center gap-1.5">
                        <CheckCircle className="h-3 w-3" />Session complete — start a new task:
                      </p>
                      <div className="flex gap-2">
                        <input
                          value={newTask}
                          onChange={(e) => setNewTask(e.target.value)}
                          onKeyDown={(e) => { if (e.key === "Enter") handleContinueSession(); }}
                          placeholder="Next task..."
                          className="flex-1 bg-background border border-border rounded-lg px-3 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary transition-colors"
                        />
                        <button
                          onClick={handleContinueSession}
                          disabled={!newTask.trim() || isContinuing}
                          className="px-3 py-1.5 bg-primary text-primary-foreground text-xs rounded-lg hover:bg-primary/90 disabled:opacity-50 transition-colors font-bold flex items-center gap-1"
                        >
                          {isContinuing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* FILES TAB */}
              {activeTab === "files" && (
                <div className="h-full flex overflow-hidden">
                  {/* File list — own scrollbar */}
                  <div className="w-52 shrink-0 border-r border-border overflow-y-auto">
                    <div className="p-2">
                      <p className="text-xs text-muted-foreground font-bold px-2 py-1.5 tracking-wider">PROJECT FILES</p>
                      {projectFiles.length === 0 ? (
                        <p className="text-xs text-muted-foreground px-2 py-4 text-center opacity-50">No files yet</p>
                      ) : (
                        <div className="space-y-0.5">
                          {projectFiles.map((f) => (
                            <button
                              key={f.filepath}
                              onClick={() => setSelectedFile(f)}
                              className={`w-full text-left px-2 py-1.5 rounded-md text-xs transition-all ${selectedFile?.filepath === f.filepath ? "bg-primary/15 border border-primary/30 text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground border border-transparent"}`}
                            >
                              <div className="truncate font-mono">{f.filepath}</div>
                              <div className={`text-xs mt-0.5 ${AGENT_COLORS[f.lastModifiedBy] || "text-muted-foreground"} opacity-70`}>{f.lastModifiedBy}</div>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                  {/* File content — own scrollbar */}
                  <div className="flex-1 overflow-y-auto min-w-0">
                    {selectedFile ? (
                      <div className="p-4">
                        <div className="flex items-center gap-2 mb-3 pb-2 border-b border-border">
                          <FileCode className="h-4 w-4 text-primary" />
                          <span className="text-xs font-bold text-foreground font-mono">{selectedFile.filepath}</span>
                          <span className={`ml-auto text-xs ${AGENT_COLORS[selectedFile.lastModifiedBy] || "text-muted-foreground"}`}>by {selectedFile.lastModifiedBy}</span>
                        </div>
                        <pre className="text-xs text-foreground leading-relaxed whitespace-pre-wrap break-all font-mono bg-muted/30 rounded-xl p-4 border border-border">
                          {selectedFile.content}
                        </pre>
                      </div>
                    ) : (
                      <div className="h-full flex items-center justify-center">
                        <div className="text-center">
                          <FileCode className="h-10 w-10 text-muted-foreground/20 mx-auto mb-3" />
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
                  <div className="shrink-0 px-4 py-2 border-b border-border bg-card flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Box className="h-3.5 w-3.5 text-amber-400" />
                      <span className="text-xs font-bold text-amber-400">SANDBOX CONSOLE</span>
                      {activeSandbox && (
                        <span className={`text-xs px-1.5 py-0.5 rounded border ${activeSandbox.status === "running" ? "bg-green-400/10 border-green-400/30 text-green-400" : "bg-muted border-border text-muted-foreground"}`}>
                          {activeSandbox.status}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5">
                      {activeSandboxId && (
                        <>
                          <button onClick={handleGetPreviewUrl} disabled={isSandboxLoading} className="text-xs text-muted-foreground hover:text-foreground border border-border px-2 py-1 rounded-md transition-colors">
                            {isSandboxLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : "Preview"}
                          </button>
                          <button onClick={handleTestFileWrite} disabled={isSandboxLoading} className="text-xs text-muted-foreground hover:text-foreground border border-border px-2 py-1 rounded-md transition-colors">
                            Test Write
                          </button>
                          {activeSessionId && (
                            <button onClick={handleAutoDeployAndStart} disabled={isSandboxLoading || projectFiles.length === 0} className="text-xs text-primary border border-primary/30 px-2 py-1 rounded-md hover:bg-primary/10 disabled:opacity-50 transition-colors font-bold">
                              Deploy
                            </button>
                          )}
                          <button onClick={() => handleStopSandbox(activeSandboxId)} disabled={isSandboxLoading} className="text-xs text-red-400 border border-red-400/30 px-2 py-1 rounded-md hover:bg-red-400/10 disabled:opacity-50 transition-colors">
                            Stop
                          </button>
                        </>
                      )}
                    </div>
                  </div>

                  {activeSandboxId ? (
                    <>
                      {/* Terminal output — own scrollbar */}
                      <div className="flex-1 overflow-y-auto min-h-0 p-3 bg-background font-mono text-xs">
                        {sandboxOutput.length === 0 ? (
                          <p className="text-muted-foreground opacity-50">$ ready for commands...</p>
                        ) : (
                          sandboxOutput.map((entry, i) => (
                            <div key={i} className="mb-3">
                              <div className="flex items-center gap-2 text-amber-400 mb-1">
                                <span className="opacity-60">$</span>
                                <span className="font-bold">{entry.cmd}</span>
                                {entry.code !== 0 && <span className="text-red-400 text-xs">[exit {entry.code}]</span>}
                              </div>
                              <pre className={`whitespace-pre-wrap break-all pl-3 border-l-2 ${entry.code === 0 ? "border-green-400/30 text-foreground" : "border-red-400/30 text-red-400"}`}>
                                {entry.out || "(no output)"}
                              </pre>
                            </div>
                          ))
                        )}
                        <div ref={sandboxOutputEndRef} />
                      </div>

                      {/* Command input */}
                      <div className="shrink-0 p-3 border-t border-border bg-card">
                        <div className="flex gap-2">
                          <div className="flex items-center gap-2 flex-1 bg-background border border-border rounded-lg px-3 py-1.5 focus-within:border-amber-400/50 transition-colors">
                            <span className="text-amber-400 text-xs font-bold shrink-0">$</span>
                            <input
                              value={sandboxCommand}
                              onChange={(e) => setSandboxCommand(e.target.value)}
                              onKeyDown={(e) => { if (e.key === "Enter") handleExecuteCommand(); }}
                              placeholder="Enter command..."
                              className="flex-1 bg-transparent text-xs text-foreground placeholder:text-muted-foreground focus:outline-none font-mono"
                            />
                          </div>
                          <button
                            onClick={handleExecuteCommand}
                            disabled={!sandboxCommand.trim() || isSandboxLoading}
                            className="px-3 py-1.5 bg-amber-400/10 border border-amber-400/30 text-amber-400 text-xs rounded-lg hover:bg-amber-400/20 disabled:opacity-50 transition-colors font-bold"
                          >
                            {isSandboxLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : "RUN"}
                          </button>
                        </div>
                      </div>
                    </>
                  ) : (
                    <div className="flex-1 flex flex-col items-center justify-center gap-4 p-8">
                      <div className="w-16 h-16 rounded-2xl bg-amber-400/10 border border-amber-400/20 flex items-center justify-center">
                        <Box className="h-8 w-8 text-amber-400/40" />
                      </div>
                      <div className="text-center">
                        <p className="text-sm font-bold text-foreground mb-1">No Active Sandbox</p>
                        <p className="text-xs text-muted-foreground mb-4">Create a sandbox to execute commands in an isolated environment</p>
                        <button
                          onClick={handleCreateSandbox}
                          disabled={isSandboxLoading}
                          className="flex items-center gap-2 px-4 py-2 bg-amber-400/10 border border-amber-400/30 text-amber-400 text-sm rounded-xl hover:bg-amber-400/20 disabled:opacity-50 transition-colors font-bold mx-auto"
                        >
                          {isSandboxLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                          CREATE SANDBOX
                        </button>
                        <p className="text-xs text-muted-foreground mt-2 opacity-60">1 vCPU • $0.075/hr</p>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* PREVIEW TAB */}
              {activeTab === "preview" && (
                <div className="h-full flex flex-col overflow-hidden">
                  <div className="shrink-0 px-4 py-2 border-b border-border bg-card flex items-center justify-between">
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
                        <button onClick={handleGetPreviewUrl} disabled={isSandboxLoading} className="text-xs text-muted-foreground hover:text-foreground border border-border px-2 py-1 rounded-md transition-colors">
                          {isSandboxLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : "Refresh"}
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="flex-1 overflow-y-auto flex flex-col items-center justify-center gap-6 p-8 bg-background">
                    {previewUrl ? (
                      <div className="text-center max-w-md">
                        <div className="w-16 h-16 rounded-2xl bg-green-400/10 border border-green-400/20 flex items-center justify-center mx-auto mb-4">
                          <Globe className="h-8 w-8 text-green-400/60" />
                        </div>
                        <p className="text-sm font-bold text-foreground mb-2">Preview Ready</p>
                        <p className="text-xs text-muted-foreground mb-4">Your app is running in the Daytona sandbox.</p>
                        <div className="bg-card border border-border rounded-xl p-3 mb-4 text-left">
                          <p className="text-xs text-muted-foreground mb-1">Preview URL:</p>
                          <p className="text-xs text-primary font-mono break-all">{previewUrl}</p>
                        </div>
                        <a href={previewUrl} target="_blank" rel="noopener noreferrer"
                          className="inline-flex items-center gap-2 bg-primary text-primary-foreground px-6 py-2.5 rounded-xl text-sm font-bold hover:bg-primary/90 transition-colors">
                          <ExternalLink className="h-4 w-4" />Open Preview in New Tab
                        </a>
                      </div>
                    ) : (
                      <div className="text-center max-w-sm">
                        <div className="w-16 h-16 rounded-2xl bg-muted/50 border border-border flex items-center justify-center mx-auto mb-4">
                          <Monitor className="h-8 w-8 text-muted-foreground/30" />
                        </div>
                        <p className="text-sm font-bold text-foreground mb-1">No Preview Available</p>
                        <p className="text-xs text-muted-foreground mb-4">Deploy your project and start the app to see a live preview</p>
                        {activeSandboxId && activeSessionId && (
                          <button onClick={handleAutoDeployAndStart} disabled={isSandboxLoading || projectFiles.length === 0}
                            className="flex items-center gap-2 px-4 py-2 bg-primary/10 border border-primary/30 text-primary text-sm rounded-xl hover:bg-primary/20 disabled:opacity-50 transition-colors font-bold mx-auto">
                            {isSandboxLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Globe className="h-4 w-4" />}
                            DEPLOY & START APP
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )}

            </div>
          </div>
        )}
      </div>
    </div>
  );
}