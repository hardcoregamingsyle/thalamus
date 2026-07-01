# thalamus ai

yo, this is thalamus — an ai thing i made that can chat, do research, write code for you, and even boot up entire virtual machines. yeah, like full windows 11 in a window.

it runs in your browser **and** as a real windows app (c++, not electron garbage).

---

## what it does

**chat** — talk to an ai. it streams back responses in real time. nothing special these days but hey it works.

**research** — tell it a topic and it goes and researches stuff, comes back with citations and sources. i stole the idea from deep research lol.

**study** — upload your notes or pdfs or whatever, ask questions about them. uses something called RAG which is basically fancy search.

**code mode** — describe what you want built and 9 ai agents go through this pipeline thing:
researcher → analyser → planner → coder → optimiser → organiser → tester → hacker → critic

yeah 9 of them. each one has a different job. it takes a while but the results are actually insane.

**vm sandbox** (desktop only) — pick an os (windows 11, ubuntu, fedora, macos, android), pick how much ram/cpu, hit boot. it spins up qemu and you get a full vm with a vnc viewer built right into the app. no external tools needed. this was the hardest part to build ngl.

---

## the web app

built with react + vite + convex (backend). you can run it locally:

```bash
bun install
bun convex dev --once
bun run dev
```

you'll need a convex account and a deployment. the usual stuff.

---

## the desktop app (the cool part)

this is what i spent most of my time on. it's a **real native windows app** — qt 6 c++, compiled to a single .exe with nothing else needed.

### features

- every mode from the web app (chat, research, study, code)
- embedded vnc viewer — like vnc but built into a widget with qpainter. no idea if anyone else has done this
- system tray — minimize to tray and it keeps running in the background
- auto updater — checks github releases for new versions
- dark theme — spent way too long styling scrollbars
- one-click installer — msi that handles everything

### building it

you need visual studio 2022, qt 6.5+, and windows 10+. sorry linux people lol.

```cmd
cd thalamus-native
set CMAKE_PREFIX_PATH=C:\Qt\6.5.3\msvc2022_64
build.bat release
```

### building the installer

```cmd
build.bat installer
```

you need wix toolset v4 for this.

---

## what's inside

```
thalamus/
├── src/                    ← web app (react + convex)
│   ├── convex/            ← backend functions
│   ├── components/        ← react components
│   └── pages/             ← page routes
├── thalamus-native/        ← windows desktop app (qt 6 c++)
│   ├── ThalamusApp/src/   ← 32 source files
│   ├── installer/          ← wix msi config
│   └── build.bat          ← one-click build
├── qemu-bridge/            ← vm manager (node.js)
└── .github/workflows/      ← auto-builds on push
```

---

## the ai part

the model chain goes:
1. aws bedrock (claude opus etc)
2. google gemini 2.0 flash
3. some fallback thing called vly

it picks whatever's available and falls through if something fails. i didn't want to depend on one provider because they all randomly break sometimes.

---

## stuff that's janky/broken

- the app.ico file is a placeholder, i need a real icon
- the study mode upload doesn't actually send files to convex yet, just shows them in a list
- you need a windows machine to build the desktop app (obviously)
- the vnc widget doesn't have clipboard sync
- the auto-updater downloads the msi but doesn't verify signatures (lol)

---

## credits

- built with qt 6 — best gui framework, fight me
- backend is convex — their free tier is generous af
- vm emulation by qemu
- shoutout hack club for the motivation

---

made for windows. native. no electron. no regrets. 🚀
