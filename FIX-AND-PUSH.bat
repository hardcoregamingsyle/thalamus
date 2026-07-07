@echo off
title Thalamus - Fix & Push to GitHub
color 0A
echo.
echo  =========================================
echo   Thalamus Git Fix + GitHub Push
echo  =========================================
echo.

cd /d "%~dp0"

:: Step 1 - Remove stale lock files
echo [1/5] Removing stale git lock files...
if exist ".git\HEAD.lock" (
    del /f /q ".git\HEAD.lock"
    echo        Removed HEAD.lock
) else (
    echo        No HEAD.lock found (good)
)
if exist ".git\index.lock" (
    del /f /q ".git\index.lock"
    echo        Removed index.lock
)

:: Step 2 - Undo the bad commit (keep all files on disk)
echo.
echo [2/5] Undoing bad commit (restoring all files in git)...
git reset HEAD~1
if %ERRORLEVEL% neq 0 (
    echo ERROR: git reset failed. See message above.
    pause
    exit /b 1
)
echo        Done - all files now staged/unstaged

:: Step 3 - Stage everything
echo.
echo [3/5] Staging all files...
git add -A
echo        Done

:: Step 4 - Commit cleanly
echo.
echo [4/5] Creating clean commit...
git -c user.email="thalamus-ai@auto-commit.local" -c user.name="Thalamus AI" commit -m "feat: overhaul desktop app UI + fix AuthDesktop auth

Desktop app (.exe):
- Replace all 4 empty placeholder mode views (Chat, Build, Research, Study)
  with full premium WPF UI implementations
- ChatView: message bubbles, model pills, animated typing, streaming SSE
- Build/CodeView: 9-agent pipeline with progress dots, code output
- ResearchView: animated progress bar, example prompts, streaming output
- StudyView: tutor/quiz/solve/summary modes, subject chips, purple theme
- MainWindow: vector Path icons in sidebar (no more emoji), Build mode label

Website:
- AuthDesktop.tsx: replace useAuthActions with custom OTP flow to fix auth"

if %ERRORLEVEL% neq 0 (
    echo ERROR: git commit failed. See message above.
    pause
    exit /b 1
)

:: Step 5 - Force push using PAT
echo.
echo [5/5] Force pushing to GitHub...
git push origin main --force

if %ERRORLEVEL% neq 0 (
    echo.
    echo ERROR: Push failed. See message above.
    pause
    exit /b 1
)

echo.
echo  =========================================
echo   SUCCESS! GitHub repo restored.
echo  =========================================
echo.
pause
