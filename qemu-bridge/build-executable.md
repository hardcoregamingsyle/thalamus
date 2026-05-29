# Build Single Executable

This builds a standalone executable that bundles Node.js + bridge code into ONE file.

## What It Does

- **Single file download** - No Node.js installation needed
- **Double-click to run** - No terminal commands
- **Auto-starts bridge** - WebSocket server ready immediately
- **Bundles everything** - Node.js runtime + all dependencies included

## Build Commands

### Windows (thalamus-vm.exe)

```bash
npm install -g pkg
cd qemu-bridge
npm install
pkg . --targets node18-win-x64 --output dist/thalamus-vm-windows.exe
```

### macOS (thalamus-vm)

```bash
pkg . --targets node18-macos-x64 --output dist/thalamus-vm-macos
```

### Linux (thalamus-vm)

```bash
pkg . --targets node18-linux-x64 --output dist/thalamus-vm-linux
```

## File Sizes

- Windows: ~50MB (includes Node.js runtime)
- macOS: ~50MB
- Linux: ~45MB

## User Experience

### Before (Complex):
1. Install Node.js
2. Open terminal
3. Run npm install
4. Run npm start
5. Debug errors
6. Finally works

### After (Simple):
1. Download `thalamus-vm.exe`
2. Double-click
3. Done! Bridge running

## Auto-Launch on Web Request

We can also register a protocol handler so the web can launch it:

```
thalamus://launch-vm
```

This would:
1. Check if executable is running
2. If not, launch it automatically
3. Web connects to localhost:5900
4. User boots VM

## Distribution

Upload executables to:
- GitHub Releases
- CDN (CloudFlare R2)
- Direct download from Thalamus website

### Download URLs:
```
https://thalamus.dev/downloads/windows/thalamus-vm.exe
https://thalamus.dev/downloads/macos/thalamus-vm
https://thalamus.dev/downloads/linux/thalamus-vm
```

## Auto-Update

The executable can check for updates on startup:
```javascript
const currentVersion = "1.0.0";
const latestVersion = await fetch("https://thalamus.dev/api/vm-version").then(r => r.json());

if (latestVersion > currentVersion) {
  console.log("Update available! Download from: https://thalamus.dev/downloads");
}
```
