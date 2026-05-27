#!/bin/bash
echo "⚠️  WARNING: This will delete all 34 broken Gemini API keys"
echo ""
echo "Broken key breakdown:"
echo "  - 10 expired keys"
echo "  - 9 quota exceeded keys"
echo "  - 15 model not found keys"
echo ""
echo "After this, the system will rely entirely on AWS Bedrock (Claude)"
echo ""
read -p "Continue? (yes/no): " confirm

if [ "$confirm" != "yes" ]; then
  echo "Aborted."
  exit 0
fi

echo ""
echo "Clearing all Gemini keys..."
bunx convex run admin:saveGeminiKeys '{
  "adminToken": "Aphantic*123",
  "keys": [],
  "append": false
}' 2>&1

echo ""
echo "✅ All broken Gemini keys cleared"
echo ""
echo "Next steps:"
echo "  1. Generate new Gemini API keys at https://aistudio.google.com/app/apikey"
echo "  2. Run: bunx convex run admin:saveGeminiKeys with new keys"
echo "  3. Or fix AWS Bedrock credentials"
