@echo off
REM ═══════════════════════════════════════════════════════════════════════════
REM  Thalamus AI — Windows Build Script
REM ═══════════════════════════════════════════════════════════════════════════
REM
REM  Builds the Qt 6 C++ desktop app and WiX Toolset installer.
REM  Run from a Visual Studio 2022 Developer Command Prompt (x64).
REM
REM  Prerequisites:
REM    1. Visual Studio 2022 with "Desktop development with C++" workload
REM    2. CMake 3.22+ (included with VS)
REM    3. Qt 6.5+ with static linking support
REM       - Install via online installer: https://www.qt.io/download
REM       - Required modules: Core, Gui, Widgets, Network, WebSockets, Svg
REM    4. WiX Toolset v4 (optional, for MSI installer)
REM       - Download: https://wixtoolset.org/releases/
REM    5. Inno Setup 6.x (optional, for .exe installer)
REM       - Download: https://jrsoftware.org/isdl.php
REM
REM  Usage:
REM    build.bat              - Full build (debug)
REM    build.bat release      - Release build
REM    build.bat installer    - Release build + MSI installer
REM ═══════════════════════════════════════════════════════════════════════════

setlocal EnableDelayedExpansion

set VERSION=1.0.0
set ROOT=%~dp0
set APP_DIR=%ROOT%ThalamusApp
set BUILD_DIR=%ROOT%build
set INSTALLER_DIR=%ROOT%installer
set DIST_DIR=%ROOT%dist

echo ╔══════════════════════════════════════════════════════════════╗
echo ║        Thalamus AI  v%VERSION%  —  Build Script          ║
echo ╚══════════════════════════════════════════════════════════════╝
echo.

REM ── Parse arguments ───────────────────────────────────────────────────────
set BUILD_TYPE=Debug
set BUILD_INSTALLER=0

:parse_args
if "%1"=="" goto :done_args
if /i "%1"=="release" set BUILD_TYPE=Release
if /i "%1"=="installer" set BUILD_TYPE=Release & set BUILD_INSTALLER=1
if /i "%1"=="clean" goto :clean
if /i "%1"=="help" goto :help
shift
goto :parse_args
:done_args

REM ── Step 1: Check prerequisites ──────────────────────────────────────────
echo [1/5] Checking prerequisites...

where cmake >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo ERROR: CMake not found. Install Visual Studio 2022 with CMake.
    exit /b 1
)
echo   ✓ CMake found

if "%BUILD_TYPE%"=="Release" (
    where dotnet >nul 2>&1
    if %ERRORLEVEL% NEQ 0 (
        echo   WARNING: dotnet not found. WiX will not be available.
        set BUILD_INSTALLER=0
    ) else (
        echo   ✓ .NET SDK found
    )
)

REM ── Step 2: Configure CMake ──────────────────────────────────────────────
echo [2/5] Configuring CMake (%BUILD_TYPE%)...

if not exist "%BUILD_DIR%" mkdir "%BUILD_DIR%"

cd /d "%BUILD_DIR%"

cmake "%APP_DIR%" -G "Visual Studio 17 2022" -A x64 ^
    -DCMAKE_BUILD_TYPE=%BUILD_TYPE% ^
    -DCMAKE_MSVC_RUNTIME_LIBRARY="MultiThreaded%if '%BUILD_TYPE%'=='Debug' (echo Debug)" ^
    -DBUILD_SHARED_LIBS=OFF

if %ERRORLEVEL% NEQ 0 (
    echo ERROR: CMake configuration failed.
    exit /b 1
)
echo   ✓ CMake configured

REM ── Step 3: Build ────────────────────────────────────────────────────────
echo [3/5] Building ThalamusApp (%BUILD_TYPE%)...

cmake --build . --config %BUILD_TYPE% --parallel

if %ERRORLEVEL% NEQ 0 (
    echo ERROR: Build failed.
    exit /b 1
)

echo   ✓ Build complete

REM ── Step 4: Stage build output ───────────────────────────────────────────
echo [4/5] Staging build output...

if not exist "%DIST_DIR%" mkdir "%DIST_DIR%"

set APP_EXE=%BUILD_DIR%\%BUILD_TYPE%\Thalamus.exe
if exist "%APP_EXE%" (
    copy /Y "%APP_EXE%" "%DIST_DIR%\Thalamus.exe"
    for %%I in ("%APP_EXE%") do echo   ✓ Thalamus.exe (%%~zI bytes)
) else (
    echo   WARNING: Thalamus.exe not found at %APP_EXE%
)

REM ── Step 5: Build Installer (optional) ───────────────────────────────────
if "%BUILD_INSTALLER%"=="1" (
    echo [5/5] Building installer...

    where candle >nul 2>&1
    if %ERRORLEVEL% NEQ 0 (
        echo   WARNING: WiX Toolset (candle.exe) not found. Skipping MSI creation.
        echo   Download from: https://wixtoolset.org/releases/
    ) else (
        cd /d "%INSTALLER_DIR%"

        REM Compile Product.wxs → .wixobj
        candle Product.wxs -out "%BUILD_DIR%\Product.wixobj" ^
            -dVersion=%VERSION% ^
            -arch x64
        if %ERRORLEVEL% NEQ 0 (
            echo   WARNING: WiX Product compilation failed.
        ) else (
            REM Link to .msi
            light "%BUILD_DIR%\Product.wixobj" -out "%BUILD_DIR%\ThalamusApp.msi" ^
                -ext WixUIExtension ^
                -cultures:en-US
            if %ERRORLEVEL% NEQ 0 (
                echo   WARNING: WiX MSI linking failed.
            ) else (
                for %%I in ("%BUILD_DIR%\ThalamusApp.msi") do echo   ✓ MSI: ThalamusApp.msi (%%~zI bytes)
            )
        )

        REM Compile Bundle.wxs → setup.exe (Burn bootstrapper with VC++ redist)
        if exist "%BUILD_DIR%\ThalamusApp.msi" (
            candle Bundle.wxs -out "%BUILD_DIR%\Bundle.wixobj" ^
                -dVersion=%VERSION% ^
                -arch x64
            if %ERRORLEVEL% EQU 0 (
                light "%BUILD_DIR%\Bundle.wixobj" -out "%DIST_DIR%\Thalamus-Setup-v%VERSION%.exe" ^
                    -ext WixBalExtension ^
                    -cultures:en-US
                if %ERRORLEVEL% EQU 0 (
                    for %%I in ("%DIST_DIR%\Thalamus-Setup-v%VERSION%.exe") do echo   ✓ Installer: Thalamus-Setup-v%VERSION%.exe (%%~zI bytes)
                ) else (
                    echo   WARNING: Burn bundle linking failed.
                )
            ) else (
                echo   WARNING: Bundle compilation failed.
            )
        ) else (
            echo   SKIP: Bundle requires MSI to be built first.
        )
    )
) else (
    echo [5/5] Skipping installer (use 'build.bat installer' to build MSI)
)

echo.
echo ╔══════════════════════════════════════════════════════════════╗
echo ║              Build Complete!  v%VERSION%                  ║
echo ╚══════════════════════════════════════════════════════════════╝
echo.
echo Outputs:
if exist "%DIST_DIR%\Thalamus.exe" echo   - %DIST_DIR%\Thalamus.exe
if exist "%DIST_DIR%\Thalamus-Setup-v%VERSION%.exe" echo   - %DIST_DIR%\Thalamus-Setup-v%VERSION%.exe (Burn bundle — recommended for distribution)
if exist "%BUILD_DIR%\ThalamusApp.msi" echo   - %BUILD_DIR%\ThalamusApp.msi (standalone MSI — for enterprise deployment)
echo.
echo To sign the executable:
echo   signtool sign /f certificate.pfx /p password /t http://timestamp.digicert.com ^
echo     "%DIST_DIR%\Thalamus.exe"
echo.

cd /d "%ROOT%"
endlocal
goto :eof

REM ── Clean ────────────────────────────────────────────────────────────────
:clean
echo Cleaning build artifacts...
if exist "%BUILD_DIR%" rmdir /S /Q "%BUILD_DIR%"
if exist "%DIST_DIR%" rmdir /S /Q "%DIST_DIR%"
echo Clean complete.
goto :eof

REM ── Help ─────────────────────────────────────────────────────────────────
:help
echo.
echo Thalamus AI Build Script
echo ========================
echo.
echo Usage: build.bat [command]
echo.
echo Commands:
echo   (none)       Debug build (fast compilation)
echo   release      Release build (optimised, needs Qt static libs)
echo   installer    Release build + MSI installer (needs WiX Toolset)
echo   clean        Remove build artifacts
echo   help         Show this help
echo.
echo Examples:
echo   build.bat              - Quick debug build
echo   build.bat release      - Optimised release build
echo   build.bat installer    - Full release with installer
echo.
echo Prerequisites:
echo   - Visual Studio 2022 (x64 command prompt)
echo   - CMake 3.22+
echo   - Qt 6.5+ (set CMAKE_PREFIX_PATH if needed)
echo   - WiX Toolset v4 (for MSI installer)
echo.
echo Qt Setup:
echo   set CMAKE_PREFIX_PATH=C:\Qt\6.5.3\msvc2022_64
goto :eof
