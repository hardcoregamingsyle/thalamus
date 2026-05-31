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
import { Download, CheckCircle2, Loader2, Play, Terminal, Monitor, Apple, ExternalLink, Package, Zap, HardDrive, Trash2, RefreshCw } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
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
  note?: string;
  category: "windows" | "macos" | "linux" | "android";
}

const ISO_OPTIONS: ISOOption[] = [
  // Windows
  { key: "windows-11", name: "Windows 11 Pro", version: "23H2", size: "~5.8GB", free: false, note: "Download from Microsoft", category: "windows" },
  { key: "windows-10", name: "Windows 10 Pro", version: "22H2", size: "~5.2GB", free: false, note: "Download from Microsoft", category: "windows" },
  // macOS
  { key: "macos-26", name: "macOS 26 Tahoe", version: "26.0", size: "~14GB", free: false, note: "Requires Apple hardware", category: "macos" },
  { key: "macos-18", name: "macOS 18 Sequoia", version: "18.0", size: "~14GB", free: false, note: "Requires Apple hardware", category: "macos" },
  { key: "macos-17", name: "macOS 17 Sonoma", version: "17.0", size: "~13GB", free: false, note: "Requires Apple hardware", category: "macos" },
  { key: "macos-16", name: "macOS 16 Ventura", version: "16.0", size: "~12GB", free: false, note: "Requires Apple hardware", category: "macos" },
  // Linux (free, auto-downloadable)
  { key: "ubuntu-24", name: "Ubuntu 24.04 LTS", version: "24.04", size: "~5.7GB", free: true, category: "linux" },
  { key: "ubuntu-22", name: "Ubuntu 22.04 LTS", version: "22.04", size: "~4.7GB", free: true, category: "linux" },
  { key: "debian-12", name: "Debian 12 Bookworm", version: "12.0", size: "~3.7GB", free: true, category: "linux" },
  { key: "fedora-40", name: "Fedora 40", version: "40", size: "~2.1GB", free: true, category: "linux" },
  { key: "linux-alpine", name: "Alpine Linux", version: "3.21", size: "~200MB", free: true, category: "linux" },
  { key: "linux-arch", name: "Arch Linux", version: "2024.01", size: "~1.1GB", free: true, category: "linux" },
  // Android
  { key: "android-14", name: "Android 14 x86_64", version: "14", size: "~1.1GB", free: true, category: "android" },
  { key: "android-13", name: "Android 13 x86_64", version: "13", size: "~1.0GB", free: true, category: "android" },
];

const CATEGORY_LABELS: Record<string, string> = {
  windows: "Windows",
  macos: "macOS",
  linux: "Linux",
  android: "Android",
};

export function VMSetupDialog({ open, onOpenChange, onComplete }: VMSetupDialogProps) {
  const [checking, setChecking] = useState(true);
  const [isRunning, setIsRunning] = useState(false);
  const [version, setVersion] = useState<string>();
  const [selectedISOs, setSelectedISOs] = useState<Set<string>>(new Set(["ubuntu-24", "linux-alpine"]));
  const [activeTab, setActiveTab] = useState("install");

  const checkStatus = useCallback(async () => {
    setChecking(true);
    const status = await vmLauncher.checkStatus();
    setIsRunning(status.functional);
    setVersion(status.version);
    setChecking(false);

    if (status.functional) {
      setTimeout(() => {
        onComplete();
        onOpenChange(false);
      }, 2000);
    }
  }, [onComplete, onOpenChange]);

  useEffect(() => {
    if (!open) return;
    const initialCheck = setTimeout(() => void checkStatus(), 0);
    const interval = setInterval(checkStatus, 3000);
    return () => {
      clearTimeout(initialCheck);
      clearInterval(interval);
    };
  }, [checkStatus, open]);

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

  const buildInstallerUrl = () => {
    // Build URL with selected ISOs as query params
    const freeSelected = Array.from(selectedISOs).filter(k => ISO_OPTIONS.find(o => o.key === k)?.free);
    const params = freeSelected.length > 0 ? `?isos=${freeSelected.join(",")}` : "";
    return VMLauncher.INSTALLER_URL + params;
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
            <Play className="h-5 w-5" />
            Thalamus VM Setup
          </DialogTitle>
          <DialogDescription>
            One-time setup to enable VM booting. Select your OS images below.
          </DialogDescription>
        </DialogHeader>

        <AnimatePresence mode="wait">
          {checking ? (
            <motion.div
              key="checking"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex items-center justify-center py-12"
            >
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <p className="ml-3 text-muted-foreground">Checking if VM bridge is running...</p>
            </motion.div>
          ) : isRunning ? (
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
                    {version ? `Version ${version} • ` : ""}Launching your VM...
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
                  <TabsTrigger value="install" className="flex-1">Install</TabsTrigger>
                  <TabsTrigger value="isos" className="flex-1">OS Images</TabsTrigger>
                </TabsList>

                <TabsContent value="install" className="space-y-4 mt-4">
                  {/* Primary installer card */}
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
                            Installs QEMU, downloads selected free ISOs, registers the
                            <code className="mx-1 bg-muted px-1 rounded text-[10px]">thalamus://</code>
                            protocol, and adds the bridge to Windows startup. Zero legwork.
                          </p>
                          <div className="text-xs text-muted-foreground mb-3">
                            <span className="font-medium text-foreground">Selected free ISOs: </span>
                            {Array.from(selectedISOs).filter(k => ISO_OPTIONS.find(o => o.key === k)?.free).map(k => ISO_OPTIONS.find(o => o.key === k)?.name).join(", ") || "None"}
                            {" — "}
                            <button className="text-primary underline" onClick={() => setActiveTab("isos")}>change</button>
                          </div>
                          <Button asChild size="sm" className="gap-2 w-full">
                            <a
                              href={VMLauncher.INSTALLER_URL}
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              <Download className="h-3.5 w-3.5" />
                              Download thalamus-installer.exe
                              <ExternalLink className="h-3 w-3 ml-auto opacity-60" />
                            </a>
                          </Button>
                        </div>
                      </div>
                    </Card>
                  )}

                  {/* Steps */}
                  <Card className="p-4 bg-muted/30">
                    <div className="flex items-center gap-2 mb-3">
                      <Zap className="h-4 w-4 text-primary" />
                      <h4 className="font-semibold text-sm">What the installer does:</h4>
                    </div>
                    <ol className="space-y-1.5 text-xs text-muted-foreground list-none">
                      {[
                        "Installs QEMU (VM engine) silently",
                        "Downloads selected free OS ISOs automatically",
                        "Registers thalamus:// protocol — enables one-click VM launch",
                        "Adds bridge to Windows startup — always ready",
                        "Return here and click Boot OS — VMs launch instantly",
                      ].map((step, i) => (
                        <li key={i} className="flex items-start gap-2">
                          <span className="shrink-0 w-4 h-4 rounded-full bg-primary/10 text-primary text-[10px] flex items-center justify-center font-bold mt-0.5">{i + 1}</span>
                          <span>{step}</span>
                        </li>
                      ))}
                    </ol>
                  </Card>

                  {/* macOS/Linux */}
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

                  {/* Waiting indicator */}
                  <Card className="p-3 bg-blue-500/5 border-blue-500/20">
                    <div className="flex gap-2.5 items-center">
                      <Loader2 className="h-4 w-4 text-blue-500 animate-spin shrink-0" />
                      <p className="text-xs text-muted-foreground">
                        Waiting for bridge on localhost:5900 — dialog closes automatically once detected.
                      </p>
                    </div>
                  </Card>

                  <div className="flex justify-between pt-1 border-t">
                    <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
                      Cancel
                    </Button>
                    <Button onClick={checkStatus} variant="secondary" size="sm" className="gap-2">
                      <RefreshCw className="h-3.5 w-3.5" />
                      Check Again
                    </Button>
                  </div>
                </TabsContent>

                <TabsContent value="isos" className="space-y-4 mt-4">
                  <p className="text-xs text-muted-foreground">
                    Select which OS images to download. Free images are downloaded automatically by the installer.
                    Licensed images (Windows, macOS) require a separate download from the vendor.
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
                            className={`p-3 cursor-pointer transition-colors ${selectedISOs.has(iso.key) ? "border-primary/40 bg-primary/5" : ""}`}
                            onClick={() => iso.free && toggleISO(iso.key)}
                          >
                            <div className="flex items-center gap-3">
                              {iso.free ? (
                                <Checkbox
                                  checked={selectedISOs.has(iso.key)}
                                  onCheckedChange={() => toggleISO(iso.key)}
                                  onClick={(e) => e.stopPropagation()}
                                />
                              ) : (
                                <div className="w-4 h-4 rounded border border-border flex items-center justify-center">
                                  <span className="text-[8px] text-muted-foreground">—</span>
                                </div>
                              )}
                              <HardDrive className="h-4 w-4 text-muted-foreground shrink-0" />
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2">
                                  <span className="text-sm font-medium">{iso.name}</span>
                                  <span className="text-xs text-muted-foreground">{iso.version}</span>
                                  {iso.free ? (
                                    <Badge variant="secondary" className="text-[10px] px-1.5 py-0 bg-green-500/10 text-green-600 border-green-500/20">Free</Badge>
                                  ) : (
                                    <Badge variant="secondary" className="text-[10px] px-1.5 py-0 bg-orange-500/10 text-orange-600 border-orange-500/20">Licensed</Badge>
                                  )}
                                </div>
                                <div className="flex items-center gap-2 mt-0.5">
                                  <span className="text-xs text-muted-foreground">{iso.size}</span>
                                  {iso.note && <span className="text-xs text-muted-foreground">• {iso.note}</span>}
                                </div>
                              </div>
                            </div>
                          </Card>
                        ))}
                      </div>
                    </div>
                  ))}

                  <Card className="p-3 bg-amber-500/5 border-amber-500/20">
                    <p className="text-xs text-muted-foreground">
                      <span className="font-medium text-amber-600">Licensed ISOs</span> (Windows, macOS) cannot be auto-downloaded due to licensing.
                      After installing, place them manually at: <code className="bg-muted px-1 rounded">%APPDATA%\Thalamus\isos\windows-11.iso</code>
                    </p>
                  </Card>

                  <div className="flex justify-between pt-1 border-t">
                    <Button variant="outline" size="sm" onClick={() => setActiveTab("install")}>
                      ← Back to Install
                    </Button>
                    <div className="text-xs text-muted-foreground self-center">
                      {Array.from(selectedISOs).filter(k => ISO_OPTIONS.find(o => o.key === k)?.free).length} free ISOs selected
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