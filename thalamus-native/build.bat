@echo off
REM Thalamus AI — Build Script
REM Usage: build.bat [release|installer]
REM   (no arg)  = Debug build
REM   release   = Release build (static linking)
REM   installer = Release + MSI installer

setlocal enabledelayedexpansion

set SCRIPT_DIR=%~dp0
set BUILD_DIR=%SCRIPT_DIR%build
set DIST_DIR=%SCRIPT_DIR%dist

set BUILD_TYPE=Debug
set GENERATOR="Visual Studio 17 2022"

if /I "%1"=="release" set BUILD_TYPE=Release
if /I "%1"=="installer" set BUILD_TYPE=Release

set RUNTIME_LIB=MultiThreaded
if "%BUILD_TYPE%"=="Debug" set RUNTIME_LIB=MultiThreadedDebug

echo === Thalamus AI Build Script ===
echo Build type: %BUILD_TYPE%
echo.

REM Step 1: Configure CMake
echo [1/3] Configuring CMake...
if not exist "%BUILD_DIR%" mkdir "%BUILD_DIR%"

cmake -S "%SCRIPT_DIR%ThalamusApp" -B "%BUILD_DIR%" ^
    -G %GENERATOR% ^
    -A x64 ^
    -DCMAKE_BUILD_TYPE=%BUILD_TYPE% ^
    -DCMAKE_MSVC_RUNTIME_LIBRARY=%RUNTIME_LIB% ^
    -DBUILD_SHARED_LIBS=OFF

if %ERRORLEVEL% neq 0 (
    echo ERROR: CMake configuration failed.
    exit /b 1
)

REM Step 2: Build
echo [2/3] Building...
cmake --build "%BUILD_DIR%" --config %BUILD_TYPE% --parallel

if %ERRORLEVEL% neq 0 (
    echo ERROR: Build failed.
    exit /b 1
)

REM Step 3: Copy to dist
echo [3/3] Copying output...
if not exist "%DIST_DIR%" mkdir "%DIST_DIR%"
copy /Y "%BUILD_DIR%\%BUILD_TYPE%\Thalamus.exe" "%DIST_DIR%\Thalamus.exe" >nul

echo.
echo === Build complete! ===
echo Output: %DIST_DIR%\Thalamus.exe

REM Step 4: Build MSI installer (if requested)
if /I "%1"=="installer" (
    echo.
    echo [4/4] Building MSI installer...
    
    where candle >nul 2>nul
    if !ERRORLEVEL! neq 0 (
        echo WARNING: WiX Toolset not found. Skipping installer build.
        echo To build MSI, install WiX Toolset v4 from https://wixtoolset.org/
        exit /b 0
    )
    
    candle "%SCRIPT_DIR%installer\Product.wxs" -out "%BUILD_DIR%\Product.wixobj" -arch x64
    if !ERRORLEVEL! neq 0 (
        echo ERROR: WiX compilation failed.
        exit /b 1
    )
    
    light "%BUILD_DIR%\Product.wixobj" -out "%DIST_DIR%\Thalamus-Setup-v1.0.0.msi" -ext WixUIExtension
    if !ERRORLEVEL! neq 0 (
        echo ERROR: WiX linking failed.
        exit /b 1
    )
    
    echo Installer: %DIST_DIR%\Thalamus-Setup-v1.0.0.msi
    echo.
    echo === Full build + installer complete! ===
)

exit /b 0
