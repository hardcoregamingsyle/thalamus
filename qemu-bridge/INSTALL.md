# Quick Setup - QEMU Bridge

## 1. Install QEMU

**Mac:**
```bash
brew install qemu
```

**Linux (Ubuntu/Debian):**
```bash
sudo apt update
sudo apt install qemu-system-x86 qemu-utils
```

**Windows:**
- Download: https://qemu.weilnetz.de/w64/
- Or: `choco install qemu`

## 2. Install & Run Bridge

```bash
cd qemu-bridge
npm install
npm run build
npm start
```

**Output should show:**
```
Thalamus QEMU Bridge v1.0.0
✓ Bridge ready on ws://localhost:5900
✓ Connect from browser to start VMs
```

## 3. Use from Thalamus

1. Go to Code Workspace → Sandbox tab
2. Select **Windows 11** or other 64-bit OS
3. Click **"Connect Bridge"**
4. Click **"Boot VM"**
5. Wait for VNC port message
6. Connect VNC viewer to shown port

## VNC Viewers

**Mac:** Built-in Screen Sharing
- Open Finder → Go → Connect to Server
- Enter: `vnc://localhost:5901`

**Windows:** RealVNC Viewer
- Download: https://www.realvnc.com/download/viewer/
- Connect to: `localhost:5901`

**Linux:**
```bash
sudo apt install tigervnc-viewer
vncviewer localhost:5901
```

## Troubleshooting

**"Bridge not connected"**
- Make sure bridge is running: `cd qemu-bridge && npm start`
- Check WebSocket port 5900 is free: `lsof -i :5900` (Mac/Linux)

**"QEMU not found"**
- Verify installation: `qemu-system-x86_64 --version`
- Add to PATH if needed

**VM boots but no display**
- VNC port is shown in toast notification
- Default: `localhost:5901` (first VM), `5902` (second VM), etc.
- Try different VNC client if one doesn't work

**Slow performance**
- Ensure virtualization enabled in BIOS (VT-x/AMD-V)
- Close other apps to free RAM
- Reduce VM RAM in Configure dialog

## Files Location

All VM data stored in:
- **Mac/Linux:** `~/.thalamus-qemu/`
- **Windows:** `C:\Users\YourName\.thalamus-qemu\`

Each OS gets:
- `{os}-disk.qcow2` - Virtual hard drive
- `{os}.iso` - Installation media (optional)

Disk images grow over time (up to 60GB per OS).
