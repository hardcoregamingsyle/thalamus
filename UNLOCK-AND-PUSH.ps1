Set-Location "$PSScriptRoot"

# Remove any stale git lock file
$lock = ".git\index.lock"
if (Test-Path $lock) {
    Remove-Item $lock -Force
    Write-Host "Removed $lock"
}

# Stage all changes
git add -A

# Commit — use a here-string so PowerShell doesn't parse '-' as an operator
$msg = @"
fix: download links, dynamic pipeline dispatch, TS fix

Download link fixes (4 files):
* Landing.tsx: switch from hardcoded v2.0.0 tag to releases/latest/download/ redirect
* Landing.tsx: add download attribute so browser saves file instead of navigating
* vmLauncher.ts: same latest-redirect fix for INSTALLER_URL and BRIDGE_URL
* VMSetupDialog.tsx: same latest-redirect fix + download attribute

Dynamic pipeline (Dispatcher agent):
* New Dispatcher agent runs first, classifies task complexity (trivial/simple/medium/complex/full)
* Chooses minimum agent set needed -- simple tasks skip Researcher/Analyser/Planner entirely
* Coder and Critic always guaranteed; Hacker only added when explicitly requested
* codeBranches: dispatchedAgentsJson field, setDispatchedAgents internalMutation
* buildPlanningPipeline/buildTaskPipeline derive runtime pipelines from dispatched list
* parseDispatcherOutput validates JSON and ensures Coder+Critic always present
* Trivial/simple tasks get a synthetic single-task plan and jump straight to execution
* schema.ts: dispatchedAgentsJson field on codeBranches

Other fixes:
* ApiPage.tsx: explicit type annotation on keys.map() callback (TS7006 fix)
* agentCore.ts: Dispatcher system prompt + haiku tier in all MODE_MATRIX modes
"@

git commit -m $msg

Write-Host ""
Write-Host "Commit done. Now push with your PAT:"
Write-Host 'git push origin main'
