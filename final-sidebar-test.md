# Final Sidebar Test - Manual Verification Checklist

## ✅ Test the Sidebar

### 1. Navigate to Workspace
Visit: `https://thalamus.aphantic.skinticals.com/portal/code/SV8DU1TESD/0KM2IGQ2CA`

**Expected**:
- [  ] Sidebar visible on left (256px wide)
- [  ] "BACKEND" section with 3 items
- [  ] "WORKSPACE" section with 6 items  
- [  ] Chat button in sidebar footer
- [  ] Main chat area on right

### 2. Test Backend Section

#### Data View
Click "Data" in sidebar → Should navigate to `/data`
- [  ] Shows files list
- [  ] Shows messages list
- [  ] Data loads correctly

#### Logs View
Click "Logs" in sidebar → Should navigate to `/logs`
- [  ] Shows commands executed
- [  ] Shows agent activity
- [  ] Logs load correctly

#### Usage View
Click "Usage" in sidebar → Should navigate to `/data-usage`
- [  ] Shows usage analytics card
- [  ] "Coming soon" message visible

### 3. Test Workspace Section

#### Editor View
Click "Editor" in sidebar → Should navigate to `/code-ide`
- [  ] Shows file tree
- [  ] Shows editor area
- [  ] Files load correctly

#### Version View
Click "Version" in sidebar → Should navigate to `/version-control`
- [  ] Shows version control card
- [  ] "Coming soon" message visible

#### Git-Sync View
Click "Git-Sync" in sidebar → Should navigate to `/github`
- [  ] Shows GitHub sync form
- [  ] Repository URL input visible

#### Deploy View
Click "Deploy" in sidebar → Should navigate to `/deploy`
- [  ] Shows Vercel card
- [  ] Shows Netlify card
- [  ] Shows Cloudflare card

#### Sandbox View
Click "Sandbox" in sidebar → Should navigate to `/sandbox`
- [  ] Shows VM info
- [  ] Shows command input
- [  ] Sandbox UI loads

#### Keys View
Click "Keys" in sidebar → Should navigate to `/keys`
- [  ] Shows API keys list
- [  ] Shows pending requests (if any)

### 4. Test Navigation

#### Chat Button
Click "Chat" button in sidebar footer
- [  ] Returns to main chat view
- [  ] URL changes to base workspace URL

#### Back Button
Click back arrow in sidebar header
- [  ] Returns to branches list
- [  ] URL changes to project page

### 5. Test Active States

Navigate through all pages and verify:
- [  ] Active page has primary background color
- [  ] Active page has chevron icon
- [  ] Inactive pages have muted color
- [  ] Hover effects work on inactive items

### 6. Test Message Sending

From chat view:
- [  ] Type a message
- [  ] Click Send button
- [  ] Message appears in chat
- [  ] Pipeline status updates

### 7. Test Real-Time Updates

While pipeline is running:
- [  ] Status badge updates (Running: Researcher)
- [  ] Messages appear as agents work
- [  ] File count updates in header
- [  ] Sidebar remains accessible during execution

---

## Expected Issues (Known Limitations)

These are NOT bugs, just not implemented yet:

1. Usage View - Shows "coming soon" (no metrics yet)
2. Version View - Shows "coming soon" (no history yet)
3. Git-Sync View - Form disabled (no GitHub integration yet)
4. Deploy View - Buttons disabled (no deployment yet)
5. Sandbox View - Shows placeholder (VM not connected yet)

---

## Critical Issues to Report

If you see any of these, report immediately:

- [ ] Sidebar not visible at all
- [ ] Clicking sidebar items does nothing
- [ ] Active state not showing
- [ ] Layout broken (sidebar overlapping content)
- [ ] TypeScript errors in console
- [ ] Navigation not working

---

## Success Criteria

✅ **PASS** if:
- Sidebar visible and functional
- All 10 pages accessible
- Navigation smooth
- Active states correct
- No console errors

❌ **FAIL** if:
- Sidebar missing
- Pages not loading
- Navigation broken
- Console errors present

---

## Test Result:

Date: _______________
Tester: _______________

Overall Status: [ ] PASS  [ ] FAIL

Notes:
_________________________________________________________________
_________________________________________________________________
_________________________________________________________________

