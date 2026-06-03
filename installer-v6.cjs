/**
 * Thalamus Installer v6.16.0
 * Browser-based UI — no HTA, no IE JScript, no console window
 * Opens a real browser window with modern HTML/JS UI
 */

"use strict";
const http = require("http");
const { exec, spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");
const https = require("https");

const PORT = 7891;
// Use LOCALAPPDATA env var (works even when AppData folder is hidden)
const APP_DIR = process.env.LOCALAPPDATA
  ? path.join(process.env.LOCALAPPDATA, "Thalamus")
  : path.join(os.homedir(), "AppData", "Local", "Thalamus");
const ISOS_DIR = path.join(APP_DIR, "isos");
const BRIDGE_EXE = path.join(APP_DIR, "thalamus-vm-bridge.exe");
const BRIDGE_LAUNCHER = path.join(APP_DIR, "launch-bridge-hidden.vbs");
const BRIDGE_LOG = path.join(APP_DIR, "bridge.log");
const BRIDGE_URL = "https://github.com/hardcoregamingsyle/thalamus/releases/download/vm-bridge-v3.1.0/thalamus-vm-bridge-v3.1.0.exe";

// ── No console self-hide needed — browser UI is the real UI
// ── State ─────────────────────────────────────────────────────────────────────
var progress = {
  step: "idle",
  message: "Ready to install",
  percent: 0,
  log: [],
  done: false,
  error: null
};

function addLog(msg) {
  progress.log.push(msg);
  if (progress.log.length > 500) progress.log.shift();
}

// ── OS definitions ────────────────────────────────────────────────────────────
// Keys MUST match OS_CONFIGS keys in SandboxView.tsx and ISO_MAP in bridge-v3.cjs
var ISO_OPTIONS = [
  // Windows — preactivated ISOs via Google Drive
  { key: "windows-11", name: "Windows 11 Pro", version: "24H2 Preactivated", size: "4.28 GB", category: "windows", gdriveId: "1-6IAC0S3s8sYLnABPJQizgnRK1jJc3q2", filename: "windows-11.iso", note: "Preactivated — no product key needed" },
  { key: "windows-10", name: "Windows 10 Pro", version: "22H2 Preactivated", size: "4.5 GB", category: "windows", gdriveId: "1QCB98ov7mAn-HOPUg1T0iWQ6RMYq8K6w", filename: "windows-10.iso", note: "Preactivated — no product key needed" },
  // macOS — torrent downloads via aria2 (auto-installed, no user interaction)
  { key: "macos-18", name: "macOS 15 Sequoia", version: "15.2", size: "~14 GB", category: "macos", torrentUrl: "https://data.pyenb.network/macOS/isos/torrents/macOS%20Sequoia%2015.2_24C101.iso.torrent", filename: "macos-18.iso", note: "Downloaded via aria2 automatically" },
  { key: "macos-17", name: "macOS 14 Sonoma", version: "14.7", size: "~13 GB", category: "macos", torrentUrl: "https://data.pyenb.network/macOS/isos/torrents/macOS%20Sonoma%2014.7_23H124.iso.torrent", filename: "macos-17.iso", note: "Downloaded via aria2 automatically" },
  { key: "macos-16", name: "macOS 13 Ventura", version: "13.7.1", size: "~12 GB", category: "macos", torrentUrl: "https://data.pyenb.network/macOS/isos/torrents/macOS%20Ventura%2013.7.1_22H221.iso.torrent", filename: "macos-16.iso", note: "Downloaded via aria2 automatically" },
  { key: "macos-15", name: "macOS 12 Monterey", version: "12.7.6", size: "~12 GB", category: "macos", torrentUrl: "https://data.pyenb.network/macOS/isos/torrents/macOS%20Monterey%2012.7.6_21H1320.iso.torrent", filename: "macos-15.iso", note: "Downloaded via aria2 automatically" },
  { key: "macos-14", name: "macOS 11 Big Sur", version: "11.7.10", size: "~12 GB", category: "macos", torrentUrl: "https://data.pyenb.network/macOS/isos/torrents/macOS%20Big%20Sur%2011.7.10_20G1427.iso.torrent", filename: "macos-14.iso", note: "Downloaded via aria2 automatically" },
  // Android — auto-download
  { key: "android-14", name: "Android 14 x86_64", version: "9.0-r2", size: "921 MB", category: "android", url: "https://sourceforge.net/projects/android-x86/files/Release%209.0/android-x86_64-9.0-r2.iso/download", filename: "android-14.iso", note: "Android-x86 project" },
  { key: "android-13", name: "Android 13 x86_64", version: "8.1-r6", size: "900 MB", category: "android", url: "https://sourceforge.net/projects/android-x86/files/Release%208.1/android-x86_64-8.1-r6.iso/download", filename: "android-13.iso", note: "Android-x86 project" },
  // iOS — not supported (IPSW format cannot be emulated with QEMU)
  // Linux — auto-download
  { key: "ubuntu-24", name: "Ubuntu 24.04 LTS", version: "24.04", size: "5.7 GB", category: "linux", url: "https://releases.ubuntu.com/24.04/ubuntu-24.04.2-desktop-amd64.iso", filename: "ubuntu-24.iso", note: "" },
  { key: "debian-12", name: "Debian 12 Bookworm", version: "12.0", size: "3.7 GB", category: "linux", url: "https://cdimage.debian.org/debian-cd/current/amd64/iso-dvd/debian-12.9.0-amd64-DVD-1.iso", filename: "debian-12.iso", note: "" },
  { key: "kali-2024", name: "Kali Linux 2024", version: "2024.4", size: "4.1 GB", category: "linux", url: "https://cdimage.kali.org/kali-2024.4/kali-linux-2024.4-installer-amd64.iso", filename: "kali-2024.iso", note: "" }
];

// ── Download helper (parallel chunks for speed) ──────────────────────────────
function downloadFile(url, dest, onProgress) {
  return new Promise(function(resolve, reject) {
    var redirectCount = 0;

    function resolveUrl(reqUrl, cb) {
      if (redirectCount > 15) { reject(new Error("Too many redirects")); return; }
      var mod = reqUrl.startsWith("https") ? https : http;
      var req = mod.request(reqUrl, { method: "HEAD" }, function(res) {
        if (res.statusCode >= 301 && res.statusCode <= 308 && res.headers.location) {
          redirectCount++;
          resolveUrl(res.headers.location, cb);
          return;
        }
        cb(reqUrl, parseInt(res.headers["content-length"] || "0", 10));
      });
      req.on("error", function() { cb(reqUrl, 0); });
      req.end();
    }

    function downloadChunk(finalUrl, start, end, retries) {
      return new Promise(function(res2, rej2) {
        var mod = finalUrl.startsWith("https") ? https : http;
        var opts = { headers: { "Range": "bytes=" + start + "-" + end } };
        mod.get(finalUrl, opts, function(r) {
          var chunks = [];
          r.on("data", function(c) { chunks.push(c); });
          r.on("end", function() { res2(Buffer.concat(chunks)); });
          r.on("error", function(e) {
            if (retries > 0) { setTimeout(function() { downloadChunk(finalUrl, start, end, retries - 1).then(res2).catch(rej2); }, 1000); }
            else rej2(e);
          });
        }).on("error", function(e) {
          if (retries > 0) { setTimeout(function() { downloadChunk(finalUrl, start, end, retries - 1).then(res2).catch(rej2); }, 1000); }
          else rej2(e);
        });
      });
    }

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
          if (res.statusCode !== 200) { reject(new Error("HTTP " + res.statusCode)); return; }
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

    // Try parallel chunked download first, fall back to simple
    resolveUrl(url, function(finalUrl, totalSize) {
      if (totalSize < 10 * 1024 * 1024) {
        // Small file — simple download
        simpleFetch(finalUrl);
        return;
      }

      // Large file — 8 parallel chunks
      var CHUNKS = 8;
      var chunkSize = Math.ceil(totalSize / CHUNKS);
      var downloaded = new Array(CHUNKS).fill(0);
      var tmpFiles = [];
      var i;
      for (i = 0; i < CHUNKS; i++) {
        tmpFiles.push(dest + ".part" + i);
      }

      var promises = [];
      for (i = 0; i < CHUNKS; i++) {
        (function(idx) {
          var start = idx * chunkSize;
          var end = Math.min(start + chunkSize - 1, totalSize - 1);
          promises.push(
            downloadChunk(finalUrl, start, end, 3).then(function(buf) {
              fs.writeFileSync(tmpFiles[idx], buf);
              downloaded[idx] = buf.length;
              var total2 = downloaded.reduce(function(a, b) { return a + b; }, 0);
              if (onProgress) onProgress(total2, totalSize);
            })
          );
        })(i);
      }

      Promise.all(promises).then(function() {
        // Merge chunks
        var out = fs.createWriteStream(dest);
        var j = 0;
        function writeNext() {
          if (j >= CHUNKS) {
            out.close(function() {
              tmpFiles.forEach(function(f) { try { fs.unlinkSync(f); } catch(e) {} });
              resolve();
            });
            return;
          }
          var chunk = fs.readFileSync(tmpFiles[j]);
          j++;
          out.write(chunk, writeNext);
        }
        writeNext();
      }).catch(function(err) {
        // Fall back to simple download
        addLog("Parallel download failed, falling back to simple: " + err.message);
        simpleFetch(finalUrl);
      });
    });
  });
}

// ── Install steps ─────────────────────────────────────────────────────────────
function installQemu() {
  return new Promise(function(resolve) {
    var qemuPaths = [
      "C:\\Program Files\\qemu\\qemu-system-x86_64.exe",
      "C:\\Program Files (x86)\\qemu\\qemu-system-x86_64.exe"
    ];
    if (qemuPaths.some(function(p) { return fs.existsSync(p); })) {
      addLog("QEMU already installed, skipping.");
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
      exec('"' + qemuInstaller + '" /S', { timeout: 180000, windowsHide: true }, function(err) {
        if (err) addLog("QEMU install note: " + err.message);
        else addLog("QEMU installed.");
        progress.percent = 22;
        resolve();
      });
    }).catch(function(err) {
      addLog("QEMU download warning: " + err.message + " - continuing");
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
    exec('reg import "' + regFile + '"', { windowsHide: true }, function(err) {
      if (err) addLog("Registry note: " + err.message);
      else addLog("thalamus:// protocol registered.");
      resolve();
    });
  });
}

function addToStartup() {
  return new Promise(function(resolve) {
    exec('reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run" /v "ThalamusBridge" /t REG_SZ /d "wscript.exe \\"' + BRIDGE_LAUNCHER + '\\"" /f', { windowsHide: true }, function(err) {
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
    // Check bridge version — force re-download if old version
    var bridgeVersionFile = path.join(APP_DIR, "bridge.version");
    var expectedVersion = "3.1.0";
    var currentVersion = fs.existsSync(bridgeVersionFile) ? fs.readFileSync(bridgeVersionFile, "utf8").trim() : "0";
    if (fs.existsSync(BRIDGE_EXE) && currentVersion === expectedVersion) {
      addLog("Bridge v" + expectedVersion + " already downloaded.");
      progress.percent = 36;
      resolve();
      return;
    }
    if (fs.existsSync(BRIDGE_EXE) && currentVersion !== expectedVersion) {
      addLog("Updating bridge from v" + currentVersion + " to v" + expectedVersion + "...");
      try { fs.unlinkSync(BRIDGE_EXE); } catch(e) {}
    }
    addLog("Downloading VM bridge...");
    progress.step = "bridge-download";
    progress.message = "Downloading VM bridge...";
    progress.percent = 24;
    downloadFile(BRIDGE_URL, BRIDGE_EXE, function(dl, tot) {
      progress.percent = 24 + Math.floor((dl / tot) * 10);
      progress.message = "Downloading bridge: " + Math.round(dl / 1024 / 1024) + " MB / " + Math.round(tot / 1024 / 1024) + " MB";
    }).then(function() {
      addLog("Bridge v3.1.0 downloaded.");
      try { fs.writeFileSync(path.join(APP_DIR, "bridge.version"), "3.1.0", "utf8"); } catch(e) {}
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
    'cmd = "cmd.exe /c """ & "' + bridge + '" & """ >> """ & "' + log + '" & """ 2>&1"',
    'shell.Run cmd, 0, False'
  ].join("\r\n");
  fs.writeFileSync(BRIDGE_LAUNCHER, content, "utf8");
  addLog("Hidden bridge launcher written.");
}

// aria2 download helper — downloads aria2c.exe silently, then uses it for torrents
var ARIA2_EXE = path.join(APP_DIR, "aria2c.exe");
var ARIA2_URL = "https://github.com/aria2/aria2/releases/download/release-1.37.0/aria2-1.37.0-win-64bit-build1.zip";

function ensureAria2() {
  return new Promise(function(resolve) {
    if (fs.existsSync(ARIA2_EXE)) { resolve(true); return; }
    addLog("Downloading aria2 download manager (~3 MB)...");
    var zipPath = path.join(os.tmpdir(), "aria2.zip");
    downloadFile(ARIA2_URL, zipPath, null).then(function() {
      // Extract aria2c.exe from zip using PowerShell
      var ps = 'Expand-Archive -Path "' + zipPath + '" -DestinationPath "' + os.tmpdir() + '\\aria2tmp" -Force; ' +
               'Get-ChildItem "' + os.tmpdir() + '\\aria2tmp" -Recurse -Filter "aria2c.exe" | ' +
               'Copy-Item -Destination "' + ARIA2_EXE + '"';
      exec('powershell -NoProfile -NonInteractive -Command "' + ps + '"', { windowsHide: true, timeout: 30000 }, function(err) {
        if (err || !fs.existsSync(ARIA2_EXE)) {
          addLog("aria2 setup failed: " + (err ? err.message : "exe not found") + " — torrent downloads unavailable");
          resolve(false);
        } else {
          addLog("aria2 ready.");
          resolve(true);
        }
      });
    }).catch(function(e) {
      addLog("aria2 download failed: " + e.message + " — torrent downloads unavailable");
      resolve(false);
    });
  });
}

function downloadFromGDrive(iso, aria2Ready) {
  return new Promise(function(resolve) {
    var dest = path.join(ISOS_DIR, iso.filename);
    if (fs.existsSync(dest)) {
      var stat = fs.statSync(dest);
      addLog(iso.name + " already installed (" + Math.round(stat.size / 1024 / 1024) + " MB). Skipping download.");
      resolve(); return;
    }
    if (!aria2Ready || !fs.existsSync(ARIA2_EXE)) {
      // Fallback: simple HTTP download with confirm cookie
      addLog("Downloading " + iso.name + " via HTTP (Google Drive)...");
      var url = "https://drive.usercontent.google.com/download?id=" + iso.gdriveId + "&export=download&confirm=t";
      downloadFile(url, dest, function(dl, tot) {
        if (tot > 0) {
          progress.percent = 42 + Math.floor((dl / tot) * 50);
          progress.message = "Downloading " + iso.name + ": " + Math.round(dl / 1024 / 1024) + " MB / " + Math.round(tot / 1024 / 1024) + " MB";
        }
      }).then(function() {
        addLog(iso.name + " downloaded.");
        resolve();
      }).catch(function(e) {
        addLog("Warning: Failed to download " + iso.name + ": " + e.message);
        resolve();
      });
      return;
    }
    addLog("Downloading " + iso.name + " via aria2 (Google Drive)...");
    progress.message = "Downloading " + iso.name + "...";
    var url = "https://drive.usercontent.google.com/download?id=" + iso.gdriveId + "&export=download&confirm=t";
    var cmd = '"' + ARIA2_EXE + '" --dir="' + ISOS_DIR + '" --out="' + iso.filename + '" --max-connection-per-server=16 --split=16 --header="Cookie: download_warning_' + iso.gdriveId + '=t" "' + url + '"';
    exec(cmd, { windowsHide: true, timeout: 7200000 }, function(err) {
      if (err) {
        addLog("aria2 GDrive failed for " + iso.name + ": " + err.message + " — trying HTTP fallback");
        var url2 = "https://drive.usercontent.google.com/download?id=" + iso.gdriveId + "&export=download&confirm=t";
        downloadFile(url2, dest, function(dl, tot) {
          if (tot > 0) {
            progress.percent = 42 + Math.floor((dl / tot) * 50);
            progress.message = "Downloading " + iso.name + ": " + Math.round(dl / 1024 / 1024) + " MB / " + Math.round(tot / 1024 / 1024) + " MB";
          }
        }).then(function() {
          addLog(iso.name + " downloaded.");
          resolve();
        }).catch(function(e2) {
          addLog("Warning: Failed to download " + iso.name + ": " + e2.message);
          resolve();
        });
      } else {
        addLog(iso.name + " downloaded.");
        resolve();
      }
    });
  });
}

function downloadViaTorrent(iso, aria2Ready) {
  return new Promise(function(resolve) {
    if (!aria2Ready || !fs.existsSync(ARIA2_EXE)) {
      addLog("SKIP (no aria2): " + iso.name + " — download torrent manually: " + iso.torrentUrl);
      resolve();
      return;
    }
    var dest = path.join(ISOS_DIR, iso.filename);
    if (fs.existsSync(dest)) { addLog(iso.name + " already downloaded."); resolve(); return; }
    addLog("Downloading " + iso.name + " via aria2 (torrent)...");
    addLog("  This may take a while depending on seeders.");
    progress.message = "Downloading " + iso.name + " via torrent...";
    // Download the .torrent file first
    var torrentFile = path.join(APP_DIR, iso.filename.replace(/\.iso$/, ".torrent"));
    downloadFile(iso.torrentUrl, torrentFile, null).then(function() {
      // Run aria2c to download the torrent to ISOS_DIR
      var cmd = '"' + ARIA2_EXE + '" --dir="' + ISOS_DIR + '" --seed-time=0 --max-connection-per-server=16 --split=16 "' + torrentFile + '"';
      exec(cmd, { windowsHide: true, timeout: 7200000 }, function(err, stdout, stderr) {
        if (err) {
          addLog("Warning: aria2 torrent download failed for " + iso.name + ": " + err.message);
          addLog("  You can download manually: " + iso.torrentUrl);
        } else {
          // Rename the downloaded file to the expected filename
          var files = fs.readdirSync(ISOS_DIR).filter(function(f) { return f.endsWith(".iso") && f.toLowerCase().includes("macos"); });
          if (files.length > 0) {
            var latest = files[files.length - 1];
            var latestPath = path.join(ISOS_DIR, latest);
            if (latest !== iso.filename) {
              try { fs.renameSync(latestPath, dest); } catch(e) {}
            }
          }
          addLog(iso.name + " downloaded successfully.");
        }
        resolve();
      });
    }).catch(function(e) {
      addLog("Torrent file download failed for " + iso.name + ": " + e.message);
      resolve();
    });
  });
}

async function downloadISOs(selectedKeys) {
  // Handle manual entries
  var manualItems = ISO_OPTIONS.filter(function(iso) {
    return selectedKeys.indexOf(iso.key) !== -1 && iso.manual;
  });
  if (manualItems.length > 0) {
    manualItems.forEach(function(iso) {
      addLog("MANUAL REQUIRED: " + iso.name + " — download from: " + iso.manualUrl);
      addLog("  Place the ISO at: " + path.join(ISOS_DIR, iso.filename));
    });
  }

  // Handle torrent entries via aria2
  var torrentItems = ISO_OPTIONS.filter(function(iso) {
    return selectedKeys.indexOf(iso.key) !== -1 && iso.torrentUrl;
  });
  var aria2Ready = false;
  if (torrentItems.length > 0) {
    progress.message = "Setting up aria2 download manager...";
    aria2Ready = await ensureAria2();
    for (var i = 0; i < torrentItems.length; i++) {
      await downloadViaTorrent(torrentItems[i], aria2Ready);
    }
  }

  // Handle Google Drive downloads
  var gdriveItems = ISO_OPTIONS.filter(function(iso) {
    return selectedKeys.indexOf(iso.key) !== -1 && iso.gdriveId;
  });
  if (gdriveItems.length > 0) {
    if (!aria2Ready) {
      progress.message = "Setting up aria2 for fast downloads...";
      aria2Ready = await ensureAria2();
    }
    for (var gi = 0; gi < gdriveItems.length; gi++) {
      await downloadFromGDrive(gdriveItems[gi], aria2Ready);
    }
  }

  // Handle direct HTTP downloads
  var toDownload = ISO_OPTIONS.filter(function(iso) {
    return selectedKeys.indexOf(iso.key) !== -1 && iso.url && iso.filename && !iso.manual && !iso.torrentUrl && !iso.gdriveId;
  });
  if (toDownload.length === 0) return;
  for (var i = 0; i < toDownload.length; i++) {
    var iso = toDownload[i];
    var dest = path.join(ISOS_DIR, iso.filename);
    if (fs.existsSync(dest)) {
      var stat = fs.statSync(dest);
      addLog(iso.name + " already installed (" + Math.round(stat.size / 1024 / 1024) + " MB). Skipping.");
      continue;
    }
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
      addLog(iso.name + " downloaded.");
      // Inject ei.cfg for Windows ISOs to force Pro edition
      if (iso.key === "windows-11" || iso.key === "windows-10") {
        injectWindowsProConfig(dest, iso.name);
      }
    } catch (err) {
      addLog("Warning: Failed to download " + iso.name + ": " + err.message);
    }
  }
}


function startBridge() {
  return new Promise(function(resolve) {
    if (process.platform !== "win32") { addLog("Not Windows, skipping bridge start."); resolve(false); return; }
    if (!fs.existsSync(BRIDGE_EXE)) { addLog("Bridge exe not found, skipping start."); resolve(false); return; }
    addLog("Starting VM bridge in background...");
    try {
      writeBridgeLauncher();
      var child = spawn("wscript.exe", ["//B", "//Nologo", BRIDGE_LAUNCHER], {
        detached: true, stdio: "ignore", windowsHide: true
      });
      child.unref();
    } catch (err) {
      addLog("Hidden launcher failed, starting bridge directly: " + err.message);
      var out = fs.openSync(BRIDGE_LOG, "a");
      var direct = spawn(BRIDGE_EXE, [], {
        detached: true, stdio: ["ignore", out, out], windowsHide: true
      });
      direct.unref();
    }
    addLog("Bridge started in background.");
    resolve(true);
  });
}

async function runInstall(selectedISOs) {
  try {
    progress = { step: "starting", message: "Starting installation...", percent: 2, log: [], done: false, error: null };
    addLog("=== Thalamus Installer v6.16.0 ===");
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

// ── HTML UI (served to browser — no IE JScript limitations) ──────────────────
var HTML_UI = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Thalamus VM Setup</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  :root { --bg: #09090b; --bg2: #18181b; --bg3: #27272a; --border: #27272a; --text: #e4e4e7; --muted: #71717a; --primary: #6366f1; --primary-light: #818cf8; --green: #4ade80; --yellow: #facc15; --red: #f87171; }
  body { font-family: "Segoe UI", system-ui, -apple-system, sans-serif; background: var(--bg); color: var(--text); min-height: 100vh; display: flex; flex-direction: column; }
  ::-webkit-scrollbar { width: 4px; } ::-webkit-scrollbar-track { background: transparent; } ::-webkit-scrollbar-thumb { background: var(--bg3); border-radius: 4px; }
  
  .titlebar { background: var(--bg); border-bottom: 1px solid var(--border); padding: 14px 20px; display: flex; align-items: center; gap: 12px; flex-shrink: 0; }
  .logo { width: 36px; height: 36px; background: var(--primary); border-radius: 10px; display: flex; align-items: center; justify-content: center; font-size: 18px; font-weight: 900; color: white; flex-shrink: 0; box-shadow: 0 0 20px rgba(99,102,241,0.4); }
  .title-text { flex: 1; }
  .title-main { font-size: 15px; font-weight: 700; color: #f4f4f5; }
  .title-sub { font-size: 11px; color: var(--muted); margin-top: 1px; }
  .badge { font-size: 10px; font-weight: 700; background: rgba(99,102,241,0.12); color: var(--primary-light); border: 1px solid rgba(99,102,241,0.25); border-radius: 5px; padding: 2px 8px; }

  .main { flex: 1; display: flex; overflow: hidden; }
  .sidebar { width: 220px; flex-shrink: 0; border-right: 1px solid var(--border); padding: 16px; overflow-y: auto; display: flex; flex-direction: column; gap: 8px; }
  .content { flex: 1; overflow-y: auto; padding: 16px; }

  .steps-card { background: var(--bg2); border: 1px solid var(--border); border-radius: 10px; padding: 14px; }
  .steps-title { font-size: 10px; font-weight: 700; color: var(--muted); text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 10px; }
  .step-row { display: flex; align-items: flex-start; gap: 8px; padding: 5px 0; border-bottom: 1px solid var(--border); }
  .step-row:last-child { border-bottom: none; }
  .step-num { width: 18px; height: 18px; border-radius: 50%; background: rgba(99,102,241,0.12); color: var(--primary-light); font-size: 9px; font-weight: 800; text-align: center; line-height: 18px; flex-shrink: 0; }
  .step-text { font-size: 11px; color: #a1a1aa; line-height: 1.4; }

  .cat-header { font-size: 10px; font-weight: 700; color: #52525b; text-transform: uppercase; letter-spacing: 0.1em; margin: 12px 0 6px; padding-bottom: 4px; border-bottom: 1px solid var(--bg2); }
  .cat-header:first-child { margin-top: 0; }

  .os-item { background: var(--bg2); border: 1.5px solid var(--border); border-radius: 8px; padding: 10px 12px; margin-bottom: 6px; cursor: pointer; display: flex; align-items: flex-start; gap: 10px; transition: border-color 0.15s, background 0.15s; user-select: none; }
  .os-item:hover { border-color: #3f3f46; background: #1c1c1f; }
  .os-item.selected { border-color: var(--primary); background: rgba(99,102,241,0.08); }
  .os-checkbox { width: 15px; height: 15px; border: 1.5px solid #3f3f46; border-radius: 4px; flex-shrink: 0; margin-top: 1px; background: transparent; display: flex; align-items: center; justify-content: center; transition: all 0.15s; }
  .os-item.selected .os-checkbox { background: var(--primary); border-color: var(--primary); }
  .os-check { color: white; font-size: 10px; font-weight: 900; display: none; }
  .os-item.selected .os-check { display: block; }
  .os-info { flex: 1; min-width: 0; }
  .os-name { font-size: 12px; font-weight: 600; color: var(--text); }
  .os-meta { font-size: 10px; color: var(--muted); margin-top: 2px; }
  .os-badge { display: inline-block; font-size: 9px; font-weight: 700; padding: 1px 6px; border-radius: 4px; margin-top: 4px; }
  .badge-free { background: rgba(34,197,94,0.1); color: var(--green); border: 1px solid rgba(34,197,94,0.2); }
  .badge-eval { background: rgba(234,179,8,0.1); color: var(--yellow); border: 1px solid rgba(234,179,8,0.2); }
  .badge-community { background: rgba(99,102,241,0.1); color: var(--primary-light); border: 1px solid rgba(99,102,241,0.2); }
  .os-note { font-size: 9px; color: #52525b; margin-left: 4px; }

  .footer { padding: 12px 20px; border-top: 1px solid var(--border); display: flex; justify-content: space-between; align-items: center; flex-shrink: 0; background: var(--bg); }
  .footer-left { display: flex; align-items: center; gap: 8px; }
  .footer-note { font-size: 11px; color: #52525b; }
  .sel-count { font-size: 11px; color: var(--primary-light); }
  .btn-close { font-size: 12px; font-weight: 600; padding: 7px 16px; background: var(--bg2); color: #a1a1aa; border: 1px solid var(--border); border-radius: 7px; cursor: pointer; display: none; }
  .btn-close:hover { background: var(--bg3); }
  .btn-install { font-size: 12px; font-weight: 700; padding: 7px 20px; background: var(--primary); color: white; border: none; border-radius: 7px; cursor: pointer; transition: background 0.15s; }
  .btn-install:hover { background: #4f46e5; }
  .btn-install:disabled { opacity: 0.5; cursor: not-allowed; }

  /* Pages */
  .page { display: none; flex: 1; flex-direction: column; }
  .page.active { display: flex; }
  #page-select { flex-direction: row; }

  /* Install page */
  .install-wrap { flex: 1; display: flex; flex-direction: column; padding: 20px; gap: 12px; overflow: hidden; }
  .install-title { font-size: 15px; font-weight: 700; color: #f4f4f5; }
  .progress-bar { height: 6px; background: var(--bg2); border-radius: 3px; overflow: hidden; }
  .progress-fill { height: 100%; background: var(--primary); border-radius: 3px; width: 0%; transition: width 0.3s; }
  .progress-label { font-size: 11px; color: var(--muted); }
  .log-box { flex: 1; overflow-y: auto; background: #0a0a0c; border: 1px solid var(--border); border-radius: 8px; padding: 10px; font-family: "Consolas", "Courier New", monospace; font-size: 11px; }
  .log-line { padding: 1px 0; color: var(--muted); }
  .log-line.success { color: var(--green); }
  .log-line.error { color: var(--red); }
  .log-line.warn { color: var(--yellow); }
  .log-line.header { color: var(--primary-light); font-weight: 700; }

  /* Done page */
  .done-wrap { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 16px; padding: 40px; }
  .done-icon { width: 64px; height: 64px; border-radius: 50%; background: rgba(34,197,94,0.1); border: 2px solid rgba(34,197,94,0.3); display: flex; align-items: center; justify-content: center; font-size: 28px; }
  .done-title { font-size: 20px; font-weight: 700; color: #f4f4f5; }
  .done-sub { font-size: 13px; color: var(--muted); text-align: center; max-width: 400px; line-height: 1.6; }
  .done-steps { display: flex; flex-direction: column; gap: 8px; margin-top: 4px; }
  .done-step { display: flex; align-items: center; gap: 8px; font-size: 12px; color: #a1a1aa; }
  .done-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--green); flex-shrink: 0; }
</style>
</head>
<body>

<div class="titlebar">
  <div class="logo">T</div>
  <div class="title-text">
    <div class="title-main">Thalamus VM Setup</div>
    <div class="title-sub">Aphantic Corporations</div>
  </div>
  <div class="badge">v6.16.0</div>
</div>

<div class="main">
  <!-- SELECT PAGE -->
  <div class="page active" id="page-select">
    <div class="sidebar">
      <div class="steps-card">
        <div class="steps-title">What gets installed</div>
        <div class="step-row"><div class="step-num">1</div><div class="step-text">QEMU VM engine</div></div>
        <div class="step-row"><div class="step-num">2</div><div class="step-text">VM Bridge service</div></div>
        <div class="step-row"><div class="step-num">3</div><div class="step-text">thalamus:// protocol</div></div>
        <div class="step-row"><div class="step-num">4</div><div class="step-text">Auto-start on login</div></div>
        <div class="step-row"><div class="step-num">5</div><div class="step-text">Selected OS images</div></div>
      </div>
    </div>
    <div class="content" id="iso-list"></div>
  </div>

  <!-- INSTALL PAGE -->
  <div class="page" id="page-install">
    <div class="install-wrap">
      <div class="install-title" id="install-title">Installing Thalamus VM Bridge...</div>
      <div class="progress-bar"><div class="progress-fill" id="prog-fill"></div></div>
      <div class="progress-label" id="prog-label">Starting...</div>
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
        <div class="done-step"><div class="done-dot"></div>VM Bridge is running in the background</div>
        <div class="done-step"><div class="done-dot"></div>thalamus:// protocol registered</div>
        <div class="done-step"><div class="done-dot"></div>Bridge starts automatically with Windows</div>
        <div class="done-step"><div class="done-dot"></div>Return to Thalamus and click Boot OS</div>
      </div>
    </div>
  </div>
</div>

<div class="footer">
  <div class="footer-left">
    <span class="footer-note" id="footer-note">Select OS images to download (optional)</span>
    <span class="sel-count" id="sel-count"></span>
  </div>
  <div style="display:flex;gap:8px;align-items:center;">
    <button class="btn-close" id="close-btn" onclick="window.close()">Close</button>
    <button class="btn-install" id="install-btn" onclick="startInstall()">Install Now</button>
  </div>
</div>

<script>
var ISO_DATA = [];
var selected = {};

function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function getBadgeHtml(iso) {
  var cat = iso.category;
  if (iso.manual) return '<span class="os-badge badge-eval">Manual Download</span>';
  if (iso.torrentUrl) return '<span class="os-badge badge-community">Auto via aria2</span>';
  if (iso.gdriveId) return '<span class="os-badge badge-eval">Preactivated</span>';
  if (cat === 'android') return '<span class="os-badge badge-free">Free</span>';
  return '<span class="os-badge badge-free">Free + Open Source</span>';
}

function getCatLabel(cat) {
  return { windows: 'Windows', macos: 'macOS', linux: 'Linux', android: 'Android', ios: 'iOS' }[cat] || cat;
}

function renderISOs() {
  var container = document.getElementById('iso-list');
  container.innerHTML = '';
  var cats = [], catMap = {};
  ISO_DATA.forEach(function(iso) {
    if (!catMap[iso.category]) { catMap[iso.category] = []; cats.push(iso.category); }
    catMap[iso.category].push(iso);
  });
  cats.forEach(function(cat) {
    var hdr = document.createElement('div');
    hdr.className = 'cat-header';
    hdr.textContent = getCatLabel(cat);
    container.appendChild(hdr);
    catMap[cat].forEach(function(iso) {
      var row = document.createElement('div');
      row.className = 'os-item';
      row.id = 'item-' + iso.key;
      row.innerHTML = '<div class="os-checkbox"><span class="os-check">&#10003;</span></div>' +
        '<div class="os-info">' +
        '<div class="os-name">' + escHtml(iso.name) + '</div>' +
        '<div class="os-meta">' + escHtml(iso.version) + ' &bull; ' + escHtml(iso.size) + '</div>' +
        getBadgeHtml(iso) +
        (iso.note ? '<span class="os-note">' + escHtml(iso.note) + '</span>' : '') +
        '</div>';
      (function(key) {
        row.addEventListener('click', function() { toggleISO(key); });
      })(iso.key);
      container.appendChild(row);
    });
  });
}

function toggleISO(key) {
  if (selected[key]) { delete selected[key]; }
  else { selected[key] = true; }
  var el = document.getElementById('item-' + key);
  if (el) el.className = selected[key] ? 'os-item selected' : 'os-item';
  var keys = Object.keys(selected);
  var el2 = document.getElementById('sel-count');
  if (el2) el2.textContent = keys.length > 0 ? ' \u2014 ' + keys.length + ' OS' + (keys.length > 1 ? 'es' : '') + ' selected' : '';
}

function startInstall() {
  document.getElementById('page-select').className = 'page';
  document.getElementById('page-install').className = 'page active';
  document.getElementById('install-btn').disabled = true;
  document.getElementById('footer-note').textContent = 'Installation in progress...';
  var keys = Object.keys(selected);
  fetch('/install', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ isos: keys })
  }).then(function(r) {
    if (r.ok) { pollProgress(); }
    else { showError('Could not start installer. HTTP ' + r.status); }
  }).catch(function(e) { showError('Could not send request: ' + e.message); });
}

function showError(msg) {
  document.getElementById('install-title').textContent = 'Installation Failed';
  document.getElementById('prog-label').textContent = msg;
  document.getElementById('close-btn').style.display = 'inline-block';
  document.getElementById('footer-note').textContent = 'Installation failed.';
}

function getLogClass(line) {
  if (line.indexOf('===') !== -1) return 'log-line header';
  if (line.indexOf('ERROR') !== -1 || line.indexOf('failed') !== -1) return 'log-line error';
  if (line.indexOf('Warning') !== -1 || line.indexOf('warning') !== -1) return 'log-line warn';
  if (line.indexOf('complete') !== -1 || line.indexOf('installed') !== -1 || line.indexOf('downloaded') !== -1) return 'log-line success';
  return 'log-line';
}

function pollProgress() {
  fetch('/progress').then(function(r) { return r.json(); }).then(function(data) {
    document.getElementById('prog-fill').style.width = data.percent + '%';
    document.getElementById('prog-label').textContent = data.message || '';
    var logBox = document.getElementById('log-box');
    var html = '';
    (data.log || []).forEach(function(line) {
      html += '<div class="' + getLogClass(line) + '">' + escHtml(line) + '</div>';
    });
    logBox.innerHTML = html;
    logBox.scrollTop = logBox.scrollHeight;
    if (data.done) {
      document.getElementById('install-title').textContent = 'Setup Complete!';
      document.getElementById('page-install').className = 'page';
      document.getElementById('page-done').className = 'page active';
      document.getElementById('close-btn').style.display = 'inline-block';
      document.getElementById('install-btn').style.display = 'none';
      document.getElementById('footer-note').textContent = 'VM Bridge is running in the background.';
    } else if (data.error) {
      showError('Error: ' + data.error);
    } else {
      setTimeout(pollProgress, 600);
    }
  }).catch(function() { setTimeout(pollProgress, 1000); });
}

// Load ISO data
fetch('/isos').then(function(r) { return r.json(); }).then(function(data) {
  ISO_DATA = data;
  renderISOs();
}).catch(function(e) {
  document.getElementById('iso-list').innerHTML = '<div style="color:#f87171;padding:20px;font-size:12px;">Failed to load OS list: ' + e.message + '</div>';
});
</script>
</body>
</html>`;

// ── HTTP server ───────────────────────────────────────────────────────────────
var server = http.createServer(function(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }

  if (req.method === "GET" && req.url === "/") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(HTML_UI);
  } else if (req.method === "GET" && req.url === "/isos") {
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
  var url = "http://127.0.0.1:" + PORT;
  console.log("\x1b[32mThalamus Installer v6.16.0 running at " + url + "\x1b[0m");
  console.log("\x1b[33mOpening browser... If it does not open, visit: " + url + "\x1b[0m");
  // Open in default browser - NO windowsHide so browser actually opens
  if (process.platform === "win32") {
    var child = spawn("cmd.exe", ["/c", "start", "", url], {
      detached: true, stdio: "ignore", windowsHide: false
    });
    child.unref();
  } else if (process.platform === "darwin") {
    exec('open "' + url + '"');
  } else {
    exec('xdg-open "' + url + '"');
  }
});

// Keep the process alive - the server should run until the user closes it
process.stdin.resume();

process.on("SIGINT", function() { server.close(); process.exit(0); });
process.on("SIGTERM", function() { server.close(); process.exit(0); });
