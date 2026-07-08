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
fix: WPF build errors, download links, dynamic pipeline dispatch

WPF build fixes:
* LoginWindow.xaml: remove invalid CornerRadius setter on Button (not a Button property)
  CornerRadius is now hardcoded on the Border inside the ControlTemplate instead
* MainWindow.xaml: same fix for PrimaryBtn and GhostBtn styles
* release.yml: fix Invalid AssemblyVersion when ref_name is a branch (e.g. "main")
  Version now validated as numeric, falls back to 2.0.0 if not a vX.Y.Z tag

Download link fixes:
* Landing.tsx: switch from hardcoded v2.0.0 tag to releases/latest/download/ redirect
* Landing.tsx: add download attribute so browser saves file instead of navigating
* vmLauncher.ts: same latest-redirect fix for INSTALLER_URL and BRIDGE_URL
* VMSetupDialog.tsx: same latest-redirect fix + download attribute

Dynamic pipeline (Dispatcher agent):
* New Dispatcher agent classifies task complexity and selects minimum needed agents
* Coder and Critic always guaranteed; Hacker only added when explicitly requested
* codeBranches: dispatchedAgentsJson field, setDispatchedAgents internalMutation
* schema.ts: dispatchedAgentsJson field on codeBranches

Other:
* ApiPage.tsx: explicit type annotation on keys.map() callback (TS7006 fix)
* agentCore.ts: Dispatcher system prompt + haiku tier in all MODE_MATRIX modes
"@

git commit -m $msg

Write-Host ""
Write-Host "Commit done. Now push with your PAT:"
Write-Host 'git push origin main'
