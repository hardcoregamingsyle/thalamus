import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Monitor, Terminal, Send, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { motion } from "framer-motion";

interface SandboxViewProps {
  branchId: string;
}

interface CommandLog {
  id: string;
  command: string;
  output?: string;
  error?: string;
  timestamp: number;
  isRunning?: boolean;
}

export function SandboxView({ branchId }: SandboxViewProps) {
  const [command, setCommand] = useState("");
  const [commandLogs, setCommandLogs] = useState<CommandLog[]>([]);
  const [isExecuting, setIsExecuting] = useState(false);

  const handleExecute = async () => {
    if (!command.trim()) return;

    const logId = Date.now().toString();
    const newLog: CommandLog = {
      id: logId,
      command: command.trim(),
      timestamp: Date.now(),
      isRunning: true,
    };

    setCommandLogs(prev => [...prev, newLog]);
    setCommand("");
    setIsExecuting(true);

    // Simulate command execution (in real impl, this would call VM)
    setTimeout(() => {
      setCommandLogs(prev => prev.map(log =>
        log.id === logId
          ? {
              ...log,
              isRunning: false,
              output: "Command execution is not yet connected to VM.\nThis is a placeholder for future VM integration."
            }
          : log
      ));
      setIsExecuting(false);
      toast.info("Sandbox VM integration coming soon");
    }, 1000);
  };

  const formatTimestamp = (ts: number) => {
    return new Date(ts).toLocaleTimeString();
  };

  return (
    <div className="h-full flex flex-col p-6 space-y-6">
      <div>
        <h2 className="text-2xl font-bold flex items-center gap-2">
          <Monitor className="h-6 w-6" />
          Sandbox Terminal
        </h2>
        <p className="text-muted-foreground mt-1">
          Execute commands in your development environment
        </p>
      </div>

      {/* VM Info */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Environment Info</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-3 gap-4 text-sm">
            <div>
              <div className="text-muted-foreground mb-1">OS</div>
              <Badge variant="outline">Windows 11 Pro</Badge>
            </div>
            <div>
              <div className="text-muted-foreground mb-1">RAM</div>
              <Badge variant="outline">8 GB</Badge>
            </div>
            <div>
              <div className="text-muted-foreground mb-1">Cores</div>
              <Badge variant="outline">4 vCPU</Badge>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Command Input */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Terminal className="h-4 w-4" />
            Execute Command
          </CardTitle>
          <CardDescription>
            Run commands directly in your sandbox environment
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex gap-2">
            <Input
              placeholder="npm install, git status, ls, etc..."
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleExecute();
                }
              }}
              className="font-mono"
              disabled={isExecuting}
            />
            <Button
              onClick={handleExecute}
              disabled={!command.trim() || isExecuting}
              className="gap-2"
            >
              {isExecuting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
              Run
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Command History */}
      <Card className="flex-1">
        <CardHeader>
          <CardTitle className="text-base">Command History</CardTitle>
          <CardDescription>
            Recent commands and their outputs
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ScrollArea className="h-[300px]">
            {commandLogs.length === 0 ? (
              <div className="text-center text-muted-foreground py-8">
                No commands executed yet
              </div>
            ) : (
              <div className="space-y-4">
                {commandLogs.map((log, idx) => (
                  <motion.div
                    key={log.id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: idx * 0.05 }}
                    className="border rounded-lg p-3"
                  >
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs text-muted-foreground">
                        {formatTimestamp(log.timestamp)}
                      </span>
                      {log.isRunning && (
                        <Badge className="bg-blue-500">
                          <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                          Running
                        </Badge>
                      )}
                    </div>
                    <div className="bg-muted/50 rounded p-2 mb-2">
                      <code className="text-sm font-mono">$ {log.command}</code>
                    </div>
                    {log.output && (
                      <div className="bg-background border rounded p-2">
                        <pre className="text-xs font-mono whitespace-pre-wrap">{log.output}</pre>
                      </div>
                    )}
                    {log.error && (
                      <div className="bg-red-500/10 border border-red-500/20 rounded p-2">
                        <pre className="text-xs font-mono text-red-500 whitespace-pre-wrap">{log.error}</pre>
                      </div>
                    )}
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
