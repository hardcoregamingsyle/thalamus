# Thalamus — Windows desktop app

A native Windows app that puts four AI tools and a full VM sandbox in one window. WPF on .NET 8. Ships as a single self-contained `.exe` — nothing to install alongside it, no runtime to chase down.

> If you find an old note claiming this is a "Qt 6 C++" or "Win32 native" app: it isn't, and hasn't been. It's C#/WPF. That doc was fiction. This one isn't.

---

## What it does

- **Chat** — streaming AI chat over SSE. Markdown renders as it arrives.
- **Research** — same streaming, but the backend searches the web and hands back a report with the sources it used.
- **Study** — drop in PDFs and notes, ask questions, get answers grounded in *your* files (RAG).
- **Code** — describe what you want in plain English; a 9-agent pipeline (Researcher → Analyser → Planner → Coder → Optimiser → Organizer → Tester → Hacker → Critic) plans it, writes it, tests it, and tears it apart looking for bugs.
- **VM Sandbox** — pick an OS, set RAM and cores, hit boot. It runs a real QEMU virtual machine and draws the screen right inside the app with a built-in VNC client. No external viewer.

Plus the quiet stuff that makes it feel finished: system-tray minimize, and an auto-updater that watches GitHub Releases and updates itself.

---

## Just run it

1. Download the latest `Thalamus-Setup-*.exe` from Releases.
2. Run it. It installs under `%LocalAppData%\Thalamus`.
3. Open Thalamus, sign in with your email, done.

## Build it yourself

You need the **.NET 8 SDK**. Then:

```powershell
cd thalamus-native
.\build.ps1
```

Full details, flags, and the by-hand commands are in [BUILD.md](BUILD.md).

---

## How it's wired

The app talks to the [Convex](https://convex.cloud) backend over HTTP and SSE — chat and research stream token-by-token; study and code lean on the backend's RAG and agent pipeline. The VM Sandbox is the fun part: `QemuBridgeManager` launches QEMU directly (native C#, no Node bridge), and an embedded RFB 3.8 VNC client decodes framebuffer updates and paints them onto the sandbox surface. Point it at a different backend anytime in **Settings → General** — no rebuild.

Everything publishes self-contained and single-file, so the shipped binary has zero runtime dependencies. A clean build is 0 warnings, 0 errors, and it stays that way.

---

## Backend

- Deployment: `glad-ermine-937`
- URL: `https://glad-ermine-937.convex.cloud`

Change it in-app under Settings → General if you're running your own.
