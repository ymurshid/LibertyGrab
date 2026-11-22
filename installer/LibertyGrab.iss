; Inno Setup Script for LibertyGrab (No Admin Privileges Required)
#define MyAppName "LibertyGrab"
#define MyAppVersion "1.1.1"
#define MyAppPublisher "Liberty Dev"
#define MyAppURL "https://github.com/ymurshid/LibertyGrab"
#define MyAppExeName "LibertyGrab-Engine.exe"

[Setup]
AppId={{7B6F5C4E-8F29-4A84-9D31-LIBERTYGRAB01}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppVerName={#MyAppName} {#MyAppVersion}
AppPublisher={#MyAppPublisher}
AppPublisherURL={#MyAppURL}
AppSupportURL={#MyAppURL}
VersionInfoVersion=1.1.1.0
VersionInfoCompany={#MyAppPublisher}
VersionInfoDescription={#MyAppName} Windows Setup Installer
VersionInfoProductName={#MyAppName}
DefaultDirName={localappdata}\{#MyAppName}
DefaultGroupName={#MyAppName}
PrivilegesRequired=lowest
OutputDir=..\dist
OutputBaseFilename=LibertyGrab-Setup
SetupIconFile=..\extension\icons\libertygrab.ico
UninstallDisplayIcon={app}\{#MyAppExeName}
Compression=lzma2/normal
SolidCompression=no
WizardStyle=modern
DisableWelcomePage=no
DisableProgramGroupPage=yes

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "autostart"; Description: "Start LibertyGrab Engine automatically when Windows starts (Recommended)"; GroupDescription: "Startup Options:"

[Files]
Source: "..\dist\engine\LibertyGrab-Engine\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "..\extension\*"; DestDir: "{app}\extension"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "..\README-AR.md"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\README.md"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{group}\Start LibertyGrab Engine"; Filename: "{app}\{#MyAppExeName}"
Name: "{group}\Stop LibertyGrab Engine"; Filename: "{app}\{#MyAppExeName}"; Parameters: "--shutdown"
Name: "{group}\Open Extension Folder (Chrome-Edge)"; Filename: "{win}\explorer.exe"; Parameters: """{app}\extension"""
Name: "{group}\Uninstall LibertyGrab"; Filename: "{uninstallexe}"

[Registry]
Root: HKCU; Subkey: "Software\Microsoft\Windows\CurrentVersion\Run"; ValueType: string; ValueName: "LibertyGrabEngine"; ValueData: """{app}\{#MyAppExeName}"""; Tasks: autostart; Flags: uninsdeletevalue

[Run]
Filename: "{app}\{#MyAppExeName}"; Description: "Launch LibertyGrab Engine in background now"; Flags: nowait postinstall skipifsilent
Filename: "{win}\explorer.exe"; Parameters: """{app}\extension"""; Description: "Open extension folder (to load in Chrome / Edge / Brave)"; Flags: nowait postinstall skipifsilent

[UninstallRun]
Filename: "{app}\{#MyAppExeName}"; Parameters: "--shutdown"; Flags: runhidden; RunOnceId: "StopLibertyGrabEngine"

[Code]
function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  ResultCode: Integer;
begin
  if FileExists(ExpandConstant('{app}\{#MyAppExeName}')) then
  begin
    Exec(ExpandConstant('{app}\{#MyAppExeName}'), '--shutdown', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
    Sleep(800);
  end;
  Result := '';
end;
