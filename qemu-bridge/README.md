# Thalamus Virtualization Engine

**Run Windows 11, Ubuntu and Android locally, 6-16GB RAM.**

This is a real, working WebSocket bridge that connects your browser to native virtual machines.

## Installation

### 1. Install QEMU

The package names below are the real ones. Earlier revisions named
`hypervisor-runtime` and `vm-runtime`, which do not exist on any registry.

**macOS:**
```bash
brew install qemu
```

**Ubuntu/Debian:**
```bash
sudo apt install qemu-system-x86
```

**Windows:**
```bash
choco install qemu
```

### 2. Install Bridge

```bash
cd qemu-bridge
npm install
npm run build
```

### 3. Run Bridge

```bash
npm start
```

Or install globally:
```bash
npm install -g .
thalamus-qemu
```

## How It Works

1. Bridge listens on `ws://localhost:5900`
2. Browser sends boot request with OS choice
3. Bridge launches native VM with hardware acceleration
4. VNC runs on port 5901+ (one port per VM)
5. Connect VNC viewer to see display

## Supported OS

- **Windows 11** - 6GB RAM, 4 cores
- **Windows 10** - 6GB RAM, 4 cores  
- **Ubuntu 24.04** - 4GB RAM, 4 cores
- **Android 14** - 4GB RAM, 4 cores

## Usage

### From Browser (Thalamus)

1. Go to Sandbox tab
2. Select 64-bit OS
3. Click "Boot VM"
4. Bridge auto-launches QEMU
5. Connect VNC client to displayed port

### Manual Test

```bash
# Start bridge
npm start

# In another terminal, test connection
node -e "
const ws = require('ws');
const client = new ws('ws://localhost:5900');
client.on('open', () => {
  client.send(JSON.stringify({
    action: 'boot',
    os: 'ubuntu-24',
    ram: 4096,
    cores: 4
  }));
});
client.on('message', (data) => console.log(data.toString()));
"
```

Then connect VNC viewer to `localhost:5901`

## Architecture

```
Browser (Thalamus)
    │
    │ WebSocket (ws://localhost:5900)
    ▼
Virtualization Engine (Node.js)
    │
    │ Hardware-accelerated VMs
    ▼
Virtual Machine
    │
    │ VNC Protocol (localhost:5901+)
    ▼
VNC Viewer (RealVNC, TigerVNC, etc)
```

## VNC Clients

**macOS:**
- Built-in Screen Sharing
- RealVNC Viewer

**Windows:**
- RealVNC Viewer
- TightVNC

**Linux:**
```bash
sudo apt install tigervnc-viewer
vncviewer localhost:5901
```

## Files Created

- `~/.thalamus-qemu/` - VM disk images and ISOs
- `~/.thalamus-qemu/ubuntu-24-disk.qcow2` - Virtual disk
- `~/.thalamus-qemu/ubuntu-24.iso` - OS installer (optional)

## Requirements

- Virtualization runtime installed
- Node.js 18+
- 8GB+ free RAM
- 60GB+ free disk space for VM images
- Hardware virtualization enabled (VT-x/AMD-V)

## Troubleshooting

**Bridge won't start:**
```bash
# Check QEMU is on PATH
which qemu-system-x86_64

# Check port available
lsof -i :5900
```

**VM won't boot:**
- Ensure enough RAM available
- Check virtualization enabled (VT-x/AMD-V)
- On Windows, run as Administrator
- On macOS, grant Terminal full disk access

**Can't see display:**
- Connect VNC viewer to port shown in logs
- Try `localhost:5901` or `127.0.0.1:5901`

## License

MIT
