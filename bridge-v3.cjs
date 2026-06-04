/**
 * Thalamus VM Bridge v3.3.0
 * WebSocket bridge for VM management via QEMU
 * ISO filenames match installer-v6.6.0 key-based naming
 */
"use strict";
const WebSocket = require("ws");
const { spawn, exec } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");
const http = require("http");

const WS_PORT = 5900;
// Use LOCALAPPDATA env var (works even when AppData folder is hidden)
const APP_DIR = process.env.LOCALAPPDATA
  ? path.join(process.env.LOCALAPPDATA, "Thalamus")
  : path.join(os.homedir(), "AppData", "Local", "Thalamus");
const ISOS_DIR = path.join(APP_DIR, "isos");
const BRIDGE_LOG = path.join(APP_DIR, "bridge.log");
const VERSION = "3.3.0";

// OS key → ISO filename mapping (matches installer-v6.6.0)
const ISO_MAP = {
  "windows-11":  "windows-11.iso",
  "windows-10":  "windows-10.iso",
  "macos-26":    "macos-26.iso",
  "macos-18":    "macos-18.iso",
  "macos-17":    "macos-17.iso",
  "macos-16":    "macos-16.iso",
  "android-14":  "android-14.iso",
  "android-13":  "android-13.iso",
  // iOS removed — IPSW format cannot be emulated with QEMU
  "ubuntu-24":   "ubuntu-24.iso",
  "ubuntu-22":   "ubuntu-22.iso",
  "debian-12":   "debian-12.iso",
  "kali-2024":   "kali-2024.iso",
  "fedora-40":   "fedora-40.iso",
};

// QEMU binary paths
const QEMU_PATHS = [
  "C:\\Program Files\\qemu\\qemu-system-x86_64.exe",
  "C:\\Program Files (x86)\\qemu\\qemu-system-x86_64.exe",
];

function findQemu() {
  for (var p of QEMU_PATHS) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function log(msg) {
  var line = new Date().toISOString() + " " + msg + "\n";
  process.stdout.write(line);
  try { fs.appendFileSync(BRIDGE_LOG, line); } catch(e) {}
}

// Active VMs: vmId → { process, vncPort, os }
var activeVMs = {};
var nextVncPort = 5901;

function getNextVncPort() {
  var port = nextVncPort++;
  if (nextVncPort > 5999) nextVncPort = 5901;
  return port;
}

function bootVM(osKey, ram, cores, callback) {
  var qemu = findQemu();
  if (!qemu) {
    callback({ status: "error", message: "QEMU not found. Please run the installer first." });
    return;
  }

  var isoFilename = ISO_MAP[osKey];
  var isoPath = isoFilename ? path.join(ISOS_DIR, isoFilename) : null;
  var hasIso = isoPath && fs.existsSync(isoPath);
  var isoNeeded = !hasIso ? (isoPath || path.join(ISOS_DIR, osKey + ".iso")) : null;

  // Create per-OS QCOW2 disk image
  var diskPath = path.join(APP_DIR, "disks", osKey + ".qcow2");
  var diskDir = path.dirname(diskPath);
  if (!fs.existsSync(diskDir)) fs.mkdirSync(diskDir, { recursive: true });

  var vncPort = getNextVncPort();
  var vncDisplay = vncPort - 5900; // VNC display number

  function startVM() {
    var args = [
      "-m", String(ram),
      "-smp", String(cores),
      "-drive", "file=" + diskPath + ",format=qcow2,if=virtio",
      "-vnc", ":" + vncDisplay,
      "-enable-kvm",
      "-cpu", "host",
      "-machine", "type=q35,accel=whpx,kernel-irqchip=off",
      "-net", "nic,model=virtio",
      "-net", "user",
      "-rtc", "base=localtime",
      "-usb",
      "-device", "usb-tablet",
    ];

    if (hasIso) {
      args.push("-cdrom", isoPath);
      args.push("-boot", "d");
    } else {
      args.push("-boot", "c");
    }

    log("Booting " + osKey + " on VNC :" + vncDisplay + " (port " + vncPort + ")");
    log("ISO: " + (hasIso ? isoPath : "none (BIOS only)"));

    var proc;
    try {
      proc = spawn(qemu, args, {
        detached: false,
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      });
    } catch(e) {
      // Try without KVM/WHPX
      var args2 = args.filter(function(a) {
        return a !== "-enable-kvm" && a !== "type=q35,accel=whpx,kernel-irqchip=off";
      });
      // Replace machine type
      var machIdx = args2.indexOf("-machine");
      if (machIdx >= 0) args2[machIdx + 1] = "type=q35";
      try {
        proc = spawn(qemu, args2, {
          detached: false,
          stdio: ["ignore", "pipe", "pipe"],
          windowsHide: true,
        });
      } catch(e2) {
        callback({ status: "error", message: "Failed to start QEMU: " + e2.message });
        return;
      }
    }

    var vmId = osKey + "-" + Date.now();
    activeVMs[vmId] = { process: proc, vncPort: vncPort, os: osKey };

    proc.stdout && proc.stdout.on("data", function(d) { log("[" + vmId + "] " + d.toString().trim()); });
    proc.stderr && proc.stderr.on("data", function(d) { log("[" + vmId + "] ERR: " + d.toString().trim()); });
    proc.on("exit", function(code) {
      log("[" + vmId + "] exited with code " + code);
      delete activeVMs[vmId];
    });

    callback({
      status: "success",
      vmId: vmId,
      vncPort: vncPort,
      isoNeeded: isoNeeded,
      hasIso: hasIso,
    });
  }

  // Create disk if needed
  if (!fs.existsSync(diskPath)) {
    log("Creating QCOW2 disk for " + osKey + "...");
    var qemuImg = qemu.replace("qemu-system-x86_64.exe", "qemu-img.exe");
    exec('"' + qemuImg + '" create -f qcow2 -o preallocation=off "' + diskPath + '" 60G', { windowsHide: true }, function(err) {
      if (err) {
        log("qemu-img failed: " + err.message + " — trying without qemu-img");
      } else {
        var stat = fs.statSync(diskPath);
        log("Disk created: " + Math.round(stat.size / 1024) + "KB actual / 60GB virtual");
      }
      startVM();
    });
  } else {
    startVM();
  }
}

function stopVM(vmId, callback) {
  var vm = activeVMs[vmId];
  if (!vm) {
    callback({ status: "error", message: "VM not found: " + vmId });
    return;
  }
  try {
    vm.process.kill();
    delete activeVMs[vmId];
    callback({ status: "success" });
  } catch(e) {
    callback({ status: "error", message: e.message });
  }
}

// ── WebSocket server ──────────────────────────────────────────────────────────
var wss = new WebSocket.Server({ port: WS_PORT });

log("Thalamus VM Bridge v" + VERSION + " starting on ws://localhost:" + WS_PORT);
log("App dir: " + APP_DIR);
log("ISOs dir: " + ISOS_DIR);
log("QEMU: " + (findQemu() || "NOT FOUND"));

wss.on("connection", function(ws) {
  log("Client connected");

  ws.on("message", function(data) {
    var msg;
    try { msg = JSON.parse(data); } catch(e) { return; }

    if (msg.action === "ping") {
      ws.send(JSON.stringify({
        version: VERSION,
        platform: "windows",
        activeVMs: Object.keys(activeVMs).length,
        qemu: !!findQemu(),
      }));
    } else if (msg.action === "boot") {
      var osKey = msg.os || "ubuntu-24";
      var ram = Math.max(512, Math.min(32768, parseInt(msg.ram) || 4096));
      var cores = Math.max(1, Math.min(16, parseInt(msg.cores) || 2));
      bootVM(osKey, ram, cores, function(result) {
        ws.send(JSON.stringify(result));
      });
    } else if (msg.action === "stop") {
      stopVM(msg.vmId, function(result) {
        ws.send(JSON.stringify(result));
      });
    } else if (msg.action === "list") {
      var vms = Object.keys(activeVMs).map(function(id) {
        return { vmId: id, vncPort: activeVMs[id].vncPort, os: activeVMs[id].os };
      });
      ws.send(JSON.stringify({ status: "success", vms: vms }));
    } else if (msg.action === "disk_info") {
      var diskDir = path.join(APP_DIR, "disks");
      var info = [];
      if (fs.existsSync(diskDir)) {
        fs.readdirSync(diskDir).forEach(function(f) {
          if (f.endsWith(".qcow2")) {
            var fp = path.join(diskDir, f);
            var stat = fs.statSync(fp);
            info.push({ file: f, actualBytes: stat.size });
          }
        });
      }
      ws.send(JSON.stringify({ status: "success", disks: info }));
    }
  });

  ws.on("close", function() { log("Client disconnected"); });
  ws.on("error", function(e) { log("WS error: " + e.message); });
});

wss.on("error", function(e) {
  log("Server error: " + e.message);
  if (e.code === "EADDRINUSE") {
    log("Port " + WS_PORT + " already in use — another bridge instance may be running");
    process.exit(1);
  }
});

// Handle thalamus:// URI scheme args
var args = process.argv.slice(2);
if (args.length > 0 && args[0].startsWith("thalamus://")) {
  var uri = args[0];
  log("URI scheme launch: " + uri);
  // Parse: thalamus://boot?os=windows-11&ram=6144&cores=4
  var match = uri.match(/thalamus:\/\/boot\?(.+)/);
  if (match) {
    var params = {};
    match[1].split("&").forEach(function(p) {
      var kv = p.split("=");
      params[kv[0]] = decodeURIComponent(kv[1] || "");
    });
    // Wait for WS server to start, then auto-boot
    setTimeout(function() {
      bootVM(params.os || "ubuntu-24", parseInt(params.ram) || 4096, parseInt(params.cores) || 2, function(result) {
        log("Auto-boot result: " + JSON.stringify(result));
      });
    }, 1000);
  }
  // thalamus://start — just start the bridge (no VM boot)
  if (uri.startsWith("thalamus://start")) {
    log("Bridge started via thalamus://start URI");
  }
}

process.on("SIGINT", function() { log("Shutting down..."); process.exit(0); });
process.on("SIGTERM", function() { log("Shutting down..."); process.exit(0); });
