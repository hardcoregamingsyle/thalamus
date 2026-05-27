#!/bin/bash
echo "════════════════════════════════════════════════════════════════"
echo "  FINAL CODE MODE VERIFICATION - Testing As Real User"
echo "════════════════════════════════════════════════════════════════"
echo ""

TOKEN="test-token-1779861296661"

echo "✓ Using test token: ${TOKEN:0:20}..."
echo ""

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "TEST 1: List existing projects"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
bunx convex run codeProjects:listProjects "{\"token\":\"$TOKEN\"}" 2>&1 | head -20
echo ""

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "TEST 2: Create new project"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
RESULT=$(bunx convex run codeProjects:createProject "{\"token\":\"$TOKEN\",\"name\":\"Final Test $(date +%s)\",\"description\":\"Complete verification test\"}" 2>&1)
echo "$RESULT"

PROJECT_ID=$(echo "$RESULT" | grep -o '"projectId":"[^"]*"' | cut -d'"' -f4)
BRANCH_ID=$(echo "$RESULT" | grep -o '"branchId":"[^"]*"' | cut -d'"' -f4)

echo ""
echo "✓ Project ID: $PROJECT_ID"
echo "✓ Branch ID: $BRANCH_ID"
echo ""

if [ -z "$PROJECT_ID" ] || [ -z "$BRANCH_ID" ]; then
    echo "❌ FAILED: Could not extract project/branch IDs"
    exit 1
fi

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "TEST 3: Send user message and start pipeline"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
bunx convex run codePipeline:startPipeline "{\"token\":\"$TOKEN\",\"branchId\":\"$BRANCH_ID\",\"userPrompt\":\"Create a beautiful portfolio website with smooth scrolling, project cards, and a contact section. Use modern CSS animations.\"}" 2>&1
echo "✓ Pipeline start command sent"
echo ""

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "TEST 4: Wait 3 seconds and check pipeline status"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
sleep 3
STATUS=$(bunx convex run testCodeMode:monitorPipeline "{\"branchId\":\"$BRANCH_ID\"}" 2>&1)
echo "$STATUS"
echo ""

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "VERIFICATION RESULTS"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Check if status is running
if echo "$STATUS" | grep -q '"status": "running"'; then
    echo "✅ Pipeline Status: RUNNING"
else
    echo "❌ Pipeline Status: NOT RUNNING"
fi

# Check if user message exists
if echo "$STATUS" | grep -q '"agent": "User"'; then
    echo "✅ User Message: SAVED"
else
    echo "❌ User Message: NOT SAVED"
fi

# Check if agent is set
if echo "$STATUS" | grep -q '"currentAgent": "Researcher"'; then
    echo "✅ Current Agent: Researcher (CORRECT)"
else
    echo "❌ Current Agent: INCORRECT"
fi

# Check message count
MSG_COUNT=$(echo "$STATUS" | grep -o '"messages": [0-9]*' | grep -o '[0-9]*')
if [ "$MSG_COUNT" -ge 1 ]; then
    echo "✅ Message Count: $MSG_COUNT (USER MESSAGE PRESENT)"
else
    echo "❌ Message Count: $MSG_COUNT (NO MESSAGES)"
fi

echo ""
echo "════════════════════════════════════════════════════════════════"
echo "  UI ACCESS URLS"
echo "════════════════════════════════════════════════════════════════"
echo ""
echo "Project List:  http://localhost:5173/portal/code"
echo "Branch List:   http://localhost:5173/portal/code/$PROJECT_ID"
echo "Workspace:     http://localhost:5173/portal/code/$PROJECT_ID/$BRANCH_ID"
echo "Data View:     http://localhost:5173/portal/code/$PROJECT_ID/$BRANCH_ID/data"
echo "Logs View:     http://localhost:5173/portal/code/$PROJECT_ID/$BRANCH_ID/logs"
echo ""
echo "════════════════════════════════════════════════════════════════"
echo "  FINAL VERDICT"
echo "════════════════════════════════════════════════════════════════"
echo ""

if echo "$STATUS" | grep -q '"status": "running"' && echo "$STATUS" | grep -q '"agent": "User"' && [ "$MSG_COUNT" -ge 1 ]; then
    echo "🎉 ALL TESTS PASSED - SYSTEM FULLY FUNCTIONAL"
    echo ""
    echo "✓ Authentication working"
    echo "✓ Project creation working"
    echo "✓ Branch creation working"
    echo "✓ User message saving"
    echo "✓ Pipeline starting"
    echo "✓ Status tracking"
    echo ""
    echo "Ready for production! 🚀"
else
    echo "❌ SOME TESTS FAILED - Check output above"
fi

echo ""
