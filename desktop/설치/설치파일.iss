; 독립 회의록 프로그램을 현재 Windows 사용자에게 설치하고 회의 자료를 보존한다.
#ifndef StageDir
  #error StageDir must be set
#endif
[Setup]
AppId={{EE341AE8-A356-4EF2-BA85-19860D442786}
AppName=VoiceNote
AppVersion=1.3.0
AppVerName=VoiceNote 1.3.0
DefaultDirName={localappdata}\Programs\MeetingJournal
DefaultGroupName=VoiceNote
UsePreviousGroup=no
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0.19041
OutputDir={#OutputDir}
OutputBaseFilename=2026-10-23-VoiceNote-1.3.0-설치
SetupIconFile={#StageDir}\회의록.ico
UninstallDisplayIcon={app}\프로젝트 회의록.exe
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
AppMutex=Local\MeetingJournalDesktop
CloseApplications=no
RestartApplications=no
UninstallDisplayName=VoiceNote

[Languages]
Name: korean; MessagesFile: compiler:Languages\Korean.isl

[Tasks]
Name: desktopicon; Description: 바탕화면에 실행 아이콘 만들기; GroupDescription: 바로가기

[Files]
Source: {#StageDir}\*; DestDir: {app}; Flags: ignoreversion recursesubdirs createallsubdirs
Source: {#DependencyDir}\MicrosoftEdgeWebview2Setup.exe; Flags: dontcopy

[InstallDelete]
; 이전 버전이 만든 제품 바로가기만 이름으로 지우고, 사용자가 따로 만든 바로가기와 회의 자료는 건드리지 않는다.
Type: files; Name: "{group}\프로젝트 회의록.lnk"
Type: files; Name: "{autodesktop}\프로젝트 회의록.lnk"
Type: files; Name: "{autodesktop}\VoiceNote 회의 기록.lnk"
Type: files; Name: "{userprograms}\VoiceNote 회의 기록\VoiceNote 회의 기록.lnk"
Type: files; Name: "{userprograms}\VoiceNote 회의 기록\프로젝트 회의록.lnk"
Type: dirifempty; Name: "{userprograms}\VoiceNote 회의 기록"
Type: files; Name: "{userprograms}\프로젝트 회의록\프로젝트 회의록.lnk"
Type: files; Name: "{userprograms}\프로젝트 회의록\VoiceNote 회의 기록.lnk"
Type: dirifempty; Name: "{userprograms}\프로젝트 회의록"

[Icons]
Name: {group}\VoiceNote; Filename: {app}\프로젝트 회의록.exe; WorkingDir: {app}
Name: {autodesktop}\VoiceNote; Filename: {app}\프로젝트 회의록.exe; WorkingDir: {app}; Tasks: desktopicon

[Run]
Filename: {app}\프로젝트 회의록.exe; Description: VoiceNote 실행; Flags: nowait postinstall skipifsilent

[Code]
function HasWebView2: Boolean;
var Version: String;
begin
  Result := (RegQueryStringValue(HKLM32, 'SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}', 'pv', Version) and (Version <> '') and (Version <> '0.0.0.0')) or
    (RegQueryStringValue(HKCU, 'SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}', 'pv', Version) and (Version <> '') and (Version <> '0.0.0.0'));
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
var ExitCode: Integer;
begin
  Result := '';
  if not HasWebView2 then
  begin
    ExtractTemporaryFile('MicrosoftEdgeWebview2Setup.exe');
    if not Exec(ExpandConstant('{tmp}\MicrosoftEdgeWebview2Setup.exe'), '/silent /install', '', SW_HIDE, ewWaitUntilTerminated, ExitCode) or not HasWebView2 then
      Result := 'WebView2 화면 엔진을 설치하지 못했습니다. 인터넷 연결 또는 회사 PC의 설치 제한을 확인한 뒤 다시 설치해 주세요.';
  end;
end;
