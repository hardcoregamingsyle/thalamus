# Agent System Debugging Guide

## Current Status
- ✅ 10 Gemini API keys stored
- ✅ AWS Bedrock credentials stored  
- ✅ Platform budget: $150.75 remaining
- ✅ Convex backend running
- ❌ Agents not responding when invoked

## Most Likely Causes

### 1. **Frontend Not Triggering Agents**
The `autoRun` state or `handleRunNextAgent` callback may not be executing.

**How to check:**
1. Open browser DevTools → Console
2. Look for errors when you click "Start" or create a new session
3. Check if `runAgentRound` action is being called

**Solution:** Add console.log statements in TeamPortal.tsx:
```typescript
const handleRunNextAgent = useCallback(async (sessionIdOverride?: Id<"teamSessions">) => {
  console.log("🚀 handleRunNextAgent called", { sessionIdOverride, activeSessionId, isRunning });
  // ... rest of the code
```

### 2. **Authentication Token Missing or Expired**
The backend checks `token` validity and rejects calls if invalid.

**How to check:**
1. Check localStorage for auth token
2. Look for "Not authenticated" errors in console

**Solution:** Log out and log back in to refresh the session.

### 3. **Session Not Created Properly**
If the session creation fails silently, agents won't run.

**How to check:**
Run this in Convex dashboard or CLI:
```bash
bunx convex run customAuth:getCurrentUser '{"token":"YOUR_TOKEN_HERE"}'
```

### 4. **Backend Action Errors**
The `runAgentRound` action might be throwing errors that aren't surfacing.

**How to check:**
1. Go to https://dashboard.convex.dev
2. Click on your project
3. Go to "Logs" tab
4. Filter for "runAgentRound" or "error"

## Quick Test

To verify the agent system works end-to-end:

1. **Get your auth token** (from browser localStorage)
2. **Create a test session** via the UI
3. **Check Convex logs** for any errors
4. **Manually trigger agent** via Convex dashboard:
   - Go to Functions tab
   - Find `agentTeam:runAgentRound`
   - Pass: `{"sessionId": "YOUR_SESSION_ID", "token": "YOUR_TOKEN"}`
   - Click "Run"
   - Check output for errors

## Expected Behavior

When working correctly:
1. User creates new Code Mode session
2. Frontend calls `startBackgroundSession` 
3. Backend creates session in DB
4. Agent loop starts automatically
5. Each agent runs sequentially
6. Results stream back to frontend
7. Files are created/modified
8. Session completes when done

## Next Steps

1. ✅ Open the app in browser
2. ✅ Check console for errors
3. ✅ Try creating a new session
4. ✅ Check Convex dashboard logs
5. ✅ Report specific error messages

## Contact

If you see specific error messages, please share:
- Exact error text from console
- Screenshots of errors
- Convex logs from dashboard
