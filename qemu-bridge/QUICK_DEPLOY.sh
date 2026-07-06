#!/bin/bash

# Quick Deploy Script for Thalamus VM Launcher
# This builds and uploads the executable to GitHub Releases

set -e

echo "🔨 Building executables..."

# Build TypeScript
npm run build

# Build executables (this takes 2-5 minutes)
npx pkg . --targets node18-win-x64 --output builds/thalamus-vm-windows.exe
echo "✅ Windows executable built"

npx pkg . --targets node18-macos-x64 --output builds/thalamus-vm-macos
echo "✅ macOS executable built"

npx pkg . --targets node18-linux-x64 --output builds/thalamus-vm-linux
echo "✅ Linux executable built"

# Check file sizes
echo ""
echo "📦 File sizes:"
ls -lh builds/

echo ""
echo "✅ Build complete!"
echo ""
echo "📤 Next steps:"
echo "1. Create GitHub repo: gh repo create thalamus-vm --public"
echo "2. Upload to releases:"
echo "   gh release create v1.0.0 \\"
echo "     builds/thalamus-vm-windows.exe \\"
echo "     builds/thalamus-vm-macos \\"
echo "     builds/thalamus-vm-linux \\"
echo "     --title 'Thalamus VM Launcher v1.0.0' \\"
echo "     --notes 'One-click VM launcher. No Node.js required!'"
echo ""
echo "3. Update download URLs in src/lib/vmLauncher.ts"
echo "   Replace YOUR_USERNAME with your GitHub username"
echo ""
echo "🎉 Done! Users can now download and run the VM launcher!"
