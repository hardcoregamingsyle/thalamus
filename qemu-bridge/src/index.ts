#!/usr/bin/env node

import { WebSocketServer, WebSocket } from 'ws';
import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import express from 'express';

const PORT = process.env.PORT ? parseInt(process.env.PORT) : 5900;
const VNC_BASE_PORT = 5901;
const DATA_DIR = path.join(os.homedir(), '.thalamus-qemu');

// OS configurations
const OS_IMAGES: Record<string, {
  name: string;
  downloadUrl: string;
  diskSize: string;
  ram: number;
  arch: string;
}> = {
  'windows-11': {
    name: 'Windows 11 Pro',
    downloadUrl: 'https://software-download.microsoft.com/download/Windows_InsiderPreview_Client_x64_en-us.iso',
    diskSize: '60G',
    ram: 6144,
    arch: 'x86_64',
  },
  'windows-10': {
    name: 'Windows 10 Pro',
    downloadUrl: 'https://software-download.microsoft.com/download/Windows_10_22H2.iso',
    diskSize: '50G',
    ram: 6144,
    arch: 'x86_64',
  },
  'ubuntu-24': {
    name: 'Ubuntu 24.04 LTS',
    downloadUrl: 'https://releases.ubuntu.com/24.04/ubuntu-24.04-desktop-amd64.iso',
    diskSize: '40G',
    ram: 4096,
    arch: 'x86_64',
  },
  'macos-sequoia': {
    name: 'macOS Sequoia',
    downloadUrl: 'https://archive.org/download/macos-sequoia-iso/macOS-Sequoia.iso',
    diskSize: '60G',
    ram: 6144,
    arch: 'x86_64',
  },
  'android-14': {
    name: 'Android 14 x86_64',
    downloadUrl: 'https://www.android-x86.org/download/android-x86_64-14.0.iso',
    diskSize: '30G',
    ram: 4096,
    arch: 'x86_64',
  },
};

interface VMInstance {
  id: string;
  os: string;
  process: ChildProcess;
  vncPort: number;
  status: 'booting' | 'running' | 'stopped';
}

interface BootMessage {
  action: 'boot';
  os: string;
  ram?: number;
  cores?: number;
}

interface StopMessage {
  action: 'stop';
  vmId: string;
}

interface CommandMessage {
  action: 'command';
  vmId: string;
  command: string;
}

type BridgeMessage = BootMessage | StopMessage | CommandMessage;

const activeVMs: Map<string, VMInstance> = new Map();

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

console.log(`Thalamus QEMU Bridge v1.0.0`);
console.log(`Data directory: ${DATA_DIR}`);
console.log(`WebSocket server starting on port ${PORT}...`);

// Create WebSocket server
const wss = new WebSocketServer({ port: PORT });

// Create HTTP server for noVNC
const app = express();
const HTTP_PORT = 6080;

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    activeVMs: activeVMs.size,
    port: PORT
  });
});

app.listen(HTTP_PORT, () => {
  console.log(`HTTP health check server on port ${HTTP_PORT}`);
});

wss.on('connection', (ws) => {
  console.log('Browser connected');

  ws.on('message', async (data) => {
    try {
      const message = JSON.parse(data.toString()) as BridgeMessage;

      if (message.action === 'boot') {
        await handleBootVM(ws, message);
      } else if (message.action === 'stop') {
        await handleStopVM(ws, message);
      } else if (message.action === 'command') {
        await handleCommand(ws, message);
      }
    } catch (err) {
      ws.send(JSON.stringify({
        error: err instanceof Error ? err.message : 'Unknown error'
      }));
    }
  });

  ws.on('close', () => {
    console.log('Browser disconnected');
  });
});

async function handleBootVM(ws: WebSocket, message: BootMessage) {
  const { os, ram, cores } = message;

  if (!OS_IMAGES[os]) {
    ws.send(JSON.stringify({ error: `Unknown OS: ${os}` }));
    return;
  }

  const osConfig = OS_IMAGES[os];
  const vmId = `vm-${Date.now()}`;
  const vncPort = VNC_BASE_PORT + activeVMs.size;

  console.log(`Booting ${osConfig.name}...`);
  ws.send(JSON.stringify({ status: 'checking-image' }));

  // Check if disk image exists
  const diskPath = path.join(DATA_DIR, `${os}-disk.qcow2`);
  const isoPath = path.join(DATA_DIR, `${os}.iso`);

  if (!fs.existsSync(diskPath)) {
    // Create disk
    console.log(`Creating virtual disk: ${diskPath}`);
    ws.send(JSON.stringify({ status: 'creating-disk' }));

    await runCommand('qemu-img', [
      'create', '-f', 'qcow2', diskPath, osConfig.diskSize
    ]);
  }

  // Check QEMU availability
  const qemuBinary = `qemu-system-${osConfig.arch}`;
  try {
    await runCommand(qemuBinary, ['--version']);
  } catch {
    ws.send(JSON.stringify({
      error: `QEMU not found. Please install: ${getInstallCommand()}`
    }));
    return;
  }

  ws.send(JSON.stringify({ status: 'booting' }));

  // Launch QEMU
  const qemuArgs = [
    '-m', (ram || osConfig.ram).toString(),
    '-smp', cores?.toString() || '4',
    '-hda', diskPath,
    '-vnc', `:${vncPort - 5900}`,
    '-enable-kvm', // Use KVM if available (Linux)
  ];

  // Add ISO if exists
  if (fs.existsSync(isoPath)) {
    qemuArgs.push('-cdrom', isoPath);
  }

  const qemuProcess = spawn(qemuBinary, qemuArgs, {
    stdio: 'pipe',
  });

  qemuProcess.stdout?.on('data', (data) => {
    console.log(`QEMU stdout: ${data}`);
  });

  qemuProcess.stderr?.on('data', (data) => {
    console.log(`QEMU stderr: ${data}`);
  });

  qemuProcess.on('exit', (code) => {
    console.log(`QEMU exited with code ${code}`);
    activeVMs.delete(vmId);
    ws.send(JSON.stringify({ status: 'stopped' }));
  });

  qemuProcess.on('error', (err) => {
    console.error('QEMU error:', err);
    ws.send(JSON.stringify({ error: err.message }));
  });

  const vm: VMInstance = {
    id: vmId,
    os,
    process: qemuProcess,
    vncPort,
    status: 'booting',
  };

  activeVMs.set(vmId, vm);

  // Wait a bit then mark as running
  setTimeout(() => {
    vm.status = 'running';
    ws.send(JSON.stringify({
      status: 'ready',
      vmId,
      vncPort,
      vncUrl: `vnc://localhost:${vncPort}`,
      note: `Connect VNC client to localhost:${vncPort}`,
    }));
    console.log(`VM ${vmId} ready on VNC port ${vncPort}`);
  }, 5000);
}

async function handleStopVM(ws: WebSocket, message: StopMessage) {
  const { vmId } = message;
  const vm = activeVMs.get(vmId);

  if (!vm) {
    ws.send(JSON.stringify({ error: 'VM not found' }));
    return;
  }

  vm.process.kill('SIGTERM');
  activeVMs.delete(vmId);

  ws.send(JSON.stringify({ status: 'stopped' }));
  console.log(`VM ${vmId} stopped`);
}

async function handleCommand(ws: WebSocket, message: CommandMessage) {
  const { vmId } = message;
  const vm = activeVMs.get(vmId);

  if (!vm) {
    ws.send(JSON.stringify({ error: 'VM not found' }));
    return;
  }

  // Send command via QEMU monitor (would need to implement)
  ws.send(JSON.stringify({
    output: 'Command forwarding not yet implemented. Use VNC display.'
  }));
}

function runCommand(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args);
    proc.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} exited with code ${code}`));
    });
    proc.on('error', reject);
  });
}

function getInstallCommand(): string {
  const platform = os.platform();
  if (platform === 'darwin') return 'brew install qemu';
  if (platform === 'linux') return 'sudo apt install qemu-system-x86';
  if (platform === 'win32') return 'choco install qemu or download from https://qemu.weilnetz.de/w64/';
  return 'Install QEMU for your platform';
}

console.log(`✓ Bridge ready on ws://localhost:${PORT}`);
console.log(`✓ Connect from browser to start VMs`);
console.log(`✓ VMs will be accessible via VNC on ports ${VNC_BASE_PORT}+`);
