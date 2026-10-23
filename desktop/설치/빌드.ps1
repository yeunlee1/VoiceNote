# 실행 프로그램과 Windows 설치 파일을 빌드하고 배포 파일의 해시를 기록한다.
# 빌드 결과는 산출물 아래 내부용이다. 사용자 전달은 루트 배포준비.ps1로 배포\최신 폴더와 배포\VoiceNote-배포.zip만 갱신한다.
param(
  [string]$BuildRoot = (Join-Path (Split-Path (Split-Path $PSScriptRoot -Parent) -Parent) ('산출물\데스크톱\' + (Get-Date -Format 'yyyy-MM-dd-HHmmss'))),
  [string]$NodePath = 'C:\DEV\10_백업\2026-09-30-회의록도구-프로젝트프리셋\회의록도구-연속녹음\node.exe',
  [string]$DependencyRoot = 'C:\DEV\10_백업\2026-09-30-회의록도구-설치본제작\의존성',
  [string]$IconFile = (Join-Path $PSScriptRoot 'VoiceNote.ico'),
  [string]$DefaultKeyFile = ''
)
$ErrorActionPreference = 'Stop'
$sourceRoot = Split-Path $PSScriptRoot -Parent
$stage = Join-Path $BuildRoot '배포'
if (Test-Path -LiteralPath $stage) { throw "배포 폴더가 이미 있습니다. 기존 산출물을 덮어쓰지 않도록 다른 BuildRoot를 지정하세요: $stage" }
$dependency = Join-Path $DependencyRoot 'WebView2'
New-Item -ItemType Directory -Path (Join-Path $stage '앱'),(Join-Path $BuildRoot '설치파일') -Force | Out-Null
Get-ChildItem -LiteralPath (Join-Path $sourceRoot '앱') -Force | Where-Object { $_.Name -notlike '*.test.cjs' -and $_.Name -ne '기본키.json' } | Copy-Item -Destination (Join-Path $stage '앱') -Recurse -Force
$oldTests = @(Get-ChildItem -LiteralPath (Join-Path $stage '앱') -File -Filter '*.test.cjs')
foreach ($test in $oldTests) { Remove-Item -LiteralPath $test.FullName }
if ($DefaultKeyFile) {
  # 공용 기본 키는 명시한 파일에서만 읽어 설치 패키지의 앱 폴더에 넣고, 값을 화면·로그·구성 목록에 남기지 않는다.
  $key = $null
  try { $key = [string](([IO.File]::ReadAllText($DefaultKeyFile)) | ConvertFrom-Json).apiKey } catch { throw "기본 키 파일을 읽지 못했습니다: $DefaultKeyFile" }
  if ([string]::IsNullOrWhiteSpace($key) -or $key.Length -gt 500) { throw "기본 키 파일 형식을 확인하세요: $DefaultKeyFile" }
  [IO.File]::WriteAllText((Join-Path $stage '앱\기본키.json'), (@{ apiKey = $key.Trim() } | ConvertTo-Json -Compress), (New-Object Text.UTF8Encoding($false)))
  $key = $null
}
Copy-Item -LiteralPath $NodePath -Destination $stage
Copy-Item -LiteralPath (Join-Path $dependency 'lib\net462\Microsoft.Web.WebView2.Core.dll'),(Join-Path $dependency 'lib\net462\Microsoft.Web.WebView2.WinForms.dll'),(Join-Path $dependency 'runtimes\win-x64\native\WebView2Loader.dll') -Destination $stage
Copy-Item -LiteralPath (Join-Path $dependency 'LICENSE.txt') -Destination (Join-Path $stage 'WebView2라이선스.txt')
Copy-Item -LiteralPath (Join-Path $dependency 'NOTICE.txt') -Destination (Join-Path $stage 'WebView2고지.txt')
Copy-Item -LiteralPath (Join-Path $sourceRoot '프로그램.config') -Destination (Join-Path $stage '프로젝트 회의록.exe.config')
# 브랜드 원본 아이콘(브랜드\VoiceNote.ico의 사본)을 실행 파일·설치 파일·창 아이콘에 같이 쓴다.
Copy-Item -LiteralPath $IconFile -Destination (Join-Path $stage '회의록.ico')
& 'C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe' /nologo /target:winexe /platform:x64 /optimize+ /utf8output ('/out:' + (Join-Path $stage '프로젝트 회의록.exe')) ('/reference:' + (Join-Path $stage 'Microsoft.Web.WebView2.Core.dll')) ('/reference:' + (Join-Path $stage 'Microsoft.Web.WebView2.WinForms.dll')) /reference:System.dll /reference:System.Core.dll /reference:System.Drawing.dll /reference:System.Windows.Forms.dll /reference:System.Web.Extensions.dll ('/win32manifest:' + (Join-Path $sourceRoot '프로그램.manifest')) ('/win32icon:' + (Join-Path $stage '회의록.ico')) (Join-Path $sourceRoot '프로그램.cs')
if ($LASTEXITCODE -ne 0) { throw '실행 프로그램 컴파일 실패' }
$manifest = @(Get-ChildItem -LiteralPath $stage -File -Recurse | Where-Object { $_.Name -ne '구성.json' -and $_.Name -ne '기본키.json' } | Sort-Object FullName | ForEach-Object { [pscustomobject]@{name=$_.FullName.Substring($stage.Length+1);sha256=(Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant()} })
[IO.File]::WriteAllText((Join-Path $stage '구성.json'), ($manifest | ConvertTo-Json), (New-Object Text.UTF8Encoding($false)))
& 'C:\Program Files (x86)\Inno Setup 6\ISCC.exe' /Qp ('/DStageDir=' + $stage) ('/DDependencyDir=' + $DependencyRoot) ('/DOutputDir=' + (Join-Path $BuildRoot '설치파일')) (Join-Path $PSScriptRoot '설치파일.iss')
if ($LASTEXITCODE -ne 0) { throw '설치 파일 빌드 실패' }
Get-ChildItem -LiteralPath (Join-Path $BuildRoot '설치파일') -File | Select-Object FullName,Length
