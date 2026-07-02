@echo off
setlocal enabledelayedexpansion
title Thalamus AI Build

:: ── Config ──────────────────────────────────────────────────────────────
set "BUILD_DIR=%~dp0build"
set "DIST_DIR=%~dp0dist"
set "SOURCE_DIR=%~dp0ThalamusApp"
set "INSTALLER_DIR=%~dp0installer"
set "APP_VERSION=1.0.0"

:: ── Parse arguments ─────────────────────────────────────────────────────
set "CONFIG="
if /I "%1"=="release" set "CONFIG=Release"
if /I "%1"=="debug"   set "CONFIG=Debug"
if /I "%1"=="installer" (
    set "CONFIG=Release"
    set "BUILD_INSTALLER=1"
)
if "%CONFIG%"=="" set "CONFIG=Debug"

echo ============================================
echo  Thalamus AI - Windows Build Script
echo ============================================
echo  Configuration: %CONFIG%
echo  Source:        %SOURCE_DIR%
echo  Build:         %BUILD_DIR%
echo  Dist:          %DIST_DIR%
echo ============================================
echo.

:: ── Verify prerequisites ───────────────────────────────────────────────
echo [1/4] Checking prerequisites...

where cmake >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] CMake not found. Install Visual Studio 2022 with C++ tools.
    pause & exit /b 1
)

if not defined CMAKE_PREFIX_PATH (
    if exist "C:\Qt\6.5.3\msvc2022_64" (
        set "CMAKE_PREFIX_PATH=C:\Qt\6.5.3\msvc2022_64"
    ) else (
        echo [WARN] CMAKE_PREFIX_PATH not set. Searching for Qt...
        if exist "C:\Qt" (
            for /d %%q in ("C:\Qt\6.*") do (
                if exist "%%q\msvc2022_64" set "CMAKE_PREFIX_PATH=%%q\msvc2022_64"
            )
        )
        if not defined CMAKE_PREFIX_PATH (
            echo [ERROR] Qt 6 not found. Set CMAKE_PREFIX_PATH or install Qt.
            pause & exit /b 1
        )
    )
)
echo [1/4] CMake: OK
echo [1/4] Qt:    %CMAKE_PREFIX_PATH%

:: ── Configure CMake ────────────────────────────────────────────────────
echo.
echo [2/4] Configuring CMake...

if not exist "%BUILD_DIR%" mkdir "%BUILD_DIR%"

cmake -S "%SOURCE_DIR%" -B "%BUILD_DIR%" ^
    -G "Visual Studio 17 2022" ^
    -A x64 ^
    -DCMAKE_BUILD_TYPE=%CONFIG% ^
    -DCMAKE_PREFIX_PATH="%CMAKE_PREFIX_PATH%" ^
    -DCMAKE_MSVC_RUNTIME_LIBRARY=MultiThreaded ^
    -DBUILD_SHARED_LIBS=OFF

if %errorlevel% neq 0 (
    echo [ERROR] CMake configuration failed.
    pause & exit /b 1
)
echo [2/4] CMake configured successfully.

:: ── Build ───────────────────────────────────────────────────────────────
echo.
echo [3/4] Building %CONFIG%...

cmake --build "%BUILD_DIR%" --config %CONFIG% --parallel

if %errorlevel% neq 0 (
    echo [ERROR] Build failed.
    pause & exit /b 1
)
echo [3/4] Build succeeded.

:: ── Copy to dist ───────────────────────────────────────────────────────
echo.
echo [4/4] Copying output to dist...

if not exist "%DIST_DIR%" mkdir "%DIST_DIR%"

copy /Y "%BUILD_DIR%\%CONFIG%\Thalamus.exe" "%DIST_DIR%\Thalamus.exe" >nul
if exist "%BUILD_DIR%\%CONFIG%\Thalamus.pdb" (
    copy /Y "%BUILD_DIR%\%CONFIG%\Thalamus.pdb" "%DIST_DIR%\Thalamus.pdb" >nul
)

echo [4/4] Output: %DIST_DIR%\Thalamus.exe
echo.

:: ── Build installer if requested ───────────────────────────────────────
if defined BUILD_INSTALLER (
    echo.
    echo ============================================
    echo  Building Installer
    echo ============================================
    
    call "%INSTALLER_DIR%\create-installer.bat"
    
    if %errorlevel% neq 0 (
        echo [ERROR] Installer build failed.
        pause & exit /b 1
    )
    echo Installer built successfully.
)

echo.
echo ============================================
echo  Build complete!
echo  Binary:   %DIST_DIR%\Thalamus.exe
if defined BUILD_INSTALLER (
    echo  MSI:      %DIST_DIR%\Thalamus-Setup-v%APP_VERSION%.msi
    echo  EXE:      %DIST_DIR%\Thalamus-Setup-v%APP_VERSION%.exe
)
echo ============================================
echo.

endlocal
