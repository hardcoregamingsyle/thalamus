import { useAuth } from "@/hooks/use-auth";
import { useEffect, useState, useRef, useCallback } from "react";
import { useNavigate } from "react-router";
import { motion, AnimatePresence } from "framer-motion";
import { api } from "@/convex/_generated/api";
import { useAction } from "convex/react";
import { Id } from "@/convex/_generated/dataModel";
import { toast } from "sonner";
import {
  Send,
  Loader2,
  LogOut,
  Plus,
  ChevronRight,
  Users,
  Play,
  RotateCcw,
  ArrowLeft,
  FileCode,
  ChevronDown,
  ChevronUp,
  RefreshCw,
  AlertTriangle,
  CheckCircle,
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
  const [activeTab, setActiveTab] = useState<"chat" | "files">("chat");
  const [selectedFile, setSelectedFile] = useState<ProjectFile | null>(null);
  const [expandedMessages, setExpandedMessages] = useState<Set<string>>(new Set());
  const [newTask, setNewTask] = useState("");
  const [isContinuing, setIsContinuing] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const autoRunRef = useRef(false);

  const createSession = useAction(api.agentTeam.createSession);
  const runAgentRound = useAction(api.agentTeam.runAgentRound);
  const listSessionsAction = useAction(api.agentTeam.listSessions);
  const getSessionMessages = useAction(api.agentTeam.getSessionMessages2);
  const getSessionInfoAction = useAction(api.agentTeam.getSessionInfo);
  const getProjectFilesAction = useAction(api.agentTeam.getProjectFiles);
  const continueSessionAction = useAction(api.agentTeam.continueSession);

  useEffect(() => {
    if (!isLoading && !isAuthenticated) navigate("/auth");
  }, [isLoading, isAuthenticated, navigate]);

  useEffect(() => {
    if (token) loadSessions();
  }, [token]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const loadSessions = async () => {
    if (!token) return;
    try {
      const data = await listSessionsAction({ token });
      setSessions(data as TeamSession[]);
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
                    className={`text-xs px-2 py-1 border transition-colors flex items-center gap-1 ${activeTab === "files" ? "border-primary text-primary" : "border-border text-muted-foreground hover:text-primary"}`}
                  >
                    <FileCode className="h-3 w-3" />
                    FILES {projectFiles.length > 0 && `(${projectFiles.length})`}
                  </button>

                  <button
                    onClick={() => { setActiveSessionId(null); setMessages([]); setSessionInfo(null); setProjectFiles([]); setAutoRun(false); autoRunRef.current = false; }}
                    className="text-xs text-muted-foreground hover:text-primary transition-colors border border-border px-2 py-1"
                  >
                    <Plus className="h-3 w-3" />
                  </button>

                  {autoRun ? (
                    <button
                      onClick={handleStopAutoRun}
                      className="text-xs text-red-400 hover:text-red-300 transition-colors border border-red-400/30 px-2 py-1 flex items-center gap-1"
                    >
                      <AlertTriangle className="h-3 w-3" />
                      STOP
                    </button>
                  ) : (
                    <button
                      onClick={handleAutoRun}
                      disabled={isRunning || sessionInfo?.status === "completed"}
                      className="text-xs text-primary hover:text-primary/80 transition-colors border border-primary/30 px-2 py-1 flex items-center gap-1 disabled:opacity-50"
                    >
                      {isRunning ? (
                        <><Loader2 className="h-3 w-3 animate-spin" />RUNNING</>
                      ) : (
                        <><Play className="h-3 w-3" />AUTO_RUN</>
                      )}
                    </button>
                  )}

                  <button
                    onClick={() => handleRunNextAgent()}
                    disabled={isRunning || sessionInfo?.status === "completed"}
                    className="text-xs text-primary hover:text-primary/80 transition-colors border border-primary px-2 py-1 flex items-center gap-1 disabled:opacity-50"
                  >
                    {isRunning ? (
                      <><Loader2 className="h-3 w-3 animate-spin" />...</>
                    ) : (
                      <><Send className="h-3 w-3" />STEP</>
                    )}
                  </button>
                </div>
              </div>

              {/* Content area */}
              {activeTab === "chat" ? (
                <ScrollArea className="flex-1 p-4">
                  <div className="max-w-4xl mx-auto space-y-3">
                    {/* Task */}
                    <div className="border border-border/50 bg-card/50 p-3">
                      <p className="text-xs text-muted-foreground mb-1">// TASK</p>
                      <p className="text-xs text-foreground">{sessionInfo?.task}</p>
                    </div>

                    {messages.length === 0 && (
                      <div className="text-center py-8">
                        <p className="text-xs text-muted-foreground">Click AUTO_RUN to start the agent pipeline, or STEP to run one agent at a time.</p>
                      </div>
                    )}

                    <AnimatePresence>
                      {messages.map((msg, i) => {
                        const isExpanded = expandedMessages.has(msg._id);
                        const isLong = msg.content.length > 800;
                        return (
                          <motion.div
                            key={msg._id}
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: Math.min(i * 0.03, 0.3) }}
                            className="border border-border bg-card"
                          >
                            <div
                              className="flex items-center gap-2 px-3 py-2 border-b border-border/50 cursor-pointer hover:bg-card/80"
                              onClick={() => isLong && toggleMessageExpand(msg._id)}
                            >
                              <span className={`w-6 h-6 border flex items-center justify-center text-xs font-bold ${AGENT_COLORS[msg.agent] || "text-foreground"} border-current`}>
                                {AGENT_ICONS[msg.agent] || msg.agent[0]}
                              </span>
                              <span className={`text-xs font-bold ${AGENT_COLORS[msg.agent] || "text-foreground"}`}>
                                {msg.agent.toUpperCase()}
                              </span>
                              {msg.round !== undefined && (
                                <span className="text-xs text-muted-foreground">loop {msg.round + 1}</span>
                              )}
                              {msg.messageIndex !== undefined && (
                                <span className="text-xs text-muted-foreground ml-auto">#{msg.messageIndex}</span>
                              )}
                              {isLong && (
                                <span className="text-xs text-muted-foreground ml-1">
                                  {isExpanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                                </span>
                              )}
                            </div>
                            <div className={`p-3 ${isLong && !isExpanded ? "max-h-48 overflow-hidden relative" : ""}`}>
                              <div className="prose prose-invert prose-sm max-w-none font-mono text-xs prose-code:text-primary prose-pre:bg-background prose-pre:border prose-pre:border-border prose-headings:text-primary prose-headings:font-bold">
                                <ReactMarkdown>{msg.content}</ReactMarkdown>
                              </div>
                              {isLong && !isExpanded && (
                                <div className="absolute bottom-0 left-0 right-0 h-12 bg-gradient-to-t from-card to-transparent" />
                              )}
                            </div>
                            {isLong && !isExpanded && (
                              <button
                                onClick={() => toggleMessageExpand(msg._id)}
                                className="w-full text-xs text-muted-foreground hover:text-primary py-1 border-t border-border/50 transition-colors"
                              >
                                Show more
                              </button>
                            )}
                          </motion.div>
                        );
                      })}
                    </AnimatePresence>

                    {isRunning && currentAgent && (
                      <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        className="border border-border bg-card p-3 flex items-center gap-2"
                      >
                        <span className={`w-6 h-6 border flex items-center justify-center text-xs font-bold ${AGENT_COLORS[currentAgent] || "text-primary"} border-current animate-pulse`}>
                          {AGENT_ICONS[currentAgent] || currentAgent[0]}
                        </span>
                        <span className={`text-xs ${AGENT_COLORS[currentAgent] || "text-primary"}`}>
                          {currentAgent.toUpperCase()} is working...
                        </span>
                        <Loader2 className="h-3 w-3 animate-spin text-primary ml-2" />
                      </motion.div>
                    )}

                    {sessionInfo?.status === "completed" && (
                      <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        className="border border-green-400/30 bg-green-400/5 p-4 text-center"
                      >
                        <CheckCircle className="h-6 w-6 text-green-400 mx-auto mb-2" />
                        <p className="text-xs text-green-400 font-bold">PROJECT COMPLETE</p>
                        <p className="text-xs text-muted-foreground mt-1">
                          {projectFiles.length} files created • {totalMessages} messages • {loopCount} loops
                        </p>
                        <button
                          onClick={() => setActiveTab("files")}
                          className="mt-2 text-xs text-primary hover:text-primary/80 border border-primary/30 px-3 py-1 transition-colors"
                        >
                          VIEW FILES →
                        </button>
                      </motion.div>
                    )}

                    <div ref={messagesEndRef} />
                  </div>
                </ScrollArea>
              ) : (
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
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}