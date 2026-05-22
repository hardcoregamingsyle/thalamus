# 🏠 Project Home Screen for Code Mode

**Date:** 2026-05-22  
**Commit:** c830235  
**Status:** ✅ DEPLOYED

---

## 🎯 Feature Overview

Added a project home screen at `/portal/code` that displays all Code Mode projects as cards, with each project having its own unique 8-digit URL that persists across page refreshes.

---

## 📍 URL Structure

### Before:
```
/portal/code → opens Code Mode (no project list)
[No stable URLs for individual projects]
[Refreshing would lose context]
```

### After:
```
/portal/code → Project home screen (all projects)
/portal/code/a3f8k2m9 → Specific project (stable URL)
/portal/code/7b5x9p1q → Another project (stable URL)
```

Each session has a unique **8-digit custom ID** (alphanumeric) that becomes part of the URL.

---

## 🎨 Project Home Screen Layout

When you visit `/portal/code` (with no project selected):

### Header
```
┌─────────────────────────────────────────────────┐
│ Code Mode Projects                              │
│ Your AI-powered software development workspace  │
└─────────────────────────────────────────────────┘
```

### Project Grid (responsive: 1/2/3 columns)
```
┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│ Start New    │  │ Project 1    │  │ Project 2    │
│ Project      │  │ a3f8k2m9 ●   │  │ 7b5x9p1q ✓   │
│              │  │              │  │              │
│  Import from │  │ ⚡ Coder     │  │ 5 tasks      │
│  GitHub or   │  │ 5 tasks      │  │ 12 messages  │
│  start from  │  │ 8 messages   │  │ COMPLETE     │
│  scratch     │  │              │  │              │
│              │  │ [Open →]     │  │ [Open →]     │
│ [Get Started]│  └──────────────┘  └──────────────┘
└──────────────┘
```

---

## 📦 Project Card Components

Each project card displays:

### 1. **Title**
```typescript
session.title // e.g., "Build a weather app"
```

### 2. **8-Digit ID** (custom ID from database)
```typescript
customId // e.g., "a3f8k2m9"
```
- Alphanumeric (lowercase)
- Unique per session
- Generated automatically on session creation

### 3. **Status Indicators**
- **Running**: Green pulsing dot (●)
- **Complete**: Green badge with "COMPLETE"
- **Idle**: No indicator

### 4. **Pipeline Phase**
```typescript
session.phase // e.g., "Coder", "Tester", "Hacker"
```

### 5. **Task Count**
```typescript
plannerTasks.length // e.g., "5 tasks"
```

### 6. **Message Count**
```typescript
session.totalMessages // e.g., "8 messages"
```

### 7. **Hover Effects**
- Card scales up (1.02x)
- "Open Project →" button appears at bottom
- Gradient overlay reveals

---

## 🚀 "Start New Project" Card

The first card in the grid is always a **create new project** card:

### Visual Design:
- Dashed border (border-dashed)
- Primary color accent (border-primary/30)
- Plus icon in circle
- "Get Started" button

### Action:
Clicking opens the GitHub Import Modal where users can:
1. Import from GitHub (enter repo URL + token)
2. Start from scratch (type a task description)

---

## 🔗 Navigation Flow

### 1. User visits `/portal/code`
→ Shows project home screen with all projects

### 2. User clicks "Get Started"
→ Opens GitHub Import Modal
→ After importing: redirects to `/portal/code/{newCustomId}`

### 3. User clicks existing project card
→ Redirects to `/portal/code/{customId}`
→ Opens that specific project

### 4. User refreshes page at `/portal/code/a3f8k2m9`
→ URL is stable, project stays open ✅

---

## 🗄️ Database Schema

### Custom ID Field (already existed):
```typescript
// src/convex/schema.ts
teamSessions: defineTable({
  customId: v.optional(v.string()),
  // ... other fields
}).index("by_custom_id", ["customId"])
```

### Generation:
```typescript
// src/convex/agentTeamHelpers.ts
function generateCustomId(): string {
  return Math.random().toString(36).slice(2, 10); // 8 chars
}
```

---

## 💻 Code Changes

### File: `src/pages/TeamPortalInline.tsx`

#### Added Project Home Screen:
```typescript
if (!activeSessionId) {
  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-background">
      {/* Header */}
      <div className="shrink-0 px-6 py-4 border-b border-border bg-card/50">
        <h1>Code Mode Projects</h1>
        <p>Your AI-powered software development workspace</p>
      </div>

      {/* Project grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {/* "Start New Project" card */}
        <motion.div onClick={() => setShowGithubModal(true)}>
          ...
        </motion.div>

        {/* Existing projects */}
        {sessions.map((session) => (
          <motion.div 
            key={session._id}
            onClick={() => {
              setActiveSessionId(session._id);
              if (customId) onSessionChange?.(customId);
            }}
          >
            {/* Project card with title, ID, stats */}
          </motion.div>
        ))}
      </div>
    </div>
  );
}
```

---

## 🎯 User Benefits

### Before:
- ❌ No way to see all projects at once
- ❌ Refreshing page loses current project
- ❌ No stable URLs for projects
- ❌ Hard to navigate between projects
- ❌ No visual overview of project status

### After:
- ✅ Clean project home screen at `/portal/code`
- ✅ All projects visible as cards
- ✅ Each project has stable URL: `/portal/code/{customId}`
- ✅ Refresh preserves current project
- ✅ Easy navigation between projects
- ✅ Visual status indicators (running, complete)
- ✅ Quick stats (tasks, messages, phase)
- ✅ Bookmarkable project URLs

---

## 🧪 Testing Guide

### Test Case 1: Visit Project Home
1. Navigate to `https://thalamus.aphantic.skinticals.com/portal/code`
2. ✅ **Expected:** See all your Code Mode projects as cards
3. ✅ **Expected:** See "Start New Project" card at the beginning

### Test Case 2: Open Project from Home
1. Click any project card
2. ✅ **Expected:** URL changes to `/portal/code/{customId}`
3. ✅ **Expected:** Project opens with all chat history and files

### Test Case 3: Refresh Project Page
1. Open a project at `/portal/code/a3f8k2m9`
2. Refresh the page (F5 or Ctrl+R)
3. ✅ **Expected:** Project remains open (doesn't go back to home)
4. ✅ **Expected:** All state preserved (messages, files, pipeline position)

### Test Case 4: Direct URL Access
1. Copy project URL: `/portal/code/a3f8k2m9`
2. Open in new tab or share with someone
3. ✅ **Expected:** Opens that specific project directly

### Test Case 5: Create New Project
1. Click "Start New Project" card
2. Import from GitHub or start from scratch
3. ✅ **Expected:** New project created with unique 8-digit ID
4. ✅ **Expected:** Redirected to `/portal/code/{newCustomId}`

### Test Case 6: Running vs Complete Status
1. Create a new project (should show green pulsing dot ●)
2. Wait for project to complete
3. ✅ **Expected:** Green pulsing dot disappears
4. ✅ **Expected:** "COMPLETE" badge appears

---

## 📱 Responsive Design

### Mobile (< 768px):
- 1 column grid
- Cards stack vertically
- Full-width cards

### Tablet (768px - 1024px):
- 2 column grid
- Cards side-by-side

### Desktop (> 1024px):
- 3 column grid
- Maximum 3 cards per row

---

## 🎨 Visual Design

### Colors & Theming:
- Background: `bg-background`
- Cards: `bg-card` with `border-border`
- Hover: `border-primary/40`
- Running status: Green pulsing dot
- Complete badge: `bg-green-400/10` with `text-green-400`

### Animations:
- Card entrance: fade + slide up (staggered by 0.05s)
- Card hover: scale to 1.02x
- Running indicator: pulsing animation
- "Open Project" button: fade in on hover

### Typography:
- Header: `text-2xl font-bold`
- Card title: `text-sm font-bold` (2 line clamp)
- Custom ID: `text-[10px] font-mono`
- Stats: `text-xs text-muted-foreground`

---

## 🔧 Technical Implementation

### 1. Custom ID Generation
Already existed in `agentTeamHelpers.ts`:
```typescript
function generateCustomId(): string {
  return Math.random().toString(36).slice(2, 10);
}
```

### 2. URL Parameter Handling
Parent component (`Portal.tsx`) passes `initialSessionCustomId`:
```typescript
<TeamPortalInline
  token={token}
  initialSessionCustomId={urlSessionId} // from /portal/code/{id}
  onSessionChange={(customId) => {
    if (customId) navigate(`/portal/code/${customId}`);
    else navigate(`/portal/code`);
  }}
/>
```

### 3. Session Matching
When URL has a custom ID, find matching session:
```typescript
useEffect(() => {
  if (!initialSessionCustomId || activeSessionId) return;
  const match = sessions.find(s => {
    const raw = s as unknown as Record<string, unknown>;
    return raw.customId === initialSessionCustomId;
  });
  if (match) setActiveSessionId(match._id);
}, [initialSessionCustomId, sessions, activeSessionId]);
```

### 4. Conditional Rendering
```typescript
if (!activeSessionId) {
  return <ProjectHomeScreen />; // Show all projects
}

return <ActiveProjectView />; // Show selected project
```

---

## 🎉 Summary

Users now have a proper project management experience:

1. **Project Home** at `/portal/code` - see all projects at a glance
2. **Stable URLs** - each project has `/portal/code/{8-digit-id}`
3. **No lost state** - refreshing preserves current project
4. **Easy creation** - "Start New Project" card prominently displayed
5. **Visual feedback** - status indicators, stats, hover effects
6. **Responsive** - works on mobile, tablet, desktop

This makes Code Mode feel like a professional development environment where you can manage multiple projects, not just a single chat interface.
