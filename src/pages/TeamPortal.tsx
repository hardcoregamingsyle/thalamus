import { useAuth } from "@/hooks/use-auth";
import { useEffect, useState, useRef, useCallback } from "react";
import { useNavigate } from "react-router";
import { motion, AnimatePresence } from "framer-motion";
import { api } from "@/convex/_generated/api";
import { useAction } from "convex/react";
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
  Analyser: "text-blue-400",
  Coder: "text-emerald-400",
  Optimiser: "text-amber-400",
  Tester: "text-green-400",
  Hacker: "text-red-400",
  Critic: "text-purple-400",
};

const AGENT_BG: Record<string, string> = {
  Analyser: "bg-blue-400/10 border-blue-400/20",
  Coder: "bg-emerald-400/10 border-emerald-400/20",
  Optimiser: "bg-amber-400/10 border-amber-400/20",
  Tester: "bg-green-400/10 border-green-400/20",
  Hacker: "bg-red-400/10 border-red-400/20",
  Critic: "bg-purple-400/10 border-purple-400/20",
};

const AGENT_ICONS: Record<string, string> = {
  Analyser: "A",
  Coder: "C",
  Optimiser: "O",
  Tester: "T",
  Hacker: "H",
  Critic: "R",
};

const PIPELINE = ["Analyser", "Coder", "Optimiser", "Tester", "Hacker", "Critic"];
const MAX_MESSAGES = 60;

export default function TeamPortal() {
  const { isLoading, isAuthenticated, user, signOut, token } = useAuth();
  const navigate = useNavigate();
  const [sessions, setSessions] = useState<TeamSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<Id<"teamSessions"> | null>(null);
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [sessionInfo, setSessionInfo] = useState<TeamSession | null>(null);
  const [projectFiles, setProjectFiles] = useState<ProjectFile[]>([]);
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

  const createSession = useAction(api.agentTeam.createSession);
  const runAgentRound = useAction(api.agentTeam.runAgentRound);
  const listSessionsAction = useAction(api.agentTeam.listSessions);
  const getSessionMessages = useAction(api.agentTeam.getSessionMessages2);
  const getSessionInfoAction = useAction(api.agentTeam.getSessionInfo);
  const getProjectFilesAction = useAction(api.agentTeam.getProjectFiles);
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
      // Auto-select running sandbox
      const running = rows.find(s => s.status === "running");
      if (running && !activeSandboxId) {
        setActiveSandboxId(running._id as Id<"sandboxes">);
        setActiveSandbox(running);
        if (running.previewUrl) setPreviewUrl(running.previewUrl);
      }
    } catch { /* ignore */ }
  };

  const loadSessionData = useCallback(async (sessionId: Id<"teamSessions">) => {
    if (!token) return;
    try {
      const [msgs, info, files] = await Promise.all([
        getSessionMessages({ sessionId, token }),
        getSessionInfoAction({ sessionId, token }),
        getProjectFilesAction({ sessionId, token }),
      ]);
      setMessages(msgs as AgentMessage[]);
      setSessionInfo(info as TeamSession | null);
      setProjectFiles(files as ProjectFile[]);
    } catch { /* ignore */ }
  }, [token, getSessionMessages, getSessionInfoAction, getProjectFilesAction]);

  const handleSelectSession = async (sessionId: Id<"teamSessions">) => {
    setActiveSessionId(sessionId);
    setAutoRun(false);
    autoRunRef.current = false;
    await loadSessionData(sessionId);
  };

  const handleCreateSession = async () => {
    if (!task.trim() || !token) return;
    setIsRunning(true);
    try {
      const sessionId = await createSession({ task: task.trim(), token });
      setActiveSessionId(sessionId);
      setMessages([]);
      setProjectFiles([]);
      setTask("");
      await loadSessions();
      await loadSessionData(sessionId);
      toast.success("Session created! Starting agents...");
      // Auto-start running immediately
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
      setMessages([]);
      setProjectFiles([]);
      await loadSessionData(activeSessionId);
      await loadSessions();
      toast.success("New task set! Starting agents...");
      // Auto-start running immediately
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
      agentRetryCountRef.current = 0; // reset on success
      setCurrentAgent(result.agent);
      await loadSessionData(sid);
      await loadSessions();

      if (result.fileOpsCount > 0) {
        toast.success(`${result.agent}: ${result.fileOpsCount} file(s) modified`);
        // Auto-deploy to sandbox if one is active and linked to this session
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
      } else if (result.nextAgent === "Analyser" && result.loopCount > 0) {
        toast.warning(`Loop ${result.loopCount}: Restarting from Analyser...`);
      }
      return result;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Agent failed";
      agentRetryCountRef.current += 1;
      if (agentRetryCountRef.current <= MAX_AGENT_RETRIES && autoRunRef.current) {
        // Retry after a delay — don't stop the loop
        const retryDelay = Math.min(3000 * agentRetryCountRef.current, 15000);
        toast.warning(`Retrying agent (${agentRetryCountRef.current}/${MAX_AGENT_RETRIES})... ${msg.slice(0, 60)}`);
        setIsRunning(false);
        setCurrentAgent(null);
        setTimeout(() => { if (autoRunRef.current) handleRunNextAgent(sid); }, retryDelay);
        return;
      }
      // Exhausted retries
      toast.error(`Agent failed after ${MAX_AGENT_RETRIES} retries: ${msg}`);
      agentRetryCountRef.current = 0;
      autoRunRef.current = false;
      setAutoRun(false);
    } finally {
      setIsRunning(false);
      setCurrentAgent(null);
    }
  }, [activeSessionId, token, isRunning, runAgentRound, loadSessionData, loadSessions, activeSandboxId, activeSandbox, autoDeployAndStartAction]);

  useEffect(() => {
    if (!autoRun || isRunning || !activeSessionId) return;
    // If sessionInfo not loaded yet, still try to run (session was just created)
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
        toast.warning(`Deploy: ${result.deployedFiles} files, ${result.errors.length} errors. First: ${result.errors[0].slice(0, 100)}`);
      } else if (result.previewUrl) {
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
        toast.success(`File write OK: ${result.output?.slice(0, 100)}`);
      } else {
        toast.error(`File write FAILED: ${result.error?.slice(0, 150)}`);
      }
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

  const currentPhase = sessionInfo?.phase ?? "Analyser";
  const totalMessages = sessionInfo?.totalMessages ?? 0;
  const loopCount = sessionInfo?.loopCount ?? 0;

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
              {PIPELINE.map((agent, idx) => {
                const isActive = currentAgent === agent || (isRunning && sessionInfo?.phase === agent);
                const isNext = !isRunning && sessionInfo && currentPhase === agent && sessionInfo.status !== "completed";
                const isDone = sessionInfo && sessionInfo.status !== "completed" && PIPELINE.indexOf(currentPhase) > idx && loopCount === 0;
                return (
                  <div key={agent} className={`flex items-center gap-2 text-xs px-2 py-1 rounded ${isActive ? "bg-primary/10" : ""}`}>
                    <span className={`w-5 h-5 rounded flex items-center justify-center text-xs font-bold ${AGENT_COLORS[agent]} bg-current/10 ${isActive ? "animate-pulse" : ""}`} style={{ backgroundColor: "transparent", border: "1px solid currentColor" }}>
                      {AGENT_ICONS[agent]}
                    </span>
                    <span className={`${AGENT_COLORS[agent]} ${isActive ? "font-bold" : "opacity-70"} flex-1`}>{agent}</span>
                    {isActive && <Loader2 className="h-2.5 w-2.5 animate-spin text-primary" />}
                    {isNext && !isActive && <span className="text-primary text-xs">▶</span>}
                    {isDone && <CheckCircle className="h-2.5 w-2.5 text-green-400" />}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Sessions */}
          <div className="p-2 border-b border-border flex items-center justify-between">
            <p className="text-xs text-muted-foreground font-bold">SESSIONS</p>
            <button onClick={loadSessions} className="text-muted-foreground hover:text-primary transition-colors">
              <RefreshCw className="h-3 w-3" />
            </button>
          </div>
          <ScrollArea className="flex-1">
            <div className="p-2 space-y-1">
              {sessions.length === 0 && <p className="text-xs text-muted-foreground px-2 py-4 text-center opacity-50">No sessions</p>}
              {sessions.map((s) => (
                <div
                  key={s._id}
                  onClick={() => handleSelectSession(s._id)}
                  className={`px-2 py-2 cursor-pointer text-xs transition-all rounded border ${
                    activeSessionId === s._id
                      ? "bg-primary/10 text-primary border-primary/30"
                      : "text-muted-foreground hover:text-foreground border-transparent hover:border-border"
                  }`}
                >
                  <div className="truncate font-medium">{s.title}</div>
                  <div className="flex gap-1 mt-0.5">
                    <span className={`text-xs ${s.status === "completed" ? "text-green-400" : "text-amber-400"}`}>{s.status}</span>
                    <span className="text-muted-foreground/40">•</span>
                    <span className="text-muted-foreground/60">{s.totalMessages}/{MAX_MESSAGES}</span>
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>
        </div>

        {/* Main area */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {!activeSessionId ? (
            /* New session form */
            <div className="flex-1 flex items-center justify-center p-8">
              <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="w-full max-w-xl">
                <div className="border border-border bg-card rounded-lg overflow-hidden shadow-xl">
                  <div className="bg-primary/5 border-b border-border px-6 py-4">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center">
                        <Users className="h-5 w-5 text-primary" />
                      </div>
                      <div>
                        <h2 className="font-bold text-foreground">Agent Team</h2>
                        <p className="text-xs text-muted-foreground">6 agents • Analyser → Coder → Optimiser → Tester → Hacker → Critic</p>
                      </div>
                    </div>
                  </div>
                  <div className="p-6 space-y-4">
                    <div>
                      <label className="text-xs text-muted-foreground block mb-2 font-bold">DESCRIBE YOUR PROJECT</label>
                      <textarea
                        value={task}
                        onChange={(e) => setTask(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleCreateSession(); } }}
                        placeholder="Build a React todo app with TypeScript, Tailwind, and local storage..."
                        className="w-full bg-background border border-border rounded-lg p-3 text-sm text-foreground placeholder:text-muted-foreground/50 resize-none focus:outline-none focus:border-primary transition-colors"
                        rows={4}
                        disabled={isRunning}
                      />
                    </div>
                    <button
                      onClick={handleCreateSession}
                      disabled={!task.trim() || isRunning}
                      className="w-full flex items-center justify-center gap-2 bg-primary text-primary-foreground py-3 rounded-lg font-bold text-sm hover:bg-primary/90 disabled:opacity-50 transition-colors"
                    >
                      {isRunning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                      START SESSION
                    </button>
                  </div>
                </div>
              </motion.div>
            </div>
          ) : (
            <>
              {/* Tab bar */}
              <div className="border-b border-border bg-card flex items-center gap-1 px-4 h-10 shrink-0">
                {[
                  { id: "chat", label: "Chat", icon: Users },
                  { id: "files", label: `Files (${projectFiles.length})`, icon: FileCode },
                  { id: "sandbox", label: "Sandbox", icon: Terminal },
                  { id: "preview", label: "Preview", icon: Monitor },
                ].map(({ id, label, icon: Icon }) => (
                  <button
                    key={id}
                    onClick={() => setActiveTab(id as typeof activeTab)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded transition-colors ${
                      activeTab === id ? "bg-primary/10 text-primary font-bold" : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    <Icon className="h-3 w-3" />
                    {label}
                    {id === "preview" && previewUrl && <span className="w-1.5 h-1.5 rounded-full bg-green-400 ml-0.5" />}
                  </button>
                ))}
                <div className="ml-auto flex items-center gap-2">
                  {autoRun ? (
                    <button onClick={handleStopAutoRun} className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-destructive/10 text-destructive rounded hover:bg-destructive/20 transition-colors font-bold">
                      <Square className="h-3 w-3" />
                      STOP
                    </button>
                  ) : (
                    <button
                      onClick={handleAutoRun}
                      disabled={isRunning || sessionInfo?.status === "completed"}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-primary/10 text-primary rounded hover:bg-primary/20 disabled:opacity-50 transition-colors font-bold"
                    >
                      {isRunning ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
                      AUTO RUN
                    </button>
                  )}
                </div>
              </div>

              {/* Chat tab - WhatsApp style */}
              {activeTab === "chat" && (
                <div className="flex-1 flex flex-col overflow-hidden">
                  {/* Chat header */}
                  <div className="px-4 py-2 border-b border-border bg-card/50 flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center">
                      <Users className="h-4 w-4 text-primary" />
                    </div>
                    <div>
                      <p className="text-sm font-bold text-foreground truncate max-w-xs">{sessionInfo?.title || "Session"}</p>
                      <p className="text-xs text-muted-foreground">
                        {isRunning ? (
                          <span className="text-primary animate-pulse">● {currentAgent || currentPhase} is working...</span>
                        ) : sessionInfo?.status === "completed" ? (
                          <span className="text-green-400">✓ Completed</span>
                        ) : (
                          <span>Next: {currentPhase}</span>
                        )}
                      </p>
                    </div>
                  </div>

                  {/* Messages - WhatsApp style */}
                  <ScrollArea className="flex-1 bg-background/50">
                    <div className="p-4 space-y-3">
                      {/* Task bubble (right side - user) */}
                      <div className="flex justify-end">
                        <div className="max-w-[75%]">
                          <div className="bg-primary text-primary-foreground rounded-2xl rounded-tr-sm px-4 py-3 shadow-sm">
                            <p className="text-xs font-bold mb-1 opacity-70">TASK</p>
                            <p className="text-sm leading-relaxed">{sessionInfo?.task}</p>
                          </div>
                          <p className="text-xs text-muted-foreground text-right mt-1 px-1">You</p>
                        </div>
                      </div>

                      {/* Agent messages (left side) */}
                      {messages.map((msg, idx) => (
                        <motion.div
                          key={msg._id}
                          initial={{ opacity: 0, x: -10 }}
                          animate={{ opacity: 1, x: 0 }}
                          transition={{ delay: idx * 0.02 }}
                          className="flex items-start gap-2"
                        >
                          {/* Avatar */}
                          <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0 border ${AGENT_COLORS[msg.agent] || "text-foreground"} ${AGENT_BG[msg.agent] || "bg-muted/20 border-border"}`}>
                            {AGENT_ICONS[msg.agent] || msg.agent[0]}
                          </div>
                          <div className="max-w-[75%]">
                            <p className={`text-xs font-bold mb-1 ${AGENT_COLORS[msg.agent] || "text-foreground"}`}>{msg.agent}</p>
                            <div className={`rounded-2xl rounded-tl-sm px-4 py-3 border shadow-sm ${AGENT_BG[msg.agent] || "bg-card border-border"}`}>
                              <div className="text-xs text-foreground/90 leading-relaxed prose prose-invert prose-xs max-w-none">
                                <ReactMarkdown>{msg.content.length > 800 ? msg.content.slice(0, 800) + "\n\n*[truncated — see Files tab for full output]*" : msg.content}</ReactMarkdown>
                              </div>
                            </div>
                            {msg.round !== undefined && (
                              <p className="text-xs text-muted-foreground/50 mt-1 px-1">Round {msg.round + 1} • #{msg.messageIndex}</p>
                            )}
                          </div>
                        </motion.div>
                      ))}

                      {/* Typing indicator */}
                      {isRunning && (
                        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex items-start gap-2">
                          <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0 border ${AGENT_COLORS[currentAgent || currentPhase] || "text-primary"} ${AGENT_BG[currentAgent || currentPhase] || "bg-primary/10 border-primary/20"}`}>
                            {AGENT_ICONS[currentAgent || currentPhase] || "?"}
                          </div>
                          <div className={`rounded-2xl rounded-tl-sm px-4 py-3 border ${AGENT_BG[currentAgent || currentPhase] || "bg-card border-border"}`}>
                            <div className="flex gap-1 items-center">
                              <div className="w-1.5 h-1.5 rounded-full bg-current animate-bounce" style={{ animationDelay: "0ms" }} />
                              <div className="w-1.5 h-1.5 rounded-full bg-current animate-bounce" style={{ animationDelay: "150ms" }} />
                              <div className="w-1.5 h-1.5 rounded-full bg-current animate-bounce" style={{ animationDelay: "300ms" }} />
                            </div>
                          </div>
                        </motion.div>
                      )}

                      <div ref={messagesEndRef} />
                    </div>
                  </ScrollArea>

                  {/* Follow-up task input (when completed) */}
                  {sessionInfo?.status === "completed" && (
                    <div className="border-t border-border bg-card p-3">
                      <p className="text-xs text-muted-foreground mb-2 font-bold">FOLLOW-UP TASK</p>
                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={newTask}
                          onChange={(e) => setNewTask(e.target.value)}
                          onKeyDown={(e) => e.key === "Enter" && handleContinueSession()}
                          placeholder="Describe the next task..."
                          className="flex-1 bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:border-primary transition-colors"
                          disabled={isContinuing}
                        />
                        <button
                          onClick={handleContinueSession}
                          disabled={!newTask.trim() || isContinuing}
                          className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-bold hover:bg-primary/90 disabled:opacity-50 transition-colors"
                        >
                          {isContinuing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Files tab */}
              {activeTab === "files" && (
                <div className="flex-1 flex overflow-hidden">
                  <div className="w-48 border-r border-border bg-card/50 flex flex-col">
                    <div className="p-2 border-b border-border">
                      <p className="text-xs font-bold text-muted-foreground">PROJECT FILES ({projectFiles.length})</p>
                    </div>
                    <ScrollArea className="flex-1">
                      <div className="p-2 space-y-0.5">
                        {projectFiles.length === 0 && <p className="text-xs text-muted-foreground p-2 opacity-50">No files yet</p>}
                        {projectFiles.map((f) => (
                          <button
                            key={f.filepath}
                            onClick={() => setSelectedFile(f)}
                            className={`w-full text-left px-2 py-1.5 text-xs rounded transition-colors truncate ${selectedFile?.filepath === f.filepath ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground hover:bg-muted/50"}`}
                          >
                            {f.filepath}
                          </button>
                        ))}
                      </div>
                    </ScrollArea>
                  </div>
                  <div className="flex-1 overflow-hidden">
                    {selectedFile ? (
                      <div className="h-full flex flex-col">
                        <div className="px-4 py-2 border-b border-border bg-card/50 flex items-center justify-between">
                          <span className="text-xs font-bold text-primary">{selectedFile.filepath}</span>
                          <span className="text-xs text-muted-foreground">by {selectedFile.lastModifiedBy}</span>
                        </div>
                        <ScrollArea className="flex-1">
                          <pre className="p-4 text-xs text-foreground/80 whitespace-pre-wrap break-all font-mono leading-relaxed">{selectedFile.content}</pre>
                        </ScrollArea>
                      </div>
                    ) : (
                      <div className="flex-1 flex items-center justify-center text-muted-foreground text-xs">
                        Select a file to view
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Sandbox tab */}
              {activeTab === "sandbox" && (
                <div className="flex-1 flex overflow-hidden">
                  {/* Sandbox list */}
                  <div className="w-48 border-r border-border bg-card/50 flex flex-col shrink-0">
                    <div className="p-2 border-b border-border flex items-center justify-between">
                      <p className="text-xs font-bold text-muted-foreground">SANDBOXES</p>
                      <button
                        onClick={handleCreateSandbox}
                        disabled={isSandboxLoading}
                        className="text-primary hover:text-primary/80 transition-colors"
                        title="Create sandbox"
                      >
                        {isSandboxLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
                      </button>
                    </div>
                    <ScrollArea className="flex-1">
                      <div className="p-2 space-y-1">
                        {sandboxes.length === 0 && (
                          <div className="p-3 text-center">
                            <Box className="h-6 w-6 text-muted-foreground/30 mx-auto mb-2" />
                            <p className="text-xs text-muted-foreground/50">No sandboxes</p>
                            <button
                              onClick={handleCreateSandbox}
                              disabled={isSandboxLoading}
                              className="mt-2 text-xs text-primary hover:underline"
                            >
                              Create one
                            </button>
                          </div>
                        )}
                        {sandboxes.map((sb) => (
                          <div
                            key={sb._id}
                            onClick={() => { setActiveSandboxId(sb._id as Id<"sandboxes">); setActiveSandbox(sb); if (sb.previewUrl) setPreviewUrl(sb.previewUrl); }}
                            className={`px-2 py-2 cursor-pointer text-xs rounded border transition-all ${activeSandboxId === sb._id ? "bg-amber-400/10 border-amber-400/30 text-amber-400" : "border-transparent text-muted-foreground hover:border-border"}`}
                          >
                            <div className="flex items-center justify-between">
                              <span className="truncate">{sb.label || sb.sandboxId.slice(0, 8)}</span>
                              {sb.status === "running" && (
                                <button onClick={(e) => { e.stopPropagation(); handleStopSandbox(sb._id as Id<"sandboxes">); }} className="text-destructive hover:text-destructive/80">
                                  <Trash2 className="h-3 w-3" />
                                </button>
                              )}
                            </div>
                            <div className="flex items-center gap-1 mt-0.5">
                              <span className={`w-1.5 h-1.5 rounded-full ${sb.status === "running" ? "bg-green-400" : "bg-muted-foreground"}`} />
                              <span className="text-muted-foreground/60">{sb.status}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </ScrollArea>
                  </div>

                  {/* Terminal */}
                  <div className="flex-1 flex flex-col overflow-hidden">
                    {activeSandboxId ? (
                      <>
                        <div className="px-4 py-2 border-b border-border bg-card flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <Terminal className="h-3 w-3 text-amber-400" />
                            <span className="text-xs text-amber-400 font-bold">DAYTONA SANDBOX</span>
                            <span className="text-xs text-green-400">● RUNNING</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <button
                              onClick={handleTestFileWrite}
                              disabled={isSandboxLoading}
                              className="flex items-center gap-1 text-xs text-muted-foreground border border-border px-2 py-1 rounded hover:bg-muted/10 disabled:opacity-50 transition-colors"
                            >
                              TEST WRITE
                            </button>
                            {activeSessionId && projectFiles.length > 0 && (
                              <button
                                onClick={handleAutoDeployAndStart}
                                disabled={isSandboxLoading}
                                className="flex items-center gap-1 text-xs text-primary border border-primary/30 px-2 py-1 rounded hover:bg-primary/10 disabled:opacity-50 transition-colors"
                              >
                                <Globe className="h-3 w-3" />
                                DEPLOY & START
                              </button>
                            )}
                            <button
                              onClick={handleGetPreviewUrl}
                              disabled={isSandboxLoading}
                              className="flex items-center gap-1 text-xs text-amber-400 border border-amber-400/30 px-2 py-1 rounded hover:bg-amber-400/10 disabled:opacity-50 transition-colors"
                            >
                              <Monitor className="h-3 w-3" />
                              GET PREVIEW
                            </button>
                          </div>
                        </div>
                        <ScrollArea className="flex-1 bg-background">
                          <div className="p-4 font-mono text-xs space-y-2">
                            {sandboxOutput.length === 0 && (
                              <p className="text-muted-foreground/50">// Sandbox ready. Type a command below.</p>
                            )}
                            {sandboxOutput.map((entry, i) => (
                              <div key={i} className="space-y-1">
                                <div className="flex items-center gap-2">
                                  <span className="text-amber-400">$</span>
                                  <span className="text-foreground">{entry.cmd}</span>
                                </div>
                                {entry.out && (
                                  <pre className={`pl-4 whitespace-pre-wrap break-all text-xs ${entry.code !== 0 ? "text-red-400" : "text-green-400/80"}`}>{entry.out}</pre>
                                )}
                                {entry.code !== 0 && <span className="pl-4 text-red-400 text-xs">exit: {entry.code}</span>}
                              </div>
                            ))}
                            <div ref={sandboxOutputRef} />
                          </div>
                        </ScrollArea>
                        <div className="border-t border-border bg-card p-2 flex items-center gap-2">
                          <span className="text-amber-400 text-xs">$</span>
                          <input
                            type="text"
                            value={sandboxCommand}
                            onChange={(e) => setSandboxCommand(e.target.value)}
                            onKeyDown={(e) => e.key === "Enter" && handleExecuteCommand()}
                            placeholder="echo 'hello world'"
                            className="flex-1 bg-transparent text-foreground text-xs font-mono outline-none placeholder:text-muted-foreground/40"
                            disabled={isSandboxLoading}
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
            </>
          )}
        </div>
      </div>
    </div>
  );
}