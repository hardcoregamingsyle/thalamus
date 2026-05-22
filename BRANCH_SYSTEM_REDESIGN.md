# 🌿 Branch System Redesign - True Git-Style Branches

**Date:** 2026-05-22  
**Status:** 🚧 IN PROGRESS

---

## 🎯 Goal

Replace the current "session fork" model with a true Git-style branch system where:
- Branches are part of ONE project (not separate sessions)
- Switch branches with a dropdown
- All context/messages/agents shared
- Only file states differ per branch
- Merge branches back together

---

## ❌ Current Problems

### What It Does Now (Wrong):
```
Main Project → Right-click "Create Branch"
  ↓
Creates ENTIRELY NEW SESSION
  - New session ID
  - Copies all 500 files
  - Separate messages
  - Separate agents
  - No way to merge back
  - Just a fork/variant
```

### Why This Is Wrong:
- **Not a branch, it's a clone** - Separate projects
- **No merge workflow** - Can't bring changes back
- **No branch switching** - Have to navigate between projects
- **Isolation defeats the purpose** - Can't share context
- **Confusing UX** - Looks like branches but acts like forks

---

## ✅ New Design: True Branches

### How It Should Work:
```
Project Session (ID: abc123)
├── Branch: main (default)
│   ├── Files: v1 state
│   ├── Messages: shared across all branches
│   └── Agents: shared across all branches
│
├── Branch: feature/dark-mode
│   ├── Files: v2 state (modified)
│   ├── Messages: SAME as main
│   └── Agents: SAME as main
│
└── Branch: feature/api-v2
    ├── Files: v3 state (different mods)
    ├── Messages: SAME as main
    └── Agents: SAME as main
```

### Key Principle:
**One session, multiple file states. Everything else shared.**

---

## 📊 Database Schema Changes

### Current:
```typescript
teamSessions: {
  _id: Id<"teamSessions">;
  title: string;
  // ... all fields
  branchGroupId?: string; // Links to other sessions
}
```

### New:
```typescript
teamSessions: {
  _id: Id<"teamSessions">;
  title: string;
  currentBranch: string; // "main", "feature/xyz"
  branches: {
    name: string;
    createdAt: number;
    createdFrom: string; // parent branch
    gitBranch?: string; // GitHub branch name
  }[];
  // ... other fields (shared across branches)
}

projectFiles: {
  sessionId: Id<"teamSessions">;
  branch: string; // NEW: which branch this file belongs to
  filepath: string;
  content: string;
  // ... other fields
}
```

---

## 🎨 UI Components

### 1. Branch Switcher (Top Bar)
```
┌─────────────────────────────────────────┐
│ 🌿 main ▾ │ Project: Todo App          │
└─────────────────────────────────────────┘
        ↓ (dropdown opens)
┌──────────────────────────┐
│ ● main                   │ ← current
│   feature/dark-mode      │
│   feature/api-v2         │
│ ─────────────────────    │
│ + Create Branch...       │
│ 🔀 Merge Branch...       │
└──────────────────────────┘
```

### 2. Branch Indicator (File Tree)
```
📁 Files (main)
├── 📄 index.tsx
├── 📄 App.tsx
└── 📁 components/
```

### 3. Branch Actions
- **Switch Branch** - Instant file state change
- **Create Branch** - From current branch
- **Merge Branch** - Merge to main/other branch
- **Delete Branch** - Remove branch (keep main)
- **Pull Changes** - Sync from Git

---

## 🔧 Implementation Plan

### Phase 1: Backend Schema
- [ ] Add `currentBranch` field to sessions
- [ ] Add `branches` array to sessions  
- [ ] Add `branch` field to projectFiles
- [ ] Migration script for existing sessions

### Phase 2: Branch Operations
- [ ] `createBranch()` - Create new branch pointer
- [ ] `switchBranch()` - Change currentBranch
- [ ] `mergeBranch()` - Merge file changes
- [ ] `deleteBranch()` - Remove branch
- [ ] `getBranchFiles()` - Get files for branch

### Phase 3: UI Components
- [ ] BranchSwitcher dropdown component
- [ ] Branch indicator in file tree
- [ ] Branch creation modal (simplified)
- [ ] Merge conflict resolution UI
- [ ] Branch visualization graph

### Phase 4: Git Integration
- [ ] Create Git branch on branch creation
- [ ] Switch Git branch on switch
- [ ] Merge creates PR or merges Git
- [ ] Sync branch state with Git

---

## 📝 API Functions

### Backend Actions

```typescript
// Create branch (fast - just metadata)
export const createBranch = action({
  args: {
    sessionId: v.id("teamSessions"),
    branchName: v.string(),
    fromBranch: v.string(), // "main"
    token: v.string(),
  },
  handler: async (ctx, args) => {
    // 1. Add branch to session.branches[]
    // 2. Copy current file references to new branch
    // 3. Create Git branch
    // 4. Return immediately (no file copying needed!)
  }
});

// Switch branch (instant)
export const switchBranch = action({
  args: {
    sessionId: v.id("teamSessions"),
    branchName: v.string(),
    token: v.string(),
  },
  handler: async (ctx, args) => {
    // 1. Set session.currentBranch = branchName
    // 2. Frontend re-fetches files for new branch
    // 3. Messages/agents stay the same
  }
});

// Merge branch
export const mergeBranch = action({
  args: {
    sessionId: v.id("teamSessions"),
    sourceBranch: v.string(),
    targetBranch: v.string(),
    token: v.string(),
  },
  handler: async (ctx, args) => {
    // 1. Get files from source branch
    // 2. Get files from target branch
    // 3. Detect conflicts
    // 4. Auto-merge non-conflicting files
    // 5. Return conflicts for manual resolution
    // 6. Create Git PR if GitHub connected
  }
});
```

### Frontend Hooks

```typescript
// Current branch
const currentBranch = sessionInfo?.currentBranch || "main";

// Branch list
const branches = sessionInfo?.branches || [{ name: "main", createdAt: Date.now(), createdFrom: "" }];

// Switch branch
const switchBranch = async (branchName: string) => {
  await switchBranchAction({ sessionId, branchName, token });
  // Files automatically reload for new branch
};
```

---

## 🎯 User Experience

### Creating a Branch:
```
1. Click branch dropdown → "Create Branch..."
2. Modal: "Branch name: feature/dark-mode"
3. Click "Create" → Instant (< 1 second)
4. Branch created, Git branch created
5. You're now on the new branch
```

### Switching Branches:
```
1. Click branch dropdown
2. Click "feature/dark-mode"
3. Files instantly change to that branch's state
4. Messages/agents stay the same
5. Continue working
```

### Merging Branches:
```
1. Click branch dropdown → "Merge Branch..."
2. Select: "Merge feature/dark-mode → main"
3. System shows:
   ✓ 15 files auto-merged
   ⚠️ 3 conflicts need resolution
4. Resolve conflicts in UI
5. Click "Complete Merge"
6. Optional: Create GitHub PR
```

---

## 🔄 Migration Strategy

### Existing "Branch Groups" → Real Branches

For existing sessions with `branchGroupId`:

```typescript
// Migration function
export const migrateBranchGroups = internalAction({
  handler: async (ctx) => {
    const groups = await ctx.runQuery(internal.agentTeamHelpers.getAllBranchGroups);
    
    for (const group of groups) {
      // 1. Find main session
      const main = group.mainSessionId;
      
      // 2. Convert all branch sessions to branches
      for (const branchSession of group.branchSessions) {
        // Add as branch to main session
        // Copy files with branch tag
        // Delete branch session
      }
      
      // 3. Clean up branch group
    }
  }
});
```

---

## ⚡ Performance Benefits

### Current System:
- Create branch: **635 seconds** (timeout)
- File copying: **500 files × sequential**
- Storage: **Duplicates everything**

### New System:
- Create branch: **< 1 second** (just metadata)
- File copying: **0** (files stay in place, tagged by branch)
- Storage: **No duplication** (same files, different branch tags)

---

## 🎨 Visual Design

### Branch Switcher (Premium UI)
```tsx
<motion.div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-card border border-border hover:border-primary/40">
  <GitBranch className="h-4 w-4 text-primary" />
  <span className="font-mono text-sm">{currentBranch}</span>
  <ChevronDown className="h-3 w-3" />
</motion.div>
```

### Branch List
```tsx
{branches.map(branch => (
  <div className={cn(
    "px-3 py-2 hover:bg-muted/50 cursor-pointer",
    branch.name === currentBranch && "bg-primary/10 text-primary"
  )}>
    {branch.name === currentBranch && "● "}
    {branch.name}
  </div>
))}
```

---

## ✅ Success Criteria

A proper branch system means:

1. ✅ **< 1 second branch creation** (not 10+ minutes)
2. ✅ **Instant branch switching** (no navigation)
3. ✅ **Shared context** (messages/agents work across branches)
4. ✅ **Merge capability** (bring changes together)
5. ✅ **Git integration** (real Git branches)
6. ✅ **Visual branch tree** (see relationships)
7. ✅ **No duplication** (files tagged, not copied)

---

## 🚀 Next Steps

1. **Phase 1: Schema** - Add branch fields to database
2. **Phase 2: Backend** - Implement branch operations
3. **Phase 3: UI** - Build branch switcher
4. **Phase 4: Merge** - Add merge functionality
5. **Phase 5: Migration** - Convert existing branch groups

This will transform branches from "confusing forks" to "powerful Git-style collaboration tool."
