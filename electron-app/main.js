const { app, BrowserWindow, ipcMain, shell, session } = require('electron');
const path = require('path');
const { spawn, exec } = require('child_process');
const fs = require('fs');
const os = require('os');
const http = require('http');
const net = require('net');

// App constants
const APP_NAME = 'Thalamus AI';
const CONVEX_URL = 'https://glad-ermine-937.convex.cloud';
const THALAMUS_URL = 'https://thalamus.aphantic.skinticals.com';

let mainWindow = null;
let bridgeProcess = null;

// Find install directory (where the app is installed)
function getInstallDir() {
  // When running as installed app, exe is in install dir
  const exeDir = path.dirname(process.execPath);
  // Check if we're in a typical install location
  if (fs.existsSync(path.join(exeDir, 'thalamus-vm-bridge.exe'))) {
    return exeDir;
  }
  // Fallback: check common install paths
  const candidates = [
    path.join(os.homedir(), 'AppData', 'Local', 'Thalamus'),
    path.join('C:\\', 'Program Files', 'Thalamus'),
    path.join('C:\\', 'Program Files (x86)', 'Thalamus'),
    exeDir,
  ];
  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, 'thalamus-vm-bridge.exe'))) {
      return dir;
    }
  }
  return exeDir;
}

// Start the VM bridge if not running
function startBridge() {
  const installDir = getInstallDir();
  const bridgeExe = path.join(installDir, 'thalamus-vm-bridge.exe');
  if (!fs.existsSync(bridgeExe)) return;

  // Check if bridge is already running
  exec('tasklist /fi "imagename eq thalamus-vm-bridge.exe" /fo csv /nh', (err, stdout) => {
    if (stdout && stdout.includes('thalamus-vm-bridge.exe')) {
      console.log('Bridge already running');
      return;
    }
    bridgeProcess = spawn(bridgeExe, [], {
      detached: true,
      stdio: 'ignore',
      cwd: installDir,
    });
    bridgeProcess.unref();
    console.log('Bridge started');
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    frame: false,
    titleBarStyle: 'hidden',
    backgroundColor: '#050a14',
    icon: path.join(__dirname, 'assets', 'icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: false, // Allow loading local resources
    },
    show: false,
  });

  // Load the renderer
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    mainWindow.maximize();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// IPC handlers for window controls
ipcMain.on('window-minimize', () => mainWindow?.minimize());
ipcMain.on('window-maximize', () => {
  if (mainWindow?.isMaximized()) mainWindow.unmaximize();
  else mainWindow?.maximize();
});
ipcMain.on('window-close', () => mainWindow?.close());

// IPC handler for opening external URLs
ipcMain.on('open-external', (event, url) => {
  shell.openExternal(url);
});

// IPC handler for getting install dir
ipcMain.handle('get-install-dir', () => getInstallDir());

// IPC handler for launching VNC
ipcMain.handle('launch-vnc', (event, port) => {
  const installDir = getInstallDir();
  const vncExe = path.join(installDir, 'tvnviewer.exe');
  if (fs.existsSync(vncExe)) {
    spawn(vncExe, [`localhost::${port}`], { detached: true, stdio: 'ignore' }).unref();
    return { ok: true };
  }
  return { ok: false, error: 'VNC viewer not found' };
});

// IPC handler for bridge status
ipcMain.handle('bridge-status', async () => {
  return new Promise((resolve) => {
    const req = http.get('http://localhost:3001/status', (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try { resolve({ ok: true, data: JSON.parse(data) }); }
        catch { resolve({ ok: true }); }
      });
    });
    req.on('error', () => resolve({ ok: false }));
    req.setTimeout(2000, () => { req.destroy(); resolve({ ok: false }); });
  });
});

// IPC handler for bridge commands
ipcMain.handle('bridge-command', async (event, command, args) => {
  return new Promise((resolve) => {
    const postData = JSON.stringify(args || {});
    const options = {
      hostname: 'localhost',
      port: 3001,
      path: `/${command}`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
      },
    };
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try { resolve({ ok: true, data: JSON.parse(data) }); }
        catch { resolve({ ok: true }); }
      });
    });
    req.on('error', (e) => resolve({ ok: false, error: e.message }));
    req.setTimeout(30000, () => { req.destroy(); resolve({ ok: false, error: 'timeout' }); });
    req.write(postData);
    req.end();
  });
});

app.whenReady().then(() => {
  // Start bridge in background
  startBridge();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
