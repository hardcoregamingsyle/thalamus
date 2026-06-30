# Thalamus AI — Native Windows Desktop App

**An AI desktop client that talks to a Convex backend, runs a 9-agent coding pipeline, and boots QEMU virtual machines with an embedded VNC viewer—all in one Win32 executable.**

*(Screenshot goes here — booting a Windows 11 VM in the embedded VNC viewer, with the Chat tab open on the side. Drop a clean 1920×1080 PNG in `assets/screenshot.png` and I'll link it.)*

---

## What is this?

Thalamus is a native Windows app (real C++, not Electron) that wraps several AI tools into one tabbed window. It's the desktop counterpart to the Thalamus web platform — except it also manages full QEMU virtual machines with a custom RFB 3.8 VNC client built right into the widget tree.

No webviews. No .NET. Just Qt 6, some WebSockets, and a lot of C++17.

---

## Quick start

If you just want to run it:

1. Download the latest `Thalamus-Setup-v1.0.0.msi` from Releases
2. Run it — it installs to `Program Files\Thalamus AI`
3. Open Thalamus, sign in with your email, and you're in

If you want to build it yourself (see [BUILD.md](BUILD.md) for the full ordeal):

```cmd
cd thalamus-native
set CMAKE_PREFIX_PATH=C:\Qt\6.5.3\msvc2022_64
build.bat release
```

Output lands in `dist\Thalamus.exe`.

---

## What it actually does

- **Chat** — Streaming AI chat over SSE. Type a message, get a streamed response. Markdown rendered live.
- **Research** — Same stream mechanism, but the backend searches sources and returns a report with citations. Has a little source tree panel that shows you where info came from.
- **Study** — Upload PDFs, text files, whatever. Ask questions. The backend does RAG over your uploaded materials.
- **Code Mode** — Describe a task in plain English. The backend runs it through a 9-agent pipeline: Researcher → Analyser → Planner → Coder → Optimiser → Organiser → Tester → Hacker → Critic. Each agent's status lights up in a tree widget as the pipeline progresses.
- **VM Sandbox** — Pick an OS (Windows 11, Ubuntu, Fedora, macOS, Android), set RAM and CPU cores, hit Boot. The app talks to a local VM bridge over WebSocket, which spins up QEMU. The display comes through an **embedded VNC client** — RFB 3.8, handled entirely in a QWidget with QPainter. Mouse and keyboard events get forwarded through the bridge.
- **System tray** — Minimize to tray, the app stays alive to manage the VM bridge in the background.
- **Auto-updater** — Checks GitHub Releases on startup, downloads new MSIs, launches installer.
- **Dark theme** — Entirely custom QSS stylesheet. Every widget styled by hand — scrollbars, tab bars, spin boxes, all of it.

---

## How it's built

This was a deliberate choice to **not** use Electron, Tauri, or any web-based desktop framework. The app talks to the Convex backend over plain HTTP/SSE for AI streaming, and to a local WebSocket bridge for VM control. The VNC client speaks RFB 3.8 natively — framebuffer updates come through the bridge as base64-encoded JSON, which gets decoded into a QImage and painted with QPainter. No libvnc, no external viewer.

The build uses CMake with static Qt 6 linking, producing a single `.exe` with no runtime dependencies beyond the VC++ redistributable. The MSI installer is built with WiX Toolset v4 and handles URI scheme registration (`thalamus://`), autostart for the VM bridge, and clean uninstall.

---

## Running locally

### Prerequisites (Windows 10+ only, sorry)

- Visual Studio 2022 with "Desktop development with C++"
- Qt 6.5+ (modules: Core, Gui, Widgets, Network, WebSockets, Svg, SvgWidgets, Concurrent)
- WiX Toolset v4 (only if building the installer)
- QEMU for Windows (only if using the VM sandbox)

### Build

```cmd
cd thalamus-native
build.bat          # debug
build.bat release  # release (static linking)
build.bat installer # release + MSI
```

### Environment

No environment variables needed unless you're changing the Convex backend URL — that's configurable in Settings → General at runtime.

---

## Credits

- Built on [Qt 6](https://www.qt.io) — best C++ GUI framework, fight me
- Backend runs on [Convex](https://convex.cloud)
- VM emulation by [QEMU](https://www.qemu.org)
- WiX Toolset v4 for the MSI packaging
- Shoutout to the Hack Club community for the build energy

---

*Made for Windows. Native. No Electron. No regrets.*
