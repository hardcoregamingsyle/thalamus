import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Monitor, Terminal, Send, Loader2, Maximize2, Minimize2, Power, RotateCcw, Settings } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
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

interface VMConfig {
  os: string;
  ram: number;
  cores: number;
  cdrom?: string;
  hda?: { url: string; async?: boolean; size?: number };
  fda?: { url: string; async?: boolean };
  name: string;
  description: string;
  is64Bit?: boolean;
}

declare global {
  interface Window {
    V86?: any;
  }
}

const OS_CONFIGS: Record<string, VMConfig> = {
  "linux-alpine": {
    os: "Linux Alpine",
    ram: 256,
    cores: 1,
    cdrom: "https://copy.sh/v86/images/linux4.iso",
    name: "Alpine Linux",
    description: "Lightweight Linux (256MB, boots in 5s)",
    is64Bit: false,
  },
  "linux-arch": {
    os: "Linux Arch",
    ram: 512,
    cores: 2,
    cdrom: "https://copy.sh/v86/images/archlinux.iso",
    name: "Arch Linux",
    description: "Full Linux distro (512MB, boots in 30s)",
    is64Bit: false,
  },
  "windows-98": {
    os: "Windows 98",
    ram: 256,
    cores: 1,
    hda: { url: "https://copy.sh/v86/images/windows98.img", async: true, size: 300 * 1024 * 1024 },
    name: "Windows 98",
    description: "Classic Windows with GUI (256MB)",
    is64Bit: false,
  },
  "kolibrios": {
    os: "KolibriOS",
    ram: 64,
    cores: 1,
    fda: { url: "https://copy.sh/v86/images/kolibri.img", async: false },
    name: "KolibriOS",
    description: "Ultra-fast tiny OS (64MB, instant boot)",
    is64Bit: false,
  },
};

export function SandboxView({ branchId }: SandboxViewProps) {
  const [command, setCommand] = useState("");
  const [commandLogs, setCommandLogs] = useState<CommandLog[]>([]);
  const [isExecuting, setIsExecuting] = useState(false);
  const [vmStatus, setVmStatus] = useState<"booting" | "running" | "stopped">("stopped");
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isConfigOpen, setIsConfigOpen] = useState(false);
  const [selectedOS, setSelectedOS] = useState("linux-alpine");
  const [customRam, setCustomRam] = useState(256);
  const [customCores, setCustomCores] = useState(1);
  const [v86Loaded, setV86Loaded] = useState(false);
  const emulatorRef = useRef<any>(null);
  const screenContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const loadV86 = () => {
      if (window.V86) {
        setV86Loaded(true);
        return;
      }

      const existingScript = document.querySelector('script[src*="libv86.js"]');
      if (existingScript) {
        return;
      }

      const script = document.createElement('script');
      script.src = 'https://copy.sh/v86/libv86.js';
      script.async = true;
      script.onload = () => {
        console.log("v86 loaded successfully");
        setV86Loaded(true);
        toast.success("v86 emulator ready");
      };
      script.onerror = () => {
        console.error("Failed to load v86");
        setV86Loaded(false);
        toast.error("Failed to load v86 emulator");
      };
      document.body.appendChild(script);
    };

    loadV86();

    return () => {
      if (emulatorRef.current) {
        try {
          emulatorRef.current.stop();
        } catch (err) {
          console.error("Error stopping emulator:", err);
        }
      }
    };
  }, []);

  const handleBootVM = async () => {
    const config = OS_CONFIGS[selectedOS];

    if (!window.V86) {
      toast.error("v86 library not loaded yet. Please wait a moment.");
      return;
    }

    setVmStatus("booting");
    toast.info(`Booting ${config.name}...`);

    try {
      const vmConfig: any = {
        wasm_path: "https://copy.sh/v86/v86.wasm",
        memory_size: customRam * 1024 * 1024,
        vga_memory_size: 8 * 1024 * 1024,
        screen_container: screenContainerRef.current,
        bios: {
          url: "https://copy.sh/v86/bios/seabios.bin",
        },
        vga_bios: {
          url: "https://copy.sh/v86/bios/vgabios.bin",
        },
        autostart: true,
      };

      if (config.cdrom) {
        vmConfig.cdrom = { url: config.cdrom };
      }
      if (config.hda) {
        vmConfig.hda = config.hda;
      }
      if (config.fda) {
        vmConfig.fda = config.fda;
      }

      const emulator = new window.V86(vmConfig);
      emulatorRef.current = emulator;

      // Auto-detect when VM is ready
      const bootDelay = config.os === "KolibriOS" || config.os === "FreeDOS" ? 2000 :
                        config.os === "Linux Alpine" ? 5000 :
                        config.os === "Linux Arch" ? 30000 :
                        90000; // Windows 98/XP

      setTimeout(() => {
        setVmStatus("running");
        toast.success(`${config.name} is ready! Click display to interact.`);
      }, bootDelay);
    } catch (err) {
      console.error("VM boot error:", err);
      toast.error("Failed to boot VM: " + (err instanceof Error ? err.message : "Unknown error"));
      setVmStatus("stopped");
    }
  };

  const handleStopVM = () => {
    if (emulatorRef.current) {
      try {
        emulatorRef.current.stop();
        emulatorRef.current = null;
      } catch (err) {
        console.error("Error stopping VM:", err);
      }
    }
    setVmStatus("stopped");
    toast.info("VM stopped");
  };

  const handleResetVM = () => {
    if (emulatorRef.current) {
      try {
        emulatorRef.current.restart();
        setVmStatus("booting");
        toast.info("Resetting VM...");
        setTimeout(() => {
          setVmStatus("running");
          toast.success("VM reset complete");
        }, 3000);
      } catch (err) {
        console.error("Error resetting VM:", err);
        toast.error("Failed to reset VM");
      }
    } else {
      handleBootVM();
    }
  };

  const handleExecute = async () => {
    if (!command.trim() || vmStatus !== "running") return;

    const logId = Date.now().toString();
    const newLog: CommandLog = {
      id: logId,
      command: command.trim(),
      timestamp: Date.now(),
      isRunning: true,
    };

    setCommandLogs((prev) => [...prev, newLog]);
    const cmd = command.trim();
    setCommand("");
    setIsExecuting(true);

    try {
      if (emulatorRef.current) {
        emulatorRef.current.serial0_send(cmd + "\n");

        setTimeout(() => {
          setCommandLogs((prev) =>
            prev.map((log) =>
              log.id === logId
                ? {
                    ...log,
                    isRunning: false,
                    output: "Command sent to VM. Check VM display for output.",
                  }
                : log
            )
          );
          setIsExecuting(false);
          toast.success("Command sent");
        }, 500);
      }
    } catch (err) {
      setCommandLogs((prev) =>
        prev.map((log) =>
          log.id === logId
            ? {
                ...log,
                isRunning: false,
                error: "Failed to execute command",
              }
            : log
        )
      );
      setIsExecuting(false);
      toast.error("Command failed");
    }
  };

  const formatTimestamp = (ts: number) => {
    return new Date(ts).toLocaleTimeString();
  };

  const currentConfig = OS_CONFIGS[selectedOS];

  const maxRamForCurrentOS = 2048; // v86 browser limit

  return (
    <div className="h-full flex flex-col">
      <div className={cn("border-b transition-all", isFullscreen ? "h-full" : "h-[60vh]")}>
        <div className="border-b bg-muted/50 px-4 py-2 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Monitor className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium">{currentConfig.name}</span>
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
            {!v86Loaded && (
              <Badge variant="outline" className="bg-orange-500/10 text-orange-600">
                <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                Loading v86...
              </Badge>
            )}
          </div>

          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-xs">{customRam} MB RAM</Badge>
            <Badge variant="outline" className="text-xs">{customCores} vCPU</Badge>

            {vmStatus === "stopped" && (
              <>
                <Dialog open={isConfigOpen} onOpenChange={setIsConfigOpen}>
                  <DialogTrigger asChild>
                    <Button size="sm" variant="outline" className="gap-2">
                      <Settings className="h-3 w-3" />
                      Configure
                    </Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>VM Configuration</DialogTitle>
                      <DialogDescription>
                        Choose operating system and hardware specs
                      </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4 py-4">
                      <div className="space-y-2">
                        <Label>Operating System</Label>
                        <Select
                          value={selectedOS}
                          onValueChange={(value) => {
                            setSelectedOS(value);
                            const config = OS_CONFIGS[value];
                            setCustomRam(config.ram);
                            setCustomCores(config.cores);
                          }}
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {Object.entries(OS_CONFIGS).map(([key, config]) => (
                              <SelectItem key={key} value={key}>
                                <div className="flex flex-col">
                                  <span className="font-medium">{config.name}</span>
                                  <span className="text-xs text-muted-foreground">{config.description}</span>
                                </div>
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="ram">RAM (MB)</Label>
                        <Input
                          id="ram"
                          type="number"
                          value={customRam}
                          onChange={(e) => setCustomRam(Math.max(64, Math.min(2048, parseInt(e.target.value) || 256)))}
                          min={64}
                          max={2048}
                        />
                        <p className="text-xs text-muted-foreground">
                          64MB - 2GB (browser v86 limit)
                        </p>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="cores">CPU Cores</Label>
                        <Input
                          id="cores"
                          type="number"
                          value={customCores}
                          onChange={(e) => setCustomCores(Math.max(1, Math.min(4, parseInt(e.target.value) || 1)))}
                          min={1}
                          max={4}
                        />
                        <p className="text-xs text-muted-foreground">1-4 cores (emulation limit)</p>
                      </div>
                    </div>
                    <DialogFooter>
                      <Button onClick={() => setIsConfigOpen(false)}>Done</Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>

                <Button
                  size="sm"
                  onClick={handleBootVM}
                  className="gap-2"
                  disabled={!v86Loaded}
                >
                  <Power className="h-3 w-3" />
                  Boot VM
                </Button>
              </>
            )}

            {(vmStatus === "running" || vmStatus === "booting") && (
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

            <Button size="sm" variant="ghost" onClick={() => setIsFullscreen(!isFullscreen)}>
              {isFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
            </Button>
          </div>
        </div>

        <div className="w-full h-[calc(100%-3rem)] bg-black relative overflow-hidden">
          {vmStatus === "stopped" && (
            <div className="absolute inset-0 flex flex-col items-center justify-center text-white z-10">
              <Power className="h-16 w-16 mb-4 opacity-50" />
              <p className="text-lg font-medium mb-2">VM is stopped</p>
              <p className="text-sm text-white/60 mb-4">Click "Configure" to select OS, then "Boot VM"</p>
              <p className="text-xs text-white/40">
                All systems run in browser via v86 emulator
              </p>
            </div>
          )}

          {vmStatus === "booting" && (
            <div className="absolute inset-0 flex flex-col items-center justify-center text-white z-10">
              <Loader2 className="h-16 w-16 mb-4 animate-spin" />
              <p className="text-lg font-medium mb-2">Booting {currentConfig.name}...</p>
              <p className="text-sm text-white/60">{currentConfig.description}</p>
              <p className="text-xs text-white/40 mt-2">
                Running in browser via v86 emulator
              </p>
            </div>
          )}

          <div ref={screenContainerRef} className="w-full h-full" />
        </div>
      </div>

      {!isFullscreen && (
        <div className="flex-1 flex flex-col min-h-0 p-6 space-y-4">
          <div>
            <h3 className="text-lg font-semibold flex items-center gap-2">
              <Terminal className="h-5 w-5" />
              Send Commands to VM
            </h3>
            <p className="text-sm text-muted-foreground">
              Type commands to send directly to the VM serial terminal
            </p>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Execute Command</CardTitle>
              <CardDescription>
                Send commands to the running {currentConfig.name}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex gap-2">
                <Input
                  placeholder="ls, pwd, uname -a, etc..."
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
                  {isExecuting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  Send
                </Button>
              </div>
              {vmStatus !== "running" && (
                <p className="text-xs text-muted-foreground mt-2">
                  Boot the VM to send commands
                </p>
              )}
            </CardContent>
          </Card>

          <Card className="flex-1 min-h-0">
            <CardHeader>
              <CardTitle className="text-base">Command History</CardTitle>
              <CardDescription>Commands sent to VM serial port</CardDescription>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-[200px]">
                {commandLogs.length === 0 ? (
                  <div className="text-center text-muted-foreground py-8">
                    No commands sent yet
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
                              Sending
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
      )}
    </div>
  );
}
