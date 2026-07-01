@echo off
REM Thalamus AI — Push Native App to GitHub
REM Run this from the project root on your Windows machine.

setlocal enabledelayedexpansion

echo === Pushing Thalamus Native App to GitHub ===
echo.

REM Check if we're in the right directory
if not exist "thalamus-native\ThalamusApp\CMakeLists.txt" (
    echo ERROR: Run this from the project root (where thalamus-native/ lives)
    exit /b 1
)

REM Check git status
echo [1/4] Checking git status...
git status --short >nul 2>nul
if !ERRORLEVEL! neq 0 (
    echo ERROR: Not a git repository or git not installed.
    exit /b 1
)

REM Stage all native app files
echo [2/4] Staging thalamus-native files...
git add thalamus-native/
if !ERRORLEVEL! neq 0 (
    echo ERROR: Git add failed.
    exit /b 1
)

REM Commit
echo [3/4] Committing...
git commit -m "Add native Qt 6 C++ desktop app with WiX MSI installer

- Streaming AI chat, research, study, and code modes
- Embedded RFB 3.8 VNC client for QEMU VM sandbox
- Convex backend integration (HTTP/SSE/WebSocket)
- Email OTP authentication with token persistence
- Custom dark QSS theme across all widgets
- WiX Toolset v4 MSI with URI scheme and auto-update
- One-click build.bat (debug/release/installer)"

if !ERRORLEVEL! neq 0 (
    echo Nothing to commit or commit failed.
    exit /b 1
)

REM Push
echo [4/4] Pushing to GitHub...
git push
if !ERRORLEVEL! neq 0 (
    echo ERROR: Push failed. Check your remote and authentication.
    exit /b 1
)

echo.
echo === Done! Native app pushed to GitHub. ===
echo.
echo Next: Create a release with:
echo   gh release create v1.0.0 ^
echo       dist\Thalamus.exe ^
echo       dist\Thalamus-Setup-v1.0.0.msi ^
echo       --repo hardcoregamingsyle/thalamus ^
echo       --title "Thalamus AI v1.0.0 - Native Windows Desktop"
