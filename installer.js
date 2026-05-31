/**
 * Thalamus Installer v4.2.0
 * Native Windows desktop UI via HTA (HTML Application)
 * - No console window (no console.log calls)
 * - HTA JS uses IE-compatible JScript only (no const/let/arrow/template literals)
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
var progress = {
  step: "idle",
  message: "Ready to install",
  percent: 0,
  log: [],
  done: false,
  error: null,
};

function addLog(msg) {
  // No console.log — avoids console window
  progress.log.push(msg);
  if (progress.log.length > 300) progress.log.shift();
}

// ISO definitions — hardcoded as plain JS object (no JSON.stringify injection into HTA)
const ISO_OPTIONS = [
  { key: "ubuntu-24", name: "Ubuntu 24.04 LTS", version: "24.04", size: "5.7GB", category: "linux", url: "https://releases.ubuntu.com/24.04/ubuntu-24.04.2-desktop-amd64.iso", filename: "ubuntu-24.04.2-desktop-amd64.iso" },
  { key: "ubuntu-22", name: "Ubuntu 22.04 LTS", version: "22.04", size: "4.7GB", category: "linux", url: "https://releases.ubuntu.com/22.04/ubuntu-22.04.5-desktop-amd64.iso", filename: "ubuntu-22.04.5-desktop-amd64.iso" },
  { key: "debian-12", name: "Debian 12 Bookworm", version: "12.0", size: "3.7GB", category: "linux", url: "https://cdimage.debian.org/debian-cd/current/amd64/iso-dvd/debian-12.9.0-amd64-DVD-1.iso", filename: "debian-12.9.0-amd64-DVD-1.iso" },
  { key: "fedora-41", name: "Fedora 41", version: "41", size: "2.1GB", category: "linux", url: "https://download.fedoraproject.org/pub/fedora/linux/releases/41/Workstation/x86_64/iso/Fedora-Workstation-Live-x86_64-41-1.4.iso", filename: "Fedora-Workstation-Live-x86_64-41-1.4.iso" },
  { key: "alpine-3", name: "Alpine Linux 3.21", version: "3.21", size: "200MB", category: "linux", url: "https://dl-cdn.alpinelinux.org/alpine/v3.21/releases/x86_64/alpine-standard-3.21.0-x86_64.iso", filename: "alpine-standard-3.21.0-x86_64.iso" },
  { key: "kali-2024", name: "Kali Linux 2024", version: "2024.4", size: "4.1GB", category: "linux", url: "https://cdimage.kali.org/kali-2024.4/kali-linux-2024.4-installer-amd64.iso", filename: "kali-linux-2024.4-installer-amd64.iso" },
  { key: "android-14", name: "Android 14 x86_64", version: "14", size: "1.1GB", category: "android", url: "https://sourceforge.net/projects/android-x86/files/Release%209.0/android-x86_64-9.0-r2.iso/download", filename: "android-x86_64-9.0-r2.iso" },
  { key: "windows-11", name: "Windows 11", version: "23H2", size: "5.8GB", category: "windows", url: null, filename: null, note: "Download from Microsoft", manualUrl: "https://www.microsoft.com/software-download/windows11" },
  { key: "windows-10", name: "Windows 10", version: "22H2", size: "5.2GB", category: "windows", url: null, filename: null, note: "Download from Microsoft", manualUrl: "https://www.microsoft.com/software-download/windows10" },
  { key: "macos-sequoia", name: "macOS 15 Sequoia", version: "15.0", size: "14GB", category: "macos", url: null, filename: null, note: "Create from Mac App Store or archive.org", manualUrl: "https://archive.org/search?query=macos+sequoia+iso" },
  { key: "macos-sonoma", name: "macOS 14 Sonoma", version: "14.0", size: "13GB", category: "macos", url: null, filename: null, note: "Create from Mac App Store or archive.org", manualUrl: "https://archive.org/search?query=macos+sonoma+iso" },
];

// Build ISO data as IE-safe JS variable declarations for injection into HTA
// Each ISO becomes a plain object literal — no JSON.stringify, no template literals
function buildIsoDataScript() {
  var lines = ["var ISO_DATA = ["];
  for (var i = 0; i < ISO_OPTIONS.length; i++) {
    var iso = ISO_OPTIONS[i];
    var urlVal = iso.url ? ('"' + iso.url + '"') : "null";
    var filenameVal = iso.filename ? ('"' + iso.filename + '"') : "null";
    var noteVal = iso.note ? ('"' + iso.note.replace(/"/g, '\\"') + '"') : '""';
    var manualUrlVal = iso.manualUrl ? ('"' + iso.manualUrl + '"') : "null";
    lines.push('  {key:"' + iso.key + '",name:"' + iso.name + '",version:"' + iso.version + '",size:"' + iso.size + '",category:"' + iso.category + '",url:' + urlVal + ',filename:' + filenameVal + ',note:' + noteVal + ',manualUrl:' + manualUrlVal + '}' + (i < ISO_OPTIONS.length - 1 ? "," : ""));
  }
  lines.push("];");
  return lines.join("\n");
}

// Download a file with progress + redirect following
function downloadFile(url, dest, onProgress) {
  return new Promise(function(resolve, reject) {
    var file = fs.createWriteStream(dest + ".tmp");
    var downloaded = 0;
    var total = 0;
    var redirectCount = 0;

    function doRequest(reqUrl) {
      if (redirectCount > 10) { reject(new Error("Too many redirects")); return; }
      var mod = reqUrl.startsWith("https") ? https : http;
      mod.get(reqUrl, function(res) {
        if (res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 303 || res.statusCode === 307 || res.statusCode === 308) {
          redirectCount++;
          file.close();
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
            fs.renameSync(dest + ".tmp", dest);
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
      addLog("QEMU already installed, skipping.");
      progress.percent = 22;
      resolve();
      return;
    }

    var qemuInstaller = path.join(os.tmpdir(), "qemu-installer.exe");
    var qemuUrl = "https://qemu.weilnetz.de/w64/2024/qemu-w64-setup-20241119.exe";
    addLog("Downloading QEMU installer (~130MB)...");
    progress.step = "qemu-download";
    progress.message = "Downloading QEMU VM engine...";
    progress.percent = 3;

    downloadFile(qemuUrl, qemuInstaller, function(dl, total) {
      progress.percent = 3 + Math.floor((dl / total) * 17);
      progress.message = "Downloading QEMU: " + Math.round(dl / 1024 / 1024) + "MB / " + Math.round(total / 1024 / 1024) + "MB";
    }).then(function() {
      addLog("Installing QEMU silently...");
      progress.step = "qemu-install";
      progress.message = "Installing QEMU...";
      progress.percent = 20;
      exec('"' + qemuInstaller + '" /S', { timeout: 120000 }, function(err) {
        if (err) addLog("QEMU install note: " + err.message);
        else addLog("QEMU installed successfully.");
        progress.percent = 22;
        resolve();
      });
    }).catch(function(err) {
      addLog("QEMU download warning: " + err.message + " - continuing anyway");
      progress.percent = 22;
      resolve();
    });
  });
}

function registerUriScheme() {
  return new Promise(function(resolve) {
    var bridgeEscaped = BRIDGE_EXE.replace(/\\/g, "\\\\");
    var regContent = "Windows Registry Editor Version 5.00\r\n\r\n[HKEY_CURRENT_USER\\Software\\Classes\\thalamus]\r\n@=\"URL:Thalamus Protocol\"\r\n\"URL Protocol\"=\"\"\r\n\r\n[HKEY_CURRENT_USER\\Software\\Classes\\thalamus\\shell]\r\n\r\n[HKEY_CURRENT_USER\\Software\\Classes\\thalamus\\shell\\open]\r\n\r\n[HKEY_CURRENT_USER\\Software\\Classes\\thalamus\\shell\\open\\command]\r\n@=\"\\\"" + bridgeEscaped + "\\\"\"\r\n";
    var regFile = path.join(os.tmpdir(), "thalamus-protocol.reg");
    fs.writeFileSync(regFile, regContent, "utf8");
    exec('reg import "' + regFile + '"', function(err) {
      if (err) addLog("Registry note: " + err.message);
      else addLog("thalamus:// protocol registered.");
      resolve();
    });
  });
}

function addToStartup() {
  return new Promise(function(resolve) {
    var bridgeEscaped = BRIDGE_EXE.replace(/\\/g, "\\\\");
    exec('reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run" /v "ThalamusBridge" /t REG_SZ /d "\\"' + bridgeEscaped + '\\"" /f', function(err) {
      if (err) addLog("Startup registry note: " + err.message);
      else addLog("Bridge added to Windows startup.");
      resolve();
    });
  });
}

function downloadBridge() {
  return new Promise(function(resolve, reject) {
    if (!fs.existsSync(APP_DIR)) fs.mkdirSync(APP_DIR, { recursive: true });
    if (!fs.existsSync(ISOS_DIR)) fs.mkdirSync(ISOS_DIR, { recursive: true });

    if (fs.existsSync(BRIDGE_EXE)) {
      addLog("Bridge already downloaded.");
      progress.percent = 36;
      resolve();
      return;
    }

    addLog("Downloading VM bridge...");
    progress.step = "bridge-download";
    progress.message = "Downloading VM bridge...";
    progress.percent = 24;

    downloadFile(BRIDGE_URL, BRIDGE_EXE, function(dl, total) {
      progress.percent = 24 + Math.floor((dl / total) * 10);
      progress.message = "Downloading bridge: " + Math.round(dl / 1024 / 1024) + "MB / " + Math.round(total / 1024 / 1024) + "MB";
    }).then(function() {
      addLog("Bridge downloaded to: " + BRIDGE_EXE);
      progress.percent = 36;
      resolve();
    }).catch(reject);
  });
}

async function downloadISOs(selectedKeys) {
  var toDownload = ISO_OPTIONS.filter(function(iso) { return selectedKeys.indexOf(iso.key) !== -1 && iso.url && iso.filename; });
  if (toDownload.length === 0) return;

  for (var i = 0; i < toDownload.length; i++) {
    var iso = toDownload[i];
    var dest = path.join(ISOS_DIR, iso.filename);
    if (fs.existsSync(dest)) {
      addLog(iso.name + " already downloaded, skipping.");
      continue;
    }
    addLog("Downloading " + iso.name + " (" + iso.size + ")...");
    progress.step = "iso-download";
    var basePercent = 42 + Math.floor((i / toDownload.length) * 50);
    var nextPercent = 42 + Math.floor(((i + 1) / toDownload.length) * 50);
    try {
      await downloadFile(iso.url, dest, function(dl, total) {
        var isoPercent = total > 0 ? Math.floor((dl / total) * (nextPercent - basePercent)) : 0;
        progress.percent = basePercent + isoPercent;
        progress.message = "Downloading " + iso.name + ": " + Math.round(dl / 1024 / 1024) + "MB / " + Math.round(total / 1024 / 1024) + "MB";
      });
      addLog(iso.name + " downloaded successfully.");
    } catch (err) {
      addLog("Warning: Failed to download " + iso.name + ": " + err.message);
    }
  }
}

function startBridge() {
  return new Promise(function(resolve) {
    if (!fs.existsSync(BRIDGE_EXE)) {
      addLog("Bridge exe not found, skipping start.");
      resolve(false);
      return;
    }
    addLog("Starting VM bridge in background...");
    var child = spawn(BRIDGE_EXE, [], {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    child.unref();
    addLog("Bridge started.");
    resolve(true);
  });
}

async function runInstall(selectedISOs) {
  try {
    progress = { step: "starting", message: "Starting installation...", percent: 2, log: [], done: false, error: null };
    addLog("=== Thalamus Installer v4.2.0 ===");
    addLog("Install directory: " + APP_DIR);

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
    addLog("=== Installation complete! ===");
    addLog("VM bridge is running in the background.");
    addLog("Return to Thalamus and click Boot OS.");
  } catch (err) {
    progress.error = err.message;
    progress.message = "Installation failed: " + err.message;
    addLog("ERROR: " + err.message);
  }
}

// Build the HTA content — ISO data injected as IE-safe JS variable
function buildHtaContent() {
  var isoDataScript = buildIsoDataScript();

  return '<html>\n<head>\n<title>Thalamus Installer</title>\n<HTA:APPLICATION\n  ID="ThalamusInstaller"\n  APPLICATIONNAME="Thalamus Installer"\n  CAPTION="yes"\n  SHOWINTASKBAR="yes"\n  SINGLEINSTANCE="yes"\n  WINDOWSTATE="normal"\n  MINIMIZEBUTTON="yes"\n  MAXIMIZEBUTTON="no"\n  SCROLL="no"\n  INNERBORDER="no"\n  SELECTION="no"\n/>\n<meta http-equiv="x-ua-compatible" content="ie=edge">\n<style>\n* { box-sizing: border-box; margin: 0; padding: 0; }\nbody { font-family: \'Segoe UI\', sans-serif; background: #0d1117; color: #e6edf3; height: 100vh; overflow: hidden; display: flex; flex-direction: column; }\n.titlebar { background: #161b22; border-bottom: 1px solid #21262d; padding: 12px 20px; display: flex; align-items: center; gap: 12px; flex-shrink: 0; }\n.logo { width: 32px; height: 32px; background: #6366f1; border-radius: 8px; display: flex; align-items: center; justify-content: center; font-size: 18px; color: white; font-weight: bold; }\n.app-title { font-size: 15px; font-weight: 700; color: #f0f6fc; }\n.app-sub { font-size: 11px; color: #8b949e; margin-top: 1px; }\n.content { flex: 1; overflow-y: auto; padding: 20px; }\n.page { display: none; }\n.page.active { display: block; }\n.section-title { font-size: 12px; font-weight: 700; color: #8b949e; text-transform: uppercase; letter-spacing: 0.06em; margin-bottom: 12px; }\n.card { background: #161b22; border: 1px solid #21262d; border-radius: 10px; padding: 16px; margin-bottom: 14px; }\n.step-list { list-style: none; }\n.step-list li { display: flex; align-items: center; gap: 10px; font-size: 12px; color: #8b949e; padding: 5px 0; border-bottom: 1px solid #21262d; }\n.step-list li:last-child { border-bottom: none; }\n.step-num { width: 20px; height: 20px; border-radius: 50%; background: #21262d; color: #6366f1; font-size: 10px; font-weight: 700; text-align: center; line-height: 20px; flex-shrink: 0; }\n.iso-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }\n.iso-item { background: #0d1117; border: 2px solid #21262d; border-radius: 8px; padding: 10px; cursor: pointer; }\n.iso-item:hover { border-color: #6366f1; }\n.iso-item.sel { border-color: #6366f1; background: #1a1f3a; }\n.iso-item.manual { opacity: 0.6; cursor: default; }\n.iso-row { display: flex; align-items: flex-start; gap: 8px; }\n.iso-chk { width: 14px; height: 14px; border: 2px solid #30363d; border-radius: 3px; flex-shrink: 0; margin-top: 2px; background: transparent; }\n.iso-item.sel .iso-chk { background: #6366f1; border-color: #6366f1; }\n.iso-name { font-size: 12px; font-weight: 600; color: #e6edf3; }\n.iso-meta { font-size: 10px; color: #8b949e; margin-top: 2px; }\n.badge { display: inline-block; font-size: 9px; padding: 1px 5px; border-radius: 3px; margin-top: 3px; }\n.badge-free { background: #0d2818; color: #3fb950; border: 1px solid #1a4731; }\n.badge-manual { background: #1c1917; color: #8b949e; border: 1px solid #30363d; }\n.cat-label { font-size: 10px; font-weight: 700; color: #6e7681; text-transform: uppercase; letter-spacing: 0.08em; margin: 12px 0 6px; }\n.btn { padding: 10px 20px; border-radius: 8px; font-size: 13px; font-weight: 600; cursor: pointer; border: none; font-family: \'Segoe UI\', sans-serif; }\n.btn-primary { background: #6366f1; color: white; width: 100%; padding: 12px; font-size: 14px; }\n.btn-secondary { background: #21262d; color: #e6edf3; border: 1px solid #30363d; }\n.progress-wrap { margin: 10px 0; }\n.progress-bar { background: #21262d; border-radius: 6px; height: 8px; overflow: hidden; }\n.progress-fill { height: 100%; background: #6366f1; border-radius: 6px; }\n.progress-label { font-size: 11px; color: #8b949e; margin-top: 6px; }\n.log-box { background: #0d1117; border: 1px solid #21262d; border-radius: 6px; padding: 10px; height: 150px; overflow-y: auto; font-family: Consolas, monospace; font-size: 10px; color: #8b949e; line-height: 1.5; }\n.done-wrap { text-align: center; padding: 32px 16px; }\n.done-icon { font-size: 52px; margin-bottom: 12px; }\n.done-title { font-size: 20px; font-weight: 700; color: #3fb950; margin-bottom: 8px; }\n.done-sub { font-size: 12px; color: #8b949e; line-height: 1.7; }\n.footer { padding: 12px 20px; border-top: 1px solid #21262d; display: flex; justify-content: space-between; align-items: center; flex-shrink: 0; background: #161b22; }\n.footer-note { font-size: 11px; color: #6e7681; }\n</style>\n</head>\n<body>\n<div class="titlebar">\n  <div class="logo">T</div>\n  <div>\n    <div class="app-title">Thalamus Installer</div>\n    <div class="app-sub">VM Bridge Setup &mdash; v4.2.0</div>\n  </div>\n</div>\n\n<div class="content">\n  <div class="page active" id="page-select">\n    <div class="card">\n      <div class="section-title">What gets installed</div>\n      <ul class="step-list">\n        <li><span class="step-num">1</span>QEMU VM engine &mdash; installed silently</li>\n        <li><span class="step-num">2</span>Thalamus VM Bridge &mdash; runs in background</li>\n        <li><span class="step-num">3</span>thalamus:// protocol &mdash; one-click VM launch</li>\n        <li><span class="step-num">4</span>Bridge added to Windows startup</li>\n        <li><span class="step-num">5</span>Selected OS images downloaded automatically</li>\n      </ul>\n    </div>\n    <div class="card">\n      <div class="section-title">Select OS Images to Download</div>\n      <div id="iso-list"></div>\n    </div>\n  </div>\n\n  <div class="page" id="page-install">\n    <div class="card">\n      <div class="section-title" id="install-title">Installing...</div>\n      <div class="progress-wrap">\n        <div class="progress-bar"><div class="progress-fill" id="prog-fill" style="width:0%"></div></div>\n        <div class="progress-label" id="prog-label">Starting...</div>\n      </div>\n    </div>\n    <div class="card">\n      <div class="section-title">Installation Log</div>\n      <div class="log-box" id="log-box"></div>\n    </div>\n  </div>\n\n  <div class="page" id="page-done">\n    <div class="card">\n      <div class="done-wrap">\n        <div class="done-icon">&#10003;</div>\n        <div class="done-title">Installation Complete!</div>\n        <div class="done-sub">The VM bridge is running in the background.<br>Return to Thalamus and click Boot OS to launch a VM.</div>\n      </div>\n    </div>\n  </div>\n</div>\n\n<div class="footer">\n  <span class="footer-note" id="footer-note">Select OS images above, then click Install</span>\n  <div>\n    <button class="btn btn-secondary" id="close-btn" style="display:none;margin-right:8px" onclick="window.close()">Close</button>\n    <button class="btn btn-primary" id="install-btn" onclick="startInstall()">&#9889; Install Now</button>\n  </div>\n</div>\n\n<script language="JScript">\n' + isoDataScript + '\n\nvar selected = {};\nselected["ubuntu-24"] = true;\nselected["alpine-3"] = true;\n\nvar CATEGORIES = [\n  {key:"linux", label:"Linux"},\n  {key:"android", label:"Android"},\n  {key:"windows", label:"Windows (Manual Download)"},\n  {key:"macos", label:"macOS (Manual Download)"}\n];\n\nfunction escHtml(s) {\n  return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");\n}\n\nfunction renderISOs() {\n  var grouped = {};\n  var i, iso;\n  for (i = 0; i < ISO_DATA.length; i++) {\n    iso = ISO_DATA[i];\n    if (!grouped[iso.category]) grouped[iso.category] = [];\n    grouped[iso.category].push(iso);\n  }\n\n  var html = "";\n  var c, cat, isos, j, isManual, isSel, cls;\n  for (c = 0; c < CATEGORIES.length; c++) {\n    cat = CATEGORIES[c];\n    isos = grouped[cat.key];\n    if (!isos || isos.length === 0) continue;\n    html += \'<div class="cat-label">\' + cat.label + \'</div><div class="iso-grid">\';\n    for (j = 0; j < isos.length; j++) {\n      iso = isos[j];\n      isManual = !iso.url;\n      isSel = !!selected[iso.key];\n      cls = "iso-item" + (isSel ? " sel" : "") + (isManual ? " manual" : "");\n      html += \'<div class="\' + cls + \'" id="iso-\' + iso.key + \'"\';\n      if (!isManual) html += \' onclick="toggleISO(\\\'\'+ iso.key +\'\\\')"\';\n      html += \'>\';\n      html += \'<div class="iso-row">\';\n      html += \'<div class="iso-chk" id="chk-\' + iso.key + \'"></div>\';\n      html += \'<div>\';\n      html += \'<div class="iso-name">\' + escHtml(iso.name) + \'</div>\';\n      html += \'<div class="iso-meta">\' + escHtml(iso.version) + \' &middot; \' + escHtml(iso.size) + \'</div>\';\n      if (isManual) {\n        html += \'<span class="badge badge-manual">Manual</span>\';\n      } else {\n        html += \'<span class="badge badge-free">Free &middot; Auto-download</span>\';\n      }\n      if (iso.note) html += \'<div class="iso-meta" style="margin-top:3px">\' + escHtml(iso.note) + \'</div>\';\n      html += \'</div></div></div>\';\n    }\n    html += \'</div>\';\n  }\n  document.getElementById("iso-list").innerHTML = html;\n}\n\nfunction toggleISO(key) {\n  if (selected[key]) {\n    delete selected[key];\n  } else {\n    selected[key] = true;\n  }\n  var el = document.getElementById("iso-" + key);\n  var chk = document.getElementById("chk-" + key);\n  if (el) {\n    if (selected[key]) {\n      el.className = el.className + " sel";\n      if (chk) chk.style.background = "#6366f1";\n    } else {\n      el.className = el.className.replace(" sel", "");\n      if (chk) chk.style.background = "transparent";\n    }\n  }\n}\n\nfunction startInstall() {\n  document.getElementById("page-select").className = "page";\n  document.getElementById("page-install").className = "page active";\n  document.getElementById("install-btn").style.display = "none";\n  document.getElementById("footer-note").innerText = "Installation in progress...";\n\n  var keys = [];\n  var k;\n  for (k in selected) {\n    if (selected.hasOwnProperty(k)) keys.push(k);\n  }\n\n  var xhr = new XMLHttpRequest();\n  xhr.open("POST", "http://127.0.0.1:7891/install", true);\n  xhr.setRequestHeader("Content-Type", "application/json");\n  xhr.send(\'{"isos":\' + JSON.stringify(keys) + \'}\');\n\n  pollProgress();\n}\n\nfunction pollProgress() {\n  var xhr = new XMLHttpRequest();\n  xhr.open("GET", "http://127.0.0.1:7891/progress", true);\n  xhr.onreadystatechange = function() {\n    if (xhr.readyState === 4 && xhr.status === 200) {\n      try {\n        var data = JSON.parse(xhr.responseText);\n        document.getElementById("prog-fill").style.width = data.percent + "%";\n        document.getElementById("prog-label").innerText = data.message || "";\n\n        var logBox = document.getElementById("log-box");\n        var html = "";\n        var i, line;\n        for (i = 0; i < data.log.length; i++) {\n          line = data.log[i];\n          html += \'<div>\' + escHtml(line) + \'</div>\';\n        }\n        logBox.innerHTML = html;\n        logBox.scrollTop = logBox.scrollHeight;\n\n        if (data.done) {\n          document.getElementById("install-title").innerText = "Installation Complete!";\n          document.getElementById("page-install").className = "page";\n          document.getElementById("page-done").className = "page active";\n          document.getElementById("close-btn").style.display = "inline-block";\n          document.getElementById("footer-note").innerText = "Done! VM bridge is running.";\n        } else if (data.error) {\n          document.getElementById("install-title").innerText = "Installation Failed";\n          document.getElementById("prog-label").innerText = "Error: " + data.error;\n          document.getElementById("close-btn").style.display = "inline-block";\n        } else {\n          setTimeout(pollProgress, 700);\n        }\n      } catch(e) {\n        setTimeout(pollProgress, 1000);\n      }\n    } else if (xhr.readyState === 4) {\n      setTimeout(pollProgress, 1000);\n    }\n  };\n  xhr.send();\n}\n\ntry {\n  window.resizeTo(720, 640);\n  window.moveTo(Math.floor((screen.width - 720) / 2), Math.floor((screen.height - 640) / 2));\n} catch(e) {}\n\nrenderISOs();\n</script>\n</body>\n</html>';
}

// ── HTTP server ───────────────────────────────────────────────────────────────
const server = http.createServer(function(req, res) {
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
  // Write HTA file and launch it
  var htaPath = path.join(os.tmpdir(), "thalamus-installer.hta");
  var htaContent = buildHtaContent();
  fs.writeFileSync(htaPath, htaContent, "utf8");

  // Launch HTA — creates a real native Windows window, no browser needed
  var htaProc = spawn("mshta.exe", [htaPath], {
    detached: false,
    stdio: "ignore",
    windowsHide: false,
  });

  htaProc.on("close", function() {
    setTimeout(function() {
      server.close();
      process.exit(0);
    }, 2000);
  });

  htaProc.on("error", function(err) {
    // HTA not available — fallback to browser
    exec("start http://127.0.0.1:" + PORT);
  });
});

process.on("SIGINT", function() { server.close(); process.exit(0); });
process.on("SIGTERM", function() { server.close(); process.exit(0); });