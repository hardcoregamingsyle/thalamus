/**
 * Thalamus Installer v5.0.0
 * Redesigned UI matching Thalamus website aesthetic
 * - Full dark theme matching website colors
 * - Scrollable OS grid with categories
 * - macOS and Windows bundled like Linux/Android
 * - No console window
 * - Better bridge install with timeout handling
 */

const http = require("http");
const { exec, spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");
const https = require("https");

const PORT = 7891;
const APP_DIR = path.join(os.homedir(), "AppData", "Local", "Thalamus");
const ISOS_DIR = path.join(APP_DIR, "isos");
const BRIDGE_EXE = path.join(APP_DIR, "thalamus-vm-bridge.exe");
const BRIDGE_LAUNCHER = path.join(APP_DIR, "launch-bridge-hidden.vbs");
const BRIDGE_LOG = path.join(APP_DIR, "bridge.log");
const BRIDGE_URL = "https://github.com/hardcoregamingsyle/thalamus/releases/download/vm-bridge-v2.1.0/thalamus-vm-bridge.exe";

var progress = {
  step: "idle",
  message: "Ready to install",
  percent: 0,
  log: [],
  done: false,
  error: null,
};

function addLog(msg) {
  progress.log.push(msg);
  if (progress.log.length > 300) progress.log.shift();
}

// All OS options — all auto-downloadable
const ISO_OPTIONS = [
  // Windows
  { key: "windows-11", name: "Windows 11", version: "23H2", size: "5.8 GB", category: "windows", url: "https://software-download.microsoft.com/download/Windows_InsiderPreview_Client_x64_en-us.iso", filename: "windows-11.iso", note: "Microsoft evaluation ISO" },
  { key: "windows-10", name: "Windows 10", version: "22H2", size: "5.2 GB", category: "windows", url: "https://software-download.microsoft.com/download/Windows_10_22H2.iso", filename: "windows-10.iso", note: "Microsoft evaluation ISO" },
  // macOS
  { key: "macos-sequoia", name: "macOS 15 Sequoia", version: "15.0", size: "14 GB", category: "macos", url: "https://archive.org/download/macos-sequoia-iso/macOS-Sequoia.iso", filename: "macos-sequoia.iso", note: "Community archive ISO" },
  { key: "macos-sonoma", name: "macOS 14 Sonoma", version: "14.0", size: "13 GB", category: "macos", url: "https://archive.org/download/macos-sonoma-iso/macOS-Sonoma.iso", filename: "macos-sonoma.iso", note: "Community archive ISO" },
  { key: "macos-ventura", name: "macOS 13 Ventura", version: "13.0", size: "12 GB", category: "macos", url: "https://archive.org/download/macos-ventura-iso/macOS-Ventura.iso", filename: "macos-ventura.iso", note: "Community archive ISO" },
  // Linux
  { key: "ubuntu-24", name: "Ubuntu 24.04 LTS", version: "24.04", size: "5.7 GB", category: "linux", url: "https://releases.ubuntu.com/24.04/ubuntu-24.04.2-desktop-amd64.iso", filename: "ubuntu-24.04.2-desktop-amd64.iso", note: "" },
  { key: "ubuntu-22", name: "Ubuntu 22.04 LTS", version: "22.04", size: "4.7 GB", category: "linux", url: "https://releases.ubuntu.com/22.04/ubuntu-22.04.5-desktop-amd64.iso", filename: "ubuntu-22.04.5-desktop-amd64.iso", note: "" },
  { key: "debian-12", name: "Debian 12 Bookworm", version: "12.0", size: "3.7 GB", category: "linux", url: "https://cdimage.debian.org/debian-cd/current/amd64/iso-dvd/debian-12.9.0-amd64-DVD-1.iso", filename: "debian-12.9.0-amd64-DVD-1.iso", note: "" },
  { key: "fedora-41", name: "Fedora 41", version: "41", size: "2.1 GB", category: "linux", url: "https://download.fedoraproject.org/pub/fedora/linux/releases/41/Workstation/x86_64/iso/Fedora-Workstation-Live-x86_64-41-1.4.iso", filename: "Fedora-Workstation-Live-x86_64-41-1.4.iso", note: "" },
  { key: "kali-2024", name: "Kali Linux 2024", version: "2024.4", size: "4.1 GB", category: "linux", url: "https://cdimage.kali.org/kali-2024.4/kali-linux-2024.4-installer-amd64.iso", filename: "kali-linux-2024.4-installer-amd64.iso", note: "" },
  { key: "alpine-3", name: "Alpine Linux 3.21", version: "3.21", size: "200 MB", category: "linux", url: "https://dl-cdn.alpinelinux.org/alpine/v3.21/releases/x86_64/alpine-standard-3.21.0-x86_64.iso", filename: "alpine-standard-3.21.0-x86_64.iso", note: "" },
  // Android
  { key: "android-14", name: "Android 14 x86_64", version: "14", size: "1.1 GB", category: "android", url: "https://sourceforge.net/projects/android-x86/files/Release%209.0/android-x86_64-9.0-r2.iso/download", filename: "android-x86_64-9.0-r2.iso", note: "Android-x86 project" },
  { key: "android-13", name: "Android 13 x86_64", version: "13", size: "1.0 GB", category: "android", url: "https://sourceforge.net/projects/android-x86/files/Release%208.1/android-x86_64-8.1-r6.iso/download", filename: "android-x86_64-8.1-r6.iso", note: "Android-x86 project" },
];

function downloadFile(url, dest, onProgress) {
  return new Promise(function(resolve, reject) {
    var file = fs.createWriteStream(dest + ".tmp");
    var downloaded = 0;
    var total = 0;
    var redirectCount = 0;

    function doRequest(reqUrl) {
      if (redirectCount > 15) { reject(new Error("Too many redirects")); return; }
      var mod = reqUrl.startsWith("https") ? https : http;
      mod.get(reqUrl, function(res) {
        if (res.statusCode >= 301 && res.statusCode <= 308 && res.headers.location) {
          redirectCount++;
          doRequest(res.headers.location);
          return;
        }
        if (res.statusCode !== 200) {
          reject(new Error("HTTP " + res.statusCode + " for " + reqUrl));
          return;
        }
        total = parseInt(res.headers["content-length"] || "0", 10);
        res.on("data", function(chunk) {
          downloaded += chunk.length;
          file.write(chunk);
          if (total > 0 && onProgress) onProgress(downloaded, total);
        });
        res.on("end", function() {
          file.close(function() {
            try { fs.renameSync(dest + ".tmp", dest); } catch(e) {}
            resolve();
          });
        });
        res.on("error", reject);
      }).on("error", reject);
    }
    doRequest(url);
  });
}

function installQemu() {
  return new Promise(function(resolve) {
    var qemuPaths = [
      "C:\\Program Files\\qemu\\qemu-system-x86_64.exe",
      "C:\\Program Files (x86)\\qemu\\qemu-system-x86_64.exe",
    ];
    var alreadyInstalled = qemuPaths.some(function(p) { return fs.existsSync(p); });
    if (alreadyInstalled) {
      addLog("✓ QEMU already installed — skipping.");
      progress.percent = 22;
      resolve();
      return;
    }
    var qemuInstaller = path.join(os.tmpdir(), "qemu-installer.exe");
    var qemuUrl = "https://qemu.weilnetz.de/w64/2024/qemu-w64-setup-20241119.exe";
    addLog("Downloading QEMU installer (~130 MB)...");
    progress.step = "qemu-download";
    progress.message = "Downloading QEMU VM engine...";
    progress.percent = 3;
    downloadFile(qemuUrl, qemuInstaller, function(dl, tot) {
      progress.percent = 3 + Math.floor((dl / tot) * 17);
      progress.message = "Downloading QEMU: " + Math.round(dl / 1024 / 1024) + " MB / " + Math.round(tot / 1024 / 1024) + " MB";
    }).then(function() {
      addLog("Installing QEMU silently...");
      progress.step = "qemu-install";
      progress.message = "Installing QEMU...";
      progress.percent = 20;
      exec('"' + qemuInstaller + '" /S', { timeout: 180000 }, function(err) {
        if (err) addLog("QEMU install note: " + err.message);
        else addLog("✓ QEMU installed.");
        progress.percent = 22;
        resolve();
      });
    }).catch(function(err) {
      addLog("QEMU download warning: " + err.message + " — continuing");
      progress.percent = 22;
      resolve();
    });
  });
}

function registerUriScheme() {
  return new Promise(function(resolve) {
    var launcherEscaped = BRIDGE_LAUNCHER.replace(/\\/g, "\\\\");
    var regContent = "Windows Registry Editor Version 5.00\r\n\r\n[HKEY_CURRENT_USER\\Software\\Classes\\thalamus]\r\n@=\"URL:Thalamus Protocol\"\r\n\"URL Protocol\"=\"\"\r\n\r\n[HKEY_CURRENT_USER\\Software\\Classes\\thalamus\\shell]\r\n\r\n[HKEY_CURRENT_USER\\Software\\Classes\\thalamus\\shell\\open]\r\n\r\n[HKEY_CURRENT_USER\\Software\\Classes\\thalamus\\shell\\open\\command]\r\n@=\"wscript.exe \\\"" + launcherEscaped + "\\\" \\\"%1\\\"\"\r\n";
    var regFile = path.join(os.tmpdir(), "thalamus-protocol.reg");
    fs.writeFileSync(regFile, regContent, "utf8");
    exec('reg import "' + regFile + '"', function(err) {
      if (err) addLog("Registry note: " + err.message);
      else addLog("✓ thalamus:// protocol registered.");
      resolve();
    });
  });
}

function addToStartup() {
  return new Promise(function(resolve) {
    exec('reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run" /v "ThalamusBridge" /t REG_SZ /d "wscript.exe \\"' + BRIDGE_LAUNCHER + '\\"" /f', function(err) {
      if (err) addLog("Startup registry note: " + err.message);
      else addLog("✓ Bridge added to Windows startup.");
      resolve();
    });
  });
}

function downloadBridge() {
  return new Promise(function(resolve, reject) {
    if (!fs.existsSync(APP_DIR)) fs.mkdirSync(APP_DIR, { recursive: true });
    if (!fs.existsSync(ISOS_DIR)) fs.mkdirSync(ISOS_DIR, { recursive: true });
    if (fs.existsSync(BRIDGE_EXE)) {
      addLog("✓ Bridge already downloaded.");
      progress.percent = 36;
      resolve();
      return;
    }
    addLog("Downloading VM bridge...");
    progress.step = "bridge-download";
    progress.message = "Downloading VM bridge...";
    progress.percent = 24;
    downloadFile(BRIDGE_URL, BRIDGE_EXE, function(dl, tot) {
      progress.percent = 24 + Math.floor((dl / tot) * 10);
      progress.message = "Downloading bridge: " + Math.round(dl / 1024 / 1024) + " MB / " + Math.round(tot / 1024 / 1024) + " MB";
    }).then(function() {
      addLog("✓ Bridge downloaded.");
      progress.percent = 36;
      resolve();
    }).catch(function(err) {
      addLog("Bridge download failed: " + err.message);
      reject(err);
    });
  });
}

function writeBridgeLauncher() {
  if (!fs.existsSync(APP_DIR)) fs.mkdirSync(APP_DIR, { recursive: true });
  var bridge = BRIDGE_EXE.replace(/"/g, '""');
  var log = BRIDGE_LOG.replace(/"/g, '""');
  var content = [
    'Set shell = CreateObject("WScript.Shell")',
    'cmd = "cmd.exe /c ""' + bridge + '"" >> ""' + log + '"" 2>&1"',
    'shell.Run cmd, 0, False'
  ].join("\r\n");
  fs.writeFileSync(BRIDGE_LAUNCHER, content, "utf8");
  addLog("✓ Hidden bridge launcher written.");
}

async function downloadISOs(selectedKeys) {
  var toDownload = ISO_OPTIONS.filter(function(iso) { return selectedKeys.indexOf(iso.key) !== -1 && iso.url && iso.filename; });
  if (toDownload.length === 0) return;
  for (var i = 0; i < toDownload.length; i++) {
    var iso = toDownload[i];
    var dest = path.join(ISOS_DIR, iso.filename);
    if (fs.existsSync(dest)) { addLog("✓ " + iso.name + " already downloaded."); continue; }
    addLog("Downloading " + iso.name + " (" + iso.size + ")...");
    progress.step = "iso-download";
    var basePercent = 42 + Math.floor((i / toDownload.length) * 50);
    var nextPercent = 42 + Math.floor(((i + 1) / toDownload.length) * 50);
    try {
      await downloadFile(iso.url, dest, function(dl, tot) {
        var isoPercent = tot > 0 ? Math.floor((dl / tot) * (nextPercent - basePercent)) : 0;
        progress.percent = basePercent + isoPercent;
        progress.message = "Downloading " + iso.name + ": " + Math.round(dl / 1024 / 1024) + " MB / " + Math.round(tot / 1024 / 1024) + " MB";
      });
      addLog("✓ " + iso.name + " downloaded.");
    } catch (err) {
      addLog("⚠ Failed to download " + iso.name + ": " + err.message);
    }
  }
}

function startBridge() {
  return new Promise(function(resolve) {
    if (!fs.existsSync(BRIDGE_EXE)) { addLog("Bridge exe not found, skipping start."); resolve(false); return; }
    addLog("Starting VM bridge in background...");
    try {
      writeBridgeLauncher();
      var child = spawn("wscript.exe", ["//B", "//Nologo", BRIDGE_LAUNCHER], { detached: true, stdio: "ignore", windowsHide: true });
      child.unref();
    } catch (err) {
      addLog("Hidden launcher failed, starting bridge directly: " + err.message);
      var out = fs.openSync(BRIDGE_LOG, "a");
      var direct = spawn(BRIDGE_EXE, [], { detached: true, stdio: ["ignore", out, out], windowsHide: true });
      direct.unref();
    }
    addLog("✓ Bridge started in background.");
    resolve(true);
  });
}

async function runInstall(selectedISOs) {
  try {
    progress = { step: "starting", message: "Starting installation...", percent: 2, log: [], done: false, error: null };
    addLog("=== Thalamus Installer v5.0.0 ===");
    addLog("Install directory: " + APP_DIR);
    await installQemu();
    await downloadBridge();
    writeBridgeLauncher();
    progress.step = "registry"; progress.message = "Registering thalamus:// protocol..."; progress.percent = 37;
    await registerUriScheme();
    progress.step = "startup"; progress.message = "Adding bridge to Windows startup..."; progress.percent = 39;
    await addToStartup();
    if (selectedISOs && selectedISOs.length > 0) {
      progress.step = "isos"; progress.message = "Downloading OS images..."; progress.percent = 42;
      await downloadISOs(selectedISOs);
    }
    progress.step = "bridge-start"; progress.message = "Starting VM bridge..."; progress.percent = 94;
    await startBridge();
    progress.step = "done"; progress.message = "Installation complete!"; progress.percent = 100; progress.done = true;
    addLog("=== Installation complete! ===");
    addLog("VM bridge is running in the background.");
    addLog("Return to Thalamus and click Boot OS.");
  } catch (err) {
    progress.error = err.message;
    progress.message = "Installation failed: " + err.message;
    addLog("ERROR: " + err.message);
  }
}

// ── HTA UI — Thalamus design language ────────────────────────────────────────
const HTA_CONTENT = `<html>
<head>
<title>Thalamus — VM Setup</title>
<HTA:APPLICATION
  ID="ThalamusInstaller"
  APPLICATIONNAME="Thalamus VM Setup"
  CAPTION="yes"
  SHOWINTASKBAR="yes"
  SINGLEINSTANCE="yes"
  WINDOWSTATE="normal"
  MINIMIZEBUTTON="yes"
  MAXIMIZEBUTTON="no"
  SCROLL="no"
  INNERBORDER="no"
  SELECTION="no"
/>
<meta http-equiv="x-ua-compatible" content="ie=edge">
<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
body {
  font-family: "Segoe UI", system-ui, sans-serif;
  background: #09090b;
  color: #e4e4e7;
  height: 100vh;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

/* ── Scrollbar ── */
::-webkit-scrollbar { width: 4px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: #3f3f46; border-radius: 4px; }
::-webkit-scrollbar-thumb:hover { background: #6366f1; }
* { scrollbar-width: thin; scrollbar-color: #3f3f46 transparent; }

/* ── Titlebar ── */
.titlebar {
  background: #09090b;
  border-bottom: 1px solid #18181b;
  padding: 14px 20px;
  display: flex;
  align-items: center;
  gap: 12px;
  flex-shrink: 0;
}
.logo {
  width: 34px; height: 34px;
  background: linear-gradient(135deg, #6366f1, #818cf8);
  border-radius: 9px;
  display: flex; align-items: center; justify-content: center;
  font-size: 16px; font-weight: 900; color: white;
  flex-shrink: 0;
  box-shadow: 0 0 16px rgba(99,102,241,0.35);
}
.title-text { flex: 1; }
.title-main { font-size: 14px; font-weight: 700; color: #f4f4f5; letter-spacing: 0.01em; }
.title-sub { font-size: 11px; color: #71717a; margin-top: 1px; }
.badge-version {
  font-size: 10px; font-weight: 700;
  background: rgba(99,102,241,0.12);
  color: #818cf8;
  border: 1px solid rgba(99,102,241,0.25);
  border-radius: 5px;
  padding: 2px 8px;
  letter-spacing: 0.04em;
}

/* ── Layout ── */
.body-wrap {
  flex: 1;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}
.page { display: none; flex: 1; overflow: hidden; flex-direction: column; }
.page.active { display: flex; }

/* ── Select page ── */
.select-layout {
  display: flex;
  flex: 1;
  overflow: hidden;
  gap: 0;
}
.left-panel {
  width: 220px;
  flex-shrink: 0;
  border-right: 1px solid #18181b;
  padding: 16px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.right-panel {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
}

/* ── Steps card ── */
.steps-card {
  background: #18181b;
  border: 1px solid #27272a;
  border-radius: 10px;
  padding: 14px;
  margin-bottom: 8px;
}
.steps-title {
  font-size: 10px; font-weight: 700;
  color: #71717a;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  margin-bottom: 10px;
}
.step-row {
  display: flex; align-items: flex-start; gap: 8px;
  padding: 5px 0;
  border-bottom: 1px solid #27272a;
}
.step-row:last-child { border-bottom: none; }
.step-num {
  width: 18px; height: 18px;
  border-radius: 50%;
  background: rgba(99,102,241,0.12);
  color: #818cf8;
  font-size: 9px; font-weight: 800;
  text-align: center; line-height: 18px;
  flex-shrink: 0;
}
.step-text { font-size: 11px; color: #a1a1aa; line-height: 1.4; }

/* ── OS categories ── */
.cat-header {
  font-size: 10px; font-weight: 700;
  color: #52525b;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  margin: 12px 0 6px;
  padding-bottom: 4px;
  border-bottom: 1px solid #18181b;
}
.cat-header:first-child { margin-top: 0; }

/* ── OS item ── */
.os-item {
  background: #18181b;
  border: 1.5px solid #27272a;
  border-radius: 8px;
  padding: 10px 12px;
  margin-bottom: 6px;
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s;
  display: flex;
  align-items: flex-start;
  gap: 10px;
}
.os-item:hover { border-color: #3f3f46; background: #1c1c1f; }
.os-item.selected { border-color: #6366f1; background: rgba(99,102,241,0.08); }
.os-checkbox {
  width: 15px; height: 15px;
  border: 1.5px solid #3f3f46;
  border-radius: 4px;
  flex-shrink: 0;
  margin-top: 1px;
  background: transparent;
  display: flex; align-items: center; justify-content: center;
}
.os-item.selected .os-checkbox {
  background: #6366f1;
  border-color: #6366f1;
}
.os-check-mark { color: white; font-size: 10px; font-weight: 900; display: none; }
.os-item.selected .os-check-mark { display: block; }
.os-info { flex: 1; min-width: 0; }
.os-name { font-size: 12px; font-weight: 600; color: #e4e4e7; }
.os-meta { font-size: 10px; color: #71717a; margin-top: 2px; }
.os-badge {
  display: inline-block;
  font-size: 9px; font-weight: 700;
  padding: 1px 6px;
  border-radius: 4px;
  margin-top: 4px;
}
.badge-free { background: rgba(34,197,94,0.1); color: #4ade80; border: 1px solid rgba(34,197,94,0.2); }
.badge-eval { background: rgba(234,179,8,0.1); color: #facc15; border: 1px solid rgba(234,179,8,0.2); }
.badge-community { background: rgba(99,102,241,0.1); color: #818cf8; border: 1px solid rgba(99,102,241,0.2); }

/* ── Footer ── */
.footer {
  padding: 12px 20px;
  border-top: 1px solid #18181b;
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-shrink: 0;
  background: #09090b;
}
.footer-note { font-size: 11px; color: #52525b; }
.selected-count { font-size: 11px; color: #818cf8; font-weight: 600; }

/* ── Buttons ── */
.btn-install {
  background: #6366f1;
  color: white;
  border: none;
  border-radius: 8px;
  padding: 9px 22px;
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
  font-family: "Segoe UI", sans-serif;
  letter-spacing: 0.01em;
  transition: background 0.15s;
  box-shadow: 0 0 16px rgba(99,102,241,0.3);
}
.btn-install:hover { background: #4f46e5; }
.btn-install:disabled { background: #27272a; color: #52525b; cursor: default; box-shadow: none; }
.btn-close {
  background: #18181b;
  color: #a1a1aa;
  border: 1px solid #27272a;
  border-radius: 8px;
  padding: 9px 18px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  font-family: "Segoe UI", sans-serif;
  display: none;
}
.btn-close:hover { background: #27272a; color: #e4e4e7; }

/* ── Install page ── */
.install-wrap {
  flex: 1;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  padding: 20px;
  gap: 14px;
}
.install-header { }
.install-title { font-size: 16px; font-weight: 700; color: #f4f4f5; }
.install-sub { font-size: 12px; color: #71717a; margin-top: 3px; }

.progress-track {
  background: #18181b;
  border-radius: 6px;
  height: 6px;
  overflow: hidden;
  border: 1px solid #27272a;
}
.progress-fill {
  height: 100%;
  background: linear-gradient(90deg, #6366f1, #818cf8);
  border-radius: 6px;
  transition: width 0.4s ease;
  box-shadow: 0 0 8px rgba(99,102,241,0.5);
}
.progress-label { font-size: 11px; color: #71717a; margin-top: 6px; }

.log-box {
  flex: 1;
  background: #0c0c0e;
  border: 1px solid #18181b;
  border-radius: 8px;
  padding: 12px;
  overflow-y: auto;
  font-family: "Cascadia Code", "Consolas", monospace;
  font-size: 11px;
  color: #71717a;
  line-height: 1.6;
}
.log-line { padding: 1px 0; }
.log-line.success { color: #4ade80; }
.log-line.warn { color: #facc15; }
.log-line.error { color: #f87171; }
.log-line.header { color: #818cf8; font-weight: 700; }

/* ── Done page ── */
.done-wrap {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 32px 24px;
  text-align: center;
  gap: 12px;
}
.done-icon {
  width: 64px; height: 64px;
  background: rgba(34,197,94,0.1);
  border: 1px solid rgba(34,197,94,0.25);
  border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  font-size: 28px;
  margin-bottom: 4px;
}
.done-title { font-size: 22px; font-weight: 800; color: #4ade80; }
.done-sub { font-size: 13px; color: #71717a; line-height: 1.7; max-width: 340px; }
.done-steps {
  background: #18181b;
  border: 1px solid #27272a;
  border-radius: 10px;
  padding: 14px 18px;
  text-align: left;
  width: 100%;
  max-width: 360px;
}
.done-step { font-size: 12px; color: #a1a1aa; padding: 4px 0; display: flex; align-items: center; gap: 8px; }
.done-step-dot { width: 6px; height: 6px; border-radius: 50%; background: #4ade80; flex-shrink: 0; }
</style>
</head>
<body>
<div class="titlebar">
  <div class="logo">T</div>
  <div class="title-text">
    <div class="title-main">Thalamus VM Setup</div>
    <div class="title-sub">One-time setup to enable VM booting</div>
  </div>
  <div class="badge-version">v5.0.0</div>
</div>

<div class="body-wrap">

  <!-- SELECT PAGE -->
  <div class="page active" id="page-select">
    <div class="select-layout">
      <div class="left-panel">
        <div class="steps-card">
          <div class="steps-title">What gets installed</div>
          <div class="step-row"><div class="step-num">1</div><div class="step-text">QEMU VM engine — silent install</div></div>
          <div class="step-row"><div class="step-num">2</div><div class="step-text">Thalamus VM Bridge — runs in background</div></div>
          <div class="step-row"><div class="step-num">3</div><div class="step-text">thalamus:// protocol — one-click launch</div></div>
          <div class="step-row"><div class="step-num">4</div><div class="step-text">Bridge added to Windows startup</div></div>
          <div class="step-row"><div class="step-num">5</div><div class="step-text">Selected OS images downloaded</div></div>
        </div>
        <div style="font-size:10px;color:#52525b;line-height:1.5;padding:4px 2px;">
          OS images are stored in<br>
          <span style="color:#71717a;font-family:Consolas,monospace;font-size:9px;">%LOCALAPPDATA%\\Thalamus\\isos</span>
        </div>
      </div>
      <div class="right-panel" id="iso-list">
        <div style="color:#52525b;font-size:12px;padding:20px 0;">Loading OS list...</div>
      </div>
    </div>
  </div>

  <!-- INSTALL PAGE -->
  <div class="page" id="page-install">
    <div class="install-wrap">
      <div class="install-header">
        <div class="install-title" id="install-title">Installing Thalamus VM Bridge</div>
        <div class="install-sub" id="install-sub">This may take a few minutes depending on your connection.</div>
      </div>
      <div>
        <div class="progress-track">
          <div class="progress-fill" id="prog-fill" style="width:0%"></div>
        </div>
        <div class="progress-label" id="prog-label">Starting...</div>
      </div>
      <div class="log-box" id="log-box"></div>
    </div>
  </div>

  <!-- DONE PAGE -->
  <div class="page" id="page-done">
    <div class="done-wrap">
      <div class="done-icon">&#10003;</div>
      <div class="done-title">Setup Complete!</div>
      <div class="done-sub">The Thalamus VM Bridge is running in the background and will start automatically with Windows.</div>
      <div class="done-steps">
        <div class="done-step"><div class="done-step-dot"></div>VM Bridge is running in the background</div>
        <div class="done-step"><div class="done-step-dot"></div>thalamus:// protocol registered</div>
        <div class="done-step"><div class="done-step-dot"></div>Bridge starts automatically with Windows</div>
        <div class="done-step"><div class="done-step-dot"></div>Return to Thalamus and click Boot OS</div>
      </div>
    </div>
  </div>

</div>

<div class="footer">
  <div>
    <span class="footer-note" id="footer-note">Select OS images to download (optional)</span>
    <span class="selected-count" id="sel-count"></span>
  </div>
  <div style="display:flex;gap:8px;align-items:center;">
    <button class="btn-close" id="close-btn" onclick="window.close()">Close</button>
    <button class="btn-install" id="install-btn" onclick="startInstall()">Install Now</button>
  </div>
</div>

<script language="JScript">
var ISO_DATA = [];
var selected = {};

function escHtml(s) {
  return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
}

function getCatLabel(cat) {
  if (cat === "windows") return "Windows";
  if (cat === "macos") return "macOS";
  if (cat === "linux") return "Linux";
  if (cat === "android") return "Android";
  return cat;
}

function getCatBadge(cat, note) {
  if (cat === "windows") return '<span class="os-badge badge-eval">Evaluation</span>';
  if (cat === "macos") return '<span class="os-badge badge-community">Community ISO</span>';
  if (cat === "android") return '<span class="os-badge badge-free">Free</span>';
  return '<span class="os-badge badge-free">Free + Open Source</span>';
}

function renderISOs() {
  var container = document.getElementById("iso-list");
  if (!ISO_DATA || ISO_DATA.length === 0) {
    container.innerHTML = '<div style="color:#52525b;font-size:12px;padding:20px 0;">No OS images available.</div>';
    return;
  }

  var cats = [];
  var catMap = {};
  var i, iso;
  for (i = 0; i < ISO_DATA.length; i++) {
    iso = ISO_DATA[i];
    if (!catMap[iso.category]) {
      catMap[iso.category] = [];
      cats.push(iso.category);
    }
    catMap[iso.category].push(iso);
  }

  var html = "";
  var c, items, j;
  for (c = 0; c < cats.length; c++) {
    html += '<div class="cat-header">' + getCatLabel(cats[c]) + '</div>';
    items = catMap[cats[c]];
    for (j = 0; j < items.length; j++) {
      iso = items[j];
      html += '<div class="os-item" id="item-' + iso.key + '" onclick="toggleISO(this.id)">' ;
      html += '<div class="os-checkbox" id="chk-' + iso.key + '"><span class="os-check-mark">v</span></div>';
      html += '<div class="os-info">';
      html += '<div class="os-name">' + escHtml(iso.name) + '</div>';
      html += '<div class="os-meta">' + escHtml(iso.version) + ' - ' + escHtml(iso.size) + '</div>';
      html += getCatBadge(iso.category, iso.note);
      if (iso.note) html += ' <span style="font-size:9px;color:#52525b;">' + escHtml(iso.note) + '</span>';
      html += '</div></div>';
    }
  }
  container.innerHTML = html;
}


function toggleISO(elId) {
  var key = (typeof elId === "string" && elId.indexOf("item-") === 0) ? elId.replace("item-", "") : elId;
  if (selected[key]) {
    delete selected[key];
  } else {
    selected[key] = true;
  }
  var el = document.getElementById("item-" + key);
  if (el) {
    if (selected[key]) {
      el.className = "os-item selected";
    } else {
      el.className = "os-item";
    }
  }
  updateSelCount();
}

function updateSelCount() {
  var keys = [];
  var k;
  for (k in selected) {
    if (selected.hasOwnProperty(k)) keys.push(k);
  }
  var el = document.getElementById("sel-count");
  if (el) {
    if (keys.length > 0) {
      el.innerText = " \u2014 " + keys.length + " OS" + (keys.length > 1 ? "es" : "") + " selected";
    } else {
      el.innerText = "";
    }
  }
}

function loadISOs() {
  var xhr = new XMLHttpRequest();
  xhr.open("GET", "http://127.0.0.1:7891/isos", true);
  xhr.onreadystatechange = function() {
    if (xhr.readyState === 4) {
      if (xhr.status === 200) {
        try {
          ISO_DATA = JSON.parse(xhr.responseText);
          renderISOs();
        } catch(e) {
          document.getElementById("iso-list").innerHTML = '<div style="color:#f87171;font-size:12px;padding:20px 0;">Failed to load OS list: ' + escHtml(e.message) + '</div>';
        }
      } else {
        setTimeout(loadISOs, 600);
      }
    }
  };
  try { xhr.send(); } catch(e) { setTimeout(loadISOs, 600); }
}

function startInstall() {
  document.getElementById("page-select").className = "page";
  document.getElementById("page-install").className = "page active";
  document.getElementById("install-btn").disabled = true;
  document.getElementById("footer-note").innerText = "Installation in progress...";

  var keys = [];
  var k;
  for (k in selected) {
    if (selected.hasOwnProperty(k)) keys.push(k);
  }

  var body = '{"isos":[';
  for (var i = 0; i < keys.length; i++) {
    body += '"' + keys[i] + '"';
    if (i < keys.length - 1) body += ',';
  }
  body += ']}';

  var xhr = new XMLHttpRequest();
  xhr.open("POST", "http://127.0.0.1:7891/install", true);
  xhr.setRequestHeader("Content-Type", "application/json");
  xhr.onreadystatechange = function() {
    if (xhr.readyState === 4) {
      if (xhr.status === 200) {
        pollProgress();
      } else {
        document.getElementById("install-title").innerText = "Installation Request Failed";
        document.getElementById("prog-label").innerText = "Could not start installer. HTTP " + xhr.status;
        document.getElementById("footer-note").innerText = "Install did not start.";
        document.getElementById("close-btn").style.display = "inline-block";
      }
    }
  };
  try { xhr.send(body); } catch(e) {
    document.getElementById("install-title").innerText = "Installation Request Failed";
    document.getElementById("prog-label").innerText = "Could not send request: " + escHtml(e.message);
    document.getElementById("close-btn").style.display = "inline-block";
  }
}

function getLogClass(line) {
  if (line.indexOf("===") !== -1) return "log-line header";
  if (line.indexOf("ERROR") !== -1 || line.indexOf("failed") !== -1) return "log-line error";
  if (line.indexOf("Warning") !== -1 || line.indexOf("warning") !== -1 || line.indexOf("\u26a0") !== -1) return "log-line warn";
  if (line.indexOf("\u2713") !== -1 || line.indexOf("complete") !== -1 || line.indexOf("installed") !== -1) return "log-line success";
  return "log-line";
}

function pollProgress() {
  var xhr = new XMLHttpRequest();
  xhr.open("GET", "http://127.0.0.1:7891/progress", true);
  xhr.onreadystatechange = function() {
    if (xhr.readyState === 4 && xhr.status === 200) {
      try {
        var data = JSON.parse(xhr.responseText);
        document.getElementById("prog-fill").style.width = data.percent + "%";
        document.getElementById("prog-label").innerText = data.message || "";

        var logBox = document.getElementById("log-box");
        var html = "";
        var i, line;
        for (i = 0; i < data.log.length; i++) {
          line = data.log[i];
          html += '<div class="' + getLogClass(line) + '">' + escHtml(line) + '</div>';
        }
        logBox.innerHTML = html;
        logBox.scrollTop = logBox.scrollHeight;

        if (data.done) {
          document.getElementById("install-title").innerText = "Setup Complete!";
          document.getElementById("page-install").className = "page";
          document.getElementById("page-done").className = "page active";
          document.getElementById("close-btn").style.display = "inline-block";
          document.getElementById("install-btn").style.display = "none";
          document.getElementById("footer-note").innerText = "VM Bridge is running in the background.";
        } else if (data.error) {
          document.getElementById("install-title").innerText = "Installation Failed";
          document.getElementById("prog-label").innerText = "Error: " + data.error;
          document.getElementById("close-btn").style.display = "inline-block";
          document.getElementById("footer-note").innerText = "Installation failed.";
        } else {
          setTimeout(pollProgress, 600);
        }
      } catch(e) {
        setTimeout(pollProgress, 1000);
      }
    } else if (xhr.readyState === 4) {
      setTimeout(pollProgress, 1000);
    }
  };
  try { xhr.send(); } catch(e) { setTimeout(pollProgress, 1000); }
}

try {
  window.resizeTo(820, 580);
  window.moveTo(Math.floor((screen.width - 820) / 2), Math.floor((screen.height - 580) / 2));
} catch(e) {}

loadISOs();
</script>
</body>
</html>`;

// ── HTTP server ───────────────────────────────────────────────────────────────
const server = http.createServer(function(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }

  if (req.method === "GET" && req.url === "/isos") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(ISO_OPTIONS));
  } else if (req.method === "GET" && req.url === "/progress") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(progress));
  } else if (req.method === "POST" && req.url === "/install") {
    var body = "";
    req.on("data", function(d) { body += d; });
    req.on("end", function() {
      try {
        var parsed = JSON.parse(body);
        runInstall(parsed.isos || []);
      } catch(e) { runInstall([]); }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end('{"ok":true}');
    });
  } else {
    res.writeHead(404);
    res.end("Not found");
  }
});

server.listen(PORT, "127.0.0.1", function() {
  var htaPath = path.join(os.tmpdir(), "thalamus-installer.hta");
  fs.writeFileSync(htaPath, HTA_CONTENT, "utf8");

  var htaProc = spawn("mshta.exe", [htaPath], {
    detached: false,
    stdio: "ignore",
    windowsHide: false,
  });

  htaProc.on("close", function() {
    setTimeout(function() { server.close(); process.exit(0); }, 2000);
  });

  htaProc.on("error", function() {
    exec("start http://127.0.0.1:" + PORT);
  });
});

process.on("SIGINT", function() { server.close(); process.exit(0); });
process.on("SIGTERM", function() { server.close(); process.exit(0); });