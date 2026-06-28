#!/usr/bin/env node

/**
 * Thalamus VM Launcher
 * Single executable that handles everything:
 * - Checks for QEMU installation
 * - Auto-installs if missing (on supported platforms)
 * - Starts WebSocket bridge
 * - Manages VM processes
 */

import { WebSocketServer } from "ws";
import { spawn, ChildProcess } from "child_process";
import * as os from "os";
import * as path from "path";
import * as fs from "fs";
import * as https from "https";
import { execSync } from "child_process";

const VERSION = "1.0.0";
const PORT = 5900;
const DATA_DIR = path.join(os.homedir(), ".thalamus-vms");

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

interface VMInstance {
  id: string;
  process: ChildProcess;
  os: string;
  vncPort: number;
}

const activeVMs = new Map<string, VMInstance>();
let nextVncPort = 5901;

// Check if QEMU is installed
function checkQEMUInstalled(): boolean {
  try {
    if (process.platform === "win32") {
      execSync("where qemu-system-x86_64", { stdio: "ignore" });
    } else {
      execSync("which qemu-system-x86_64", { stdio: "ignore" });
    }
    return true;
  } catch {
    return false;
  }
}

// Auto-install QEMU (if possible)
async function autoInstallQEMU(): Promise<boolean> {
  console.log("⚙️  QEMU not found. Attempting auto-install...");

  try {
    if (process.platform === "darwin") {
      console.log("📦 Installing via Homebrew...");
      execSync("brew install qemu", { stdio: "inherit" });
      return true;
    } else if (process.platform === "linux") {
      console.log("📦 Installing via apt...");
      execSync("sudo apt update && sudo apt install -y qemu-system-x86 qemu-utils", {
        stdio: "inherit",
      });
      return true;
    } else if (process.platform === "win32") {
      console.log("📦 Downloading QEMU installer...");
      console.log("⚠️  Please install QEMU manually from: https://qemu.weilnetz.de/w64/");
      return false;
    }
  } catch (err) {
    console.error("❌ Auto-install failed:", err);
    return false;
  }

  return false;
}

// Get QEMU binary path
function getQEMUBinary(): string {
  if (process.platform === "win32") {
    return "qemu-system-x86_64.exe";
  }
  return "qemu-system-x86_64";
}

// Get or create disk image for OS
function getDiskPath(osId: string): string {
  const diskPath = path.join(DATA_DIR, `${osId}-disk.qcow2`);

  if (!fs.existsSync(diskPath)) {
    console.log(`💾 Creating disk image for ${osId}...`);
    const qemuImg = process.platform === "win32" ? "qemu-img.exe" : "qemu-img";
    execSync(`${qemuImg} create -f qcow2 "${diskPath}" 60G`);
  }

  return diskPath;
}

// Boot VM
function bootVM(osId: string, ram: number, cores: number): VMInstance {
  const vmId = `${osId}-${Date.now()}`;
  const vncPort = nextVncPort++;
  const diskPath = getDiskPath(osId);
  const qemuBinary = getQEMUBinary();

  const args = [
    "-m",
    ram.toString(),
    "-smp",
    cores.toString(),
    "-hda",
    diskPath,
    "-vnc",
    `:${vncPort - 5900}`,
    "-enable-kvm", // Hardware acceleration (Linux/macOS)
  ];

  // Windows-specific: remove -enable-kvm (not supported)
  if (process.platform === "win32") {
    const kvmIndex = args.indexOf("-enable-kvm");
    if (kvmIndex !== -1) args.splice(kvmIndex, 1);
  }

  console.log(`🚀 Booting ${osId}...`);
  console.log(`   RAM: ${ram}MB, Cores: ${cores}`);
  console.log(`   VNC: localhost:${vncPort}`);

  const vmProcess = spawn(qemuBinary, args);

  vmProcess.stdout?.on("data", (data) => {
    console.log(`[VM ${vmId}] ${data.toString().trim()}`);
  });

  vmProcess.stderr?.on("data", (data) => {
    console.error(`[VM ${vmId}] ${data.toString().trim()}`);
  });

  vmProcess.on("close", (code) => {
    console.log(`🛑 VM ${vmId} stopped (exit code: ${code})`);
    activeVMs.delete(vmId);
  });

  const instance: VMInstance = {
    id: vmId,
    process: vmProcess,
    os: osId,
    vncPort,
  };

  activeVMs.set(vmId, instance);

  return instance;
}

// Start WebSocket server
function startBridge() {
  const wss = new WebSocketServer({ port: PORT });

  console.log(`✅ Thalamus VM Bridge v${VERSION}`);
  console.log(`🌐 WebSocket server: ws://localhost:${PORT}`);
  console.log(`📂 VM data directory: ${DATA_DIR}`);
  console.log(`🖥️  Platform: ${process.platform}`);
  console.log("");
  console.log("Waiting for connections from web browser...");

  wss.on("connection", (ws) => {
    console.log("🔗 Browser connected");

    ws.on("message", (data) => {
      try {
        const message = JSON.parse(data.toString());

        if (message.action === "boot") {
          const { os, ram = 4096, cores = 4 } = message;

          const vm = bootVM(os, ram, cores);

          ws.send(
            JSON.stringify({
              status: "success",
              vmId: vm.id,
              vncPort: vm.vncPort,
              message: `VM booted! Connect VNC to localhost:${vm.vncPort}`,
            })
          );
        } else if (message.action === "stop") {
          const { vmId } = message;
          const vm = activeVMs.get(vmId);

          if (vm) {
            vm.process.kill();
            ws.send(
              JSON.stringify({
                status: "success",
                message: "VM stopped",
              })
            );
          } else {
            ws.send(
              JSON.stringify({
                status: "error",
                message: "VM not found",
              })
            );
          }
        } else if (message.action === "list") {
          const vms = Array.from(activeVMs.values()).map((vm) => ({
            id: vm.id,
            os: vm.os,
            vncPort: vm.vncPort,
          }));

          ws.send(
            JSON.stringify({
              status: "success",
              vms,
            })
          );
        } else if (message.action === "ping") {
          ws.send(
            JSON.stringify({
              status: "success",
              version: VERSION,
              platform: process.platform,
              activeVMs: activeVMs.size,
            })
          );
        }
      } catch (err) {
        console.error("❌ Error handling message:", err);
        ws.send(
          JSON.stringify({
            status: "error",
            message: err instanceof Error ? err.message : "Unknown error",
          })
        );
      }
    });

    ws.on("close", () => {
      console.log("🔌 Browser disconnected");
    });
  });

  wss.on("error", (err) => {
    console.error("❌ WebSocket server error:", err);
  });
}

// Check for updates
async function checkForUpdates() {
  try {
    const response = await fetch("https://thalamus.dev/api/vm-version");
    const data = (await response.json()) as { version: string; downloadUrl: string };

    if (data.version > VERSION) {
      console.log("");
      console.log("🆕 Update available!");
      console.log(`   Current: v${VERSION}`);
      console.log(`   Latest: v${data.version}`);
      console.log(`   Download: ${data.downloadUrl}`);
      console.log("");
    }
  } catch {
    // Silent fail - updates are optional
  }
}

// Main entry point
async function main() {
  console.clear();
  console.log("╔══════════════════════════════════════╗");
  console.log("║   Thalamus Virtualization Engine    ║");
  console.log("║            Version 1.0.0             ║");
  console.log("╚══════════════════════════════════════╝");
  console.log("");

  // Check for updates (async, non-blocking)
  checkForUpdates();

  // Check QEMU installation
  if (!checkQEMUInstalled()) {
    console.log("⚠️  Virtualization runtime not found");
    console.log("");

    const installed = await autoInstallQEMU();

    if (!installed) {
      console.log("❌ Could not install automatically");
      console.log("📖 Please install manually:");
      console.log("");
      console.log("   macOS:   brew install qemu");
      console.log("   Linux:   sudo apt install qemu-system-x86 qemu-utils");
      console.log("   Windows: https://qemu.weilnetz.de/w64/");
      console.log("");
      process.exit(1);
    }
  }

  console.log("✅ Virtualization runtime ready");
  console.log("");

  // Start bridge
  startBridge();

  // Keep process alive
  process.on("SIGINT", () => {
    console.log("");
    console.log("🛑 Shutting down...");

    // Stop all VMs
    for (const vm of activeVMs.values()) {
      vm.process.kill();
    }

    process.exit(0);
  });
}

// Run
main().catch((err) => {
  console.error("💥 Fatal error:", err);
  process.exit(1);
});
