import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Download, Terminal, Wifi, CheckCircle2, AlertCircle } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

interface QemuSetupDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConnect: (port: number) => void;
  connected: boolean;
}

export function QemuSetupDialog({ open, onOpenChange, onConnect, connected }: QemuSetupDialogProps) {
  const [port, setPort] = useState(5900);
  const [testing, setTesting] = useState(false);

  const testConnection = async () => {
    setTesting(true);
    try {
      // Try to connect to WebSocket
      const ws = new WebSocket(`ws://localhost:${port}`);

      await new Promise((resolve, reject) => {
        ws.onopen = () => {
          toast.success("Connected to local QEMU!");
          setTesting(false);
          onConnect(port);
          resolve(true);
        };
        ws.onerror = () => {
          toast.error("Cannot connect. Make sure QEMU bridge is running.");
          setTesting(false);
          reject();
        };

        setTimeout(() => {
          ws.close();
          reject(new Error("Connection timeout"));
        }, 5000);
      });
    } catch (err) {
      setTesting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[80vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Terminal className="h-5 w-5" />
            QEMU Setup - Run 64-bit OS on Your Device
          </DialogTitle>
          <DialogDescription>
            Install QEMU locally to run Windows 11, macOS, Ubuntu, and Android with full performance
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="h-[500px] pr-4">
          <div className="space-y-6">
            {/* Status */}
            <Alert className={connected ? "border-green-500" : "border-orange-500"}>
              {connected ? (
                <>
                  <CheckCircle2 className="h-4 w-4 text-green-500" />
                  <AlertDescription className="text-green-600">
                    Connected to local QEMU bridge on port {port}
                  </AlertDescription>
                </>
              ) : (
                <>
                  <AlertCircle className="h-4 w-4 text-orange-500" />
                  <AlertDescription className="text-orange-600">
                    Not connected. Follow the setup steps below to install QEMU bridge.
                  </AlertDescription>
                </>
              )}
            </Alert>

            {/* Step 1: Install QEMU */}
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Badge>Step 1</Badge>
                <h3 className="font-semibold">Install QEMU</h3>
              </div>

              <div className="space-y-2 pl-4 border-l-2 border-muted">
                <p className="text-sm text-muted-foreground">Choose your operating system:</p>

                <div className="space-y-3">
                  <div>
                    <p className="font-medium text-sm mb-2">🪟 Windows</p>
                    <div className="bg-muted rounded p-3 font-mono text-xs">
                      <p># Download installer from:</p>
                      <p className="text-primary">https://qemu.weilnetz.de/w64/</p>
                      <p className="mt-2"># Or use Chocolatey:</p>
                      <p>choco install qemu</p>
                    </div>
                  </div>

                  <div>
                    <p className="font-medium text-sm mb-2">🍎 macOS</p>
                    <div className="bg-muted rounded p-3 font-mono text-xs">
                      <p>brew install qemu</p>
                    </div>
                  </div>

                  <div>
                    <p className="font-medium text-sm mb-2">🐧 Linux</p>
                    <div className="bg-muted rounded p-3 font-mono text-xs">
                      <p># Ubuntu/Debian:</p>
                      <p>sudo apt install qemu-system-x86 qemu-utils</p>
                      <p className="mt-2"># Fedora:</p>
                      <p>sudo dnf install qemu</p>
                      <p className="mt-2"># Arch:</p>
                      <p>sudo pacman -S qemu</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Step 2: Install noVNC Bridge */}
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Badge>Step 2</Badge>
                <h3 className="font-semibold">Install Thalamus QEMU Bridge</h3>
              </div>

              <div className="space-y-2 pl-4 border-l-2 border-muted">
                <p className="text-sm text-muted-foreground">
                  Install our bridge service to connect browser to QEMU:
                </p>

                <div className="bg-muted rounded p-3 font-mono text-xs space-y-2">
                  <p># Install via npm (recommended):</p>
                  <p className="text-primary">npm install -g @thalamus/qemu-bridge</p>
                  <p className="mt-3"># Or download standalone:</p>
                  <p className="text-primary">https://github.com/thalamus-ai/qemu-bridge/releases</p>
                </div>

                <Alert className="mt-3">
                  <Download className="h-4 w-4" />
                  <AlertDescription className="text-xs">
                    Bridge service creates WebSocket connection between browser and local QEMU via noVNC
                  </AlertDescription>
                </Alert>
              </div>
            </div>

            {/* Step 3: Start Bridge */}
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Badge>Step 3</Badge>
                <h3 className="font-semibold">Start QEMU Bridge</h3>
              </div>

              <div className="space-y-2 pl-4 border-l-2 border-muted">
                <div className="bg-muted rounded p-3 font-mono text-xs space-y-2">
                  <p># Start bridge on default port (5900):</p>
                  <p className="text-primary">thalamus-qemu-bridge</p>
                  <p className="mt-3"># Or specify custom port:</p>
                  <p className="text-primary">thalamus-qemu-bridge --port 5901</p>
                </div>

                <p className="text-sm text-muted-foreground mt-2">
                  Bridge will automatically:
                </p>
                <ul className="text-sm text-muted-foreground list-disc pl-6 space-y-1">
                  <li>Start QEMU with selected OS</li>
                  <li>Set up VNC display server</li>
                  <li>Create WebSocket bridge for browser connection</li>
                  <li>Download OS images if needed</li>
                </ul>
              </div>
            </div>

            {/* Step 4: Connect */}
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Badge>Step 4</Badge>
                <h3 className="font-semibold">Connect to Bridge</h3>
              </div>

              <div className="space-y-3 pl-4 border-l-2 border-muted">
                <div className="space-y-2">
                  <Label htmlFor="port">WebSocket Port</Label>
                  <Input
                    id="port"
                    type="number"
                    value={port}
                    onChange={(e) => setPort(parseInt(e.target.value) || 5900)}
                    min={1024}
                    max={65535}
                  />
                  <p className="text-xs text-muted-foreground">
                    Default: 5900 (change if bridge is running on different port)
                  </p>
                </div>

                <Button
                  onClick={testConnection}
                  disabled={testing}
                  className="w-full gap-2"
                >
                  {testing ? (
                    <>Testing Connection...</>
                  ) : connected ? (
                    <>
                      <CheckCircle2 className="h-4 w-4" />
                      Connected
                    </>
                  ) : (
                    <>
                      <Wifi className="h-4 w-4" />
                      Test Connection
                    </>
                  )}
                </Button>
              </div>
            </div>

            {/* Features */}
            <Alert>
              <AlertDescription>
                <p className="font-semibold mb-2">Why use local QEMU?</p>
                <ul className="text-sm space-y-1 list-disc pl-4">
                  <li>Run 64-bit OS: Windows 11, macOS, Ubuntu, Android</li>
                  <li>Up to 16GB RAM for smooth performance</li>
                  <li>Native CPU performance (not emulation)</li>
                  <li>GPU acceleration support</li>
                  <li>100% private - runs entirely on your device</li>
                  <li>No internet required after OS download</li>
                </ul>
              </AlertDescription>
            </Alert>
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
