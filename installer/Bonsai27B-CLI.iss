; Build: ISCC.exe installer\Bonsai27B-CLI.iss  (output: dist\)
; Models (3.8-7.7GB) are not bundled; 00-install.bat downloads and verifies them after setup.
#define AppName "Bonsai27B-CLI"
#define AppVersion "1.0.0"

[Setup]
AppId={{5B7C2E31-8F4A-4D2B-9C61-B27C11A0E427}
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisher=ShaF-u
DefaultDirName={localappdata}\Programs\{#AppName}
DefaultGroupName={#AppName}
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
OutputDir=..\dist
OutputBaseFilename={#AppName}-Setup-{#AppVersion}
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
UninstallDisplayName={#AppName}

[Languages]
Name: "japanese"; MessagesFile: "compiler:Languages\Japanese.isl"

[Tasks]
Name: "desktopicon"; Description: "デスクトップにショートカットを作成"; GroupDescription: "追加のアイコン:"

[Files]
Source: "..\00-install.bat"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\01-chat.bat"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\02-chat-cpu.bat"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\03-test.bat"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\04-code.bat"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\scripts\*"; DestDir: "{app}\scripts"; Flags: ignoreversion
Source: "..\tests\test-prompt.txt"; DestDir: "{app}\tests"; Flags: ignoreversion
Source: "..\README.md"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\README-ja.md"; DestDir: "{app}"; Flags: ignoreversion isreadme
Source: "..\CODE-MODE-ja.md"; DestDir: "{app}"; Flags: ignoreversion

[Registry]
Root: HKCU; Subkey: "Software\{#AppName}"; ValueType: string; ValueName: "InstallDir"; ValueData: "{app}"; Flags: uninsdeletekey

[Icons]
Name: "{group}\Bonsai チャット"; Filename: "{app}\01-chat.bat"; WorkingDir: "{app}"
Name: "{group}\Bonsai チャット (CPU)"; Filename: "{app}\02-chat-cpu.bat"; WorkingDir: "{app}"
Name: "{group}\Bonsai コード作業モード"; Filename: "{app}\04-code.bat"; WorkingDir: "{app}"
Name: "{group}\モデルの追加・再インストール"; Filename: "{app}\00-install.bat"; WorkingDir: "{app}"
Name: "{group}\動作テスト"; Filename: "{app}\03-test.bat"; WorkingDir: "{app}"
Name: "{group}\インストール先フォルダ"; Filename: "{app}"
Name: "{group}\アンインストール"; Filename: "{uninstallexe}"
Name: "{autodesktop}\Bonsai チャット"; Filename: "{app}\01-chat.bat"; WorkingDir: "{app}"; Tasks: desktopicon

[Run]
Filename: "{app}\00-install.bat"; WorkingDir: "{app}"; Description: "モデルと実行環境をダウンロードする（必須・数GB）"; Flags: postinstall shellexec waituntilterminated

[UninstallDelete]
; Downloaded models/runtime live inside the install folder and are removed with it.
Type: filesandordirs; Name: "{app}\models"
Type: filesandordirs; Name: "{app}\runtime"
Type: filesandordirs; Name: "{app}\downloads"
Type: filesandordirs; Name: "{app}\logs"
