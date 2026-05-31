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
import { Download, CheckCircle2, Loader2, Play, Terminal, Monitor, Apple, ExternalLink, Package, Zap } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { vmLauncher, VMLauncher } from "@/lib/vmLauncher";

interface VMSetupDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onComplete: () => void;
}

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
      }, 1500);
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
      <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Play className="h-5 w-5" />
            Thalamus VM Setup
          </DialogTitle>
          <DialogDescription>
            One-time install — then VMs launch with a single click, like Roblox.
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
              <p className="ml-3 text-muted-foreground">Checking for VM bridge...</p>
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
                        Installs QEMU, downloads Ubuntu &amp; Alpine Linux ISOs, registers the
                        <code className="mx-1 bg-muted px-1 rounded text-[10px]">thalamus://</code>
                        protocol, and adds the bridge to Windows startup. Zero legwork.
                      </p>
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
                  <h4 className="font-semibold text-sm">After installing:</h4>
                </div>
                <ol className="space-y-1.5 text-xs text-muted-foreground list-none">
                  {[
                    "Run thalamus-installer.exe (one time only)",
                    "QEMU installs automatically — no manual steps",
                    "Ubuntu 24.04 & Alpine Linux ISOs download automatically",
                    "Bridge registers as thalamus:// protocol handler",
                    "Return here — clicking Boot OS launches VMs instantly",
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
                  <Loader2 className="h-3.5 w-3.5" />
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