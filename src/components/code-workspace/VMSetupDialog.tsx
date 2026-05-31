import { useCallback, useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Download, CheckCircle2, Loader2, Terminal, Monitor, Apple, ExternalLink, Package, Zap, HardDrive, RefreshCw } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { vmLauncher, VMLauncher } from "@/lib/vmLauncher";

interface VMSetupDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onComplete: () => void;
}

interface ISOOption {
  key: string;
  name: string;
  version: string;
  size: string;
  free: boolean;
  downloadUrl?: string;
  note?: string;
  category: "windows" | "macos" | "linux" | "android";
}

const ISO_OPTIONS: ISOOption[] = [
  // Windows — ISO is free; runs without activation (watermark only)
  {
    key: "windows-11",
    name: "Windows 11",
    version: "23H2",
    size: "~5.8GB ISO",
    free: true,
    downloadUrl: "https://www.microsoft.com/software-download/windows11",
    note: "Free from Microsoft — runs without activation (watermark only)",
    category: "windows",
  },
  {
    key: "windows-10",
    name: "Windows 10",
    version: "22H2",
    size: "~5.2GB ISO",
    free: true,
    downloadUrl: "https://www.microsoft.com/software-download/windows10",
    note: "Free from Microsoft — runs without activation (watermark only)",
    category: "windows",
  },
  // macOS — download from archive.org or create from Mac App Store
  {
    key: "macos-26",
    name: "macOS 26 Tahoe",
    version: "26.0",
    size: "~14GB ISO",
    free: true,
    downloadUrl: "https://archive.org/search?query=macos+26+tahoe+iso",
    note: "Download from archive.org or create from Mac App Store",
    category: "macos",
  },
  {
    key: "macos-sequoia",
    name: "macOS 15 Sequoia",
    version: "15.0",
    size: "~14GB ISO",
    free: true,
    downloadUrl: "https://archive.org/search?query=macos+sequoia+iso",
    note: "Download from archive.org or create from Mac App Store",
    category: "macos",
  },
  {
    key: "macos-sonoma",
    name: "macOS 14 Sonoma",
    version: "14.0",
    size: "~13GB ISO",
    free: true,
    downloadUrl: "https://archive.org/search?query=macos+sonoma+iso",
    note: "Download from archive.org or create from Mac App Store",
    category: "macos",
  },
  {
    key: "macos-ventura",
    name: "macOS 13 Ventura",
    version: "13.0",
    size: "~12GB ISO",
    free: true,
    downloadUrl: "https://archive.org/search?query=macos+ventura+iso",
    note: "Download from archive.org or create from Mac App Store",
    category: "macos",
  },
  {
    key: "macos-monterey",
    name: "macOS 12 Monterey",
    version: "12.0",
    size: "~12GB ISO",
    free: true,
    downloadUrl: "https://archive.org/search?query=macos+monterey+iso",
    note: "Download from archive.org or create from Mac App Store",
    category: "macos",
  },
  // Linux (free, auto-downloadable)
  {
    key: "ubuntu-24",
    name: "Ubuntu 24.04 LTS",
    version: "24.04",
    size: "~5.7GB",
    free: true,
    downloadUrl: "https://releases.ubuntu.com/24.04/ubuntu-24.04.2-desktop-amd64.iso",
    category: "linux",
  },
  {
    key: "ubuntu-22",
    name: "Ubuntu 22.04 LTS",
    version: "22.04",
    size: "~4.7GB",
    free: true,
    downloadUrl: "https://releases.ubuntu.com/22.04/ubuntu-22.04.5-desktop-amd64.iso",
    category: "linux",
  },
  {
    key: "debian-12",
    name: "Debian 12 Bookworm",
    version: "12.0",
    size: "~3.7GB",
    free: true,
    downloadUrl: "https://cdimage.debian.org/debian-cd/current/amd64/iso-dvd/debian-12.9.0-amd64-DVD-1.iso",
    category: "linux",
  },
  {
    key: "fedora-41",
    name: "Fedora 41",
    version: "41",
    size: "~2.1GB",
    free: true,
    downloadUrl: "https://download.fedoraproject.org/pub/fedora/linux/releases/41/Workstation/x86_64/iso/Fedora-Workstation-Live-x86_64-41-1.4.iso",
    category: "linux",
  },
  {
    key: "linux-alpine",
    name: "Alpine Linux 3.21",
    version: "3.21",
    size: "~200MB",
    free: true,
    downloadUrl: "https://dl-cdn.alpinelinux.org/alpine/v3.21/releases/x86_64/alpine-standard-3.21.0-x86_64.iso",
    category: "linux",
  },
  {
    key: "kali-linux",
    name: "Kali Linux 2024",
    version: "2024.4",
    size: "~4.1GB",
    free: true,
    downloadUrl: "https://cdimage.kali.org/kali-2024.4/kali-linux-2024.4-installer-amd64.iso",
    category: "linux",
  },
  // Android
  {
    key: "android-14",
    name: "Android 14 x86_64",
    version: "14",
    size: "~1.1GB",
    free: true,
    downloadUrl: "https://sourceforge.net/projects/android-x86/files/Release%209.0/android-x86_64-9.0-r2.iso",
    note: "Android-x86 project",
    category: "android",
  },
];

const CATEGORY_LABELS: Record<string, string> = {
  windows: "Windows",
  macos: "macOS",
  linux: "Linux",
  android: "Android",
};

export function VMSetupDialog({ open, onOpenChange, onComplete }: VMSetupDialogProps) {
  const [bridgeRunning, setBridgeRunning] = useState(false);
  const [bridgeVersion, setBridgeVersion] = useState<string>();
  const [checking, setChecking] = useState(false);
  const [selectedISOs, setSelectedISOs] = useState<Set<string>>(new Set(["ubuntu-24", "linux-alpine"]));
  const [activeTab, setActiveTab] = useState("install");

  const checkStatus = useCallback(async () => {
    setChecking(true);
    const status = await vmLauncher.checkStatus();
    setBridgeRunning(status.functional);
    setBridgeVersion(status.version);
    setChecking(false);

    if (status.functional) {
      setTimeout(() => {
        onComplete();
        onOpenChange(false);
      }, 1500);
    }
  }, [onComplete, onOpenChange]);

  // Only check once when dialog opens — don't block UI with constant polling
  useEffect(() => {
    if (!open) return;
    void checkStatus();
  }, [open, checkStatus]);

  const currentPlatform = typeof navigator !== "undefined"
    ? navigator.platform.toLowerCase().includes("win") ? "Windows"
      : navigator.platform.toLowerCase().includes("mac") ? "macOS"
      : "Linux"
    : "Windows";

  const toggleISO = (key: string) => {
    setSelectedISOs(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const groupedISOs = ISO_OPTIONS.reduce((acc, iso) => {
    if (!acc[iso.category]) acc[iso.category] = [];
    acc[iso.category].push(iso);
    return acc;
  }, {} as Record<string, ISOOption[]>);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Package className="h-5 w-5" />
            Thalamus VM Setup
          </DialogTitle>
          <DialogDescription>
            One-time setup to enable VM booting. Select your OS images below.
          </DialogDescription>
        </DialogHeader>

        <AnimatePresence mode="wait">
          {bridgeRunning ? (
            <motion.div
              key="running"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="py-8"
            >
              <div className="flex flex-col items-center gap-4">
                <div className="rounded-full bg-green-500/10 p-4">
                  <CheckCircle2 className="h-12 w-12 text-green-500" />
                </div>
                <div className="text-center">
                  <h3 className="text-xl font-semibold">VM Bridge Ready!</h3>
                  <p className="text-muted-foreground mt-1">
                    {bridgeVersion ? `Version ${bridgeVersion} • ` : ""}Launching your VM...
                  </p>
                </div>
              </div>
            </motion.div>
          ) : (
            <motion.div
              key="setup"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="space-y-4"
            >
              <Tabs value={activeTab} onValueChange={setActiveTab}>
                <TabsList className="w-full">
                  <TabsTrigger value="install" className="flex-1">Install Bridge</TabsTrigger>
                  <TabsTrigger value="isos" className="flex-1">OS Images</TabsTrigger>
                </TabsList>

                <TabsContent value="install" className="space-y-4 mt-4">
                  {currentPlatform === "Windows" && (
                    <Card className="p-5 border-primary/40 bg-primary/5">
                      <div className="flex items-start gap-4">
                        <div className="rounded-xl bg-primary/10 p-3 shrink-0">
                          <Package className="h-6 w-6 text-primary" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="font-bold text-sm">Thalamus Installer</span>
                            <Badge className="text-xs bg-primary/10 text-primary border-primary/20">Recommended</Badge>
                          </div>
                          <p className="text-xs text-muted-foreground mb-3">
                            Installs QEMU, downloads selected free ISOs, registers the{" "}
                            <code className="bg-muted px-1 rounded text-[10px]">thalamus://</code>{" "}
                            protocol, and adds the bridge to Windows startup. Zero legwork.
                          </p>
                          <div className="text-xs text-muted-foreground mb-3">
                            <span className="font-medium text-foreground">Selected ISOs: </span>
                            {Array.from(selectedISOs).map(k => ISO_OPTIONS.find(o => o.key === k)?.name).filter(Boolean).join(", ") || "None"}
                            {" — "}
                            <button className="text-primary underline" onClick={() => setActiveTab("isos")}>change</button>
                          </div>
                          <Button asChild size="sm" className="gap-2 w-full">
                            <a href={VMLauncher.INSTALLER_URL} target="_blank" rel="noopener noreferrer">
                              <Download className="h-3.5 w-3.5" />
                              Download thalamus-installer.exe
                              <ExternalLink className="h-3 w-3 ml-auto opacity-60" />
                            </a>
                          </Button>
                        </div>
                      </div>
                    </Card>
                  )}

                  <Card className="p-4 bg-muted/30">
                    <div className="flex items-center gap-2 mb-3">
                      <Zap className="h-4 w-4 text-primary" />
                      <h4 className="font-semibold text-sm">What the installer does:</h4>
                    </div>
                    <ol className="space-y-1.5 text-xs text-muted-foreground list-none">
                      {[
                        "Installs QEMU (VM engine) silently — no manual steps",
                        "Downloads selected OS ISOs automatically",
                        "Each OS runs in its own isolated QCOW2 container — never touches your real drive",
                        "Containers are thin-provisioned: a 60GB Windows VM only uses ~10GB until filled",
                        "Registers thalamus:// protocol — one-click VM launch from browser",
                        "Adds bridge to Windows startup — always ready in background",
                      ].map((step, i) => (
                        <li key={i} className="flex items-start gap-2">
                          <span className="shrink-0 w-4 h-4 rounded-full bg-primary/10 text-primary text-[10px] flex items-center justify-center font-bold mt-0.5">{i + 1}</span>
                          <span>{step}</span>
                        </li>
                      ))}
                    </ol>
                  </Card>

                  {currentPlatform !== "Windows" && (
                    <Card className="p-4">
                      <div className="flex items-center gap-3">
                        {currentPlatform === "macOS" ? <Apple className="h-5 w-5" /> : <Terminal className="h-5 w-5" />}
                        <div className="flex-1">
                          <p className="text-sm font-medium">{currentPlatform}</p>
                          <p className="text-xs text-muted-foreground font-mono mt-0.5">
                            {currentPlatform === "macOS"
                              ? "chmod +x ~/Downloads/setup-macos.sh && ~/Downloads/setup-macos.sh"
                              : "chmod +x ~/Downloads/setup-linux.sh && ~/Downloads/setup-linux.sh"}
                          </p>
                        </div>
                        <Button asChild size="sm" variant="outline" className="gap-2 shrink-0">
                          <a href={currentPlatform === "macOS" ? "/downloads/setup-macos.sh" : "/downloads/setup-linux.sh"} download>
                            <Download className="h-3 w-3" />
                            Download
                          </a>
                        </Button>
                      </div>
                    </Card>
                  )}

                  <div className="flex justify-between pt-1 border-t">
                    <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
                      Cancel
                    </Button>
                    <Button onClick={checkStatus} variant="secondary" size="sm" className="gap-2" disabled={checking}>
                      {checking ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                      Check Bridge
                    </Button>
                  </div>
                </TabsContent>

                <TabsContent value="isos" className="space-y-4 mt-4">
                  <p className="text-xs text-muted-foreground">
                    Select which OS images to include. Free images download automatically. Windows evaluation ISOs are free from Microsoft (90-day trial, fully functional).
                  </p>

                  {Object.entries(groupedISOs).map(([category, isos]) => (
                    <div key={category}>
                      <h4 className="text-xs font-bold text-muted-foreground uppercase tracking-wide mb-2">
                        {CATEGORY_LABELS[category]}
                      </h4>
                      <div className="space-y-2">
                        {isos.map((iso) => (
                          <Card
                            key={iso.key}
                            className={`p-3 transition-colors cursor-pointer ${selectedISOs.has(iso.key) ? "border-primary/40 bg-primary/5" : ""}`}
                            onClick={() => toggleISO(iso.key)}
                          >
                            <div className="flex items-center gap-3">
                                <Checkbox
                                checked={selectedISOs.has(iso.key)}
                                onCheckedChange={() => toggleISO(iso.key)}
                                onClick={(e) => e.stopPropagation()}
                              />
                              <HardDrive className="h-4 w-4 text-muted-foreground shrink-0" />
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className="text-sm font-medium">{iso.name}</span>
                                  <span className="text-xs text-muted-foreground">{iso.version}</span>
                                  <Badge variant="secondary" className="text-[10px] px-1.5 py-0 bg-green-500/10 text-green-600 border-green-500/20">Free</Badge>
                                </div>
                                <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                                  <span className="text-xs text-muted-foreground">{iso.size}</span>
                                  {iso.note && <span className="text-xs text-muted-foreground">• {iso.note}</span>}
                                  {iso.downloadUrl && (
                                    <a href={iso.downloadUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-primary underline flex items-center gap-0.5" onClick={e => e.stopPropagation()}>
                                      Get ISO <ExternalLink className="h-2.5 w-2.5" />
                                    </a>
                                  )}
                                </div>
                              </div>
                            </div>
                          </Card>
                        ))}
                      </div>
                    </div>
                  ))}

                  <Card className="p-3 bg-blue-500/5 border-blue-500/20">
                    <p className="text-xs text-muted-foreground">
                      <span className="font-medium text-blue-600">All VMs run in isolated containers</span> — each OS gets its own QCOW2 virtual disk that never touches your real drive. Thin-provisioned: only uses space as data is written.{" "}
                      <span className="font-medium text-blue-600">Windows</span> runs without activation (small watermark only).{" "}
                      <span className="font-medium text-blue-600">macOS ISOs</span> can be downloaded from archive.org or created from the Mac App Store installer. Always verify sources.
                    </p>
                  </Card>

                  <div className="flex justify-between pt-1 border-t">
                    <Button variant="outline" size="sm" onClick={() => setActiveTab("install")}>
                      ← Back
                    </Button>
                    <div className="text-xs text-muted-foreground self-center">
                      {Array.from(selectedISOs).length} ISOs selected
                    </div>
                  </div>
                </TabsContent>
              </Tabs>
            </motion.div>
          )}
        </AnimatePresence>
      </DialogContent>
    </Dialog>
  );
}