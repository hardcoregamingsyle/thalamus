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
  private readonly windowsDownloadUrl = "/downloads/thalamus-vm-windows.exe";

  /**
   * Check if VM bridge is running
   */
  async checkStatus(): Promise<VMStatus> {
    if (typeof WebSocket === "undefined") {
      return { running: false, functional: false, error: "WebSocket is not available" };
    }

    return new Promise((resolve) => {
      const ws = new WebSocket(this.bridgeUrl);

      const timeout = setTimeout(() => {
        ws.close();
        resolve({ running: false, functional: false, error: "Timed out waiting for VM bridge" });
      }, 2000);

      ws.onopen = () => {
        clearTimeout(timeout);
        const responseTimeout = setTimeout(() => {
          ws.close();
          resolve({ running: false, functional: false, error: "VM bridge did not answer the health check" });
        }, 2000);

        // Send ping to get version info
        ws.send(JSON.stringify({ action: "ping" }));

        ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            clearTimeout(responseTimeout);
            ws.close();
            const functional = data.status === "success" && Boolean(data.version);
            resolve({
              running: functional,
              functional,
              version: data.version,
              platform: data.platform,
              activeVMs: data.activeVMs,
              error: functional ? undefined : "VM bridge response was not functional",
            });
          } catch {
            clearTimeout(responseTimeout);
            ws.close();
            resolve({ running: false, functional: false, error: "VM bridge returned an invalid response" });
          }
        };
      };

      ws.onerror = () => {
        clearTimeout(timeout);
        ws.close();
        resolve({ running: false, functional: false, error: "VM bridge is not reachable" });
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

      this.ws = new WebSocket(this.bridgeUrl);

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
   * Update these URLs after building and hosting the executables
   */
  getDownloadUrl(): string {
    if (typeof navigator === "undefined") {
      return this.windowsDownloadUrl;
    }

    const platform = navigator.platform.toLowerCase();

    if (platform.includes("win")) {
      return this.windowsDownloadUrl;
    }

    return this.windowsDownloadUrl;
  }

  /**
   * Get platform-specific instructions
   */
  getInstructions(): string[] {
    if (typeof navigator === "undefined") {
      return [
        "1. Download thalamus-vm-windows.exe on a Windows 11 PC",
        "2. Double-click to run the executable",
        "3. Return to Thalamus after the bridge window opens",
        "4. The Boot OS button will enable automatically",
      ];
    }

    const platform = navigator.platform.toLowerCase();

    if (platform.includes("win")) {
      return [
        "1. Download thalamus-vm-windows.exe",
        "2. Double-click to run",
        "3. Windows may show a security warning - click 'More info' then 'Run anyway'",
        "4. That's it! VM bridge is now running",
      ];
    }

    return [
      "1. Download thalamus-vm-windows.exe on a Windows 11 PC",
      "2. Double-click to run the executable",
      "3. Return to Thalamus after the bridge window opens",
      "4. The Boot OS button will enable automatically",
    ];
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
