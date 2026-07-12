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

## VM images: official sources only, downloaded on demand

The sandbox ships **zero** operating systems. The catalog points exclusively at official, legally free images, and each one downloads on demand — with pause/resume — into `%LocalAppData%\Thalamus\ISOs`:

- **Windows 11 Pro / Windows 10 Pro** — Microsoft's own ISOs from [microsoft.com](https://www.microsoft.com/software-download/windows11). You download the genuine image and activate the VM with **your own Windows license key** (many people already have one; retail keys are cheap). Real, updatable Windows — no cracked "preactivated" builds.
- **Windows 11 Enterprise Evaluation** — Microsoft's own 90-day eval, no key required. The app opens the [Evaluation Center](https://www.microsoft.com/en-us/evalcenter/evaluate-windows-11-enterprise) and you point Thalamus at the file you downloaded.
- **Android-x86 9.0-r2** — the latest stable the [Android-x86 project](https://www.android-x86.org/) publishes, from their official SourceForge mirror.
- **BlissOS (Android 11)** — open-source Android from the [BlissOS project](https://sourceforge.net/projects/blissos-x86/files/Official/); grab the FOSS build and point Thalamus at it.
- **Ubuntu 24.04 LTS**, **Debian 12**, **Kali Linux** — straight from `releases.ubuntu.com`, `cdimage.debian.org`, and `cdimage.kali.org`.
- **Custom ISO** — anything you already own. Browse to the file, boot it.

No "preactivated" Windows, no macOS, no iOS, no sketchy mirrors — those are piracy, licence violations, or (in iOS's case) not a thing that exists. Windows runs on your own key; everything else is open source or an official eval. Every downloaded ISO shows its size and has its own delete button, and VM disks are sparse qcow2, so the sandbox only ever costs the space you actually use.

Your ISOs and VM disks live in your private `%LocalAppData%\Thalamus`, and the app locks that folder down to your Windows account on first run — other accounts on a shared PC can't read or delete your VMs. (A note on limits: Windows permissions are per-account, not per-program, so nothing can make a folder writable by *only* one .exe — anyone claiming otherwise is selling you DRM snake oil. What we do is real: cross-account isolation.)

---

## Just run it

1. Download the latest `Thalamus-Setup-*.exe` from Releases.
2. Run it. It installs under `%LocalAppData%\Thalamus`.
3. Open Thalamus, sign in with your email, done.

Uninstalling is just as clean: **Settings → Apps → Thalamus AI → Uninstall** (or run `ThalamusSetup.exe /uninstall` from the install folder). It removes the app, shortcuts, and registry entries, and asks before touching your VM disks and ISOs — leave the box unchecked and your VMs survive a reinstall.

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

- Deployment: `befitting-wildebeest-866`
- URL: `https://befitting-wildebeest-866.convex.cloud`

Change it in-app under Settings → General if you're running your own.
