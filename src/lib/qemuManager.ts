// QEMU Virtual Machine Manager for 64-bit Operating Systems
// Uses JSLinux (copy.sh) QEMU WebAssembly port for x86_64 emulation

type QEMUInstance = any;

// Lazy load QEMU to avoid bundling issues
let QEMU: any = null;

async function loadQEMU() {
  if (!QEMU) {
    // QEMU in browser is not production-ready
    // Full 64-bit x86_64 emulation requires significant resources
    // and there's no stable WebAssembly QEMU implementation available
    throw new Error(
      "QEMU 64-bit emulation is not available in browser. " +
      "Browser VMs are limited to 32-bit x86 (v86). " +
      "For 64-bit Windows 11, modern Linux, or macOS testing, use Daytona Cloud sandbox instead."
    );
  }
  return QEMU;
}

export interface QEMUConfig {
  id: string;
  name: string;
  os: "linux64" | "windows64" | "macos64";
  memory: number; // MB
  vga_memory: number; // MB
  screen_container: HTMLElement | null;
  cdrom_url?: string;
  hda_url?: string;
  cpu_cores: number;
}

export interface QEMUVMInstance {
  id: string;
  emulator: QEMUInstance;
  config: QEMUConfig;
  state: "booting" | "running" | "stopped" | "paused";
  screen: HTMLCanvasElement;
}

// Pre-configured 64-bit OS templates
export const QEMU_OS_TEMPLATES: Record<string, Partial<QEMUConfig>> = {
  "linux-ubuntu": {
    name: "Ubuntu 24.04 LTS (64-bit)",
    os: "linux64",
    memory: 2048,
    vga_memory: 32,
    cpu_cores: 2,
    cdrom_url: "https://releases.ubuntu.com/24.04/ubuntu-24.04-desktop-amd64.iso",
  },
  "linux-fedora": {
    name: "Fedora 40 Workstation (64-bit)",
    os: "linux64",
    memory: 2048,
    vga_memory: 32,
    cpu_cores: 2,
    cdrom_url: "https://download.fedoraproject.org/pub/fedora/linux/releases/40/Workstation/x86_64/iso/Fedora-Workstation-Live-x86_64-40-1.14.iso",
  },
  "windows-11": {
    name: "Windows 11 Pro (64-bit)",
    os: "windows64",
    memory: 4096,
    vga_memory: 64,
    cpu_cores: 2,
    // Note: User must provide Windows 11 ISO (licensing)
    cdrom_url: undefined,
  },
  "windows-10": {
    name: "Windows 10 Pro (64-bit)",
    os: "windows64",
    memory: 2048,
    vga_memory: 32,
    cpu_cores: 2,
    // Note: User must provide Windows 10 ISO (licensing)
    cdrom_url: undefined,
  },
  "macos-ventura": {
    name: "macOS 13 Ventura (64-bit)",
    os: "macos64",
    memory: 4096,
    vga_memory: 64,
    cpu_cores: 2,
    // Note: macOS requires special QEMU configuration and licensing
    cdrom_url: undefined,
  },
};

class QEMUManager {
  private instances: Map<string, QEMUVMInstance> = new Map();

  /**
   * Create a new QEMU VM instance (64-bit)
   */
  async createVM(config: QEMUConfig): Promise<QEMUVMInstance> {
    if (this.instances.has(config.id)) {
      throw new Error(`QEMU VM with id ${config.id} already exists`);
    }

    // Load QEMU dynamically
    const QEMUClass = await loadQEMU();

    // Create screen canvas
    const canvas = document.createElement("canvas");
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    canvas.style.imageRendering = "auto"; // Better for modern OS

    if (config.screen_container) {
      config.screen_container.appendChild(canvas);
    }

    // Initialize QEMU emulator with x86_64 architecture
    const emulator = new QEMUClass({
      // QEMU configuration for 64-bit systems
      arch: "x86_64",
      memory: config.memory,
      cpu_count: config.cpu_cores,
      display: {
        canvas: canvas,
        width: 1024,
        height: 768,
      },
      drive: config.cdrom_url ? {
        url: config.cdrom_url,
        type: "cdrom",
      } : undefined,
      hda: config.hda_url ? {
        url: config.hda_url,
        size: 20 * 1024 * 1024 * 1024, // 20GB
      } : undefined,
    });

    const instance: QEMUVMInstance = {
      id: config.id,
      emulator,
      config,
      state: "stopped",
      screen: canvas,
    };

    this.instances.set(config.id, instance);
    return instance;
  }

  /**
   * Start a QEMU VM instance
   */
  async startVM(vmId: string): Promise<void> {
    const instance = this.instances.get(vmId);
    if (!instance) {
      throw new Error(`QEMU VM ${vmId} not found`);
    }

    instance.state = "booting";
    await instance.emulator.start();

    // QEMU boot is slower, wait longer
    await new Promise<void>((resolve) => {
      setTimeout(() => {
        instance.state = "running";
        resolve();
      }, 5000);
    });
  }

  /**
   * Stop a QEMU VM instance
   */
  async stopVM(vmId: string): Promise<void> {
    const instance = this.instances.get(vmId);
    if (!instance) {
      throw new Error(`QEMU VM ${vmId} not found`);
    }

    await instance.emulator.stop();
    instance.state = "stopped";
  }

  /**
   * Pause a QEMU VM instance
   */
  async pauseVM(vmId: string): Promise<void> {
    const instance = this.instances.get(vmId);
    if (!instance) {
      throw new Error(`QEMU VM ${vmId} not found`);
    }

    await instance.emulator.pause();
    instance.state = "paused";
  }

  /**
   * Resume a paused QEMU VM
   */
  async resumeVM(vmId: string): Promise<void> {
    const instance = this.instances.get(vmId);
    if (!instance) {
      throw new Error(`QEMU VM ${vmId} not found`);
    }

    await instance.emulator.resume();
    instance.state = "running";
  }

  /**
   * Execute command in QEMU VM (requires guest agent)
   */
  async executeCommand(vmId: string, command: string): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    const instance = this.instances.get(vmId);
    if (!instance) {
      throw new Error(`QEMU VM ${vmId} not found`);
    }

    if (instance.state !== "running") {
      throw new Error(`QEMU VM ${vmId} is not running`);
    }

    // QEMU command execution via QMP (QEMU Machine Protocol)
    // This requires QEMU guest agent to be installed in the VM
    try {
      const result = await instance.emulator.exec(command);
      return {
        stdout: result.stdout || "",
        stderr: result.stderr || "",
        exitCode: result.exitCode || 0,
      };
    } catch (error) {
      return {
        stdout: "",
        stderr: `Command execution failed: ${error instanceof Error ? error.message : String(error)}`,
        exitCode: 1,
      };
    }
  }

  /**
   * Get QEMU VM instance
   */
  getVM(vmId: string): QEMUVMInstance | undefined {
    return this.instances.get(vmId);
  }

  /**
   * Get all QEMU VMs
   */
  getAllVMs(): QEMUVMInstance[] {
    return Array.from(this.instances.values());
  }

  /**
   * Destroy QEMU VM instance
   */
  async destroyVM(vmId: string): Promise<void> {
    const instance = this.instances.get(vmId);
    if (!instance) {
      return;
    }

    await this.stopVM(vmId);
    await instance.emulator.destroy();

    if (instance.screen.parentElement) {
      instance.screen.parentElement.removeChild(instance.screen);
    }

    this.instances.delete(vmId);
  }

  /**
   * Save QEMU VM state
   */
  async saveState(vmId: string): Promise<ArrayBuffer> {
    const instance = this.instances.get(vmId);
    if (!instance) {
      throw new Error(`QEMU VM ${vmId} not found`);
    }

    return await instance.emulator.saveState();
  }

  /**
   * Restore QEMU VM state
   */
  async restoreState(vmId: string, state: ArrayBuffer): Promise<void> {
    const instance = this.instances.get(vmId);
    if (!instance) {
      throw new Error(`QEMU VM ${vmId} not found`);
    }

    await instance.emulator.restoreState(state);
  }

  /**
   * Screenshot QEMU VM screen
   */
  async screenshot(vmId: string): Promise<string> {
    const instance = this.instances.get(vmId);
    if (!instance) {
      throw new Error(`QEMU VM ${vmId} not found`);
    }

    return instance.screen.toDataURL("image/png");
  }
}

// Singleton instance
export const qemuManager = new QEMUManager();
