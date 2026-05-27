import { useState, useRef, useEffect } from "react";
import { useQuery, useAction } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useNavigate, useParams } from "react-router";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Send, Loader2, CheckCircle2, Pause, Play, FileCode, Database, Activity, Wrench, Code2, GitBranch as GitIcon, Rocket, Monitor, Key, X } from "lucide-react";
import { toast } from "sonner";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import { DataView } from "@/components/code-workspace/DataView";
import { LogsView } from "@/components/code-workspace/LogsView";
import { EditorView } from "@/components/code-workspace/EditorView";
import { SandboxView } from "@/components/code-workspace/SandboxView";
import { KeysView } from "@/components/code-workspace/KeysView";

const sidebarItems = [
  { title: "Backend", items: [
    { label: "Data", icon: Database, path: "data" },
    { label: "Logs", icon: Activity, path: "logs" },
  ]},
  { title: "Workspace", items: [
    { label: "Editor", icon: Code2, path: "editor" },
    { label: "Sandbox", icon: Monitor, path: "sandbox" },
    { label: "Keys", icon: Key, path: "keys" },
  ]},
];

export default function CodeWorkspace() {
  const navigate = useNavigate();
  const { projectId, branchId, subpage } = useParams<{ projectId: string; branchId: string; subpage?: string }>();
  const token = localStorage.getItem("agentai_session_token") || "";

  const branch = useQuery(api.codeBranches.watchBranch, branchId ? { branchId } : "skip");
  const messages = useQuery(api.codeBranches.watchMessages, branchId ? { branchId } : "skip");
  const files = useQuery(api.codeBranches.watchFiles, branchId ? { branchId } : "skip");
  const startPipeline = useAction(api.codePipeline.startPipeline);

  const [input, setInput] = useState("");
  const [isSending, setIsSending] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

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
      setInput(userPrompt); // Restore input on error
    } finally {
      setIsSending(false);
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

  if (!projectId || !branchId) {
    return <div className="p-8">Invalid project or branch ID</div>;
  }

  // Render sidebar view if subpage is set
  const renderContent = () => {
    switch (subpage) {
      case "data":
        return <DataView branchId={branchId} />;
      case "logs":
        return <LogsView branchId={branchId} />;
      case "editor":
        return <EditorView branchId={branchId} />;
      case "sandbox":
        return <SandboxView branchId={branchId} />;
      case "keys":
        return <KeysView projectId={projectId} branchId={branchId} />;
      default:
        return null;
    }
  };

  return (
    <div className="flex h-screen bg-background">
      {/* Main Content */}
      <div className="flex-1 flex flex-col">
        {/* Header */}
        <header className="border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 px-6 py-4">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" onClick={() => navigate(`/portal/code/${projectId}`)}>
              <ArrowLeft className="h-5 w-5" />
            </Button>
            {!subpage && (
              <Button
                variant="ghost"
                size="icon"
                onClick={() => navigate(`/portal/code/${projectId}/${branchId}/data`)}
              >
                <Wrench className="h-5 w-5" />
              </Button>
            )}
            {subpage && (
              <Button
                variant="ghost"
                size="icon"
                onClick={() => navigate(`/portal/code/${projectId}/${branchId}`)}
              >
                <X className="h-5 w-5" />
              </Button>
            )}
            <div className="flex-1">
              <div className="flex items-center gap-3">
                <h1 className="text-xl font-semibold">Thalamus Code</h1>
                {getStatusIndicator()}
              </div>
              <div className="text-sm text-muted-foreground mt-1">
                {branch?.name} · {files?.length || 0} files
              </div>
            </div>
            {branch?.executionPhase && (
              <Badge variant="outline">
                {branch.executionPhase === "planning" ? "Planning Phase" : `Task ${(branch.currentTaskIndex || 0) + 1}`}
              </Badge>
            )}
          </div>
        </header>

        {/* Sidebar View or Messages Area */}
        {subpage ? (
          <div className="flex-1 overflow-hidden">
            {renderContent()}
          </div>
        ) : (
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
            messages.map((msg, idx) => (
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
                  <div className={cn(
                    "w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold",
                    msg.agent === "User" ? "bg-primary text-primary-foreground" : "bg-muted-foreground text-background"
                  )}>
                    {msg.agent.slice(0, 2).toUpperCase()}
                  </div>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-semibold text-sm">{msg.agent}</span>
                    {msg.round !== undefined && (
                      <Badge variant="outline" className="text-xs">Round {msg.round}</Badge>
                    )}
                  </div>
                  <div className="text-sm whitespace-pre-wrap break-words">{msg.content}</div>
                </div>
              </motion.div>
            ))
          )}
          <div ref={messagesEndRef} />
          </div>
        )}

        {/* Input Area - Only show in chat view */}
        {!subpage && (
          <div className="border-t bg-background p-4">
          <div className="max-w-4xl mx-auto">
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
              <Button
                size="lg"
                onClick={handleSend}
                disabled={!input.trim() || isSending || branch?.status === "running"}
                className="px-8"
              >
                {isSending ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : (
                  <Send className="h-5 w-5" />
                )}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground mt-2 text-center">
              The AI team will run commands in your VM and may request API keys
            </p>
          </div>
          </div>
        )}
      </div>
    </div>
  );
}
