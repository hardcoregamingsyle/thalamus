import { useEffect, useRef, useState, useMemo } from "react";
import { motion } from "framer-motion";
import { Play, Square, Pause, RotateCcw, Download, Upload, Monitor, Cpu, Apple, AlertTriangle, Settings, HardDrive } from "lucide-react";
import { qemuManager, QEMUVMInstance, QEMU_OS_TEMPLATES } from "@/lib/qemuManager";
import { detectSystemResources, getQEMURecommendations, getOSRecommendations, formatRAM, formatCores } from "@/lib/systemResources";
import { toast } from "sonner";

interface QEMUScreenProps {
  sessionId: string;
  onCommandOutput?: (output: string, exitCode: number) => void;
}

export function QEMUScreen({ sessionId, onCommandOutput }: QEMUScreenProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [vm, setVm] = useState<QEMUVMInstance | null>(null);
  const [selectedOS, setSelectedOS] = useState<string>("linux-ubuntu");
  const [vmState, setVmState] = useState<"stopped" | "booting" | "running" | "paused">("stopped");
  const [showOSSelector, setShowOSSelector] = useState(true);

  // Resource configuration
  const systemResources = useMemo(() => detectSystemResources(), []);
  const recommendations = useMemo(() => getQEMURecommendations(systemResources), [systemResources]);
  const [customRAM, setCustomRAM] = useState<number>(recommendations.recommendedRAM);
  const [customVRAM, setCustomVRAM] = useState<number>(recommendations.recommendedVRAM);
  const [customCores, setCustomCores] = useState<number>(recommendations.recommendedCores);
  const [showResourceConfig, setShowResourceConfig] = useState(false);

  // Update RAM and cores when OS changes
  useEffect(() => {
    const osRec = getOSRecommendations(selectedOS);
    setCustomRAM(Math.min(osRec.recommendedRAM, recommendations.maxRAM));
    setCustomCores(Math.max(osRec.minCores, Math.min(recommendations.recommendedCores, recommendations.maxCores)));
  }, [selectedOS, recommendations.maxRAM, recommendations.recommendedCores, recommendations.maxCores]);

  useEffect(() => {
    return () => {
      if (vm) {
        qemuManager.destroyVM(vm.id);
      }
    };
  }, [vm]);

  const handleCreateVM = async () => {
    if (!containerRef.current) return;

    try {
      const template = QEMU_OS_TEMPLATES[selectedOS];
      if (!template) {
        toast.error("Invalid OS selection");
        return;
      }

      setVmState("booting");
      toast.info(`Creating ${template.name} VM... This may take a minute.`);

      const vmInstance = await qemuManager.createVM({
        id: `qemu_${sessionId}`,
        name: template.name!,
        os: template.os!,
        memory: customRAM,  // Use custom RAM
        vga_memory: customVRAM,  // Use custom VRAM
        cpu_cores: customCores,  // Use custom CPU cores
        screen_container: containerRef.current,
        cdrom_url: template.cdrom_url,
      });

      setVm(vmInstance);
      await qemuManager.startVM(vmInstance.id);
      setVmState("running");
      setShowOSSelector(false);
      toast.success(`${template.name} VM started! Note: QEMU is slower than v86.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create QEMU VM");
      setVmState("stopped");
    }
  };

  const handleStart = async () => {
    if (!vm) {
      await handleCreateVM();
      return;
    }

    try {
      await qemuManager.startVM(vm.id);
      setVmState("running");
      toast.success("QEMU VM started");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to start QEMU VM");
    }
  };

  const handleStop = async () => {
    if (!vm) return;

    try {
      await qemuManager.stopVM(vm.id);
      setVmState("stopped");
      toast.success("QEMU VM stopped");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to stop QEMU VM");
    }
  };

  const handlePause = async () => {
    if (!vm) return;

    try {
      await qemuManager.pauseVM(vm.id);
      setVmState("paused");
      toast.success("QEMU VM paused");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to pause QEMU VM");
    }
  };

  const handleResume = async () => {
    if (!vm) return;

    try {
      await qemuManager.resumeVM(vm.id);
      setVmState("running");
      toast.success("QEMU VM resumed");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to resume QEMU VM");
    }
  };

  const handleReset = async () => {
    if (!vm) return;

    try {
      await qemuManager.destroyVM(vm.id);
      setVm(null);
      setVmState("stopped");
      setShowOSSelector(true);
      toast.success("QEMU VM reset");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to reset QEMU VM");
    }
  };

  const handleSaveState = async () => {
    if (!vm) return;

    try {
      const state = await qemuManager.saveState(vm.id);
      const blob = new Blob([state], { type: "application/octet-stream" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${vm.config.name}_qemu_state.bin`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("QEMU VM state saved");
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
        await qemuManager.restoreState(vm.id, buffer);
        toast.success("QEMU VM state restored");
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
          <Cpu className="h-4 w-4 text-blue-400" />
          <span className="text-xs font-bold text-foreground">
            {vm ? `${vm.config.name} (QEMU 64-bit)` : "QEMU Virtual Machine"}
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
            className="absolute inset-0 flex items-center justify-center p-8 bg-background overflow-y-auto"
          >
            <div className="max-w-3xl w-full">
              <h3 className="text-lg font-bold text-foreground mb-2">Select 64-bit Operating System (QEMU)</h3>
              <p className="text-sm text-muted-foreground mb-2">
                Choose a modern 64-bit OS. QEMU provides full x86_64 emulation for Windows 11, modern Linux, etc.
              </p>

              {/* Integration Status Warning */}
              <div className="mb-6 p-4 bg-amber-400/10 border border-amber-400/30 rounded-xl">
                <div className="flex items-start gap-3">
                  <AlertTriangle className="h-5 w-5 text-amber-400 shrink-0 mt-0.5" />
                  <div>
                    <p className="text-xs text-amber-400 font-bold mb-1">🚧 QEMU Wasm - Integration In Progress</p>
                    <p className="text-[10px] text-muted-foreground mb-2">
                      QEMU WebAssembly integration requires additional setup with container2wasm infrastructure.
                      This mode is currently under development.
                    </p>
                    <p className="text-[10px] text-foreground font-bold">
                      ✅ <strong>Use v86 mode instead</strong> → Fully functional for 32-bit legacy OS (Windows XP, old Linux, DOS)<br/>
                      ⚙️ QEMU Wasm coming soon with full 64-bit support
                    </p>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {Object.entries(QEMU_OS_TEMPLATES).map(([key, template]) => (
                  <button
                    key={key}
                    onClick={() => setSelectedOS(key)}
                    className={`p-4 rounded-xl border-2 transition-all text-left ${
                      selectedOS === key
                        ? "border-blue-400 bg-blue-400/10"
                        : "border-border bg-card hover:border-blue-400/50"
                    }`}
                  >
                    <div className="flex items-center gap-3 mb-2">
                      {template.os === "linux64" && <Cpu className="h-5 w-5 text-blue-400" />}
                      {template.os === "windows64" && <Monitor className="h-5 w-5 text-blue-400" />}
                      {template.os === "macos64" && <Apple className="h-5 w-5 text-foreground" />}
                      <span className="text-sm font-bold text-foreground">{template.name}</span>
                    </div>
                    <div className="text-[10px] text-muted-foreground space-y-1">
                      <div>RAM: {template.memory}MB | VRAM: {template.vga_memory}MB</div>
                      <div>CPU Cores: {template.cpu_cores}</div>
                      <div className="text-amber-400">⏱️ Slow emulation</div>
                    </div>
                  </button>
                ))}
              </div>

              {/* System Resources & Configuration */}
              <div className="mt-6 p-4 bg-card border border-border rounded-xl space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Settings className="h-4 w-4 text-blue-400" />
                    <span className="text-sm font-bold text-foreground">QEMU VM Resources</span>
                  </div>
                  <button
                    onClick={() => setShowResourceConfig(!showResourceConfig)}
                    className="text-xs text-blue-400 hover:underline"
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
                        <span className="text-xs text-blue-400 font-bold">{formatRAM(customRAM)}</span>
                      </div>
                      <input
                        type="range"
                        min={recommendations.minRAM}
                        max={recommendations.maxRAM}
                        step={256}
                        value={customRAM}
                        onChange={(e) => setCustomRAM(parseInt(e.target.value))}
                        className="w-full h-2 bg-muted rounded-lg appearance-none cursor-pointer accent-blue-400"
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
                        <span className="text-xs text-blue-400 font-bold">{customVRAM}MB</span>
                      </div>
                      <input
                        type="range"
                        min={32}
                        max={128}
                        step={16}
                        value={customVRAM}
                        onChange={(e) => setCustomVRAM(parseInt(e.target.value))}
                        className="w-full h-2 bg-muted rounded-lg appearance-none cursor-pointer accent-blue-400"
                      />
                      <div className="flex justify-between text-[9px] text-muted-foreground mt-1">
                        <span>Min: 32MB</span>
                        <span>Max: 128MB</span>
                      </div>
                    </div>

                    {/* CPU Cores Slider */}
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <label className="text-xs font-bold text-foreground">CPU Cores</label>
                        <span className="text-xs text-blue-400 font-bold">{formatCores(customCores)}</span>
                      </div>
                      <input
                        type="range"
                        min={recommendations.minCores}
                        max={recommendations.maxCores}
                        step={1}
                        value={customCores}
                        onChange={(e) => setCustomCores(parseInt(e.target.value))}
                        className="w-full h-2 bg-muted rounded-lg appearance-none cursor-pointer accent-blue-400"
                      />
                      <div className="flex justify-between text-[9px] text-muted-foreground mt-1">
                        <span>Min: {formatCores(recommendations.minCores)}</span>
                        <span>Max: {formatCores(recommendations.maxCores)}</span>
                      </div>
                    </div>

                    {/* Info Text */}
                    <p className="text-[9px] text-muted-foreground">
                      💡 Higher resources improve VM performance but may slow down your system.
                      Recommended: {formatRAM(recommendations.recommendedRAM)}, {formatCores(recommendations.recommendedCores)}
                    </p>
                  </motion.div>
                )}

                {/* Quick Stats */}
                {!showResourceConfig && (
                  <div className="flex items-center gap-4 text-[10px] text-muted-foreground">
                    <span>RAM: <strong className="text-foreground">{formatRAM(customRAM)}</strong></span>
                    <span>VRAM: <strong className="text-foreground">{customVRAM}MB</strong></span>
                    <span>CPU: <strong className="text-foreground">{formatCores(customCores)}</strong></span>
                  </div>
                )}
              </div>

              <button
                onClick={handleCreateVM}
                disabled={true}
                className="w-full mt-6 py-3 bg-muted text-muted-foreground rounded-xl font-bold cursor-not-allowed opacity-50"
                title="QEMU Wasm integration in progress"
              >
                QEMU Wasm Integration In Progress (Use v86 Instead)
              </button>
            </div>
          </motion.div>
        )}

        {/* QEMU VM Screen Container */}
        <div
          ref={containerRef}
          className={`w-full h-full bg-black ${showOSSelector ? "hidden" : "block"}`}
        />
      </div>

      {/* VM Info Bar */}
      {vm && (
        <div className="shrink-0 border-t border-border bg-card/50 px-4 py-1 flex items-center justify-between text-[10px] text-muted-foreground">
          <div>OS: {vm.config.name} (64-bit x86_64)</div>
          <div>RAM: {vm.config.memory}MB</div>
          <div>VRAM: {vm.config.vga_memory}MB</div>
          <div>CPU: {vm.config.cpu_cores} cores</div>
          <div className="text-amber-400">QEMU (Slow)</div>
        </div>
      )}
    </div>
  );
}
