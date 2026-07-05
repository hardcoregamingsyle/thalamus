@echo off
setlocal enabledelayedexpansion
title Thalamus VM Bridge Setup
echo ============================================
echo  Thalamus VM Bridge - Windows Auto Setup
echo ============================================
echo  This will automatically install everything.
echo  No manual steps required.
echo ============================================
echo.

set "BRIDGE_DIR=%USERPROFILE%\thalamus-bridge"
set "NODE_DIR=%BRIDGE_DIR%\node"
set "QEMU_DIR=%BRIDGE_DIR%\qemu"
set "NODE_EXE=%NODE_DIR%\node.exe"
set "NPM_CMD=%NODE_DIR%\npm.cmd"

:: Create bridge directory
if not exist "%BRIDGE_DIR%" mkdir "%BRIDGE_DIR%"
cd /d "%BRIDGE_DIR%"

:: ---- Install Node.js (portable, no admin required) ----
if not exist "%NODE_EXE%" (
    echo [1/4] Downloading Node.js portable...
    powershell -Command "& { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -Uri 'https://nodejs.org/dist/v20.11.0/node-v20.11.0-win-x64.zip' -OutFile '%BRIDGE_DIR%\node.zip' -UseBasicParsing }"
    if not exist "%BRIDGE_DIR%\node.zip" (
        echo [ERROR] Failed to download Node.js. Check your internet connection.
        pause & exit /b 1
    )
    echo [1/4] Extracting Node.js...
    powershell -Command "Expand-Archive -Path '%BRIDGE_DIR%\node.zip' -DestinationPath '%BRIDGE_DIR%\node_tmp' -Force"
    for /d %%i in ("%BRIDGE_DIR%\node_tmp\node-*") do (
        move "%%i" "%NODE_DIR%" >nul 2>&1
    )
    del "%BRIDGE_DIR%\node.zip" >nul 2>&1
    rmdir /s /q "%BRIDGE_DIR%\node_tmp" >nul 2>&1
    echo [1/4] Node.js ready.
) else (
    echo [1/4] Node.js already installed.
)

:: ---- Install QEMU (portable) ----
if not exist "%QEMU_DIR%\qemu-system-x86_64.exe" (
    echo [2/4] Downloading QEMU for Windows...
    powershell -Command "& { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -Uri 'https://github.com/nicowillis/qemu-windows-portable/releases/download/v8.2.0/qemu-8.2.0-windows-portable.zip' -OutFile '%BRIDGE_DIR%\qemu.zip' -UseBasicParsing }"
    if not exist "%BRIDGE_DIR%\qemu.zip" (
        echo [WARN] Could not download portable QEMU. Trying winget...
        winget install --id=SoftwareFreedomConservancy.QEMU -e --silent 2>nul
        if %errorlevel% neq 0 (
            echo [ERROR] Could not install QEMU automatically.
            echo Please install QEMU from: https://www.qemu.org/download/#windows
            pause & exit /b 1
        )
        set "QEMU_DIR=C:\Program Files\qemu"
    ) else (
        echo [2/4] Extracting QEMU...
        powershell -Command "Expand-Archive -Path '%BRIDGE_DIR%\qemu.zip' -DestinationPath '%QEMU_DIR%' -Force"
        del "%BRIDGE_DIR%\qemu.zip" >nul 2>&1
    )
    echo [2/4] QEMU ready.
) else (
    echo [2/4] QEMU already installed.
)

:: ---- Create server.js ----
echo [3/4] Setting up VM bridge server...
(
echo const WebSocket = require^('ws'^);
echo const { spawn } = require^('child_process'^);
echo const path = require^('path'^);
echo const wss = new WebSocket.Server^({ port: 5900 }^);
echo const vms = {};
echo let vmCounter = 0;
echo const qemuPath = path.join^(__dirname, 'qemu', 'qemu-system-x86_64.exe'^);
echo const qemuCmd = require^('fs'^).existsSync^(qemuPath^) ? qemuPath : 'qemu-system-x86_64';
echo console.log^('Thalamus VM Bridge v1.0.0 running on ws://localhost:5900'^);
echo console.log^('QEMU path: ' + qemuCmd^);
echo wss.on^('connection', function^(ws^) {
echo   ws.on^('message', function^(msg^) {
echo     try {
echo       const data = JSON.parse^(msg^);
echo       if ^(data.action === 'ping'^) {
echo         ws.send^(JSON.stringify^({ status: 'success', version: '1.0.0', platform: 'windows', activeVMs: Object.keys^(vms^).length }^)^);
echo       } else if ^(data.action === 'boot'^) {
echo         const vmId = 'vm-' + ^(++vmCounter^);
echo         const vncPort = 5900 + vmCounter;
echo         const proc = spawn^(qemuCmd, ['-m', data.ram + 'M', '-smp', String^(data.cores^), '-vnc', ':' + vmCounter]^);
echo         vms[vmId] = proc;
echo         ws.send^(JSON.stringify^({ status: 'success', vmId, vncPort }^)^);
echo       } else if ^(data.action === 'stop'^) {
echo         if ^(vms[data.vmId]^) { vms[data.vmId].kill^(^); delete vms[data.vmId]; }
echo         ws.send^(JSON.stringify^({ status: 'success' }^)^);
echo       }
echo     } catch^(e^) { ws.send^(JSON.stringify^({ status: 'error', message: e.message }^)^); }
echo   }^);
echo }^);
) > server.js

:: ---- Install ws module ----
echo [3/4] Installing ws module...
"%NODE_EXE%" "%NODE_DIR%\node_modules\npm\bin\npm-cli.js" install ws --save --prefix "%BRIDGE_DIR%" 2>nul
if not exist "%BRIDGE_DIR%\node_modules\ws" (
    "%NODE_EXE%" -e "const https=require('https'),fs=require('fs'),path=require('path');const d=path.join('%BRIDGE_DIR%','node_modules','ws');if(!fs.existsSync(d)){console.log('Downloading ws...');}" 2>nul
    "%NPM_CMD%" install ws --save 2>nul
)

:: ---- Create start script ----
(
echo @echo off
echo cd /d "%BRIDGE_DIR%"
echo "%NODE_EXE%" server.js
echo pause
) > start-bridge.bat

echo [4/4] Setup complete!
echo.
echo ============================================
echo  Starting Thalamus VM Bridge...
echo  Keep this window open while using Thalamus
echo ============================================
echo.
"%NODE_EXE%" server.js
pause
