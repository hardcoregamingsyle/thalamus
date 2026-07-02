@echo off
setlocal enabledelayedexpansion
title Thalamus AI Installer Builder

set "INSTALLER_DIR=%~dp0"
set "PROJECT_DIR=%~dp0.."
set "DIST_DIR=%PROJECT_DIR%\dist"
set "APP_VERSION=1.0.0"

echo ============================================
echo  Thalamus AI - Installer Builder
echo ============================================
echo.

:: ── Check prerequisites ───────────────────────────────────────────────
echo [Check] Verifying prerequisites...

:: Check for WiX Toolset v4
where candle >nul 2>&1
if %errorlevel% neq 0 (
    echo [WARN] WiX Toolset (candle.exe) not found.
    echo [WARN] MSI installer will be skipped.
    set "SKIP_MSI=1"
) else (
    echo [OK]   WiX Toolset found
    set "SKIP_MSI="
)

:: Check for Inno Setup
if exist "C:\Program Files (x86)\Inno Setup 6\ISCC.exe" (
    set "ISCC=C:\Program Files (x86)\Inno Setup 6\ISCC.exe"
    echo [OK]   Inno Setup found
) else if exist "C:\Program Files\Inno Setup 6\ISCC.exe" (
    set "ISCC=C:\Program Files\Inno Setup 6\ISCC.exe"
    echo [OK]   Inno Setup found
) else (
    echo [WARN] Inno Setup (ISCC.exe) not found.
    echo [WARN] EXE installer will be skipped.
    set "SKIP_EXE=1"
)

:: Check for Thalamus.exe
if not exist "%DIST_DIR%\Thalamus.exe" (
    echo [ERROR] Thalamus.exe not found in %DIST_DIR%
    echo [ERROR] Build the app first: build.bat release
    pause & exit /b 1
) else (
    echo [OK]   Thalamus.exe found
)

echo.

:: ── Build MSI Installer (WiX) ────────────────────────────────────────
if not defined SKIP_MSI (
    echo [1/2] Building MSI installer...
    
    :: Compile .wxs to .wixobj
    candle "%INSTALLER_DIR%\Product.wxs" -out "%DIST_DIR%\Product.wixobj" -arch x64
    if %errorlevel% neq 0 (
        echo [ERROR] WiX compilation (candle) failed.
        set "MSI_FAILED=1"
    ) else (
        :: Link .wixobj to .msi
        light "%DIST_DIR%\Product.wixobj" -out "%DIST_DIR%\Thalamus-Setup-v%APP_VERSION%.msi" -ext WixUIExtension
        if %errorlevel% neq 0 (
            echo [ERROR] WiX linking (light) failed.
            set "MSI_FAILED=1"
        ) else (
            echo [OK]   MSI: %DIST_DIR%\Thalamus-Setup-v%APP_VERSION%.msi
            
            :: Optionally build Burn bundle (EXE bootstrapper) if WiX is available
            if exist "%INSTALLER_DIR%\Bundle.wxs" (
                echo [1/2] Building EXE bootstrapper (WiX Burn)...
                candle "%INSTALLER_DIR%\Bundle.wxs" -out "%DIST_DIR%\Bundle.wixobj" -arch x64
                if !errorlevel! equ 0 (
                    light "%DIST_DIR%\Bundle.wixobj" -out "%DIST_DIR%\Thalamus-Setup-Burn-v%APP_VERSION%.exe" -ext WixBalExtension
                    if !errorlevel! equ 0 (
                        echo [OK]   EXE (Burn): %DIST_DIR%\Thalamus-Setup-Burn-v%APP_VERSION%.exe
                    )
                )
            )
        )
    )
) else (
    echo [SKIP] MSI installer (WiX Toolset not found)
)

echo.

:: ── Build EXE Installer (Inno Setup) ─────────────────────────────────
if not defined SKIP_EXE (
    echo [2/2] Building EXE installer (Inno Setup)...
    
    "%ISCC%" "%INSTALLER_DIR%\setup.iss" /Q
    if %errorlevel% neq 0 (
        echo [ERROR] Inno Setup compilation failed.
        set "EXE_FAILED=1"
    ) else (
        :: Check output
        if exist "%DIST_DIR%\Thalamus-Setup-v%APP_VERSION%.exe" (
            echo [OK]   EXE: %DIST_DIR%\Thalamus-Setup-v%APP_VERSION%.exe
        ) else (
            echo [CHECK] Inno Setup may have output to a different path.
            dir "%DIST_DIR%\*.exe" 2>nul
        )
    )
) else (
    echo [SKIP] EXE installer (Inno Setup not found)
)

echo.
echo ============================================
if not defined SKIP_MSI if not defined MSI_FAILED (
    echo  MSI: %DIST_DIR%\Thalamus-Setup-v%APP_VERSION%.msi
)
if not defined SKIP_EXE if not defined EXE_FAILED (
    echo  EXE: %DIST_DIR%\Thalamus-Setup-v%APP_VERSION%.exe
    echo.
    echo  NOTE: The .exe is the standalone installer.
    echo  Use this instead of the .msi to avoid installation errors.
)
echo ============================================
echo.

echo.
echo Important: Always run the installer as Administrator.
echo If you get "The installation package could not be opened":
echo   1. Right-click the installer -^> Properties
echo   2. Check "Unblock" if it appears (downloaded files)
echo   3. Right-click -^> "Run as administrator"
echo.

endlocal
