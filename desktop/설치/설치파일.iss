; 독립 회의록 프로그램을 현재 Windows 사용자에게 설치하고 회의 자료를 보존한다.
; 앱이 /update=1로 띄우면 앱이 닫힐 때까지 기다렸다가 조용히 설치하고, 실패하면 바꾼 파일을 되돌린 뒤 앱을 다시 켠다.
#ifndef StageDir
  #error StageDir must be set
#endif
#define AppMutexName "Local\MeetingJournalDesktop"
#define AppExeName "프로젝트 회의록.exe"
[Setup]
AppId={{EE341AE8-A356-4EF2-BA85-19860D442786}
AppName=VoiceNote
AppVersion=1.4.0
AppVerName=VoiceNote 1.4.0
DefaultDirName={localappdata}\Programs\MeetingJournal
DefaultGroupName=VoiceNote
UsePreviousGroup=no
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0.19041
OutputDir={#OutputDir}
OutputBaseFilename=2026-11-05-VoiceNote-1.4.0-설치
SetupIconFile={#StageDir}\회의록.ico
UninstallDisplayIcon={app}\프로젝트 회의록.exe
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
AppMutex={#AppMutexName}
CloseApplications=no
RestartApplications=no
UninstallDisplayName=VoiceNote

[Languages]
Name: korean; MessagesFile: compiler:Languages\Korean.isl

[Tasks]
Name: desktopicon; Description: 바탕화면에 실행 아이콘 만들기; GroupDescription: 바로가기

[Files]
Source: {#StageDir}\*; DestDir: {app}; Flags: ignoreversion recursesubdirs createallsubdirs; BeforeInstall: BackupBeforeReplace
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
const
  SYNCHRONIZE = $00100000;
  WAIT_TIMEOUT = $00000102;

var
  UpdateMode: Boolean;
  AppClosed: Boolean;
  BackupStarted: Boolean;
  Installed: Boolean;
  RestoreFailed: Boolean;
  AppFolder: String;
  BackupFolder: String;

function OpenProcess(DesiredAccess: DWORD; InheritHandle: Integer; ProcessId: DWORD): THandle;
  external 'OpenProcess@kernel32.dll stdcall';
function WaitForSingleObject(Handle: THandle; Milliseconds: DWORD): DWORD;
  external 'WaitForSingleObject@kernel32.dll stdcall';
function CloseHandle(Handle: THandle): Integer;
  external 'CloseHandle@kernel32.dll stdcall';

{ 앱이 넘긴 진행 상태 파일에 영문 한 단어를 적는다. 앱 서버가 이 글자로 설치 시작과 결과를 읽는다. }
procedure WriteStatus(const Value: String);
var
  Target: String;
begin
  Target := ExpandConstant('{param:status|}');
  if Target <> '' then
    if not SaveStringToFile(Target, Value, False) then
      Log('업데이트 상태 파일을 쓰지 못했습니다: ' + Target);
  Log('업데이트 상태: ' + Value);
end;

{ 프로세스가 끝날 때까지 정한 시간만큼 기다린다. 이미 끝났거나 열 수 없으면 끝난 것으로 본다. }
function WaitForProcess(Pid: Integer; Milliseconds: DWORD): Boolean;
var
  Handle: THandle;
begin
  Result := True;
  if Pid <= 0 then Exit;
  Handle := OpenProcess(SYNCHRONIZE, 0, Pid);
  if Handle = 0 then Exit;
  try
    Result := WaitForSingleObject(Handle, Milliseconds) <> WAIT_TIMEOUT;
  finally
    CloseHandle(Handle);
  end;
end;

{ /pids=창,서버 로 받은 앱 프로세스가 모두 끝날 때까지 기다린다. 앱 창이 뮤텍스를 놓은 뒤에도 파일을 잡고 있을 수 있어서다. }
function WaitForAppProcesses: Boolean;
var
  Rest, Item: String;
  Comma: Integer;
begin
  Result := True;
  Rest := ExpandConstant('{param:pids|}');
  while Rest <> '' do
  begin
    Comma := Pos(',', Rest);
    if Comma = 0 then
    begin
      Item := Rest;
      Rest := '';
    end
    else
    begin
      Item := Copy(Rest, 1, Comma - 1);
      Rest := Copy(Rest, Comma + 1, Length(Rest));
    end;
    if not WaitForProcess(StrToIntDef(Trim(Item), 0), 60000) then
    begin
      Log('앱 프로세스가 끝나지 않았습니다: ' + Item);
      Result := False;
      Exit;
    end;
  end;
end;

function InitializeSetup: Boolean;
var
  Count: Integer;
begin
  Result := True;
  UpdateMode := ExpandConstant('{param:update|0}') = '1';
  if not UpdateMode then Exit;
  { 이 함수는 Setup의 AppMutex 검사보다 먼저 돈다. 여기서 앱이 닫히기를 기다려야 조용한 설치가 "앱 실행 중"으로 멈추지 않는다. }
  WriteStatus('waiting');
  Count := 0;
  while CheckForMutexes('{#AppMutexName}') and (Count < 480) do
  begin
    Sleep(250);
    Count := Count + 1;
  end;
  if CheckForMutexes('{#AppMutexName}') or not WaitForAppProcesses then
  begin
    { 앱이 닫히지 않았으면 아무것도 바꾸지 않고 멈춘다. 앱이 살아 있으므로 다시 켜지 않는다. }
    WriteStatus('timeout');
    Result := False;
    Exit;
  end;
  AppClosed := True;
end;

{ 업데이트 모드에서 바꿀 파일마다 원래 파일을 <설치 폴더>.업데이트전 으로 복사한다. 설치가 중간에 실패하면 이 복사본으로 되돌린다. }
procedure BackupBeforeReplace;
var
  Target, Relative, Copied: String;
begin
  if not BackupStarted then Exit;
  Target := ExpandConstant(CurrentFilename);
  if not FileExists(Target) then Exit;
  if CompareText(Copy(Target, 1, Length(AppFolder) + 1), AddBackslash(AppFolder)) <> 0 then Exit;
  Relative := Copy(Target, Length(AppFolder) + 2, Length(Target));
  Copied := AddBackslash(BackupFolder) + Relative;
  ForceDirectories(ExtractFileDir(Copied));
  if not FileCopy(Target, Copied, False) then
    RaiseException('업데이트 전 파일을 보관하지 못해 설치를 멈춥니다: ' + Target);
end;

{ 보관한 파일을 설치 폴더로 되돌린다. 보관하지 않은 다른 파일은 건드리지 않는다. }
procedure RestoreFolder(const Source, Target: String);
var
  Found: TFindRec;
begin
  if not FindFirst(AddBackslash(Source) + '*', Found) then Exit;
  try
    repeat
      if (Found.Name <> '.') and (Found.Name <> '..') then
      begin
        if Found.Attributes and FILE_ATTRIBUTE_DIRECTORY <> 0 then
        begin
          ForceDirectories(AddBackslash(Target) + Found.Name);
          RestoreFolder(AddBackslash(Source) + Found.Name, AddBackslash(Target) + Found.Name);
        end
        else if not FileCopy(AddBackslash(Source) + Found.Name, AddBackslash(Target) + Found.Name, False) then
        begin
          Log('되돌리지 못한 파일: ' + AddBackslash(Target) + Found.Name);
          RestoreFailed := True;
        end;
      end;
    until not FindNext(Found);
  finally
    FindClose(Found);
  end;
end;

procedure CurStepChanged(CurStep: TSetupStep);
begin
  if not UpdateMode then Exit;
  if CurStep = ssInstall then
  begin
    AppFolder := RemoveBackslashUnlessRoot(ExpandConstant('{app}'));
    BackupFolder := AppFolder + '.업데이트전';
    if DirExists(BackupFolder) then DelTree(BackupFolder, True, True, True);
    if not ForceDirectories(BackupFolder) then
      RaiseException('업데이트 전 파일을 보관할 폴더를 만들지 못했습니다: ' + BackupFolder);
    BackupStarted := True;
    WriteStatus('installing');
  end
  else if CurStep = ssPostInstall then
  begin
    Installed := True;
    WriteStatus('installed');
    DelTree(BackupFolder, True, True, True);
  end;
end;

procedure DeinitializeSetup;
var
  Folder, AppExe: String;
  ResultCode: Integer;
begin
  if not UpdateMode then Exit;
  if BackupStarted and not Installed then
  begin
    { 바꾸던 중에 실패했거나 취소됐다. 보관한 원래 파일을 되돌린 뒤 옛 앱을 켠다. }
    RestoreFailed := False;
    RestoreFolder(BackupFolder, AppFolder);
    if RestoreFailed then
      WriteStatus('failed')
    else
    begin
      WriteStatus('restored');
      DelTree(BackupFolder, True, True, True);
    end;
  end
  else if AppClosed and not Installed then
    { 파일을 바꾸기 전에 멈췄다. 옛 앱은 그대로다. }
    WriteStatus('restored');
  if not AppClosed then Exit;
  { 기다리는 사이 사람이 앱을 직접 다시 켰으면 두 번 켜지 않는다. }
  if CheckForMutexes('{#AppMutexName}') then Exit;
  { 다시 켜기는 앱이 넘긴 설치 폴더(/DIR)의 실행 파일만 쓴다. }
  Folder := ExpandConstant('{param:DIR|}');
  if Folder = '' then Exit;
  AppExe := AddBackslash(Folder) + '{#AppExeName}';
  if not FileExists(AppExe) then
  begin
    Log('다시 켤 실행 파일이 없습니다: ' + AppExe);
    Exit;
  end;
  if not Exec(AppExe, '', Folder, SW_SHOWNORMAL, ewNoWait, ResultCode) then
    Log('앱을 다시 켜지 못했습니다: ' + SysErrorMessage(ResultCode));
end;

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
