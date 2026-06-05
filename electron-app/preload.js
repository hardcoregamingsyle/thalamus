const { contextBridge, ipcRenderer } = require('electron');

// Expose safe APIs to renderer
contextBridge.exposeInMainWorld('thalamus', {
  // Window controls
  minimize: () => ipcRenderer.send('window-minimize'),
  maximize: () => ipcRenderer.send('window-maximize'),
  close: () => ipcRenderer.send('window-close'),

  // System
  openExternal: (url) => ipcRenderer.send('open-external', url),
  getInstallDir: () => ipcRenderer.invoke('get-install-dir'),

  // VM Bridge
  bridgeStatus: () => ipcRenderer.invoke('bridge-status'),
  bridgeCommand: (command, args) => ipcRenderer.invoke('bridge-command', command, args),

  // VNC
  launchVnc: (port) => ipcRenderer.invoke('launch-vnc', port),

  // Platform info
  platform: process.platform,
  version: '1.0.0',
});
