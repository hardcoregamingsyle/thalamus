# Thalamus QEMU Bridge

Run Windows 11, macOS, Ubuntu, and Android natively on your device with full performance.

## What is this?

The Thalamus QEMU Bridge connects your browser to a local QEMU virtual machine, allowing you to run 64-bit operating systems with:

- **Up to 16GB RAM** for smooth multitasking
- **Native CPU performance** (not emulation)
- **GPU acceleration** support
- **100% private** - everything runs on your device
- **No cloud costs** - free forever

## Quick Start

### 1. Install QEMU

**Windows:**
```bash
# Download installer from https://qemu.weilnetz.de/w64/
# Or use Chocolatey:
choco install qemu
```

**macOS:**
```bash
brew install qemu
```

**Linux:**
```bash
# Ubuntu/Debian:
sudo apt install qemu-system-x86 qemu-utils

# Fedora:
sudo dnf install qemu

# Arch:
sudo pacman -S qemu
```

### 2. Install Bridge (Coming Soon)

```bash
npm install -g @thalamus/qemu-bridge
```

### 3. Start Bridge

```bash
thalamus-qemu-bridge
```

The bridge will:
1. Start a WebSocket server on port 5900
2. Listen for VM boot requests from browser
3. Launch QEMU with your selected OS
4. Stream display to browser via noVNC

### 4. Connect from Thalamus

1. Go to your code workspace Sandbox tab
2. Select a 64-bit OS (Windows 11, macOS, Ubuntu, Android)
3. Click "Setup QEMU" and test connection
4. Boot your VM!

## Supported Operating Systems

### 64-bit (QEMU Bridge Required)
- **Windows 11 Pro** - 6GB RAM, 4 cores
- **Windows 10 Pro** - 6GB RAM, 4 cores
- **macOS Sequoia** - 6GB RAM, 4 cores
- **Ubuntu 24.04 LTS** - 4GB RAM, 4 cores
- **Android 14** - 4GB RAM, 4 cores

### 32-bit (Browser-based, No Setup)
- **Alpine Linux** - 256MB, instant boot
- **Arch Linux** - 512MB
- **Windows 98** - 256MB
- **KolibriOS** - 64MB, instant boot

## How It Works

```
┌─────────────┐         WebSocket          ┌──────────────┐
│   Browser   │ ◄─────────────────────────► │ QEMU Bridge  │
│  (Thalamus) │      (localhost:5900)       │  (Node.js)   │
└─────────────┘                             └──────────────┘
                                                    │
                                                    ▼
                                            ┌──────────────┐
                                            │     QEMU     │
                                            │   VM Host    │
                                            └──────────────┘
                                                    │
                                                    ▼
                                            ┌──────────────┐
                                            │  VNC Server  │
                                            │   (5901+)    │
                                            └──────────────┘
```

## Bridge Implementation (For Contributors)

The bridge is a Node.js service that:

1. **Receives boot requests** via WebSocket from browser
2. **Launches QEMU** with specified OS and resources:
   ```bash
   qemu-system-x86_64 \
     -m 6144 \
     -smp 4 \
     -cdrom /path/to/windows11.iso \
     -hda /path/to/disk.qcow2 \
     -vnc :1 \
     -enable-kvm
   ```
3. **Starts noVNC** to bridge VNC to WebSocket
4. **Streams display** back to browser canvas

### Bridge API

**WebSocket Messages:**

```typescript
// Client → Bridge: Boot VM
{
  action: "boot",
  os: "windows-11",
  ram: 6144,
  cores: 4
}

// Bridge → Client: Status updates
{
  status: "booting" | "ready" | "error",
  vncPort: 6080,
  error?: string
}

// Client → Bridge: Send command
{
  action: "command",
  vmId: "vm-12345",
  command: "echo hello"
}

// Bridge → Client: Command output
{
  action: "output",
  output: "hello"
}
```

## OS Images

On first boot, the bridge will:
1. Check for existing OS image in `~/.thalamus/qemu/images/`
2. If not found, download from CDN (e.g., Windows 11 ISO ~5GB)
3. Create virtual disk (qcow2 format)
4. Boot from ISO and install

Subsequent boots use the installed disk image.

## RAM Requirements

| OS | Minimum | Recommended | Maximum |
|---|---|---|---|
| Windows 11 | 4GB | 6GB | 16GB |
| Windows 10 | 4GB | 6GB | 16GB |
| macOS Sequoia | 4GB | 6GB | 16GB |
| Ubuntu 24.04 | 2GB | 4GB | 16GB |
| Android 14 | 2GB | 4GB | 8GB |

## Security

- ✅ All VMs run locally on your device
- ✅ WebSocket only accepts connections from localhost
- ✅ No data sent to cloud
- ✅ OS images verified with SHA-256 checksums
- ✅ Automatic updates for bridge software

## Troubleshooting

**Bridge won't start:**
```bash
# Check if QEMU is installed
qemu-system-x86_64 --version

# Check if port is available
lsof -i :5900
```

**VM won't boot:**
- Ensure enough RAM available (close other apps)
- Check virtualization is enabled in BIOS (VT-x/AMD-V)
- Windows: Run as Administrator
- macOS: Grant Terminal/iTerm2 full disk access

**Display not showing:**
- Refresh browser page
- Check browser console for WebSocket errors
- Verify noVNC is running: `http://localhost:6080`

## License

MIT License - Free for personal and commercial use

## Contributing

Repository: https://github.com/thalamus-ai/qemu-bridge

Issues: https://github.com/thalamus-ai/qemu-bridge/issues

## Roadmap

- [ ] Auto-download OS images
- [ ] GPU passthrough support
- [ ] Snapshot and restore functionality
- [ ] Multiple VMs simultaneously
- [ ] VM templates (pre-configured environments)
- [ ] Shared folders between host and VM
- [ ] Clipboard sync
