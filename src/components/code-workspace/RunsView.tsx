// RunsView — start and watch a parallel run (codeOrchestrator).
//
// This is the surface for the per-task engine: a prompt becomes a plan, the
// plan becomes tasks with dependencies, and every task with its dependencies
// met runs at the same time as its siblings. That is the difference from the
// Chat tab, which drives codePipeline.ts — one agent at a time, passing work
// along with an over-to.
//
// Functions are reached by string, not through `api.codeOrchestrator.*`:
// codeOrchestrator postdates the committed _generated/api.d.ts, so the typed
// path is a flat TS2339. makeFunctionReference resolves identically at runtime
// and is the pattern already used for this situation (mcpServers.ts here, and
// thalamusApi.ts in the AgentOverflow repo). check-refs validates these by
// name and kind exactly like a typed reference.

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { makeFunctionReference } from "convex/server";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader2, Play, Square, CheckCircle2, XCircle, Clock, Ban, Users } from "lucide-react";
import { toast } from "sonner";
import { getSessionToken } from "@/lib/session";
import { errMsg } from "@/lib/errorMessage";

const listRunsRef = makeFunctionReference<
  "query",
  { token: string; branchId: string },
  Doc<"codeRuns">[]
>("codeOrchestrator:listRuns");

const getRunBoardRef = makeFunctionReference<
  "query",
  { token: string; runId: Id<"codeRuns"> },
  { run: Doc<"codeRuns">; tasks: Doc<"codeTasks">[]; events: Doc<"codeRunEvents">[] } | null
>("codeOrchestrator:getRunBoard");

const startRunRef = makeFunctionReference<
  "mutation",
  { token: string; branchId: string; prompt: string },
  { runId: Id<"codeRuns"> }
>("codeOrchestrator:startRun");

const cancelRunRef = makeFunctionReference<"mutation", { token: string; runId: Id<"codeRuns"> }>(
  "codeOrchestrator:cancelRun",
);

// A run is live while it can still change on its own. Anything else is history,
// so the Cancel control is hidden rather than left there doing nothing.
const LIVE = new Set(["queued", "running", "waiting_approval"]);

const STATUS_STYLE: Record<string, { icon: typeof Clock; className: string }> = {
  queued: { icon: Clock, className: "text-muted-foreground" },
  running: { icon: Loader2, className: "text-blue-500" },
  blocked: { icon: Ban, className: "text-amber-500" },
  completed: { icon: CheckCircle2, className: "text-green-500" },
  failed: { icon: XCircle, className: "text-red-500" },
  cancelled: { icon: Ban, className: "text-muted-foreground" },
};

function StatusIcon({ status }: { status: string }) {
  const style = STATUS_STYLE[status] ?? STATUS_STYLE.queued;
  const Icon = style.icon;
  return <Icon className={`h-4 w-4 shrink-0 ${style.className} ${status === "running" ? "animate-spin" : ""}`} />;
}

interface RunsViewProps {
  branchId: string;
}

export function RunsView({ branchId }: RunsViewProps) {
  const token = getSessionToken() ?? "";
  const [prompt, setPrompt] = useState("");
  const [starting, setStarting] = useState(false);
  const [selectedRunId, setSelectedRunId] = useState<Id<"codeRuns"> | null>(null);

  const runs = useQuery(listRunsRef, token ? { token, branchId } : "skip");
  // Nothing selected yet: follow the newest run, which is the one the user just
  // started (listRuns is ordered newest first). Selecting it implicitly rather
  // than only on click is what makes a freshly started run show its board.
  const activeRunId = selectedRunId ?? runs?.[0]?._id ?? null;
  const activeBoard = useQuery(
    getRunBoardRef,
    token && activeRunId ? { token, runId: activeRunId } : "skip",
  );
  const startRun = useMutation(startRunRef);
  const cancelRun = useMutation(cancelRunRef);

  const handleStart = async () => {
    if (!prompt.trim() || starting) return;
    setStarting(true);
    try {
      const result = await startRun({ token, branchId, prompt: prompt.trim() });
      setPrompt("");
      setSelectedRunId(result.runId);
      toast.success("Run started — planning");
    } catch (err) {
      toast.error(errMsg(err, "Failed to start run"));
    } finally {
      setStarting(false);
    }
  };

  const handleCancel = async (runId: Id<"codeRuns">) => {
    try {
      await cancelRun({ token, runId });
      toast.success("Run cancelled");
    } catch (err) {
      toast.error(errMsg(err, "Failed to cancel run"));
    }
  };

  const running = activeBoard?.tasks.filter((t) => t.status === "running").length ?? 0;

  return (
    <div className="flex-1 overflow-auto p-6 space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" />
            Parallel run
          </CardTitle>
          <CardDescription>
            The team plans your goal into tasks, then works on every task whose dependencies are
            met at the same time. No turn-taking, and nothing stops to ask.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="What should the team build?"
            rows={3}
            disabled={starting}
          />
          <Button onClick={handleStart} disabled={!prompt.trim() || starting}>
            {starting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
            Start parallel run
          </Button>
        </CardContent>
      </Card>

      {runs === undefined ? (
        <div className="flex justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : runs.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-8">
          No runs yet. Describe a goal above to start one.
        </p>
      ) : (
        <div className="space-y-2">
          {runs.map((run) => (
            <Card
              key={run._id}
              className={`cursor-pointer transition-colors ${run._id === activeRunId ? "border-primary" : ""}`}
              onClick={() => setSelectedRunId(run._id)}
            >
              <CardHeader className="py-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <StatusIcon status={run.status} />
                      <span className="truncate text-sm font-medium">{run.prompt}</span>
                    </div>
                    {run.summary && (
                      <p className="mt-1 text-xs text-muted-foreground line-clamp-2">{run.summary}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Badge variant="secondary">{run.status}</Badge>
                    {LIVE.has(run.status) && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={(e) => {
                          e.stopPropagation();
                          void handleCancel(run._id);
                        }}
                      >
                        <Square className="h-3 w-3" />
                      </Button>
                    )}
                  </div>
                </div>
              </CardHeader>
            </Card>
          ))}
        </div>
      )}

      {activeBoard && (
        <>
          <Card>
            <CardHeader className="py-3">
              <CardTitle className="text-base">
                Tasks
                {running > 0 && (
                  <span className="ml-2 text-xs font-normal text-blue-500">
                    {running} running at once
                  </span>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {activeBoard.tasks.length === 0 ? (
                <p className="text-sm text-muted-foreground">Planning — no tasks yet.</p>
              ) : (
                activeBoard.tasks.map((task) => (
                  <div key={task._id} className="rounded-md border p-3">
                    <div className="flex items-center gap-2">
                      <StatusIcon status={task.status} />
                      <span className="text-sm font-medium">{task.title}</span>
                      <Badge variant="outline" className="ml-auto shrink-0">
                        {task.agent}
                      </Badge>
                    </div>
                    {task.description && (
                      <p className="mt-2 text-xs text-muted-foreground">{task.description}</p>
                    )}
                    {task.result && (
                      <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap rounded bg-muted p-2 text-xs">
                        {task.result}
                      </pre>
                    )}
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="py-3">
              <CardTitle className="text-base">Activity</CardTitle>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-56">
                <div className="space-y-1 pr-3">
                  {activeBoard.events.map((event) => (
                    <div key={event._id} className="flex gap-2 text-xs">
                      <span className="shrink-0 font-mono text-muted-foreground">{event.type}</span>
                      <span className="text-muted-foreground">{event.content}</span>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
