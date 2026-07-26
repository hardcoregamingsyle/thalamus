# Quick Setup - Thalamus Virtualization

## 1. Install

There is no hosted install script. Earlier revisions of this file told you to
pipe `install.thalamus.dev` into a shell — that domain is not ours and never
was, so those commands are gone rather than fixed.

Build it from this directory:

```bash
cd qemu-bridge
npm install
npm run build
npm start
```

You need QEMU on PATH first — `brew install qemu` on macOS, `apt install qemu-system-x86`
on Debian/Ubuntu, or the official Windows build from qemu.org.

The desktop app does not need any of this: it drives QEMU directly through
`QemuBridgeManager.cs`, with no bridge process involved. This bridge exists only
for the web app, which talks to it on `ws://localhost:5900`.

## 2. Manual Install (Advanced)

```bash
cd qemu-bridge
npm install
npm run build
npm start
```

**Output should show:**
```
Thalamus Virtualization Engine v1.0.0
✓ Ready on ws://localhost:5900
✓ Hardware acceleration: enabled
✓ Connect from browser to launch VMs
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
- Make sure service is running: `cd qemu-bridge && npm start`
- Check WebSocket port 5900 is free: `lsof -i :5900` (Mac/Linux)

**"Virtualization runtime not found"**
- Re-run installer script
- Ensure hardware virtualization enabled in BIOS

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
