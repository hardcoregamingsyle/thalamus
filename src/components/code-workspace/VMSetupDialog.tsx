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
import { Download, CheckCircle2, Loader2, Play, Terminal, Monitor, Apple, ExternalLink } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { vmLauncher } from "@/lib/vmLauncher";

interface VMSetupDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onComplete: () => void;
}

const PLATFORMS = [
  {
    name: "Windows",
    icon: Monitor,
    file: "thalamus-vm-bridge.exe",
    url: "https://github.com/hardcoregamingsyle/thalamus/releases/download/vm-bridge-v1.2.0/thalamus-vm-bridge.exe",
    hint: "Professional installer — double-click to run. Auto-installs QEMU.",
    isExe: true,
  },
  {
    name: "macOS",
    icon: Apple,
    file: "setup-macos.sh",
    url: "/downloads/setup-macos.sh",
    hint: "chmod +x ~/Downloads/setup-macos.sh && ~/Downloads/setup-macos.sh",
    isExe: false,
  },
  {
    name: "Linux",
    icon: Terminal,
    file: "setup-linux.sh",
    url: "/downloads/setup-linux.sh",
    hint: "chmod +x ~/Downloads/setup-linux.sh && ~/Downloads/setup-linux.sh",
    isExe: false,
  },
];

export function VMSetupDialog({ open, onOpenChange, onComplete }: VMSetupDialogProps) {
  const [checking, setChecking] = useState(true);
  const [isRunning, setIsRunning] = useState(false);
  const [version, setVersion] = useState<string>();

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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Play className="h-5 w-5" />
            VM Bridge Setup
          </DialogTitle>
          <DialogDescription>
            One-time setup to enable VM booting. Everything installs automatically.
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
                  <h3 className="text-xl font-semibold">VM Bridge Running!</h3>
                  <p className="text-muted-foreground mt-1">
                    {version ? `Version ${version} • ` : ""}Ready to boot VMs
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
              className="space-y-5"
            >
              {/* Platform download cards */}
              <div className="space-y-3">
                <h4 className="font-medium text-sm text-muted-foreground uppercase tracking-wide">
                  Download for Your OS
                </h4>
                {PLATFORMS.map((p) => {
                  const Icon = p.icon;
                  const isCurrent = p.name === currentPlatform;
                  return (
                    <Card
                      key={p.name}
                      className={`p-4 transition-colors ${isCurrent ? "border-primary/50 bg-primary/5" : ""}`}
                    >
                      <div className="flex items-center gap-4">
                        <div className={`rounded-lg p-2.5 ${isCurrent ? "bg-primary/10" : "bg-muted"}`}>
                          <Icon className={`h-5 w-5 ${isCurrent ? "text-primary" : "text-muted-foreground"}`} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="font-semibold text-sm">{p.name}</span>
                            {isCurrent && (
                              <Badge variant="secondary" className="text-xs">Your OS</Badge>
                            )}
                            {p.isExe && (
                              <Badge className="text-xs bg-blue-500/10 text-blue-600 border-blue-500/20">
                                .exe
                              </Badge>
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground truncate">{p.hint}</p>
                        </div>
                        <Button
                          asChild
                          size="sm"
                          variant={isCurrent ? "default" : "outline"}
                          className="gap-2 shrink-0"
                        >
                          <a
                            href={p.url}
                            download={p.file}
                            target={p.isExe ? "_blank" : undefined}
                            rel={p.isExe ? "noopener noreferrer" : undefined}
                          >
                            {p.isExe ? <ExternalLink className="h-3 w-3" /> : <Download className="h-3 w-3" />}
                            {p.file}
                          </a>
                        </Button>
                      </div>
                    </Card>
                  );
                })}
              </div>

              {/* What it does */}
              <Card className="p-4 bg-muted/30">
                <h4 className="font-medium text-sm mb-2">What happens when you run it:</h4>
                <ul className="space-y-1 text-xs text-muted-foreground">
                  <li>• Automatically downloads and installs QEMU (if not present)</li>
                  <li>• Starts a local WebSocket bridge on port 5900</li>
                  <li>• Enables booting Windows, macOS, Linux, and Android VMs</li>
                  <li>• Runs entirely on your machine — no data sent to servers</li>
                </ul>
              </Card>

              <Card className="p-4 bg-blue-500/5 border-blue-500/20">
                <div className="flex gap-3">
                  <Loader2 className="h-5 w-5 text-blue-500 animate-spin shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-medium text-blue-700 dark:text-blue-300">
                      Waiting for VM bridge to start...
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      This dialog closes automatically once the bridge is detected on localhost:5900.
                    </p>
                  </div>
                </div>
              </Card>

              <div className="flex justify-between pt-2 border-t">
                <Button variant="outline" onClick={() => onOpenChange(false)}>
                  Cancel
                </Button>
                <Button onClick={checkStatus} variant="secondary" className="gap-2">
                  <Loader2 className="h-4 w-4" />
                  Check Again
                </Button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </DialogContent>
    </Dialog>
  );
}