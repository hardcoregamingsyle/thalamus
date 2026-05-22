# 🌿 Git Branch Creation on Code Mode Branch

**Date:** 2026-05-22  
**Status:** ✅ IMPLEMENTED

---

## 🎯 Feature Overview

When you create a branch in Code Mode (right-click a session → "Create Branch"), the system now automatically creates a matching Git branch in your connected GitHub repository. This keeps your Code Mode project structure synchronized with your Git repository structure.

---

## 🔀 How It Works

### Before This Feature:
- Creating a branch in Code Mode only created a new session
- Files were copied to the new session
- **No Git branch was created** in the GitHub repository
- All branches would commit to the same Git branch

### After This Feature:
- Creating a branch in Code Mode creates a new session **AND** a new Git branch
- The Git branch is automatically created from the base branch's current commit
- The new session is configured to use the new Git branch
- When you commit changes, they go to the correct Git branch

---

## 📍 User Flow

### Step 1: Create a Branch in Code Mode
1. Right-click on an existing project session
2. Click "Create Branch"
3. Enter a branch purpose (e.g., "Android APK", "Dark Mode UI", "API v2")
4. Click "Create Branch"

### Step 2: Automatic Git Branch Creation
Behind the scenes, if GitHub is connected:
1. System checks if the main session has GitHub configured
2. Fetches the current commit SHA from the base branch (e.g., `main`)
3. Creates a new Git branch with a sanitized name:
   - Original purpose: "Android APK Build"
   - Sanitized: `android-apk-build-{random-suffix}`
   - Example: `android-apk-build-7x4k`
4. Configures the new Code Mode session to use this Git branch
5. All future commits in this branch session go to the new Git branch

### Step 3: Work on the Branch
- The branch session has all files from the main session
- AI agents work on the branch independently
- When changes are made, they're committed to the new Git branch
- You can switch between branches just like normal projects

---

## 🔧 Technical Implementation

### Code Location
**File:** `src/convex/agentTeam.ts`  
**Function:** `createBranch` (lines 2861-2920 and 2968-3027)

### Implementation Details

#### 1. **Branch Name Sanitization**
```typescript
const sanitizedBranchName = args.branchPurpose
  .toLowerCase()
  .replace(/[^a-z0-9-]/g, "-")
  .replace(/--+/g, "-")
  .slice(0, 50);
const newBranchName = `${sanitizedBranchName}-${Date.now().toString(36).slice(-4)}`;
```

**Examples:**
- "Android APK" → `android-apk-7x4k`
- "Dark Mode UI!" → `dark-mode-ui-9a2b`
- "API v2 Implementation" → `api-v2-implementation-5c8d`

The random suffix (using base36 timestamp) prevents branch name collisions.

#### 2. **Git Branch Creation Process**
```typescript
// 1. Get GitHub credentials
const user = await ctx.runQuery(internal.githubHelpers.getUserById, { userId });
const githubAccessToken = user?.githubAccessToken;

// 2. Get base branch's current commit SHA
const baseRefRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/refs/heads/${githubBranch}`);
const baseSha = baseRefData.object.sha;

// 3. Create new Git branch
const createBranchRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/refs`, {
  method: "POST",
  body: JSON.stringify({
    ref: `refs/heads/${newBranchName}`,
    sha: baseSha,
  }),
});

// 4. Save Git branch to session
await ctx.runMutation(internal.agentTeamHelpers.saveGithubConfigMutation, {
  sessionId: branchResult.sessionId,
  githubRepo,
  githubBranch: newBranchName,
});
```

#### 3. **Error Handling**
- If GitHub is not connected → Git branch creation is skipped (silent)
- If Git branch already exists (422 error) → Use the existing branch
- If any other error → Log warning but don't fail the branch creation
- Code Mode branching always succeeds, even if Git branching fails

---

## 🎨 Branch Workflow Example

### Scenario: Main project + Android and iOS branches

**Initial State:**
```
Code Mode:
- Session A (main project) → Git branch: main

GitHub:
- main branch (all commits)
```

**Create Android Branch:**
```
Code Mode:
- Session A (main project) → Git branch: main
- Session B (Android APK) → Git branch: android-apk-7x4k

GitHub:
- main branch
- android-apk-7x4k branch (created automatically)
```

**Create iOS Branch:**
```
Code Mode:
- Session A (main project) → Git branch: main
- Session B (Android APK) → Git branch: android-apk-7x4k
- Session C (iOS Build) → Git branch: ios-build-9b3c

GitHub:
- main branch
- android-apk-7x4k branch
- ios-build-9b3c branch (created automatically)
```

**Commit Changes:**
- Changes in Session A → Committed to `main` branch
- Changes in Session B → Committed to `android-apk-7x4k` branch
- Changes in Session C → Committed to `ios-build-9b3c` branch

---

## 🧪 Testing Guide

### Test Case 1: Create Branch (GitHub Connected)
1. Have a project connected to GitHub
2. Right-click the project session
3. Click "Create Branch"
4. Enter purpose: "Feature Branch"
5. Create the branch
6. ✅ **Expected:** New Code Mode session created
7. ✅ **Expected:** New Git branch `feature-branch-{suffix}` created in GitHub
8. ✅ **Expected:** Toast: "Branch created! Group: {name}"
9. Check GitHub repository
10. ✅ **Expected:** New branch visible in GitHub branches list

### Test Case 2: Create Branch (No GitHub)
1. Have a project WITHOUT GitHub connected
2. Right-click the project session
3. Click "Create Branch"
4. Enter purpose: "Test Branch"
5. Create the branch
6. ✅ **Expected:** New Code Mode session created
7. ✅ **Expected:** No Git branch created (silent skip)
8. ✅ **Expected:** Toast: "Branch created! Group: {name}"

### Test Case 3: Commit to Branch
1. Create a branch (Test Case 1)
2. Open the new branch session
3. Make changes to files
4. Commit changes (automatic or manual)
5. Check GitHub repository
6. ✅ **Expected:** Commits appear on the branch, NOT on main

### Test Case 4: Branch Name Sanitization
1. Create branch with purpose: "UI v2.0 (Dark Mode)!"
2. Check GitHub
3. ✅ **Expected:** Branch name: `ui-v2-0-dark-mode--{suffix}`
4. ✅ **Expected:** No special characters, all lowercase

### Test Case 5: Duplicate Branch Names
1. Create branch: "Feature A"
2. Create another branch: "Feature A"
3. ✅ **Expected:** Two different Git branches created
4. ✅ **Expected:** Names: `feature-a-{suffix1}` and `feature-a-{suffix2}`

---

## 🔐 Security Considerations

### GitHub API Access
- Uses user's stored OAuth token (from GitHub connection)
- Token is stored securely in the database
- API calls use `Authorization: Bearer {token}` header
- User must have `repo` scope permission

### Permissions Required
- `repo` scope - Required to create branches in the repository
- User must have write access to the repository

### Error Cases
- Invalid token → Git branch creation fails (silent)
- No write access → GitHub API returns 403 (silent)
- Rate limited → GitHub API returns 429 (silent)
- In all cases, Code Mode branch creation succeeds

---

## 📊 Database Changes

### Session Table Updates
When a branch is created with GitHub configured:
```
branchSession: {
  _id: "...",
  githubRepo: "my-repo",           // Copied from main
  githubBranch: "android-apk-7x4k", // NEW Git branch
  // ... other fields
}
```

**Before:** Branch sessions had same `githubBranch` as main session  
**After:** Branch sessions have their own unique `githubBranch`

---

## 🎯 User Benefits

### Before This Feature:
- ❌ All branches committed to the same Git branch
- ❌ No way to isolate branch changes in Git
- ❌ Had to manually create Git branches
- ❌ Code Mode branches didn't match Git structure
- ❌ Merging branches required manual Git work

### After This Feature:
- ✅ Each Code Mode branch has its own Git branch
- ✅ Changes are isolated per branch
- ✅ Git branches created automatically
- ✅ Code Mode structure matches Git structure
- ✅ Pull requests can be created from branch commits
- ✅ Professional Git workflow maintained

---

## 🚀 Future Enhancements

Possible future improvements:
1. **Branch Merging** - Merge Code Mode branches and create Git PR
2. **Branch Deletion** - Delete Code Mode branch → optionally delete Git branch
3. **Custom Branch Names** - Let users specify exact Git branch name
4. **Branch from Commit** - Create branch from specific commit, not HEAD
5. **Protected Branches** - Warn if trying to commit to protected branches

---

## 🐛 Troubleshooting

### "Branch created but no Git branch"
**Cause:** GitHub not connected or connection expired  
**Fix:** Go to GitHub Sync modal and reconnect GitHub

### "Branch name looks weird"
**Cause:** Special characters in branch purpose  
**Expected:** Special characters are automatically sanitized  
**Example:** "UI 2.0!" → `ui-2-0--{suffix}`

### "Changes going to wrong branch"
**Cause:** Session's githubBranch field not set correctly  
**Fix:** Check session's GitHub config in database

### "Permission denied when creating branch"
**Cause:** User doesn't have write access to repository  
**Fix:** Grant write access or use a repository you own

---

## 📝 Files Modified

**Main Implementation:**
- `src/convex/agentTeam.ts` (lines 2861-2920, 2968-3027)
  - Added Git branch creation logic to `createBranch` function
  - Sanitizes branch names
  - Uses GitHub API to create refs
  - Saves Git branch to session

**API Endpoints Used:**
- `GET /repos/{owner}/{repo}/git/refs/heads/{branch}` - Get base commit SHA
- `POST /repos/{owner}/{repo}/git/refs` - Create new Git branch

**Database Functions:**
- `internal.agentTeamHelpers.saveGithubConfigMutation` - Save Git branch to session
- `internal.githubHelpers.getUserById` - Get GitHub access token

---

## ✅ Summary

Creating a branch in Code Mode now automatically:
1. Creates a new Code Mode session with copied files
2. Creates a new Git branch in the connected GitHub repository
3. Links the session to the new Git branch
4. Ensures all future commits go to the correct branch

This maintains a clean Git workflow and keeps your Code Mode project structure synchronized with your Git repository structure.
