import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Doc } from "@/convex/_generated/dataModel";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Activity, Terminal, AlertCircle, CheckCircle2, Clock } from "lucide-react";
import { motion } from "framer-motion";

interface LogsViewProps {
  branchId: string;
}

export function LogsView({ branchId }: LogsViewProps) {
  const commands = useQuery(api.codeCommands.watchCommands, { branchId });
  const messages = useQuery(api.codeBranches.watchMessages, { branchId });

  const formatTimestamp = (ts: number) => {
    return new Date(ts).toLocaleString();
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "completed":
        return <CheckCircle2 className="h-4 w-4 text-green-500" />;
      case "failed":
        return <AlertCircle className="h-4 w-4 text-red-500" />;
      case "running":
        return <Activity className="h-4 w-4 text-blue-500 animate-pulse" />;
      default:
        return <Clock className="h-4 w-4 text-yellow-500" />;
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "completed":
        return <Badge className="bg-green-500">Completed</Badge>;
      case "failed":
        return <Badge className="bg-red-500">Failed</Badge>;
      case "running":
        return <Badge className="bg-blue-500">Running</Badge>;
      default:
        return <Badge variant="outline">Pending</Badge>;
    }
  };

  return (
    <div className="h-full flex flex-col p-6 space-y-6">
      <div>
        <h2 className="text-2xl font-bold flex items-center gap-2">
          <Activity className="h-6 w-6" />
          Execution Logs
        </h2>
        <p className="text-muted-foreground mt-1">
          View all commands and agent activity
        </p>
      </div>

      {/* Commands Section */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Terminal className="h-5 w-5" />
            Commands ({commands?.length || 0})
          </CardTitle>
          <CardDescription>
            All commands executed by the AI agents
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ScrollArea className="h-[300px]">
            {commands === undefined ? (
              <div className="text-center text-muted-foreground py-8">Loading...</div>
            ) : commands.length === 0 ? (
              <div className="text-center text-muted-foreground py-8">No commands yet</div>
            ) : (
              <div className="space-y-3">
                {commands.map((cmd: Doc<"codeCommands">, idx: number) => (
                  <motion.div
                    key={cmd._id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: idx * 0.05 }}
                    className="border rounded-lg p-4 hover:bg-muted/50 transition-colors"
                  >
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div className="flex items-center gap-2">
                        {getStatusIcon(cmd.status)}
                        <span className="font-semibold text-sm">{cmd.agent}</span>
                      </div>
                      {getStatusBadge(cmd.status)}
                    </div>
                    <div className="bg-muted/50 rounded p-2 mb-2">
                      <code className="text-sm font-mono">{cmd.command}</code>
                    </div>
                    {cmd.output && (
                      <div className="bg-background border rounded p-2 mb-2">
                        <pre className="text-xs font-mono whitespace-pre-wrap">{cmd.output}</pre>
                      </div>
                    )}
                    <div className="text-xs text-muted-foreground">
                      Created: {formatTimestamp(cmd.createdAt)}
                      {cmd.completedAt && ` • Completed: ${formatTimestamp(cmd.completedAt)}`}
                    </div>
                  </motion.div>
                ))}
              </div>
            )}
          </ScrollArea>
        </CardContent>
      </Card>

      {/* Agent Activity */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Activity className="h-5 w-5" />
            Agent Activity
          </CardTitle>
          <CardDescription>
            Recent agent messages and actions
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ScrollArea className="h-[200px]">
            {messages === undefined ? (
              <div className="text-center text-muted-foreground py-8">Loading...</div>
            ) : messages.length === 0 ? (
              <div className="text-center text-muted-foreground py-8">No activity yet</div>
            ) : (
              <div className="space-y-2">
                {messages.slice(-10).reverse().map((msg: Doc<"codeMessages">, idx: number) => (
                  <motion.div
                    key={msg._id}
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: idx * 0.03 }}
                    className="text-sm border-l-2 border-primary/20 pl-3 py-1"
                  >
                    <div className="flex items-center gap-2">
                      <span className="font-semibold">{msg.agent}</span>
                      {msg.round !== undefined && (
                        <Badge variant="outline" className="text-xs">R{msg.round}</Badge>
                      )}
                      <span className="text-xs text-muted-foreground ml-auto">
                        {new Date(msg.createdAt).toLocaleTimeString()}
                      </span>
                    </div>
                  </motion.div>
                ))}
              </div>
            )}
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  );
}
