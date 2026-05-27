import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Monitor, Terminal, Send, Loader2, Maximize2, Minimize2, Power, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

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
  const [vmStatus, setVmStatus] = useState<"booting" | "running" | "stopped">("stopped");
  const [isFullscreen, setIsFullscreen] = useState(false);
  const vmDisplayRef = useRef<HTMLDivElement>(null);

  const handleExecute = async () => {
    if (!command.trim()) return;

    const logId = Date.now().toString();
    const newLog: CommandLog = {
      id: logId,
      command: command.trim(),
      timestamp: Date.now(),
      isRunning: true,
    };

    setCommandLogs((prev) => [...prev, newLog]);
    setCommand("");
    setIsExecuting(true);

    // Simulate command execution (in real impl, this would call VM)
    setTimeout(() => {
      setCommandLogs((prev) =>
        prev.map((log) =>
          log.id === logId
            ? {
                ...log,
                isRunning: false,
                output: "Command execution is not yet connected to VM.\nThis is a placeholder for future VM integration.",
              }
            : log
        )
      );
      setIsExecuting(false);
      toast.info("VM integration coming soon");
    }, 1000);
  };

  const handleBootVM = () => {
    setVmStatus("booting");
    toast.info("Booting Windows 11 VM...");

    // Simulate boot process
    setTimeout(() => {
      setVmStatus("running");
      toast.success("VM is ready!");
    }, 3000);
  };

  const handleStopVM = () => {
    setVmStatus("stopped");
    toast.info("VM stopped");
  };

  const handleResetVM = () => {
    setVmStatus("booting");
    toast.info("Resetting VM...");
    setTimeout(() => {
      setVmStatus("running");
      toast.success("VM reset complete");
    }, 2000);
  };

  const formatTimestamp = (ts: number) => {
    return new Date(ts).toLocaleTimeString();
  };

  return (
    <div className="h-full flex flex-col">
      {/* VM Display Area */}
      <div className={cn(
        "border-b transition-all",
        isFullscreen ? "h-full" : "h-[60vh]"
      )}>
        {/* VM Controls */}
        <div className="border-b bg-muted/50 px-4 py-2 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Monitor className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium">Windows 11 Pro</span>
            <Badge
              variant={vmStatus === "running" ? "default" : "secondary"}
              className={cn(
                vmStatus === "running" && "bg-green-500",
                vmStatus === "booting" && "bg-yellow-500"
              )}
            >
              {vmStatus === "running" && "Running"}
              {vmStatus === "booting" && "Booting..."}
              {vmStatus === "stopped" && "Stopped"}
            </Badge>
          </div>

          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-xs">8 GB RAM</Badge>
            <Badge variant="outline" className="text-xs">4 vCPU</Badge>

            {vmStatus === "stopped" && (
              <Button size="sm" onClick={handleBootVM} className="gap-2">
                <Power className="h-3 w-3" />
                Boot VM
              </Button>
            )}

            {vmStatus === "running" && (
              <>
                <Button size="sm" variant="outline" onClick={handleResetVM} className="gap-2">
                  <RotateCcw className="h-3 w-3" />
                  Reset
                </Button>
                <Button size="sm" variant="destructive" onClick={handleStopVM} className="gap-2">
                  <Power className="h-3 w-3" />
                  Stop
                </Button>
              </>
            )}

            <Button
              size="sm"
              variant="ghost"
              onClick={() => setIsFullscreen(!isFullscreen)}
            >
              {isFullscreen ? (
                <Minimize2 className="h-4 w-4" />
              ) : (
                <Maximize2 className="h-4 w-4" />
              )}
            </Button>
          </div>
        </div>

        {/* VM Display */}
        <div
          ref={vmDisplayRef}
          className="w-full h-[calc(100%-3rem)] bg-black relative overflow-hidden cursor-crosshair"
        >
          {vmStatus === "stopped" && (
            <div className="absolute inset-0 flex flex-col items-center justify-center text-white">
              <Power className="h-16 w-16 mb-4 opacity-50" />
              <p className="text-lg font-medium mb-2">VM is stopped</p>
              <p className="text-sm text-white/60 mb-4">Click "Boot VM" to start</p>
            </div>
          )}

          {vmStatus === "booting" && (
            <div className="absolute inset-0 flex flex-col items-center justify-center text-white">
              <Loader2 className="h-16 w-16 mb-4 animate-spin" />
              <p className="text-lg font-medium mb-2">Booting Windows 11...</p>
              <p className="text-sm text-white/60">This may take a few moments</p>
            </div>
          )}

          {vmStatus === "running" && (
            <div className="absolute inset-0 flex flex-col items-center justify-center text-white bg-gradient-to-br from-blue-900 to-blue-600">
              {/* Simulated Windows 11 Desktop */}
              <div className="text-center">
                <div className="w-24 h-24 rounded-2xl bg-white/10 backdrop-blur-sm border border-white/20 flex items-center justify-center mb-6">
                  <Monitor className="h-12 w-12 text-white" />
                </div>
                <h2 className="text-2xl font-bold mb-2">Windows 11 Pro</h2>
                <p className="text-white/80 mb-6">VM Display Ready</p>
                <div className="bg-black/30 backdrop-blur-sm border border-white/20 rounded-lg p-6 max-w-md">
                  <p className="text-sm text-white/90 mb-2">
                    <strong>Note:</strong> VM display integration is in progress
                  </p>
                  <p className="text-xs text-white/70">
                    This area will show the actual Windows 11 desktop with full mouse and keyboard interaction.
                    The VM will be powered by v86 or QEMU for browser-based virtualization.
                  </p>
                </div>
              </div>

              {/* Simulated Windows Taskbar */}
              <div className="absolute bottom-0 left-0 right-0 h-12 bg-black/40 backdrop-blur-md border-t border-white/10 flex items-center px-4">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded bg-blue-500 flex items-center justify-center">
                    <span className="text-white text-xs font-bold">⊞</span>
                  </div>
                  <div className="w-8 h-8 rounded bg-white/10 hover:bg-white/20 transition-colors cursor-pointer"></div>
                  <div className="w-8 h-8 rounded bg-white/10 hover:bg-white/20 transition-colors cursor-pointer"></div>
                </div>
                <div className="ml-auto text-xs text-white/90">
                  {new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </div>
              </div>
            </div>
          )}

          {/* Canvas for actual VM display (when integrated) */}
          <canvas
            id="vm-display"
            className="w-full h-full hidden"
            style={{ imageRendering: "pixelated" }}
          />
        </div>
      </div>

      {/* Terminal Section (collapsible when fullscreen) */}
      {!isFullscreen && (
        <div className="flex-1 flex flex-col min-h-0 p-6 space-y-4">
          <div>
            <h3 className="text-lg font-semibold flex items-center gap-2">
              <Terminal className="h-5 w-5" />
              Terminal
            </h3>
            <p className="text-sm text-muted-foreground">
              Execute commands in the VM sandbox
            </p>
          </div>

          {/* Command Input */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Execute Command</CardTitle>
              <CardDescription>
                Run commands directly in the VM environment
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex gap-2">
                <Input
                  placeholder="npm install, git status, dir, etc..."
                  value={command}
                  onChange={(e) => setCommand(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      handleExecute();
                    }
                  }}
                  className="font-mono"
                  disabled={isExecuting || vmStatus !== "running"}
                />
                <Button
                  onClick={handleExecute}
                  disabled={!command.trim() || isExecuting || vmStatus !== "running"}
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
              {vmStatus !== "running" && (
                <p className="text-xs text-muted-foreground mt-2">
                  Boot the VM to execute commands
                </p>
              )}
            </CardContent>
          </Card>

          {/* Command History */}
          <Card className="flex-1 min-h-0">
            <CardHeader>
              <CardTitle className="text-base">Command History</CardTitle>
              <CardDescription>Recent commands and their outputs</CardDescription>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-[200px]">
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
                            <pre className="text-xs font-mono whitespace-pre-wrap">
                              {log.output}
                            </pre>
                          </div>
                        )}
                        {log.error && (
                          <div className="bg-red-500/10 border border-red-500/20 rounded p-2">
                            <pre className="text-xs font-mono text-red-500 whitespace-pre-wrap">
                              {log.error}
                            </pre>
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
      )}
    </div>
  );
}
