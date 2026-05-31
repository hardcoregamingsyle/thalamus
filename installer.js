/**
 * Thalamus Installer v3.0.0
 * - Starts a local HTTP server on port 7890
 * - Opens browser to show a beautiful UI for OS selection
 * - Installs QEMU, downloads selected ISOs, registers thalamus:// protocol
 * - Installs and starts the VM bridge
 */

const http = require("http");
const { exec, spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");
const https = require("https");

const PORT = 7890;
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
  if (progress.log.length > 200) progress.log.shift();
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
  { key: "windows-11", name: "Windows 11", version: "23H2", size: "~5.8GB", category: "windows", url: null, filename: null, note: "Download from Microsoft: microsoft.com/software-download/windows11", manualUrl: "https://www.microsoft.com/software-download/windows11" },
  { key: "windows-10", name: "Windows 10", version: "22H2", size: "~5.2GB", category: "windows", url: null, filename: null, note: "Download from Microsoft: microsoft.com/software-download/windows10", manualUrl: "https://www.microsoft.com/software-download/windows10" },
  { key: "macos-sequoia", name: "macOS 15 Sequoia", version: "15.0", size: "~14GB", category: "macos", url: null, filename: null, note: "Create from Mac App Store or archive.org", manualUrl: "https://archive.org/search?query=macos+sequoia+iso" },
  { key: "macos-sonoma", name: "macOS 14 Sonoma", version: "14.0", size: "~13GB", category: "macos", url: null, filename: null, note: "Create from Mac App Store or archive.org", manualUrl: "https://archive.org/search?query=macos+sonoma+iso" },
];

// Download a file with progress
function downloadFile(url, dest, onProgress) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest + ".tmp");
    let downloaded = 0;
    let total = 0;

    const doRequest = (url) => {
      const mod = url.startsWith("https") ? https : http;
      mod.get(url, (res) => {
        if (res.statusCode === 301 || res.statusCode === 302) {
          file.close();
          doRequest(res.headers.location);
          return;
        }
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode} for ${url}`));
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
  return new Promise((resolve, reject) => {
    const qemuInstaller = path.join(os.tmpdir(), "qemu-installer.exe");
    const qemuUrl = "https://qemu.weilnetz.de/w64/2024/qemu-w64-setup-20241119.exe";
    log("Downloading QEMU installer...");
    progress.step = "qemu-download";
    progress.message = "Downloading QEMU...";
    progress.percent = 5;

    downloadFile(qemuUrl, qemuInstaller, (dl, total) => {
      progress.percent = 5 + Math.floor((dl / total) * 15);
    }).then(() => {
      log("Installing QEMU silently...");
      progress.step = "qemu-install";
      progress.message = "Installing QEMU...";
      progress.percent = 20;
      exec(`"${qemuInstaller}" /S`, (err) => {
        if (err) {
          log("QEMU install warning: " + err.message + " (may already be installed)");
        } else {
          log("QEMU installed successfully.");
        }
        resolve();
      });
    }).catch(reject);
  });
}

// Register thalamus:// URI scheme
function registerUriScheme() {
  return new Promise((resolve) => {
    const regContent = `Windows Registry Editor Version 5.00

[HKEY_CURRENT_USER\\Software\\Classes\\thalamus]
@="URL:Thalamus Protocol"
"URL Protocol"=""

[HKEY_CURRENT_USER\\Software\\Classes\\thalamus\\shell]

[HKEY_CURRENT_USER\\Software\\Classes\\thalamus\\shell\\open]

[HKEY_CURRENT_USER\\Software\\Classes\\thalamus\\shell\\open\\command]
@="\\"${BRIDGE_EXE.replace(/\\/g, "\\\\")}\\""
`;
    const regFile = path.join(os.tmpdir(), "thalamus-protocol.reg");
    fs.writeFileSync(regFile, regContent);
    exec(`reg import "${regFile}"`, (err) => {
      if (err) log("Registry warning: " + err.message);
      else log("thalamus:// protocol registered.");
      resolve();
    });
  });
}

// Add bridge to Windows startup
function addToStartup() {
  return new Promise((resolve) => {
    const startupDir = path.join(os.homedir(), "AppData", "Roaming", "Microsoft", "Windows", "Start Menu", "Programs", "Startup");
    const shortcutVbs = `
Set oWS = WScript.CreateObject("WScript.Shell")
sLinkFile = "${path.join(startupDir, "Thalamus Bridge.lnk").replace(/\\/g, "\\\\")}"
Set oLink = oWS.CreateShortcut(sLinkFile)
oLink.TargetPath = "${BRIDGE_EXE.replace(/\\/g, "\\\\")}"
oLink.WindowStyle = 7
oLink.Save
`;
    const vbsFile = path.join(os.tmpdir(), "create-shortcut.vbs");
    fs.writeFileSync(vbsFile, startupVbs);
    exec(`cscript //nologo "${vbsFile}"`, (err) => {
      if (err) log("Startup shortcut warning: " + err.message);
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
      resolve();
      return;
    }

    log("Downloading VM bridge...");
    progress.step = "bridge-download";
    progress.message = "Downloading VM bridge...";
    progress.percent = 25;

    downloadFile(BRIDGE_URL, BRIDGE_EXE, (dl, total) => {
      progress.percent = 25 + Math.floor((dl / total) * 10);
    }).then(() => {
      log("Bridge downloaded to: " + BRIDGE_EXE);
      resolve();
    }).catch(reject);
  });
}

// Download selected ISOs
async function downloadISOs(selectedKeys) {
  const toDownload = ISO_OPTIONS.filter(iso => selectedKeys.includes(iso.key) && iso.url && iso.filename);
  let isoIndex = 0;
  for (const iso of toDownload) {
    isoIndex++;
    const dest = path.join(ISOS_DIR, iso.filename);
    if (fs.existsSync(dest)) {
      log(`${iso.name} already downloaded, skipping.`);
      continue;
    }
    log(`Downloading ${iso.name} (${iso.size})...`);
    progress.step = "iso-download";
    progress.message = `Downloading ${iso.name}...`;
    const basePercent = 40 + Math.floor((isoIndex - 1) / toDownload.length * 50);
    try {
      await downloadFile(iso.url, dest, (dl, total) => {
        const isoPercent = total > 0 ? Math.floor((dl / total) * (50 / toDownload.length)) : 0;
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
    log("Starting VM bridge...");
    const child = spawn(BRIDGE_EXE, [], {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    child.unref();
    log("Bridge started in background.");
    resolve(true);
  });
}

// Main install flow
async function runInstall(selectedISOs) {
  try {
    progress = { step: "starting", message: "Starting installation...", percent: 2, log: [], done: false, error: null };
    log("=== Thalamus Installer v3.0.0 ===");
    log("App directory: " + APP_DIR);

    await installQemu();
    await downloadBridge();

    progress.step = "registry";
    progress.message = "Registering thalamus:// protocol...";
    progress.percent = 36;
    await registerUriScheme();

    progress.step = "startup";
    progress.message = "Adding bridge to startup...";
    progress.percent = 38;
    await addToStartup();

    if (selectedISOs && selectedISOs.length > 0) {
      progress.step = "isos";
      progress.message = "Downloading OS images...";
      progress.percent = 40;
      await downloadISOs(selectedISOs);
    }

    progress.step = "bridge-start";
    progress.message = "Starting VM bridge...";
    progress.percent = 92;
    await startBridge();

    progress.step = "done";
    progress.message = "Installation complete! You can close this window.";
    progress.percent = 100;
    progress.done = true;
    log("=== Installation complete! ===");
    log("The VM bridge is now running in the background.");
    log("You can close this window and return to Thalamus.");
  } catch (err) {
    progress.error = err.message;
    progress.message = "Installation failed: " + err.message;
    log("ERROR: " + err.message);
  }
}

// HTML UI
const HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Thalamus Installer</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0a0a0f; color: #e2e8f0; min-height: 100vh; display: flex; flex-direction: column; align-items: center; justify-content: flex-start; padding: 32px 16px; }
  .container { width: 100%; max-width: 680px; }
  .header { display: flex; align-items: center; gap: 16px; margin-bottom: 32px; }
  .logo { width: 48px; height: 48px; background: linear-gradient(135deg, #6366f1, #8b5cf6); border-radius: 12px; display: flex; align-items: center; justify-content: center; font-size: 24px; }
  h1 { font-size: 24px; font-weight: 700; color: #f1f5f9; }
  .subtitle { font-size: 13px; color: #64748b; margin-top: 2px; }
  .card { background: #111827; border: 1px solid #1e293b; border-radius: 16px; padding: 24px; margin-bottom: 20px; }
  .card h2 { font-size: 15px; font-weight: 600; color: #f1f5f9; margin-bottom: 16px; display: flex; align-items: center; gap: 8px; }
  .iso-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
  .iso-item { background: #0f172a; border: 1px solid #1e293b; border-radius: 10px; padding: 12px; cursor: pointer; transition: all 0.15s; display: flex; align-items: flex-start; gap: 10px; }
  .iso-item:hover { border-color: #4f46e5; background: #1e1b4b20; }
  .iso-item.selected { border-color: #6366f1; background: #1e1b4b40; }
  .iso-item.manual { opacity: 0.7; cursor: default; }
  .iso-check { width: 18px; height: 18px; border: 2px solid #334155; border-radius: 4px; flex-shrink: 0; margin-top: 1px; display: flex; align-items: center; justify-content: center; transition: all 0.15s; }
  .iso-item.selected .iso-check { background: #6366f1; border-color: #6366f1; }
  .iso-check::after { content: '✓'; color: white; font-size: 11px; display: none; }
  .iso-item.selected .iso-check::after { display: block; }
  .iso-name { font-size: 13px; font-weight: 600; color: #e2e8f0; }
  .iso-meta { font-size: 11px; color: #64748b; margin-top: 2px; }
  .iso-badge { display: inline-block; font-size: 10px; padding: 1px 6px; border-radius: 4px; margin-top: 4px; }
  .badge-free { background: #052e16; color: #4ade80; border: 1px solid #166534; }
  .badge-manual { background: #1c1917; color: #a8a29e; border: 1px solid #44403c; }
  .category-label { font-size: 11px; font-weight: 700; color: #475569; text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 8px; margin-top: 16px; }
  .category-label:first-child { margin-top: 0; }
  .btn { display: inline-flex; align-items: center; gap: 8px; padding: 12px 24px; border-radius: 10px; font-size: 14px; font-weight: 600; cursor: pointer; border: none; transition: all 0.15s; }
  .btn-primary { background: #6366f1; color: white; width: 100%; justify-content: center; font-size: 15px; padding: 14px; }
  .btn-primary:hover { background: #4f46e5; }
  .btn-primary:disabled { background: #334155; color: #64748b; cursor: not-allowed; }
  .progress-bar { background: #1e293b; border-radius: 8px; height: 8px; overflow: hidden; margin: 12px 0; }
  .progress-fill { height: 100%; background: linear-gradient(90deg, #6366f1, #8b5cf6); border-radius: 8px; transition: width 0.3s ease; }
  .progress-text { font-size: 13px; color: #94a3b8; }
  .log-box { background: #0f172a; border: 1px solid #1e293b; border-radius: 8px; padding: 12px; max-height: 180px; overflow-y: auto; font-family: 'Consolas', 'Monaco', monospace; font-size: 11px; color: #64748b; line-height: 1.6; }
  .log-box .log-line { color: #94a3b8; }
  .log-box .log-line.error { color: #f87171; }
  .status-icon { font-size: 20px; }
  .done-card { text-align: center; padding: 32px; }
  .done-icon { font-size: 48px; margin-bottom: 16px; }
  .done-title { font-size: 20px; font-weight: 700; color: #4ade80; margin-bottom: 8px; }
  .done-sub { font-size: 14px; color: #64748b; }
  .step-list { list-style: none; space-y: 8px; }
  .step-list li { display: flex; align-items: center; gap: 10px; font-size: 13px; color: #94a3b8; padding: 6px 0; border-bottom: 1px solid #1e293b; }
  .step-list li:last-child { border-bottom: none; }
  .step-num { width: 22px; height: 22px; border-radius: 50%; background: #1e293b; color: #6366f1; font-size: 11px; font-weight: 700; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
  #install-section { display: none; }
  #select-section { display: block; }
</style>
</head>
<body>
<div class="container">
  <div class="header">
    <div class="logo">⚡</div>
    <div>
      <h1>Thalamus Installer</h1>
      <div class="subtitle">VM Bridge Setup — v3.0.0</div>
    </div>
  </div>

  <div id="select-section">
    <div class="card">
      <h2>🖥️ What gets installed</h2>
      <ul class="step-list">
        <li><span class="step-num">1</span>QEMU (VM engine) — installed silently</li>
        <li><span class="step-num">2</span>Thalamus VM Bridge — runs in background</li>
        <li><span class="step-num">3</span>thalamus:// protocol — one-click VM launch</li>
        <li><span class="step-num">4</span>Bridge added to Windows startup</li>
        <li><span class="step-num">5</span>Selected OS images downloaded</li>
      </ul>
    </div>

    <div class="card">
      <h2>📀 Select OS Images to Download</h2>
      <div id="iso-list"></div>
    </div>

    <button class="btn btn-primary" onclick="startInstall()">
      ⚡ Install Now
    </button>
  </div>

  <div id="install-section">
    <div class="card" id="progress-card">
      <h2><span class="status-icon" id="status-icon">⏳</span> <span id="status-title">Installing...</span></h2>
      <div class="progress-bar"><div class="progress-fill" id="progress-fill" style="width:0%"></div></div>
      <div class="progress-text" id="progress-text">Starting...</div>
    </div>

    <div class="card">
      <h2>📋 Log</h2>
      <div class="log-box" id="log-box"></div>
    </div>
  </div>
</div>

<script>
const ISO_OPTIONS = ${JSON.stringify(ISO_OPTIONS)};
let selected = new Set(["ubuntu-24", "alpine-3"]);

function renderISOs() {
  const categories = { linux: "Linux", android: "Android", windows: "Windows (Manual)", macos: "macOS (Manual)" };
  const grouped = {};
  ISO_OPTIONS.forEach(iso => {
    if (!grouped[iso.category]) grouped[iso.category] = [];
    grouped[iso.category].push(iso);
  });

  let html = "";
  for (const [cat, label] of Object.entries(categories)) {
    if (!grouped[cat]) continue;
    html += '<div class="category-label">' + label + '</div><div class="iso-grid">';
    for (const iso of grouped[cat]) {
      const isManual = !iso.url;
      const isSel = selected.has(iso.key);
      html += '<div class="iso-item' + (isSel ? ' selected' : '') + (isManual ? ' manual' : '') + '" ' + (isManual ? '' : 'onclick="toggleISO(\'' + iso.key + '\')"') + '>';
      html += '<div class="iso-check"></div>';
      html += '<div><div class="iso-name">' + iso.name + '</div>';
      html += '<div class="iso-meta">' + iso.version + ' · ' + iso.size + '</div>';
      if (isManual) {
        html += '<span class="iso-badge badge-manual">Manual download</span>';
        if (iso.manualUrl) html += ' <a href="' + iso.manualUrl + '" target="_blank" style="font-size:10px;color:#6366f1;">Get ISO ↗</a>';
      } else {
        html += '<span class="iso-badge badge-free">Free · Auto-download</span>';
      }
      if (iso.note) html += '<div class="iso-meta" style="margin-top:4px">' + iso.note + '</div>';
      html += '</div></div>';
    }
    html += '</div>';
  }
  document.getElementById("iso-list").innerHTML = html;
}

function toggleISO(key) {
  if (selected.has(key)) selected.delete(key);
  else selected.add(key);
  renderISOs();
}

function startInstall() {
  document.getElementById("select-section").style.display = "none";
  document.getElementById("install-section").style.display = "block";
  
  fetch("/install", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ isos: Array.from(selected) })
  });

  pollProgress();
}

function pollProgress() {
  fetch("/progress").then(r => r.json()).then(data => {
    document.getElementById("progress-fill").style.width = data.percent + "%";
    document.getElementById("progress-text").textContent = data.message;
    
    const logBox = document.getElementById("log-box");
    logBox.innerHTML = data.log.map(l => '<div class="log-line">' + escHtml(l) + '</div>').join("");
    logBox.scrollTop = logBox.scrollHeight;

    if (data.done) {
      document.getElementById("status-icon").textContent = "✅";
      document.getElementById("status-title").textContent = "Installation Complete!";
      document.getElementById("progress-card").innerHTML = '<div class="done-card"><div class="done-icon">✅</div><div class="done-title">Installation Complete!</div><div class="done-sub">The VM bridge is running in the background.<br>Return to Thalamus and click Boot OS.</div></div>';
    } else if (data.error) {
      document.getElementById("status-icon").textContent = "❌";
      document.getElementById("status-title").textContent = "Installation Failed";
    } else {
      setTimeout(pollProgress, 800);
    }
  }).catch(() => setTimeout(pollProgress, 1000));
}

function escHtml(s) {
  return s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
}

renderISOs();
</script>
</body>
</html>`;

// HTTP server
const server = http.createServer((req, res) => {
  if (req.method === "GET" && req.url === "/") {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(HTML);
  } else if (req.method === "GET" && req.url === "/progress") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(progress));
  } else if (req.method === "POST" && req.url === "/install") {
    let body = "";
    req.on("data", d => body += d);
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
  log("Thalamus Installer UI running at http://127.0.0.1:" + PORT);
  // Open browser
  exec(`start http://127.0.0.1:${PORT}`);
});

// Keep alive until done
const keepAlive = setInterval(() => {
  if (progress.done || progress.error) {
    clearInterval(keepAlive);
    // Keep server alive for 60s so user can read the result
    setTimeout(() => {
      server.close();
      process.exit(0);
    }, 60000);
  }
}, 2000);

// Handle exit
process.on("SIGINT", () => { server.close(); process.exit(0); });
process.on("SIGTERM", () => { server.close(); process.exit(0); });
