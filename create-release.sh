#!/bin/bash
set -e

GIT_PAT="${GIT_PAT:-${1:-}}"
if [ -z "$GIT_PAT" ]; then
  echo "Usage: GIT_PAT=xxx bash create-release.sh"
  exit 1
fi

echo "=== Creating GitHub release v1.2.0 ==="

# Create release
RELEASE_JSON=$(curl -s -X POST \
  -H "Authorization: token $GIT_PAT" \
  -H "Accept: application/vnd.github+json" \
  https://api.github.com/repos/hardcoregamingsyle/thalamus/releases \
  -d '{
    "tag_name": "v1.2.0",
    "target_commitish": "main",
    "name": "Thalamus AI v1.2.0",
    "body": "## What'\''s New\n\n- **Web-based auth flow** for desktop app — sign in through the website like Discord/VS Code\n- **No guest mode** — requires authentication to use the app\n- **Removed Email OTP dialog** — eliminates the DialogResult bug\n- **Modernized MainWindow UI** — matching website dark aesthetic\n- **Fixed WPF compatibility** — CharacterSpacing, thread-safe dispatcher calls\n\n## Desktop App Flow\n1. Launch app → LoginWindow appears with auth code\n2. Click \"Open in Browser\" → website opens\n3. Sign in with email OTP on website → desktop app auto-authorizes\n4. Full access to all modes (Code, Chat, Research, Study)",
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
echo "=== Release v1.2.0 created successfully ==="
echo "View at: https://github.com/hardcoregamingsyle/thalamus/releases/tag/v1.2.0"
