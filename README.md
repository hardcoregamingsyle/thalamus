# thalamus ai

yo this is thalamus its an ai thing i made that can chat do research write code for you and even boot up ENTIRE VIRTUAL MACHINES like full windows 11 in a window. took me like 3 weeks of straight coding

it runs in your browser AND as a real windows app (c++ not electron garbage)

---

## what it does

**chat** - talk to an ai it streams back responses nothing special these days but it works

**research** - tell it a topic and it researches stuff comes back with sources lol i stole the idea from deep research

**study** - upload ur notes or pdfs whatever u have ask questions about them uses RAG which is basically fancy search idk how to explain it better

**code mode** - describe what u want built in plain english and 9 ai agents run through a whole pipeline thing:

researcher -> analyser -> planner -> coder -> optimiser -> organiser -> tester -> hacker -> critic

yeah 9 of them each one has a different job IT TAKES A WHILE but the results are actually insane

**vm sandbox** (desktop only) - pick an os (windows 11, ubuntu, fedora, macos, ANDROID), pick how much ram/cpu, hit boot. it spins up qemu and you get a FULL vm with a vnc viewer built right into the app. no external tools this was the hardest part to build ngl

---

## web app

built w/ react + vite + convex. run it:

```bash
bun install
bun convex dev --once
bun run dev
```

you need a convex account the usual stuff

---

## the DESKTOP app (the cool part)

this is what i spent most of my time on. its a real native windows app - qt 6 c++ compiled to a single .exe

- every mode from web app (chat, research, study, code)
- embedded vnc viewer - like vnc but built into a widget with qpainter no idea if anyone else has done this tbh
- system tray - minimize to tray it keeps running in the bg
- auto updater - checks github releases for new versions
- dark theme - spent wayyyy too long styling scrollbars
- one-click installer - msi that handles everything

### building it (windows only sorry linux)

```
cd thalamus-native
set CMAKE_PREFIX_PATH=C:\Qt\6.5.3\msvc2022_64
build.bat release
```

### building the installer

```
build.bat installer
```

need wix toolset v4 for the msi

---

## what's inside (the files n stuff)

```
thalamus/
├── src/                    ← web app
│   ├── convex/            ← backend
│   ├── components/        ← react stuff
│   └── pages/             ← pages
├── thalamus-native/        ← windows app (qt 6 c++)
│   ├── ThalamusApp/src/   ← 32 source files lmao
│   ├── installer/          ← msi config
│   └── build.bat          ← build script
├── qemu-bridge/            ← vm thing
└── .github/workflows/      ← auto builds on push
```

---

## ai stuff

models go:
1. aws bedrock (claude opus etc)
2. google gemini 2.0 flash
3. some fallback called vly

picks whatever works and falls through if something fails. i didnt want to depend on one provider cuz they ALL randomly break

---

## stuff thats broken/janky

- the app.ico is just a placeholder i need a real icon
- study upload doesnt actually send files to convex yet just shows them in a list lol
- vnc widget doesnt do clipboard sync
- auto-updater downloads the msi but doesnt verify signatures (whoops)
- no tests for the desktop app yet
- probably memory leaks somewhere

---

## credits

- qt 6 - best gui framework fight me
- convex backend - their free tier is actually generous af
- qemu for vm stuff
- hack club for the motivation tbh

---

made for windows. native. no electron. no regrets. 🚀

*this readme was definitely not written by ai trust me bro*