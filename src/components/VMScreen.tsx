import { useEffect, useRef, useState, useMemo } from "react";
import { motion } from "framer-motion";
import { Play, Square, Pause, RotateCcw, Download, Upload, Monitor, Cpu, HardDrive, Apple, Settings } from "lucide-react";
import { vmManager, VMInstance, OS_TEMPLATES } from "@/lib/v86Manager";
import { detectSystemResources, getV86Recommendations, getOSRecommendations, formatRAM, formatCores } from "@/lib/systemResources";
import { toast } from "sonner";

interface VMScreenProps {
  sessionId: string;
  onCommandOutput?: (output: string, exitCode: number) => void;
}

export function VMScreen({ sessionId, onCommandOutput }: VMScreenProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [vm, setVm] = useState<VMInstance | null>(null);
  const [selectedOS, setSelectedOS] = useState<string>("linux-alpine");
  const [vmState, setVmState] = useState<"stopped" | "booting" | "running" | "paused">("stopped");
  const [showOSSelector, setShowOSSelector] = useState(true);

  // Resource configuration
  const systemResources = useMemo(() => detectSystemResources(), []);
  const recommendations = useMemo(() => getV86Recommendations(systemResources), [systemResources]);
  const [customRAM, setCustomRAM] = useState<number>(recommendations.recommendedRAM);
  const [customVRAM, setCustomVRAM] = useState<number>(recommendations.recommendedVRAM);
  const [showResourceConfig, setShowResourceConfig] = useState(false);

  // Update RAM when OS changes
  useEffect(() => {
    const osRec = getOSRecommendations(selectedOS);
    setCustomRAM(Math.min(osRec.recommendedRAM, recommendations.maxRAM));
  }, [selectedOS, recommendations.maxRAM]);

  useEffect(() => {
    return () => {
      // Cleanup on unmount
      if (vm) {
        vmManager.destroyVM(vm.id);
      }
    };
  }, [vm]);

  const handleCreateVM = async () => {
    if (!containerRef.current) return;

    try {
      const template = OS_TEMPLATES[selectedOS];
      if (!template) {
        toast.error("Invalid OS selection");
        return;
      }

      setVmState("booting");
      toast.info(`Creating ${template.name} VM...`);

      const vmInstance = await vmManager.createVM({
        id: `vm_${sessionId}`,
        name: template.name!,
        os: template.os!,
        memory: customRAM,  // Use custom RAM
        vga_memory: customVRAM,  // Use custom VRAM
        screen_container: containerRef.current,
        bios_url: "/v86/seabios.bin",
        vga_bios_url: "/v86/vgabios.bin",
        cdrom_url: template.cdrom_url,
      });

      setVm(vmInstance);
      await vmManager.startVM(vmInstance.id);
      setVmState("running");
      setShowOSSelector(false);
      toast.success(`${template.name} VM started!`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create VM");
      setVmState("stopped");
    }
  };

  const handleStart = async () => {
    if (!vm) {
      await handleCreateVM();
      return;
    }

    try {
      await vmManager.startVM(vm.id);
      setVmState("running");
      toast.success("VM started");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to start VM");
    }
  };

  const handleStop = async () => {
    if (!vm) return;

    try {
      await vmManager.stopVM(vm.id);
      setVmState("stopped");
      toast.success("VM stopped");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to stop VM");
    }
  };

  const handlePause = async () => {
    if (!vm) return;

    try {
      await vmManager.pauseVM(vm.id);
      setVmState("paused");
      toast.success("VM paused");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to pause VM");
    }
  };

  const handleResume = async () => {
    if (!vm) return;

    try {
      await vmManager.resumeVM(vm.id);
      setVmState("running");
      toast.success("VM resumed");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to resume VM");
    }
  };

  const handleReset = async () => {
    if (!vm) return;

    try {
      await vmManager.destroyVM(vm.id);
      setVm(null);
      setVmState("stopped");
      setShowOSSelector(true);
      toast.success("VM reset");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to reset VM");
    }
  };

  const handleSaveState = async () => {
    if (!vm) return;

    try {
      const state = await vmManager.saveState(vm.id);
      const blob = new Blob([state], { type: "application/octet-stream" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${vm.config.name}_state.bin`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("VM state saved");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save state");
    }
  };

  const handleLoadState = async () => {
    if (!vm) return;

    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".bin";
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;

      try {
        const buffer = await file.arrayBuffer();
        await vmManager.restoreState(vm.id, buffer);
        toast.success("VM state restored");
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to restore state");
      }
    };
    input.click();
  };

  return (
    <div className="flex flex-col h-full bg-background">
      {/* VM Controls */}
      <div className="shrink-0 border-b border-border bg-card/50 px-4 py-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Monitor className="h-4 w-4 text-primary" />
          <span className="text-xs font-bold text-foreground">
            {vm ? vm.config.name : "Virtual Machine"}
          </span>
          <div className={`h-2 w-2 rounded-full ${
            vmState === "running" ? "bg-green-400 animate-pulse" :
            vmState === "paused" ? "bg-amber-400" :
            vmState === "booting" ? "bg-blue-400 animate-pulse" :
            "bg-muted-foreground"
          }`} />
          <span className="text-[10px] text-muted-foreground">{vmState}</span>
        </div>

        <div className="flex items-center gap-1">
          {vmState === "stopped" && (
            <button
              onClick={handleStart}
              className="flex items-center gap-1 px-2 py-1 bg-emerald-400/10 border border-emerald-400/30 text-emerald-400 text-[10px] rounded hover:bg-emerald-400/20 transition-all font-bold"
            >
              <Play className="h-3 w-3" />
              START
            </button>
          )}

          {vmState === "running" && (
            <>
              <button
                onClick={handlePause}
                className="flex items-center gap-1 px-2 py-1 bg-amber-400/10 border border-amber-400/30 text-amber-400 text-[10px] rounded hover:bg-amber-400/20 transition-all"
              >
                <Pause className="h-3 w-3" />
              </button>
              <button
                onClick={handleStop}
                className="flex items-center gap-1 px-2 py-1 bg-red-400/10 border border-red-400/30 text-red-400 text-[10px] rounded hover:bg-red-400/20 transition-all"
              >
                <Square className="h-3 w-3" />
              </button>
            </>
          )}

          {vmState === "paused" && (
            <button
              onClick={handleResume}
              className="flex items-center gap-1 px-2 py-1 bg-emerald-400/10 border border-emerald-400/30 text-emerald-400 text-[10px] rounded hover:bg-emerald-400/20 transition-all"
            >
              <Play className="h-3 w-3" />
            </button>
          )}

          <button
            onClick={handleReset}
            className="flex items-center gap-1 px-2 py-1 bg-muted/50 border border-border text-muted-foreground text-[10px] rounded hover:bg-muted transition-all"
            title="Reset VM"
          >
            <RotateCcw className="h-3 w-3" />
          </button>

          {vm && (
            <>
              <button
                onClick={handleSaveState}
                className="flex items-center gap-1 px-2 py-1 bg-muted/50 border border-border text-muted-foreground text-[10px] rounded hover:bg-muted transition-all"
                title="Save state"
              >
                <Download className="h-3 w-3" />
              </button>
              <button
                onClick={handleLoadState}
                className="flex items-center gap-1 px-2 py-1 bg-muted/50 border border-border text-muted-foreground text-[10px] rounded hover:bg-muted transition-all"
                title="Load state"
              >
                <Upload className="h-3 w-3" />
              </button>
            </>
          )}
        </div>
      </div>

      {/* VM Screen or OS Selector */}
      <div className="flex-1 relative overflow-hidden">
        {showOSSelector && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="absolute inset-0 flex items-center justify-center p-8 bg-background"
          >
            <div className="max-w-2xl w-full">
              <h3 className="text-lg font-bold text-foreground mb-2">Select Operating System</h3>
              <p className="text-sm text-muted-foreground mb-2">
                Choose an OS to boot in the virtual machine. Your code will be tested in this environment.
              </p>
              <div className="mb-6 p-3 bg-amber-400/10 border border-amber-400/30 rounded-lg">
                <p className="text-xs text-amber-400 font-bold mb-1">⚠️ Legacy OS Only (32-bit x86)</p>
                <p className="text-[10px] text-muted-foreground">
                  VM mode supports 32-bit operating systems only. Windows 11, modern macOS, and 64-bit systems cannot run in browser VMs.
                  For modern testing, use Daytona Cloud sandbox.
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {Object.entries(OS_TEMPLATES).map(([key, template]) => (
                  <button
                    key={key}
                    onClick={() => setSelectedOS(key)}
                    className={`p-4 rounded-xl border-2 transition-all text-left ${
                      selectedOS === key
                        ? "border-primary bg-primary/10"
                        : "border-border bg-card hover:border-primary/50"
                    }`}
                  >
                    <div className="flex items-center gap-3 mb-2">
                      {template.os === "linux" && <Cpu className="h-5 w-5 text-primary" />}
                      {template.os === "windows" && <Monitor className="h-5 w-5 text-blue-400" />}
                      {template.os === "macos" && <Apple className="h-5 w-5 text-foreground" />}
                      {template.os === "freedos" && <HardDrive className="h-5 w-5 text-amber-400" />}
                      <span className="text-sm font-bold text-foreground">{template.name}</span>
                    </div>
                    <div className="text-[10px] text-muted-foreground space-y-1">
                      <div>RAM: {template.memory}MB</div>
                      <div>VRAM: {template.vga_memory}MB</div>
                    </div>
                  </button>
                ))}
              </div>

              {/* System Resources & Configuration */}
              <div className="mt-6 p-4 bg-card border border-border rounded-xl space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Settings className="h-4 w-4 text-primary" />
                    <span className="text-sm font-bold text-foreground">VM Resources</span>
                  </div>
                  <button
                    onClick={() => setShowResourceConfig(!showResourceConfig)}
                    className="text-xs text-primary hover:underline"
                  >
                    {showResourceConfig ? "Hide" : "Customize"}
                  </button>
                </div>

                {/* System Detection Info */}
                <div className="grid grid-cols-2 gap-3 text-[10px]">
                  <div className="p-2 bg-muted/30 rounded-lg">
                    <p className="text-muted-foreground mb-1">System RAM</p>
                    <p className="font-bold text-foreground">{formatRAM(systemResources.totalRAM)}</p>
                  </div>
                  <div className="p-2 bg-muted/30 rounded-lg">
                    <p className="text-muted-foreground mb-1">CPU Cores</p>
                    <p className="font-bold text-foreground">{formatCores(systemResources.cpuCores)}</p>
                  </div>
                </div>

                {showResourceConfig && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    className="space-y-4"
                  >
                    {/* RAM Slider */}
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <label className="text-xs font-bold text-foreground">VM RAM</label>
                        <span className="text-xs text-primary font-bold">{formatRAM(customRAM)}</span>
                      </div>
                      <input
                        type="range"
                        min={recommendations.minRAM}
                        max={recommendations.maxRAM}
                        step={128}
                        value={customRAM}
                        onChange={(e) => setCustomRAM(parseInt(e.target.value))}
                        className="w-full h-2 bg-muted rounded-lg appearance-none cursor-pointer accent-primary"
                      />
                      <div className="flex justify-between text-[9px] text-muted-foreground mt-1">
                        <span>Min: {formatRAM(recommendations.minRAM)}</span>
                        <span>Max: {formatRAM(recommendations.maxRAM)}</span>
                      </div>
                    </div>

                    {/* VRAM Slider */}
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <label className="text-xs font-bold text-foreground">Video RAM (VRAM)</label>
                        <span className="text-xs text-primary font-bold">{customVRAM}MB</span>
                      </div>
                      <input
                        type="range"
                        min={4}
                        max={64}
                        step={4}
                        value={customVRAM}
                        onChange={(e) => setCustomVRAM(parseInt(e.target.value))}
                        className="w-full h-2 bg-muted rounded-lg appearance-none cursor-pointer accent-primary"
                      />
                      <div className="flex justify-between text-[9px] text-muted-foreground mt-1">
                        <span>Min: 4MB</span>
                        <span>Max: 64MB</span>
                      </div>
                    </div>

                    {/* Info Text */}
                    <p className="text-[9px] text-muted-foreground">
                      💡 Higher RAM improves performance but may slow down your system.
                      Recommended: {formatRAM(recommendations.recommendedRAM)}
                    </p>
                  </motion.div>
                )}

                {/* Quick Stats */}
                {!showResourceConfig && (
                  <div className="flex items-center gap-4 text-[10px] text-muted-foreground">
                    <span>RAM: <strong className="text-foreground">{formatRAM(customRAM)}</strong></span>
                    <span>VRAM: <strong className="text-foreground">{customVRAM}MB</strong></span>
                    <span>CPU: <strong className="text-foreground">1 core</strong></span>
                  </div>
                )}
              </div>

              <button
                onClick={handleCreateVM}
                disabled={vmState === "booting"}
                className="w-full mt-6 py-3 bg-primary text-primary-foreground rounded-xl font-bold hover:bg-primary/90 disabled:opacity-50 transition-all"
              >
                {vmState === "booting" ? "Creating VM..." : "Boot Virtual Machine"}
              </button>
            </div>
          </motion.div>
        )}

        {/* VM Screen Container */}
        <div
          ref={containerRef}
          className={`w-full h-full bg-black ${showOSSelector ? "hidden" : "block"}`}
          style={{ imageRendering: "pixelated" }}
        />
      </div>

      {/* VM Info Bar */}
      {vm && (
        <div className="shrink-0 border-t border-border bg-card/50 px-4 py-1 flex items-center justify-between text-[10px] text-muted-foreground">
          <div>OS: {vm.config.name}</div>
          <div>RAM: {vm.config.memory}MB</div>
          <div>VRAM: {vm.config.vga_memory}MB</div>
        </div>
      )}
    </div>
  );
}
