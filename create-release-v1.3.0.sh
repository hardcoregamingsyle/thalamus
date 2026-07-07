#!/bin/bash
set -e

GIT_PAT="${GIT_PAT:-${1:-}}"
if [ -z "$GIT_PAT" ]; then
  echo "Usage: GIT_PAT=xxx bash create-release-v1.3.0.sh"
  exit 1
fi

echo "=== Creating GitHub release v1.3.0 ==="

# Create release
RELEASE_JSON=$(curl -s -X POST \
  -H "Authorization: token $GIT_PAT" \
  -H "Accept: application/vnd.github+json" \
  https://api.github.com/repos/hardcoregamingsyle/thalamus/releases \
  -d '{
    "tag_name": "v1.3.0",
    "target_commitish": "main",
    "name": "Thalamus AI v1.3.0",
    "body": "## What'\''s New in v1.3.0\n\n### UI Overhaul\n- **Complete professional redesign** of the desktop app — glass-morphism, ambient glow, dark terminal aesthetic matching the website\n- **macOS-style traffic light controls** (red/yellow/green circles) in the title bar\n- **Glass sidebar** with blue accent, navigation pills, and smooth hover states\n- **Ambient glow effects** and grid-pattern overlay\n- **Status bar** with auth status indicator and mode pill\n\n### Auth Improvements\n- **App opens directly in guest mode** — no forced login, no email prompt on launch\n- **Sign in via browser** like Discord/VS Code — app generates auth code, opens the website, polls for authorization\n- **Stunning LoginWindow** — glowing code card, terminal-style UI, animated loading/success/error states\n- **Token persistence** — session saved encrypted with Windows DPAPI\n\n### The Flow\n1. Launch app → guest mode (Chat available)\n2. Click \"Sign In\" → beautiful dialog shows auth code → browser opens to website\n3. Sign in on website with email OTP → authorize the desktop app\n4. All modes unlocked (Code, Chat, Research, Study)\n5. Next launch: session restored automatically\n\n### Compatibility\n- Fixed WPF CharacterSpacing/LetterSpacing compatibility\n- Thread-safe dispatcher calls\n- Eliminated DialogResult bug from old auth flow",
    "draft": false,
    "prerelease": false,
    "generate_release_notes": false
  }' 2>&1)

echo "$RELEASE_JSON" | head -5
echo "---"

RELEASE_ID=$(echo "$RELEASE_JSON" | python3 -c "
import sys, json
data = json.load(sys.stdin)
print(data.get('id', 'ERROR'))
" 2>/dev/null)

if [ "$RELEASE_ID" = "ERROR" ] || [ -z "$RELEASE_ID" ]; then
  echo "Failed to get release ID. Response was:"
  echo "$RELEASE_JSON"
  exit 1
fi

echo "Release created with ID: $RELEASE_ID"

# Upload Thalamus.exe as release asset
EXE_PATH="/home/daytona/codebase/public/downloads/Thalamus.exe"
if [ -f "$EXE_PATH" ]; then
  EXE_SIZE=$(stat -c%s "$EXE_PATH")
  echo "Uploading Thalamus.exe ($EXE_SIZE bytes)..."
  
  UPLOAD_URL="https://uploads.github.com/repos/hardcoregamingsyle/thalamus/releases/$RELEASE_ID/assets?name=Thalamus.exe"
  
  curl -s -X POST \
    -H "Authorization: token $GIT_PAT" \
    -H "Accept: application/vnd.github+json" \
    -H "Content-Type: application/octet-stream" \
    --data-binary @"$EXE_PATH" \
    "$UPLOAD_URL" 2>&1 | head -5
  
  echo ""
  echo "Upload complete!"
else
  echo "Warning: Thalamus.exe not found at $EXE_PATH"
fi

echo ""
echo "=== Release v1.3.0 created successfully ==="
echo "View at: https://github.com/hardcoregamingsyle/thalamus/releases/tag/v1.3.0"
