import { useState, useRef, useEffect } from "react";
import { useQuery, useAction } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Doc } from "@/convex/_generated/dataModel";
import { useNavigate, useParams } from "react-router";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Send, Loader2, CheckCircle2, Pause, Play, FileCode, Database, Activity, Code2, Monitor, Key, BarChart3, GitBranch, Rocket, ChevronRight, Menu, X, LayoutDashboard, TerminalSquare } from "lucide-react";
import { toast } from "sonner";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import ReactMarkdown from "react-markdown";
import { DataView } from "@/components/code-workspace/DataView";
import { LogsView } from "@/components/code-workspace/LogsView";
import { EditorView } from "@/components/code-workspace/EditorView";
import { SandboxView } from "@/components/code-workspace/SandboxView";
import { KeysView } from "@/components/code-workspace/KeysView";
import { UsageView } from "@/components/code-workspace/UsageView";
import { VersionView } from "@/components/code-workspace/VersionView";
import { GitSyncView } from "@/components/code-workspace/GitSyncView";
import { DeployView } from "@/components/code-workspace/DeployView";
import { SponsoredAdCard, type GravityAd } from "@/components/SponsoredAdCard";
import { fetchSponsoredAd } from "@/lib/requestAd";
import { useAuth } from "@/hooks/use-auth";
import { errMsg } from "@/lib/errorMessage";

// ── Planner message rendering ──────────────────────────────────────────────────
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
            <div
              key={task.id || i}
              className={`flex items-start gap-3 px-3 py-2.5 rounded-xl border transition-all ${
                isDone
                  ? "border-border/30 bg-muted/10 opacity-50"
                  : isActive
                  ? "border-violet-400/40 bg-violet-400/8"
                  : "border-border/40 bg-card/50"
              }`}
            >
              <div className={`w-6 h-6 rounded-lg flex items-center justify-center text-[10px] font-bold shrink-0 mt-0.5 ${
                isDone ? "bg-emerald-400/20 text-emerald-400" : isActive ? "bg-violet-400/20 text-violet-400" : "bg-muted/30 text-muted-foreground"
              }`}>
                {isDone ? "✓" : i + 1}
              </div>
              <div className="flex-1 min-w-0">
                <p className={`text-xs font-bold ${isDone ? "line-through text-muted-foreground" : isActive ? "text-violet-400" : "text-foreground"}`}>
                  {task.title}
                </p>
                {task.description && (
                  <p className="text-[11px] text-muted-foreground leading-relaxed mt-0.5">{task.description}</p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── ResearchPlanner message rendering ──────────────────────────────────────────
// The ResearchPlanner emits a JSON research plan ({topic, keywords[], scrapeTargets[]}).
// Without this card the raw JSON printed as plain text in the chat.
interface ResearchPlanKeyword {
  query: string;
  reason?: string;
}

interface ResearchPlanTarget {
  url: string;
  reason?: string;
}

interface ResearchPlanData {
  topic: string;
  keywords: ResearchPlanKeyword[];
  scrapeTargets: ResearchPlanTarget[];
}

function parseResearchPlanContent(content: string): ResearchPlanData | null {
  // Same progressive-parse strategy as parsePlannerContent: try a fenced json
  // block first, then widen from the first "{" — models sometimes append prose
  // after the JSON.
  const tryShape = (raw: string): ResearchPlanData | null => {
    try {
      const data = JSON.parse(raw) as Partial<ResearchPlanData>;
      if (!data || typeof data.topic !== "string" || !Array.isArray(data.keywords)) return null;
      return {
        topic: data.topic,
        keywords: data.keywords.filter((k): k is ResearchPlanKeyword => !!k && typeof k.query === "string"),
        scrapeTargets: (Array.isArray(data.scrapeTargets) ? data.scrapeTargets : [])
          .filter((t): t is ResearchPlanTarget => !!t && typeof t.url === "string"),
      };
    } catch {
      return null;
    }
  };

  const jsonBlockMatch = content.match(/```json\s*([\s\S]*?)\s*```/);
  if (jsonBlockMatch) {
    const parsed = tryShape(jsonBlockMatch[1]);
    if (parsed) return parsed;
  }
  const jsonStart = content.indexOf("{");
  if (jsonStart !== -1) {
    for (let end = content.length; end > jsonStart; end = content.lastIndexOf("}", end - 1)) {
      if (end === -1) break;
      const parsed = tryShape(content.slice(jsonStart, end + 1));
      if (parsed) return parsed;
    }
  }
  return null;
}

function ResearchPlanCard({ data }: { data: ResearchPlanData }) {
  return (
    <div className="w-full space-y-3">
      <div className="bg-cyan-400/10 border border-cyan-400/30 rounded-xl px-4 py-3">
        <p className="text-[10px] font-bold text-cyan-400 mb-1 tracking-widest">RESEARCH PLAN</p>
        <p className="text-xs text-foreground leading-relaxed">{data.topic}</p>
      </div>
      {data.keywords.length > 0 && (
        <>
          <p className="text-[10px] font-bold text-muted-foreground tracking-widest px-1">
            {data.keywords.length} SEARCH {data.keywords.length === 1 ? "QUERY" : "QUERIES"}
          </p>
          <div className="space-y-2">
            {data.keywords.map((kw, i) => (
              <div key={i} className="flex items-start gap-3 px-3 py-2.5 rounded-xl border border-border/40 bg-card/50">
                <div className="w-6 h-6 rounded-lg bg-cyan-400/20 text-cyan-400 flex items-center justify-center text-[10px] font-bold shrink-0 mt-0.5">
                  {i + 1}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-bold text-foreground">{kw.query}</p>
                  {kw.reason && (
                    <p className="text-[11px] text-muted-foreground leading-relaxed mt-0.5">{kw.reason}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
      {data.scrapeTargets.length > 0 && (
        <>
          <p className="text-[10px] font-bold text-muted-foreground tracking-widest px-1">
            {data.scrapeTargets.length} {data.scrapeTargets.length === 1 ? "SOURCE" : "SOURCES"} TO READ
          </p>
          <div className="space-y-2">
            {data.scrapeTargets.map((target, i) => (
              <div key={i} className="px-3 py-2.5 rounded-xl border border-border/40 bg-card/50">
                <p className="text-xs font-mono text-cyan-400 break-all">{target.url}</p>
                {target.reason && (
                  <p className="text-[11px] text-muted-foreground leading-relaxed mt-1">{target.reason}</p>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ── Analyser message rendering ─────────────────────────────────────────────────
interface AnalyserSection {
  title: string;
  content: string;
}

interface AnalyserData {
  intro?: string;
  sections: AnalyserSection[];
}

function parseAnalyserContent(content: string): AnalyserData | null {
  // Strip leading "## Analysis" or bare "Analysis" header
  const body = content.replace(/^#{0,6}\s*Analysis\s*\n?/i, '').trim();

  // Need at least one numbered section
  if (!/^\d+\.\s+/m.test(body)) return null;

  const firstSectionIdx = body.search(/^\d+\.\s+/m);
  const intro = body.slice(0, firstSectionIdx).trim();
  const sectionsText = body.slice(firstSectionIdx);

  const sections: AnalyserSection[] = [];
  for (const part of sectionsText.split(/^(?=\d+\.\s)/m).filter(s => s.trim())) {
    const nl = part.indexOf('\n');
    const title = nl === -1 ? part.trim() : part.slice(0, nl).trim();
    const sectionContent = nl === -1 ? '' : part.slice(nl + 1).trim();
    if (title) sections.push({ title, content: sectionContent });
  }

  return sections.length > 0 ? { intro: intro || undefined, sections } : null;
}

function AnalyserOutputCard({ data }: { data: AnalyserData }) {
  const [expandedIdx, setExpandedIdx] = useState<number | null>(0);

  return (
    <div className="w-full space-y-2">
      <div className="bg-blue-400/10 border border-blue-400/30 rounded-xl px-4 py-3">
        <p className="text-[10px] font-bold text-blue-400 mb-1 tracking-widest">ANALYSIS</p>
        {data.intro
          ? <p className="text-xs text-foreground leading-relaxed">{data.intro}</p>
          : <p className="text-xs text-muted-foreground">{data.sections.length} sections</p>
        }
      </div>
      {data.intro && (
        <p className="text-[10px] font-bold text-muted-foreground tracking-widest px-1">{data.sections.length} SECTIONS</p>
      )}
      <div className="space-y-1">
        {data.sections.map((section, i) => (
          <div key={i} className="border border-border/40 rounded-xl overflow-hidden bg-card/50">
            <button
              className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-muted/20 transition-colors"
              onClick={() => setExpandedIdx(expandedIdx === i ? null : i)}
            >
              <span className="text-xs font-bold text-foreground flex-1">{section.title}</span>
              <ChevronRight className={cn("h-3.5 w-3.5 text-muted-foreground shrink-0 transition-transform duration-150", expandedIdx === i && "rotate-90")} />
            </button>
            {expandedIdx === i && section.content && (
              <div className="px-3 pb-3 border-t border-border/20 pt-2 text-xs leading-relaxed [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:rounded [&_code]:text-xs [&_code]:font-mono [&_pre]:bg-muted [&_pre]:p-3 [&_pre]:rounded-md [&_pre]:overflow-x-auto [&_pre]:text-xs [&_pre]:font-mono [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_ul]:list-disc [&_ul]:pl-4 [&_ol]:list-decimal [&_ol]:pl-4 [&_p]:mb-1.5 [&_table]:block [&_table]:max-w-full [&_table]:overflow-x-auto">
                <ReactMarkdown>{section.content}</ReactMarkdown>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function MessageContent({ msg, currentTaskIndex }: { msg: { agent: string; content: string }; currentTaskIndex?: number }) {
  if (msg.agent === "Planner") {
    const plannerData = parsePlannerContent(msg.content);
    if (plannerData && plannerData.tasks.length > 0) {
      return <PlannerOutputCard data={plannerData} currentTaskIndex={currentTaskIndex} />;
    }
  }
  if (msg.agent === "Analyser") {
    const analyserData = parseAnalyserContent(msg.content);
    if (analyserData && analyserData.sections.length > 0) {
      return <AnalyserOutputCard data={analyserData} />;
    }
  }
  if (msg.agent === "ResearchPlanner") {
    const planData = parseResearchPlanContent(msg.content);
    if (planData) {
      return <ResearchPlanCard data={planData} />;
    }
  }
  const cleaned = cleanLegacyContent(msg.content);
  return (
    <div className="text-sm leading-relaxed space-y-2 [&_h1]:text-base [&_h1]:font-bold [&_h1]:mt-3 [&_h1]:mb-1 [&_h2]:text-sm [&_h2]:font-bold [&_h2]:mt-3 [&_h2]:mb-1 [&_h3]:text-xs [&_h3]:font-semibold [&_h3]:mt-2 [&_h3]:mb-1 [&_ul]:list-disc [&_ul]:pl-4 [&_ul]:space-y-0.5 [&_ol]:list-decimal [&_ol]:pl-4 [&_ol]:space-y-0.5 [&_li]:text-sm [&_p]:leading-relaxed [&_strong]:font-semibold [&_em]:italic [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:rounded [&_code]:text-xs [&_code]:font-mono [&_pre]:bg-muted [&_pre]:p-3 [&_pre]:rounded-md [&_pre]:overflow-x-auto [&_pre]:text-xs [&_pre]:font-mono [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_blockquote]:border-l-2 [&_blockquote]:border-muted-foreground [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground [&_hr]:border-border">
      <ReactMarkdown>{cleaned}</ReactMarkdown>
    </div>
  );
}

// Strip raw agent action tags left over in messages stored before the parseAgentOutput fix.
function cleanLegacyContent(content: string): string {
  return content
    // <<CREATEFILE="path">>...<<END.CREATEFILE>> → [FILE CREATED: path]
    .replace(/(?:<<<<<|<<)CREATEFILE="([^"]+)"(?:>>>>>|>>)[\s\S]*?(?:<<<<<|<<)END\.CREATEFILE(?:>>>>>|>>)/g, "[FILE CREATED: $1]")
    // <<EDITFILE="path">>...<<END.CREATEFILE>> → [FILE EDITED: path]
    .replace(/(?:<<<<<|<<)EDITFILE="([^"]+)"(?:>>>>>|>>)[\s\S]*?(?:<<<<<|<<)END\.CREATEFILE(?:>>>>>|>>)/g, "[FILE EDITED: $1]")
    // <<DELETE="path">> → [FILE DELETED: path]
    .replace(/(?:<<<<<|<<)DELETE="([^"]+)"(?:>>>>>|>>)/g, "[FILE DELETED: $1]")
    // <<DEPLOY-COMMANDS>>...<<END.DEPLOY-COMMANDS?>> → fenced bash block
    .replace(/(?:<<<<<|<<)DEPLOY-COMMANDS(?:>>>>>|>>)([\s\S]*?)(?:<<<<<|<<)END\.DEPLOY-COMMANDS?(?:>>>>>|>>)/g, (_, block) => {
      const cmds = block.trim();
      if (!cmds) return "[DEPLOY COMMANDS]";
      const lines = cmds.includes("\n")
        ? cmds.split("\n").map((l: string) => l.trim().replace(/^["']|["']$/g, "")).filter(Boolean)
        : cmds.trim().split(/\s+(?=npm\s|node\s|yarn\s|pnpm\s|bun\s|sh\s|bash\s)/).map((l: string) => l.trim().replace(/^["']|["']$/g, "")).filter(Boolean);
      return `\`\`\`bash\n${lines.join("\n")}\n\`\`\``;
    })
    // <<RUN-CMD="...">>, <<RUN-COMMAND="...">> → [CMD: ...]
    .replace(/(?:<<<<<|<<)RUN-(?:CMD|COMMAND)="([^"]+)"(?:>>>>>|>>)/g, "`$1`")
    // <<SEARCH-TOOL="...">> → [SEARCH: ...]
    .replace(/(?:<<<<<|<<)SEARCH-TOOL="([^"]+)"(?:>>>>>|>>)/g, "[SEARCH: $1]")
    // <<SCRAPE-URL="...">> → [SCRAPE: ...]
    .replace(/(?:<<<<<|<<)SCRAPE-URL="([^"]+)"(?:>>>>>|>>)/g, "[SCRAPE: $1]")
    // <<test.success>> / <<pass>> / <<fail>>
    .replace(/(?:<<<<<|<<)test\.success(?:>>>>>|>>)/gi, "[TEST: PASSED]")
    .replace(/(?:<<<<<|<<)test\.failed="([^"]*)"(?:>>>>>|>>)/gi, "[TEST: FAILED — $1]")
    .replace(/(?:<<<<<|<<)pass(?:>>>>>|>>)/gi, "[SECURITY: PASSED]")
    .replace(/(?:<<<<<|<<)[Ff]ail(?:>>>>>|>>)/g, "[SECURITY: FAILED]");
}

const sidebarSections = [
  {
    title: "Backend",
    items: [
      { label: "Data", icon: Database, path: "data", description: "Convex database" },
      { label: "Logs", icon: Activity, path: "logs", description: "Execution logs" },
      { label: "Usage", icon: BarChart3, path: "data-usage", description: "Convex usage" },
    ],
  },
  {
    title: "Workspace",
    items: [
      { label: "Editor", icon: Code2, path: "code-ide", description: "Code IDE" },
      { label: "Version", icon: GitBranch, path: "version-control", description: "Version control" },
      { label: "Git-Sync", icon: GitBranch, path: "github", description: "GitHub sync" },
      { label: "Deploy", icon: Rocket, path: "deploy", description: "Deployment guide" },
      { label: "Sandbox", icon: Monitor, path: "sandbox", description: "VM sandbox" },
      { label: "Keys", icon: Key, path: "keys", description: "API keys" },
    ],
  },
];

export default function CodeWorkspace() {
  const navigate = useNavigate();
  const { projectId, branchId, subpage } = useParams<{ projectId: string; branchId: string; subpage?: string }>();
  // useAuth (not a raw localStorage read) so an expired or revoked session
  // redirects to /auth instead of surfacing as a failed Convex query.
  const { token: authToken, isLoading: authLoading, isAuthenticated } = useAuth();
  const token = authToken ?? "";
  useEffect(() => {
    if (!authLoading && !isAuthenticated) navigate("/auth", { replace: true });
  }, [authLoading, isAuthenticated, navigate]);

  const branch = useQuery(api.codeBranches.watchBranch, branchId ? { branchId } : "skip");
  const messages = useQuery(api.codeBranches.watchMessages, branchId ? { branchId } : "skip");
  const files = useQuery(api.codeBranches.watchFiles, branchId ? { branchId } : "skip");
  const commands = useQuery(api.codeCommands.watchCommands, branchId ? { branchId } : "skip");
  const startPipeline = useAction(api.codePipeline.startPipeline);
  const stopPipeline = useAction(api.codePipeline.stopPipeline);

  const [input, setInput] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // One sponsored card per session, same contract as the chat surfaces: it is
  // requested only once the branch has produced a reply, and never rendered
  // while the pipeline is mid-run.
  const [sponsoredAd, setSponsoredAd] = useState<GravityAd | null>(null);
  const adRequestedRef = useRef(false);

  // Newest first so a stalled branch surfaces its most recent command; the
  // pipeline parks the branch "paused" while a command is in flight, so the
  // status alone reads as "nothing happening" without this.
  const activeCommand =
    commands &&
    [...commands]
      .reverse()
      .find((c) => c.status === "pending" || c.status === "running");

  // Keep the transcript pinned to the newest activity. Follows committed
  // messages plus the live agent stream and terminal output; only auto-scrolls
  // when the user is already near the bottom so reading history doesn't yank.
  useEffect(() => {
    if (messages === undefined) return;
    const activity = branch?.streamingContent || (activeCommand?._id ? "cmd" : "");
    const end = messagesEndRef.current;
    if (!end) return;
    const container = end.closest(".overflow-auto") as HTMLElement | null;
    const nearBottom = container
      ? container.scrollHeight - container.scrollTop - container.clientHeight < 240
      : true;
    if (nearBottom) {
      end.scrollIntoView({ behavior: activity ? "auto" : "smooth", block: "end" });
    }
  }, [messages, branch?.streamingContent, branch?.status, activeCommand?._id]);

  useEffect(() => {
    if (adRequestedRef.current || !messages || messages.length === 0) return;
    // Agent turns carry an `agent` name rather than a role — anything that is
    // not the user reads as the assistant side of the conversation.
    const adMessages = messages.slice(-6).map((m: Doc<"codeMessages">) => ({
      role: m.agent === "User" ? "user" : "assistant",
      content: (m.content ?? "").slice(0, 1000),
    })).filter((m: { role: string; content: string }) => m.content.length > 0);
    if (adMessages.length === 0 || !adMessages.some((m: { role: string }) => m.role === "assistant")) return;

    adRequestedRef.current = true;
    fetchSponsoredAd({ token: token || undefined, messages: adMessages, count: 1 })
      .then((ad) => {
        if (ad) setSponsoredAd(Array.isArray(ad) ? (ad[0] as GravityAd) : (ad as GravityAd));
      })
      .catch(() => {});
  }, [messages, token]);

  const handleSend = async () => {
    if (!input.trim() || !branchId || isSending) return;

    const userPrompt = input.trim();
    setInput("");
    setIsSending(true);

    try {
      await startPipeline({ token, branchId, userPrompt });
      toast.success("Pipeline started!");
    } catch (err) {
      toast.error(errMsg(err, "Failed to start pipeline"));
      setInput(userPrompt);
    } finally {
      setIsSending(false);
    }
  };

  const handleStop = async () => {
    if (!branchId) return;

    try {
      await stopPipeline({ token, branchId });
      toast.success("Pipeline stopped");
    } catch (err) {
      toast.error(errMsg(err, "Failed to stop pipeline"));
    }
  };

  const getStatusIndicator = () => {
    if (!branch) return null;

    switch (branch.status) {
      case "running":
        return (
          <Badge className="gap-1.5 bg-blue-500">
            <Loader2 className="h-3 w-3 animate-spin" />
            Running: {branch.currentAgent}
          </Badge>
        );
      case "paused":
        return (
          <Badge variant="outline" className="gap-1.5">
            <Pause className="h-3 w-3" />
            Paused
          </Badge>
        );
      case "completed":
        return (
          <Badge className="gap-1.5 bg-green-500">
            <CheckCircle2 className="h-3 w-3" />
            Completed
          </Badge>
        );
      default:
        return (
          <Badge variant="secondary" className="gap-1.5">
            <Play className="h-3 w-3" />
            Ready
          </Badge>
        );
    }
  };

  const renderContent = () => {
    if (!projectId || !branchId) return null;

    switch (subpage) {
      case "data":
        return <DataView branchId={branchId} />;
      case "logs":
        return <LogsView branchId={branchId} />;
      case "data-usage":
        return <UsageView branchId={branchId} />;
      case "code-ide":
      case "editor":
        return <EditorView branchId={branchId} />;
      case "version-control":
        return <VersionView branchId={branchId} />;
      case "github":
        return <GitSyncView projectId={projectId} branchId={branchId} />;
      case "deploy":
        return <DeployView projectId={projectId} branchId={branchId} />;
      case "sandbox":
        return <SandboxView projectId={projectId} branchId={branchId} />;
      case "keys":
        return <KeysView projectId={projectId} branchId={branchId} />;
      default:
        // Chat view
        return (
          <div className="flex-1 flex flex-col h-full">
            <div className="flex-1 overflow-auto p-6 space-y-4">
              {messages === undefined ? (
                <div className="flex items-center justify-center h-full">
                  <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                </div>
              ) : messages.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-center px-4">
                  <motion.div
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.4 }}
                    className="w-14 h-14 rounded-2xl bg-muted border border-border flex items-center justify-center mb-4"
                  >
                    <FileCode className="h-7 w-7 text-violet-400" />
                  </motion.div>
                  <motion.h2
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.05 }}
                    className="text-2xl font-semibold mb-2"
                  >
                    Start Building
                  </motion.h2>
                  <motion.p
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.1 }}
                    className="text-muted-foreground max-w-md text-sm"
                  >
                    Describe what you want to build and the agent team will plan, write, and test it
                  </motion.p>
                </div>
              ) : (
                messages.map((msg: Doc<"codeMessages">) => (
                  <motion.div
                    key={msg._id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className={cn(
                      "flex gap-3 p-4 rounded-lg",
                      msg.agent === "User" ? "bg-primary/5 ml-12"
                        // Command output is machine output, not agent prose —
                        // a distinct treatment keeps a long build log from
                        // reading like something an agent said.
                        : msg.agent === "Terminal" ? "bg-background border border-border/60"
                        : "bg-muted/50"
                    )}
                  >
                    <div className="flex-shrink-0">
                      <div
                        className={cn(
                          "w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold",
                          msg.agent === "User"
                            ? "bg-primary text-primary-foreground"
                            : msg.agent === "Terminal"
                            ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30"
                            : "bg-muted-foreground text-background"
                        )}
                      >
                        {msg.agent.slice(0, 2).toUpperCase()}
                      </div>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-semibold text-sm">{msg.agent}</span>
                        {msg.round !== undefined && (
                          <Badge variant="outline" className="text-xs">
                            Round {msg.round}
                          </Badge>
                        )}
                      </div>
                      <MessageContent msg={msg} currentTaskIndex={branch?.currentTaskIndex} />
                    </div>
                  </motion.div>
                ))
              )}
              {/* Streaming indicator — shows real-time output while the agent generates */}
              {branch?.status === "running" && branch?.streamingContent && (
                <motion.div
                  key="streaming"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="flex gap-3 p-4 rounded-lg bg-primary/5 border border-primary/20"
                >
                  <div className="flex-shrink-0">
                    <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold bg-primary/20 text-primary">
                      {(branch.streamingAgent ?? "AI").slice(0, 2).toUpperCase()}
                    </div>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-semibold text-sm text-primary">{branch.streamingAgent ?? "Agent"}</span>
                      <span className="flex items-center gap-1 text-xs text-primary/60">
                        <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse inline-block" />
                        generating…
                      </span>
                    </div>
                    <div className="text-xs text-muted-foreground leading-relaxed whitespace-pre-wrap font-mono max-h-64 overflow-auto">
                      {branch.streamingContent}
                      <span className="inline-block w-0.5 h-3 bg-primary ml-0.5 animate-pulse" />
                    </div>
                  </div>
                </motion.div>
              )}
              {/* Terminal indicator — a command is queued or running on the
                  executor. The branch parks "paused" for the whole window, so
                  without this the transcript sits motionless while `npm
                  install` grinds */}
              {activeCommand && (
                <motion.div
                  key={`term-${activeCommand._id}`}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="flex gap-3 p-4 rounded-lg bg-amber-500/5 border border-amber-500/30"
                >
                  <div className="flex-shrink-0">
                    <div className="w-8 h-8 rounded-full flex items-center justify-center bg-amber-500/15 text-amber-600">
                      <TerminalSquare className="h-4 w-4 animate-pulse" />
                    </div>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="flex items-center gap-1.5 text-sm font-semibold text-amber-600">
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        Terminal is running…
                      </span>
                      <span className="text-xs text-muted-foreground">{activeCommand.agent}</span>
                    </div>
                    <div className="text-xs text-muted-foreground leading-relaxed whitespace-pre-wrap font-mono break-all">
                      {activeCommand.command}
                    </div>
                  </div>
                </motion.div>
              )}
              {/* Show typing indicator when running but no streaming content yet */}
              {branch?.status === "running" && !branch?.streamingContent && (
                <div className="flex gap-3 p-4 rounded-lg bg-muted/30">
                  <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold bg-muted-foreground/20 text-muted-foreground">
                    {(branch.currentAgent ?? "AI").slice(0, 2).toUpperCase()}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-muted-foreground">{branch.currentAgent ?? "Agent"} is thinking…</span>
                    <span className="flex gap-1">
                      {[0,1,2].map(i => (
                        <span key={i} className="w-1.5 h-1.5 rounded-full bg-muted-foreground/50 animate-bounce" style={{ animationDelay: `${i * 0.15}s` }} />
                      ))}
                    </span>
                  </div>
                </div>
              )}
              {sponsoredAd && branch?.status !== "running" && (
                <SponsoredAdCard ad={sponsoredAd} rail />
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Input Area — center-stage composer */}
            <div className="shrink-0 border-t border-border bg-gradient-to-t from-background via-background to-transparent">
              <div className="max-w-3xl mx-auto px-4 sm:px-6 py-3">
                <div className="composer-accent rounded-2xl border border-border bg-card shadow-sm transition-all">
                  <Textarea
                    placeholder={
                      branch?.status === "running"
                        ? "Pipeline is running…"
                        : "Tell the AI team what to build…"
                    }
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        handleSend();
                      }
                    }}
                    className="min-h-[70px] max-h-[200px] resize-none border-0 bg-transparent px-4 pt-3.5 text-[15px] focus-visible:ring-0 focus-visible:outline-none"
                    disabled={isSending || branch?.status === "running"}
                  />
                  <div className="flex items-center justify-between px-2 pb-2 pt-1">
                    <span className="px-2 text-[11px] text-muted-foreground/70">
                      Enter to send · Shift+Enter for newline
                    </span>
                    {branch?.status === "running" ? (
                      <Button
                        size="icon"
                        onClick={handleStop}
                        variant="destructive"
                        className="h-10 w-10 rounded-xl"
                        aria-label="Stop pipeline"
                      >
                        <Pause className="h-5 w-5" />
                      </Button>
                    ) : (
                      <Button
                        size="icon"
                        onClick={handleSend}
                        disabled={!input.trim() || isSending}
                        className="h-10 w-10 rounded-xl"
                        aria-label="Send message"
                      >
                        {isSending ? (
                          <Loader2 className="h-5 w-5 animate-spin" />
                        ) : (
                          <Send className="h-5 w-5" />
                        )}
                      </Button>
                    )}
                  </div>
                </div>
                <p className="mt-2 text-center text-[11px] text-muted-foreground/60">
                  The AI team will run commands in your VM and may request API keys
                </p>
              </div>
            </div>
          </div>
        );
    }
  };

  if (!projectId || !branchId) {
    return <div className="p-8">Invalid project or branch ID</div>;
  }

  if (branch === null) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <meta name="robots" content="noindex" />
        <div className="text-center space-y-4">
          <h1 className="text-2xl font-bold">Branch not found</h1>
          <p className="text-muted-foreground max-w-md">
            This branch has been deleted. Its data and GitHub repository were removed.
          </p>
          <Button onClick={() => navigate(`/portal/code/${projectId}`)}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Branches
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen overflow-hidden bg-background" style={{ ["--accent-hex" as string]: "#a78bfa" }}>
      <meta name="robots" content="noindex" />
      {/* Persistent Sidebar */}
      <div className={cn(
        "shrink-0 border-r bg-muted/20 flex flex-col transition-all duration-200",
        sidebarOpen ? "w-56 lg:w-64" : "w-0 overflow-hidden border-r-0"
      )}>
        {/* Sidebar Header */}
        <div className="p-3 border-b shrink-0">
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start gap-2"
            onClick={() => navigate(`/portal/code/${projectId}`)}
          >
            <ArrowLeft className="h-4 w-4 shrink-0" />
            <span className="truncate">{branch?.name || "Branch"}</span>
          </Button>
        </div>

        {/* Sidebar Content */}
        <div className="flex-1 overflow-auto p-2">
          {sidebarSections.map((section) => (
            <div key={section.title} className="mb-6">
              <h3 className="px-3 py-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                {section.title}
              </h3>
              <div className="space-y-1">
                {section.items.map((item) => {
                  const Icon = item.icon;
                  const isActive = subpage === item.path || (!subpage && item.path === "chat");
                  return (
                    <button
                      key={item.path}
                      onClick={() => navigate(`/portal/code/${projectId}/${branchId}/${item.path}`)}
                      className={cn(
                        "w-full flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors",
                        isActive
                          ? "bg-primary text-primary-foreground"
                          : "hover:bg-muted text-muted-foreground hover:text-foreground"
                      )}
                    >
                      <Icon className="h-4 w-4 shrink-0" />
                      <span className="flex-1 text-left truncate">{item.label}</span>
                      {isActive && <ChevronRight className="h-4 w-4 shrink-0" />}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        {/* Sidebar Footer */}
        <div className="p-3 border-t shrink-0 space-y-1">
          <button
            onClick={() => navigate("/portal/chat")}
            className="w-full flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors hover:bg-muted text-muted-foreground hover:text-foreground"
          >
            <LayoutDashboard className="h-4 w-4 shrink-0" />
            <span className="flex-1 text-left">Portal</span>
          </button>
          <button
            onClick={() => navigate(`/portal/code/${projectId}/${branchId}`)}
            className={cn(
              "w-full flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors",
              !subpage
                ? "bg-primary text-primary-foreground"
                : "hover:bg-muted text-muted-foreground hover:text-foreground"
            )}
          >
            <FileCode className="h-4 w-4 shrink-0" />
            <span className="flex-1 text-left">Chat</span>
            {!subpage && <ChevronRight className="h-4 w-4 shrink-0" />}
          </button>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
        {/* Header */}
        <header className="shrink-0 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 px-4 py-3">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 shrink-0"
              onClick={() => setSidebarOpen((o) => !o)}
              aria-label={sidebarOpen ? "Hide sidebar" : "Show sidebar"}
            >
              {sidebarOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
            </Button>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-3">
                <h1 className="text-lg font-semibold truncate">Thalamus Code</h1>
                {getStatusIndicator()}
              </div>
              <div className="text-xs text-muted-foreground truncate">
                {branch?.name} · {files?.length || 0} files
              </div>
            </div>
            {branch?.executionPhase && (
              <Badge variant="outline" className="shrink-0">
                {branch.executionPhase === "planning"
                  ? "Planning Phase"
                  : `Task ${(branch.currentTaskIndex || 0) + 1}`}
              </Badge>
            )}
          </div>
        </header>

        {/* Content */}
        <div className="flex-1 min-h-0 overflow-hidden">{renderContent()}</div>
      </div>
    </div>
  );
}
