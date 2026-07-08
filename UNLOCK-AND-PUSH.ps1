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
feat: dynamic pipeline dispatch, TS fix, streaming, L4.5 agents, admin model config

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
