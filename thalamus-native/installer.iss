; ============================================================================
;  Thalamus AI — Native Installer (Inno Setup 6.x)
;  Installs the NATIVE C#/.NET 8 (WPF + WebView2) Thalamus app. NO Electron,
;  NO Neutralino, NO bundled browser/Node runtime.
;
;  Everything required is bundled / provisioned by this installer:
;    * Thalamus.exe         — native C#/.NET 8 self-contained single-file app
;    * thalamus-vm-bridge   — the QEMU bridge (local WebSocket control server)
;    * QEMU                 — the VM engine (silent-installed from bundled setup)
;    * tvnviewer.exe        — VNC viewer for the VM display
;    * aria2c.exe           — download manager for large OS ISOs
;    * WebView2 Runtime     — native app UI dependency (installed if missing)
;
;  Download Inno Setup: https://jrsoftware.org/isinfo.php
; ============================================================================

#define MyAppName "Thalamus AI"
#define MyAppVersion "1.0.0"
#define MyAppPublisher "Aphantic Corporations"
#define MyAppURL "https://thalamus.aphantic.skinticals.com"
#define MyAppExeName "Thalamus.exe"
#define MyBridgeExeName "thalamus-vm-bridge.exe"

[Setup]
AppId={{A1B2C3D4-E5F6-7890-ABCD-EF1234567890}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
AppPublisherURL={#MyAppURL}
AppSupportURL={#MyAppURL}
AppUpdatesURL={#MyAppURL}
DefaultDirName={autopf}\{#MyAppName}
DefaultGroupName={#MyAppName}
AllowNoIcons=yes
DisableDirPage=no
DisableProgramGroupPage=yes
OutputDir=dist
OutputBaseFilename=Thalamus-Setup-Native-v{#MyAppVersion}
SetupIconFile=ThalamusApp\Assets\icon.ico
Compression=lzma2/ultra64
SolidCompression=yes
WizardStyle=modern
PrivilegesRequired=admin
PrivilegesRequiredOverridesAllowed=dialog
UninstallDisplayIcon={app}\{#MyAppExeName}
UninstallDisplayName={#MyAppName}
VersionInfoVersion={#MyAppVersion}
VersionInfoCompany={#MyAppPublisher}
VersionInfoDescription={#MyAppName} Native Installer
VersionInfoProductName={#MyAppName}
VersionInfoProductVersion={#MyAppVersion}
MinVersion=10.0.17763
; Windows 10 1809+ required for WebView2

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked
Name: "startupbridge"; Description: "Start the VM Bridge automatically on login"; GroupDescription: "Startup options:"; Flags: checked

[Files]
; ── Native app (NOT Electron) ──────────────────────────────────────────────
; Build first with:  dotnet publish -c Release -r win-x64 (see build.ps1 / build.sh)
Source: "ThalamusApp\bin\Release\net8.0-windows\win-x64\publish\Thalamus.exe"; DestDir: "{app}"; Flags: ignoreversion

; ── VM Bridge (the QEMU bridge) ────────────────────────────────────────────
Source: "bridge\thalamus-vm-bridge.exe"; DestDir: "{app}"; Flags: ignoreversion

; ── VNC Viewer ─────────────────────────────────────────────────────────────
Source: "tools\tvnviewer.exe"; DestDir: "{app}"; Flags: ignoreversion skipifsourcedoesntexist

; ── aria2 download manager (for large OS ISOs) ─────────────────────────────
Source: "tools\aria2c.exe"; DestDir: "{app}"; Flags: ignoreversion skipifsourcedoesntexist

; ── QEMU silent installer (bundled, runs from temp) ────────────────────────
Source: "redist\qemu-setup.exe"; DestDir: "{tmp}"; Flags: deleteafterinstall skipifsourcedoesntexist

; ── WebView2 Runtime bootstrapper (bundled, runs from temp) ────────────────
Source: "redist\MicrosoftEdgeWebview2Setup.exe"; DestDir: "{tmp}"; Flags: deleteafterinstall skipifsourcedoesntexist

[Dirs]
Name: "{app}\isos"
Name: "{app}\disks"

[Icons]
Name: "{group}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"
Name: "{group}\{cm:UninstallProgram,{#MyAppName}}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; Tasks: desktopicon

[Run]
; 1) Install WebView2 Runtime if not present (native app dependency)
Filename: "{tmp}\MicrosoftEdgeWebview2Setup.exe"; Parameters: "/silent /install"; \
  StatusMsg: "Installing WebView2 Runtime (required by the native app)..."; \
  Check: WebView2NotInstalled; Flags: waituntilterminated skipifdoesntexist

; 2) Install QEMU silently if not already present
Filename: "{tmp}\qemu-setup.exe"; Parameters: "/S"; \
  StatusMsg: "Installing QEMU VM engine..."; \
  Check: QemuNotInstalled; Flags: waituntilterminated skipifdoesntexist

; 3) Start the VM bridge immediately (hidden)
Filename: "{app}\{#MyBridgeExeName}"; Description: "Start VM Bridge"; \
  Flags: nowait runhidden skipifsilent

; 4) Launch the native app after install
Filename: "{app}\{#MyAppExeName}"; Description: "{cm:LaunchProgram,{#StringChange(MyAppName, '&', '&&')}}"; \
  Flags: nowait postinstall skipifsilent

[Registry]
; Register thalamus:// URI scheme
Root: HKCU; Subkey: "Software\Classes\thalamus"; ValueType: string; ValueName: ""; ValueData: "URL:Thalamus Protocol"; Flags: uninsdeletekey
Root: HKCU; Subkey: "Software\Classes\thalamus"; ValueType: string; ValueName: "URL Protocol"; ValueData: ""
Root: HKCU; Subkey: "Software\Classes\thalamus\shell\open\command"; ValueType: string; ValueName: ""; ValueData: """{app}\{#MyAppExeName}"" ""%1"""

; Add bridge to startup (if task selected)
Root: HKCU; Subkey: "Software\Microsoft\Windows\CurrentVersion\Run"; ValueType: string; ValueName: "ThalamusBridge"; \
  ValueData: """{app}\{#MyBridgeExeName}"""; Tasks: startupbridge; Flags: uninsdeletevalue

[UninstallRun]
Filename: "taskkill"; Parameters: "/f /im {#MyAppExeName} /t"; Flags: runhidden waituntilterminated
Filename: "taskkill"; Parameters: "/f /im {#MyBridgeExeName} /t"; Flags: runhidden waituntilterminated

[Code]
function WebView2NotInstalled: Boolean;
var
  Version: String;
begin
  Result := not RegQueryStringValue(HKLM,
    'SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}',
    'pv', Version);
  if Result then
    Result := not RegQueryStringValue(HKCU,
      'SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}',
      'pv', Version);
end;

function QemuNotInstalled: Boolean;
begin
  Result := not (FileExists('C:\Program Files\qemu\qemu-system-x86_64.exe') or
                 FileExists('C:\Program Files (x86)\qemu\qemu-system-x86_64.exe'));
end;

procedure InitializeWizard;
begin
  WizardForm.WelcomeLabel2.Caption :=
    'This will install Thalamus AI on your computer.' + #13#10 + #13#10 +
    'This is the NATIVE build — a real C#/.NET 8 (WPF) application that uses the ' +
    'OS-native Edge WebView2 control. There is NO Electron, NO Neutralino, and NO ' +
    'bundled browser.' + #13#10 + #13#10 +
    'The installer also sets up the QEMU VM engine, the VM Bridge, a VNC viewer, ' +
    'and the aria2 download manager — everything you need to research, code, study, ' +
    'and run full operating systems in a VM sandbox.' + #13#10 + #13#10 +
    'Click Next to continue.';
end;
