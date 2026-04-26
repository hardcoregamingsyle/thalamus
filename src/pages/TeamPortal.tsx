import { useAuth } from "@/hooks/use-auth";
import { useEffect, useState, useRef, useCallback } from "react";
import { useNavigate } from "react-router";
import { motion } from "framer-motion";
import { api } from "@/convex/_generated/api";
import { useAction } from "convex/react";
import { Id } from "@/convex/_generated/dataModel";
import { toast } from "sonner";
import {
  Loader2,
  LogOut,
  Plus,
  ChevronRight,
  Users,
  Play,
  ArrowLeft,
  ChevronDown,
  ChevronUp,
  RefreshCw,
  CheckCircle,
  Terminal,
  Box,
  Trash2,
  Upload,
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
}

const AGENT_COLORS: Record<string, string> = {
  user: "text-foreground",
  Analyser: "text-blue-400",
  Coder: "text-primary",
  Optimiser: "text-amber-400",
  Tester: "text-green-400",
  Hacker: "text-red-400",
  Critic: "text-purple-400",
};

const AGENT_ICONS: Record<string, string> = {
  user: "U",
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
  const [activeTab, setActiveTab] = useState<"chat" | "files" | "sandbox">("chat");
  const [selectedFile, setSelectedFile] = useState<ProjectFile | null>(null);
  const [expandedMessages, setExpandedMessages] = useState<Set<string>>(new Set());
  const [newTask, setNewTask] = useState("");
  const [isContinuing, setIsContinuing] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const autoRunRef = useRef(false);

  // Sandbox state
  const [sandboxes, setSandboxes] = useState<SandboxRow[]>([]);
  const [activeSandboxId, setActiveSandboxId] = useState<Id<"sandboxes"> | null>(null);
  const [sandboxCommand, setSandboxCommand] = useState("");
  const [sandboxOutput, setSandboxOutput] = useState<Array<{ cmd: string; out: string; code: number }>>([]);
  const [isSandboxLoading, setIsSandboxLoading] = useState(false);
  const sandboxOutputRef = useRef<HTMLDivElement>(null);

  const createSession = useAction(api.agentTeam.createSession);
  const runAgentRound = useAction(api.agentTeam.runAgentRound);
  const listSessionsAction = useAction(api.agentTeam.listSessions);
  const getSessionMessages = useAction(api.agentTeam.getSessionMessages2);
  const getSessionInfoAction = useAction(api.agentTeam.getSessionInfo);
  const getProjectFilesAction = useAction(api.agentTeam.getProjectFiles);
  const continueSessionAction = useAction(api.agentTeam.continueSession);

  // Sandbox actions
  const createSandboxAction = useAction(api.sandbox.createSandbox);
  const executeCommandAction = useAction(api.sandbox.executeCommand);
  const stopSandboxAction = useAction(api.sandbox.stopSandbox);
  const listSandboxesAction = useAction(api.sandbox.listSandboxes);
  const deployProjectFilesAction = useAction(api.sandbox.deployProjectFiles);

  useEffect(() => {
    if (!isLoading && !isAuthenticated) navigate("/auth");
  }, [isLoading, isAuthenticated, navigate]);

  useEffect(() => {
    if (token) {
      loadSessions();
      loadSandboxes();
    }
  }, [token]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    sandboxOutputRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [sandboxOutput]);

  const loadSessions = async () => {
    if (!token) return;
    try {
      const data = await listSessionsAction({ token });
      setSessions(data as TeamSession[]);
    } catch { /* ignore */ }
  };

  const loadSandboxes = async () => {
    if (!token) return;
    try {
      const data = await listSandboxesAction({ token });
      setSandboxes(data as SandboxRow[]);
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
      toast.success("Team session created! Click AUTO_RUN to start.");
    } catch {
      toast.error("Failed to create session");
    } finally {
      setIsRunning(false);
    }
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
      toast.success("New task set! Click AUTO_RUN to start.");
    } catch {
      toast.error("Failed to continue session");
    } finally {
      setIsContinuing(false);
    }
  };

  const handleRunNextAgent = useCallback(async (sessionIdOverride?: Id<"teamSessions">) => {
    const sid = sessionIdOverride || activeSessionId;
    if (!sid || !token || isRunning) return;
    setIsRunning(true);

    try {
      const result = await runAgentRound({ sessionId: sid, token });
      setCurrentAgent(result.agent);

      await loadSessionData(sid);
      await loadSessions();

      if (result.fileOpsCount > 0) {
        toast.success(`${result.agent}: ${result.fileOpsCount} file(s) modified`);
      }

      if (result.done) {
        toast.success("🎉 Project complete! All agents finished.");
        autoRunRef.current = false;
        setAutoRun(false);
      } else if (result.nextAgent === "Analyser" && result.loopCount > 0) {
        toast.warning(`Loop ${result.loopCount}: Restarting from Analyser...`);
      }

      return result;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Agent failed";
      toast.error(msg);
      autoRunRef.current = false;
      setAutoRun(false);
    } finally {
      setIsRunning(false);
      setCurrentAgent(null);
    }
  }, [activeSessionId, token, isRunning, runAgentRound, loadSessionData, loadSessions]);

  // Auto-run loop
  useEffect(() => {
    if (!autoRun || isRunning || !activeSessionId) return;
    if (!sessionInfo) return;
    if (sessionInfo.status === "completed") {
      setAutoRun(false);
      autoRunRef.current = false;
      return;
    }
    if (sessionInfo.totalMessages >= MAX_MESSAGES) {
      setAutoRun(false);
      autoRunRef.current = false;
      return;
    }
    const timer = setTimeout(() => {
      if (autoRunRef.current) handleRunNextAgent();
    }, 500);
    return () => clearTimeout(timer);
  }, [autoRun, isRunning, sessionInfo, activeSessionId, handleRunNextAgent]);

  const handleAutoRun = () => {
    if (!activeSessionId || !token) return;
    autoRunRef.current = true;
    setAutoRun(true);
    handleRunNextAgent();
  };

  const handleStopAutoRun = () => {
    autoRunRef.current = false;
    setAutoRun(false);
  };

  const toggleMessageExpand = (id: string) => {
    setExpandedMessages((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

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
      setActiveSandboxId(result.sandboxDbId as Id<"sandboxes">);
      setSandboxOutput([]);
      await loadSandboxes();
      toast.success("Sandbox created! (1 vCPU, $0.075/hr)");
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to create sandbox");
    } finally {
      setIsSandboxLoading(false);
    }
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
    } finally {
      setIsSandboxLoading(false);
    }
  };

  const handleDeployFiles = async () => {
    if (!activeSandboxId || !activeSessionId || !token) return;
    setIsSandboxLoading(true);
    try {
      const result = await deployProjectFilesAction({ token, sandboxDbId: activeSandboxId, sessionId: activeSessionId });
      toast.success(`Deployed ${result.filesDeployed} files to sandbox`);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Deploy failed");
    } finally {
      setIsSandboxLoading(false);
    }
  };

  const handleStopSandbox = async (sandboxDbId: Id<"sandboxes">) => {
    if (!token) return;
    setIsSandboxLoading(true);
    try {
      const result = await stopSandboxAction({ token, sandboxDbId });
      if (activeSandboxId === sandboxDbId) setActiveSandboxId(null);
      await loadSandboxes();
      toast.success(`Sandbox stopped. Cost: $${(result.costCents / 100).toFixed(4)}`);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to stop sandbox");
    } finally {
      setIsSandboxLoading(false);
    }
  };

  const currentPhase = sessionInfo?.phase ?? "Analyser";
  const totalMessages = sessionInfo?.totalMessages ?? 0;
  const loopCount = sessionInfo?.loopCount ?? 0;
  const progressPct = Math.round((totalMessages / MAX_MESSAGES) * 100);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-primary font-mono text-sm">INITIALIZING AGENT_TEAM...</div>
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
          <span className="text-muted-foreground text-xs hidden sm:block">vibe coding squad</span>
        </div>
        <div className="flex items-center gap-3">
          {sessionInfo && (
            <div className="hidden sm:flex items-center gap-2 text-xs text-muted-foreground">
              <span className="text-amber-400">{totalMessages}/{MAX_MESSAGES}</span>
              <span>msgs</span>
              {loopCount > 0 && <span className="text-red-400">loop {loopCount}</span>}
            </div>
          )}
          <span className="text-xs text-muted-foreground hidden sm:block truncate max-w-[120px]">
            {user?.email || "guest"}
          </span>
          <button onClick={() => signOut()} className="text-muted-foreground hover:text-destructive transition-colors">
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <div className="w-52 border-r border-border bg-card flex flex-col shrink-0">
          {/* Agent roster */}
          <div className="p-3 border-b border-border">
            <p className="text-xs text-muted-foreground mb-2">// PIPELINE</p>
            <div className="space-y-1">
              {PIPELINE.map((agent, idx) => {
                const isActive = currentAgent === agent;
                const isNext = !isRunning && sessionInfo && currentPhase === agent && sessionInfo.status !== "completed";
                const isDone = sessionInfo && sessionInfo.status !== "completed" && PIPELINE.indexOf(currentPhase) > idx && loopCount === 0;
                return (
                  <div key={agent} className="flex items-center gap-2 text-xs">
                    <span className={`w-5 h-5 border flex items-center justify-center text-xs font-bold ${AGENT_COLORS[agent]} border-current ${isActive ? "animate-pulse" : ""}`}>
                      {AGENT_ICONS[agent]}
                    </span>
                    <span className={`${AGENT_COLORS[agent]} ${isActive ? "font-bold" : ""}`}>{agent}</span>
                    {isActive && <Loader2 className="h-2 w-2 animate-spin text-primary ml-auto" />}
                    {isNext && <span className="text-primary ml-auto text-xs">▶</span>}
                    {isDone && <CheckCircle className="h-2 w-2 text-green-400 ml-auto" />}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Sessions */}
          <div className="p-2 border-b border-border flex items-center justify-between">
            <p className="text-xs text-muted-foreground">// SESSIONS</p>
            <button onClick={loadSessions} className="text-muted-foreground hover:text-primary transition-colors">
              <RefreshCw className="h-3 w-3" />
            </button>
          </div>
          <ScrollArea className="flex-1">
            <div className="p-2 space-y-1">
              {sessions.length === 0 && (
                <p className="text-xs text-muted-foreground px-2 py-4 text-center">NO_SESSIONS</p>
              )}
              {sessions.map((s) => (
                <div
                  key={s._id}
                  onClick={() => handleSelectSession(s._id)}
                  className={`px-2 py-1.5 cursor-pointer text-xs transition-all border-l-2 ${
                    activeSessionId === s._id
                      ? "bg-primary/10 text-primary border-primary"
                      : "text-muted-foreground hover:text-primary/70 border-transparent"
                  }`}
                >
                  <div className="truncate">{s.title}</div>
                  <div className="text-muted-foreground/60 text-xs mt-0.5 flex gap-1">
                    <span className={s.status === "completed" ? "text-green-400" : "text-amber-400"}>{s.status}</span>
                    <span>•</span>
                    <span>{s.totalMessages}/{MAX_MESSAGES}</span>
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
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="w-full max-w-2xl"
              >
                <div className="border border-border bg-card">
                  <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
                    <div className="w-2.5 h-2.5 rounded-full bg-destructive" />
                    <div className="w-2.5 h-2.5 rounded-full bg-amber-400" />
                    <div className="w-2.5 h-2.5 rounded-full bg-primary" />
                    <span className="text-xs text-muted-foreground ml-2">team — new_session</span>
                  </div>
                  <div className="p-6">
                    <p className="text-xs text-muted-foreground mb-1">// VIBE_CODING_TEAM</p>
                    <h2 className="text-lg font-bold text-primary mb-2">START A TEAM SESSION</h2>
                    <p className="text-xs text-muted-foreground mb-4">
                      Describe your project. The team will build it from scratch with full file creation, testing, security review, and quality checks.
                    </p>
                    <div className="bg-card/50 border border-border/50 p-3 mb-4 text-xs text-muted-foreground space-y-1">
                      <p>• <span className="text-blue-400">Analyser</span> → plans the architecture</p>
                      <p>• <span className="text-primary">Coder</span> → builds all files</p>
                      <p>• <span className="text-amber-400">Optimiser</span> → improves performance</p>
                      <p>• <span className="text-green-400">Tester</span> → writes tests (fail = loop back)</p>
                      <p>• <span className="text-red-400">Hacker</span> → security review (fail = loop back)</p>
                      <p>• <span className="text-purple-400">Critic</span> → final review (fail = loop back)</p>
                      <p className="text-amber-400 mt-2">Max 60 messages total across all loops</p>
                    </div>

                    <div className="space-y-4">
                      <div>
                        <label className="text-xs text-muted-foreground block mb-1">$ project_description</label>
                        <textarea
                          value={task}
                          onChange={(e) => setTask(e.target.value)}
                          placeholder="Build a full-stack todo app with React, Node.js, and PostgreSQL..."
                          className="w-full bg-background border border-border text-foreground text-xs font-mono p-3 resize-none outline-none focus:border-primary transition-colors min-h-[100px]"
                          disabled={isRunning}
                        />
                      </div>

                      <button
                        onClick={handleCreateSession}
                        disabled={!task.trim() || isRunning}
                        className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-primary text-primary-foreground text-xs font-bold hover:bg-primary/90 disabled:opacity-50 transition-all"
                      >
                        {isRunning ? (
                          <><Loader2 className="h-3 w-3 animate-spin" />CREATING...</>
                        ) : (
                          <><Plus className="h-3 w-3" />CREATE_SESSION<ChevronRight className="h-3 w-3" /></>
                        )}
                      </button>
                    </div>
                  </div>
                </div>
              </motion.div>
            </div>
          ) : (
            /* Active session */
            <>
              {/* Session header */}
              <div className="border-b border-border px-4 py-2 bg-card flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-xs text-primary font-bold truncate">{sessionInfo?.title || "Loading..."}</p>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span className={`${AGENT_COLORS[currentPhase] || "text-foreground"}`}>{currentPhase}</span>
                    <span>•</span>
                    <span>{totalMessages}/{MAX_MESSAGES} msgs</span>
                    {loopCount > 0 && <span className="text-red-400">• loop {loopCount}</span>}
                    {sessionInfo?.status === "completed" && <span className="text-green-400">• DONE</span>}
                  </div>
                </div>

                {/* Progress bar */}
                <div className="hidden sm:flex items-center gap-2 flex-1 max-w-32">
                  <div className="flex-1 h-1 bg-border rounded-full overflow-hidden">
                    <div
                      className="h-full bg-primary transition-all duration-300"
                      style={{ width: `${progressPct}%` }}
                    />
                  </div>
                  <span className="text-xs text-muted-foreground">{progressPct}%</span>
                </div>

                <div className="flex items-center gap-1 shrink-0">
                  {/* Tab switcher */}
                  <button
                    onClick={() => setActiveTab("chat")}
                    className={`text-xs px-2 py-1 border transition-colors ${activeTab === "chat" ? "border-primary text-primary" : "border-border text-muted-foreground hover:text-primary"}`}
                  >
                    CHAT
                  </button>
                  <button
                    onClick={() => setActiveTab("files")}
                    className={`text-xs px-2 py-1 border transition-colors ${activeTab === "files" ? "border-primary text-primary" : "border-border text-muted-foreground hover:text-primary"}`}
                  >
                    FILES
                  </button>
                  <button
                    onClick={() => setActiveTab("sandbox")}
                    className={`text-xs px-2 py-1 border transition-colors ${activeTab === "sandbox" ? "border-amber-400 text-amber-400" : "border-border text-muted-foreground hover:text-amber-400"}`}
                  >
                    SANDBOX
                  </button>

                  {/* Run controls */}
                  {sessionInfo?.status !== "completed" && (
                    <>
                      {autoRun ? (
                        <button
                          onClick={handleStopAutoRun}
                          className="text-xs px-2 py-1 border border-destructive text-destructive hover:bg-destructive/10 transition-colors"
                        >
                          STOP
                        </button>
                      ) : (
                        <button
                          onClick={handleAutoRun}
                          disabled={isRunning}
                          className="text-xs px-2 py-1 border border-primary text-primary hover:bg-primary/10 disabled:opacity-50 transition-colors"
                        >
                          {isRunning ? <Loader2 className="h-3 w-3 animate-spin" /> : "AUTO_RUN"}
                        </button>
                      )}
                      <button
                        onClick={() => handleRunNextAgent()}
                        disabled={isRunning || autoRun}
                        className="text-xs px-2 py-1 border border-border text-muted-foreground hover:text-primary hover:border-primary disabled:opacity-50 transition-colors"
                      >
                        NEXT
                      </button>
                    </>
                  )}
                </div>
              </div>

              {/* Tab content */}
              {activeTab === "chat" ? (
                <ScrollArea className="flex-1">
                  <div className="p-4 space-y-3">
                    {messages.length === 0 && (
                      <div className="text-center py-8">
                        <p className="text-xs text-muted-foreground">No messages yet. Click AUTO_RUN to start.</p>
                      </div>
                    )}
                    {messages.map((msg) => {
                      const isExpanded = expandedMessages.has(msg._id);
                      const isLong = msg.content.length > 500;
                      const displayContent = isLong && !isExpanded ? msg.content.slice(0, 500) + "..." : msg.content;
                      return (
                        <motion.div
                          key={msg._id}
                          initial={{ opacity: 0, y: 8 }}
                          animate={{ opacity: 1, y: 0 }}
                          className="border border-border/50 bg-card/30"
                        >
                          <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border/30">
                            <span className={`text-xs font-bold ${AGENT_COLORS[msg.agent] || "text-foreground"}`}>
                              [{AGENT_ICONS[msg.agent] || "?"}] {msg.agent}
                            </span>
                            {msg.round !== undefined && msg.round > 0 && (
                              <span className="text-xs text-red-400">loop {msg.round}</span>
                            )}
                            {msg.messageIndex !== undefined && (
                              <span className="text-xs text-muted-foreground ml-auto">#{msg.messageIndex}</span>
                            )}
                          </div>
                          <div className="px-3 py-2 text-xs text-foreground/90 prose prose-invert prose-xs max-w-none">
                            <ReactMarkdown>{displayContent}</ReactMarkdown>
                          </div>
                          {isLong && (
                            <button
                              onClick={() => toggleMessageExpand(msg._id)}
                              className="w-full flex items-center justify-center gap-1 py-1 text-xs text-muted-foreground hover:text-primary border-t border-border/30 transition-colors"
                            >
                              {isExpanded ? <><ChevronUp className="h-3 w-3" />COLLAPSE</> : <><ChevronDown className="h-3 w-3" />EXPAND ({msg.content.length} chars)</>}
                            </button>
                          )}
                        </motion.div>
                      );
                    })}

                    {/* Completed state */}
                    {sessionInfo?.status === "completed" && (
                      <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        className="border border-green-400/30 bg-green-400/5 p-4"
                      >
                        <div className="flex items-center gap-2 mb-2">
                          <CheckCircle className="h-5 w-5 text-green-400 shrink-0" />
                          <p className="text-xs text-green-400 font-bold">PROJECT COMPLETE</p>
                        </div>
                        <p className="text-xs text-muted-foreground mb-3">
                          {projectFiles.length} files created • {totalMessages} messages • {loopCount} loops
                        </p>
                        <button
                          onClick={() => setActiveTab("files")}
                          className="mb-4 text-xs text-primary hover:text-primary/80 border border-primary/30 px-3 py-1 transition-colors"
                        >
                          VIEW FILES →
                        </button>
                        <div className="border-t border-green-400/20 pt-3">
                          <p className="text-xs text-muted-foreground mb-2">// FOLLOW_UP_TASK</p>
                          <textarea
                            value={newTask}
                            onChange={(e) => setNewTask(e.target.value)}
                            placeholder="Describe the next task to continue building on this project..."
                            className="w-full bg-background border border-border text-foreground text-xs font-mono p-2 resize-none outline-none focus:border-primary transition-colors min-h-[70px]"
                            disabled={isContinuing}
                          />
                          <button
                            onClick={handleContinueSession}
                            disabled={!newTask.trim() || isContinuing}
                            className="mt-2 w-full flex items-center justify-center gap-2 px-3 py-2 bg-primary text-primary-foreground text-xs font-bold hover:bg-primary/90 disabled:opacity-50 transition-all"
                          >
                            {isContinuing ? (
                              <><Loader2 className="h-3 w-3 animate-spin" />SETTING UP...</>
                            ) : (
                              <><Play className="h-3 w-3" />CONTINUE WITH NEW TASK</>
                            )}
                          </button>
                        </div>
                      </motion.div>
                    )}

                    <div ref={messagesEndRef} />
                  </div>
                </ScrollArea>
              ) : activeTab === "files" ? (
                /* Files tab */
                <div className="flex-1 flex overflow-hidden">
                  {/* File list */}
                  <div className="w-56 border-r border-border bg-card flex flex-col shrink-0">
                    <div className="p-2 border-b border-border flex items-center justify-between">
                      <p className="text-xs text-muted-foreground">// PROJECT_FILES</p>
                      <span className="text-xs text-primary">{projectFiles.length}</span>
                    </div>
                    <ScrollArea className="flex-1">
                      <div className="p-2 space-y-0.5">
                        {projectFiles.length === 0 && (
                          <p className="text-xs text-muted-foreground px-2 py-4 text-center">No files yet</p>
                        )}
                        {projectFiles.map((f) => (
                          <div
                            key={f.filepath}
                            onClick={() => setSelectedFile(f)}
                            className={`px-2 py-1.5 cursor-pointer text-xs transition-all rounded-sm ${
                              selectedFile?.filepath === f.filepath
                                ? "bg-primary/10 text-primary"
                                : "text-muted-foreground hover:text-foreground hover:bg-card/80"
                            }`}
                          >
                            <div className="truncate font-mono">{f.filepath}</div>
                            <div className="text-muted-foreground/60 text-xs">by {f.lastModifiedBy}</div>
                          </div>
                        ))}
                      </div>
                    </ScrollArea>
                  </div>

                  {/* File content */}
                  <div className="flex-1 flex flex-col overflow-hidden">
                    {selectedFile ? (
                      <>
                        <div className="px-4 py-2 border-b border-border bg-card flex items-center justify-between">
                          <span className="text-xs text-primary font-mono">{selectedFile.filepath}</span>
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-muted-foreground">by {selectedFile.lastModifiedBy}</span>
                            <button
                              onClick={() => {
                                navigator.clipboard.writeText(selectedFile.content);
                                toast.success("Copied to clipboard");
                              }}
                              className="text-xs text-muted-foreground hover:text-primary border border-border px-2 py-0.5 transition-colors"
                            >
                              COPY
                            </button>
                          </div>
                        </div>
                        <ScrollArea className="flex-1">
                          <pre className="p-4 text-xs font-mono text-foreground whitespace-pre-wrap break-all">
                            {selectedFile.content}
                          </pre>
                        </ScrollArea>
                      </>
                    ) : (
                      <div className="flex-1 flex items-center justify-center">
                        <p className="text-xs text-muted-foreground">Select a file to view its contents</p>
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                /* Sandbox tab */
                <div className="flex-1 flex overflow-hidden">
                  {/* Sandbox list */}
                  <div className="w-56 border-r border-border bg-card flex flex-col shrink-0">
                    <div className="p-2 border-b border-border flex items-center justify-between">
                      <p className="text-xs text-muted-foreground">// SANDBOXES</p>
                      <button onClick={loadSandboxes} className="text-muted-foreground hover:text-primary transition-colors">
                        <RefreshCw className="h-3 w-3" />
                      </button>
                    </div>
                    <div className="p-2 border-b border-border">
                      <button
                        onClick={handleCreateSandbox}
                        disabled={isSandboxLoading}
                        className="w-full flex items-center justify-center gap-1 px-2 py-1.5 bg-amber-400/10 border border-amber-400/30 text-amber-400 text-xs hover:bg-amber-400/20 disabled:opacity-50 transition-colors"
                      >
                        {isSandboxLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
                        NEW SANDBOX
                      </button>
                      <p className="text-xs text-muted-foreground/60 mt-1 text-center">1 vCPU • $0.075/hr</p>
                    </div>
                    <ScrollArea className="flex-1">
                      <div className="p-2 space-y-1">
                        {sandboxes.length === 0 && (
                          <p className="text-xs text-muted-foreground px-2 py-4 text-center">No sandboxes</p>
                        )}
                        {sandboxes.map((sb) => (
                          <div
                            key={sb._id}
                            onClick={() => sb.status === "running" && setActiveSandboxId(sb._id as Id<"sandboxes">)}
                            className={`px-2 py-1.5 text-xs transition-all border-l-2 ${
                              activeSandboxId === sb._id
                                ? "bg-amber-400/10 text-amber-400 border-amber-400"
                                : sb.status === "running"
                                ? "text-muted-foreground hover:text-amber-400/70 border-transparent cursor-pointer"
                                : "text-muted-foreground/40 border-transparent"
                            }`}
                          >
                            <div className="flex items-center gap-1">
                              <Box className="h-3 w-3 shrink-0" />
                              <span className="truncate">{sb.label || sb.sandboxId.slice(0, 12)}</span>
                            </div>
                            <div className="flex items-center justify-between mt-0.5">
                              <span className={sb.status === "running" ? "text-green-400" : "text-muted-foreground/60"}>{sb.status}</span>
                              {sb.status === "running" && (
                                <button
                                  onClick={(e) => { e.stopPropagation(); handleStopSandbox(sb._id as Id<"sandboxes">); }}
                                  className="text-destructive hover:text-destructive/80 transition-colors"
                                >
                                  <Trash2 className="h-3 w-3" />
                                </button>
                              )}
                            </div>
                            {sb.costCents !== undefined && (
                              <div className="text-muted-foreground/50 text-xs">${(sb.costCents / 100).toFixed(4)}</div>
                            )}
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
                          {activeSessionId && projectFiles.length > 0 && (
                            <button
                              onClick={handleDeployFiles}
                              disabled={isSandboxLoading}
                              className="flex items-center gap-1 text-xs text-primary border border-primary/30 px-2 py-0.5 hover:bg-primary/10 disabled:opacity-50 transition-colors"
                            >
                              <Upload className="h-3 w-3" />
                              DEPLOY FILES ({projectFiles.length})
                            </button>
                          )}
                        </div>
                        <ScrollArea className="flex-1 bg-background">
                          <div className="p-4 font-mono text-xs space-y-2">
                            {sandboxOutput.length === 0 && (
                              <p className="text-muted-foreground">// Sandbox ready. Type a command below.</p>
                            )}
                            {sandboxOutput.map((entry, i) => (
                              <div key={i} className="space-y-1">
                                <div className="flex items-center gap-2">
                                  <span className="text-amber-400">$</span>
                                  <span className="text-foreground">{entry.cmd}</span>
                                </div>
                                {entry.out && (
                                  <pre className={`pl-4 whitespace-pre-wrap break-all ${entry.code !== 0 ? "text-red-400" : "text-green-400/80"}`}>
                                    {entry.out}
                                  </pre>
                                )}
                                {entry.code !== 0 && (
                                  <span className="pl-4 text-red-400 text-xs">exit code: {entry.code}</span>
                                )}
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
                            className="text-xs text-amber-400 border border-amber-400/30 px-2 py-0.5 hover:bg-amber-400/10 disabled:opacity-50 transition-colors"
                          >
                            {isSandboxLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : "RUN"}
                          </button>
                        </div>
                      </>
                    ) : (
                      <div className="flex-1 flex flex-col items-center justify-center gap-4 p-8">
                        <Box className="h-12 w-12 text-amber-400/30" />
                        <div className="text-center">
                          <p className="text-xs text-muted-foreground mb-1">No active sandbox</p>
                          <p className="text-xs text-muted-foreground/60">Create a sandbox to execute commands in an isolated environment</p>
                        </div>
                        <button
                          onClick={handleCreateSandbox}
                          disabled={isSandboxLoading}
                          className="flex items-center gap-2 px-4 py-2 bg-amber-400/10 border border-amber-400/30 text-amber-400 text-xs hover:bg-amber-400/20 disabled:opacity-50 transition-colors"
                        >
                          {isSandboxLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
                          CREATE SANDBOX (1 vCPU • $0.075/hr)
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}