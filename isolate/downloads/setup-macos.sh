#!/bin/bash
set -e
echo "============================================"
echo " Thalamus VM Bridge - macOS Auto Setup"
echo " Everything installs automatically."
echo "============================================"
echo ""

BRIDGE_DIR="$HOME/thalamus-bridge"
mkdir -p "$BRIDGE_DIR"
cd "$BRIDGE_DIR"

# ---- Install Homebrew if missing ----
if ! command -v brew &> /dev/null; then
    echo "[1/4] Installing Homebrew (required for QEMU)..."
    /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
    # Add brew to PATH for Apple Silicon
    if [ -f "/opt/homebrew/bin/brew" ]; then
        eval "$(/opt/homebrew/bin/brew shellenv)"
    fi
fi
echo "[1/4] Homebrew ready."

# ---- Install Node.js if missing ----
if ! command -v node &> /dev/null; then
    echo "[2/4] Installing Node.js..."
    brew install node
fi
echo "[2/4] Node.js ready: $(node --version)"

# ---- Install QEMU if missing ----
if ! command -v qemu-system-x86_64 &> /dev/null; then
    echo "[3/4] Installing QEMU..."
    brew install qemu
fi
echo "[3/4] QEMU ready: $(qemu-system-x86_64 --version | head -1)"

# ---- Create server.js ----
echo "[4/4] Setting up VM bridge server..."
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
        ws.send(JSON.stringify({ status: 'success', version: '1.0.0', platform: 'macos', activeVMs: Object.keys(vms).length }));
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
EOF

# Install ws module
npm install ws --save 2>/dev/null

echo ""
echo "============================================"
echo " Setup complete! Starting bridge..."
echo " Keep this terminal open while using Thalamus"
echo "============================================"
echo ""
node server.js
