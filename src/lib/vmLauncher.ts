/**
 * VM Launcher - Thalamus VM Bridge
 *
 * User flow (v2.0.0 - Roblox-style):
 * 1. User clicks "Boot VM" in browser
 * 2. Check if bridge is running (try connect ws://localhost:5900)
 * 3a. If running: send boot command via WebSocket
 * 3b. If not running: try thalamus:// URI scheme (launches bridge if installed)
 * 4. If URI scheme fails (not installed): show installer download dialog
 * 5. After install, bridge starts automatically and future boots just work
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

  /** Installer URL — one-time setup that installs everything (v6.5.0) */
  static readonly INSTALLER_URL = "https://github.com/hardcoregamingsyle/thalamus/releases/download/vm-installer-v6.5.0/thalamus-installer-v6.5.0.exe";
  /** Bridge URL — the bridge exe itself (for manual install) */
  static readonly BRIDGE_URL = "https://github.com/hardcoregamingsyle/thalamus/releases/download/vm-bridge-v2.1.0/thalamus-vm-bridge.exe";

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

  /**
   * Launch the bridge via thalamus:// URI scheme (like Roblox).
   * If the installer has been run, this will launch the bridge automatically.
   * Returns true if the URI was dispatched (doesn't guarantee bridge started).
   */
  launchViaUriScheme(os: string, ram: number, cores: number): boolean {
    try {
      const uri = `thalamus://boot?os=${encodeURIComponent(os)}&ram=${ram}&cores=${cores}`;
      window.location.href = uri;
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Try to launch bridge via URI scheme, then poll for it to come up.
   * Returns true if bridge came up within timeout.
   */
  async launchAndWait(os: string, ram: number, cores: number, timeoutMs = 15000): Promise<boolean> {
    this.launchViaUriScheme(os, ram, cores);
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      await new Promise(r => setTimeout(r, 1000));
      const status = await this.checkStatus();
      if (status.functional) return true;
    }
    return false;
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
    isoNeeded?: string;
    hasIso?: boolean;
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
            resolve({ success: true, vmId: data.vmId, vncPort: data.vncPort, isoNeeded: data.isoNeeded, hasIso: data.hasIso });
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
      }, 15000);
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

  /** Returns the installer download URL (primary) */
  getInstallerUrl(): string {
    return VMLauncher.INSTALLER_URL;
  }

  /** Returns platform-specific download URL */
  getDownloadUrl(): string {
    if (typeof navigator === "undefined") return VMLauncher.INSTALLER_URL;
    const p = navigator.platform.toLowerCase();
    if (p.includes("win")) return VMLauncher.INSTALLER_URL;
    if (p.includes("mac")) return "/downloads/setup-macos.sh";
    return "/downloads/setup-linux.sh";
  }

  /** Returns the filename for the download */
  getDownloadFilename(): string {
    if (typeof navigator === "undefined") return "thalamus-installer.exe";
    const p = navigator.platform.toLowerCase();
    if (p.includes("win")) return "thalamus-installer.exe";
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
      "Download thalamus-installer.exe",
      "Double-click to run it",
      "If Windows Defender shows a warning, click 'More info' → 'Run anyway'",
      "The installer sets up QEMU, downloads Ubuntu/Alpine ISOs, and registers the thalamus:// protocol",
      "After install, clicking 'Boot OS' will launch VMs automatically — no extra steps",
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