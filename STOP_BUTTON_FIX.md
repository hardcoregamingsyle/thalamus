# 🛑 Stop Button Fix

**Date:** 2026-05-22  
**Commit:** 5a82a68  
**Status:** ✅ FIXED

---

## 🐛 Problem Reported

**User:** "when I click on stop, the current agent ends its work and the next agent starts automatically, so when I click stop, it does not actually stop."

---

## 🔍 Root Cause Analysis

### The Background Execution Chain

Code Mode uses a self-scheduling background execution system:

```typescript
// Each agent schedules the next agent
await ctx.scheduler.runAfter(0, internal.agentTeam.backgroundRunOneRound, { 
  sessionId: args.sessionId 
});
```

This creates a chain:
```
Researcher → schedules Analyser
Analyser → schedules Planner
Planner → schedules Coder
Coder → schedules Optimiser
... and so on
```

### What Happened When User Clicked "Stop"

**Before the fix:**

1. User clicks STOP button
2. Frontend calls `stopSession` action
3. Backend calls `forceIdleSession` mutation:
   ```typescript
   await ctx.db.patch(sessionId, {
     status: "idle",
     runningAt: undefined, // Clear this
   });
   ```
4. Current agent (e.g., Coder) finishes its work
5. **Coder's last line schedules next agent:**
   ```typescript
   await ctx.scheduler.runAfter(0, internal.agentTeam.backgroundRunOneRound, { 
     sessionId 
   });
   ```
6. **Next agent (Optimiser) starts automatically** ❌
7. Session continues running despite user clicking Stop

### Why This Happened

The `backgroundRunOneRound` function had this logic:

```typescript
// OLD CODE (before fix)
export const backgroundRunOneRound = internalAction({
  handler: async (ctx, args) => {
    const session = await getSession(args.sessionId);
    
    if (session.status === "completed") return; // ✅ Stops if completed
    
    if (session.status === "running") {
      // Check if stale, recover if needed
      return; // Skip if genuinely running
    }
    
    // If status is "idle", just continue executing ❌
    // This is the bug!
    
    // Run the next agent...
  }
});
```

**The problem:** When status is "idle", it assumed the session should continue. But "idle" could mean either:
- Ready to continue (normal state between agents)
- **User explicitly stopped** (should NOT continue)

There was no way to distinguish between these two cases!

---

## ✅ The Fix

Added a check to distinguish "idle and waiting" from "idle and stopped":

```typescript
// NEW CODE (fixed)
export const backgroundRunOneRound = internalAction({
  handler: async (ctx, args) => {
    const session = await getSession(args.sessionId);
    
    if (session.status === "completed") return;
    
    // NEW: Check if user explicitly stopped
    if (session.status === "idle") {
      const runningAt = session.runningAt as number | undefined;
      if (!runningAt) {
        // User clicked STOP — do not continue!
        console.log("Session idle with no runningAt — user stopped");
        return; // ✅ Break the execution chain
      }
    }
    
    if (session.status === "running") {
      // Stale check logic...
    }
    
    // Continue executing...
  }
});
```

### How `runningAt` Works

The `runningAt` field tracks when a session started running:

**When RUN is clicked:**
```typescript
// startBackgroundSession sets this
await ctx.db.patch(sessionId, {
  status: "running",
  runningAt: Date.now(), // ✅ Set timestamp
});
```

**When STOP is clicked:**
```typescript
// forceIdleSession clears this
await ctx.db.patch(sessionId, {
  status: "idle",
  runningAt: undefined, // ✅ Clear it
});
```

**The check:**
```typescript
if (status === "idle" && !runningAt) {
  return; // User stopped — don't continue
}
```

---

## 🔄 Execution Flow Comparison

### Before (Broken):

```
1. User clicks STOP
   └─> stopSession() → forceIdleSession()
       └─> status = "idle", runningAt = undefined

2. Coder agent finishes its work
   └─> Schedules Optimiser: ctx.scheduler.runAfter(0, backgroundRunOneRound, ...)

3. Optimiser's backgroundRunOneRound starts
   └─> Checks: status === "idle"? Yes
   └─> Continues executing ❌

4. Optimiser runs
   └─> Schedules Organizer

5. Chain continues forever...
```

### After (Fixed):

```
1. User clicks STOP
   └─> stopSession() → forceIdleSession()
       └─> status = "idle", runningAt = undefined

2. Coder agent finishes its work
   └─> Schedules Optimiser: ctx.scheduler.runAfter(0, backgroundRunOneRound, ...)

3. Optimiser's backgroundRunOneRound starts
   └─> Checks: status === "idle" && !runningAt? Yes
   └─> Returns early (breaks chain) ✅

4. No more agents run

5. User must click RUN to resume
```

---

## 🧪 Testing Guide

### Test Case 1: Stop During Execution

1. Start a Code Mode session (e.g., "Build a todo app")
2. Wait for Researcher to finish
3. While Analyser is running, click **STOP**
4. ✅ **Expected:** Analyser finishes its current work
5. ✅ **Expected:** Planner does NOT start automatically
6. ✅ **Expected:** Status shows "IDLE" (not "RUNNING")
7. ✅ **Expected:** Pipeline indicator stops at Analyser

### Test Case 2: Resume After Stop

1. Follow Test Case 1 (stop the session)
2. Click **RUN** button
3. ✅ **Expected:** Session resumes from where it stopped
4. ✅ **Expected:** Planner starts executing
5. ✅ **Expected:** Status changes to "RUNNING"

### Test Case 3: Stop and Start Multiple Times

1. Start a session
2. Let Researcher complete
3. Click STOP
4. Wait 5 seconds
5. Click RUN
6. Let Analyser complete
7. Click STOP again
8. ✅ **Expected:** Each STOP actually stops
9. ✅ **Expected:** Each RUN resumes from correct position
10. ✅ **Expected:** No agents run while stopped

### Test Case 4: Stop Does Not Interrupt Current Agent

1. Start a session
2. While Coder is running (takes ~30 seconds), click STOP
3. ✅ **Expected:** Coder continues its work and finishes
4. ✅ **Expected:** After Coder finishes, Optimiser does NOT start
5. ✅ **Expected:** Status becomes "IDLE" after Coder completes

---

## 🔧 Technical Details

### Files Modified

**File:** `src/convex/agentTeam.ts`  
**Function:** `backgroundRunOneRound` (line 1450)

### Code Added

```typescript
// CRITICAL: If status is "idle" but runningAt is undefined, user explicitly stopped
// Do NOT continue execution — wait for user to click RUN again
if (session.status === "idle") {
  const runningAt = (session as Record<string, unknown>).runningAt as number | undefined;
  if (!runningAt) {
    console.log(`backgroundRunOneRound: session ${args.sessionId} is idle with no runningAt — user stopped, not continuing`);
    return; // User explicitly stopped — do not auto-resume
  }
}
```

### Related Functions

**1. stopSession (public action)**
```typescript
export const stopSession = action({
  handler: async (ctx, args) => {
    // Verify user owns session
    await ctx.runMutation(internal.agentTeamHelpers.forceIdleSession, {
      sessionId: args.sessionId,
      // ... other fields
    });
  }
});
```

**2. forceIdleSession (internal mutation)**
```typescript
export const forceIdleSession = internalMutation({
  handler: async (ctx, args) => {
    await ctx.db.patch(args.sessionId, {
      status: "idle",
      runningAt: undefined, // ✅ Clear this to signal "stopped"
    });
  }
});
```

**3. startBackgroundSession (public action)**
```typescript
export const startBackgroundSession = action({
  handler: async (ctx, args) => {
    await ctx.runMutation(internal.agentTeamHelpers.updateSessionStatus, {
      sessionId: args.sessionId,
      status: "running",
      // runningAt is set here
    });
    await ctx.scheduler.runAfter(0, internal.agentTeam.backgroundRunOneRound, {
      sessionId: args.sessionId
    });
  }
});
```

---

## 📊 Session State Machine

### Status Field Values

- **`"idle"`** - Session is paused, waiting for action
- **`"running"`** - Agents are actively executing
- **`"completed"`** - All tasks finished

### runningAt Field Values

- **`undefined`** - Session was explicitly stopped OR never started
- **`timestamp`** - Session is/was running, started at this time

### State Combinations

| Status | runningAt | Meaning | Action |
|--------|-----------|---------|--------|
| `idle` | `undefined` | User stopped | Do NOT continue ✅ |
| `idle` | `timestamp` | Between agents | Continue execution |
| `running` | `timestamp` | Active execution | Skip (already running) |
| `running` | `undefined` | Impossible state | Recover to idle |
| `completed` | any | Done | Stop execution |

---

## 🎯 Summary

### Issues Fixed

1. ✅ Stop button now actually stops execution
2. ✅ Agents no longer auto-continue after stop
3. ✅ User has full control over start/stop
4. ✅ Already-scheduled actions terminate gracefully

### Technical Changes

- Added check for `status === "idle" && !runningAt`
- This distinguishes "stopped" from "waiting between agents"
- Existing `forceIdleSession` already cleared `runningAt`
- No database schema changes needed

### User Experience

**Before:**
- Click STOP → current agent finishes → next agent starts anyway
- No way to actually pause execution
- Had to wait for entire session to complete

**After:**
- Click STOP → current agent finishes → execution stops ✅
- Click RUN → execution resumes from where it stopped
- Full control over when agents run

The fix is minimal (10 lines) but effective. It leverages the existing `runningAt` field to distinguish between "idle and ready" vs "idle and stopped."
