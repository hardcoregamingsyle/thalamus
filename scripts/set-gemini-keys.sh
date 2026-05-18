#!/usr/bin/env bash
# Sets Gemini API keys as a Convex environment variable.
# Keys are passed as a JSON array via GEMINI_KEYS_JSON env var or as arguments.
# Usage:
#   GEMINI_KEYS_JSON='["key1","key2"]' bash scripts/set-gemini-keys.sh
#   bash scripts/set-gemini-keys.sh key1 key2 key3 ...
#
# Requires: npx convex (logged in or CONVEX_DEPLOY_KEY set)

set -euo pipefail

if [ -n "${GEMINI_KEYS_JSON:-}" ]; then
  KEYS_JSON="$GEMINI_KEYS_JSON"
elif [ $# -gt 0 ]; then
  # Build JSON array from arguments
  KEYS_JSON="["
  for i in "$@"; do
    KEYS_JSON="${KEYS_JSON}\"${i}\","
  done
  KEYS_JSON="${KEYS_JSON%,}]"
else
  echo "Usage: GEMINI_KEYS_JSON='[\"key1\",\"key2\"]' bash $0"
  echo "   or: bash $0 key1 key2 key3 ..."
  exit 1
fi

echo "Setting GEMINI_KEYS_JSON in Convex (${#KEYS_JSON} chars)..."
npx convex env set GEMINI_KEYS_JSON "$KEYS_JSON"
echo "Done. Keys will be used on next Convex function invocation."
