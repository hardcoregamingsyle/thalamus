# 💬 User Message Persistence Fix

**Date:** 2026-05-21 15:20  
**Commit:** 7b4f90d  
**Status:** ✅ DEPLOYED & PUSHED TO GITHUB

---

## 🐛 Issue Reported

**Problem 1:** Agent replies stack on top of user messages  
**Problem 2:** Refreshing removes user messages entirely (only AI messages remain)

---

## 🔍 Root Cause Analysis

### The Problem:
User messages were **ONLY** being appended to `session.task` but **NOT** saved to the `agentMessages` table.

```typescript
// OLD CODE - Only updated session.task
export const appendTaskContext = internalMutation({
  handler: async (ctx, args) => {
    const updatedTask = session.task + "\n\n[USER FOLLOW-UP]: " + args.additionalContext;
    await ctx.db.patch(args.sessionId, {
      task: updatedTask,  // ❌ Only here, not in agentMessages table
    });
  }
});
```

### Why This Caused Issues:

1. **Initial user message** (when creating session):
   - Stored in `session.task` ✅
   - **NOT saved to `agentMessages`** ❌

2. **Follow-up user messages** (via continueSession):
   - Appended to `session.task` ✅
   - **NOT saved to `agentMessages`** ❌

3. **Agent messages**:
   - Saved to `agentMessages` ✅
   - Visible in UI ✅

4. **On refresh**:
   - UI loads messages from `agentMessages` table
   - Only shows agent messages (no user messages exist) ❌

---

## ✅ Fixes Applied

### Fix #1: Save Initial User Message

**File:** `src/convex/agentTeamHelpers.ts`  
**Function:** `createSessionMutation`

```typescript
export const createSessionMutation = internalMutation({
  handler: async (ctx, args) => {
    const sessionId = await ctx.db.insert("teamSessions", {
      // ... session data
      totalMessages: 1, // ✅ Start at 1 (for initial user message)
    });

    // ✅ NEW: Save the initial user message
    await ctx.db.insert("agentMessages", {
      sessionId,
      userId: args.userId,
      agent: "User",
      content: args.task,
      round: 0,
      messageIndex: 1,
    });

    return { sessionId, customId };
  },
});
```

### Fix #2: Save Follow-Up User Messages

**File:** `src/convex/agentTeamHelpers.ts`  
**Function:** `appendTaskContext`

```typescript
export const appendTaskContext = internalMutation({
  args: {
    sessionId: v.id("teamSessions"),
    additionalContext: v.string(),
    userId: v.id("users"), // ✅ NEW: Added userId parameter
  },
  handler: async (ctx, args) => {
    const session = await ctx.db.get(args.sessionId);
    const currentMessageCount = session.totalMessages ?? 0;

    // ✅ NEW: Save user message to agentMessages table
    await ctx.db.insert("agentMessages", {
      sessionId: args.sessionId,
      userId: args.userId,
      agent: "User",
      content: args.additionalContext,
      round: session.round,
      messageIndex: currentMessageCount + 1,
    });

    // Append to session.task (for agent context)
    const updatedTask = session.task + "\n\n[USER FOLLOW-UP]: " + args.additionalContext;
    
    await ctx.db.patch(args.sessionId, {
      task: updatedTask,
      status: "idle",
      totalMessages: currentMessageCount + 1, // ✅ Increment counter
    });
  },
});
```

### Fix #3: Pass userId in continueSession

**File:** `src/convex/agentTeam.ts`  
**Function:** `continueSession`

```typescript
export const continueSession = action({
  handler: async (ctx, args) => {
    const userId = await getUserIdByToken(...);
    // ...
    await ctx.runMutation(internal.agentTeamHelpers.appendTaskContext, {
      sessionId: args.sessionId,
      additionalContext: args.newTask,
      userId, // ✅ NEW: Pass userId to mutation
    });
  },
});
```

---

## 🧪 How to Test

### Test Case 1: Initial Message Persists
1. Create a new Code Mode session with message: "Hello World"
2. Wait for agents to respond
3. **Refresh the page**
4. ✅ **Expected:** "Hello World" should still be visible at the top

### Test Case 2: Follow-Up Messages Persist
1. In an existing session, send a follow-up: "Add authentication"
2. Wait for agents to respond
3. **Refresh the page**
4. ✅ **Expected:** Both original message and "Add authentication" visible

### Test Case 3: No Stacking
1. Send a message
2. Agents respond
3. ✅ **Expected:** Messages appear in order (User → Agent → User → Agent)
4. ❌ **Not:** Agent messages stacking on top of each other

---

## 📊 Message Flow (Before vs After)

### BEFORE (Broken):
```
1. User creates session: "Build an API"
   → Saved to: session.task ✅
   → Saved to: agentMessages ❌

2. Agent (Researcher) responds
   → Saved to: agentMessages ✅

3. User sends follow-up: "Add auth"
   → Appended to: session.task ✅
   → Saved to: agentMessages ❌

4. Agent (Planner) responds
   → Saved to: agentMessages ✅

5. User refreshes page
   → UI loads from: agentMessages
   → Shows: Researcher, Planner (no user messages) ❌
```

### AFTER (Fixed):
```
1. User creates session: "Build an API"
   → Saved to: session.task ✅
   → Saved to: agentMessages ✅ (agent: "User", messageIndex: 1)

2. Agent (Researcher) responds
   → Saved to: agentMessages ✅ (agent: "Researcher", messageIndex: 2)

3. User sends follow-up: "Add auth"
   → Appended to: session.task ✅
   → Saved to: agentMessages ✅ (agent: "User", messageIndex: 3)

4. Agent (Planner) responds
   → Saved to: agentMessages ✅ (agent: "Planner", messageIndex: 4)

5. User refreshes page
   → UI loads from: agentMessages
   → Shows: User → Researcher → User → Planner ✅
```

---

## 🎯 Summary

### Issues Fixed:
1. ✅ User messages now persist across refreshes
2. ✅ No more message stacking
3. ✅ Chat history shows complete conversation (User + Agent messages)
4. ✅ Message order is preserved correctly

### Technical Changes:
- `createSessionMutation`: Saves initial user message
- `appendTaskContext`: Saves follow-up user messages
- `continueSession`: Passes userId to mutation
- `totalMessages` counter incremented for user messages

### Database Schema:
```typescript
agentMessages {
  sessionId: Id<"teamSessions">
  userId: Id<"users">
  agent: string  // "User" | "Researcher" | "Planner" | etc.
  content: string
  round?: number
  messageIndex?: number
  modelUsed?: string
  agentBucksDeducted?: number
  _creationTime: number
}
```

---

## 🚀 Ready to Test!

**Try it now:**
1. Create a new Code Mode session
2. Send a message
3. Wait for agent response
4. Refresh the page
5. **Your message should still be there!** 🎉
