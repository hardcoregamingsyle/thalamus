import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Monitor, Terminal, Send, Loader2, Maximize2, Minimize2, Power, RotateCcw, Settings, Wifi } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { toast } from "sonner";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { QemuSetupDialog } from "./QemuSetupDialog";

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
  "windows-11": {
    os: "windows-11",
    ram: 6144,
    cores: 4,
    name: "Windows 11 Pro",
    description: "Modern Windows (6GB RAM, 4 cores, requires local QEMU)",
    is64Bit: true,
  },
  "windows-10": {
    os: "windows-10",
    ram: 6144,
    cores: 4,
    name: "Windows 10 Pro",
    description: "Windows 10 (6GB RAM, 4 cores, requires local QEMU)",
    is64Bit: true,
  },
  "macos-sequoia": {
    os: "macos-sequoia",
    ram: 6144,
    cores: 4,
    name: "macOS Sequoia",
    description: "Latest macOS (6GB RAM, 4 cores, requires local QEMU)",
    is64Bit: true,
  },
  "ubuntu-24": {
    os: "ubuntu-24",
    ram: 4096,
    cores: 4,
    name: "Ubuntu 24.04 LTS",
    description: "Latest Ubuntu Desktop (4GB RAM, 4 cores, requires local QEMU)",
    is64Bit: true,
  },
  "android-14": {
    os: "android-14",
    ram: 4096,
    cores: 4,
    name: "Android 14",
    description: "Latest Android x86_64 (4GB RAM, requires local QEMU)",
    is64Bit: true,
  },
  "linux-alpine": {
    os: "Linux Alpine",
    ram: 256,
    cores: 1,
    cdrom: "https://copy.sh/v86/images/linux4.iso",
    name: "Alpine Linux (32-bit)",
    description: "Lightweight Linux (256MB, browser-based, instant)",
    is64Bit: false,
  },
  "linux-arch": {
    os: "Linux Arch",
    ram: 512,
    cores: 2,
    cdrom: "https://copy.sh/v86/images/archlinux.iso",
    name: "Arch Linux (32-bit)",
    description: "Full Linux distro (512MB, browser-based)",
    is64Bit: false,
  },
  "windows-98": {
    os: "Windows 98",
    ram: 256,
    cores: 1,
    hda: { url: "https://copy.sh/v86/images/windows98.img", async: true, size: 300 * 1024 * 1024 },
    name: "Windows 98",
    description: "Classic Windows with GUI (256MB, browser-based)",
    is64Bit: false,
  },
  "kolibrios": {
    os: "KolibriOS",
    ram: 64,
    cores: 1,
    fda: { url: "https://copy.sh/v86/images/kolibri.img", async: false },
    name: "KolibriOS",
    description: "Ultra-fast tiny OS (64MB, browser-based, instant)",
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
  const [isQemuSetupOpen, setIsQemuSetupOpen] = useState(false);
  const [selectedOS, setSelectedOS] = useState("windows-11");
  const [customRam, setCustomRam] = useState(6144);
  const [customCores, setCustomCores] = useState(4);
  const [v86Loaded, setV86Loaded] = useState(false);
  const [qemuConnected, setQemuConnected] = useState(false);
  const [localQemuPort, setLocalQemuPort] = useState(5900);
  const emulatorRef = useRef<any>(null);
  const screenContainerRef = useRef<HTMLDivElement>(null);
  const vncClientRef = useRef<any>(null);

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

    // 64-bit systems require QEMU
    if (config.is64Bit) {
      if (!qemuConnected) {
        toast.error("QEMU not connected. Click 'Setup QEMU' to install.");
        setIsQemuSetupOpen(true);
        return;
      }

      // Boot via local QEMU
      await bootQemuVM(config);
      return;
    }

    // 32-bit systems use v86
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

  const bootQemuVM = async (config: VMConfig) => {
    setVmStatus("booting");
    toast.info(`Starting ${config.name} via local QEMU...`);

    try {
      // Connect to local QEMU bridge via WebSocket
      const ws = new WebSocket(`ws://localhost:${localQemuPort}`);

      ws.onopen = () => {
        // Send boot command with OS config
        ws.send(JSON.stringify({
          action: "boot",
          os: config.os,
          ram: customRam,
          cores: customCores,
        }));
      };

      ws.onmessage = (event) => {
        const data = JSON.parse(event.data);

        if (data.status === "booting") {
          toast.info("QEMU VM starting...");
        } else if (data.status === "ready") {
          setVmStatus("running");
          toast.success(`${config.name} is running! VNC display connected.`);

          // Initialize VNC viewer in canvas
          initializeVNCViewer(data.vncPort);
        } else if (data.error) {
          toast.error(`QEMU error: ${data.error}`);
          setVmStatus("stopped");
        }
      };

      ws.onerror = () => {
        toast.error("Lost connection to QEMU bridge");
        setVmStatus("stopped");
        setQemuConnected(false);
      };
    } catch (err) {
      console.error("QEMU boot error:", err);
      toast.error("Failed to start QEMU VM");
      setVmStatus("stopped");
    }
  };

  const initializeVNCViewer = (vncPort: number) => {
    // For now, show iframe with noVNC viewer
    // In production, embed noVNC client library directly
    const vncUrl = `http://localhost:${vncPort}/vnc.html?autoconnect=true`;
    toast.info(`VNC viewer at ${vncUrl}`);
  };

  const handleQemuConnect = (port: number) => {
    setLocalQemuPort(port);
    setQemuConnected(true);
    setIsQemuSetupOpen(false);
  };

  const formatTimestamp = (ts: number) => {
    return new Date(ts).toLocaleTimeString();
  };

  const currentConfig = OS_CONFIGS[selectedOS];

  // Determine max RAM based on OS type
  const getMaxRam = (osKey: string) => {
    const config = OS_CONFIGS[osKey];
    return config.is64Bit ? 16384 : 2048; // 16GB for 64-bit, 2GB for 32-bit
  };

  const maxRamForCurrentOS = getMaxRam(selectedOS);

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
            {!v86Loaded && !currentConfig.is64Bit && (
              <Badge variant="outline" className="bg-orange-500/10 text-orange-600">
                <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                Loading v86...
              </Badge>
            )}

            {currentConfig.is64Bit && (
              <Badge
                variant="outline"
                className={qemuConnected ? "bg-green-500/10 text-green-600" : "bg-orange-500/10 text-orange-600"}
              >
                <Wifi className="h-3 w-3 mr-1" />
                QEMU {qemuConnected ? "Connected" : "Not Connected"}
              </Badge>
            )}
          </div>

          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-xs">{customRam} MB RAM</Badge>
            <Badge variant="outline" className="text-xs">{customCores} vCPU</Badge>

            {vmStatus === "stopped" && (
              <>
                {currentConfig.is64Bit && !qemuConnected && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-2 border-orange-500 text-orange-600"
                    onClick={() => setIsQemuSetupOpen(true)}
                  >
                    <Wifi className="h-3 w-3" />
                    Setup QEMU
                  </Button>
                )}

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
                          onChange={(e) => {
                            const max = getMaxRam(selectedOS);
                            setCustomRam(Math.max(64, Math.min(max, parseInt(e.target.value) || 256)));
                          }}
                          min={64}
                          max={maxRamForCurrentOS}
                        />
                        <p className="text-xs text-muted-foreground">
                          {currentConfig.is64Bit
                            ? "64MB - 16GB (QEMU on your device)"
                            : "64MB - 2GB (browser v86 limit)"}
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
                  disabled={currentConfig.is64Bit ? !qemuConnected : !v86Loaded}
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
              <p className="text-sm text-white/60 mb-4">
                {currentConfig.is64Bit && !qemuConnected
                  ? 'Click "Setup QEMU" to install local bridge'
                  : 'Click "Configure" to select OS, then "Boot VM"'}
              </p>
              <p className="text-xs text-white/40">
                {currentConfig.is64Bit
                  ? "64-bit systems run locally via QEMU on your device"
                  : "32-bit systems run in browser via v86"}
              </p>
            </div>
          )}

          {vmStatus === "booting" && (
            <div className="absolute inset-0 flex flex-col items-center justify-center text-white z-10">
              <Loader2 className="h-16 w-16 mb-4 animate-spin" />
              <p className="text-lg font-medium mb-2">Booting {currentConfig.name}...</p>
              <p className="text-sm text-white/60">{currentConfig.description}</p>
              <p className="text-xs text-white/40 mt-2">
                {currentConfig.is64Bit
                  ? "Running locally via QEMU with native performance"
                  : "Running in browser via v86 emulator"}
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

      <QemuSetupDialog
        open={isQemuSetupOpen}
        onOpenChange={setIsQemuSetupOpen}
        onConnect={handleQemuConnect}
        connected={qemuConnected}
      />
    </div>
  );
}
