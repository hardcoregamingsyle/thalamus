#!/bin/bash
set -e
echo "============================================"
echo " Thalamus VM Bridge - Linux Auto Setup"
echo " Everything installs automatically."
echo "============================================"
echo ""

BRIDGE_DIR="$HOME/thalamus-bridge"
mkdir -p "$BRIDGE_DIR"
cd "$BRIDGE_DIR"

# ---- Install Node.js if missing ----
if ! command -v node &> /dev/null; then
    echo "[1/4] Installing Node.js..."
    if command -v apt-get &> /dev/null; then
        curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
        sudo apt-get install -y nodejs
    elif command -v dnf &> /dev/null; then
        curl -fsSL https://rpm.nodesource.com/setup_20.x | sudo bash -
        sudo dnf install -y nodejs
    elif command -v pacman &> /dev/null; then
        sudo pacman -S --noconfirm nodejs npm
    else
        echo "[ERROR] Could not auto-install Node.js. Install from: https://nodejs.org"
        exit 1
    fi
fi
echo "[1/4] Node.js ready: $(node --version)"

# ---- Install QEMU if missing ----
if ! command -v qemu-system-x86_64 &> /dev/null; then
    echo "[2/4] Installing QEMU..."
    if command -v apt-get &> /dev/null; then
        sudo apt-get install -y qemu-system-x86
    elif command -v dnf &> /dev/null; then
        sudo dnf install -y qemu-kvm
    elif command -v pacman &> /dev/null; then
        sudo pacman -S --noconfirm qemu
    else
        echo "[ERROR] Could not auto-install QEMU. Install from: https://www.qemu.org/download/#linux"
        exit 1
    fi
fi
echo "[2/4] QEMU ready."

# ---- Create server.js ----
echo "[3/4] Setting up VM bridge server..."
cat > server.js << 'EOF'
const WebSocket = require('ws');
const { spawn } = require('child_process');
const wss = new WebSocket.Server({ port: 5900 });
const vms = {};
let vmCounter = 0;
console.log('Thalamus VM Bridge v1.0.0 running on ws://localhost:5900');
wss.on('connection', function(ws) {
  ws.on('message', function(msg) {
    try {
      const data = JSON.parse(msg);
      if (data.action === 'ping') {
        ws.send(JSON.stringify({ status: 'success', version: '1.0.0', platform: 'linux', activeVMs: Object.keys(vms).length }));
      } else if (data.action === 'boot') {
        const vmId = 'vm-' + (++vmCounter);
        const vncPort = 5900 + vmCounter;
        const proc = spawn('qemu-system-x86_64', ['-m', data.ram + 'M', '-smp', String(data.cores), '-vnc', ':' + vmCounter, '-enable-kvm']);
        vms[vmId] = proc;
        ws.send(JSON.stringify({ status: 'success', vmId, vncPort }));
      } else if (data.action === 'stop') {
        if (vms[data.vmId]) { vms[data.vmId].kill(); delete vms[data.vmId]; }
        ws.send(JSON.stringify({ status: 'success' }));
      }
    } catch(e) { ws.send(JSON.stringify({ status: 'error', message: e.message })); }
  });
});
EOF

# Install ws module
npm install ws --save 2>/dev/null

echo "[4/4] Setup complete!"
echo ""
echo "============================================"
echo " Starting Thalamus VM Bridge..."
echo " Keep this terminal open while using Thalamus"
echo "============================================"
echo ""
node server.js
