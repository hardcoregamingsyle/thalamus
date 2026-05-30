#!/bin/bash
echo "============================================"
echo " Thalamus VM Bridge - Linux Setup"
echo "============================================"
echo ""

# Check for Node.js
if ! command -v node &> /dev/null; then
    echo "[INFO] Node.js not found. Installing..."
    if command -v apt-get &> /dev/null; then
        sudo apt-get update && sudo apt-get install -y nodejs npm
    elif command -v dnf &> /dev/null; then
        sudo dnf install -y nodejs npm
    elif command -v pacman &> /dev/null; then
        sudo pacman -S nodejs npm
    else
        echo "[ERROR] Could not auto-install Node.js. Install from: https://nodejs.org"
        exit 1
    fi
fi

# Check for QEMU
if ! command -v qemu-system-x86_64 &> /dev/null; then
    echo "[INFO] QEMU not found. Installing..."
    if command -v apt-get &> /dev/null; then
        sudo apt-get install -y qemu-system-x86
    elif command -v dnf &> /dev/null; then
        sudo dnf install -y qemu-kvm
    elif command -v pacman &> /dev/null; then
        sudo pacman -S qemu
    else
        echo "[ERROR] Could not auto-install QEMU. Install from: https://www.qemu.org/download/#linux"
        exit 1
    fi
fi

# Create bridge directory
mkdir -p ~/thalamus-bridge
cd ~/thalamus-bridge

# Create package.json
echo '{"name":"thalamus-bridge","version":"1.0.0","main":"server.js"}' > package.json

# Create server.js
cat > server.js << 'EOF'
const WebSocket = require('ws');
const { spawn } = require('child_process');
const wss = new WebSocket.Server({ port: 5900 });
const vms = {};
let vmCounter = 0;
wss.on('connection', function(ws) {
  ws.on('message', function(msg) {
    try {
      const data = JSON.parse(msg);
      if (data.action === 'ping') {
        ws.send(JSON.stringify({ version: '1.0.0', platform: 'linux', activeVMs: Object.keys(vms).length }));
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
console.log('Thalamus VM Bridge running on ws://localhost:5900');
EOF

# Install ws
npm install ws --save 2>/dev/null

echo ""
echo "============================================"
echo " Setup complete! Starting bridge..."
echo " Keep this terminal open while using Thalamus"
echo "============================================"
echo ""
node server.js
