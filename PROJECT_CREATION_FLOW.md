# 🚀 Project Creation Flow - Import from GitHub or Start from Scratch

**Date:** 2026-05-22  
**Status:** ✅ IMPLEMENTED

---

## 🎯 Feature Overview

Added a project creation modal that allows users to choose between importing a repository from GitHub or starting a new project from scratch. This provides a streamlined onboarding experience for Code Mode projects.

---

## 📍 User Flow

### 1. Click "Start New Project" Card
When you click the "Start New Project" card on the project home screen (`/portal/code`), a modal appears with two options:

```
┌─────────────────────────────────────────┐
│ Create New Project                      │
├─────────────────────────────────────────┤
│                                         │
│  ┌───────────────┐  ┌─────────────────┐│
│  │ Import from   │  │ Start from      ││
│  │ GitHub        │  │ Scratch         ││
│  │               │  │                 ││
│  │ [GitHub Icon] │  │ [Plus Icon]     ││
│  │               │  │                 ││
│  │ Connect your  │  │ Create a new    ││
│  │ GitHub account│  │ empty project   ││
│  │ and select a  │  │ and build from  ││
│  │ repository    │  │ the ground up   ││
│  └───────────────┘  └─────────────────┘│
└─────────────────────────────────────────┘
```

---

## 🔀 Option 1: Import from GitHub

### Step 1: GitHub Connection Check
- If GitHub is **not connected**: Shows a connection prompt
  - Displays "Connect GitHub" button
  - Redirects to GitHub OAuth flow
  - After authorization, returns to the app

- If GitHub **is connected**: Shows repository list
  - Displays username: `Connected as @username`
  - Loads all repositories (up to 100, sorted by recent updates)
  - Shows search bar to filter repositories

### Step 2: Repository Selection
- Grid of repository cards showing:
  - Repository name
  - Full name (username/repo)
  - Privacy status (PRIVATE badge if applicable)
  - Default branch

- Click a repository to select it
- Selected repository is highlighted with:
  - Primary border color
  - Primary background tint
  - Check icon

### Step 3: Branch Selection
- After selecting a repository, a branch input appears
- Pre-filled with the repository's default branch (usually `main` or `master`)
- Can be changed to any branch name

### Step 4: Import
- Click "Import Repository" button
- Creates a new Code Mode session
- Configures GitHub sync for the session
- Pulls all files from the repository
- Opens the project with the imported codebase
- Toast shows: `Repository imported! ↓{count} files`

### Example Flow:
```
1. User clicks "Import from GitHub"
   ↓
2. If not connected: Shows "Connect GitHub" button
   → User clicks → OAuth flow → Returns to app
   ↓
3. Loads user's repositories (100 most recent)
   ↓
4. User searches/browses repositories
   ↓
5. User clicks "my-awesome-project" repository
   ↓
6. Branch auto-filled as "main" (can edit)
   ↓
7. User clicks "Import Repository"
   ↓
8. Session created with title: "Import and work on repository: my-awesome-project"
   ↓
9. Repository files synced to session
   ↓
10. User is navigated to /portal/code/{customId}
   ↓
11. Project opens with imported files ready to work on
```

---

## 🆕 Option 2: Start from Scratch

### Simple Flow:
1. User clicks "Start from Scratch"
2. New empty session is created immediately
3. Title: `"New project - describe what you want to build"`
4. User is navigated to the new project
5. Chat is open and ready for input
6. User describes what they want to build
7. Code Mode agents start building from scratch

### Example Flow:
```
1. User clicks "Start from Scratch"
   ↓
2. Session created with default title
   ↓
3. User navigated to /portal/code/{customId}
   ↓
4. Chat opens with empty project
   ↓
5. User types: "Build a todo app with React and Tailwind"
   ↓
6. Agents start working: Researcher → Analyser → Planner → Coder...
```

---

## 💻 Technical Implementation

### New Components

#### 1. **ProjectCreationModal** (lines 625-691)
Modal that shows two options: Import from GitHub or Start from Scratch.

**Props:**
- `onClose: () => void` - Close the modal
- `onImportFromGithub: () => void` - Handle "Import from GitHub" click
- `onStartFromScratch: () => void` - Handle "Start from Scratch" click

#### 2. **GithubImportModal** (lines 693-923)
Modal that handles GitHub repository import with OAuth and repository selection.

**Props:**
- `onClose: () => void` - Close the modal
- `onConnect: () => Promise<void>` - Initiate GitHub OAuth
- `onSelectRepo: (repoName: string, branch: string) => Promise<void>` - Import selected repository
- `isConnecting: boolean` - OAuth in progress
- `isLoadingRepos: boolean` - Loading repositories
- `repos: Array<{...}>` - List of GitHub repositories
- `githubUsername?: string | null` - Connected GitHub username
- `isGithubConnected: boolean` - GitHub connection status

**Features:**
- Search/filter repositories by name
- Shows repository privacy status
- Branch selection with default branch pre-filled
- Responsive grid layout
- Loading states for connection and repository loading

### State Management

Added state variables:
```typescript
const [showProjectCreationModal, setShowProjectCreationModal] = useState(false);
const [showGithubImportModal, setShowGithubImportModal] = useState(false);
const [isLoadingGithubRepos, setIsLoadingGithubRepos] = useState(false);
const [githubRepos, setGithubRepos] = useState<Array<{...}>>([]);
```

### API Actions Used

#### From `api.github`:
- `listUserRepos` - Fetch user's GitHub repositories (up to 100, sorted by update)
- `getAuthorizationUrl` - Generate GitHub OAuth URL

#### From `api.agentTeam`:
- `saveGithubConfig` - Configure GitHub repo/branch for a session
- `syncGithub` - Pull files from GitHub repository
- `createSession` - Create a new Code Mode session

### Handler Functions

#### 1. **handleImportFromGithub** (lines 1957-1971)
```typescript
const handleImportFromGithub = async () => {
  setShowProjectCreationModal(false);
  setShowGithubImportModal(true);
  
  if (githubStatus?.connected && token) {
    setIsLoadingGithubRepos(true);
    const repos = await listUserReposAction({ token });
    setGithubRepos(repos);
    setIsLoadingGithubRepos(false);
  }
};
```

#### 2. **handleSelectGithubRepo** (lines 1973-2018)
```typescript
const handleSelectGithubRepo = async (repoName: string, branch: string) => {
  // Create session
  const { sessionId, customId } = await createSession({
    task: `Import and work on repository: ${repoName}`,
    token
  });
  
  // Configure GitHub
  await saveGithubConfigAction({ sessionId, githubRepo: repoName, githubBranch: branch, token });
  
  // Sync files
  const syncResult = await syncGithubAction({ sessionId, token });
  
  // Navigate to project
  setActiveSessionId(sessionId);
  onSessionChange?.(customId);
};
```

#### 3. **handleStartFromScratch** (lines 2027-2045)
```typescript
const handleStartFromScratch = async () => {
  setShowProjectCreationModal(false);
  
  const result = await createSession({
    task: "New project - describe what you want to build",
    token
  });
  
  setActiveSessionId(result.sessionId);
  onSessionChange?.(result.customId);
  toast.success("New project created! Describe what you want to build.");
};
```

---

## 🎨 UI Design

### ProjectCreationModal
- **Layout:** 2-column grid (responsive: 1 column on mobile)
- **Card Height:** 192px (h-48)
- **Hover Effect:** Scale 1.02x
- **Colors:** 
  - Border: `border-border` → `border-primary/50` on hover
  - Background: `bg-card` → `bg-primary/5` on hover

### GithubImportModal
- **Max Width:** 2xl (672px)
- **Max Height:** 80vh (scrollable content)
- **Repository Cards:**
  - Unselected: `border-border bg-card`
  - Selected: `border-primary bg-primary/10`
  - Shows checkmark icon when selected
- **Search Bar:** Full-width with border focus effect
- **Loading State:** Centered spinner while fetching repositories

---

## 🔐 Security & Privacy

### GitHub OAuth Flow
1. User clicks "Connect GitHub"
2. Redirects to GitHub with OAuth app credentials
3. User authorizes Thalamus to access repositories
4. GitHub redirects back with authorization code
5. Backend exchanges code for access token
6. Access token stored securely in user record

### Permissions Requested
- `repo` - Access to private and public repositories
- `user` - Read user profile information

### Data Stored
- GitHub username
- GitHub access token (encrypted in database)
- Repository name and branch per session
- No repository contents stored outside of session files

---

## 🧪 Testing Guide

### Test Case 1: Import from GitHub (Already Connected)
1. Click "Start New Project"
2. Click "Import from GitHub"
3. ✅ **Expected:** See list of repositories immediately
4. Search for a repository
5. ✅ **Expected:** Results filter as you type
6. Click a repository
7. ✅ **Expected:** Card highlights, branch field appears
8. Click "Import Repository"
9. ✅ **Expected:** Session created, files imported, project opens

### Test Case 2: Import from GitHub (Not Connected)
1. Click "Start New Project"
2. Click "Import from GitHub"
3. ✅ **Expected:** See "Connect GitHub" button
4. Click "Connect GitHub"
5. ✅ **Expected:** Redirects to GitHub OAuth
6. Authorize the app
7. ✅ **Expected:** Returns to app, shows repository list
8. Continue with repository selection...

### Test Case 3: Start from Scratch
1. Click "Start New Project"
2. Click "Start from Scratch"
3. ✅ **Expected:** New session created immediately
4. ✅ **Expected:** URL changes to `/portal/code/{customId}`
5. ✅ **Expected:** Chat opens with empty project
6. ✅ **Expected:** Toast: "New project created! Describe what you want to build."

### Test Case 4: Search Repositories
1. Open GitHub import modal (with connection)
2. Type "react" in search bar
3. ✅ **Expected:** Only repositories with "react" in name/full_name show
4. Clear search
5. ✅ **Expected:** All repositories visible again

### Test Case 5: Private Repository Import
1. Select a private repository (has PRIVATE badge)
2. Import it
3. ✅ **Expected:** Import works (user has OAuth access)
4. ✅ **Expected:** Files sync correctly

---

## 🎯 User Benefits

### Before This Feature:
- ❌ No clear way to import existing GitHub projects
- ❌ Had to manually configure GitHub sync after creating session
- ❌ "Start New Project" card only opened generic GitHub modal
- ❌ No repository browser - had to know exact repo name
- ❌ Couldn't see which repos were private
- ❌ No search functionality

### After This Feature:
- ✅ Clear two-option flow: Import or Start Fresh
- ✅ Browse all GitHub repositories visually
- ✅ Search/filter repositories by name
- ✅ See repository privacy status
- ✅ Auto-import with one click
- ✅ Default branch pre-filled
- ✅ Seamless project creation for both flows
- ✅ Professional onboarding experience

---

## 📱 Responsive Design

### Mobile (< 768px):
- ProjectCreationModal: 1 column, cards stack vertically
- GithubImportModal: Full-width, scrollable list
- Search bar full-width

### Tablet (768px - 1024px):
- ProjectCreationModal: 2 columns
- GithubImportModal: 2-column repo grid (if space allows)

### Desktop (> 1024px):
- ProjectCreationModal: 2 columns side-by-side
- GithubImportModal: Multi-column repo grid
- Better spacing and padding

---

## 🐛 Error Handling

### GitHub Connection Errors:
- OAuth failure → Toast: "Failed to initiate GitHub OAuth"
- Rate limit → Toast: "GitHub API rate limit reached"
- Invalid token → Toast: "GitHub session expired, please reconnect"

### Repository Loading Errors:
- API failure → Toast: "Failed to load repositories"
- Empty list → Shows: "No repositories found"
- Search no results → Shows: "No repositories match your search"

### Import Errors:
- Session creation fails → Toast: "Failed to create project"
- GitHub config fails → Toast: "Failed to save config"
- Sync fails → Toast with error message from API

---

## 🎉 Summary

Users can now:
1. **Choose their onboarding path** - Import existing work or start fresh
2. **Browse GitHub repositories** - Visual grid with search
3. **One-click import** - Select repo → Import → Start working
4. **Seamless creation** - From empty project to running agents in seconds

This makes Code Mode much more accessible for developers with existing codebases while maintaining a fast path for greenfield projects.

---

## 📝 Files Modified

**Main Implementation:**
- `src/pages/TeamPortalInline.tsx`
  - Lines 625-691: ProjectCreationModal component
  - Lines 693-923: GithubImportModal component
  - Lines 1731-1733: Added state variables
  - Lines 1957-2045: Handler functions
  - Lines 2938-2953: Modal rendering in JSX

**API Used:**
- `src/convex/github.ts` - listUserRepos action
- `src/convex/agentTeam.ts` - createSession, saveGithubConfig, syncGithub

**No Backend Changes Required** - Used existing API endpoints.
