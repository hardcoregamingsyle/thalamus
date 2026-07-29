import { useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Doc } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Terminal, Send, Loader2, ExternalLink, Cpu, Laptop, Cloud,
  CheckCircle2, XCircle, Clock, GitBranch,
} from "lucide-react";
import { toast } from "sonner";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

interface SandboxViewProps {
  projectId: string;
  branchId: string;
}

type RunnerOs = "ubuntu" | "windows" | "macos";

const RUNNERS: Array<{ value: RunnerOs; label: string; hint: string }> = [
  { value: "ubuntu", label: "Linux", hint: "Servers, containers, most web builds" },
  { value: "windows", label: "Windows", hint: "Desktop apps, .NET, Windows-only toolchains" },
  { value: "macos", label: "macOS", hint: "Apple platforms, Swift, iOS builds" },
];

export function SandboxView({ projectId, branchId }: SandboxViewProps) {
  const token = localStorage.getItem("agentai_session_token") || "";

  const branch = useQuery(api.codeBranches.getBranch, token ? { token, branchId } : "skip");
  const config = useQuery(
    api.githubQueries.getGithubConfig,
    token ? { token, projectId, branchId } : "skip",
  );
  const commands = useQuery(api.codeCommands.watchCommands, { branchId });
  const updateBranch = useMutation(api.codeBranches.updateBranch);
  const runManualCommand = useMutation(api.codeCommands.runManualCommand);

  const [command, setCommand] = useState("");
  const [sending, setSending] = useState(false);

  const isLocal = branch?.executor === "local";
  const runnerOs = (branch?.runnerOs ?? "ubuntu") as RunnerOs;

  const handleRunnerChange = async (value: string) => {
    try {
      await updateBranch({ token, branchId, runnerOs: value as RunnerOs });
      toast.success(`Builds will run on ${RUNNERS.find((r) => r.value === value)?.label}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not change the runner");
    }
  };

  const handleSend = async () => {
    const cmd = command.trim();
    if (!cmd || sending) return;
    setSending(true);
    try {
      await runManualCommand({ token, branchId, command: cmd });
      setCommand("");
      toast.success(isLocal ? "Queued for your machine" : "Dispatched to the build runner");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not run the command");
    } finally {
      setSending(false);
    }
  };

  const statusBadge = (cmd: Doc<"codeCommands">) => {
    switch (cmd.status) {
      case "completed":
        return (
          <Badge variant="outline" className="gap-1 border-primary/40 text-primary">
            <CheckCircle2 className="h-3 w-3" />exit {cmd.exitCode ?? 0}
          </Badge>
        );
      case "failed":
        return (
          <Badge variant="outline" className="gap-1 border-destructive/40 text-destructive">
            <XCircle className="h-3 w-3" />exit {cmd.exitCode ?? 1}
          </Badge>
        );
      case "running":
        return (
          <Badge variant="outline" className="gap-1 border-amber-400/40 text-amber-400">
            <Loader2 className="h-3 w-3 animate-spin" />running
          </Badge>
        );
      default:
        return (
          <Badge variant="outline" className="gap-1 text-muted-foreground">
            <Clock className="h-3 w-3" />queued
          </Badge>
        );
    }
  };

  return (
    <div className="flex-1 overflow-auto p-6 space-y-4">
      <div>
        <h2 className="text-xl font-semibold flex items-center gap-2">
          <Terminal className="h-5 w-5 text-primary" />
          Build Runner
        </h2>
        <p className="text-sm text-muted-foreground mt-1">
          Commands from the agents — and from you — run on a clean machine, then report back here.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {/* Where commands run */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              {isLocal ? <Laptop className="h-4 w-4" /> : <Cloud className="h-4 w-4" />}
              {isLocal ? "This machine" : "Cloud runner"}
            </CardTitle>
            <CardDescription>
              {isLocal
                ? "The desktop app is running this branch's commands locally."
                : "A fresh machine per command, with the full toolchain already installed."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {!isLocal && (
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">Build and test on</p>
                <Select value={runnerOs} onValueChange={handleRunnerChange}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {RUNNERS.map((r) => (
                      <SelectItem key={r.value} value={r.value}>
                        <div className="flex items-center gap-2">
                          <Cpu className="h-3.5 w-3.5" />
                          {r.label}
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  {RUNNERS.find((r) => r.value === runnerOs)?.hint}
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Source control for this branch */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <GitBranch className="h-4 w-4" />
              Source control
            </CardTitle>
            <CardDescription>
              {config
                ? "Every agent change is committed here before it runs."
                : "Setting up — this appears once the branch's repository is ready."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {config ? (
              <>
                <Button asChild variant="outline" size="sm" className="w-full gap-2">
                  <a href={config.repoUrl} target="_blank" rel="noopener noreferrer">
                    <ExternalLink className="h-3.5 w-3.5" />
                    Open repository
                  </a>
                </Button>
                <Button asChild variant="outline" size="sm" className="w-full gap-2">
                  <a href={`${config.repoUrl}/actions`} target="_blank" rel="noopener noreferrer">
                    <ExternalLink className="h-3.5 w-3.5" />
                    Open build history
                  </a>
                </Button>
                {config.sourceRepoUrl && (
                  <p className="text-xs text-muted-foreground pt-1">
                    Imported from{" "}
                    <a
                      href={config.sourceRepoUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary underline underline-offset-2"
                    >
                      {config.sourceRepoUrl.replace("https://github.com/", "")}
                      {config.sourceBranch ? `@${config.sourceBranch}` : ""}
                    </a>
                  </p>
                )}
              </>
            ) : (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Preparing this branch
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Run a command */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Run a command</CardTitle>
          <CardDescription>
            Runs against this branch's files, exactly like the agents do.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex gap-2">
            <Input
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void handleSend();
                }
              }}
              placeholder="npm test, cargo build, pytest…"
              className="font-mono text-sm"
              disabled={sending}
            />
            <Button onClick={handleSend} disabled={!command.trim() || sending} className="gap-2">
              {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              Run
            </Button>
          </div>
          {!isLocal && (
            <p className="text-xs text-muted-foreground mt-2">
              A fresh machine takes a moment to pick the job up — output lands below when it does.
            </p>
          )}
        </CardContent>
      </Card>

      {/* History */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Output</CardTitle>
        </CardHeader>
        <CardContent>
          {commands === undefined ? (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : commands.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">
              Nothing has run on this branch yet.
            </p>
          ) : (
            <ScrollArea className="h-[380px] pr-4">
              <div className="space-y-3">
                {commands.map((cmd: Doc<"codeCommands">) => (
                  <motion.div
                    key={cmd._id}
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="border rounded-lg overflow-hidden"
                  >
                    <div className="flex items-center justify-between gap-2 px-3 py-2 bg-muted/40">
                      <code className="text-xs font-mono truncate">$ {cmd.command}</code>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-xs text-muted-foreground">{cmd.agent}</span>
                        {statusBadge(cmd)}
                      </div>
                    </div>
                    {cmd.output && (
                      <pre
                        className={cn(
                          "text-xs font-mono p-3 whitespace-pre-wrap break-all max-h-56 overflow-auto",
                          cmd.status === "failed" ? "text-destructive" : "text-muted-foreground",
                        )}
                      >
                        {cmd.output}
                      </pre>
                    )}
                  </motion.div>
                ))}
              </div>
            </ScrollArea>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
