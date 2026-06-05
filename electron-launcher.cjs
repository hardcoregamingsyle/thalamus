// Thalamus Launcher - starts Electron with the app
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

// Find the install directory
function getInstallDir() {
  const exeDir = path.dirname(process.execPath);
  // Check if electron.exe is here
  if (fs.existsSync(path.join(exeDir, 'electron.exe'))) return exeDir;
  // Check common install paths
  const candidates = [
    path.join(os.homedir(), 'AppData', 'Local', 'Thalamus'),
    path.join('C:\\', 'Program Files', 'Thalamus'),
    exeDir,
  ];
  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, 'electron.exe'))) return dir;
  }
  return exeDir;
}

const installDir = getInstallDir();
const electronExe = path.join(installDir, 'electron.exe');
const appDir = path.join(installDir, 'app');

if (!fs.existsSync(electronExe)) {
  const { execSync } = require('child_process');
  try {
    execSync(`powershell -Command "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.MessageBox]::Show('Thalamus is not installed correctly. Please run the installer again.', 'Thalamus AI', 'OK', 'Error')"`, { windowsHide: true });
  } catch(e) {}
  process.exit(1);
}

const child = spawn(electronExe, [appDir], {
  detached: true,
  stdio: 'ignore',
  cwd: installDir,
});
child.unref();
process.exit(0);
