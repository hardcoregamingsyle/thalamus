@echo off
echo ============================================
echo  Thalamus VM Bridge - Windows Setup
echo ============================================
echo.

:: Check for Node.js
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Node.js not found. Please install from https://nodejs.org
    echo After installing Node.js, run this script again.
    pause
    exit /b 1
)

:: Check for QEMU
where qemu-system-x86_64 >nul 2>&1
if %errorlevel% neq 0 (
    echo [INFO] QEMU not found. Installing via winget...
    winget install --id=SoftwareFreedomConservancy.QEMU -e --silent
    if %errorlevel% neq 0 (
        echo [ERROR] Could not auto-install QEMU.
        echo Please download from: https://www.qemu.org/download/#windows
        pause
        exit /b 1
    )
)

:: Create bridge directory
if not exist "%USERPROFILE%\thalamus-bridge" mkdir "%USERPROFILE%\thalamus-bridge"
cd /d "%USERPROFILE%\thalamus-bridge"

:: Create package.json
echo { "name": "thalamus-bridge", "version": "1.0.0", "main": "server.js" } > package.json

:: Create server.js
(
echo const WebSocket = require('ws');
echo const { exec, spawn } = require('child_process');
echo const wss = new WebSocket.Server({ port: 5900 });
echo const vms = {};
echo let vmCounter = 0;
echo wss.on('connection', function(ws) {
echo   ws.on('message', function(msg) {
echo     try {
echo       const data = JSON.parse(msg);
echo       if (data.action === 'ping') {
echo         ws.send(JSON.stringify({ version: '1.0.0', platform: 'windows', activeVMs: Object.keys(vms).length }));
echo       } else if (data.action === 'boot') {
echo         const vmId = 'vm-' + (++vmCounter);
echo         const vncPort = 5901 + vmCounter;
echo         const args = ['-m', data.ram + 'M', '-smp', data.cores, '-vnc', ':' + vmCounter, '-nographic'];
echo         const proc = spawn('qemu-system-x86_64', args);
echo         vms[vmId] = proc;
echo         ws.send(JSON.stringify({ status: 'success', vmId, vncPort }));
echo       } else if (data.action === 'stop') {
echo         if (vms[data.vmId]) { vms[data.vmId].kill(); delete vms[data.vmId]; }
echo         ws.send(JSON.stringify({ status: 'success' }));
echo       }
echo     } catch(e) { ws.send(JSON.stringify({ status: 'error', message: e.message })); }
echo   });
echo });
echo console.log('Thalamus VM Bridge running on ws://localhost:5900');
) > server.js

:: Install ws
call npm install ws --save 2>nul

echo.
echo ============================================
echo  Setup complete! Starting bridge...
echo ============================================
echo  Keep this window open while using Thalamus
echo ============================================
echo.
node server.js
pause
