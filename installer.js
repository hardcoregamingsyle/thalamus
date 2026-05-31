/**
 * Thalamus Installer v4.3.0
 * Native Windows desktop UI via HTA (HTML Application)
 * - ISO data served via /isos HTTP endpoint (no inline HTML injection = no & encoding issues)
 * - HTA fetches ISO list via XHR on load
 * - No console window
 * - HTA JS uses IE-compatible JScript only
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

// ISO definitions — served via /isos endpoint, NOT embedded in HTA HTML
const ISO_OPTIONS = [
  { key: "ubuntu-24", name: "Ubuntu 24.04 LTS", version: "24.04", size: "5.7GB", category: "linux", url: "https://releases.ubuntu.com/24.04/ubuntu-24.04.2-desktop-amd64.iso", filename: "ubuntu-24.04.2-desktop-amd64.iso", note: "" },
  { key: "ubuntu-22", name: "Ubuntu 22.04 LTS", version: "22.04", size: "4.7GB", category: "linux", url: "https://releases.ubuntu.com/22.04/ubuntu-22.04.5-desktop-amd64.iso", filename: "ubuntu-22.04.5-desktop-amd64.iso", note: "" },
  { key: "debian-12", name: "Debian 12 Bookworm", version: "12.0", size: "3.7GB", category: "linux", url: "https://cdimage.debian.org/debian-cd/current/amd64/iso-dvd/debian-12.9.0-amd64-DVD-1.iso", filename: "debian-12.9.0-amd64-DVD-1.iso", note: "" },
  { key: "fedora-41", name: "Fedora 41", version: "41", size: "2.1GB", category: "linux", url: "https://download.fedoraproject.org/pub/fedora/linux/releases/41/Workstation/x86_64/iso/Fedora-Workstation-Live-x86_64-41-1.4.iso", filename: "Fedora-Workstation-Live-x86_64-41-1.4.iso", note: "" },
  { key: "alpine-3", name: "Alpine Linux 3.21", version: "3.21", size: "200MB", category: "linux", url: "https://dl-cdn.alpinelinux.org/alpine/v3.21/releases/x86_64/alpine-standard-3.21.0-x86_64.iso", filename: "alpine-standard-3.21.0-x86_64.iso", note: "" },
  { key: "kali-2024", name: "Kali Linux 2024", version: "2024.4", size: "4.1GB", category: "linux", url: "https://cdimage.kali.org/kali-2024.4/kali-linux-2024.4-installer-amd64.iso", filename: "kali-linux-2024.4-installer-amd64.iso", note: "" },
  { key: "android-14", name: "Android 14 x86_64", version: "14", size: "1.1GB", category: "android", url: "https://sourceforge.net/projects/android-x86/files/Release%209.0/android-x86_64-9.0-r2.iso/download", filename: "android-x86_64-9.0-r2.iso", note: "Android-x86 project" },
  { key: "windows-11", name: "Windows 11", version: "23H2", size: "5.8GB", category: "windows", url: "https://software-download.microsoft.com/download/Windows_InsiderPreview_Client_x64_en-us.iso", filename: "windows-11.iso", note: "Auto-downloads a Microsoft x64 ISO" },
  { key: "windows-10", name: "Windows 10", version: "22H2", size: "5.2GB", category: "windows", url: "https://software-download.microsoft.com/download/Windows_10_22H2.iso", filename: "windows-10.iso", note: "Auto-downloads a Microsoft x64 ISO" },
  { key: "macos-sequoia", name: "macOS 15 Sequoia", version: "15.0", size: "14GB", category: "macos", url: "https://archive.org/download/macos-sequoia-iso/macOS-Sequoia.iso", filename: "macos-sequoia.iso", note: "Auto-downloads ISO image" },
  { key: "macos-sonoma", name: "macOS 14 Sonoma", version: "14.0", size: "13GB", category: "macos", url: "https://archive.org/download/macos-sonoma-iso/macOS-Sonoma.iso", filename: "macos-sonoma.iso", note: "Auto-downloads ISO image" },
];

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
    downloadFile(qemuUrl, qemuInstaller, function(dl, tot) {
      progress.percent = 3 + Math.floor((dl / tot) * 17);
      progress.message = "Downloading QEMU: " + Math.round(dl / 1024 / 1024) + "MB / " + Math.round(tot / 1024 / 1024) + "MB";
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
    var launcherEscaped = BRIDGE_LAUNCHER.replace(/\\/g, "\\\\");
    var regContent = "Windows Registry Editor Version 5.00\r\n\r\n[HKEY_CURRENT_USER\\Software\\Classes\\thalamus]\r\n@=\"URL:Thalamus Protocol\"\r\n\"URL Protocol\"=\"\"\r\n\r\n[HKEY_CURRENT_USER\\Software\\Classes\\thalamus\\shell]\r\n\r\n[HKEY_CURRENT_USER\\Software\\Classes\\thalamus\\shell\\open]\r\n\r\n[HKEY_CURRENT_USER\\Software\\Classes\\thalamus\\shell\\open\\command]\r\n@=\"wscript.exe \\\"" + launcherEscaped + "\\\" \\\"%1\\\"\"\r\n";
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
    exec('reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run" /v "ThalamusBridge" /t REG_SZ /d "wscript.exe \\"' + BRIDGE_LAUNCHER + '\\"" /f', function(err) {
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
    downloadFile(BRIDGE_URL, BRIDGE_EXE, function(dl, tot) {
      progress.percent = 24 + Math.floor((dl / tot) * 10);
      progress.message = "Downloading bridge: " + Math.round(dl / 1024 / 1024) + "MB / " + Math.round(tot / 1024 / 1024) + "MB";
    }).then(function() {
      addLog("Bridge downloaded to: " + BRIDGE_EXE);
      progress.percent = 36;
      resolve();
    }).catch(reject);
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
  addLog("Hidden bridge launcher written to: " + BRIDGE_LAUNCHER);
  addLog("Bridge logs will be written to: " + BRIDGE_LOG);
}

async function downloadISOs(selectedKeys) {
  var toDownload = ISO_OPTIONS.filter(function(iso) { return selectedKeys.indexOf(iso.key) !== -1 && iso.url && iso.filename; });
  if (toDownload.length === 0) return;
  for (var i = 0; i < toDownload.length; i++) {
    var iso = toDownload[i];
    var dest = path.join(ISOS_DIR, iso.filename);
    if (fs.existsSync(dest)) { addLog(iso.name + " already downloaded, skipping."); continue; }
    addLog("Downloading " + iso.name + " (" + iso.size + ")...");
    progress.step = "iso-download";
    var basePercent = 42 + Math.floor((i / toDownload.length) * 50);
    var nextPercent = 42 + Math.floor(((i + 1) / toDownload.length) * 50);
    try {
      await downloadFile(iso.url, dest, function(dl, tot) {
        var isoPercent = tot > 0 ? Math.floor((dl / tot) * (nextPercent - basePercent)) : 0;
        progress.percent = basePercent + isoPercent;
        progress.message = "Downloading " + iso.name + ": " + Math.round(dl / 1024 / 1024) + "MB / " + Math.round(tot / 1024 / 1024) + "MB";
      });
      addLog(iso.name + " downloaded successfully.");
    } catch (err) {
      addLog("Warning: Failed to download " + iso.name + ": " + err.message);
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
    addLog("Bridge started.");
    resolve(true);
  });
}

async function runInstall(selectedISOs) {
  try {
    progress = { step: "starting", message: "Starting installation...", percent: 2, log: [], done: false, error: null };
    addLog("=== Thalamus Installer v4.3.0 ===");
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

// HTA content — NO inline data injection, ISO list fetched via XHR from /isos endpoint
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
  SCROLL="yes"
  INNERBORDER="no"
  SELECTION="no"
/>
<meta http-equiv="x-ua-compatible" content="ie=edge">
<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: Segoe UI, sans-serif; background: #0d1117; color: #e6edf3; height: 100vh; overflow-y: scroll; overflow-x: hidden; display: flex; flex-direction: column; scrollbar-face-color: #30363d; scrollbar-track-color: #0d1117; scrollbar-arrow-color: #8b949e; }
.titlebar { background: #161b22; border-bottom: 1px solid #21262d; padding: 12px 20px; display: flex; align-items: center; gap: 12px; flex-shrink: 0; }
.logo { width: 32px; height: 32px; background: #6366f1; border-radius: 8px; text-align: center; line-height: 32px; font-size: 18px; color: white; font-weight: bold; flex-shrink: 0; }
.app-title { font-size: 15px; font-weight: 700; color: #f0f6fc; }
.app-sub { font-size: 11px; color: #8b949e; margin-top: 1px; }
.content { flex: 1; overflow-y: auto; padding: 20px; }
.page { display: none; }
.page.active { display: block; }
.section-title { font-size: 12px; font-weight: 700; color: #8b949e; text-transform: uppercase; letter-spacing: 0.06em; margin-bottom: 12px; }
.card { background: #161b22; border: 1px solid #21262d; border-radius: 10px; padding: 16px; margin-bottom: 14px; }
.step-list { list-style: none; }
.step-list li { display: flex; align-items: center; gap: 10px; font-size: 12px; color: #8b949e; padding: 5px 0; border-bottom: 1px solid #21262d; }
.step-list li:last-child { border-bottom: none; }
.step-num { width: 20px; height: 20px; border-radius: 50%; background: #21262d; color: #6366f1; font-size: 10px; font-weight: 700; text-align: center; line-height: 20px; flex-shrink: 0; }
.iso-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.iso-item { background: #0d1117; border: 2px solid #21262d; border-radius: 8px; padding: 10px; cursor: pointer; }
.iso-item-sel { background: #1a1f3a; border: 2px solid #6366f1; border-radius: 8px; padding: 10px; cursor: pointer; }
.iso-item-manual { background: #0d1117; border: 2px solid #21262d; border-radius: 8px; padding: 10px; cursor: pointer; }
.iso-row { display: flex; align-items: flex-start; gap: 8px; }
.iso-chk { width: 14px; height: 14px; border: 2px solid #30363d; border-radius: 3px; flex-shrink: 0; margin-top: 2px; background: transparent; }
.iso-chk-sel { width: 14px; height: 14px; border: 2px solid #6366f1; border-radius: 3px; flex-shrink: 0; margin-top: 2px; background: #6366f1; }
.iso-name { font-size: 12px; font-weight: 600; color: #e6edf3; }
.iso-meta { font-size: 10px; color: #8b949e; margin-top: 2px; }
.badge-free { display: inline-block; font-size: 9px; padding: 1px 5px; border-radius: 3px; margin-top: 3px; background: #0d2818; color: #3fb950; border: 1px solid #1a4731; }
.badge-manual { display: inline-block; font-size: 9px; padding: 1px 5px; border-radius: 3px; margin-top: 3px; background: #1c1917; color: #8b949e; border: 1px solid #30363d; }
.cat-label { font-size: 10px; font-weight: 700; color: #6e7681; text-transform: uppercase; letter-spacing: 0.08em; margin: 12px 0 6px; }
.btn { padding: 10px 20px; border-radius: 8px; font-size: 13px; font-weight: 600; cursor: pointer; border: none; font-family: Segoe UI, sans-serif; }
.btn-primary { background: #6366f1; color: white; width: 100%; padding: 12px; font-size: 14px; }
.btn-secondary { background: #21262d; color: #e6edf3; border: 1px solid #30363d; }
.progress-wrap { margin: 10px 0; }
.progress-bar { background: #21262d; border-radius: 6px; height: 8px; overflow: hidden; }
.progress-fill { height: 100%; background: #6366f1; border-radius: 6px; }
.progress-label { font-size: 11px; color: #8b949e; margin-top: 6px; }
.log-box { background: #0d1117; border: 1px solid #21262d; border-radius: 6px; padding: 10px; height: 150px; overflow-y: auto; font-family: Consolas, monospace; font-size: 10px; color: #8b949e; line-height: 1.5; }
.done-wrap { text-align: center; padding: 32px 16px; }
.done-icon { font-size: 52px; margin-bottom: 12px; }
.done-title { font-size: 20px; font-weight: 700; color: #3fb950; margin-bottom: 8px; }
.done-sub { font-size: 12px; color: #8b949e; line-height: 1.7; }
.footer { padding: 12px 20px; border-top: 1px solid #21262d; display: flex; justify-content: space-between; align-items: center; flex-shrink: 0; background: #161b22; }
.footer-note { font-size: 11px; color: #6e7681; }
</style>
</head>
<body>
<div class="titlebar">
  <div class="logo">T</div>
  <div>
    <div class="app-title">Thalamus Installer</div>
    <div class="app-sub">VM Bridge Setup &mdash; v4.3.0</div>
  </div>
</div>

<div class="content">
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
      <div id="iso-list"><div style="color:#8b949e;font-size:12px">Loading OS list...</div></div>
    </div>
  </div>

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
  <span class="footer-note" id="footer-note">Select OS images above, then click Install</span>
  <div>
    <button class="btn btn-secondary" id="close-btn" style="display:none;margin-right:8px" onclick="window.close()">Close</button>
    <button class="btn btn-primary" id="install-btn" onclick="startInstall()">&#9889; Install Now</button>
  </div>
</div>

<script language="JScript">
var selected = {};
selected["ubuntu-24"] = true;
selected["alpine-3"] = true;

var ISO_DATA = [];

var CATEGORIES = [
  {key:"linux", label:"Linux"},
  {key:"android", label:"Android"},
  {key:"windows", label:"Windows"},
  {key:"macos", label:"macOS"}
];

function escHtml(s) {
  return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}

function renderISOs() {
  var grouped = {};
  var i, iso;
  for (i = 0; i < ISO_DATA.length; i++) {
    iso = ISO_DATA[i];
    if (!grouped[iso.category]) grouped[iso.category] = [];
    grouped[iso.category].push(iso);
  }

  var html = "";
  var c, cat, isos, j, isManual, isSel, itemCls, chkCls;
  for (c = 0; c < CATEGORIES.length; c++) {
    cat = CATEGORIES[c];
    isos = grouped[cat.key];
    if (!isos || isos.length === 0) continue;
    html += "<div class=\"cat-label\">" + cat.label + "</div><div class=\"iso-grid\">";
    for (j = 0; j < isos.length; j++) {
      iso = isos[j];
      isManual = !iso.url;
      isSel = !!selected[iso.key];
      itemCls = isManual ? "iso-item-manual" : (isSel ? "iso-item-sel" : "iso-item");
      chkCls = isSel ? "iso-chk-sel" : "iso-chk";
      html += "<div class=\"" + itemCls + "\" id=\"iso-" + iso.key + "\"";
      if (!isManual) html += " onclick=\"toggleISO('" + iso.key + "')\"";
      html += ">";
      html += "<div class=\"iso-row\">";
      html += "<div class=\"" + chkCls + "\" id=\"chk-" + iso.key + "\"></div>";
      html += "<div>";
      html += "<div class=\"iso-name\">" + escHtml(iso.name) + "</div>";
      html += "<div class=\"iso-meta\">" + escHtml(iso.version) + " - " + escHtml(iso.size) + "</div>";
      if (isManual) {
        html += "<span class=\"badge-manual\">Manual</span>";
      } else {
        html += "<span class=\"badge-free\">Auto-download</span>";
      }
      if (iso.note) html += "<div class=\"iso-meta\" style=\"margin-top:3px\">" + escHtml(iso.note) + "</div>";
      html += "</div></div></div>";
    }
    html += "</div>";
  }
  document.getElementById("iso-list").innerHTML = html;
}

function toggleISO(key) {
  if (selected[key]) {
    delete selected[key];
  } else {
    selected[key] = true;
  }
  var el = document.getElementById("iso-" + key);
  var chk = document.getElementById("chk-" + key);
  if (el) {
    if (selected[key]) {
      el.className = "iso-item-sel";
      if (chk) chk.className = "iso-chk-sel";
    } else {
      el.className = "iso-item";
      if (chk) chk.className = "iso-chk";
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
          document.getElementById("iso-list").innerHTML = "<div style=\"color:#f85149;font-size:12px\">Failed to load OS list: " + e.message + "</div>";
        }
      } else {
        setTimeout(loadISOs, 500);
      }
    }
  };
  xhr.send();
}

function startInstall() {
  document.getElementById("page-select").className = "page";
  document.getElementById("page-install").className = "page active";
  document.getElementById("install-btn").style.display = "none";
  document.getElementById("footer-note").innerText = "Installation in progress...";

  var keys = [];
  var k;
  for (k in selected) {
    if (selected.hasOwnProperty(k)) keys.push(k);
  }

  var body = "{\"isos\":[";
  for (var i = 0; i < keys.length; i++) {
    body += "\"" + keys[i] + "\"";
    if (i < keys.length - 1) body += ",";
  }
  body += "]}";

  var xhr = new XMLHttpRequest();
  xhr.open("POST", "http://127.0.0.1:7891/install", true);
  xhr.setRequestHeader("Content-Type", "application/json");
  xhr.onreadystatechange = function() {
    if (xhr.readyState === 4) {
      if (xhr.status === 200) {
        pollProgress();
      } else {
        document.getElementById("install-title").innerText = "Installation Request Failed";
        document.getElementById("prog-label").innerText = "Could not start installer service. HTTP " + xhr.status;
        document.getElementById("footer-note").innerText = "Install did not start.";
        document.getElementById("close-btn").style.display = "inline-block";
      }
    }
  };
  try {
    xhr.send(body);
  } catch(e) {
    document.getElementById("install-title").innerText = "Installation Request Failed";
    document.getElementById("prog-label").innerText = "Could not send install request: " + e.message;
    document.getElementById("footer-note").innerText = "Install did not start.";
    document.getElementById("close-btn").style.display = "inline-block";
  }
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
          html += "<div>" + escHtml(line) + "</div>";
        }
        logBox.innerHTML = html;
        logBox.scrollTop = logBox.scrollHeight;

        if (data.done) {
          document.getElementById("install-title").innerText = "Installation Complete!";
          document.getElementById("page-install").className = "page";
          document.getElementById("page-done").className = "page active";
          document.getElementById("close-btn").style.display = "inline-block";
          document.getElementById("footer-note").innerText = "Done! VM bridge is running.";
        } else if (data.error) {
          document.getElementById("install-title").innerText = "Installation Failed";
          document.getElementById("prog-label").innerText = "Error: " + data.error;
          document.getElementById("close-btn").style.display = "inline-block";
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

try {
  window.resizeTo(720, 640);
  window.moveTo(Math.floor((screen.width - 720) / 2), Math.floor((screen.height - 640) / 2));
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
    // Serve ISO list as JSON — no HTML encoding issues
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
