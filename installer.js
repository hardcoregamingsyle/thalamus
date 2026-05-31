/**
 * Thalamus Installer v4.0.0
 * Native Windows desktop UI via HTA (HTML Application)
 * - Writes an HTA file and launches it with mshta.exe
 * - HTA = real native Windows window, no browser, no command prompt
 * - Node.js backend runs hidden, serves progress via local HTTP
 * - OS selection happens inside the installer UI
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
const BRIDGE_URL = "https://github.com/hardcoregamingsyle/thalamus/releases/download/vm-bridge-v2.1.0/thalamus-vm-bridge.exe";

// Progress tracking
let progress = {
  step: "idle",
  message: "Ready to install",
  percent: 0,
  log: [],
  done: false,
  error: null,
};

function log(msg) {
  console.log(msg);
  progress.log.push(msg);
  if (progress.log.length > 300) progress.log.shift();
}

// ISO definitions
const ISO_OPTIONS = [
  { key: "ubuntu-24", name: "Ubuntu 24.04 LTS", version: "24.04", size: "~5.7GB", category: "linux", url: "https://releases.ubuntu.com/24.04/ubuntu-24.04.2-desktop-amd64.iso", filename: "ubuntu-24.04.2-desktop-amd64.iso" },
  { key: "ubuntu-22", name: "Ubuntu 22.04 LTS", version: "22.04", size: "~4.7GB", category: "linux", url: "https://releases.ubuntu.com/22.04/ubuntu-22.04.5-desktop-amd64.iso", filename: "ubuntu-22.04.5-desktop-amd64.iso" },
  { key: "debian-12", name: "Debian 12 Bookworm", version: "12.0", size: "~3.7GB", category: "linux", url: "https://cdimage.debian.org/debian-cd/current/amd64/iso-dvd/debian-12.9.0-amd64-DVD-1.iso", filename: "debian-12.9.0-amd64-DVD-1.iso" },
  { key: "fedora-41", name: "Fedora 41", version: "41", size: "~2.1GB", category: "linux", url: "https://download.fedoraproject.org/pub/fedora/linux/releases/41/Workstation/x86_64/iso/Fedora-Workstation-Live-x86_64-41-1.4.iso", filename: "Fedora-Workstation-Live-x86_64-41-1.4.iso" },
  { key: "alpine-3", name: "Alpine Linux 3.21", version: "3.21", size: "~200MB", category: "linux", url: "https://dl-cdn.alpinelinux.org/alpine/v3.21/releases/x86_64/alpine-standard-3.21.0-x86_64.iso", filename: "alpine-standard-3.21.0-x86_64.iso" },
  { key: "kali-2024", name: "Kali Linux 2024", version: "2024.4", size: "~4.1GB", category: "linux", url: "https://cdimage.kali.org/kali-2024.4/kali-linux-2024.4-installer-amd64.iso", filename: "kali-linux-2024.4-installer-amd64.iso" },
  { key: "android-14", name: "Android 14 x86_64", version: "14", size: "~1.1GB", category: "android", url: "https://sourceforge.net/projects/android-x86/files/Release%209.0/android-x86_64-9.0-r2.iso/download", filename: "android-x86_64-9.0-r2.iso" },
  { key: "windows-11", name: "Windows 11", version: "23H2", size: "~5.8GB", category: "windows", url: null, filename: null, note: "Download from Microsoft", manualUrl: "https://www.microsoft.com/software-download/windows11" },
  { key: "windows-10", name: "Windows 10", version: "22H2", size: "~5.2GB", category: "windows", url: null, filename: null, note: "Download from Microsoft", manualUrl: "https://www.microsoft.com/software-download/windows10" },
  { key: "macos-sequoia", name: "macOS 15 Sequoia", version: "15.0", size: "~14GB", category: "macos", url: null, filename: null, note: "Create from Mac App Store or archive.org", manualUrl: "https://archive.org/search?query=macos+sequoia+iso" },
  { key: "macos-sonoma", name: "macOS 14 Sonoma", version: "14.0", size: "~13GB", category: "macos", url: null, filename: null, note: "Create from Mac App Store or archive.org", manualUrl: "https://archive.org/search?query=macos+sonoma+iso" },
];

// Download a file with progress + redirect following
function downloadFile(url, dest, onProgress) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest + ".tmp");
    let downloaded = 0;
    let total = 0;
    let redirectCount = 0;

    const doRequest = (reqUrl) => {
      if (redirectCount > 10) { reject(new Error("Too many redirects")); return; }
      const mod = reqUrl.startsWith("https") ? https : http;
      mod.get(reqUrl, (res) => {
        if (res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 303 || res.statusCode === 307 || res.statusCode === 308) {
          redirectCount++;
          file.close();
          doRequest(res.headers.location);
          return;
        }
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode} for ${reqUrl}`));
          return;
        }
        total = parseInt(res.headers["content-length"] || "0", 10);
        res.on("data", (chunk) => {
          downloaded += chunk.length;
          file.write(chunk);
          if (total > 0 && onProgress) onProgress(downloaded, total);
        });
        res.on("end", () => {
          file.close(() => {
            fs.renameSync(dest + ".tmp", dest);
            resolve();
          });
        });
        res.on("error", reject);
      }).on("error", reject);
    };
    doRequest(url);
  });
}

// Install QEMU silently
function installQemu() {
  return new Promise((resolve) => {
    // Check if QEMU is already installed
    const qemuPaths = [
      "C:\\Program Files\\qemu\\qemu-system-x86_64.exe",
      "C:\\Program Files (x86)\\qemu\\qemu-system-x86_64.exe",
    ];
    const alreadyInstalled = qemuPaths.some(p => fs.existsSync(p));
    if (alreadyInstalled) {
      log("QEMU already installed, skipping.");
      progress.percent = 22;
      resolve();
      return;
    }

    const qemuInstaller = path.join(os.tmpdir(), "qemu-installer.exe");
    const qemuUrl = "https://qemu.weilnetz.de/w64/2024/qemu-w64-setup-20241119.exe";
    log("Downloading QEMU installer (~130MB)...");
    progress.step = "qemu-download";
    progress.message = "Downloading QEMU VM engine...";
    progress.percent = 3;

    downloadFile(qemuUrl, qemuInstaller, (dl, total) => {
      progress.percent = 3 + Math.floor((dl / total) * 17);
      progress.message = `Downloading QEMU: ${Math.round(dl / 1024 / 1024)}MB / ${Math.round(total / 1024 / 1024)}MB`;
    }).then(() => {
      log("Installing QEMU silently...");
      progress.step = "qemu-install";
      progress.message = "Installing QEMU...";
      progress.percent = 20;
      exec(`"${qemuInstaller}" /S`, { timeout: 120000 }, (err) => {
        if (err) log("QEMU install note: " + err.message + " (may already be installed)");
        else log("QEMU installed successfully.");
        progress.percent = 22;
        resolve();
      });
    }).catch((err) => {
      log("QEMU download warning: " + err.message + " — continuing anyway");
      progress.percent = 22;
      resolve(); // Don't fail the whole install
    });
  });
}

// Register thalamus:// URI scheme
function registerUriScheme() {
  return new Promise((resolve) => {
    const bridgeEscaped = BRIDGE_EXE.replace(/\\/g, "\\\\");
    const regContent = `Windows Registry Editor Version 5.00\r\n\r\n[HKEY_CURRENT_USER\\Software\\Classes\\thalamus]\r\n@="URL:Thalamus Protocol"\r\n"URL Protocol"=""\r\n\r\n[HKEY_CURRENT_USER\\Software\\Classes\\thalamus\\shell]\r\n\r\n[HKEY_CURRENT_USER\\Software\\Classes\\thalamus\\shell\\open]\r\n\r\n[HKEY_CURRENT_USER\\Software\\Classes\\thalamus\\shell\\open\\command]\r\n@="\\"${bridgeEscaped}\\""\r\n`;
    const regFile = path.join(os.tmpdir(), "thalamus-protocol.reg");
    fs.writeFileSync(regFile, regContent, "utf8");
    exec(`reg import "${regFile}"`, (err) => {
      if (err) log("Registry note: " + err.message);
      else log("thalamus:// protocol registered.");
      resolve();
    });
  });
}

// Add bridge to Windows startup via registry (more reliable than shortcut)
function addToStartup() {
  return new Promise((resolve) => {
    const bridgeEscaped = BRIDGE_EXE.replace(/\\/g, "\\\\");
    exec(`reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run" /v "ThalamusBridge" /t REG_SZ /d "\\"${bridgeEscaped}\\"" /f`, (err) => {
      if (err) log("Startup registry note: " + err.message);
      else log("Bridge added to Windows startup.");
      resolve();
    });
  });
}

// Download bridge exe
function downloadBridge() {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(APP_DIR)) fs.mkdirSync(APP_DIR, { recursive: true });
    if (!fs.existsSync(ISOS_DIR)) fs.mkdirSync(ISOS_DIR, { recursive: true });

    if (fs.existsSync(BRIDGE_EXE)) {
      log("Bridge already downloaded.");
      progress.percent = 36;
      resolve();
      return;
    }

    log("Downloading VM bridge...");
    progress.step = "bridge-download";
    progress.message = "Downloading VM bridge...";
    progress.percent = 24;

    downloadFile(BRIDGE_URL, BRIDGE_EXE, (dl, total) => {
      progress.percent = 24 + Math.floor((dl / total) * 10);
      progress.message = `Downloading bridge: ${Math.round(dl / 1024 / 1024)}MB / ${Math.round(total / 1024 / 1024)}MB`;
    }).then(() => {
      log("Bridge downloaded to: " + BRIDGE_EXE);
      progress.percent = 36;
      resolve();
    }).catch(reject);
  });
}

// Download selected ISOs
async function downloadISOs(selectedKeys) {
  const toDownload = ISO_OPTIONS.filter(iso => selectedKeys.includes(iso.key) && iso.url && iso.filename);
  if (toDownload.length === 0) return;

  for (let i = 0; i < toDownload.length; i++) {
    const iso = toDownload[i];
    const dest = path.join(ISOS_DIR, iso.filename);
    if (fs.existsSync(dest)) {
      log(`${iso.name} already downloaded, skipping.`);
      continue;
    }
    log(`Downloading ${iso.name} (${iso.size})...`);
    progress.step = "iso-download";
    const basePercent = 42 + Math.floor((i / toDownload.length) * 50);
    const nextPercent = 42 + Math.floor(((i + 1) / toDownload.length) * 50);
    try {
      await downloadFile(iso.url, dest, (dl, total) => {
        const isoPercent = total > 0 ? Math.floor((dl / total) * (nextPercent - basePercent)) : 0;
        progress.percent = basePercent + isoPercent;
        progress.message = `Downloading ${iso.name}: ${Math.round(dl / 1024 / 1024)}MB / ${Math.round(total / 1024 / 1024)}MB`;
      });
      log(`${iso.name} downloaded successfully.`);
    } catch (err) {
      log(`Warning: Failed to download ${iso.name}: ${err.message}`);
    }
  }
}

// Start bridge
function startBridge() {
  return new Promise((resolve) => {
    if (!fs.existsSync(BRIDGE_EXE)) {
      log("Bridge exe not found, skipping start.");
      resolve(false);
      return;
    }
    log("Starting VM bridge in background...");
    const child = spawn(BRIDGE_EXE, [], {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    child.unref();
    log("Bridge started.");
    resolve(true);
  });
}

// Main install flow
async function runInstall(selectedISOs) {
  try {
    progress = { step: "starting", message: "Starting installation...", percent: 2, log: [], done: false, error: null };
    log("=== Thalamus Installer v4.0.0 ===");
    log("Install directory: " + APP_DIR);
    log("ISOs directory: " + ISOS_DIR);

    await installQemu();
    await downloadBridge();

    progress.step = "registry";
    progress.message = "Registering thalamus:// protocol...";
    progress.percent = 37;
    await registerUriScheme();

    progress.step = "startup";
    progress.message = "Adding bridge to Windows startup...";
    progress.percent = 39;
    await addToStartup();

    if (selectedISOs && selectedISOs.length > 0) {
      progress.step = "isos";
      progress.message = "Downloading OS images...";
      progress.percent = 42;
      await downloadISOs(selectedISOs);
    }

    progress.step = "bridge-start";
    progress.message = "Starting VM bridge...";
    progress.percent = 94;
    await startBridge();

    progress.step = "done";
    progress.message = "Installation complete!";
    progress.percent = 100;
    progress.done = true;
    log("=== Installation complete! ===");
    log("VM bridge is running in the background.");
    log("Return to Thalamus and click Boot OS.");
  } catch (err) {
    progress.error = err.message;
    progress.message = "Installation failed: " + err.message;
    log("ERROR: " + err.message);
  }
}

// ── HTA UI (native Windows desktop window) ───────────────────────────────────
// HTA = HTML Application — built into Windows, creates a real native window
// No browser needed, no command prompt, just a proper desktop app window
const HTA_CONTENT = `<html>
<head>
<title>Thalamus Installer</title>
<HTA:APPLICATION
  ID="ThalamusInstaller"
  APPLICATIONNAME="Thalamus Installer"
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
body { font-family: 'Segoe UI', sans-serif; background: #0d1117; color: #e6edf3; height: 100vh; overflow: hidden; display: flex; flex-direction: column; }
.titlebar { background: #161b22; border-bottom: 1px solid #21262d; padding: 12px 20px; display: flex; align-items: center; gap: 12px; flex-shrink: 0; }
.logo { width: 32px; height: 32px; background: linear-gradient(135deg, #6366f1, #8b5cf6); border-radius: 8px; display: flex; align-items: center; justify-content: center; font-size: 16px; }
.app-title { font-size: 15px; font-weight: 700; color: #f0f6fc; }
.app-sub { font-size: 11px; color: #8b949e; margin-top: 1px; }
.content { flex: 1; overflow-y: auto; padding: 20px; }
.page { display: none; }
.page.active { display: block; }
.section-title { font-size: 13px; font-weight: 700; color: #8b949e; text-transform: uppercase; letter-spacing: 0.06em; margin-bottom: 12px; }
.card { background: #161b22; border: 1px solid #21262d; border-radius: 10px; padding: 16px; margin-bottom: 14px; }
.step-list { list-style: none; }
.step-list li { display: flex; align-items: center; gap: 10px; font-size: 12px; color: #8b949e; padding: 5px 0; border-bottom: 1px solid #21262d; }
.step-list li:last-child { border-bottom: none; }
.step-num { width: 20px; height: 20px; border-radius: 50%; background: #21262d; color: #6366f1; font-size: 10px; font-weight: 700; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
.iso-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.iso-item { background: #0d1117; border: 1px solid #21262d; border-radius: 8px; padding: 10px; cursor: pointer; display: flex; align-items: flex-start; gap: 8px; transition: border-color 0.1s; }
.iso-item:hover { border-color: #6366f1; }
.iso-item.selected { border-color: #6366f1; background: #1a1f3a; }
.iso-item.manual { opacity: 0.6; cursor: default; }
.iso-check { width: 16px; height: 16px; border: 2px solid #30363d; border-radius: 3px; flex-shrink: 0; margin-top: 1px; background: transparent; }
.iso-item.selected .iso-check { background: #6366f1; border-color: #6366f1; }
.iso-name { font-size: 12px; font-weight: 600; color: #e6edf3; }
.iso-meta { font-size: 10px; color: #8b949e; margin-top: 2px; }
.badge { display: inline-block; font-size: 9px; padding: 1px 5px; border-radius: 3px; margin-top: 3px; }
.badge-free { background: #0d2818; color: #3fb950; border: 1px solid #1a4731; }
.badge-manual { background: #1c1917; color: #8b949e; border: 1px solid #30363d; }
.cat-label { font-size: 10px; font-weight: 700; color: #6e7681; text-transform: uppercase; letter-spacing: 0.08em; margin: 12px 0 6px; }
.cat-label:first-child { margin-top: 0; }
.btn { display: inline-flex; align-items: center; justify-content: center; gap: 6px; padding: 10px 20px; border-radius: 8px; font-size: 13px; font-weight: 600; cursor: pointer; border: none; font-family: 'Segoe UI', sans-serif; }
.btn-primary { background: #6366f1; color: white; width: 100%; padding: 12px; font-size: 14px; }
.btn-primary:hover { background: #4f46e5; }
.btn-primary:disabled { background: #21262d; color: #6e7681; cursor: not-allowed; }
.btn-secondary { background: #21262d; color: #e6edf3; border: 1px solid #30363d; }
.progress-wrap { margin: 10px 0; }
.progress-bar { background: #21262d; border-radius: 6px; height: 6px; overflow: hidden; }
.progress-fill { height: 100%; background: linear-gradient(90deg, #6366f1, #8b5cf6); border-radius: 6px; transition: width 0.4s ease; }
.progress-label { font-size: 11px; color: #8b949e; margin-top: 6px; }
.log-box { background: #0d1117; border: 1px solid #21262d; border-radius: 6px; padding: 10px; height: 160px; overflow-y: auto; font-family: 'Consolas', monospace; font-size: 10px; color: #8b949e; line-height: 1.5; }
.log-line { color: #8b949e; }
.log-line.err { color: #f85149; }
.done-wrap { text-align: center; padding: 24px 16px; }
.done-icon { font-size: 48px; margin-bottom: 12px; }
.done-title { font-size: 18px; font-weight: 700; color: #3fb950; margin-bottom: 6px; }
.done-sub { font-size: 12px; color: #8b949e; line-height: 1.6; }
.footer { padding: 12px 20px; border-top: 1px solid #21262d; display: flex; justify-content: space-between; align-items: center; flex-shrink: 0; background: #161b22; }
.footer-note { font-size: 11px; color: #6e7681; }
</style>
</head>
<body>
<div class="titlebar">
  <div class="logo">&#9889;</div>
  <div>
    <div class="app-title">Thalamus Installer</div>
    <div class="app-sub">VM Bridge Setup &mdash; v4.0.0</div>
  </div>
</div>

<div class="content">
  <!-- Page 1: Welcome + OS Selection -->
  <div class="page active" id="page-select">
    <div class="card">
      <div class="section-title">What gets installed</div>
      <ul class="step-list">
        <li><span class="step-num">1</span>QEMU VM engine &mdash; installed silently</li>
        <li><span class="step-num">2</span>Thalamus VM Bridge &mdash; runs in background</li>
        <li><span class="step-num">3</span>thalamus:// protocol &mdash; one-click VM launch</li>
        <li><span class="step-num">4</span>Bridge added to Windows startup</li>
        <li><span class="step-num">5</span>Selected OS images downloaded automatically</li>
      </ul>
    </div>

    <div class="card">
      <div class="section-title">Select OS Images to Download</div>
      <div id="iso-list"></div>
    </div>
  </div>

  <!-- Page 2: Installing -->
  <div class="page" id="page-install">
    <div class="card">
      <div class="section-title" id="install-title">Installing...</div>
      <div class="progress-wrap">
        <div class="progress-bar"><div class="progress-fill" id="prog-fill" style="width:0%"></div></div>
        <div class="progress-label" id="prog-label">Starting...</div>
      </div>
    </div>
    <div class="card">
      <div class="section-title">Installation Log</div>
      <div class="log-box" id="log-box"></div>
    </div>
  </div>

  <!-- Page 3: Done -->
  <div class="page" id="page-done">
    <div class="card">
      <div class="done-wrap">
        <div class="done-icon">&#10003;</div>
        <div class="done-title">Installation Complete!</div>
        <div class="done-sub">The VM bridge is running in the background.<br>Return to Thalamus and click Boot OS to launch a VM.</div>
      </div>
    </div>
  </div>
</div>

<div class="footer">
  <div class="footer-note" id="footer-note">Select OS images above, then click Install</div>
  <div>
    <button class="btn btn-primary" id="install-btn" onclick="startInstall()">&#9889; Install Now</button>
    <button class="btn btn-secondary" id="close-btn" style="display:none;margin-left:8px" onclick="window.close()">Close</button>
  </div>
</div>

<script language="JScript">
var ISO_OPTIONS = ${JSON.stringify(ISO_OPTIONS)};
var selected = {"ubuntu-24": true, "alpine-3": true};
var pollTimer = null;

function escHtml(s) {
  return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
}

function renderISOs() {
  var cats = [
    {key:"linux", label:"Linux (Free &mdash; Auto-download)"},
    {key:"android", label:"Android (Free &mdash; Auto-download)"},
    {key:"windows", label:"Windows (Manual download required)"},
    {key:"macos", label:"macOS (Manual download required)"}
  ];
  var grouped = {};
  for (var i = 0; i < ISO_OPTIONS.length; i++) {
    var iso = ISO_OPTIONS[i];
    if (!grouped[iso.category]) grouped[iso.category] = [];
    grouped[iso.category].push(iso);
  }
  var html = "";
  for (var c = 0; c < cats.length; c++) {
    var cat = cats[c];
    if (!grouped[cat.key]) continue;
    html += '<div class="cat-label">' + cat.label + '</div><div class="iso-grid">';
    var isos = grouped[cat.key];
    for (var j = 0; j < isos.length; j++) {
      var iso = isos[j];
      var isManual = !iso.url;
      var isSel = !!selected[iso.key];
      var cls = "iso-item" + (isSel ? " selected" : "") + (isManual ? " manual" : "");
      var onclick = isManual ? "" : ' onclick="toggleISO(\'' + iso.key + '\')"';
      html += '<div class="' + cls + '"' + onclick + '>';
      html += '<div class="iso-check"></div>';
      html += '<div><div class="iso-name">' + escHtml(iso.name) + '</div>';
      html += '<div class="iso-meta">' + escHtml(iso.version) + ' &middot; ' + escHtml(iso.size) + '</div>';
      if (isManual) {
        html += '<span class="badge badge-manual">Manual</span>';
        if (iso.manualUrl) html += ' <a href="' + iso.manualUrl + '" style="font-size:9px;color:#6366f1;" onclick="openUrl(\'' + iso.manualUrl + '\')">Get ISO</a>';
      } else {
        html += '<span class="badge badge-free">Free &middot; Auto</span>';
      }
      if (iso.note) html += '<div class="iso-meta" style="margin-top:3px">' + escHtml(iso.note) + '</div>';
      html += '</div></div>';
    }
    html += '</div>';
  }
  document.getElementById("iso-list").innerHTML = html;
}

function openUrl(url) {
  var shell = new ActiveXObject("WScript.Shell");
  shell.Run(url);
}

function toggleISO(key) {
  if (selected[key]) delete selected[key];
  else selected[key] = true;
  renderISOs();
}

function startInstall() {
  document.getElementById("page-select").className = "page";
  document.getElementById("page-install").className = "page active";
  document.getElementById("install-btn").style.display = "none";
  document.getElementById("footer-note").textContent = "Installation in progress...";

  var keys = [];
  for (var k in selected) { if (selected.hasOwnProperty(k)) keys.push(k); }

  var xhr = new XMLHttpRequest();
  xhr.open("POST", "http://127.0.0.1:${PORT}/install", true);
  xhr.setRequestHeader("Content-Type", "application/json");
  xhr.send(JSON.stringify({isos: keys}));

  pollProgress();
}

function pollProgress() {
  var xhr = new XMLHttpRequest();
  xhr.open("GET", "http://127.0.0.1:${PORT}/progress", true);
  xhr.onreadystatechange = function() {
    if (xhr.readyState === 4 && xhr.status === 200) {
      try {
        var data = JSON.parse(xhr.responseText);
        document.getElementById("prog-fill").style.width = data.percent + "%";
        document.getElementById("prog-label").textContent = data.message || "";

        var logBox = document.getElementById("log-box");
        var html = "";
        for (var i = 0; i < data.log.length; i++) {
          var line = data.log[i];
          var cls = (line.indexOf("ERROR") === 0 || line.indexOf("Warning") === 0) ? "log-line err" : "log-line";
          html += '<div class="' + cls + '">' + escHtml(line) + '</div>';
        }
        logBox.innerHTML = html;
        logBox.scrollTop = logBox.scrollHeight;

        if (data.done) {
          document.getElementById("install-title").textContent = "Installation Complete!";
          document.getElementById("page-install").className = "page";
          document.getElementById("page-done").className = "page active";
          document.getElementById("close-btn").style.display = "inline-flex";
          document.getElementById("footer-note").textContent = "Done! VM bridge is running.";
        } else if (data.error) {
          document.getElementById("install-title").textContent = "Installation Failed";
          document.getElementById("prog-label").textContent = "Error: " + data.error;
          document.getElementById("close-btn").style.display = "inline-flex";
        } else {
          setTimeout(pollProgress, 700);
        }
      } catch(e) {
        setTimeout(pollProgress, 1000);
      }
    } else if (xhr.readyState === 4) {
      setTimeout(pollProgress, 1000);
    }
  };
  xhr.send();
}

// Resize window to fit content nicely
try {
  window.resizeTo(720, 620);
  window.moveTo((screen.width - 720) / 2, (screen.height - 620) / 2);
} catch(e) {}

renderISOs();
</script>
</body>
</html>`;

// ── HTTP server (backend for HTA to talk to) ──────────────────────────────────
const server = http.createServer((req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method === "GET" && req.url === "/progress") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(progress));
  } else if (req.method === "POST" && req.url === "/install") {
    let body = "";
    req.on("data", d => { body += d; });
    req.on("end", () => {
      try {
        const { isos } = JSON.parse(body);
        runInstall(isos || []);
      } catch { runInstall([]); }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    });
  } else {
    res.writeHead(404);
    res.end("Not found");
  }
});

server.listen(PORT, "127.0.0.1", () => {
  log("Backend server running on port " + PORT);

  // Write HTA file to temp and launch it with mshta.exe
  const htaPath = path.join(os.tmpdir(), "thalamus-installer.hta");
  fs.writeFileSync(htaPath, HTA_CONTENT, "utf8");
  log("Launching installer UI...");

  // Launch HTA — this creates a real native Windows window
  const htaProc = spawn("mshta.exe", [htaPath], {
    detached: false,
    stdio: "ignore",
    windowsHide: false, // HTA manages its own window
  });

  htaProc.on("close", (code) => {
    log("Installer UI closed (code " + code + ")");
    // Give a moment for any final operations, then exit
    setTimeout(() => {
      server.close();
      process.exit(0);
    }, 2000);
  });

  htaProc.on("error", (err) => {
    log("HTA launch error: " + err.message);
    // Fallback: open browser if HTA not available
    exec(`start http://127.0.0.1:${PORT}`);
  });
});

// Keep process alive
process.on("SIGINT", () => { server.close(); process.exit(0); });
process.on("SIGTERM", () => { server.close(); process.exit(0); });