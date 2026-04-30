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
  Monitor, Sun, Moon, ChevronRight, Zap, Activity, Clock, Layers,
  MessageSquare, StopCircle, ListPlus, Sparkles, Cpu, Shield, Search,
  Code2, CheckSquare, AlertCircle,
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
  Researcher: "text-cyan-400",
  Analyser: "text-blue-400",
  Planner: "text-violet-400",
  Coder: "text-emerald-400",
  Optimiser: "text-amber-400",
  Organizer: "text-orange-400",
  Tester: "text-green-400",
  Hacker: "text-red-400",
  Critic: "text-purple-400",
  User: "text-primary",
};

const AGENT_BG: Record<string, string> = {
  Researcher: "bg-cyan-400/10 border-cyan-400/30",
  Analyser: "bg-blue-400/10 border-blue-400/30",
  Planner: "bg-violet-400/10 border-violet-400/30",
  Coder: "bg-emerald-400/10 border-emerald-400/30",
  Optimiser: "bg-amber-400/10 border-amber-400/30",
  Organizer: "bg-orange-400/10 border-orange-400/30",
  Tester: "bg-green-400/10 border-green-400/30",
  Hacker: "bg-red-400/10 border-red-400/30",
  Critic: "bg-purple-400/10 border-purple-400/30",
  User: "bg-primary/10 border-primary/30",
};

const AGENT_ICONS: Record<string, string> = {
  Researcher: "🔍", Analyser: "A", Planner: "P", Coder: "C",
  Optimiser: "O", Organizer: "📝", Tester: "T", Hacker: "H", Critic: "R", User: "U",
};

const AGENT_EMOJI: Record<string, string> = {
  Researcher: "🔍", Analyser: "🧠", Planner: "📋", Coder: "💻",
  Optimiser: "⚡", Organizer: "📝", Tester: "🧪", Hacker: "🔐", Critic: "🎯", User: "👤",
};

const PIPELINE = ["Researcher", "Analyser", "Planner", "Coder", "Optimiser", "Organizer", "Tester", "Hacker", "Critic"];
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
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const autoRunRef = useRef(false);
  const messageInputRef = useRef<HTMLTextAreaElement>(null);

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

  const agentMessages: AgentMessage[] = (liveMessages ?? []).map((m) => ({
    _id: m._id as string, agent: m.agent, content: m.content, round: m.round, messageIndex: m.messageIndex,
  }));

  // Merge agent messages with user messages, sorted by messageIndex
  const allMessages: AgentMessage[] = [...agentMessages, ...userMessages].sort((a, b) => {
    const ai = a.messageIndex ?? 0;
    const bi = b.messageIndex ?? 0;
    return ai - bi;
  });

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
      const sessionId = await createSession({ task: task.trim(), token });
      setActiveSessionId(sessionId);
      setTask("");
      setUserMessages([]);
      setMessageQueue([]);
      await loadSessions();
      toast.success("Session created! Starting agents...");
      playSound("send");
      autoRunRef.current = true;
      setAutoRun(true);
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
          <p className="text-primary font-mono text-sm animate-pulse terminal-glow">INITIALIZING AGENT_TEAM...</p>
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
        <div className="flex items-center justify-between px-4 h-12">
          <div className="flex items-center gap-3">
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
              <span className="text-primary font-bold text-sm tracking-widest terminal-glow">AGENT_TEAM</span>
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
          <div className="flex items-center gap-2">
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
                className="flex items-center gap-1 px-2 py-1 rounded-lg bg-violet-400/10 border border-violet-400/30 text-xs text-violet-400 font-bold"
              >
                <Clock className="h-3 w-3" />
                {messageQueue.length} queued
              </motion.div>
            )}
            <span className="text-xs text-muted-foreground hidden sm:block truncate max-w-[100px]">{user?.email || "guest"}</span>
            <button
              onClick={() => setIsDark(d => !d)}
              className="p-1.5 rounded-lg text-muted-foreground hover:text-primary hover:bg-primary/10 transition-all"
              title="Toggle theme"
            >
              {isDark ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
            </button>
            <button onClick={() => signOut()} className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-all">
              <LogOut className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* ── Sidebar ───────────────────────────────────────────────────────────── */}
        <div className="w-52 shrink-0 border-r border-border bg-card flex flex-col overflow-hidden">
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
                return (
                  <motion.div
                    key={agent}
                    className={`flex items-center gap-2 px-2 py-1 rounded-lg text-xs transition-all ${isActive ? "bg-primary/10 border border-primary/20" : "hover:bg-muted/50"}`}
                    animate={isActive ? { x: [0, 1, 0] } : {}}
                    transition={{ duration: 0.5, repeat: Infinity }}
                  >
                    <div className={`w-4 h-4 rounded-md flex items-center justify-center text-xs font-bold shrink-0 ${AGENT_COLORS[agent]} ${isActive ? "animate-pulse" : ""}`}
                      style={{ border: "1px solid currentColor", opacity: isDone ? 0.5 : 1 }}>
                      {AGENT_ICONS[agent]}
                    </div>
                    <span className={`${AGENT_COLORS[agent]} ${isActive ? "font-bold" : isDone ? "opacity-40" : "opacity-70"} flex-1 truncate`}>{agent}</span>
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

          {/* Sessions list — own scrollbar */}
          <div className="flex-1 overflow-y-auto p-2 min-h-0">
            <p className="text-xs text-muted-foreground mb-2 font-bold px-1 flex items-center gap-1.5">
              <MessageSquare className="h-3 w-3" />
              SESSIONS
            </p>
            <div className="space-y-1">
              {sessions.map((s) => (
                <motion.button
                  key={s._id}
                  onClick={() => handleSelectSession(s._id)}
                  whileHover={{ x: 2 }}
                  className={`w-full text-left px-2 py-2 rounded-lg text-xs transition-all ${activeSessionId === s._id ? "bg-primary/15 text-primary border border-primary/20" : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"}`}
                >
                  <div className="truncate font-bold">{s.title}</div>
                  <div className="flex items-center gap-1 mt-0.5">
                    <motion.div
                      className={`w-1.5 h-1.5 rounded-full ${s.status === "completed" ? "bg-green-400" : s.status === "running" ? "bg-primary" : "bg-muted-foreground"}`}
                      animate={s.status === "running" ? { scale: [1, 1.3, 1] } : {}}
                      transition={{ duration: 1, repeat: Infinity }}
                    />
                    <span className="opacity-60 truncate">{s.phase}</span>
                  </div>
                </motion.button>
              ))}
            </div>
          </div>

          {/* New session input */}
          <div className="shrink-0 p-2 border-t border-border bg-card">
            <textarea
              value={task}
              onChange={(e) => setTask(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleCreateSession(); } }}
              placeholder="New task..."
              className="w-full bg-background border border-border rounded-lg px-2 py-1.5 text-xs text-foreground placeholder:text-muted-foreground resize-none focus:outline-none focus:border-primary transition-colors"
              rows={2}
            />
            <motion.button
              onClick={handleCreateSession}
              disabled={!task.trim() || isRunning}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              className="w-full mt-1 py-1.5 bg-primary/10 border border-primary/30 text-primary text-xs rounded-lg hover:bg-primary/20 disabled:opacity-50 transition-all font-bold flex items-center justify-center gap-1.5"
            >
              {isRunning ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
              {isRunning ? "RUNNING..." : "START SESSION"}
            </motion.button>
          </div>
        </div>

        {/* ── Main content ──────────────────────────────────────────────────────── */}
        {!activeSessionId ? (
          <div className="flex-1 flex items-center justify-center">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="text-center"
            >
              <motion.div
                className="w-20 h-20 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center mx-auto mb-4"
                animate={{ boxShadow: ["0 0 0px rgba(0,0,0,0)", "0 0 30px rgba(var(--primary),0.2)", "0 0 0px rgba(0,0,0,0)"] }}
                transition={{ duration: 3, repeat: Infinity }}
              >
                <Users className="h-10 w-10 text-primary/40" />
              </motion.div>
              <p className="text-sm font-bold text-foreground mb-1">No Session Selected</p>
              <p className="text-xs text-muted-foreground">Create a new task or select an existing session</p>
            </motion.div>
          </div>
        ) : (
          <div className="flex-1 flex flex-col overflow-hidden min-w-0">
            {/* ── Tab header — FIXED, never scrollable ─────────────────────────── */}
            <div className="shrink-0 border-b border-border bg-card/90 backdrop-blur-sm z-10">
              <div className="flex items-center justify-between px-3 py-2">
                {/* Tabs */}
                <div className="flex items-center gap-1">
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
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                          isActive
                            ? "bg-primary/15 text-primary border border-primary/30"
                            : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                        }`}
                      >
                        <Icon className="h-3 w-3" />
                        {tab.toUpperCase()}
                        {tab === "files" && projectFiles.length > 0 && (
                          <span className="bg-primary/20 text-primary text-xs px-1 rounded-full">{projectFiles.length}</span>
                        )}
                        {tab === "chat" && messageQueue.length > 0 && (
                          <span className="bg-violet-400/20 text-violet-400 text-xs px-1 rounded-full">{messageQueue.length}</span>
                        )}
                      </motion.button>
                    );
                  })}
                </div>
                {/* Controls */}
                <div className="flex items-center gap-1.5">
                  {sessionInfo?.status !== "completed" && (
                    <>
                      {autoRun ? (
                        <motion.button
                          onClick={handleStopAutoRun}
                          whileHover={{ scale: 1.05 }}
                          whileTap={{ scale: 0.95 }}
                          className="flex items-center gap-1.5 px-3 py-1.5 bg-red-400/10 border border-red-400/30 text-red-400 text-xs rounded-lg hover:bg-red-400/20 transition-all font-bold"
                        >
                          <StopCircle className="h-3 w-3" />
                          STOP
                        </motion.button>
                      ) : (
                        <motion.button
                          onClick={handleAutoRun}
                          disabled={isRunning}
                          whileHover={{ scale: 1.05 }}
                          whileTap={{ scale: 0.95 }}
                          className="flex items-center gap-1.5 px-3 py-1.5 bg-primary/10 border border-primary/30 text-primary text-xs rounded-lg hover:bg-primary/20 disabled:opacity-50 transition-all font-bold"
                        >
                          {isRunning ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
                          {isRunning ? "RUNNING" : "AUTO RUN"}
                        </motion.button>
                      )}
                      <motion.button
                        onClick={() => handleRunNextAgent()}
                        disabled={isRunning || autoRun}
                        whileHover={{ scale: 1.05 }}
                        whileTap={{ scale: 0.95 }}
                        className="flex items-center gap-1 px-2 py-1.5 bg-muted border border-border text-muted-foreground text-xs rounded-lg hover:bg-muted/80 disabled:opacity-50 transition-all"
                      >
                        <RefreshCw className="h-3 w-3" />
                        STEP
                      </motion.button>
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
                  {/* Messages — own scrollbar */}
                  <div className="flex-1 overflow-y-auto min-h-0 p-4 space-y-4">
                    {/* Session info banner */}
                    {sessionInfo && (
                      <motion.div
                        initial={{ opacity: 0, y: -10 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="bg-card border border-border rounded-xl p-3 text-xs relative overflow-hidden"
                      >
                        <motion.div
                          className="absolute inset-0 bg-gradient-to-r from-primary/5 via-transparent to-primary/5"
                          animate={{ x: ["-100%", "100%"] }}
                          transition={{ duration: 4, repeat: Infinity, ease: "linear" }}
                        />
                        <p className="font-bold text-foreground mb-1 truncate relative z-10">{sessionInfo.task}</p>
                        <p className="text-muted-foreground relative z-10">8 agents • Researcher → Analyser → Planner → Coder → Optimiser → Tester → Hacker → Critic</p>
                      </motion.div>
                    )}

                    {/* Queue display */}
                    {messageQueue.length > 0 && (
                      <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        className="bg-violet-400/5 border border-violet-400/20 rounded-xl p-3 text-xs"
                      >
                        <p className="text-violet-400 font-bold mb-2 flex items-center gap-1.5">
                          <Clock className="h-3 w-3" />
                          MESSAGE QUEUE ({messageQueue.length})
                        </p>
                        {messageQueue.map((q, i) => (
                          <div key={q.id} className="flex items-center gap-2 text-muted-foreground mb-1">
                            <span className="text-violet-400 font-bold">{i + 1}.</span>
                            <span className="truncate">{q.text}</span>
                            <button
                              onClick={() => setMessageQueue(prev => prev.filter(m => m.id !== q.id))}
                              className="ml-auto text-red-400 hover:text-red-300 shrink-0"
                            >×</button>
                          </div>
                        ))}
                      </motion.div>
                    )}

                    {/* All messages (agent + user) */}
                    <AnimatePresence>
                      {allMessages.map((msg) => (
                        <motion.div
                          key={msg._id}
                          initial={{ opacity: 0, y: 10, scale: 0.98 }}
                          animate={{ opacity: 1, y: 0, scale: 1 }}
                          transition={{ type: "spring", stiffness: 300, damping: 30 }}
                          className={`flex items-start gap-3 ${msg.isUser ? "flex-row-reverse" : ""}`}
                        >
                          {!msg.isUser && (
                            <div className={`w-8 h-8 rounded-xl flex items-center justify-center text-xs font-bold shrink-0 border ${AGENT_BG[msg.agent] || "bg-muted/20 border-border"}`}>
                              {AGENT_EMOJI[msg.agent] || msg.agent[0]}
                            </div>
                          )}
                          <div className={`flex-1 min-w-0 ${msg.isUser ? "flex flex-col items-end" : ""}`}>
                            {!msg.isUser && (
                              <p className={`text-xs font-bold mb-1 ${AGENT_COLORS[msg.agent] || "text-foreground"}`}>{msg.agent}</p>
                            )}
                            <div className={`rounded-2xl px-4 py-3 border shadow-sm ${
                              msg.isUser
                                ? "rounded-tr-sm bg-primary/10 border-primary/30 text-foreground max-w-[85%]"
                                : msg.agent === "Planner"
                                ? "rounded-tl-sm bg-violet-400/5 border-violet-400/20 w-full"
                                : `rounded-tl-sm ${AGENT_BG[msg.agent] || "bg-card border-border"} max-w-[85%]`
                            }`}>
                              <MessageContent msg={msg} currentTaskIndex={sessionInfo?.currentTaskIndex} />
                            </div>
                          </div>
                          {msg.isUser && (
                            <div className="w-8 h-8 rounded-xl flex items-center justify-center text-xs font-bold shrink-0 border bg-primary/10 border-primary/30 text-primary">
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
                          className="flex items-start gap-3"
                        >
                          <motion.div
                            className={`w-8 h-8 rounded-xl flex items-center justify-center text-xs font-bold shrink-0 border ${AGENT_BG[streamingAgent] || "bg-primary/10 border-primary/20"}`}
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
                            <div className={`rounded-2xl rounded-tl-sm px-4 py-3 border shadow-sm ${
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
                          className="flex items-start gap-3"
                        >
                          <motion.div
                            className={`w-8 h-8 rounded-xl flex items-center justify-center text-xs font-bold shrink-0 border ${AGENT_BG[streamingAgent] || "bg-primary/10 border-primary/20"}`}
                            animate={{ scale: [1, 1.05, 1] }}
                            transition={{ duration: 1, repeat: Infinity }}
                          >
                            {AGENT_EMOJI[streamingAgent] || "?"}
                          </motion.div>
                          <div className={`rounded-2xl rounded-tl-sm px-4 py-3 border ${AGENT_BG[streamingAgent] || "bg-card border-border"}`}>
                            <TypingDots />
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>

                    <div ref={messagesEndRef} />
                  </div>

                  {/* ── Message input — ALWAYS VISIBLE ──────────────────────────── */}
                  <div className="shrink-0 border-t border-border bg-card/80 backdrop-blur-sm p-3">
                    {/* Queue indicator */}
                    {messageQueue.length > 0 && (
                      <div className="flex items-center gap-2 mb-2 text-xs text-violet-400">
                        <Clock className="h-3 w-3" />
                        <span>{messageQueue.length} message(s) queued — will send after current task</span>
                      </div>
                    )}
                    <div className="flex gap-2 items-end">
                      <div className="flex-1 relative">
                        <textarea
                          ref={messageInputRef}
                          value={messageInput}
                          onChange={(e) => setMessageInput(e.target.value)}
                          onKeyDown={handleMessageKeyDown}
                          placeholder={
                            !activeSessionId ? "Create a session first..." :
                            isRunning || autoRun ? "Type a message (Enter to queue, Ctrl+Enter to queue explicitly)..." :
                            "Type a message (Enter to send, Ctrl+Enter to queue)..."
                          }
                          className="w-full bg-background border border-border rounded-xl px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground resize-none focus:outline-none focus:border-primary transition-all min-h-[36px] max-h-[120px]"
                          rows={1}
                          style={{ height: "auto" }}
                          onInput={(e) => {
                            const t = e.target as HTMLTextAreaElement;
                            t.style.height = "auto";
                            t.style.height = Math.min(t.scrollHeight, 120) + "px";
                          }}
                        />
                      </div>
                      <div className="flex flex-col gap-1 shrink-0">
                        {/* Stop button (when running) */}
                        {(isRunning || autoRun) && (
                          <motion.button
                            onClick={handleStopAutoRun}
                            whileHover={{ scale: 1.05 }}
                            whileTap={{ scale: 0.95 }}
                            className="p-2 bg-red-400/10 border border-red-400/30 text-red-400 rounded-xl hover:bg-red-400/20 transition-all"
                            title="Stop after current agent"
                          >
                            <StopCircle className="h-4 w-4" />
                          </motion.button>
                        )}
                        {/* Queue button */}
                        <motion.button
                          onClick={handleQueueMessage}
                          disabled={!messageInput.trim() || !activeSessionId}
                          whileHover={{ scale: 1.05 }}
                          whileTap={{ scale: 0.95 }}
                          className="p-2 bg-violet-400/10 border border-violet-400/30 text-violet-400 rounded-xl hover:bg-violet-400/20 disabled:opacity-40 transition-all"
                          title="Queue message (Ctrl+Enter)"
                        >
                          <ListPlus className="h-4 w-4" />
                        </motion.button>
                        {/* Send button */}
                        <motion.button
                          onClick={handleSendMessage}
                          disabled={!messageInput.trim() || !activeSessionId}
                          whileHover={{ scale: 1.05 }}
                          whileTap={{ scale: 0.95 }}
                          className="p-2 bg-primary/10 border border-primary/30 text-primary rounded-xl hover:bg-primary/20 disabled:opacity-40 transition-all"
                          title="Send message (Enter)"
                        >
                          <Send className="h-4 w-4" />
                        </motion.button>
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1.5 opacity-60">
                      Enter to send • Ctrl+Enter to queue • Shift+Enter for new line
                    </p>
                  </div>
                </div>
              )}

              {/* FILES TAB */}
              {activeTab === "files" && (
                <div className="h-full flex overflow-hidden">
                  {/* File list — own scrollbar */}
                  <div className="w-52 shrink-0 border-r border-border overflow-y-auto bg-card/50">
                    <div className="p-2">
                      <p className="text-xs text-muted-foreground mb-2 font-bold px-1 flex items-center gap-1.5">
                        <FileCode className="h-3 w-3" />
                        FILES ({projectFiles.length})
                      </p>
                      {projectFiles.length === 0 ? (
                        <p className="text-xs text-muted-foreground px-1">No files yet</p>
                      ) : (
                        <div className="space-y-0.5">
                          {projectFiles.map((f) => (
                            <motion.button
                              key={f.filepath}
                              onClick={() => setSelectedFile(f)}
                              whileHover={{ x: 2 }}
                              className={`w-full text-left px-2 py-1.5 rounded-lg text-xs transition-all ${selectedFile?.filepath === f.filepath ? "bg-primary/15 text-primary border border-primary/20" : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"}`}
                            >
                              <div className="truncate font-mono">{f.filepath}</div>
                              <div className={`text-xs mt-0.5 ${AGENT_COLORS[f.lastModifiedBy] || "text-muted-foreground"} opacity-70`}>{f.lastModifiedBy}</div>
                            </motion.button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                  {/* File content — own scrollbar */}
                  <div className="flex-1 overflow-y-auto min-w-0">
                    {selectedFile ? (
                      <div className="p-4">
                        <div className="flex items-center justify-between mb-3">
                          <div>
                            <p className="text-xs font-bold text-foreground font-mono">{selectedFile.filepath}</p>
                            <p className={`text-xs ${AGENT_COLORS[selectedFile.lastModifiedBy] || "text-muted-foreground"}`}>by {selectedFile.lastModifiedBy}</p>
                          </div>
                          <button
                            onClick={() => { navigator.clipboard.writeText(selectedFile.content); toast.success("Copied!"); }}
                            className="text-xs text-muted-foreground hover:text-primary border border-border px-2 py-1 rounded-lg transition-colors"
                          >Copy</button>
                        </div>
                        <pre className="text-xs text-foreground bg-background border border-border rounded-xl p-4 overflow-x-auto font-mono leading-relaxed whitespace-pre-wrap break-all">
                          {selectedFile.content}
                        </pre>
                      </div>
                    ) : (
                      <div className="h-full flex items-center justify-center">
                        <div className="text-center">
                          <FileCode className="h-12 w-12 text-muted-foreground/20 mx-auto mb-3" />
                          <p className="text-sm text-muted-foreground">Select a file to view</p>
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
                  <div className="shrink-0 px-4 py-2 border-b border-border bg-card/50 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Terminal className="h-3.5 w-3.5 text-amber-400" />
                      <span className="text-xs font-bold text-amber-400">SANDBOX TERMINAL</span>
                      {activeSandbox && (
                        <span className={`text-xs px-2 py-0.5 rounded-full border ${activeSandbox.status === "running" ? "bg-green-400/10 text-green-400 border-green-400/30" : "bg-muted text-muted-foreground border-border"}`}>
                          {activeSandbox.status}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5">
                      {activeSandbox && (
                        <>
                          <button onClick={handleGetPreviewUrl} disabled={isSandboxLoading} className="text-xs text-muted-foreground hover:text-primary border border-border px-2 py-1 rounded-lg transition-colors">
                            {isSandboxLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : "Preview"}
                          </button>
                          <button onClick={handleTestFileWrite} disabled={isSandboxLoading} className="text-xs text-muted-foreground hover:text-amber-400 border border-border px-2 py-1 rounded-lg transition-colors">
                            Test Write
                          </button>
                          {activeSessionId && (
                            <button onClick={handleAutoDeployAndStart} disabled={isSandboxLoading || projectFiles.length === 0} className="text-xs text-primary border border-primary/30 px-2 py-1 rounded-lg hover:bg-primary/10 transition-colors">
                              Deploy
                            </button>
                          )}
                          <button onClick={() => handleStopSandbox(activeSandboxId!)} disabled={isSandboxLoading} className="text-xs text-red-400 border border-red-400/30 px-2 py-1 rounded-lg hover:bg-red-400/10 transition-colors">
                            Stop
                          </button>
                        </>
                      )}
                    </div>
                  </div>

                  {activeSandbox ? (
                    <>
                      {/* Terminal output — own scrollbar */}
                      <div className="flex-1 overflow-y-auto min-h-0 p-3 bg-background font-mono text-xs">
                        {sandboxOutput.length === 0 ? (
                          <p className="text-muted-foreground">$ ready for commands...</p>
                        ) : (
                          sandboxOutput.map((entry, i) => (
                            <motion.div
                              key={i}
                              initial={{ opacity: 0, y: 5 }}
                              animate={{ opacity: 1, y: 0 }}
                              className="mb-3"
                            >
                              <p className="text-amber-400">$ {entry.cmd}</p>
                              <pre className={`whitespace-pre-wrap break-all mt-1 ${entry.code === 0 ? "text-green-400/80" : "text-red-400/80"}`}>
                                {entry.out || "(no output)"}
                              </pre>
                            </motion.div>
                          ))
                        )}
                        <div ref={sandboxOutputEndRef} />
                      </div>
                      {/* Command input */}
                      <div className="shrink-0 border-t border-border p-2 flex gap-2">
                        <span className="text-amber-400 text-xs self-center shrink-0">$</span>
                        <input
                          value={sandboxCommand}
                          onChange={(e) => setSandboxCommand(e.target.value)}
                          onKeyDown={(e) => { if (e.key === "Enter") handleExecuteCommand(); }}
                          placeholder="Enter command..."
                          className="flex-1 bg-transparent text-xs text-foreground placeholder:text-muted-foreground focus:outline-none font-mono"
                        />
                        <button
                          onClick={handleExecuteCommand}
                          disabled={!sandboxCommand.trim() || isSandboxLoading}
                          className="text-xs text-amber-400 border border-amber-400/30 px-2 py-1 rounded-lg hover:bg-amber-400/10 disabled:opacity-50 transition-colors"
                        >
                          {isSandboxLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : "RUN"}
                        </button>
                      </div>
                    </>
                  ) : (
                    <div className="flex-1 flex flex-col items-center justify-center gap-4 p-8">
                      <motion.div
                        animate={{ scale: [1, 1.05, 1] }}
                        transition={{ duration: 2, repeat: Infinity }}
                      >
                        <Box className="h-12 w-12 text-amber-400/20" />
                      </motion.div>
                      <div className="text-center">
                        <p className="text-sm font-bold text-foreground mb-1">No Active Sandbox</p>
                        <p className="text-xs text-muted-foreground">Create a sandbox to execute commands</p>
                      </div>
                      <motion.button
                        onClick={handleCreateSandbox}
                        disabled={isSandboxLoading}
                        whileHover={{ scale: 1.02 }}
                        whileTap={{ scale: 0.98 }}
                        className="flex items-center gap-2 px-4 py-2 bg-amber-400/10 border border-amber-400/30 text-amber-400 text-sm rounded-xl hover:bg-amber-400/20 disabled:opacity-50 transition-all font-bold"
                      >
                        {isSandboxLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                        CREATE SANDBOX ($0.075/hr)
                      </motion.button>
                    </div>
                  )}
                </div>
              )}

              {/* PREVIEW TAB */}
              {activeTab === "preview" && (
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
                    <div className="flex-1 flex flex-col items-center justify-center gap-6 p-8">
                      <motion.div
                        animate={{ scale: [1, 1.02, 1] }}
                        transition={{ duration: 3, repeat: Infinity }}
                      >
                        <Globe className="h-16 w-16 text-green-400/40" />
                      </motion.div>
                      <div className="text-center max-w-md">
                        <p className="text-sm font-bold text-foreground mb-2">Preview Ready</p>
                        <p className="text-xs text-muted-foreground mb-4">Your app is running in the Daytona sandbox.</p>
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
                          className="inline-flex items-center gap-2 bg-primary text-primary-foreground px-6 py-3 rounded-xl text-sm font-bold hover:bg-primary/90 transition-all"
                        >
                          <ExternalLink className="h-4 w-4" />
                          Open Preview in New Tab
                        </motion.a>
                      </div>
                    </div>
                  ) : (
                    <div className="flex-1 flex flex-col items-center justify-center gap-4 p-8">
                      <Monitor className="h-16 w-16 text-muted-foreground/20" />
                      <div className="text-center">
                        <p className="text-sm font-bold text-foreground mb-1">No Preview Available</p>
                        <p className="text-xs text-muted-foreground mb-4">Deploy your project and start the app to see a live preview</p>
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