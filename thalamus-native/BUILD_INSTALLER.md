# Thalamus Native Windows App — Quick Start

**This is the native Win32 desktop app built with Qt 6 C++.**  
(Not a C# WPF app, not a WebView2 wrapper — true native Windows application.)

## What's New in v2.0

- **Replaced** C# WPF + WebView2 with **Qt 6 C++** (Win32 native)
- **Embedded VNC client** — RFB 3.8 protocol, no external VNC viewer needed
- **Direct QEMU process management** — via VM Bridge WebSocket
- **Full dark theme** — Custom QSS stylesheet
- **WiX MSI installer** — Industry-standard Windows installer
- **Self-contained** — Static linking, no .NET or Qt runtime required

## Build

```cmd
cd thalamus-native
set CMAKE_PREFIX_PATH=C:\Qt\6.5.3\msvc2022_64
build.bat release
```

See [BUILD.md](BUILD.md) for detailed instructions.
