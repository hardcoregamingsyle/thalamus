/**
 * VM Launcher - Thalamus VM Bridge
 *
 * User flow:
 * 1. User clicks "Boot VM" in browser
 * 2. Check if bridge is running (try connect ws://localhost:5900)
 * 3. If not running, show download dialog
 * 4. User downloads and runs the exe/script (one time only)
 * 5. Bridge stays running in background
 * 6. All future VM boots just work
 */

interface VMStatus {
  running: boolean;
  functional: boolean;
  version?: string;
  platform?: string;
  activeVMs?: number;
  error?: string;
}

export class VMLauncher {
  private ws: WebSocket | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 3;
  private readonly bridgeUrl = "ws://localhost:5900";

  async checkStatus(): Promise<VMStatus> {
    if (typeof WebSocket === "undefined") {
      return { running: false, functional: false, error: "WebSocket not available" };
    }

    return new Promise((resolve) => {
      const ws = new WebSocket(this.bridgeUrl);

      const timeout = setTimeout(() => {
        ws.close();
        resolve({ running: false, functional: false, error: "Timed out" });
      }, 2000);

      ws.onopen = () => {
        clearTimeout(timeout);
        const responseTimeout = setTimeout(() => {
          ws.close();
          resolve({ running: false, functional: false, error: "No response from bridge" });
        }, 2000);

        ws.send(JSON.stringify({ action: "ping" }));

        ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            clearTimeout(responseTimeout);
            ws.close();
            // Accept any valid JSON response as "functional"
            const functional = Boolean(data.version || data.platform || data.activeVMs !== undefined);
            resolve({
              running: functional,
              functional,
              version: data.version,
              platform: data.platform,
              activeVMs: data.activeVMs,
            });
          } catch {
            clearTimeout(responseTimeout);
            ws.close();
            resolve({ running: false, functional: false, error: "Invalid response" });
          }
        };
      };

      ws.onerror = () => {
        clearTimeout(timeout);
        ws.close();
        resolve({ running: false, functional: false, error: "Bridge not reachable" });
      };
    });
  }

  async connect(): Promise<boolean> {
    return new Promise((resolve) => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        resolve(true);
        return;
      }

      this.ws = new WebSocket(this.bridgeUrl);

      this.ws.onopen = () => {
        this.reconnectAttempts = 0;
        resolve(true);
      };

      this.ws.onerror = () => {
        resolve(false);
      };

      this.ws.onclose = () => {
        this.ws = null;
        if (this.reconnectAttempts < this.maxReconnectAttempts) {
          this.reconnectAttempts++;
          setTimeout(() => this.connect(), 2000);
        }
      };
    });
  }

  async bootVM(os: string, ram: number, cores: number): Promise<{
    success: boolean;
    vmId?: string;
    vncPort?: number;
    error?: string;
  }> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      const connected = await this.connect();
      if (!connected) {
        return { success: false, error: "VM bridge not running. Please run the setup script first." };
      }
    }

    return new Promise((resolve) => {
      if (!this.ws) {
        resolve({ success: false, error: "Not connected" });
        return;
      }

      this.ws.send(JSON.stringify({ action: "boot", os, ram, cores }));

      const messageHandler = (event: MessageEvent) => {
        try {
          const data = JSON.parse(event.data);
          if (data.status === "success") {
            resolve({ success: true, vmId: data.vmId, vncPort: data.vncPort });
          } else {
            resolve({ success: false, error: data.message || "Failed to boot VM" });
          }
          this.ws?.removeEventListener("message", messageHandler);
        } catch (err) {
          resolve({ success: false, error: err instanceof Error ? err.message : "Unknown error" });
        }
      };

      this.ws.addEventListener("message", messageHandler);
      setTimeout(() => {
        this.ws?.removeEventListener("message", messageHandler);
        resolve({ success: false, error: "Timeout waiting for VM to boot" });
      }, 10000);
    });
  }

  async stopVM(vmId: string): Promise<boolean> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return false;

    return new Promise((resolve) => {
      if (!this.ws) { resolve(false); return; }

      this.ws.send(JSON.stringify({ action: "stop", vmId }));

      const messageHandler = (event: MessageEvent) => {
        try {
          const data = JSON.parse(event.data);
          resolve(data.status === "success");
          this.ws?.removeEventListener("message", messageHandler);
        } catch { resolve(false); }
      };

      this.ws.addEventListener("message", messageHandler);
      setTimeout(() => {
        this.ws?.removeEventListener("message", messageHandler);
        resolve(false);
      }, 5000);
    });
  }

  /** Returns platform-specific download URL */
  getDownloadUrl(): string {
    if (typeof navigator === "undefined") return "https://github.com/hardcoregamingsyle/thalamus/releases/download/vm-bridge-v1.0.1/thalamus-vm-bridge.exe";
    const p = navigator.platform.toLowerCase();
    if (p.includes("win")) return "https://github.com/hardcoregamingsyle/thalamus/releases/download/vm-bridge-v1.0.1/thalamus-vm-bridge.exe";
    if (p.includes("mac")) return "/downloads/setup-macos.sh";
    return "/downloads/setup-linux.sh";
  }

  /** Returns the filename for the download */
  getDownloadFilename(): string {
    if (typeof navigator === "undefined") return "thalamus-vm-bridge.exe";
    const p = navigator.platform.toLowerCase();
    if (p.includes("win")) return "thalamus-vm-bridge.exe";
    if (p.includes("mac")) return "setup-macos.sh";
    return "setup-linux.sh";
  }

  /** Returns platform name */
  getPlatformName(): string {
    if (typeof navigator === "undefined") return "Windows";
    const p = navigator.platform.toLowerCase();
    if (p.includes("win")) return "Windows";
    if (p.includes("mac")) return "macOS";
    return "Linux";
  }

  /** Returns platform-specific instructions */
  getInstructions(): string[] {
    if (typeof navigator === "undefined") return this._windowsInstructions();
    const p = navigator.platform.toLowerCase();
    if (p.includes("win")) return this._windowsInstructions();
    if (p.includes("mac")) return this._macInstructions();
    return this._linuxInstructions();
  }

  private _windowsInstructions(): string[] {
    return [
      "Download thalamus-vm-bridge.exe",
      "Double-click to run it",
      "If Windows Defender shows a warning, click 'More info' → 'Run anyway'",
      "The app installs QEMU automatically and starts the bridge",
      "Keep the window open while using Thalamus VMs",
    ];
  }

  private _macInstructions(): string[] {
    return [
      "Download setup-macos.sh",
      "Open Terminal and run: chmod +x ~/Downloads/setup-macos.sh",
      "Then run: ~/Downloads/setup-macos.sh",
      "The script installs Node.js + QEMU via Homebrew (if needed) and starts the bridge",
      "Keep the terminal window open while using Thalamus VMs",
    ];
  }

  private _linuxInstructions(): string[] {
    return [
      "Download setup-linux.sh",
      "Open terminal and run: chmod +x ~/Downloads/setup-linux.sh",
      "Then run: ~/Downloads/setup-linux.sh",
      "The script installs Node.js + QEMU via your package manager (if needed) and starts the bridge",
      "Keep the terminal window open while using Thalamus VMs",
    ];
  }

  disconnect() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}

export const vmLauncher = new VMLauncher();