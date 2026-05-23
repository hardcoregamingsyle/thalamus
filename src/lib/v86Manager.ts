// v86 Virtual Machine Manager
// Manages x86 VM instances for testing code in real OS environments

type V86Starter = any; // v86 emulator instance type

// Lazy load v86 to avoid bundling issues
let V86: any = null;

async function loadV86() {
  if (!V86) {
    // @ts-ignore - dynamic import
    const v86Module: any = await import("v86");
    V86 = v86Module.default || v86Module.V86 || v86Module;
  }
  return V86;
}

export interface VMConfig {
  id: string;
  name: string;
  os: "linux" | "windows" | "macos" | "freedos";
  memory: number; // MB
  vga_memory: number; // MB
  screen_container: HTMLElement | null;
  bios_url: string;
  vga_bios_url: string;
  cdrom_url?: string; // OS installer ISO
  hda_url?: string; // Hard disk image
  filesystem?: {
    baseurl: string;
    basefs: string;
  };
}

export interface VMInstance {
  id: string;
  emulator: V86Starter;
  config: VMConfig;
  state: "booting" | "running" | "stopped" | "paused";
  screen: HTMLCanvasElement;
}

// Pre-configured OS templates
export const OS_TEMPLATES: Record<string, Partial<VMConfig>> = {
  "linux-alpine": {
    name: "Alpine Linux 3.19",
    os: "linux",
    memory: 512,
    vga_memory: 8,
    cdrom_url: "https://dl-cdn.alpinelinux.org/alpine/v3.19/releases/x86/alpine-standard-3.19.0-x86.iso",
  },
  "linux-debian": {
    name: "Debian 12 (32-bit)",
    os: "linux",
    memory: 1024,
    vga_memory: 16,
    cdrom_url: "https://cdimage.debian.org/debian-cd/current/i386/iso-cd/debian-12.4.0-i386-netinst.iso",
  },
  "windows-98": {
    name: "Windows 98 SE",
    os: "windows",
    memory: 256,
    vga_memory: 8,
    cdrom_url: "https://archive.org/download/win98se_201910/Win98SE.iso",
  },
  "windows-xp": {
    name: "Windows XP (32-bit)",
    os: "windows",
    memory: 512,
    vga_memory: 16,
    cdrom_url: "https://archive.org/download/WinXPProSP3x86/en_windows_xp_professional_with_service_pack_3_x86_cd_x14-80428.iso",
  },
  "macos-rhapsody": {
    name: "Rhapsody DR2 (Mac OS X Beta)",
    os: "windows", // v86 treats it as generic x86
    memory: 256,
    vga_memory: 8,
    cdrom_url: "https://winworldpc.com/download/3dc38dc3-93c2-bbe2-80c3-a411c3a4c2ae",
  },
  "freedos": {
    name: "FreeDOS 1.3",
    os: "freedos",
    memory: 64,
    vga_memory: 2,
    cdrom_url: "https://www.ibiblio.org/pub/micro/pc-stuff/freedos/files/distributions/1.3/official/FD13-LiveCD.zip",
  },
};

class V86Manager {
  private instances: Map<string, VMInstance> = new Map();
  private biosCache: Map<string, ArrayBuffer> = new Map();

  /**
   * Create a new VM instance
   */
  async createVM(config: VMConfig): Promise<VMInstance> {
    if (this.instances.has(config.id)) {
      throw new Error(`VM with id ${config.id} already exists`);
    }

    // Load v86 dynamically
    const V86Class = await loadV86();

    // Create screen canvas
    const canvas = document.createElement("canvas");
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    canvas.style.imageRendering = "pixelated";

    if (config.screen_container) {
      config.screen_container.appendChild(canvas);
    }

    // Initialize v86 emulator
    const emulator = new V86Class({
      memory_size: config.memory * 1024 * 1024,
      vga_memory_size: config.vga_memory * 1024 * 1024,
      screen_container: config.screen_container,
      bios: {
        url: config.bios_url || "https://copy.sh/v86/bios/seabios.bin",
      },
      vga_bios: {
        url: config.vga_bios_url || "https://copy.sh/v86/bios/vgabios.bin",
      },
      cdrom: config.cdrom_url ? {
        url: config.cdrom_url,
      } : undefined,
      hda: config.hda_url ? {
        url: config.hda_url,
        async: true,
      } : undefined,
      autostart: false,
      disable_keyboard: false,
      disable_mouse: false,
      filesystem: config.filesystem,
    });

    const instance: VMInstance = {
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
   * Start a VM instance
   */
  async startVM(vmId: string): Promise<void> {
    const instance = this.instances.get(vmId);
    if (!instance) {
      throw new Error(`VM ${vmId} not found`);
    }

    instance.state = "booting";
    instance.emulator.run();

    // Wait for boot
    await new Promise<void>((resolve) => {
      setTimeout(() => {
        instance.state = "running";
        resolve();
      }, 2000);
    });
  }

  /**
   * Stop a VM instance
   */
  async stopVM(vmId: string): Promise<void> {
    const instance = this.instances.get(vmId);
    if (!instance) {
      throw new Error(`VM ${vmId} not found`);
    }

    instance.emulator.stop();
    instance.state = "stopped";
  }

  /**
   * Pause a VM instance
   */
  async pauseVM(vmId: string): Promise<void> {
    const instance = this.instances.get(vmId);
    if (!instance) {
      throw new Error(`VM ${vmId} not found`);
    }

    instance.emulator.stop();
    instance.state = "paused";
  }

  /**
   * Resume a paused VM
   */
  async resumeVM(vmId: string): Promise<void> {
    const instance = this.instances.get(vmId);
    if (!instance) {
      throw new Error(`VM ${vmId} not found`);
    }

    instance.emulator.run();
    instance.state = "running";
  }

  /**
   * Execute command in VM (requires guest agent or serial console)
   */
  async executeCommand(vmId: string, command: string): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    const instance = this.instances.get(vmId);
    if (!instance) {
      throw new Error(`VM ${vmId} not found`);
    }

    if (instance.state !== "running") {
      throw new Error(`VM ${vmId} is not running`);
    }

    // Send command via serial console
    return new Promise((resolve) => {
      let output = "";

      // Listen for serial output
      instance.emulator.add_listener("serial0-output-char", (char: number) => {
        output += String.fromCharCode(char);
      });

      // Send command
      const commandBytes = `${command}\n`;
      for (let i = 0; i < commandBytes.length; i++) {
        instance.emulator.serial0_send(commandBytes.charCodeAt(i));
      }

      // Wait for output (timeout after 30s)
      setTimeout(() => {
        resolve({
          stdout: output,
          stderr: "",
          exitCode: 0,
        });
      }, 30000);
    });
  }

  /**
   * Sync project files to VM filesystem
   */
  async syncFilesToVM(vmId: string, files: Array<{ path: string; content: string }>): Promise<void> {
    const instance = this.instances.get(vmId);
    if (!instance) {
      throw new Error(`VM ${vmId} not found`);
    }

    // Write files via 9p filesystem or serial console
    for (const file of files) {
      // For now, we'll use command execution to write files
      const escapedContent = file.content.replace(/'/g, "'\\''");
      await this.executeCommand(vmId, `cat > '${file.path}' << 'EOF'\n${escapedContent}\nEOF`);
    }
  }

  /**
   * Get VM instance
   */
  getVM(vmId: string): VMInstance | undefined {
    return this.instances.get(vmId);
  }

  /**
   * Get all VMs
   */
  getAllVMs(): VMInstance[] {
    return Array.from(this.instances.values());
  }

  /**
   * Destroy VM instance
   */
  async destroyVM(vmId: string): Promise<void> {
    const instance = this.instances.get(vmId);
    if (!instance) {
      return;
    }

    await this.stopVM(vmId);
    instance.emulator.destroy();

    if (instance.screen.parentElement) {
      instance.screen.parentElement.removeChild(instance.screen);
    }

    this.instances.delete(vmId);
  }

  /**
   * Save VM state
   */
  async saveState(vmId: string): Promise<ArrayBuffer> {
    const instance = this.instances.get(vmId);
    if (!instance) {
      throw new Error(`VM ${vmId} not found`);
    }

    return new Promise((resolve) => {
      instance.emulator.save_state((error: any, state: ArrayBuffer) => {
        if (error) {
          throw new Error(`Failed to save state: ${error}`);
        }
        resolve(state);
      });
    });
  }

  /**
   * Restore VM state
   */
  async restoreState(vmId: string, state: ArrayBuffer): Promise<void> {
    const instance = this.instances.get(vmId);
    if (!instance) {
      throw new Error(`VM ${vmId} not found`);
    }

    return new Promise((resolve, reject) => {
      instance.emulator.restore_state(state);
      resolve();
    });
  }

  /**
   * Screenshot VM screen
   */
  async screenshot(vmId: string): Promise<string> {
    const instance = this.instances.get(vmId);
    if (!instance) {
      throw new Error(`VM ${vmId} not found`);
    }

    return instance.screen.toDataURL("image/png");
  }
}

// Singleton instance
export const vmManager = new V86Manager();
