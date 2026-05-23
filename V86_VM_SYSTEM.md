# v86 Virtual Machine System

## Overview

The platform now includes **real operating system virtualization** via WebAssembly x86 emulation. This means:

- ✅ **Real OS execution** - Actual Linux, Windows, or FreeDOS running in the browser
- ✅ **Hardware emulation** - Full x86 CPU, RAM, VGA, disk emulation
- ✅ **Code testing** - Test your app in real OS environments
- ✅ **Persistent state** - Save/restore VM snapshots
- ✅ **Multi-OS support** - Switch between different operating systems

---

## How It Works

### 1. WebAssembly Hardware Emulation

The v86 engine emulates a complete x86 PC in your browser:

```
┌─────────────────────────────────────┐
│         Browser Window              │
│  ┌───────────────────────────────┐  │
│  │    v86 WebAssembly Engine     │  │
│  │  ┌─────────────────────────┐  │  │
│  │  │  Virtual x86 Hardware   │  │  │
│  │  │  - CPU (x86)            │  │  │
│  │  │  - RAM (configurable)   │  │  │
│  │  │  - VGA Graphics         │  │  │
│  │  │  - Hard Disk            │  │  │
│  │  │  - CD-ROM               │  │  │
│  │  └─────────────────────────┘  │  │
│  │  ┌─────────────────────────┐  │  │
│  │  │   Guest Operating System │  │  │
│  │  │   (Linux/Windows/DOS)   │  │  │
│  │  └─────────────────────────┘  │  │
│  └───────────────────────────────┘  │
└─────────────────────────────────────┘
```

### 2. Boot Process

```
1. User selects OS (Alpine Linux, Debian, FreeDOS)
2. VM created with allocated RAM/VRAM
3. OS installer ISO mounted as CD-ROM
4. BIOS boots from CD-ROM
5. OS installation/live boot
6. User can interact with real OS
```

### 3. Command Execution Flow

```
Agent writes code
   ↓
Agent runs: <<RUN-CMD="npm install">>
   ↓
Command sent to VM via serial console
   ↓
Real Linux shell executes command
   ↓
Actual stdout/stderr returned
   ↓
Agent sees real output
   ↓
Agent fixes errors OR proceeds
```

---

## Available Operating Systems

### 🐧 Alpine Linux 3.19
- **RAM**: 512MB
- **VRAM**: 8MB
- **Use case**: Lightweight Node.js/Python testing
- **Boot time**: ~30 seconds
- **Features**: Full package manager (apk), fast boot

### 🐧 Debian 12 (32-bit)
- **RAM**: 1024MB
- **VRAM**: 16MB
- **Use case**: Full Linux environment
- **Boot time**: ~2 minutes
- **Features**: apt package manager, wide software support

### 💾 FreeDOS 1.3
- **RAM**: 64MB
- **VRAM**: 2MB
- **Use case**: Legacy DOS applications, retro testing
- **Boot time**: ~10 seconds
- **Features**: Fast, minimal, DOS command line

---

## VM Manager API

### Create VM

```typescript
import { vmManager } from "@/lib/v86Manager";

const vm = await vmManager.createVM({
  id: "my-vm",
  name: "Alpine Linux",
  os: "linux",
  memory: 512, // MB
  vga_memory: 8, // MB
  screen_container: containerElement,
  bios_url: "https://copy.sh/v86/bios/seabios.bin",
  vga_bios_url: "https://copy.sh/v86/bios/vgabios.bin",
  cdrom_url: "https://...alpine.iso"
});
```

### Execute Commands

```typescript
const result = await vmManager.executeCommand(
  "my-vm",
  "npm install && npm run build"
);

console.log(result.stdout); // Real output
console.log(result.exitCode); // Real exit code
```

### Sync Files

```typescript
await vmManager.syncFilesToVM("my-vm", [
  { path: "/home/daytona/app/index.js", content: "..." },
  { path: "/home/daytona/app/package.json", content: "..." }
]);
```

### Save/Restore State

```typescript
// Save VM snapshot
const state = await vmManager.saveState("my-vm");
localStorage.setItem("vm-snapshot", state);

// Restore VM snapshot
const state = localStorage.getItem("vm-snapshot");
await vmManager.restoreState("my-vm", state);
```

---

## VM Screen Component

### Basic Usage

```tsx
import { VMScreen } from "@/components/VMScreen";

function CodeMode() {
  return (
    <VMScreen
      sessionId="session-123"
      onCommandOutput={(output, exitCode) => {
        console.log("Command output:", output);
      }}
    />
  );
}
```

### Features

- **OS Selector**: Choose from pre-configured OS templates
- **VM Controls**: Start, Stop, Pause, Resume, Reset
- **State Management**: Save/Load VM snapshots
- **Live Display**: Real-time screen output on canvas
- **Status Indicators**: Boot state, RAM usage, uptime

---

## Integration with Code Mode

### Agent Pipeline

Agents can now use real VMs:

```
Coder Agent:
  - Creates React app files
  - Syncs files to VM
  - Runs: npm install
  - VM executes in real Linux
  - Output: "added 1423 packages"
  - Runs: npm run build
  - VM executes Vite build
  - Output: "✓ built in 3.2s"
  - Success → Proceed to next agent

Tester Agent:
  - Syncs test files to VM
  - Runs: npm test
  - VM executes real tests
  - Output: "12 tests passed"
  - Marks: <<test.success>>
```

### Command Execution

Replace Daytona calls with v86:

**Before (Daytona):**
```typescript
const result = await executeSandboxCommand(
  daytonaId,
  "npm install"
);
// May timeout, may hallucinate
```

**After (v86):**
```typescript
const result = await vmManager.executeCommand(
  vmId,
  "npm install"
);
// Real OS, real output, always accurate
```

---

## Performance Considerations

### Boot Time
- **FreeDOS**: 10 seconds (fastest)
- **Alpine Linux**: 30 seconds (recommended)
- **Debian**: 2 minutes (full featured)

### Resource Usage
- **Memory**: Allocate based on OS needs
- **CPU**: Uses host CPU via JIT compilation
- **Disk**: Virtual disks stored in IndexedDB

### Optimization Tips
1. **Use Alpine for fast iterations** - Boots quickly, has package managers
2. **Save VM states** - Don't reboot every time
3. **Pre-install dependencies** - Create snapshots with common packages
4. **Limit concurrent VMs** - 2-3 VMs max for smooth performance

---

## Storage

### Virtual Hard Disks

VMs use virtual disk images stored in browser:

```
IndexedDB
├── vm_session123_hda.img (hard disk)
├── vm_session123_state.bin (saved state)
└── vm_session456_hda.img (different session)
```

### Persistence

- **Automatic**: Changes saved to IndexedDB
- **Manual**: Export VM state as file
- **Cross-session**: Each session gets own VM
- **Cleanup**: Old VMs auto-deleted after 30 min inactive

---

## Security

### Sandboxing

✅ **v86 runs in WebAssembly sandbox**
- Cannot access real filesystem
- Cannot access host network directly
- Cannot escape browser security

✅ **Isolated per session**
- Each project gets own VM
- No cross-contamination
- Clean slate per boot

---

## Future Enhancements

### Phase 2 (Coming Soon)
- [ ] Windows 98/2000 support
- [ ] GPU acceleration for graphics
- [ ] Network emulation (NAT)
- [ ] USB device passthrough
- [ ] Multi-display support

### Phase 3 (Future)
- [ ] VM clusters (multiple VMs working together)
- [ ] Cross-OS testing matrix
- [ ] CI/CD integration
- [ ] Cloud VM persistence

---

## Troubleshooting

### VM Won't Boot
- Check ISO URL is accessible
- Ensure sufficient RAM allocated
- Try different OS (Alpine is most reliable)

### Commands Time Out
- Increase timeout (default 30s)
- Check VM is fully booted
- Verify command is valid in guest OS

### Slow Performance
- Reduce RAM allocation (less to emulate)
- Use Alpine instead of Debian
- Close other VMs
- Use VM snapshots to skip boot

---

## Summary

**Before**: Unreliable Daytona sandbox with timeouts and hallucinations

**After**: Real operating systems running in browser via WebAssembly
- ✅ True hardware emulation
- ✅ Actual command execution
- ✅ Multi-OS support
- ✅ Persistent environments
- ✅ Save/restore snapshots

This gives users **real confidence** that their code actually works across different operating systems.
