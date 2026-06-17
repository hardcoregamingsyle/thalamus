import { useState, useRef, useEffect } from "react";
import { useQuery, useAction, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useNavigate, useParams } from "react-router";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Send, Loader2, CheckCircle2, Pause, Play, FileCode, Database, Activity, Code2, Monitor, Key, BarChart3, GitBranch, Rocket, ChevronRight, Menu, X } from "lucide-react";
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
              <div className="px-3 pb-3 border-t border-border/20 pt-2 text-xs leading-relaxed [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:rounded [&_code]:text-xs [&_code]:font-mono [&_pre]:bg-muted [&_pre]:p-3 [&_pre]:rounded-md [&_pre]:overflow-x-auto [&_pre]:text-xs [&_pre]:font-mono [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_ul]:list-disc [&_ul]:pl-4 [&_ol]:list-decimal [&_ol]:pl-4 [&_p]:mb-1.5">
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
  const token = localStorage.getItem("agentai_session_token") || "";

  const branch = useQuery(api.codeBranches.watchBranch, branchId ? { branchId } : "skip");
  const messages = useQuery(api.codeBranches.watchMessages, branchId ? { branchId } : "skip");
  const files = useQuery(api.codeBranches.watchFiles, branchId ? { branchId } : "skip");
  const startPipeline = useAction(api.codePipeline.startPipeline);
  const stopPipeline = useAction(api.codePipeline.stopPipeline);

  const [input, setInput] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const setRunMode = useMutation(api.codeBranches.setRunMode);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSend = async () => {
    if (!input.trim() || !branchId || isSending) return;

    const userPrompt = input.trim();
    setInput("");
    setIsSending(true);

    try {
      await startPipeline({ token, branchId, userPrompt });
      toast.success("Pipeline started!");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to start pipeline");
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
      toast.error(err instanceof Error ? err.message : "Failed to stop pipeline");
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
        return <DeployView branchId={branchId} />;
      case "sandbox":
        return <SandboxView branchId={branchId} />;
      case "keys":
        return <KeysView projectId={projectId} branchId={branchId} />;
      default:
        // Chat view
        return (
          <div className="flex-1 flex flex-col h-full">
            <div className="flex-1 overflow-y-auto p-6 space-y-4">
              {messages === undefined ? (
                <div className="flex items-center justify-center h-full">
                  <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                </div>
              ) : messages.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-center">
                  <div className="rounded-full bg-primary/10 p-6 mb-4">
                    <FileCode className="h-12 w-12 text-primary" />
                  </div>
                  <h2 className="text-2xl font-semibold mb-2">Start Building</h2>
                  <p className="text-muted-foreground max-w-md">
                    Describe what you want to build and the AI team will handle the rest
                  </p>
                </div>
              ) : (
                messages.map((msg: any, idx: number) => (
                  <motion.div
                    key={idx}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className={cn(
                      "flex gap-3 p-4 rounded-lg",
                      msg.agent === "User" ? "bg-primary/5 ml-12" : "bg-muted/50"
                    )}
                  >
                    <div className="flex-shrink-0">
                      <div
                        className={cn(
                          "w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold",
                          msg.agent === "User"
                            ? "bg-primary text-primary-foreground"
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
              <div ref={messagesEndRef} />
            </div>

            {/* Input Area */}
            <div className="border-t bg-background p-4">
              <div className="max-w-4xl mx-auto">
                {/* Run Mode selector */}
                <div className="flex gap-2 mb-3">
                  {(["cheap", "balanced", "powerful"] as const).map((mode) => (
                    <button
                      key={mode}
                      onClick={() => branchId && setRunMode({ token, branchId, runMode: mode })}
                      className={cn(
                        "px-3 py-1 rounded-full text-xs font-medium border transition-colors",
                        (branch?.runMode ?? "balanced") === mode
                          ? mode === "cheap"
                            ? "bg-emerald-500/20 border-emerald-500 text-emerald-400"
                            : mode === "balanced"
                            ? "bg-blue-500/20 border-blue-500 text-blue-400"
                            : "bg-purple-500/20 border-purple-500 text-purple-400"
                          : "border-muted text-muted-foreground hover:border-foreground/50"
                      )}
                    >
                      {mode === "cheap" ? "⚡ Cheap" : mode === "balanced" ? "⚖️ Balanced" : "🔥 Powerful"}
                    </button>
                  ))}
                  <span className="ml-auto text-xs text-muted-foreground self-center">
                    {(branch?.runMode ?? "balanced") === "cheap"
                      ? "Gemini + DeepSeek — fast & affordable"
                      : (branch?.runMode ?? "balanced") === "balanced"
                      ? "Sonnet + DeepSeek — best value"
                      : "Opus + GPT-5 — maximum intelligence"}
                  </span>
                </div>
                <div className="flex gap-2">
                  <Textarea
                    placeholder={
                      branch?.status === "running"
                        ? "Pipeline is running..."
                        : "Tell the AI team what to build..."
                    }
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        handleSend();
                      }
                    }}
                    className="min-h-[60px] resize-none"
                    disabled={isSending || branch?.status === "running"}
                  />
                  {branch?.status === "running" ? (
                    <Button
                      size="lg"
                      onClick={handleStop}
                      variant="destructive"
                      className="px-8"
                    >
                      <Pause className="h-5 w-5" />
                    </Button>
                  ) : (
                    <Button
                      size="lg"
                      onClick={handleSend}
                      disabled={!input.trim() || isSending}
                      className="px-8"
                    >
                      {isSending ? (
                        <Loader2 className="h-5 w-5 animate-spin" />
                      ) : (
                        <Send className="h-5 w-5" />
                      )}
                    </Button>
                  )}
                </div>
                <p className="text-xs text-muted-foreground mt-2 text-center">
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

  return (
    <div className="flex h-screen overflow-hidden bg-background">
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
        <div className="flex-1 overflow-y-auto p-2">
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
        <div className="p-3 border-t shrink-0">
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
