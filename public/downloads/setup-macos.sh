#!/bin/bash
echo "============================================"
echo " Thalamus VM Bridge - macOS Setup"
echo "============================================"
echo ""

# Check for Node.js
if ! command -v node &> /dev/null; then
    echo "[ERROR] Node.js not found."
    echo "Install from: https://nodejs.org or run: brew install node"
    exit 1
fi

# Check for QEMU
if ! command -v qemu-system-x86_64 &> /dev/null; then
    echo "[INFO] QEMU not found. Installing via Homebrew..."
    if command -v brew &> /dev/null; then
        brew install qemu
    else
        echo "[ERROR] Homebrew not found. Install QEMU from: https://www.qemu.org/download/#macos"
        echo "Or install Homebrew first: /bin/bash -c \"\$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)\""
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
        ws.send(JSON.stringify({ version: '1.0.0', platform: 'macos', activeVMs: Object.keys(vms).length }));
      } else if (data.action === 'boot') {
        const vmId = 'vm-' + (++vmCounter);
        const vncPort = 5900 + vmCounter;
        const proc = spawn('qemu-system-x86_64', ['-m', data.ram + 'M', '-smp', String(data.cores), '-vnc', ':' + vmCounter]);
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
