; Thalamus AI - Inno Setup Script
; Produces a standalone .exe installer (no WiX/MSI dependency)

#define MyAppName "Thalamus AI"
#define MyAppVersion "1.0.0"
#define MyAppPublisher "Thalamus AI"
#define MyAppURL "https://thalamus.ai"
#define MyAppExeName "Thalamus.exe"

[Setup]
AppId={{A1B2C3D4-E5F6-7890-ABCD-EF1234567890}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
AppPublisherURL={#MyAppURL}
AppSupportURL={#MyAppURL}/support
AppUpdatesURL={#MyAppURL}/download
DefaultDirName={autopf}\{#MyAppName}
DefaultGroupName={#MyAppName}
DisableProgramGroupPage=yes
LicenseFile=
PrivilegesRequired=admin
OutputDir=..\dist
OutputBaseFilename=Thalamus-Setup-v{#MyAppVersion}
SetupIconFile=..\ThalamusApp\resources\icons\app.ico
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
ArchitecturesInstallIn64BitMode=x64compatible

; This is the EXE installer the user asked for
DisableWelcomePage=no
DisableDirPage=yes
DisableFinishedPage=no

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "Create a &desktop shortcut"; GroupDescription: "Additional icons:"; Flags: checkedonce
Name: "autostartbridge"; Description: "&Auto-start VM bridge on login (recommended)"; GroupDescription: "VM bridge:"; Flags: uncheckedonce

[Files]
Source: "..\dist\Thalamus.exe"; DestDir: "{app}"; Flags: ignoreversion
; Source: "..\dist\qemu\*"; DestDir: "{app}\qemu"; Flags: ignoreversion recursesubdirs createallsubdirs; Note: add QEMU binaries here if bundling

[Icons]
Name: "{group}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"
Name: "{group}\Uninstall {#MyAppName}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; Tasks: desktopicon

[Registry]
; URI scheme: thalamus://
Root: HKCR; Subkey: "thalamus"; ValueType: string; ValueName: ""; ValueData: "URL:Thalamus AI Protocol"; Flags: uninsdeletekey
Root: HKCR; Subkey: "thalamus"; ValueType: string; ValueName: "URL Protocol"; ValueData: ""; Flags: uninsdeletekey
Root: HKCR; Subkey: "thalamus\shell\open\command"; ValueType: string; ValueName: ""; ValueData: """{app}\{#MyAppExeName}"" ""%1"""; Flags: uninsdeletekey

; App info
Root: HKLM; Subkey: "SOFTWARE\{#MyAppName}"; ValueType: string; ValueName: "InstallPath"; ValueData: "{app}"; Flags: uninsdeletekey
Root: HKLM; Subkey: "SOFTWARE\{#MyAppName}"; ValueType: string; ValueName: "Version"; ValueData: "{#MyAppVersion}"; Flags: uninsdeletekey
Root: HKLM; Subkey: "SOFTWARE\{#MyAppName}"; ValueType: string; ValueName: "DataPath"; ValueData: "{app}\data"; Flags: uninsdeletekey

[Run]
Filename: "{app}\{#MyAppExeName}"; Description: "Launch {#MyAppName}"; Flags: postinstall nowait skipifsilent shellexec

[UninstallRun]
