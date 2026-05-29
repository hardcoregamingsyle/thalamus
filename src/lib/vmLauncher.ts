/**
 * VM Launcher - Auto-download and run Thalamus VM executable
 *
 * User flow:
 * 1. User clicks "Boot VM" in browser
 * 2. Check if executable is running (try connect ws://localhost:5900)
 * 3. If not running, prompt download
 * 4. User downloads and runs .exe (one time only)
 * 5. Executable stays running in background
 * 6. All future VM boots just work
 */

interface VMStatus {
  running: boolean;
  version?: string;
  platform?: string;
  activeVMs?: number;
}

export class VMLauncher {
  private ws: WebSocket | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 3;

  /**
   * Check if VM bridge is running
   */
  async checkStatus(): Promise<VMStatus> {
    return new Promise((resolve) => {
      const ws = new WebSocket("ws://localhost:5900");

      const timeout = setTimeout(() => {
        ws.close();
        resolve({ running: false });
      }, 2000);

      ws.onopen = () => {
        clearTimeout(timeout);

        // Send ping to get version info
        ws.send(JSON.stringify({ action: "ping" }));

        ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            ws.close();
            resolve({
              running: true,
              version: data.version,
              platform: data.platform,
              activeVMs: data.activeVMs,
            });
          } catch {
            ws.close();
            resolve({ running: false });
          }
        };
      };

      ws.onerror = () => {
        clearTimeout(timeout);
        ws.close();
        resolve({ running: false });
      };
    });
  }

  /**
   * Connect to VM bridge
   */
  async connect(): Promise<boolean> {
    return new Promise((resolve) => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        resolve(true);
        return;
      }

      this.ws = new WebSocket("ws://localhost:5900");

      this.ws.onopen = () => {
        console.log("✅ Connected to Thalamus VM Bridge");
        this.reconnectAttempts = 0;
        resolve(true);
      };

      this.ws.onerror = () => {
        console.error("❌ Failed to connect to VM bridge");
        resolve(false);
      };

      this.ws.onclose = () => {
        console.log("🔌 Disconnected from VM bridge");
        this.ws = null;

        // Auto-reconnect
        if (this.reconnectAttempts < this.maxReconnectAttempts) {
          this.reconnectAttempts++;
          setTimeout(() => this.connect(), 2000);
        }
      };
    });
  }

  /**
   * Boot a VM
   */
  async bootVM(os: string, ram: number, cores: number): Promise<{
    success: boolean;
    vmId?: string;
    vncPort?: number;
    error?: string;
  }> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      const connected = await this.connect();
      if (!connected) {
        return {
          success: false,
          error: "VM bridge not running. Please download and start Thalamus VM.",
        };
      }
    }

    return new Promise((resolve) => {
      if (!this.ws) {
        resolve({ success: false, error: "Not connected" });
        return;
      }

      this.ws.send(
        JSON.stringify({
          action: "boot",
          os,
          ram,
          cores,
        })
      );

      const messageHandler = (event: MessageEvent) => {
        try {
          const data = JSON.parse(event.data);

          if (data.status === "success") {
            resolve({
              success: true,
              vmId: data.vmId,
              vncPort: data.vncPort,
            });
          } else {
            resolve({
              success: false,
              error: data.message || "Failed to boot VM",
            });
          }

          this.ws?.removeEventListener("message", messageHandler);
        } catch (err) {
          resolve({
            success: false,
            error: err instanceof Error ? err.message : "Unknown error",
          });
        }
      };

      this.ws.addEventListener("message", messageHandler);

      // Timeout after 10 seconds
      setTimeout(() => {
        this.ws?.removeEventListener("message", messageHandler);
        resolve({ success: false, error: "Timeout waiting for VM to boot" });
      }, 10000);
    });
  }

  /**
   * Stop a VM
   */
  async stopVM(vmId: string): Promise<boolean> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return false;
    }

    return new Promise((resolve) => {
      if (!this.ws) {
        resolve(false);
        return;
      }

      this.ws.send(JSON.stringify({ action: "stop", vmId }));

      const messageHandler = (event: MessageEvent) => {
        try {
          const data = JSON.parse(event.data);
          resolve(data.status === "success");
          this.ws?.removeEventListener("message", messageHandler);
        } catch {
          resolve(false);
        }
      };

      this.ws.addEventListener("message", messageHandler);

      setTimeout(() => {
        this.ws?.removeEventListener("message", messageHandler);
        resolve(false);
      }, 5000);
    });
  }

  /**
   * Get download URL for current platform
   */
  getDownloadUrl(): string {
    const platform = navigator.platform.toLowerCase();

    if (platform.includes("win")) {
      return "https://github.com/thalamus-ai/vm-launcher/releases/latest/download/thalamus-vm-windows.exe";
    } else if (platform.includes("mac")) {
      return "https://github.com/thalamus-ai/vm-launcher/releases/latest/download/thalamus-vm-macos";
    } else {
      return "https://github.com/thalamus-ai/vm-launcher/releases/latest/download/thalamus-vm-linux";
    }
  }

  /**
   * Get platform-specific instructions
   */
  getInstructions(): string[] {
    const platform = navigator.platform.toLowerCase();

    if (platform.includes("win")) {
      return [
        "1. Download thalamus-vm-windows.exe",
        "2. Double-click to run",
        "3. Windows may show security warning - click 'More info' → 'Run anyway'",
        "4. That's it! VM bridge is now running",
      ];
    } else if (platform.includes("mac")) {
      return [
        "1. Download thalamus-vm-macos",
        "2. Open Terminal and run: chmod +x ~/Downloads/thalamus-vm-macos",
        "3. Run: ~/Downloads/thalamus-vm-macos",
        "4. macOS may ask for permissions - allow them",
        "5. That's it! VM bridge is now running",
      ];
    } else {
      return [
        "1. Download thalamus-vm-linux",
        "2. Open terminal and run: chmod +x ~/Downloads/thalamus-vm-linux",
        "3. Run: ~/Downloads/thalamus-vm-linux",
        "4. That's it! VM bridge is now running",
      ];
    }
  }

  /**
   * Disconnect
   */
  disconnect() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}

// Singleton instance
export const vmLauncher = new VMLauncher();
