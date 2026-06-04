/**
 * Thalamus Installer v7.0.0
 * Roblox-style installer — downloads everything, creates shortcuts, registers with Windows
 * Browser-based UI — opens a real browser window with modern HTML/JS UI
 */

"use strict";
const http = require("http");
const { exec, spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");
const https = require("https");

const PORT = 7891;
const INSTALLER_VERSION = "7.0.1";

// ── URLs ──────────────────────────────────────────────────────────────────────
const DESKTOP_APP_URL = "https://github.com/hardcoregamingsyle/thalamus/releases/download/desktop-v1.0.0/Thalamus-Desktop-v1.0.0-win64.zip";
const BRIDGE_URL = "https://github.com/hardcoregamingsyle/thalamus/releases/download/vm-bridge-v3.5.0/thalamus-vm-bridge-v3.5.0.exe";
const BRIDGE_VERSION = "3.5.0";
const QEMU_URL = "https://qemu.weilnetz.de/w64/2024/qemu-w64-setup-20241119.exe";
const ARIA2_URL = "https://github.com/aria2/aria2/releases/download/release-1.37.0/aria2-1.37.0-win-64bit-build1.zip";
const VNC_PORTABLE_URL = "https://github.com/nicowillis/tightvnc-portable/releases/download/v2.8.85/tvnviewer.exe";

// ── Default install dir (can be changed by user) ──────────────────────────────
var INSTALL_DIR = process.env.LOCALAPPDATA
  ? path.join(process.env.LOCALAPPDATA, "Thalamus")
  : path.join(os.homedir(), "AppData", "Local", "Thalamus");

// Paths derived from INSTALL_DIR (set after user chooses)
function getPaths(installDir) {
  return {
    appDir: installDir,
    isoDir: path.join(installDir, "isos"),
    diskDir: path.join(installDir, "disks"),
    bridgeExe: path.join(installDir, "thalamus-vm-bridge.exe"),
    bridgeLauncher: path.join(installDir, "launch-bridge-hidden.vbs"),
    bridgeLog: path.join(installDir, "bridge.log"),
    bridgeVersion: path.join(installDir, "bridge.version"),
    desktopExe: path.join(installDir, "Thalamus.exe"),
    desktopResources: path.join(installDir, "resources.neu"),
    aria2Exe: path.join(installDir, "aria2c.exe"),
    vncExe: path.join(installDir, "tvnviewer.exe"),
    qemuExe: "C:\\Program Files\\qemu\\qemu-system-x86_64.exe",
    uninstaller: path.join(installDir, "uninstall.exe"),
    installInfo: path.join(installDir, "install.json"),
  };
}

// ── State ─────────────────────────────────────────────────────────────────────
var progress = {
  step: "idle",
  message: "Ready to install",
  percent: 0,
  log: [],
  done: false,
  error: null,
  installDir: INSTALL_DIR,
};

function addLog(msg) {
  console.log(msg);
  progress.log.push(msg);
  if (progress.log.length > 500) progress.log.shift();
}

// ── OS definitions ────────────────────────────────────────────────────────────
var ISO_OPTIONS = [
  { key: "windows-11", name: "Windows 11 Pro", version: "24H2 Preactivated", size: "4.28 GB", category: "windows", gdriveId: "1-6IAC0S3s8sYLnABPJQizgnRK1jJc3q2", filename: "windows-11.iso", note: "Preactivated — no product key needed" },
  { key: "windows-10", name: "Windows 10 Pro", version: "22H2 Preactivated", size: "4.5 GB", category: "windows", gdriveId: "1QCB98ov7mAn-HOPUg1T0iWQ6RMYq8K6w", filename: "windows-10.iso", note: "Preactivated — no product key needed" },
  { key: "macos-18", name: "macOS 15 Sequoia", version: "15.2", size: "~14 GB", category: "macos", torrentUrl: "https://data.pyenb.network/macOS/isos/torrents/macOS%20Sequoia%2015.2_24C101.iso.torrent", filename: "macos-18.iso", note: "Downloaded via aria2 automatically" },
  { key: "macos-17", name: "macOS 14 Sonoma", version: "14.7", size: "~13 GB", category: "macos", torrentUrl: "https://data.pyenb.network/macOS/isos/torrents/macOS%20Sonoma%2014.7_23H124.iso.torrent", filename: "macos-17.iso", note: "Downloaded via aria2 automatically" },
  { key: "macos-16", name: "macOS 13 Ventura", version: "13.7.1", size: "~12 GB", category: "macos", torrentUrl: "https://data.pyenb.network/macOS/isos/torrents/macOS%20Ventura%2013.7.1_22H221.iso.torrent", filename: "macos-16.iso", note: "Downloaded via aria2 automatically" },
  { key: "macos-15", name: "macOS 12 Monterey", version: "12.7.6", size: "~12 GB", category: "macos", torrentUrl: "https://data.pyenb.network/macOS/isos/torrents/macOS%20Monterey%2012.7.6_21H1320.iso.torrent", filename: "macos-15.iso", note: "Downloaded via aria2 automatically" },
  { key: "macos-14", name: "macOS 11 Big Sur", version: "11.7.10", size: "~12 GB", category: "macos", torrentUrl: "https://data.pyenb.network/macOS/isos/torrents/macOS%20Big%20Sur%2011.7.10_20G1427.iso.torrent", filename: "macos-14.iso", note: "Downloaded via aria2 automatically" },
  { key: "android-14", name: "Android 14 x86_64", version: "9.0-r2", size: "921 MB", category: "android", url: "https://sourceforge.net/projects/android-x86/files/Release%209.0/android-x86_64-9.0-r2.iso/download", filename: "android-14.iso", note: "Android-x86 project" },
  { key: "android-13", name: "Android 13 x86_64", version: "8.1-r6", size: "900 MB", category: "android", url: "https://sourceforge.net/projects/android-x86/files/Release%208.1/android-x86_64-8.1-r6.iso/download", filename: "android-13.iso", note: "Android-x86 project" },
  { key: "ubuntu-24", name: "Ubuntu 24.04 LTS", version: "24.04", size: "5.7 GB", category: "linux", url: "https://releases.ubuntu.com/24.04/ubuntu-24.04.2-desktop-amd64.iso", filename: "ubuntu-24.iso", note: "" },
  { key: "debian-12", name: "Debian 12 Bookworm", version: "12.0", size: "3.7 GB", category: "linux", url: "https://cdimage.debian.org/debian-cd/current/amd64/iso-dvd/debian-12.9.0-amd64-DVD-1.iso", filename: "debian-12.iso", note: "" },
  { key: "kali-2024", name: "Kali Linux 2024", version: "2024.4", size: "4.1 GB", category: "linux", url: "https://cdimage.kali.org/kali-2024.4/kali-linux-2024.4-installer-amd64.iso", filename: "kali-2024.iso", note: "" },
];

// ── Download helper ───────────────────────────────────────────────────────────
function downloadFile(url, dest, onProgress) {
  return new Promise(function(resolve, reject) {
    var redirectCount = 0;
    function simpleFetch(reqUrl) {
      var file = fs.createWriteStream(dest + ".tmp");
      var downloaded = 0;
      var total = 0;
      var rCount = 0;
      function doReq(u) {
        if (rCount > 15) { reject(new Error("Too many redirects")); return; }
        var mod = u.startsWith("https") ? https : http;
        mod.get(u, function(res) {
          if (res.statusCode >= 301 && res.statusCode <= 308 && res.headers.location) {
            rCount++; doReq(res.headers.location); return;
          }
          if (res.statusCode !== 200) { reject(new Error("HTTP " + res.statusCode + " for " + u)); return; }
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
      doReq(reqUrl);
    }
    simpleFetch(url);
  });
}

// ── Scan and rename existing ISOs ─────────────────────────────────────────────
function scanAndRenameExistingISOs(isoDir) {
  if (!fs.existsSync(isoDir)) return;
  var files = fs.readdirSync(isoDir);
  // Clean up .aria2 leftover files
  files.filter(function(f) { return f.endsWith(".aria2"); }).forEach(function(f) {
    try { fs.unlinkSync(path.join(isoDir, f)); } catch(e) {}
  });
  var isoFiles = files.filter(function(f) { return f.toLowerCase().endsWith(".iso"); });
  var patterns = [
    { pattern: /windows.?11/i, filename: "windows-11.iso" },
    { pattern: /windows.?10/i, filename: "windows-10.iso" },
    { pattern: /sequoia|macos.?15|24C101/i, filename: "macos-18.iso" },
    { pattern: /sonoma|macos.?14|23H/i, filename: "macos-17.iso" },
    { pattern: /ventura|macos.?13|22H/i, filename: "macos-16.iso" },
    { pattern: /monterey|macos.?12|21H/i, filename: "macos-15.iso" },
    { pattern: /big.?sur|macos.?11|20G/i, filename: "macos-14.iso" },
    { pattern: /android.?14|android.?x86.?9/i, filename: "android-14.iso" },
    { pattern: /android.?13|android.?x86.?8/i, filename: "android-13.iso" },
    { pattern: /ubuntu.?24/i, filename: "ubuntu-24.iso" },
    { pattern: /debian.?12/i, filename: "debian-12.iso" },
    { pattern: /kali.?2024/i, filename: "kali-2024.iso" },
  ];
  isoFiles.forEach(function(f) {
    var fullPath = path.join(isoDir, f);
    for (var i = 0; i < patterns.length; i++) {
      var p = patterns[i];
      if (p.pattern.test(f)) {
        var expectedPath = path.join(isoDir, p.filename);
        if (f !== p.filename && !fs.existsSync(expectedPath)) {
          try {
            fs.renameSync(fullPath, expectedPath);
            addLog("Renamed: " + f + " → " + p.filename);
          } catch(e) {
            try { fs.copyFileSync(fullPath, expectedPath); addLog("Copied: " + f + " → " + p.filename); } catch(e2) {}
          }
        }
        break;
      }
    }
  });
}

// ── Create desktop shortcut ───────────────────────────────────────────────────
function createDesktopShortcut(installDir) {
  return new Promise(function(resolve) {
    var desktopExe = path.join(installDir, "Thalamus.exe");
    var desktopPath = path.join(os.homedir(), "Desktop", "Thalamus AI.lnk");
    var vbsContent = [
      'Set oWS = WScript.CreateObject("WScript.Shell")',
      'sLinkFile = "' + desktopPath.replace(/\\/g, "\\\\") + '"',
      'Set oLink = oWS.CreateShortcut(sLinkFile)',
      'oLink.TargetPath = "' + desktopExe.replace(/\\/g, "\\\\") + '"',
      'oLink.WorkingDirectory = "' + installDir.replace(/\\/g, "\\\\") + '"',
      'oLink.Description = "Thalamus AI — World\'s First L4.5 Agent"',
      'oLink.IconLocation = "' + desktopExe.replace(/\\/g, "\\\\") + ',0"',
      'oLink.Save',
    ].join("\r\n");
    var vbsFile = path.join(os.tmpdir(), "create-shortcut.vbs");
    fs.writeFileSync(vbsFile, vbsContent, "utf8");
    exec('wscript.exe "' + vbsFile + '"', { windowsHide: true }, function(err) {
      if (err) addLog("Shortcut note: " + err.message);
      else addLog("Desktop shortcut created: Thalamus AI.lnk");
      resolve();
    });
  });
}

// ── Create Start Menu shortcut ────────────────────────────────────────────────
function createStartMenuShortcut(installDir) {
  return new Promise(function(resolve) {
    var desktopExe = path.join(installDir, "Thalamus.exe");
    var startMenuDir = path.join(os.homedir(), "AppData", "Roaming", "Microsoft", "Windows", "Start Menu", "Programs", "Thalamus AI");
    try { fs.mkdirSync(startMenuDir, { recursive: true }); } catch(e) {}
    var shortcutPath = path.join(startMenuDir, "Thalamus AI.lnk");
    var vbsContent = [
      'Set oWS = WScript.CreateObject("WScript.Shell")',
      'sLinkFile = "' + shortcutPath.replace(/\\/g, "\\\\") + '"',
      'Set oLink = oWS.CreateShortcut(sLinkFile)',
      'oLink.TargetPath = "' + desktopExe.replace(/\\/g, "\\\\") + '"',
      'oLink.WorkingDirectory = "' + installDir.replace(/\\/g, "\\\\") + '"',
      'oLink.Description = "Thalamus AI — World\'s First L4.5 Agent"',
      'oLink.IconLocation = "' + desktopExe.replace(/\\/g, "\\\\") + ',0"',
      'oLink.Save',
    ].join("\r\n");
    var vbsFile = path.join(os.tmpdir(), "create-startmenu.vbs");
    fs.writeFileSync(vbsFile, vbsContent, "utf8");
    exec('wscript.exe "' + vbsFile + '"', { windowsHide: true }, function(err) {
      if (err) addLog("Start menu note: " + err.message);
      else addLog("Start menu shortcut created.");
      resolve();
    });
  });
}

// ── Register with Windows Add/Remove Programs ─────────────────────────────────
function registerWithWindows(installDir) {
  return new Promise(function(resolve) {
    var desktopExe = path.join(installDir, "Thalamus.exe");
    var uninstallerPath = path.join(installDir, "uninstall.bat");
    // Create uninstaller batch file
    var uninstallContent = [
      '@echo off',
      'echo Uninstalling Thalamus AI...',
      'taskkill /f /im Thalamus.exe /t 2>nul',
      'taskkill /f /im thalamus-vm-bridge.exe /t 2>nul',
      'schtasks /delete /tn "ThalamusBridge" /f 2>nul',
      'reg delete "HKCU\\Software\\Classes\\thalamus" /f 2>nul',
      'reg delete "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run" /v "ThalamusBridge" /f 2>nul',
      'reg delete "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\ThalamusAI" /f 2>nul',
      'del /f /q "' + path.join(os.homedir(), "Desktop", "Thalamus AI.lnk") + '" 2>nul',
      'rmdir /s /q "' + path.join(os.homedir(), "AppData", "Roaming", "Microsoft", "Windows", "Start Menu", "Programs", "Thalamus AI") + '" 2>nul',
      'rmdir /s /q "' + installDir + '" 2>nul',
      'echo Thalamus AI has been uninstalled.',
      'pause',
    ].join("\r\n");
    fs.writeFileSync(uninstallerPath, uninstallContent, "utf8");

    // Register in Add/Remove Programs
    var regCmd = [
      'reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\ThalamusAI"',
      '/v "DisplayName" /t REG_SZ /d "Thalamus AI" /f',
    ].join(" ");
    exec(regCmd, { windowsHide: true }, function() {
      exec('reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\ThalamusAI" /v "DisplayVersion" /t REG_SZ /d "1.0.0" /f', { windowsHide: true }, function() {
        exec('reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\ThalamusAI" /v "Publisher" /t REG_SZ /d "Aphantic Corporations" /f', { windowsHide: true }, function() {
          exec('reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\ThalamusAI" /v "UninstallString" /t REG_SZ /d "' + uninstallerPath + '" /f', { windowsHide: true }, function() {
            exec('reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\ThalamusAI" /v "DisplayIcon" /t REG_SZ /d "' + desktopExe + '" /f', { windowsHide: true }, function() {
              exec('reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\ThalamusAI" /v "InstallLocation" /t REG_SZ /d "' + installDir + '" /f', { windowsHide: true }, function() {
                addLog("Registered with Windows (Add/Remove Programs).");
                resolve();
              });
            });
          });
        });
      });
    });
  });
}

// ── Write bridge launcher VBS ─────────────────────────────────────────────────
function writeBridgeLauncher(paths) {
  if (!fs.existsSync(paths.appDir)) fs.mkdirSync(paths.appDir, { recursive: true });
  var bridge = paths.bridgeExe.replace(/"/g, '""');
  var log = paths.bridgeLog.replace(/"/g, '""');
  var content = [
    'Set shell = CreateObject("WScript.Shell")',
    'cmd = "cmd.exe /c """ & "' + bridge + '" & """ >> """ & "' + log + '" & """ 2>&1"',
    'shell.Run cmd, 0, False',
  ].join("\r\n");
  fs.writeFileSync(paths.bridgeLauncher, content, "utf8");
  addLog("Bridge launcher written.");
}

// ── Register thalamus:// URI scheme ──────────────────────────────────────────
function registerUriScheme(paths) {
  return new Promise(function(resolve) {
    var launcherEscaped = paths.bridgeLauncher.replace(/\\/g, "\\\\");
    var regContent = "Windows Registry Editor Version 5.00\r\n\r\n[HKEY_CURRENT_USER\\Software\\Classes\\thalamus]\r\n@=\"URL:Thalamus Protocol\"\r\n\"URL Protocol\"=\"\"\r\n\r\n[HKEY_CURRENT_USER\\Software\\Classes\\thalamus\\shell]\r\n\r\n[HKEY_CURRENT_USER\\Software\\Classes\\thalamus\\shell\\open]\r\n\r\n[HKEY_CURRENT_USER\\Software\\Classes\\thalamus\\shell\\open\\command]\r\n@=\"wscript.exe \\\"" + launcherEscaped + "\\\" \\\"%1\\\"\"\r\n";
    var regFile = path.join(os.tmpdir(), "thalamus-protocol.reg");
    fs.writeFileSync(regFile, regContent, "utf8");
    exec('reg import "' + regFile + '"', { windowsHide: true }, function(err) {
      if (err) addLog("Registry note: " + err.message);
      else addLog("thalamus:// protocol registered.");
      resolve();
    });
  });
}

// ── Add bridge to startup ─────────────────────────────────────────────────────
function addToStartup(paths) {
  return new Promise(function(resolve) {
    var taskCmd = 'schtasks /create /tn "ThalamusBridge" /tr "wscript.exe \\"' + paths.bridgeLauncher + '\\"" /sc onlogon /rl limited /f';
    exec(taskCmd, { windowsHide: true }, function(err) {
      if (err) {
        exec('reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run" /v "ThalamusBridge" /t REG_SZ /d "wscript.exe \\"' + paths.bridgeLauncher + '\\"" /f', { windowsHide: true }, function(err2) {
          if (err2) addLog("Startup note: " + err2.message);
          else addLog("Bridge added to startup (registry).");
          resolve();
        });
      } else {
        addLog("Bridge added to startup (Task Scheduler).");
        resolve();
      }
    });
  });
}

// ── Install QEMU ──────────────────────────────────────────────────────────────
function installQemu() {
  return new Promise(function(resolve) {
    var qemuPaths = [
      "C:\\Program Files\\qemu\\qemu-system-x86_64.exe",
      "C:\\Program Files (x86)\\qemu\\qemu-system-x86_64.exe",
    ];
    if (qemuPaths.some(function(p) { return fs.existsSync(p); })) {
      addLog("QEMU already installed.");
      resolve(); return;
    }
    var qemuInstaller = path.join(os.tmpdir(), "qemu-installer.exe");
    addLog("Downloading QEMU (~130 MB)...");
    progress.message = "Downloading QEMU VM engine...";
    downloadFile(QEMU_URL, qemuInstaller, function(dl, tot) {
      progress.percent = 5 + Math.floor((dl / tot) * 15);
      progress.message = "Downloading QEMU: " + Math.round(dl / 1024 / 1024) + " MB / " + Math.round(tot / 1024 / 1024) + " MB";
    }).then(function() {
      addLog("Installing QEMU silently...");
      progress.message = "Installing QEMU...";
      exec('"' + qemuInstaller + '" /S', { timeout: 180000, windowsHide: true }, function(err) {
        if (err) addLog("QEMU install note: " + err.message);
        else addLog("QEMU installed.");
        resolve();
      });
    }).catch(function(err) {
      addLog("QEMU download warning: " + err.message);
      resolve();
    });
  });
}

// ── Download bridge ───────────────────────────────────────────────────────────
function downloadBridge(paths) {
  return new Promise(function(resolve, reject) {
    if (!fs.existsSync(paths.appDir)) fs.mkdirSync(paths.appDir, { recursive: true });
    if (!fs.existsSync(paths.isoDir)) fs.mkdirSync(paths.isoDir, { recursive: true });
    if (!fs.existsSync(paths.diskDir)) fs.mkdirSync(paths.diskDir, { recursive: true });

    var currentVersion = fs.existsSync(paths.bridgeVersion) ? fs.readFileSync(paths.bridgeVersion, "utf8").trim() : "0";
    if (fs.existsSync(paths.bridgeExe) && currentVersion === BRIDGE_VERSION) {
      addLog("Bridge v" + BRIDGE_VERSION + " already installed.");
      resolve(); return;
    }
    if (fs.existsSync(paths.bridgeExe) && currentVersion !== BRIDGE_VERSION) {
      addLog("Updating bridge from v" + currentVersion + " to v" + BRIDGE_VERSION + "...");
      try { fs.unlinkSync(paths.bridgeExe); } catch(e) {}
    }
    addLog("Downloading VM bridge...");
    progress.message = "Downloading VM bridge...";
    downloadFile(BRIDGE_URL, paths.bridgeExe, function(dl, tot) {
      progress.message = "Downloading bridge: " + Math.round(dl / 1024 / 1024) + " MB / " + Math.round(tot / 1024 / 1024) + " MB";
    }).then(function() {
      try { fs.writeFileSync(paths.bridgeVersion, BRIDGE_VERSION, "utf8"); } catch(e) {}
      addLog("Bridge v" + BRIDGE_VERSION + " installed.");
      resolve();
    }).catch(reject);
  });
}

// ── Download desktop app ──────────────────────────────────────────────────────
function downloadDesktopApp(paths) {
  return new Promise(function(resolve, reject) {
    // Check if already installed
    if (fs.existsSync(paths.desktopExe) && fs.existsSync(paths.desktopResources)) {
      addLog("Thalamus desktop app already installed.");
      resolve(); return;
    }
    var zipPath = path.join(os.tmpdir(), "thalamus-desktop.zip");
    addLog("Downloading Thalamus desktop app...");
    progress.message = "Downloading Thalamus app...";
    downloadFile(DESKTOP_APP_URL, zipPath, function(dl, tot) {
      progress.message = "Downloading app: " + Math.round(dl / 1024 / 1024) + " MB / " + Math.round(tot / 1024 / 1024) + " MB";
    }).then(function() {
      addLog("Extracting Thalamus app...");
      progress.message = "Extracting app...";
      // Extract zip using PowerShell
      var psCmd = 'Expand-Archive -Path "' + zipPath + '" -DestinationPath "' + paths.appDir + '" -Force';
      exec('powershell -Command "' + psCmd + '"', { windowsHide: true, timeout: 60000 }, function(err) {
        if (err) {
          addLog("PowerShell extract failed: " + err.message + " — trying alternative");
          // Try using built-in Windows zip extraction
          exec('powershell -Command "Add-Type -AssemblyName System.IO.Compression.FileSystem; [System.IO.Compression.ZipFile]::ExtractToDirectory(\'' + zipPath + '\', \'' + paths.appDir + '\')"', { windowsHide: true, timeout: 60000 }, function(err2) {
            if (err2) addLog("Extract note: " + err2.message);
            else addLog("Thalamus app extracted.");
            resolve();
          });
        } else {
          addLog("Thalamus app extracted.");
          resolve();
        }
      });
    }).catch(reject);
  });
}

// ── Download VNC viewer ───────────────────────────────────────────────────────
function downloadVNC(paths) {
  return new Promise(function(resolve) {
    if (fs.existsSync(paths.vncExe)) { addLog("VNC viewer already installed."); resolve(); return; }
    addLog("Downloading VNC viewer...");
    progress.message = "Downloading VNC viewer...";
    downloadFile(VNC_PORTABLE_URL, paths.vncExe, null).then(function() {
      addLog("VNC viewer installed.");
      resolve();
    }).catch(function(e) {
      addLog("VNC download note: " + e.message + " (non-critical)");
      resolve();
    });
  });
}

// ── Download aria2 ────────────────────────────────────────────────────────────
function ensureAria2(paths) {
  return new Promise(function(resolve) {
    if (fs.existsSync(paths.aria2Exe)) { resolve(true); return; }
    addLog("Downloading aria2 download manager...");
    var zipPath = path.join(os.tmpdir(), "aria2.zip");
    downloadFile(ARIA2_URL, zipPath, null).then(function() {
      var ps = 'Expand-Archive -Path "' + zipPath + '" -DestinationPath "' + os.tmpdir() + '\\aria2tmp" -Force; ' +
               'Get-ChildItem "' + os.tmpdir() + '\\aria2tmp" -Recurse -Filter "aria2c.exe" | ' +
               'Copy-Item -Destination "' + paths.aria2Exe + '"';
      exec('powershell -Command "' + ps + '"', { windowsHide: true, timeout: 30000 }, function(err) {
        if (err || !fs.existsSync(paths.aria2Exe)) {
          addLog("aria2 setup failed — torrent downloads unavailable");
          resolve(false);
        } else {
          addLog("aria2 ready.");
          resolve(true);
        }
      });
    }).catch(function() { resolve(false); });
  });
}

// ── Download ISO via torrent ──────────────────────────────────────────────────
function downloadViaTorrent(iso, paths, aria2Ready) {
  return new Promise(function(resolve) {
    var dest = path.join(paths.isoDir, iso.filename);
    if (fs.existsSync(dest)) {
      var stat = fs.statSync(dest);
      addLog(iso.name + " already installed (" + Math.round(stat.size / 1024 / 1024) + " MB). Skipping.");
      resolve(); return;
    }
    if (!aria2Ready || !fs.existsSync(paths.aria2Exe)) {
      addLog("SKIP (no aria2): " + iso.name + " — download torrent manually: " + iso.torrentUrl);
      resolve(); return;
    }
    addLog("Downloading " + iso.name + " via torrent...");
    progress.message = "Downloading " + iso.name + " via torrent...";
    var torrentFile = path.join(paths.appDir, iso.filename.replace(/\.iso$/, ".torrent"));
    downloadFile(iso.torrentUrl, torrentFile, null).then(function() {
      var cmd = '"' + paths.aria2Exe + '" --dir="' + paths.isoDir + '" --seed-time=0 --max-connection-per-server=4 --split=4 --max-overall-download-limit=50M "' + torrentFile + '"';
      exec(cmd, { windowsHide: true, timeout: 7200000 }, function(err) {
        if (err) {
          addLog("Warning: aria2 torrent failed for " + iso.name + ": " + err.message);
          addLog("You can download manually: " + iso.torrentUrl);
        } else {
          scanAndRenameExistingISOs(paths.isoDir);
          if (fs.existsSync(dest)) {
            addLog(iso.name + " downloaded successfully.");
          } else {
            addLog(iso.name + " download completed (check isos folder).");
          }
        }
        resolve();
      });
    }).catch(function(e) {
      addLog("Torrent file download failed for " + iso.name + ": " + e.message);
      resolve();
    });
  });
}

// ── Download ISO via direct URL ───────────────────────────────────────────────
function downloadFromGDrive(iso, paths, aria2Ready) {
  return new Promise(function(resolve) {
    var dest = path.join(paths.isoDir, iso.filename);
    if (fs.existsSync(dest)) {
      var stat = fs.statSync(dest);
      addLog(iso.name + " already installed (" + Math.round(stat.size / 1024 / 1024) + " MB). Skipping.");
      resolve(); return;
    }
    if (!aria2Ready || !fs.existsSync(paths.aria2Exe)) {
      addLog("Downloading " + iso.name + " via HTTP...");
      progress.message = "Downloading " + iso.name + "...";
      var url = "https://drive.google.com/uc?export=download&id=" + iso.gdriveId + "&confirm=t";
      downloadFile(url, dest, function(dl, tot) {
        if (tot > 0) progress.message = "Downloading " + iso.name + ": " + Math.round(dl / 1024 / 1024) + " MB / " + Math.round(tot / 1024 / 1024) + " MB";
      }).then(function() {
        addLog(iso.name + " downloaded.");
        resolve();
      }).catch(function(e) {
        addLog("Download failed for " + iso.name + ": " + e.message);
        resolve();
      });
      return;
    }
    var url = "https://drive.google.com/uc?export=download&id=" + iso.gdriveId + "&confirm=t";
    addLog("Downloading " + iso.name + " via aria2 (Google Drive)...");
    progress.message = "Downloading " + iso.name + "...";
    var cmd = '"' + paths.aria2Exe + '" --dir="' + paths.isoDir + '" --out="' + iso.filename + '" --max-connection-per-server=4 --split=4 --max-overall-download-limit=50M --header="Cookie: download_warning_' + iso.gdriveId + '=t" "' + url + '"';
    exec(cmd, { windowsHide: true, timeout: 7200000 }, function(err) {
      if (err) {
        addLog("aria2 GDrive failed for " + iso.name + ": " + err.message + " — trying HTTP fallback");
        downloadFile(url, dest, function(dl, tot) {
          if (tot > 0) progress.message = "Downloading " + iso.name + ": " + Math.round(dl / 1024 / 1024) + " MB / " + Math.round(tot / 1024 / 1024) + " MB";
        }).then(function() {
          addLog(iso.name + " downloaded.");
          resolve();
        }).catch(function(e2) {
          addLog("Download failed for " + iso.name + ": " + e2.message);
          resolve();
        });
      } else {
        addLog(iso.name + " downloaded.");
        resolve();
      }
    });
  });
}

// ── Download ISOs ─────────────────────────────────────────────────────────────
async function downloadISOs(selectedKeys, paths) {
  addLog("Scanning for existing OS images...");
  scanAndRenameExistingISOs(paths.isoDir);

  var aria2Ready = await ensureAria2(paths);

  for (var i = 0; i < selectedKeys.length; i++) {
    var key = selectedKeys[i];
    var iso = ISO_OPTIONS.find(function(o) { return o.key === key; });
    if (!iso) continue;

    var dest = path.join(paths.isoDir, iso.filename);
    if (fs.existsSync(dest)) {
      var stat = fs.statSync(dest);
      addLog(iso.name + " already installed (" + Math.round(stat.size / 1024 / 1024) + " MB). Skipping.");
      continue;
    }

    if (iso.torrentUrl) {
      await downloadViaTorrent(iso, paths, aria2Ready);
    } else if (iso.gdriveId) {
      await downloadFromGDrive(iso, paths, aria2Ready);
    } else if (iso.url) {
      addLog("Downloading " + iso.name + " (" + iso.size + ")...");
      progress.message = "Downloading " + iso.name + "...";
      await downloadFile(iso.url, dest, function(dl, tot) {
        if (tot > 0) progress.message = "Downloading " + iso.name + ": " + Math.round(dl / 1024 / 1024) + " MB / " + Math.round(tot / 1024 / 1024) + " MB";
      }).catch(function(e) { addLog("Download failed: " + e.message); });
    }
  }
}

// ── Start bridge ──────────────────────────────────────────────────────────────
function startBridge(paths) {
  return new Promise(function(resolve) {
    if (process.platform !== "win32") { resolve(false); return; }
    if (!fs.existsSync(paths.bridgeExe)) { addLog("Bridge exe not found."); resolve(false); return; }
    addLog("Starting VM bridge...");
    try {
      writeBridgeLauncher(paths);
      var child = spawn("wscript.exe", ["//B", "//Nologo", paths.bridgeLauncher], {
        detached: true, stdio: "ignore", windowsHide: true,
      });
      child.unref();
    } catch(err) {
      var out = fs.openSync(paths.bridgeLog, "a");
      var direct = spawn(paths.bridgeExe, [], {
        detached: true, stdio: ["ignore", out, out], windowsHide: true,
      });
      direct.unref();
    }
    // Wait for bridge to be ready
    var attempts = 0;
    var maxAttempts = 20;
    function checkBridge() {
      attempts++;
      var net = require("net");
      var client = new net.Socket();
      client.setTimeout(800);
      client.connect(5900, "127.0.0.1", function() {
        client.destroy();
        addLog("VM bridge is ready! (took " + attempts + "s)");
        resolve(true);
      });
      client.on("error", function() {
        client.destroy();
        if (attempts < maxAttempts) setTimeout(checkBridge, 1000);
        else { addLog("Bridge started (may take a moment to connect)."); resolve(false); }
      });
      client.on("timeout", function() {
        client.destroy();
        if (attempts < maxAttempts) setTimeout(checkBridge, 1000);
        else { addLog("Bridge started (may take a moment to connect)."); resolve(false); }
      });
    }
    setTimeout(checkBridge, 1500);
  });
}

// ── Save install info ─────────────────────────────────────────────────────────
function saveInstallInfo(paths) {
  var info = {
    version: "1.0.0",
    installedAt: new Date().toISOString(),
    installDir: paths.appDir,
    bridgeVersion: BRIDGE_VERSION,
  };
  try { fs.writeFileSync(paths.installInfo, JSON.stringify(info, null, 2), "utf8"); } catch(e) {}
}

// ── Main install function ─────────────────────────────────────────────────────
async function runInstall(selectedISOs, installDir) {
  try {
    INSTALL_DIR = installDir || INSTALL_DIR;
    var paths = getPaths(INSTALL_DIR);
    progress.installDir = INSTALL_DIR;

    progress = { step: "starting", message: "Starting installation...", percent: 2, log: progress.log, done: false, error: null, installDir: INSTALL_DIR };
    addLog("=== Thalamus Installer v" + INSTALLER_VERSION + " ===");
    addLog("Install directory: " + INSTALL_DIR);

    // Create directories
    if (!fs.existsSync(paths.appDir)) fs.mkdirSync(paths.appDir, { recursive: true });
    if (!fs.existsSync(paths.isoDir)) fs.mkdirSync(paths.isoDir, { recursive: true });
    if (!fs.existsSync(paths.diskDir)) fs.mkdirSync(paths.diskDir, { recursive: true });

    // Scan for existing ISOs immediately
    addLog("Scanning for existing OS images...");
    scanAndRenameExistingISOs(paths.isoDir);

    // Step 1: Install QEMU
    progress.step = "qemu"; progress.message = "Installing QEMU VM engine..."; progress.percent = 5;
    await installQemu();

    // Step 2: Download bridge
    progress.step = "bridge"; progress.message = "Downloading VM bridge..."; progress.percent = 22;
    await downloadBridge(paths);

    // Step 3: Write bridge launcher
    writeBridgeLauncher(paths);

    // Step 4: Register thalamus:// protocol
    progress.step = "registry"; progress.message = "Registering thalamus:// protocol..."; progress.percent = 35;
    await registerUriScheme(paths);

    // Step 5: Add to startup
    progress.step = "startup"; progress.message = "Adding to Windows startup..."; progress.percent = 38;
    await addToStartup(paths);

    // Step 6: Download desktop app
    progress.step = "app"; progress.message = "Downloading Thalamus desktop app..."; progress.percent = 40;
    await downloadDesktopApp(paths);

    // Step 7: Download VNC viewer
    progress.step = "vnc"; progress.message = "Downloading VNC viewer..."; progress.percent = 55;
    await downloadVNC(paths);

    // Step 8: Download ISOs
    if (selectedISOs && selectedISOs.length > 0) {
      progress.step = "isos"; progress.message = "Downloading OS images..."; progress.percent = 58;
      await downloadISOs(selectedISOs, paths);
    }

    // Step 9: Create desktop shortcut
    progress.step = "shortcut"; progress.message = "Creating desktop shortcut..."; progress.percent = 90;
    await createDesktopShortcut(paths.appDir);
    await createStartMenuShortcut(paths.appDir);

    // Step 10: Register with Windows
    progress.step = "register"; progress.message = "Registering with Windows..."; progress.percent = 93;
    await registerWithWindows(paths.appDir);

    // Step 11: Save install info
    saveInstallInfo(paths);

    // Step 12: Start bridge
    progress.step = "bridge-start"; progress.message = "Starting VM bridge..."; progress.percent = 95;
    await startBridge(paths);

    // Kill aria2 to free resources
    if (process.platform === "win32") {
      exec("taskkill /f /im aria2c.exe", { windowsHide: true }, function() {});
    }

    progress.step = "done"; progress.message = "Installation complete!"; progress.percent = 100; progress.done = true;
    addLog("=== Installation complete! ===");
    addLog("Thalamus AI is installed at: " + INSTALL_DIR);
    addLog("Desktop shortcut: Thalamus AI.lnk");
    addLog("VM bridge is running in the background.");
    addLog("Double-click 'Thalamus AI' on your desktop to launch!");
  } catch(err) {
    addLog("Installation error: " + (err instanceof Error ? err.message : String(err)));
    progress.error = err instanceof Error ? err.message : String(err);
    progress.step = "error";
  }
}

// ── HTTP server ───────────────────────────────────────────────────────────────
var server = http.createServer(function(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }

  if (req.method === "GET" && req.url === "/") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(getInstallerHTML());
    return;
  }

  if (req.method === "GET" && req.url === "/api/isos") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(ISO_OPTIONS));
    return;
  }

  if (req.method === "GET" && req.url === "/api/progress") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(progress));
    return;
  }

  if (req.method === "GET" && req.url.startsWith("/api/launch-vnc")) {
    var urlParts = req.url.split("?");
    var port = 5901;
    if (urlParts[1]) {
      var params = {};
      urlParts[1].split("&").forEach(function(p) { var kv = p.split("="); params[kv[0]] = kv[1]; });
      port = parseInt(params.port || "5901");
    }
    var paths2 = getPaths(INSTALL_DIR);
    if (fs.existsSync(paths2.vncExe)) {
      exec('"' + paths2.vncExe + '" localhost::' + port, { windowsHide: false }, function() {});
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  if (req.method === "GET" && req.url === "/api/launch-app") {
    var paths3 = getPaths(INSTALL_DIR);
    if (fs.existsSync(paths3.desktopExe)) {
      spawn(paths3.desktopExe, [], { detached: true, stdio: "ignore", cwd: paths3.appDir }).unref();
      addLog("Thalamus app launched.");
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  if (req.method === "POST" && req.url === "/api/install") {
    var body = "";
    req.on("data", function(chunk) { body += chunk; });
    req.on("end", function() {
      try {
        var data = JSON.parse(body);
        var selectedISOs = data.isos || [];
        var installDir = data.installDir || INSTALL_DIR;
        runInstall(selectedISOs, installDir);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
      } catch(e) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  res.writeHead(404); res.end("Not found");
});

// ── HTML UI ───────────────────────────────────────────────────────────────────
function getInstallerHTML() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Thalamus AI Setup</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  :root {
    --bg: #050a14;
    --surface: #0a1628;
    --surface2: #0f1f38;
    --border: #1a2d4a;
    --primary: #3b82f6;
    --primary-glow: rgba(59,130,246,0.15);
    --text: #e2e8f0;
    --muted: #64748b;
    --success: #22c55e;
    --warning: #f59e0b;
    --error: #ef4444;
  }
  body { background: var(--bg); color: var(--text); font-family: 'Segoe UI', system-ui, sans-serif; min-height: 100vh; overflow-x: hidden; }
  
  /* Animated background */
  body::before {
    content: '';
    position: fixed;
    inset: 0;
    background: radial-gradient(ellipse at 20% 20%, rgba(59,130,246,0.08) 0%, transparent 50%),
                radial-gradient(ellipse at 80% 80%, rgba(99,102,241,0.06) 0%, transparent 50%);
    pointer-events: none;
    z-index: 0;
  }

  .container { max-width: 780px; margin: 0 auto; padding: 32px 24px; position: relative; z-index: 1; }
  
  /* Header */
  .header { display: flex; align-items: center; gap: 16px; margin-bottom: 32px; }
  .logo { width: 48px; height: 48px; border-radius: 12px; background: var(--primary-glow); border: 1px solid rgba(59,130,246,0.3); display: flex; align-items: center; justify-content: center; font-size: 24px; }
  .header-text h1 { font-size: 22px; font-weight: 700; color: var(--text); letter-spacing: -0.3px; }
  .header-text p { font-size: 12px; color: var(--muted); margin-top: 2px; }
  .badge { background: var(--primary-glow); border: 1px solid rgba(59,130,246,0.3); color: var(--primary); font-size: 10px; font-weight: 700; padding: 2px 8px; border-radius: 20px; letter-spacing: 0.05em; }

  /* Cards */
  .card { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 20px; margin-bottom: 16px; }
  .card-title { font-size: 12px; font-weight: 700; color: var(--muted); text-transform: uppercase; letter-spacing: 0.1em; margin-bottom: 12px; display: flex; align-items: center; gap-8px; }
  
  /* Install dir */
  .dir-row { display: flex; gap: 8px; align-items: center; }
  .dir-input { flex: 1; background: var(--bg); border: 1px solid var(--border); border-radius: 8px; padding: 10px 14px; color: var(--text); font-size: 13px; font-family: 'Consolas', monospace; outline: none; transition: border-color 0.2s; }
  .dir-input:focus { border-color: var(--primary); }
  .btn-browse { background: var(--surface2); border: 1px solid var(--border); color: var(--text); padding: 10px 16px; border-radius: 8px; cursor: pointer; font-size: 12px; font-weight: 600; transition: all 0.2s; white-space: nowrap; }
  .btn-browse:hover { border-color: var(--primary); color: var(--primary); }

  /* OS grid */
  .os-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 8px; }
  .os-item { background: var(--bg); border: 1px solid var(--border); border-radius: 8px; padding: 10px 12px; cursor: pointer; transition: all 0.15s; display: flex; align-items: flex-start; gap: 10px; }
  .os-item:hover { border-color: var(--primary); background: var(--primary-glow); }
  .os-item.selected { border-color: var(--primary); background: var(--primary-glow); }
  .os-item.installed { border-color: var(--success); background: rgba(34,197,94,0.08); }
  .os-check { width: 16px; height: 16px; border: 1.5px solid var(--border); border-radius: 4px; flex-shrink: 0; margin-top: 1px; display: flex; align-items: center; justify-content: center; transition: all 0.15s; }
  .os-item.selected .os-check, .os-item.installed .os-check { background: var(--primary); border-color: var(--primary); }
  .os-item.installed .os-check { background: var(--success); border-color: var(--success); }
  .os-check svg { width: 10px; height: 10px; fill: white; }
  .os-info { flex: 1; min-width: 0; }
  .os-name { font-size: 12px; font-weight: 600; color: var(--text); }
  .os-meta { font-size: 10px; color: var(--muted); margin-top: 2px; }
  .os-size { font-size: 10px; color: var(--primary); font-weight: 600; }
  .os-badge { font-size: 9px; padding: 1px 6px; border-radius: 10px; font-weight: 700; margin-top: 3px; display: inline-block; }
  .os-badge.free { background: rgba(34,197,94,0.15); color: var(--success); }
  .os-badge.licensed { background: rgba(245,158,11,0.15); color: var(--warning); }

  /* Category headers */
  .cat-header { font-size: 10px; font-weight: 700; color: var(--muted); text-transform: uppercase; letter-spacing: 0.12em; margin: 12px 0 6px; padding-bottom: 4px; border-bottom: 1px solid var(--border); }

  /* Progress */
  .progress-bar-wrap { background: var(--bg); border-radius: 100px; height: 6px; overflow: hidden; margin: 12px 0; }
  .progress-bar { height: 100%; background: linear-gradient(90deg, var(--primary), #818cf8); border-radius: 100px; transition: width 0.4s ease; }
  .progress-label { display: flex; justify-content: space-between; font-size: 11px; color: var(--muted); }
  
  /* Log */
  .log-box { background: var(--bg); border: 1px solid var(--border); border-radius: 8px; padding: 12px; height: 180px; overflow-y: auto; font-family: 'Consolas', monospace; font-size: 11px; color: #94a3b8; }
  .log-box .log-line { padding: 1px 0; line-height: 1.5; }
  .log-box .log-line.success { color: var(--success); }
  .log-box .log-line.error { color: var(--error); }
  .log-box .log-line.info { color: var(--primary); }

  /* Buttons */
  .btn-install { width: 100%; padding: 14px; background: var(--primary); color: white; border: none; border-radius: 10px; font-size: 14px; font-weight: 700; cursor: pointer; transition: all 0.2s; letter-spacing: 0.02em; display: flex; align-items: center; justify-content: center; gap: 8px; }
  .btn-install:hover:not(:disabled) { background: #2563eb; transform: translateY(-1px); box-shadow: 0 8px 24px rgba(59,130,246,0.3); }
  .btn-install:disabled { opacity: 0.5; cursor: not-allowed; transform: none; }
  .btn-launch { width: 100%; padding: 14px; background: var(--success); color: white; border: none; border-radius: 10px; font-size: 14px; font-weight: 700; cursor: pointer; transition: all 0.2s; display: flex; align-items: center; justify-content: center; gap: 8px; }
  .btn-launch:hover { background: #16a34a; transform: translateY(-1px); box-shadow: 0 8px 24px rgba(34,197,94,0.3); }

  /* Status */
  .status-row { display: flex; align-items: center; gap: 8px; font-size: 12px; }
  .status-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
  .status-dot.running { background: var(--success); box-shadow: 0 0 8px var(--success); animation: pulse 2s infinite; }
  .status-dot.idle { background: var(--muted); }
  .status-dot.error { background: var(--error); }
  @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }

  /* Spinner */
  .spinner { width: 16px; height: 16px; border: 2px solid rgba(255,255,255,0.3); border-top-color: white; border-radius: 50%; animation: spin 0.8s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }

  /* Select all row */
  .select-row { display: flex; gap: 8px; margin-bottom: 10px; }
  .btn-sm { background: var(--surface2); border: 1px solid var(--border); color: var(--muted); padding: 5px 12px; border-radius: 6px; cursor: pointer; font-size: 11px; font-weight: 600; transition: all 0.15s; }
  .btn-sm:hover { border-color: var(--primary); color: var(--primary); }

  /* Done state */
  .done-card { background: rgba(34,197,94,0.08); border: 1px solid rgba(34,197,94,0.3); border-radius: 12px; padding: 24px; text-align: center; }
  .done-icon { font-size: 48px; margin-bottom: 12px; }
  .done-title { font-size: 20px; font-weight: 700; color: var(--success); margin-bottom: 6px; }
  .done-sub { font-size: 13px; color: var(--muted); margin-bottom: 20px; }
</style>
</head>
<body>
<div class="container">
  <div class="header">
    <div class="logo">🧠</div>
    <div class="header-text">
      <h1>Thalamus AI Setup <span class="badge">v${INSTALLER_VERSION}</span></h1>
      <p>World's First L4.5 Agent — by Aphantic Corporations</p>
    </div>
  </div>

  <div id="main-content">
    <!-- Install directory -->
    <div class="card">
      <div class="card-title">📁 Install Location</div>
      <div class="dir-row">
        <input type="text" class="dir-input" id="install-dir" value="" placeholder="Choose install folder..." />
        <button class="btn-browse" onclick="browseDir()">Browse...</button>
      </div>
      <div style="font-size:11px;color:var(--muted);margin-top:8px;">
        You can install on any drive. Default: <code style="color:var(--primary)">%LOCALAPPDATA%\\Thalamus</code>
      </div>
    </div>

    <!-- What gets installed -->
    <div class="card">
      <div class="card-title">📦 What Gets Installed</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:12px;">
        <div style="display:flex;align-items:center;gap:8px;color:var(--text);">
          <span style="color:var(--success)">✓</span> Thalamus Desktop App
        </div>
        <div style="display:flex;align-items:center;gap:8px;color:var(--text);">
          <span style="color:var(--success)">✓</span> QEMU VM Engine
        </div>
        <div style="display:flex;align-items:center;gap:8px;color:var(--text);">
          <span style="color:var(--success)">✓</span> VM Bridge (auto-start)
        </div>
        <div style="display:flex;align-items:center;gap:8px;color:var(--text);">
          <span style="color:var(--success)">✓</span> VNC Viewer
        </div>
        <div style="display:flex;align-items:center;gap:8px;color:var(--text);">
          <span style="color:var(--success)">✓</span> Desktop Shortcut
        </div>
        <div style="display:flex;align-items:center;gap:8px;color:var(--text);">
          <span style="color:var(--success)">✓</span> Start Menu Entry
        </div>
        <div style="display:flex;align-items:center;gap:8px;color:var(--text);">
          <span style="color:var(--success)">✓</span> Add/Remove Programs
        </div>
        <div style="display:flex;align-items:center;gap:8px;color:var(--text);">
          <span style="color:var(--success)">✓</span> Auto-start on login
        </div>
      </div>
    </div>

    <!-- OS selection -->
    <div class="card">
      <div class="card-title">💿 OS Images (Optional)</div>
      <div class="select-row">
        <button class="btn-sm" onclick="selectAll()">Select All</button>
        <button class="btn-sm" onclick="selectNone()">None</button>
        <button class="btn-sm" onclick="selectFree()">Free Only</button>
      </div>
      <div id="os-list"></div>
    </div>

    <!-- Install button -->
    <button class="btn-install" id="install-btn" onclick="startInstall()">
      <span>Install Thalamus AI</span>
    </button>
  </div>

  <!-- Progress view (hidden initially) -->
  <div id="progress-view" style="display:none;">
    <div class="card">
      <div class="card-title">
        <span id="step-label">Installing...</span>
      </div>
      <div class="progress-label">
        <span id="progress-msg">Starting...</span>
        <span id="progress-pct">0%</span>
      </div>
      <div class="progress-bar-wrap">
        <div class="progress-bar" id="progress-bar" style="width:0%"></div>
      </div>
      <div class="log-box" id="log-box"></div>
    </div>
  </div>

  <!-- Done view (hidden initially) -->
  <div id="done-view" style="display:none;">
    <div class="done-card">
      <div class="done-icon">🎉</div>
      <div class="done-title">Thalamus AI is installed!</div>
      <div class="done-sub">Desktop shortcut created. VM bridge is running.</div>
      <button class="btn-launch" onclick="launchApp()">
        🚀 Launch Thalamus AI
      </button>
    </div>
  </div>
</div>

<script>
var ISO_OPTIONS = ${JSON.stringify(ISO_OPTIONS)};
var DEFAULT_DIR = "${INSTALL_DIR.replace(/\\/g, "\\\\")}";
var selected = new Set();
var installedISOs = new Set();
var installing = false;
var pollInterval = null;

// Init
document.getElementById('install-dir').value = DEFAULT_DIR;
renderOSList();

function renderOSList() {
  var categories = [
    { key: 'windows', label: '🪟 Windows', free: false },
    { key: 'macos', label: '🍎 macOS', free: false },
    { key: 'android', label: '🤖 Android', free: true },
    { key: 'linux', label: '🐧 Linux', free: true },
  ];
  var html = '';
  categories.forEach(function(cat) {
    var items = ISO_OPTIONS.filter(function(o) { return o.category === cat.key; });
    if (!items.length) return;
    html += '<div class="cat-header">' + cat.label + '</div>';
    html += '<div class="os-grid">';
    items.forEach(function(iso) {
      var isInstalled = installedISOs.has(iso.key);
      var isSelected = selected.has(iso.key) || isInstalled;
      var cls = isInstalled ? 'os-item installed' : (isSelected ? 'os-item selected' : 'os-item');
      var badge = (cat.key === 'windows' || cat.key === 'macos') ? '<span class="os-badge licensed">Licensed</span>' : '<span class="os-badge free">Free</span>';
      html += '<div class="' + cls + '" onclick="toggleISO(&apos;' + iso.key + '&apos;)" data-key="' + iso.key + '">';
      html += '<div class="os-check"><svg viewBox="0 0 10 8"><path d="M1 4l3 3 5-6" stroke="white" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg></div>';
      html += '<div class="os-info">';
      html += '<div class="os-name">' + iso.name + '</div>';
      html += '<div class="os-meta">' + iso.version + '</div>';
      html += '<div class="os-size">' + iso.size + ' ' + badge + '</div>';
      if (isInstalled) html += '<div style="font-size:10px;color:var(--success);margin-top:2px;">✓ Already installed</div>';
      html += '</div></div>';
    });
    html += '</div>';
  });
  document.getElementById('os-list').innerHTML = html;
}

function toggleISO(key) {
  if (installedISOs.has(key)) return;
  if (selected.has(key)) selected.delete(key);
  else selected.add(key);
  renderOSList();
}

function selectAll() { ISO_OPTIONS.forEach(function(o) { selected.add(o.key); }); renderOSList(); }
function selectNone() { selected.clear(); renderOSList(); }
function selectFree() {
  selected.clear();
  ISO_OPTIONS.forEach(function(o) {
    if (o.category === 'android' || o.category === 'linux') selected.add(o.key);
  });
  renderOSList();
}

function browseDir() {
  // Can't open native dialog from browser, but show a prompt
  var dir = prompt('Enter install directory:', document.getElementById('install-dir').value);
  if (dir) document.getElementById('install-dir').value = dir;
}

function startInstall() {
  if (installing) return;
  installing = true;
  var installDir = document.getElementById('install-dir').value.trim() || DEFAULT_DIR;
  var isos = Array.from(selected);
  
  document.getElementById('main-content').style.display = 'none';
  document.getElementById('progress-view').style.display = 'block';

  fetch('/api/install', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ isos: isos, installDir: installDir }),
  });

  pollInterval = setInterval(pollProgress, 800);
}

function pollProgress() {
  fetch('/api/progress').then(function(r) { return r.json(); }).then(function(p) {
    document.getElementById('progress-msg').textContent = p.message || '';
    document.getElementById('progress-pct').textContent = (p.percent || 0) + '%';
    document.getElementById('progress-bar').style.width = (p.percent || 0) + '%';
    document.getElementById('step-label').textContent = p.step ? ('Step: ' + p.step) : 'Installing...';
    
    var logBox = document.getElementById('log-box');
    if (p.log && p.log.length) {
      logBox.innerHTML = p.log.map(function(l) {
        var cls = l.includes('✓') || l.includes('complete') || l.includes('ready') || l.includes('installed') ? 'success' :
                  l.includes('Error') || l.includes('failed') || l.includes('Warning') ? 'error' :
                  l.includes('===') || l.includes('Downloading') ? 'info' : '';
        return '<div class="log-line ' + cls + '">' + l + '</div>';
      }).join('');
      logBox.scrollTop = logBox.scrollHeight;
    }

    if (p.done) {
      clearInterval(pollInterval);
      document.getElementById('progress-view').style.display = 'none';
      document.getElementById('done-view').style.display = 'block';
    }
    if (p.error) {
      clearInterval(pollInterval);
      document.getElementById('step-label').textContent = '❌ Error';
    }
  }).catch(function() {});
}

function launchApp() {
  fetch('/api/launch-app').then(function() {
    setTimeout(function() { window.close(); }, 1000);
  });
}
</script>
</body>
</html>`;
}

// ── Start server and open browser ─────────────────────────────────────────────
server.listen(PORT, "127.0.0.1", function() {
  var url = "http://127.0.0.1:" + PORT;
  addLog("Installer UI: " + url);
  // Open browser
  if (process.platform === "win32") {
    exec('start "" "' + url + '"', { windowsHide: true }, function() {});
  } else if (process.platform === "darwin") {
    exec('open "' + url + '"', function() {});
  } else {
    exec('xdg-open "' + url + '"', function() {});
  }
});

server.on("error", function(e) {
  if (e.code === "EADDRINUSE") {
    // Port in use — open browser anyway
    exec('start "" "http://127.0.0.1:' + PORT + '"', { windowsHide: true }, function() {});
  }
});

function cleanup() {
  if (process.platform === "win32") {
    exec("taskkill /f /im aria2c.exe", { windowsHide: true }, function() {});
  }
  server.close();
  process.exit(0);
}
process.on("SIGINT", cleanup);
process.on("SIGTERM", cleanup);
