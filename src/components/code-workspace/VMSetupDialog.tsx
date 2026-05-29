import { useState, useEffect } from "react";
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
import { Download, CheckCircle2, Loader2, Play, ExternalLink } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { vmLauncher } from "@/lib/vmLauncher";

interface VMSetupDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onComplete: () => void;
}

export function VMSetupDialog({ open, onOpenChange, onComplete }: VMSetupDialogProps) {
  const [checking, setChecking] = useState(true);
  const [isRunning, setIsRunning] = useState(false);
  const [version, setVersion] = useState<string>();

  useEffect(() => {
    if (open) {
      checkStatus();
      // Check every 3 seconds
      const interval = setInterval(checkStatus, 3000);
      return () => clearInterval(interval);
    }
  }, [open]);

  const checkStatus = async () => {
    setChecking(true);
    const status = await vmLauncher.checkStatus();
    setIsRunning(status.running);
    setVersion(status.version);
    setChecking(false);

    if (status.running) {
      // Auto-close after 2 seconds if running
      setTimeout(() => {
        onComplete();
        onOpenChange(false);
      }, 2000);
    }
  };

  const downloadUrl = vmLauncher.getDownloadUrl();
  const instructions = vmLauncher.getInstructions();
  const platform = navigator.platform.toLowerCase();
  const isWindows = platform.includes("win");
  const isMac = platform.includes("mac");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Play className="h-5 w-5" />
            VM Setup - One Time Only
          </DialogTitle>
          <DialogDescription>
            Download and run the Thalamus VM launcher to boot virtual machines
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
                    Version {version} • Ready to boot VMs
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
              className="space-y-6"
            >
              <Card className="p-6 bg-primary/5 border-primary/20">
                <div className="flex items-start gap-4">
                  <div className="rounded-lg bg-primary/10 p-3">
                    <Download className="h-6 w-6 text-primary" />
                  </div>
                  <div className="flex-1">
                    <h3 className="font-semibold mb-2">Download VM Launcher</h3>
                    <p className="text-sm text-muted-foreground mb-4">
                      Single executable file (~50MB) that includes everything. No Node.js or complex
                      setup required.
                    </p>
                    <div className="flex gap-3">
                      <Button asChild className="gap-2">
                        <a href={downloadUrl} download>
                          <Download className="h-4 w-4" />
                          Download for {isWindows ? "Windows" : isMac ? "macOS" : "Linux"}
                        </a>
                      </Button>
                      <Button variant="outline" asChild className="gap-2">
                        <a
                          href="https://github.com/thalamus-ai/vm-launcher/releases"
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          <ExternalLink className="h-4 w-4" />
                          All Versions
                        </a>
                      </Button>
                    </div>
                  </div>
                </div>
              </Card>

              <div className="space-y-3">
                <h4 className="font-medium">Setup Instructions:</h4>
                <div className="space-y-2">
                  {instructions.map((instruction, index) => (
                    <div key={index} className="flex items-start gap-3 text-sm">
                      <Badge variant="outline" className="mt-0.5 shrink-0">
                        {index + 1}
                      </Badge>
                      <p className="text-muted-foreground">{instruction}</p>
                    </div>
                  ))}
                </div>
              </div>

              <Card className="p-4 bg-blue-500/5 border-blue-500/20">
                <div className="flex gap-3">
                  <Loader2 className="h-5 w-5 text-blue-500 animate-spin shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-medium text-blue-700 dark:text-blue-300">
                      Waiting for VM bridge to start...
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      This dialog will automatically close once the bridge is detected running.
                    </p>
                  </div>
                </div>
              </Card>

              <div className="flex justify-between pt-4 border-t">
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
