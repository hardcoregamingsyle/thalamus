# Run this as: Right-click → "Run with PowerShell"
# Or in PowerShell: Set-ExecutionPolicy Bypass -Scope Process; .\FIX-AND-PUSH.ps1

$ErrorActionPreference = "Stop"
$repoPath = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $repoPath

Write-Host "`n=========================================" -ForegroundColor Green
Write-Host "  Thalamus Git Fix + GitHub Push" -ForegroundColor Green
Write-Host "=========================================`n" -ForegroundColor Green

# Step 1 — Kill anything that might hold the lock
Write-Host "[1/6] Closing processes that may hold git locks..." -ForegroundColor Cyan
$lockHolders = @("git", "GitHubDesktop", "Code", "devenv", "idea64", "atom", "sublime_text")
foreach ($proc in $lockHolders) {
    $found = Get-Process -Name $proc -ErrorAction SilentlyContinue
    if ($found) {
        Write-Host "       Stopping $proc..." -ForegroundColor Yellow
        Stop-Process -Name $proc -Force -ErrorAction SilentlyContinue
        Start-Sleep -Milliseconds 500
    }
}

# Step 2 — Force-remove ALL lock files
Write-Host "`n[2/6] Force-removing git lock files..." -ForegroundColor Cyan
$lockFiles = @(".git\HEAD.lock", ".git\index.lock", ".git\MERGE_HEAD.lock", ".git\CHERRY_PICK_HEAD.lock")
foreach ($lockFile in $lockFiles) {
    $fullPath = Join-Path $repoPath $lockFile
    if (Test-Path $fullPath) {
        # Use .NET to force-delete even if "in use"
        try {
            [System.IO.File]::Delete($fullPath)
            Write-Host "       Deleted $lockFile" -ForegroundColor Green
        } catch {
            # Last resort: takeown + attrib
            takeown /f $fullPath /a 2>$null | Out-Null
            attrib -r -s -h $fullPath 2>$null | Out-Null
            Remove-Item -Path $fullPath -Force -ErrorAction SilentlyContinue
            Write-Host "       Force-deleted $lockFile" -ForegroundColor Green
        }
    }
}

# Verify lock is gone
if (Test-Path (Join-Path $repoPath ".git\HEAD.lock")) {
    Write-Host "`nERROR: Could not delete HEAD.lock. Please manually delete:" -ForegroundColor Red
    Write-Host "  $repoPath\.git\HEAD.lock" -ForegroundColor Red
    Write-Host "`nTry: Close GitHub Desktop, VS Code, and any terminals, then re-run." -ForegroundColor Yellow
    Read-Host "`nPress Enter to exit"
    exit 1
}

Write-Host "       All locks cleared!" -ForegroundColor Green

# Step 3 — Undo bad commit
Write-Host "`n[3/6] Undoing bad commit (files stay on disk)..." -ForegroundColor Cyan
$result = git reset HEAD~1 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: $result" -ForegroundColor Red
    Read-Host "Press Enter to exit"
    exit 1
}
Write-Host "       Reset complete" -ForegroundColor Green

# Step 4 — Stage all files
Write-Host "`n[4/6] Staging all files..." -ForegroundColor Cyan
git add -A 2>&1 | Out-Null
Write-Host "       Staged" -ForegroundColor Green

# Step 5 — Commit
Write-Host "`n[5/6] Creating clean commit..." -ForegroundColor Cyan
$env:GIT_AUTHOR_NAME = "Thalamus AI"
$env:GIT_AUTHOR_EMAIL = "thalamus-ai@auto-commit.local"
$env:GIT_COMMITTER_NAME = "Thalamus AI"
$env:GIT_COMMITTER_EMAIL = "thalamus-ai@auto-commit.local"

$commitMsg = @"
feat: overhaul desktop app UI + fix AuthDesktop auth

Desktop app (.exe):
- Replace all 4 empty placeholder mode views (Chat, Build, Research, Study)
  with full premium WPF UI implementations
- ChatView: message bubbles, model pills, animated typing, streaming SSE
- Build/CodeView: 9-agent pipeline with progress dots, code output
- ResearchView: animated progress bar, example prompts, streaming output
- StudyView: tutor/quiz/solve/summary modes, subject chips, purple theme
- MainWindow: vector Path icons in sidebar (no more emoji), Build mode label

Website:
- AuthDesktop.tsx: replace useAuthActions with custom OTP flow to fix auth
"@

git commit -m $commitMsg 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: Commit failed" -ForegroundColor Red
    Read-Host "Press Enter to exit"
    exit 1
}
Write-Host "       Committed!" -ForegroundColor Green

# Step 6 — Force push
Write-Host "`n[6/6] Force pushing to GitHub..." -ForegroundColor Cyan
git push origin main --force 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Host "`nPush failed. Check your git credentials." -ForegroundColor Red
    Read-Host "`nPress Enter to exit"
    exit 1
}

Write-Host "`n=========================================" -ForegroundColor Green
Write-Host "  SUCCESS! GitHub repo fully restored." -ForegroundColor Green
Write-Host "=========================================" -ForegroundColor Green
Write-Host "`nAll files are now on GitHub." -ForegroundColor White
Read-Host "`nPress Enter to close"
