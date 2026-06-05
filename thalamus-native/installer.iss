; Thalamus AI Installer
; Built with Inno Setup 6.x
; Download Inno Setup: https://jrsoftware.org/isinfo.php

#define MyAppName "Thalamus AI"
#define MyAppVersion "1.0.0"
#define MyAppPublisher "Aphantic Corporations"
#define MyAppURL "https://thalamus.aphantic.skinticals.com"
#define MyAppExeName "Thalamus.exe"

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
LicenseFile=
OutputDir=dist
OutputBaseFilename=Thalamus-Setup-v{#MyAppVersion}
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
VersionInfoDescription={#MyAppName} Installer
VersionInfoProductName={#MyAppName}
VersionInfoProductVersion={#MyAppVersion}
MinVersion=10.0.17763
; Windows 10 1809+ required for WebView2

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked
Name: "startupbridge"; Description: "Start VM Bridge automatically on login"; GroupDescription: "Startup options:"; Flags: checked

[Files]
; Main app executable
Source: "ThalamusApp\bin\Release\net8.0-windows\win-x64\publish\Thalamus.exe"; DestDir: "{app}"; Flags: ignoreversion

; VM Bridge
Source: "bridge\thalamus-vm-bridge.exe"; DestDir: "{app}"; Flags: ignoreversion

; VNC Viewer
Source: "tools\tvnviewer.exe"; DestDir: "{app}"; Flags: ignoreversion skipifsourcedoesntexist

; WebView2 Runtime (optional - installer will download if not present)
; Source: "redist\MicrosoftEdgeWebview2Setup.exe"; DestDir: "{tmp}"; Flags: deleteafterinstall

[Icons]
Name: "{group}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"
Name: "{group}\{cm:UninstallProgram,{#MyAppName}}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; Tasks: desktopicon

[Run]
; Install WebView2 Runtime if not present
Filename: "{tmp}\MicrosoftEdgeWebview2Setup.exe"; Parameters: "/silent /install"; \
  StatusMsg: "Installing WebView2 Runtime..."; \
  Check: WebView2NotInstalled; Flags: waituntilterminated

; Start the app after install
Filename: "{app}\{#MyAppExeName}"; Description: "{cm:LaunchProgram,{#StringChange(MyAppName, '&', '&&')}}"; \
  Flags: nowait postinstall skipifsilent

[Registry]
; Register thalamus:// URI scheme
Root: HKCU; Subkey: "Software\Classes\thalamus"; ValueType: string; ValueName: ""; ValueData: "URL:Thalamus Protocol"; Flags: uninsdeletekey
Root: HKCU; Subkey: "Software\Classes\thalamus"; ValueType: string; ValueName: "URL Protocol"; ValueData: ""
Root: HKCU; Subkey: "Software\Classes\thalamus\shell\open\command"; ValueType: string; ValueName: ""; ValueData: """{app}\{#MyAppExeName}"" ""%1"""

; Add bridge to startup (if task selected)
Root: HKCU; Subkey: "Software\Microsoft\Windows\CurrentVersion\Run"; ValueType: string; ValueName: "ThalamusBridge"; \
  ValueData: """{app}\thalamus-vm-bridge.exe"""; Tasks: startupbridge; Flags: uninsdeletevalue

[UninstallRun]
Filename: "taskkill"; Parameters: "/f /im Thalamus.exe /t"; Flags: runhidden waituntilterminated
Filename: "taskkill"; Parameters: "/f /im thalamus-vm-bridge.exe /t"; Flags: runhidden waituntilterminated

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

procedure InitializeWizard;
begin
  WizardForm.WelcomeLabel2.Caption := 
    'This will install Thalamus AI on your computer.' + #13#10 + #13#10 +
    'Thalamus AI is the world''s first L4.5 agent — capable of autonomous research, ' +
    'coding, studying, and running full operating systems in a VM sandbox.' + #13#10 + #13#10 +
    'Click Next to continue.';
end;
