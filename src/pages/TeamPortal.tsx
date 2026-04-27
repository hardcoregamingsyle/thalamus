import { useAuth } from "@/hooks/use-auth";
import { useEffect, useState, useRef, useCallback } from "react";
import { useNavigate } from "react-router";
import { motion, AnimatePresence } from "framer-motion";
import { api } from "@/convex/_generated/api";
import { useAction, useQuery } from "convex/react";
import { Id } from "@/convex/_generated/dataModel";
import { toast } from "sonner";
import {
  Loader2,
  LogOut,
  Plus,
  Users,
  ArrowLeft,
  RefreshCw,
  CheckCircle,
  Terminal,
  Box,
  Trash2,
  Globe,
  ExternalLink,
  Play,
  Square,
  Send,
  FileCode,
  Monitor,
} from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import ReactMarkdown from "react-markdown";

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
  Researcher: "bg-cyan-400/10 border-cyan-400/20",
  Analyser: "bg-blue-400/10 border-blue-400/20",
  Planner: "bg-violet-400/10 border-violet-400/20",
  Coder: "bg-emerald-400/10 border-emerald-400/20",
  Optimiser: "bg-amber-400/10 border-amber-400/20",
  Tester: "bg-green-400/10 border-green-400/20",
  Hacker: "bg-red-400/10 border-red-400/20",
  Critic: "bg-purple-400/10 border-purple-400/20",
};

const AGENT_ICONS: Record<string, string> = {
  Researcher: "🔍",
  Analyser: "A",
  Planner: "P",
  Coder: "C",
  Optimiser: "O",
  Tester: "T",
  Hacker: "H",
  Critic: "R",
};

const PIPELINE = ["Researcher", "Analyser", "Planner", "Coder", "Optimiser", "Tester", "Hacker", "Critic"];
const MAX_MESSAGES = 600;

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
  const sandboxOutputRef = useRef<HTMLDivElement>(null);

  // Reactive queries — live updates from Convex
  const liveSession = useQuery(
    api.agentTeamHelpers.watchSession,
    activeSessionId ? { sessionId: activeSessionId } : "skip"
  );
  const liveMessages = useQuery(
    api.agentTeamHelpers.watchMessages,
    activeSessionId ? { sessionId: activeSessionId } : "skip"
  );
  const liveFiles = useQuery(
    api.agentTeamHelpers.watchFiles,
    activeSessionId ? { sessionId: activeSessionId } : "skip"
  );

  // Derive state from reactive queries
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
    _id: m._id as string,
    agent: m.agent,
    content: m.content,
    round: m.round,
    messageIndex: m.messageIndex,
  }));

  const projectFiles: ProjectFile[] = (liveFiles ?? []).map((f) => ({
    filepath: f.filepath,
    content: f.content,
    lastModifiedBy: f.lastModifiedBy,
  }));

  const createSession = useAction(api.agentTeam.createSession);
  const runAgentRound = useAction(api.agentTeam.runAgentRound);
  const listSessionsAction = useAction(api.agentTeam.listSessions);
  const continueSessionAction = useAction(api.agentTeam.continueSession);

  const createSandboxAction = useAction(api.sandbox.createSandbox);
  const executeCommandAction = useAction(api.sandbox.executeCommand);
  const stopSandboxAction = useAction(api.sandbox.stopSandbox);
  const listSandboxesAction = useAction(api.sandbox.listSandboxes);
  const deployProjectFilesAction = useAction(api.sandbox.deployProjectFiles);
  const getPreviewUrlAction = useAction(api.sandbox.getPreviewUrl);
  const autoDeployAndStartAction = useAction(api.sandbox.autoDeployAndStart);
  const testFileWriteAction = useAction(api.sandbox.testFileWrite);

  useEffect(() => {
    if (!isLoading && !isAuthenticated) navigate("/auth");
  }, [isLoading, isAuthenticated, navigate]);

  useEffect(() => {
    if (token) { loadSessions(); loadSandboxes(); }
  }, [token]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    sandboxOutputRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [sandboxOutput]);

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

  const handleSelectSession = async (sessionId: Id<"teamSessions">) => {
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
            if (deployResult.previewUrl) {
              setPreviewUrl(deployResult.previewUrl);
              toast.success(`Deployed ${deployResult.deployedFiles} files → Preview ready`);
            }
          } catch { /* auto-deploy is best-effort */ }
        }
      }

      if (result.done) {
        toast.success("🎉 Project complete!");
        autoRunRef.current = false;
        setAutoRun(false);
      } else if ((result.nextAgent === "Researcher" || result.nextAgent === "Analyser") && result.loopCount > 0) {
        toast.warning(`Loop ${result.loopCount}: Restarting from ${result.nextAgent}...`);
      }
      return result;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Agent failed";
      agentRetryCountRef.current += 1;
      if (agentRetryCountRef.current <= MAX_AGENT_RETRIES && autoRunRef.current) {
        const retryDelay = Math.min(3000 * agentRetryCountRef.current, 15000);
        toast.warning(`Retrying agent (${agentRetryCountRef.current}/${MAX_AGENT_RETRIES})... ${msg.slice(0, 60)}`);
        setIsRunning(false);
        setCurrentAgent(null);
        setTimeout(() => { if (autoRunRef.current) handleRunNextAgent(sid); }, retryDelay);
        return;
      }
      toast.error(`Agent failed after ${MAX_AGENT_RETRIES} retries: ${msg}`);
      agentRetryCountRef.current = 0;
      autoRunRef.current = false;
      setAutoRun(false);
    } finally {
      setIsRunning(false);
      setCurrentAgent(null);
    }
  }, [activeSessionId, token, isRunning, runAgentRound, loadSessions, activeSandboxId, activeSandbox, autoDeployAndStartAction]);

  useEffect(() => {
    if (!autoRun || isRunning || !activeSessionId) return;
    if (sessionInfo) {
      if (sessionInfo.status === "completed" || sessionInfo.totalMessages >= MAX_MESSAGES) {
        setAutoRun(false); autoRunRef.current = false; return;
      }
    }
    const timer = setTimeout(() => { if (autoRunRef.current) handleRunNextAgent(); }, 800);
    return () => clearTimeout(timer);
  }, [autoRun, isRunning, sessionInfo, activeSessionId, handleRunNextAgent]);

  const handleAutoRun = () => {
    if (!activeSessionId || !token) return;
    autoRunRef.current = true;
    setAutoRun(true);
    handleRunNextAgent();
  };

  const handleStopAutoRun = () => { autoRunRef.current = false; setAutoRun(false); };

  // Sandbox handlers
  const handleCreateSandbox = async () => {
    if (!token) return;
    setIsSandboxLoading(true);
    try {
      const result = await createSandboxAction({
        token,
        label: activeSessionId ? `session-${activeSessionId.slice(-6)}` : "manual",
        sessionId: activeSessionId ?? undefined,
      });
      const newId = result.sandboxDbId as Id<"sandboxes">;
      setActiveSandboxId(newId);
      setSandboxOutput([]);
      await loadSandboxes();
      toast.success("Sandbox created! (1 vCPU, $0.075/hr)");
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to create sandbox");
    } finally { setIsSandboxLoading(false); }
  };

  const handleExecuteCommand = async () => {
    if (!sandboxCommand.trim() || !activeSandboxId || !token) return;
    const cmd = sandboxCommand.trim();
    setSandboxCommand("");
    setIsSandboxLoading(true);
    try {
      const result = await executeCommandAction({ token, sandboxDbId: activeSandboxId, command: cmd });
      setSandboxOutput((prev) => [...prev, { cmd, out: result.output, code: result.exitCode }]);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Command failed");
    } finally { setIsSandboxLoading(false); }
  };

  const handleGetPreviewUrl = async () => {
    if (!activeSandboxId || !token) return;
    setIsSandboxLoading(true);
    try {
      const result = await getPreviewUrlAction({ token, sandboxDbId: activeSandboxId });
      if (result.previewUrl) {
        setPreviewUrl(result.previewUrl);
        setActiveTab("preview");
        toast.success("Preview URL obtained!");
      } else {
        toast.error("No preview URL available (is the app running on port 3000?)");
      }
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to get preview URL");
    } finally { setIsSandboxLoading(false); }
  };

  const handleAutoDeployAndStart = async () => {
    if (!activeSandboxId || !activeSessionId || !token) return;
    setIsSandboxLoading(true);
    try {
      const result = await autoDeployAndStartAction({ token, sandboxDbId: activeSandboxId, sessionId: activeSessionId });
      if (result.errors && result.errors.length > 0) {
        setSandboxOutput(prev => [...prev, {
          cmd: "DEPLOY",
          out: `Deployed ${result.deployedFiles} files with ${result.errors.length} error(s):\n${result.errors.slice(0, 5).join("\n")}`,
          code: 1,
        }]);
        toast.warning(`Deploy: ${result.deployedFiles} files, ${result.errors.length} errors`);
      }
      if (result.previewUrl) {
        setPreviewUrl(result.previewUrl);
        setActiveTab("preview");
        toast.success(`Deployed ${result.deployedFiles} files → Preview ready!`);
      } else {
        toast.success(`Deployed ${result.deployedFiles} files. App starting...`);
      }
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Deploy failed");
    } finally { setIsSandboxLoading(false); }
  };

  const handleTestFileWrite = async () => {
    if (!activeSandboxId || !token) return;
    setIsSandboxLoading(true);
    try {
      const result = await testFileWriteAction({ token, sandboxDbId: activeSandboxId });
      if (result.success) {
        toast.success(`✓ File write OK`);
      } else {
        toast.error(`✗ File write FAILED`);
      }
      setSandboxOutput(prev => [...prev, { cmd: "TEST WRITE", out: result.output, code: result.success ? 0 : 1 }]);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Test failed");
    } finally { setIsSandboxLoading(false); }
  };

  const handleStopSandbox = async (sandboxDbId: Id<"sandboxes">) => {
    if (!token) return;
    setIsSandboxLoading(true);
    try {
      const result = await stopSandboxAction({ token, sandboxDbId });
      if (activeSandboxId === sandboxDbId) { setActiveSandboxId(null); setActiveSandbox(null); setPreviewUrl(null); }
      await loadSandboxes();
      toast.success(`Sandbox stopped. Cost: $${(result.costCents / 100).toFixed(4)}`);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to stop sandbox");
    } finally { setIsSandboxLoading(false); }
  };

  const currentPhase = sessionInfo?.phase ?? "Researcher";
  const totalMessages = sessionInfo?.totalMessages ?? 0;
  const loopCount = sessionInfo?.loopCount ?? 0;

  // Streaming output: show currentAgentOutput while running
  const streamingAgent = sessionInfo?.currentAgent ?? currentAgent;
  const streamingOutput = sessionInfo?.currentAgentOutput ?? "";

  // Execution phase display
  const execPhase = sessionInfo?.executionPhase ?? "planning";
  const taskIndex = sessionInfo?.currentTaskIndex ?? 0;
  let plannerTasks: Array<{ id: string; title: string; description: string; subpart: boolean }> = [];
  try {
    if (sessionInfo?.plannerTasksJson) plannerTasks = JSON.parse(sessionInfo.plannerTasksJson);
  } catch { /* ignore */ }

  const execPhaseLabel = execPhase === "planning" ? "📋 PLANNING" : execPhase === "final_review" ? "🔍 FINAL REVIEW" : `⚙️ TASK ${taskIndex + 1}/${plannerTasks.length || "?"}`;

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-primary font-mono text-sm animate-pulse">INITIALIZING AGENT_TEAM...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-background font-mono">
      {/* Header */}
      <header className="border-b border-border bg-card flex items-center justify-between px-4 h-12 shrink-0">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate("/portal")} className="text-muted-foreground hover:text-primary transition-colors">
            <ArrowLeft className="h-4 w-4" />
          </button>
          <Users className="h-4 w-4 text-primary" />
          <span className="text-primary font-bold text-sm tracking-widest">AGENT_TEAM</span>
        </div>
        <div className="flex items-center gap-3">
          {sessionInfo && (
            <div className="hidden sm:flex items-center gap-2 text-xs">
              <span className="text-cyan-400 font-bold">{execPhaseLabel}</span>
              <span className="text-amber-400 font-bold">{totalMessages}/{MAX_MESSAGES}</span>
              {loopCount > 0 && <span className="text-red-400">loop {loopCount}</span>}
              <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${sessionInfo.status === "completed" ? "bg-green-400/20 text-green-400" : sessionInfo.status === "running" ? "bg-primary/20 text-primary animate-pulse" : "bg-muted text-muted-foreground"}`}>
                {sessionInfo.status.toUpperCase()}
              </span>
            </div>
          )}
          <span className="text-xs text-muted-foreground hidden sm:block truncate max-w-[120px]">{user?.email || "guest"}</span>
          <button onClick={() => signOut()} className="text-muted-foreground hover:text-destructive transition-colors">
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <div className="w-48 border-r border-border bg-card flex flex-col shrink-0">
          {/* Pipeline */}
          <div className="p-3 border-b border-border">
            <p className="text-xs text-muted-foreground mb-2 font-bold">PIPELINE</p>
            <div className="space-y-1">
              {PIPELINE.map((agent) => {
                const isActive = currentAgent === agent || (isRunning && sessionInfo?.phase === agent) || (sessionInfo?.status === "running" && sessionInfo?.currentAgent === agent);
                const isNext = !isRunning && sessionInfo && currentPhase === agent && sessionInfo.status !== "completed";
                const isDone = sessionInfo && sessionInfo.status !== "completed"
                  ? PIPELINE.indexOf(agent) < PIPELINE.indexOf(currentPhase)
                  : sessionInfo?.status === "completed";
                return (
                  <div key={agent} className={`flex items-center gap-2 px-2 py-1 rounded text-xs transition-all ${isActive ? "bg-primary/10" : ""}`}>
                    <span className={`w-5 h-5 rounded flex items-center justify-center text-xs font-bold ${AGENT_COLORS[agent]} ${isActive ? "animate-pulse" : ""}`} style={{ border: "1px solid currentColor" }}>
                      {AGENT_ICONS[agent]}
                    </span>
                    <span className={`${AGENT_COLORS[agent]} ${isActive ? "font-bold" : "opacity-70"} flex-1`}>{agent}</span>
                    {isDone && <CheckCircle className="h-3 w-3 text-green-400" />}
                    {isNext && !isActive && <span className="text-amber-400 text-xs">→</span>}
                  </div>
                );
              })}
            </div>
            {/* Task list from Planner */}
            {plannerTasks.length > 0 && (
              <div className="mt-3">
                <p className="text-xs text-muted-foreground mb-1 font-bold">TASKS ({plannerTasks.length})</p>
                <div className="space-y-1">
                  {plannerTasks.map((t, i) => (
                    <div key={t.id} className={`flex items-start gap-1.5 px-1 py-1 rounded text-xs ${i === taskIndex && execPhase === "tasks" ? "bg-cyan-400/10" : ""}`}>
                      <span className={`shrink-0 w-4 h-4 rounded-full flex items-center justify-center text-xs font-bold mt-0.5 ${i < taskIndex || execPhase === "final_review" ? "bg-green-400/20 text-green-400" : i === taskIndex && execPhase === "tasks" ? "bg-cyan-400/20 text-cyan-400" : "bg-muted text-muted-foreground"}`}>
                        {i < taskIndex || execPhase === "final_review" ? "✓" : i + 1}
                      </span>
                      <span className={`flex-1 leading-tight ${i === taskIndex && execPhase === "tasks" ? "text-cyan-400 font-bold" : "text-muted-foreground"}`}>{t.title}</span>
                      {t.subpart && <span className="text-amber-400/60 text-xs shrink-0">sub</span>}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Sessions list */}
          <div className="flex-1 overflow-y-auto p-2">
            <p className="text-xs text-muted-foreground mb-2 font-bold px-1">SESSIONS</p>
            <div className="space-y-1">
              {sessions.map((s) => (
                <button
                  key={s._id}
                  onClick={() => handleSelectSession(s._id)}
                  className={`w-full text-left px-2 py-2 rounded text-xs transition-colors ${activeSessionId === s._id ? "bg-primary/20 text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}
                >
                  <div className="truncate font-bold">{s.title}</div>
                  <div className="flex items-center gap-1 mt-0.5">
                    <span className={`w-1.5 h-1.5 rounded-full ${s.status === "completed" ? "bg-green-400" : s.status === "running" ? "bg-primary animate-pulse" : "bg-muted-foreground"}`} />
                    <span className="opacity-60">{s.phase}</span>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* New session input */}
          <div className="p-2 border-t border-border">
            <textarea
              value={task}
              onChange={(e) => setTask(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleCreateSession(); } }}
              placeholder="New task..."
              className="w-full bg-background border border-border rounded px-2 py-1.5 text-xs text-foreground placeholder:text-muted-foreground resize-none focus:outline-none focus:border-primary"
              rows={2}
            />
            <button
              onClick={handleCreateSession}
              disabled={!task.trim() || isRunning}
              className="w-full mt-1 py-1.5 bg-primary/10 border border-primary/30 text-primary text-xs rounded hover:bg-primary/20 disabled:opacity-50 transition-colors font-bold"
            >
              {isRunning ? <Loader2 className="h-3 w-3 animate-spin mx-auto" /> : "START"}
            </button>
          </div>
        </div>

        {/* Main content */}
        {!activeSessionId ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <Users className="h-12 w-12 text-muted-foreground/20 mx-auto mb-4" />
              <p className="text-sm font-bold text-foreground mb-1">No Session Selected</p>
              <p className="text-xs text-muted-foreground">Create a new task or select an existing session</p>
            </div>
          </div>
        ) : (
          <>
            {/* Tab bar */}
            <div className="flex flex-col flex-1 overflow-hidden">
              <div className="flex items-center border-b border-border bg-card px-4 gap-1 shrink-0">
                {(["chat", "files", "sandbox", "preview"] as const).map((tab) => (
                  <button
                    key={tab}
                    onClick={() => setActiveTab(tab)}
                    className={`px-3 py-2 text-xs font-bold uppercase tracking-wider transition-colors border-b-2 ${activeTab === tab ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}
                  >
                    {tab === "files" ? `FILES (${projectFiles.length})` : tab.toUpperCase()}
                  </button>
                ))}
                <div className="ml-auto flex items-center gap-2">
                  {sessionInfo && sessionInfo.status !== "completed" && (
                    <>
                      {autoRun ? (
                        <button onClick={handleStopAutoRun} className="flex items-center gap-1 px-3 py-1 bg-red-400/10 border border-red-400/30 text-red-400 text-xs rounded hover:bg-red-400/20 transition-colors font-bold">
                          <Square className="h-3 w-3" />
                          STOP
                        </button>
                      ) : (
                        <button onClick={handleAutoRun} disabled={isRunning} className="flex items-center gap-1 px-3 py-1 bg-primary/10 border border-primary/30 text-primary text-xs rounded hover:bg-primary/20 disabled:opacity-50 transition-colors font-bold">
                          {isRunning ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
                          {isRunning ? "RUNNING" : "AUTO RUN"}
                        </button>
                      )}
                      <button onClick={() => handleRunNextAgent()} disabled={isRunning || autoRun} className="flex items-center gap-1 px-3 py-1 bg-muted border border-border text-muted-foreground text-xs rounded hover:bg-muted/80 disabled:opacity-50 transition-colors">
                        <RefreshCw className="h-3 w-3" />
                        STEP
                      </button>
                    </>
                  )}
                </div>
              </div>

              {/* Chat tab */}
              {activeTab === "chat" && (
                <div className="flex-1 flex flex-col overflow-hidden">
                  <ScrollArea className="flex-1 p-4">
                    <div className="space-y-4 max-w-4xl mx-auto">
                      {/* Session info banner */}
                      {sessionInfo && (
                        <div className="bg-card border border-border rounded-lg p-3 text-xs">
                          <p className="font-bold text-foreground mb-1 truncate">{sessionInfo.task}</p>
                          <p className="text-muted-foreground">{execPhaseLabel} • 8 agents: Researcher → Analyser → Planner → Coder → Optimiser → Tester → Hacker → Critic</p>
                        </div>
                      )}

                      {/* Messages */}
                      {messages.map((msg) => (
                        <motion.div
                          key={msg._id}
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          className="flex items-start gap-3"
                        >
                          <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0 border ${AGENT_COLORS[msg.agent] || "text-foreground"} ${AGENT_BG[msg.agent] || "bg-muted/20 border-border"}`}>
                            {AGENT_ICONS[msg.agent] || msg.agent[0]}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className={`text-xs font-bold mb-1 ${AGENT_COLORS[msg.agent] || "text-foreground"}`}>{msg.agent}</p>
                            <div className={`rounded-2xl rounded-tl-sm px-4 py-3 border shadow-sm ${AGENT_BG[msg.agent] || "bg-card border-border"}`}>
                              <div className="prose prose-sm prose-invert max-w-none text-xs leading-relaxed">
                                <ReactMarkdown>{msg.content}</ReactMarkdown>
                              </div>
                            </div>
                          </div>
                        </motion.div>
                      ))}

                      {/* Live streaming output */}
                      {sessionInfo?.status === "running" && streamingAgent && streamingOutput && (
                        <motion.div
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          className="flex items-start gap-3"
                        >
                          <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0 border animate-pulse ${AGENT_COLORS[streamingAgent] || "text-primary"} ${AGENT_BG[streamingAgent] || "bg-primary/10 border-primary/20"}`}>
                            {AGENT_ICONS[streamingAgent] || streamingAgent[0]}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className={`text-xs font-bold mb-1 ${AGENT_COLORS[streamingAgent] || "text-primary"}`}>
                              {streamingAgent} <span className="text-muted-foreground font-normal animate-pulse">● live</span>
                            </p>
                            <div className={`rounded-2xl rounded-tl-sm px-4 py-3 border shadow-sm ${AGENT_BG[streamingAgent] || "bg-card border-border"}`}>
                              <div className="prose prose-sm prose-invert max-w-none text-xs leading-relaxed">
                                <ReactMarkdown>{streamingOutput}</ReactMarkdown>
                              </div>
                            </div>
                          </div>
                        </motion.div>
                      )}

                      {/* Thinking indicator (before output arrives) */}
                      {sessionInfo?.status === "running" && streamingAgent && !streamingOutput && (
                        <motion.div
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          className="flex items-start gap-3"
                        >
                          <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0 border animate-pulse ${AGENT_COLORS[streamingAgent] || "text-primary"} ${AGENT_BG[streamingAgent] || "bg-primary/10 border-primary/20"}`}>
                            {AGENT_ICONS[streamingAgent] || "?"}
                          </div>
                          <div className={`rounded-2xl rounded-tl-sm px-4 py-3 border ${AGENT_BG[streamingAgent] || "bg-card border-border"}`}>
                            <div className="flex items-center gap-2 text-xs text-muted-foreground">
                              <Loader2 className="h-3 w-3 animate-spin" />
                              <span>{streamingAgent} is thinking...</span>
                            </div>
                          </div>
                        </motion.div>
                      )}

                      <div ref={messagesEndRef} />
                    </div>
                  </ScrollArea>

                  {/* Continue session input */}
                  {sessionInfo?.status === "completed" && (
                    <div className="p-4 border-t border-border bg-card">
                      <p className="text-xs text-green-400 font-bold mb-2">✓ Session complete — start a new task:</p>
                      <div className="flex gap-2">
                        <input
                          value={newTask}
                          onChange={(e) => setNewTask(e.target.value)}
                          onKeyDown={(e) => { if (e.key === "Enter") handleContinueSession(); }}
                          placeholder="New task for this session..."
                          className="flex-1 bg-background border border-border rounded px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary"
                        />
                        <button
                          onClick={handleContinueSession}
                          disabled={!newTask.trim() || isContinuing}
                          className="px-4 py-2 bg-primary/10 border border-primary/30 text-primary text-xs rounded hover:bg-primary/20 disabled:opacity-50 transition-colors font-bold"
                        >
                          {isContinuing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Files tab */}
              {activeTab === "files" && (
                <div className="flex-1 flex overflow-hidden">
                  {/* File list */}
                  <div className="w-48 border-r border-border bg-card overflow-y-auto">
                    <div className="p-2">
                      <p className="text-xs text-muted-foreground font-bold mb-2 px-1">PROJECT FILES</p>
                      {projectFiles.length === 0 ? (
                        <p className="text-xs text-muted-foreground px-1">No files yet</p>
                      ) : (
                        <div className="space-y-0.5">
                          {projectFiles.map((f) => (
                            <button
                              key={f.filepath}
                              onClick={() => setSelectedFile(f)}
                              className={`w-full text-left px-2 py-1.5 rounded text-xs transition-colors ${selectedFile?.filepath === f.filepath ? "bg-primary/20 text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}
                            >
                              <div className="flex items-center gap-1">
                                <FileCode className="h-3 w-3 shrink-0" />
                                <span className="truncate">{f.filepath.split("/").pop()}</span>
                              </div>
                              <div className="text-xs opacity-50 truncate pl-4">{f.filepath}</div>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                  {/* File content */}
                  <div className="flex-1 overflow-auto bg-background">
                    {selectedFile ? (
                      <div className="p-4">
                        <div className="flex items-center gap-2 mb-3">
                          <FileCode className="h-4 w-4 text-primary" />
                          <span className="text-xs font-bold text-foreground">{selectedFile.filepath}</span>
                          <span className={`text-xs ${AGENT_COLORS[selectedFile.lastModifiedBy] || "text-muted-foreground"}`}>by {selectedFile.lastModifiedBy}</span>
                        </div>
                        <pre className="text-xs text-foreground/80 whitespace-pre-wrap font-mono leading-relaxed bg-card border border-border rounded-lg p-4 overflow-auto">
                          {selectedFile.content}
                        </pre>
                      </div>
                    ) : (
                      <div className="flex items-center justify-center h-full">
                        <p className="text-xs text-muted-foreground">Select a file to view</p>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Sandbox tab */}
              {activeTab === "sandbox" && (
                <div className="flex-1 flex flex-col overflow-hidden">
                  {/* Sandbox list */}
                  <div className="px-4 py-2 border-b border-border bg-card flex items-center gap-2 flex-wrap">
                    <Terminal className="h-3 w-3 text-amber-400" />
                    <span className="text-xs font-bold text-amber-400">SANDBOX</span>
                    <div className="flex gap-1 flex-wrap">
                      {sandboxes.filter(s => s.status === "running").map((s) => (
                        <button
                          key={s._id}
                          onClick={() => { setActiveSandboxId(s._id as Id<"sandboxes">); setActiveSandbox(s); }}
                          className={`text-xs px-2 py-0.5 rounded border transition-colors ${activeSandboxId === s._id ? "bg-amber-400/20 border-amber-400/40 text-amber-400" : "border-border text-muted-foreground hover:border-amber-400/40"}`}
                        >
                          {s.label || s.sandboxId.slice(0, 8)}
                        </button>
                      ))}
                    </div>
                    <div className="ml-auto flex items-center gap-2">
                      {activeSandboxId && (
                        <>
                          <button onClick={handleTestFileWrite} disabled={isSandboxLoading} className="text-xs text-muted-foreground border border-border px-2 py-1 rounded hover:border-amber-400/40 disabled:opacity-50 transition-colors">
                            {isSandboxLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : "TEST WRITE"}
                          </button>
                          <button onClick={handleGetPreviewUrl} disabled={isSandboxLoading} className="text-xs text-green-400 border border-green-400/30 px-2 py-1 rounded hover:bg-green-400/10 disabled:opacity-50 transition-colors">
                            {isSandboxLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : "PREVIEW"}
                          </button>
                          {activeSessionId && (
                            <button onClick={handleAutoDeployAndStart} disabled={isSandboxLoading || projectFiles.length === 0} className="text-xs text-primary border border-primary/30 px-2 py-1 rounded hover:bg-primary/10 disabled:opacity-50 transition-colors">
                              {isSandboxLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : "DEPLOY"}
                            </button>
                          )}
                          <button onClick={() => handleStopSandbox(activeSandboxId)} disabled={isSandboxLoading} className="text-xs text-red-400 border border-red-400/30 px-2 py-1 rounded hover:bg-red-400/10 disabled:opacity-50 transition-colors">
                            {isSandboxLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
                          </button>
                        </>
                      )}
                    </div>
                  </div>

                  {activeSandbox ? (
                    <>
                      {/* Terminal output */}
                      <div className="flex-1 overflow-y-auto bg-background p-4 font-mono text-xs">
                        {sandboxOutput.length === 0 ? (
                          <p className="text-muted-foreground">$ Ready. Type a command below.</p>
                        ) : (
                          sandboxOutput.map((entry, i) => (
                            <div key={i} className="mb-3">
                              <p className="text-amber-400">$ {entry.cmd}</p>
                              <pre className={`whitespace-pre-wrap mt-1 ${entry.code === 0 ? "text-foreground/80" : "text-red-400"}`}>{entry.out}</pre>
                            </div>
                          ))
                        )}
                        <div ref={sandboxOutputRef} />
                      </div>
                      {/* Command input */}
                      <div className="border-t border-border bg-card p-2 flex items-center gap-2">
                        <span className="text-amber-400 text-xs">$</span>
                        <input
                          value={sandboxCommand}
                          onChange={(e) => setSandboxCommand(e.target.value)}
                          onKeyDown={(e) => { if (e.key === "Enter") handleExecuteCommand(); }}
                          placeholder="Enter command..."
                          className="flex-1 bg-transparent text-xs text-foreground placeholder:text-muted-foreground focus:outline-none"
                        />
                        <button
                          onClick={handleExecuteCommand}
                          disabled={!sandboxCommand.trim() || isSandboxLoading}
                          className="text-xs text-amber-400 border border-amber-400/30 px-2 py-1 rounded hover:bg-amber-400/10 disabled:opacity-50 transition-colors"
                        >
                          {isSandboxLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : "RUN"}
                        </button>
                      </div>
                    </>
                  ) : (
                    <div className="flex-1 flex flex-col items-center justify-center gap-4 p-8">
                      <Box className="h-12 w-12 text-amber-400/20" />
                      <div className="text-center">
                        <p className="text-sm font-bold text-foreground mb-1">No Active Sandbox</p>
                        <p className="text-xs text-muted-foreground">Create a sandbox to execute commands in an isolated environment</p>
                      </div>
                      <button
                        onClick={handleCreateSandbox}
                        disabled={isSandboxLoading}
                        className="flex items-center gap-2 px-4 py-2 bg-amber-400/10 border border-amber-400/30 text-amber-400 text-sm rounded-lg hover:bg-amber-400/20 disabled:opacity-50 transition-colors font-bold"
                      >
                        {isSandboxLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                        CREATE SANDBOX (1 vCPU • $0.075/hr)
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* Preview tab */}
              {activeTab === "preview" && (
                <div className="flex-1 flex flex-col overflow-hidden">
                  <div className="px-4 py-2 border-b border-border bg-card flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Globe className="h-3 w-3 text-green-400" />
                      <span className="text-xs font-bold text-green-400">WEB PREVIEW</span>
                      {previewUrl && <span className="text-xs text-muted-foreground truncate max-w-xs">{previewUrl}</span>}
                    </div>
                    <div className="flex items-center gap-2">
                      {previewUrl && (
                        <a href={previewUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-xs text-primary hover:underline">
                          <ExternalLink className="h-3 w-3" />
                          Open
                        </a>
                      )}
                      {activeSandboxId && (
                        <button
                          onClick={handleGetPreviewUrl}
                          disabled={isSandboxLoading}
                          className="text-xs text-muted-foreground hover:text-foreground border border-border px-2 py-1 rounded transition-colors"
                        >
                          {isSandboxLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : "Refresh"}
                        </button>
                      )}
                    </div>
                  </div>
                  {previewUrl ? (
                    <div className="flex-1 flex flex-col items-center justify-center gap-6 p-8 bg-background">
                      <Globe className="h-16 w-16 text-green-400/40" />
                      <div className="text-center max-w-md">
                        <p className="text-sm font-bold text-foreground mb-2">Preview Ready</p>
                        <p className="text-xs text-muted-foreground mb-4">
                          Your app is running in the Daytona sandbox. Open the preview in a new tab to view it.
                          <br /><span className="text-amber-400">Note: You may need to log in to Daytona once to access the preview.</span>
                        </p>
                        <div className="bg-card border border-border rounded-lg p-3 mb-4 text-left">
                          <p className="text-xs text-muted-foreground mb-1">Preview URL:</p>
                          <p className="text-xs text-primary font-mono break-all">{previewUrl}</p>
                        </div>
                        <a
                          href={previewUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-2 bg-primary text-primary-foreground px-6 py-3 rounded-lg text-sm font-bold hover:bg-primary/90 transition-colors"
                        >
                          <ExternalLink className="h-4 w-4" />
                          Open Preview in New Tab
                        </a>
                      </div>
                    </div>
                  ) : (
                    <div className="flex-1 flex flex-col items-center justify-center gap-4 p-8">
                      <Monitor className="h-16 w-16 text-muted-foreground/20" />
                      <div className="text-center">
                        <p className="text-sm font-bold text-foreground mb-1">No Preview Available</p>
                        <p className="text-xs text-muted-foreground mb-4">Deploy your project and start the app to see a live preview</p>
                        {activeSandboxId && activeSessionId && (
                          <button
                            onClick={handleAutoDeployAndStart}
                            disabled={isSandboxLoading || projectFiles.length === 0}
                            className="flex items-center gap-2 px-4 py-2 bg-primary/10 border border-primary/30 text-primary text-sm rounded-lg hover:bg-primary/20 disabled:opacity-50 transition-colors font-bold mx-auto"
                          >
                            {isSandboxLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Globe className="h-4 w-4" />}
                            DEPLOY & START APP
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}