; Thalamus AI Installer Script
; Built with Inno Setup 6.x — https://jrsoftware.org/isinfo.php
; Run: ISCC.exe installer.iss

#define MyAppName      "Thalamus AI"
#define MyAppVersion   "1.0.0"
#define MyAppPublisher "Aphantic Corporations"
#define MyAppURL       "https://thalamus.aphantic.skinticals.com"
#define MyAppExeName   "Thalamus.exe"
#define SetupExe       "ThalamusSetup.exe"

[Setup]
AppId={{A1B2C3D4-E5F6-7890-ABCD-EF1234567890}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
AppPublisherURL={#MyAppURL}
AppSupportURL={#MyAppURL}
AppUpdatesURL={#MyAppURL}

; Default install to LocalAppData so no UAC is needed for the app itself
; (the native installer already requests admin via manifest)
DefaultDirName={localappdata}\Thalamus
DefaultGroupName={#MyAppName}
AllowNoIcons=yes
DisableDirPage=yes

OutputDir=dist
OutputBaseFilename=Thalamus-Setup-v{#MyAppVersion}

; The setup exe is the native C# installer — Inno Setup simply wraps it
; so users get a double-clickable .exe from GitHub Releases.
SetupIconFile=ThalamusApp\Assets\icon.ico
Compression=lzma2/ultra64
SolidCompression=yes
WizardStyle=modern
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=dialog
UninstallDisplayIcon={app}\{#MyAppExeName}
UninstallDisplayName={#MyAppName}
VersionInfoVersion={#MyAppVersion}
VersionInfoCompany={#MyAppPublisher}
VersionInfoDescription={#MyAppName} Setup
VersionInfoProductName={#MyAppName}
VersionInfoProductVersion={#MyAppVersion}
MinVersion=10.0.17763

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Files]
; Native C# desktop app (compiled via dotnet publish)
Source: "ThalamusApp\bin\Release\net8.0-windows\win-x64\publish\Thalamus.exe"; \
  DestDir: "{app}"; Flags: ignoreversion

; VM Bridge (pre-built from bridge-v3.cjs or downloaded from GitHub Releases)
; Place thalamus-vm-bridge.exe in thalamus-native\bridge\ before building
Source: "bridge\thalamus-vm-bridge.exe"; DestDir: "{app}"; \
  Flags: ignoreversion skipifsourcedoesntexist

; TightVNC portable viewer
Source: "tools\tvnviewer.exe"; DestDir: "{app}"; \
  Flags: ignoreversion skipifsourcedoesntexist

; aria2 download manager
Source: "tools\aria2c.exe"; DestDir: "{app}"; \
  Flags: ignoreversion skipifsourcedoesntexist

; QEMU binaries (optional bundle — only if qemu\ dir exists at build time)
Source: "qemu\*"; DestDir: "{app}\qemu"; \
  Flags: ignoreversion recursesubdirs skipifsourcedoesntexist

; App icon for shortcuts
Source: "ThalamusApp\Assets\icon.ico"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{group}\{#MyAppName}";                   Filename: "{app}\{#MyAppExeName}"
Name: "{group}\{cm:UninstallProgram,{#MyAppName}}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\{#MyAppName}";              Filename: "{app}\{#MyAppExeName}"; \
  Tasks: desktopicon

[Tasks]
Name: "desktopicon";   Description: "{cm:CreateDesktopIcon}"; \
  GroupDescription: "{cm:AdditionalIcons}"; Flags: checked
Name: "startupbridge"; Description: "Start VM Bridge automatically on login"; \
  GroupDescription: "Startup options:";    Flags: checked

[Registry]
; thalamus:// URI scheme
Root: HKCU; Subkey: "Software\Classes\thalamus"; \
  ValueType: string; ValueName: ""; ValueData: "URL:Thalamus Protocol"; Flags: uninsdeletekey
Root: HKCU; Subkey: "Software\Classes\thalamus"; \
  ValueType: string; ValueName: "URL Protocol"; ValueData: ""
Root: HKCU; Subkey: "Software\Classes\thalamus\shell\open\command"; \
  ValueType: string; ValueName: ""; \
  ValueData: """{app}\{#MyAppExeName}"" ""%1"""

; Bridge startup entry
Root: HKCU; \
  Subkey: "Software\Microsoft\Windows\CurrentVersion\Run"; \
  ValueType: string; ValueName: "ThalamusBridge"; \
  ValueData: """{app}\thalamus-vm-bridge.exe"""; \
  Tasks: startupbridge; Flags: uninsdeletevalue

[Run]
; Check and install WebView2 Runtime if missing
Filename: "{tmp}\MicrosoftEdgeWebview2Setup.exe"; Parameters: "/silent /install"; \
  StatusMsg: "Installing WebView2 Runtime…"; \
  Check: WebView2NotInstalled; Flags: waituntilterminated

; Start the bridge immediately after install
Filename: "{app}\thalamus-vm-bridge.exe"; \
  StatusMsg: "Starting VM Bridge…"; \
  Flags: nowait runhidden

; Launch app (optional — user can uncheck)
Filename: "{app}\{#MyAppExeName}"; \
  Description: "{cm:LaunchProgram,{#StringChange(MyAppName, '&', '&&')}}"; \
  Flags: nowait postinstall skipifsilent

[UninstallRun]
Filename: "taskkill"; Parameters: "/f /im Thalamus.exe /t";           Flags: runhidden waituntilterminated
Filename: "taskkill"; Parameters: "/f /im thalamus-vm-bridge.exe /t"; Flags: runhidden waituntilterminated

[Code]
{ ──────────────────── WebView2 check ──────────────────── }
function WebView2NotInstalled: Boolean;
var
  Version: String;
begin
  Result :=
    not RegQueryStringValue(HKLM,
      'SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}',
      'pv', Version)
    and
    not RegQueryStringValue(HKCU,
      'SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}',
      'pv', Version);
end;

{ ──────────────────── Welcome page ──────────────────── }
procedure InitializeWizard;
begin
  WizardForm.WelcomeLabel2.Caption :=
    'This will install Thalamus AI — the world''s first L4.5 Agent Platform.' + #13#10 +
    #13#10 +
    'Thalamus combines AI chat, deep research, autonomous coding, and full ' +
    'OS virtualisation (QEMU + VNC) in a single native Windows app.' + #13#10 +
    #13#10 +
    'Click Next to continue, or Cancel to exit setup.';
end;
