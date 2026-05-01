import { useEffect, useState, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { api } from "@/convex/_generated/api";
import { useAction, useQuery } from "convex/react";
import { Id } from "@/convex/_generated/dataModel";
import { toast } from "sonner";
import {
  Loader2, Plus, CheckCircle, Terminal, Box, Globe, ExternalLink,
  Play, Square, Send, FileCode, Monitor, ChevronRight, Activity,
  MessageSquare, StopCircle, ListPlus, Cpu, Shield, Search, Code2,
  CheckSquare, AlertCircle,
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

// ── Agent config ───────────────────────────────────────────────────────────────
const AGENT_COLORS: Record<string, string> = {
  Researcher: "text-cyan-400", Analyser: "text-blue-400", Planner: "text-violet-400",
  Coder: "text-emerald-400", Optimiser: "text-amber-400", Organizer: "text-orange-400",
  Tester: "text-green-400", Hacker: "text-red-400", Critic: "text-purple-400", User: "text-primary",
};

const AGENT_BG: Record<string, string> = {
  Researcher: "bg-cyan-400/10 border-cyan-400/30", Analyser: "bg-blue-400/10 border-blue-400/30",
  Planner: "bg-violet-400/10 border-violet-400/30", Coder: "bg-emerald-400/10 border-emerald-400/30",
  Optimiser: "bg-amber-400/10 border-amber-400/30", Organizer: "bg-orange-400/10 border-orange-400/30",
  Tester: "bg-green-400/10 border-green-400/30", Hacker: "bg-red-400/10 border-red-400/30",
  Critic: "bg-purple-400/10 border-purple-400/30", User: "bg-primary/10 border-primary/30",
};

const AGENT_ICONS: Record<string, string> = {
  Researcher: "🔍", Analyser: "A", Planner: "P", Coder: "C",
  Optimiser: "O", Organizer: "📝", Tester: "T", Hacker: "H", Critic: "R", User: "U",
};

const PIPELINE = ["Researcher", "Analyser", "Planner", "Coder", "Optimiser", "Organizer", "Tester", "Hacker", "Critic"];
const MAX_MESSAGES = 600;

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

// ── TeamPortalInline — embeddable agent team UI ────────────────────────────────
export default function TeamPortalInline({ token }: { token: string }) {
  const [sessions, setSessions] = useState<TeamSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<Id<"teamSessions"> | null>(null);
  const [task, setTask] = useState("");
  const [isRunning, setIsRunning] = useState(false);
  const [currentAgent, setCurrentAgent] = useState<string | null>(null);
  const [autoRun, setAutoRun] = useState(false);
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

  const allMessages: AgentMessage[] = [...agentMessages, ...userMessages].sort((a, b) =>
    (a.messageIndex ?? 0) - (b.messageIndex ?? 0)
  );

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

  useEffect(() => { if (token) { loadSessions(); loadSandboxes(); } }, [token]);
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
    if (isRunning || autoRun) {
      const queued: QueuedMessage = { id: `q-${Date.now()}`, text, timestamp: Date.now() };
      setMessageQueue(prev => [...prev, queued]);
      toast.info(`Message queued (${messageQueue.length + 1} in queue)`);
      playSound("queue");
    } else {
      try {
        await continueSessionAction({ sessionId: activeSessionId, newTask: text, token });
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
    } catch (err: unknown) { toast.error(err instanceof Error ? err.message : "Deploy failed"); }
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

  // Derived state
  const streamingAgent = sessionInfo?.currentAgent ?? currentAgent;
  const streamingOutput = sessionInfo?.currentAgentOutput ?? "";
  const execPhase = sessionInfo?.executionPhase ?? "planning";
  const taskIndex = sessionInfo?.currentTaskIndex ?? 0;
  let plannerTasks: Array<{ id: string; title: string; description: string; subpart: boolean }> = [];
  try { if (sessionInfo?.plannerTasksJson) plannerTasks = JSON.parse(sessionInfo.plannerTasksJson); } catch { /* ignore */ }
  const execPhaseLabel = execPhase === "planning" ? "PLANNING" : execPhase === "final_review" ? "FINAL REVIEW" : `TASK ${taskIndex + 1}/${plannerTasks.length || "?"}`;
  const execPhaseColor = execPhase === "planning" ? "text-violet-400" : execPhase === "final_review" ? "text-amber-400" : "text-emerald-400";

  return (
    <div className="flex flex-1 overflow-hidden h-full">
      {/* ── Left sidebar ──────────────────────────────────────────────────── */}
      <div className="w-52 shrink-0 border-r border-border bg-card flex flex-col overflow-hidden">
        {/* Pipeline */}
        <div className="shrink-0 p-3 border-b border-border">
          <p className="text-[10px] text-muted-foreground font-bold mb-2">PIPELINE</p>
          <div className="space-y-0.5">
            {PIPELINE.map((agent) => {
              const isActive = streamingAgent === agent;
              const isDone = sessionInfo && PIPELINE.indexOf(agent) < PIPELINE.indexOf(sessionInfo.phase ?? "");
              const isNext = sessionInfo?.phase === agent && !isActive;
              return (
                <div key={agent} className={`flex items-center gap-2 px-2 py-1 rounded text-[10px] transition-all ${isActive ? "bg-primary/10 border border-primary/20" : "hover:bg-muted/30"}`}>
                  <div className={`w-4 h-4 rounded flex items-center justify-center text-xs font-bold shrink-0 ${AGENT_COLORS[agent]} ${isActive ? "animate-pulse" : ""}`}>
                    {AGENT_ICONS[agent]}
                  </div>
                  <span className={`flex-1 ${isActive ? AGENT_COLORS[agent] + " font-bold" : "text-muted-foreground"}`}>{agent}</span>
                  {isDone && <CheckCircle className="h-3 w-3 text-green-400 shrink-0" />}
                  {isNext && !isActive && <ChevronRight className="h-3 w-3 text-amber-400 shrink-0" />}
                  {isActive && <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse shrink-0" />}
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
            {PIPELINE.map(agent => (
              <div key={agent} className={`flex items-center gap-1.5 px-2 py-1 rounded border text-[10px] ${AGENT_BG[agent]} ${AGENT_COLORS[agent]}`}>
                <span>{AGENT_ICONS[agent]}</span>
                <span>{agent}</span>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="flex-1 flex flex-col overflow-hidden min-w-0">
          {/* Session header */}
          <div className="shrink-0 border-b border-border bg-card/80 backdrop-blur-sm z-10">
            <div className="flex items-center justify-between px-4 py-2">
              <div className="flex items-center gap-3">
                <span className={`text-xs font-bold px-2 py-0.5 rounded-full border ${execPhaseColor} border-current/30 bg-current/5`}>
                  <span className={execPhaseColor}>{execPhaseLabel}</span>
                </span>
                <span className="text-xs text-muted-foreground truncate max-w-xs">{sessionInfo?.title}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-muted-foreground">{sessionInfo?.totalMessages ?? 0}/{MAX_MESSAGES} msgs</span>
                {autoRun ? (
                  <button onClick={handleStopAutoRun} className="flex items-center gap-1 px-2 py-1 bg-destructive/10 border border-destructive/30 text-destructive text-[10px] rounded hover:bg-destructive/20 transition-all">
                    <Square className="h-3 w-3" />STOP
                  </button>
                ) : (
                  <button onClick={handleAutoRun} disabled={isRunning || sessionInfo?.status === "completed"} className="flex items-center gap-1 px-2 py-1 bg-primary/10 border border-primary/30 text-primary text-[10px] rounded hover:bg-primary/20 disabled:opacity-50 transition-all">
                    {isRunning ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
                    {isRunning ? "RUNNING" : "RUN"}
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
                        <div className={`flex-1 max-w-2xl flex flex-col gap-1 ${msg.isUser ? "items-end" : "items-start"}`}>
                          <span className={`text-[10px] font-bold ${AGENT_COLORS[msg.agent] || "text-muted-foreground"}`}>{msg.agent}</span>
                          <div className={`rounded-xl px-4 py-3 text-xs leading-relaxed ${
                            msg.isUser ? "bg-primary/15 border border-primary/30 text-foreground" : "bg-card border border-border text-foreground"
                          }`}>
                            <MessageContent msg={msg} currentTaskIndex={sessionInfo?.currentTaskIndex} />
                          </div>
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
                    {(isRunning || autoRun) ? (
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
              <div className="h-full flex overflow-hidden">
                <div className="w-52 shrink-0 border-r border-border overflow-y-auto">
                  <div className="p-2 space-y-0.5">
                    {projectFiles.length === 0 ? (
                      <p className="text-[10px] text-muted-foreground p-3 text-center">No files yet</p>
                    ) : (
                      projectFiles.map((f) => (
                        <button
                          key={f.filepath}
                          onClick={() => setSelectedFile(f)}
                          className={`w-full text-left px-2 py-1.5 rounded text-[10px] transition-all flex items-center gap-1.5 ${
                            selectedFile?.filepath === f.filepath ? "bg-primary/15 border border-primary/20 text-primary" : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                          }`}
                        >
                          <FileCode className="h-3 w-3 shrink-0" />
                          <span className="truncate">{f.filepath}</span>
                        </button>
                      ))
                    )}
                  </div>
                </div>
                <div className="flex-1 overflow-y-auto min-w-0">
                  {selectedFile ? (
                    <div className="p-4">
                      <div className="flex items-center gap-2 mb-3">
                        <FileCode className="h-4 w-4 text-primary" />
                        <span className="text-xs font-bold text-primary">{selectedFile.filepath}</span>
                        <span className="text-[10px] text-muted-foreground ml-auto">by {selectedFile.lastModifiedBy}</span>
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
                          <button onClick={handleAutoDeployAndStart} disabled={isSandboxLoading || projectFiles.length === 0} className="flex items-center gap-1 px-2 py-1 bg-primary/10 border border-primary/30 text-primary text-[10px] rounded hover:bg-primary/20 disabled:opacity-50 transition-all">
                            <Play className="h-3 w-3" />DEPLOY
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
                      <button onClick={handleGetPreviewUrl} disabled={isSandboxLoading} className="text-xs text-muted-foreground hover:text-foreground border border-border px-2 py-1 rounded-lg transition-colors">
                        {isSandboxLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : "Refresh"}
                      </button>
                    )}
                  </div>
                </div>
                {previewUrl ? (
                  <div className="flex-1 flex flex-col items-center justify-center gap-6 p-8">
                    <Globe className="h-16 w-16 text-green-400/40" />
                    <div className="text-center max-w-md">
                      <p className="text-sm font-bold text-foreground mb-2">Preview Ready</p>
                      <div className="bg-card border border-border rounded-xl p-3 mb-4 text-left">
                        <p className="text-xs text-muted-foreground mb-1">Preview URL:</p>
                        <p className="text-xs text-primary font-mono break-all">{previewUrl}</p>
                      </div>
                      <a href={previewUrl} target="_blank" rel="noopener noreferrer"
                        className="inline-flex items-center gap-2 bg-primary text-primary-foreground px-6 py-3 rounded-xl text-sm font-bold hover:bg-primary/90 transition-all">
                        <ExternalLink className="h-4 w-4" />Open Preview in New Tab
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
                        <button onClick={handleAutoDeployAndStart} disabled={isSandboxLoading || projectFiles.length === 0}
                          className="flex items-center gap-2 px-4 py-2 bg-primary/10 border border-primary/30 text-primary text-sm rounded-xl hover:bg-primary/20 disabled:opacity-50 transition-all font-bold mx-auto">
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
        </div>
      )}
    </div>
  );
}
