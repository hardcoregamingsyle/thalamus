Set-Location "$PSScriptRoot"

# Remove any stale git lock file
$lock = ".git\index.lock"
if (Test-Path $lock) {
    Remove-Item $lock -Force
    Write-Host "Removed $lock"
}

# Stage all changes
git add -A

# Commit
$msg = @"
fix: WPF build errors, download links, dynamic pipeline, chat search

WPF XAML fixes:
* LoginWindow.xaml: remove CornerRadius setter on Button, move Grid.RowDefinitions
  before child content, remove UWP-only CharacterSpacing from TextBlock
* MainWindow.xaml: CornerRadius fix, SidebarBtn Border wrapped children in Grid
* ResearchView.xaml: remove TextTransform (CSS-only), uppercase string literal
* release.yml: fix AssemblyVersion when ref_name is branch name

WPF C# fixes:
* MainWindow.xaml.cs: AuthDot is Border not Ellipse, use .Background not .Fill
* CodeView.xaml.cs, ResearchView.xaml.cs, ChatView.xaml.cs, StudyView.xaml.cs:
  Thickness(x,y) requires 4 args in WPF, expanded to Thickness(x,y,x,y)
* SandboxView.xaml.cs: nullable annotations on fields initialized later
* VncIntegration.cs: nullable annotations on fields and events

Download link fixes:
* Landing.tsx, vmLauncher.ts, VMSetupDialog.tsx: releases/latest/download redirect

Dynamic pipeline (Dispatcher agent):
* New Dispatcher agent selects minimum needed agents per task complexity
* schema.ts + codeBranches: dispatchedAgentsJson field and mutation

Chat mode web search:
* ai.ts: chat mode system prompt now includes SEARCH-TOOL syntax
* ai.ts: search loop executes queries via performSearch then re-calls AI

Other:
* ApiPage.tsx: TS7006 type annotation fix
* agentCore.ts: Dispatcher system prompt and model mapping
"@

git commit -m $msg

Write-Host ""
Write-Host "Commit done. Now push with:"
Write-Host "git push origin main"
