import { useAuth } from "@/hooks/use-auth";
import { useEffect, useState, useRef } from "react";
import { useNavigate } from "react-router";
import { motion, AnimatePresence } from "framer-motion";
import { api } from "@/convex/_generated/api";
import { useAction } from "convex/react";
import { Id } from "@/convex/_generated/dataModel";
import { toast } from "sonner";
import {
  Terminal,
  Send,
  Loader2,
  LogOut,
  Plus,
  ChevronRight,
  Users,
  Play,
  RotateCcw,
  ArrowLeft,
} from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import ReactMarkdown from "react-markdown";

interface AgentMessage {
  _id: string;
  agent: string;
  content: string;
  round?: number;
}

interface TeamSession {
  _id: Id<"teamSessions">;
  title: string;
  status: string;
  round: number;
  task: string;
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

const AGENT_ORDER = ["Analyser", "Coder", "Optimiser", "Tester", "Hacker", "Critic"];

export default function TeamPortal() {
  const { isLoading, isAuthenticated, user, signOut, token } = useAuth();
  const navigate = useNavigate();
  const [sessions, setSessions] = useState<TeamSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<Id<"teamSessions"> | null>(null);
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [sessionInfo, setSessionInfo] = useState<TeamSession | null>(null);
  const [task, setTask] = useState("");
  const [isRunning, setIsRunning] = useState(false);
  const [currentAgent, setCurrentAgent] = useState<string | null>(null);
  const [autoRun, setAutoRun] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const createSession = useAction(api.agentTeam.createSession);
  const runAgentRound = useAction(api.agentTeam.runAgentRound);
  const listSessions = useAction(api.agentTeam.listSessions);
  const getSessionMessages = useAction(api.agentTeam.getSessionMessages2);
  const getSessionInfo = useAction(api.agentTeam.getSessionInfo);

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      navigate("/auth");
    }
  }, [isLoading, isAuthenticated, navigate]);

  useEffect(() => {
    if (token) {
      loadSessions();
    }
  }, [token]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const loadSessions = async () => {
    if (!token) return;
    try {
      const data = await listSessions({ token });
      setSessions(data as TeamSession[]);
    } catch {
      // ignore
    }
  };

  const loadSessionData = async (sessionId: Id<"teamSessions">) => {
    if (!token) return;
    try {
      const [msgs, info] = await Promise.all([
        getSessionMessages({ sessionId, token }),
        getSessionInfo({ sessionId, token }),
      ]);
      setMessages(msgs as AgentMessage[]);
      setSessionInfo(info as TeamSession | null);
    } catch {
      // ignore
    }
  };

  const handleSelectSession = async (sessionId: Id<"teamSessions">) => {
    setActiveSessionId(sessionId);
    await loadSessionData(sessionId);
  };

  const handleCreateSession = async () => {
    if (!task.trim() || !token) return;
    setIsRunning(true);
    try {
      const sessionId = await createSession({ task: task.trim(), token });
      setActiveSessionId(sessionId);
      setMessages([]);
      setTask("");
      await loadSessions();
      await loadSessionData(sessionId);
      toast.success("Team session created! Click Run to start.");
    } catch (err) {
      toast.error("Failed to create session");
    } finally {
      setIsRunning(false);
    }
  };

  const handleRunNextAgent = async () => {
    if (!activeSessionId || !token || isRunning) return;
    setIsRunning(true);

    try {
      const result = await runAgentRound({ sessionId: activeSessionId, token });
      setCurrentAgent(result.agent);

      // Reload messages
      await loadSessionData(activeSessionId);
      await loadSessions();

      if (result.done) {
        toast.success("All agents have completed one full cycle!");
        setAutoRun(false);
      }
    } catch (err) {
      toast.error("Agent failed to respond");
      setAutoRun(false);
    } finally {
      setIsRunning(false);
      setCurrentAgent(null);
    }
  };

  // Auto-run: run all agents sequentially
  useEffect(() => {
    if (autoRun && !isRunning && activeSessionId) {
      const info = sessionInfo;
      if (info && info.status !== "completed") {
        handleRunNextAgent();
      } else {
        setAutoRun(false);
      }
    }
  }, [autoRun, isRunning, sessionInfo]);

  const handleAutoRun = async () => {
    if (!activeSessionId || !token) return;
    setAutoRun(true);
    await handleRunNextAgent();
  };

  const currentRound = sessionInfo?.round || 0;
  const nextAgentName = AGENT_ORDER[currentRound % AGENT_ORDER.length];

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-primary font-mono text-sm terminal-glow">
          <span className="terminal-cursor">INITIALIZING AGENT_TEAM</span>
        </div>
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
          <span className="text-primary font-bold text-sm terminal-glow tracking-widest">AGENT_TEAM</span>
          <span className="text-muted-foreground text-xs hidden sm:block">vibe coding squad</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-muted-foreground hidden sm:block truncate max-w-[120px]">
            {user?.email || "guest"}
          </span>
          <button onClick={() => signOut()} className="text-muted-foreground hover:text-destructive transition-colors">
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar - sessions list */}
        <div className="w-56 border-r border-border bg-card flex flex-col shrink-0">
          {/* Agent roster */}
          <div className="p-3 border-b border-border">
            <p className="text-xs text-muted-foreground mb-2">// TEAM_ROSTER</p>
            <div className="space-y-1">
              {AGENT_ORDER.map((agent) => (
                <div key={agent} className="flex items-center gap-2 text-xs">
                  <span className={`w-5 h-5 border flex items-center justify-center text-xs font-bold ${AGENT_COLORS[agent]} border-current`}>
                    {AGENT_ICONS[agent]}
                  </span>
                  <span className={AGENT_COLORS[agent]}>{agent}</span>
                  {currentAgent === agent && (
                    <Loader2 className="h-2 w-2 animate-spin text-primary ml-auto" />
                  )}
                  {sessionInfo && AGENT_ORDER[currentRound % AGENT_ORDER.length] === agent && !isRunning && (
                    <span className="text-primary ml-auto text-xs">next</span>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Sessions */}
          <div className="p-2 border-b border-border">
            <p className="text-xs text-muted-foreground mb-2">// SESSIONS</p>
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
                  <div className="text-muted-foreground/60 text-xs mt-0.5">
                    Round {s.round}/{AGENT_ORDER.length} • {s.status}
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
                    <h2 className="text-lg font-bold text-primary terminal-glow mb-2">START A TEAM SESSION</h2>
                    <p className="text-xs text-muted-foreground mb-6">
                      Describe your coding task. The team of 6 AI agents will collaborate: Analyser → Coder → Optimiser → Tester → Hacker → Critic
                    </p>

                    <div className="space-y-4">
                      <div>
                        <label className="text-xs text-muted-foreground block mb-1">$ task_description</label>
                        <textarea
                          value={task}
                          onChange={(e) => setTask(e.target.value)}
                          placeholder="Build a REST API for user authentication with JWT tokens..."
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

                    <div className="mt-6 pt-4 border-t border-border">
                      <p className="text-xs text-muted-foreground mb-3">// TEAM_MEMBERS</p>
                      <div className="grid grid-cols-3 gap-2">
                        {AGENT_ORDER.map((agent) => (
                          <div key={agent} className="flex items-center gap-2 text-xs">
                            <span className={`w-5 h-5 border flex items-center justify-center font-bold ${AGENT_COLORS[agent]} border-current`}>
                              {AGENT_ICONS[agent]}
                            </span>
                            <span className={`${AGENT_COLORS[agent]}`}>{agent}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              </motion.div>
            </div>
          ) : (
            /* Active session */
            <>
              {/* Session header */}
              <div className="border-b border-border px-4 py-2 bg-card flex items-center justify-between">
                <div>
                  <p className="text-xs text-primary font-bold">{sessionInfo?.title || "Loading..."}</p>
                  <p className="text-xs text-muted-foreground">
                    Round {currentRound}/{AGENT_ORDER.length} • {sessionInfo?.status || "idle"}
                    {sessionInfo?.status !== "completed" && (
                      <span className="ml-2">• Next: <span className={AGENT_COLORS[nextAgentName]}>{nextAgentName}</span></span>
                    )}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => { setActiveSessionId(null); setMessages([]); setSessionInfo(null); }}
                    className="text-xs text-muted-foreground hover:text-primary transition-colors border border-border px-2 py-1"
                  >
                    <Plus className="h-3 w-3" />
                  </button>
                  {sessionInfo?.status === "completed" && (
                    <button
                      onClick={handleRunNextAgent}
                      disabled={isRunning}
                      className="text-xs text-amber-400 hover:text-amber-300 transition-colors border border-amber-400/30 px-2 py-1 flex items-center gap-1"
                    >
                      <RotateCcw className="h-3 w-3" />
                      CONTINUE
                    </button>
                  )}
                  {sessionInfo?.status !== "running" && (
                    <button
                      onClick={handleAutoRun}
                      disabled={isRunning}
                      className="text-xs text-primary hover:text-primary/80 transition-colors border border-primary/30 px-2 py-1 flex items-center gap-1"
                    >
                      {isRunning ? (
                        <><Loader2 className="h-3 w-3 animate-spin" />RUNNING</>
                      ) : (
                        <><Play className="h-3 w-3" />AUTO_RUN</>
                      )}
                    </button>
                  )}
                  <button
                    onClick={handleRunNextAgent}
                    disabled={isRunning}
                    className="text-xs text-primary hover:text-primary/80 transition-colors border border-primary px-2 py-1 flex items-center gap-1"
                  >
                    {isRunning ? (
                      <><Loader2 className="h-3 w-3 animate-spin" />THINKING</>
                    ) : (
                      <><Send className="h-3 w-3" />NEXT_AGENT</>
                    )}
                  </button>
                </div>
              </div>

              {/* Messages */}
              <ScrollArea className="flex-1 p-4">
                <div className="max-w-4xl mx-auto space-y-4">
                  {/* Task display */}
                  <div className="border border-border/50 bg-card/50 p-3">
                    <p className="text-xs text-muted-foreground mb-1">// TASK</p>
                    <p className="text-xs text-foreground">{sessionInfo?.task}</p>
                  </div>

                  {messages.length === 0 && (
                    <div className="text-center py-8">
                      <p className="text-xs text-muted-foreground">No messages yet. Click NEXT_AGENT or AUTO_RUN to start.</p>
                    </div>
                  )}

                  <AnimatePresence>
                    {messages.map((msg, i) => (
                      <motion.div
                        key={msg._id}
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: Math.min(i * 0.05, 0.5) }}
                        className="border border-border bg-card"
                      >
                        {/* Agent header */}
                        <div className="flex items-center gap-2 px-3 py-2 border-b border-border/50">
                          <span className={`w-6 h-6 border flex items-center justify-center text-xs font-bold ${AGENT_COLORS[msg.agent] || "text-foreground"} border-current`}>
                            {AGENT_ICONS[msg.agent] || msg.agent[0]}
                          </span>
                          <span className={`text-xs font-bold ${AGENT_COLORS[msg.agent] || "text-foreground"} terminal-glow`}>
                            {msg.agent.toUpperCase()}
                          </span>
                          {msg.round !== undefined && (
                            <span className="text-xs text-muted-foreground ml-auto">round {msg.round + 1}</span>
                          )}
                        </div>
                        {/* Content */}
                        <div className="p-3">
                          <div className="prose prose-invert prose-sm max-w-none font-mono text-xs prose-code:text-primary prose-pre:bg-background prose-pre:border prose-pre:border-border prose-headings:text-primary prose-headings:font-bold">
                            <ReactMarkdown>{msg.content}</ReactMarkdown>
                          </div>
                        </div>
                      </motion.div>
                    ))}
                  </AnimatePresence>

                  {isRunning && currentAgent && (
                    <motion.div
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      className="border border-border bg-card p-3 flex items-center gap-2"
                    >
                      <span className={`w-6 h-6 border flex items-center justify-center text-xs font-bold ${AGENT_COLORS[currentAgent] || "text-primary"} border-current`}>
                        {AGENT_ICONS[currentAgent] || currentAgent[0]}
                      </span>
                      <span className={`text-xs ${AGENT_COLORS[currentAgent] || "text-primary"}`}>
                        {currentAgent.toUpperCase()} is thinking...
                      </span>
                      <Loader2 className="h-3 w-3 animate-spin text-primary ml-2" />
                    </motion.div>
                  )}

                  <div ref={messagesEndRef} />
                </div>
              </ScrollArea>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
