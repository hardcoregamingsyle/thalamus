# Building the Thalamus AI Native Installer

This guide provides step-by-step instructions for building the native C# desktop application and creating a complete installer package.

## Prerequisites

### Software Requirements

- **Windows 10/11 (64-bit)** - For building and testing
- **.NET 8.0 SDK** - Download from https://dotnet.microsoft.com/download/dotnet/8.0
- **Visual Studio 2022** or **Visual Studio Code** - For development
- **Inno Setup 6.x** - Download from https://jrsoftware.org/isdl.php
- **QEMU** (optional) - For testing VM functionality
- **Git** - For version control

### Additional Tools

- **7-Zip** or **WinRAR** - For creating compressed archives
- **Signtool** - For code signing (included with Visual Studio)
- **PowerShell 5.0+** - For build automation scripts

## Build Process

### Step 1: Prepare the C# Project

1. **Clone the repository:**
   ```bash
   git clone https://github.com/hardcoregamingsyle/thalamus.git
   cd thalamus/thalamus-native/ThalamusApp
   ```

2. **Restore NuGet packages:**
   ```bash
   dotnet restore
   ```

3. **Update version number** in `ThalamusApp.csproj`:
   ```xml
   <Version>1.0.0</Version>
   ```

### Step 2: Build the Application

1. **Build Release Configuration:**
   ```bash
   dotnet build -c Release
   ```

2. **Publish as Self-Contained Executable:**
   ```bash
   dotnet publish -c Release -r win-x64 --self-contained -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true
   ```

   This creates a single `Thalamus.exe` (~50-100 MB) that includes the .NET runtime.

3. **Output Location:**
   ```
   bin/Release/net8.0-windows/win-x64/publish/Thalamus.exe
   ```

### Step 3: Prepare Installer Components

Create the following directory structure for the installer:

```
installer-build/
├── Thalamus.exe                    (from publish output)
├── thalamus-vm-bridge.exe          (from ../bridge/)
├── tvnviewer.exe                   (from ../tools/)
├── qemu/                           (optional - QEMU binaries)
│   ├── qemu-system-x86_64.exe
│   ├── qemu-img.exe
│   └── ... (other QEMU DLLs)
├── installer.iss                   (Inno Setup script)
└── icon.ico                        (application icon)
```

#### 3.1 Copy Application Executable

```bash
copy "bin\Release\net8.0-windows\win-x64\publish\Thalamus.exe" "installer-build\"
```

#### 3.2 Copy Bridge Executable

```bash
copy "..\bridge\thalamus-vm-bridge.exe" "installer-build\"
```

#### 3.3 Copy VNC Viewer

```bash
copy "..\tools\tvnviewer.exe" "installer-build\"
```

#### 3.4 Copy QEMU Binaries (Optional)

If bundling QEMU:

```bash
mkdir installer-build\qemu
copy "C:\Program Files\QEMU\*" "installer-build\qemu\"
```

### Step 4: Create Installer Script

Create `installer.iss` with the following content:

```ini
; Thalamus AI Installer
; Built with Inno Setup 6.x

#define MyAppName "Thalamus AI"
#define MyAppVersion "1.0.0"
#define MyAppPublisher "Aphantic Corporations"
#define MyAppURL "https://thalamus.aphantic.skinticals.com"
#define MyAppExeName "Thalamus.exe"

[Setup]
AppId={{A1B2C3D4-E5F6-7890-ABCD-EF1234567890}}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
AppPublisherURL={#MyAppURL}
AppSupportURL={#MyAppURL}
AppUpdatesURL={#MyAppURL}
DefaultDirName={autopf}\{#MyAppName}
DefaultGroupName={#MyAppName}
AllowNoIcons=yes
LicenseFile=
OutputDir=dist
OutputBaseFilename=Thalamus-Setup-v{#MyAppVersion}
SetupIconFile=icon.ico
Compression=lzma2/ultra64
SolidCompression=yes
WizardStyle=modern
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=dialog
UninstallDisplayIcon={app}\{#MyAppExeName}
UninstallDisplayName={#MyAppName}
VersionInfoVersion={#MyAppVersion}
VersionInfoCompany={#MyAppPublisher}
VersionInfoDescription={#MyAppName} Installer
VersionInfoProductName={#MyAppName}
VersionInfoProductVersion={#MyAppVersion}
MinVersion=10.0.17763

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked
Name: "startupbridge"; Description: "Start VM Bridge automatically on login"; GroupDescription: "Startup options:"; Flags: checked

[Files]
; Main application
Source: "Thalamus.exe"; DestDir: "{app}"; Flags: ignoreversion

; VM Bridge
Source: "thalamus-vm-bridge.exe"; DestDir: "{app}"; Flags: ignoreversion

; VNC Viewer
Source: "tvnviewer.exe"; DestDir: "{app}"; Flags: ignoreversion

; QEMU (optional)
Source: "qemu\*"; DestDir: "{app}\qemu"; Flags: ignoreversion recursesubdirs; Check: QemuIncluded

; Application icon
Source: "icon.ico"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{group}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"
Name: "{group}\{cm:UninstallProgram,{#MyAppName}}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; Tasks: desktopicon

[Run]
Filename: "{app}\{#MyAppExeName}"; Description: "{cm:LaunchProgram,{#StringChange(MyAppName, '&', '&&')}}"; Flags: nowait postinstall skipifsilent

[Registry]
; Register thalamus:// URI scheme
Root: HKCU; Subkey: "Software\Classes\thalamus"; ValueType: string; ValueName: ""; ValueData: "URL:Thalamus Protocol"; Flags: uninsdeletekey
Root: HKCU; Subkey: "Software\Classes\thalamus"; ValueType: string; ValueName: "URL Protocol"; ValueData: ""
Root: HKCU; Subkey: "Software\Classes\thalamus\shell\open\command"; ValueType: string; ValueName: ""; ValueData: """{app}\{#MyAppExeName}"" ""%1"""

; Add bridge to startup
Root: HKCU; Subkey: "Software\Microsoft\Windows\CurrentVersion\Run"; ValueType: string; ValueName: "ThalamusBridge"; ValueData: """{app}\thalamus-vm-bridge.exe"""; Tasks: startupbridge; Flags: uninsdeletevalue

[UninstallRun]
Filename: "taskkill"; Parameters: "/f /im Thalamus.exe /t"; Flags: runhidden waituntilterminated
Filename: "taskkill"; Parameters: "/f /im thalamus-vm-bridge.exe /t"; Flags: runhidden waituntilterminated

[Code]
function QemuIncluded: Boolean;
begin
  Result := DirExists(ExpandConstant('{src}\qemu'));
end;
```

### Step 5: Build the Installer

1. **Open Inno Setup:**
   - Launch Inno Setup Compiler
   - Open `installer.iss`

2. **Build:**
   - Click "Build" menu → "Compile"
   - Or use command line:
     ```bash
     "C:\Program Files (x86)\Inno Setup 6\ISCC.exe" installer.iss
     ```

3. **Output:**
   - `dist/Thalamus-Setup-v1.0.0.exe` (~50-150 MB depending on QEMU inclusion)

### Step 6: Code Signing (Optional but Recommended)

1. **Obtain a Code Signing Certificate:**
   - Purchase from a trusted CA (e.g., DigiCert, Sectigo)
   - Or use a self-signed certificate for testing

2. **Sign the Executable:**
   ```bash
   signtool sign /f "certificate.pfx" /p "password" /t "http://timestamp.server.com" "Thalamus.exe"
   ```

3. **Sign the Installer:**
   ```bash
   signtool sign /f "certificate.pfx" /p "password" /t "http://timestamp.server.com" "Thalamus-Setup-v1.0.0.exe"
   ```

### Step 7: Create Distribution Package

1. **Create checksums:**
   ```bash
   certutil -hashfile "Thalamus-Setup-v1.0.0.exe" SHA256 > checksums.txt
   ```

2. **Create release notes:**
   - Document new features, bug fixes, and known issues
   - Save as `RELEASE_NOTES.md`

3. **Package for distribution:**
   ```bash
   7z a Thalamus-v1.0.0-Release.7z Thalamus-Setup-v1.0.0.exe checksums.txt RELEASE_NOTES.md
   ```

## Automated Build Script

Create `build-installer.ps1` for automated builds:

```powershell
# Build Thalamus Installer
param(
    [string]$Version = "1.0.0",
    [bool]$IncludeQemu = $false,
    [bool]$SignCode = $false,
    [string]$CertPath = ""
)

Write-Host "Building Thalamus AI v$Version..."

# Step 1: Build C# project
Write-Host "Building C# application..."
dotnet publish -c Release -r win-x64 --self-contained -p:PublishSingleFile=true

# Step 2: Prepare installer files
Write-Host "Preparing installer files..."
$installerDir = "installer-build"
if (Test-Path $installerDir) { Remove-Item $installerDir -Recurse }
New-Item -ItemType Directory $installerDir | Out-Null

Copy-Item "bin\Release\net8.0-windows\win-x64\publish\Thalamus.exe" $installerDir
Copy-Item "..\bridge\thalamus-vm-bridge.exe" $installerDir
Copy-Item "..\tools\tvnviewer.exe" $installerDir
Copy-Item "icon.ico" $installerDir

# Step 3: Build installer
Write-Host "Building installer with Inno Setup..."
& "C:\Program Files (x86)\Inno Setup 6\ISCC.exe" installer.iss

# Step 4: Code signing (optional)
if ($SignCode -and $CertPath) {
    Write-Host "Signing executable..."
    & signtool sign /f $CertPath /p "password" /t "http://timestamp.server.com" "dist\Thalamus-Setup-v$Version.exe"
}

Write-Host "Build complete! Output: dist\Thalamus-Setup-v$Version.exe"
```

Run the script:
```bash
.\build-installer.ps1 -Version "1.0.0" -IncludeQemu $true
```

## Testing the Installer

1. **Test on Clean System:**
   - Use a virtual machine with fresh Windows 10/11 installation
   - Ensure no Thalamus components are pre-installed

2. **Verify Installation:**
   - Check that all files are installed to correct locations
   - Verify registry entries are created
   - Confirm shortcuts are created
   - Test URI scheme (`thalamus://boot?os=windows-11`)

3. **Test Functionality:**
   - Launch application
   - Verify bridge starts automatically
   - Test VM boot functionality
   - Verify VNC viewer launches

4. **Test Uninstallation:**
   - Uninstall via "Add/Remove Programs"
   - Verify all files are removed
   - Check registry entries are cleaned up

## Troubleshooting

### Build Errors

**Error: "dotnet: command not found"**
- Solution: Install .NET 8.0 SDK from https://dotnet.microsoft.com/download/dotnet/8.0

**Error: "Inno Setup not found"**
- Solution: Install Inno Setup 6.x from https://jrsoftware.org/isdl.php

### Installer Issues

**Error: "WebView2 not installed"**
- Solution: Add WebView2 runtime download to installer
- Or: Pre-install on target system

**Error: "QEMU not found"**
- Solution: Include QEMU binaries in installer
- Or: Provide download link in application

## Distribution

### GitHub Releases

1. Create a new release on GitHub
2. Upload `Thalamus-Setup-v1.0.0.exe`
3. Include checksums and release notes
4. Tag as `v1.0.0`

### Update Server

1. Upload installer to update server
2. Update version endpoint: `https://thalamus.dev/api/latest-version`
3. Response format:
   ```json
   {
     "version": "1.0.0",
     "downloadUrl": "https://releases.thalamus.dev/Thalamus-Setup-v1.0.0.exe",
     "changelog": "..."
   }
   ```

## Next Steps

- Implement auto-update system
- Create user documentation
- Set up crash reporting
- Monitor installer downloads and feedback
