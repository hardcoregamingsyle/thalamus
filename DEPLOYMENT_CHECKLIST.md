# 🚀 Deployment Checklist - Project Home Screen

**Status:** ✅ Code is ready and pushed to GitHub  
**Waiting for:** Site rebuild/redeployment

---

## 📦 What Was Built

### Project Home Screen at `/portal/code`

When you visit `https://thalamus.aphantic.skinticals.com/portal/code` (with NO session ID), you should see:

1. **Header**: "Code Mode Projects" with subtitle
2. **Project Grid**: Cards showing all your Code Mode projects
3. **"Start New Project" Card**: First card with dashed border
4. **Each Project Card Shows**:
   - Project title
   - 8-digit ID (e.g., `a3f8k2m9`)
   - Current pipeline phase
   - Task count
   - Message count
   - Running status (green dot if active)
   - Complete badge (if finished)

---

## 🔍 How to Verify It's Working

### Step 1: Check You're on the Right URL
```
✅ Correct: https://thalamus.aphantic.skinticals.com/portal/code
❌ Wrong:   https://thalamus.aphantic.skinticals.com/portal/code/a3f8k2m9
```

If you have a session ID in the URL (like `/portal/code/a3f8k2m9`), you'll see the project view, not the home screen.

### Step 2: What You Should See

**Project Home Screen (at `/portal/code`):**
```
┌────────────────────────────────────────────────────┐
│ Code Mode Projects                                  │
│ Your AI-powered software development workspace      │
├────────────────────────────────────────────────────┤
│                                                     │
│  ┌─────────────┐  ┌─────────────┐  ┌────────────┐ │
│  │ Start New   │  │ Project 1   │  │ Project 2  │ │
│  │ Project     │  │ a3f8k2m9    │  │ 7b5x9p1q   │ │
│  │             │  │             │  │            │ │
│  │ [+ Icon]    │  │ Coder       │  │ Complete ✓ │ │
│  │             │  │ 5 tasks     │  │ 12 msgs    │ │
│  │ Get Started │  │ 8 messages  │  │            │ │
│  └─────────────┘  └─────────────┘  └────────────┘ │
│                                                     │
└────────────────────────────────────────────────────┘
```

### Step 3: Verify Sidebar is Hidden

When at `/portal/code`, you should NOT see:
- ❌ The chat/research/study sidebar (with "New Chat" button)
- ❌ Session list on the left
- ❌ Mode switcher tabs

You SHOULD see:
- ✅ Full-width project home screen
- ✅ Project cards in a grid
- ✅ "Start New Project" card

---

## 🛠️ If It's Not Working

### Check 1: Hard Refresh
The site might be showing cached content.

**Chrome/Edge:**
- Windows: `Ctrl + Shift + R`
- Mac: `Cmd + Shift + R`

**Firefox:**
- Windows: `Ctrl + F5`
- Mac: `Cmd + Shift + R`

### Check 2: Clear Site Data
If hard refresh doesn't work:

1. Press `F12` to open DevTools
2. Go to **Application** tab (Chrome) or **Storage** tab (Firefox)
3. Right-click on the domain
4. Click **Clear site data** or **Delete all**
5. Refresh the page

### Check 3: Verify Build Version
Open DevTools Console (`F12` → Console tab) and check for any errors. The site should have redeployed with the latest code after the git push.

### Check 4: Check if Session is Auto-Selected
If you're seeing a project view instead of the home screen, it might be because:

1. You have a session ID in the URL (check address bar)
2. A session is being auto-selected somehow

**To fix:**
- Manually navigate to `https://thalamus.aphantic.skinticals.com/portal/code` (no trailing path)
- Click the "Code" mode tab to reset

---

## 🔧 Technical Details

### Code Flow

1. User visits `/portal/code`
2. `Portal.tsx` detects `activeMode === "code"`
3. Renders `TeamPortalInline` with `initialSessionCustomId={null}`
4. `TeamPortalInline` starts with `activeSessionId = null`
5. Early return triggers: `if (!activeSessionId) return <ProjectHomeScreen />`
6. Project home screen renders

### Files Modified

**Main Implementation:**
- `src/pages/TeamPortalInline.tsx` (lines 2037-2156) - Project home screen
- Added check: `if (!activeSessionId) return (...)`

**Portal Integration:**
- `src/pages/Portal.tsx` (lines 1494-1505) - Already correct
- Sidebar hidden for code mode: `activeMode !== "code"`

### Commits
```
c830235 - Add project home screen to Code Mode with 8-digit IDs
ea79641 - Add project home screen documentation
5a82a68 - Fix stop button - now actually stops agent execution
b6b38f0 - Add stop button fix documentation
```

All pushed to GitHub main branch.

---

## 🎯 Expected Behavior Summary

| URL | What You Should See |
|-----|---------------------|
| `/portal/code` | **Project Home Screen** - Grid of all projects + "Start New Project" card |
| `/portal/code/a3f8k2m9` | **Project View** - Specific project with sidebar, chat, files, sandbox |
| `/portal/chat` | **Chat Mode** - Sidebar with chat sessions, no project cards |
| `/portal/research` | **Research Mode** - Sidebar with research sessions |

---

## 📞 Next Steps

1. **Wait for site rebuild** - Changes were just pushed to GitHub
2. **Hard refresh browser** - Clear any cached content
3. **Navigate to** `https://thalamus.aphantic.skinticals.com/portal/code`
4. **Verify** you see the project grid with cards

If you still see the old interface (sidebar with "New Chat" button), the site hasn't rebuilt yet with the latest code. The deployment system should pick up the git push and rebuild automatically.

---

## 🐛 Troubleshooting

### "I see the sidebar with sessions"

**If you see Portal.tsx sidebar (for chat/research):**
- This shouldn't happen - the sidebar has `activeMode !== "code"` condition
- Try hard refresh or clear site data

**If you see TeamPortalInline sidebar (for pipeline/tasks):**
- This means you have an active session selected
- Navigate to `/portal/code` (no session ID in URL)
- Or click a different mode and come back to Code mode

### "I'm at /portal/code but see a project, not the home screen"

This means `activeSessionId` is set somehow. To reset:
1. Click "Chat" mode (switches mode)
2. Click "Code" mode (switches back)
3. This should reset `activeSessionId` to null
4. Home screen should appear

Alternatively, inspect the component state in React DevTools to see what `activeSessionId` value is.

---

## ✅ Success Criteria

You'll know it's working when:

1. ✅ Visit `/portal/code` → See project home screen
2. ✅ See "Start New Project" card with dashed border
3. ✅ See all existing projects as cards in a grid
4. ✅ Click project card → URL changes to `/portal/code/{id}`
5. ✅ Refresh page → Still on same project (URL persists)
6. ✅ Navigate back to `/portal/code` → See home screen again

The feature is fully implemented and pushed to GitHub. Just waiting for deployment.
