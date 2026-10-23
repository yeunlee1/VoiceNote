# 검증된 두 설치 파일과 심볼을 배포\최신(파일 4개)과 배포\VoiceNote-배포.zip으로 게시한다.
param(
  [Parameter(Mandatory)][string]$WindowsInstaller,
  [Parameter(Mandatory)][string]$AndroidInstaller,
  [Parameter(Mandatory)][ValidatePattern('^\d+\.\d+\.\d+$')][string]$Version,
  [ValidatePattern('^\d+\.\d+\.\d+$')][string]$AndroidVersion,
  [string]$SymbolFile = (Join-Path $PSScriptRoot '브랜드\VoiceNote.svg')
)
$ErrorActionPreference = 'Stop'
if (-not $AndroidVersion) { $AndroidVersion = $Version }
Add-Type -AssemblyName System.IO.Compression, System.IO.Compression.FileSystem

$deploy = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '배포'))
$latest = Join-Path $deploy '최신'
$zip = Join-Path $deploy 'VoiceNote-배포.zip'
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$utf8 = New-Object Text.UTF8Encoding($true)

function Assert-InDeploy([string]$Path) {
  # 옮기거나 지우는 경로는 정규화한 절대 경로가 배포 폴더 안일 때만 허용한다.
  $full = [IO.Path]::GetFullPath($Path)
  if (-not $full.StartsWith($deploy + '\', [StringComparison]::OrdinalIgnoreCase)) { throw "배포 폴더 밖 경로라 중단합니다: $full" }
  $full
}
function Get-Sha([string]$Path) { (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash }
function Get-InstallerName([string]$Source, [string]$Kind, [string]$Ver, [string]$Ext) {
  # 원본 수정 날짜와 버전으로 이름을 만들고, 최신·이전버전에 같은 날 먼저 낸 다른 해시의 같은 종류 설치파일 수만큼 순번을 붙인다.
  $time = (Get-Item -LiteralPath $Source).LastWriteTime
  $hash = Get-Sha $Source
  $dirs = @($latest)
  $history = Join-Path $deploy '이전버전'
  if (Test-Path -LiteralPath $history) { $dirs += @(Get-ChildItem -LiteralPath $history -Directory | ForEach-Object { $_.FullName }) }
  $published = @(foreach ($dir in $dirs) {
    if (Test-Path -LiteralPath $dir) { Get-ChildItem -LiteralPath $dir -File | Where-Object { $_.Extension -eq $Ext } | ForEach-Object { [pscustomobject]@{ Name = $_.Name; Time = $_.LastWriteTime; Hash = Get-Sha $_.FullName } } }
  })
  $earlier = @($published | Where-Object { $_.Hash -ne $hash -and $_.Time.Date -eq $time.Date -and $_.Time -lt $time } | ForEach-Object { $_.Hash } | Sort-Object -Unique)
  $n = 1 + $earlier.Count
  while ($true) {
    # 다른 해시의 파일이 이미 그 이름을 쓰면 겹치지 않을 때까지 순번을 올린다.
    $name = $time.ToString('yyyy-MM-dd', [Globalization.CultureInfo]::InvariantCulture) + "-VoiceNote-$Ver-$Kind-설치" + $(if ($n -ge 2) { "-$n" } else { '' }) + $Ext
    if (@($published | Where-Object { $_.Name -eq $name -and $_.Hash -ne $hash }).Count -eq 0) { return $name }
    $n++
  }
}

# 전달 이름 ← 원본 파일
foreach ($path in @($WindowsInstaller, $AndroidInstaller)) { if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "원본 파일이 없습니다: $path" } }
$windowsName = Get-InstallerName $WindowsInstaller '윈도우' $Version '.exe'
$androidName = Get-InstallerName $AndroidInstaller '안드로이드' $AndroidVersion '.apk'
$sources = [ordered]@{
  $windowsName = $WindowsInstaller
  $androidName = $AndroidInstaller
  'VoiceNote.svg' = $SymbolFile
}
$hashes = [ordered]@{}
foreach ($name in $sources.Keys) {
  if (-not (Test-Path -LiteralPath $sources[$name] -PathType Leaf)) { throw "원본 파일이 없습니다: $($sources[$name])" }
  $hashes[$name] = Get-Sha $sources[$name]
}

# 새 내용은 배포 안 준비 폴더에 먼저 만들고 검증이 끝난 뒤 최신으로 바꾼다.
New-Item -ItemType Directory -Force -Path $deploy | Out-Null
$staging = Assert-InDeploy (Join-Path $deploy ".준비-$stamp")
New-Item -ItemType Directory -Path $staging | Out-Null
foreach ($name in $sources.Keys) {
  $target = Join-Path $staging $name
  Copy-Item -LiteralPath $sources[$name] -Destination $target
  if ((Get-Sha $target) -ne $hashes[$name]) { throw "복사본 해시가 원본과 다릅니다: $name" }
}
$guide = @(
  "VoiceNote $Version 설치 안내"
  "생성일: $(Get-Date -Format 'yyyy-MM-dd HH:mm')"
  ''
  "1. Windows($Version): $($windowsName)를 실행해 설치합니다."
  "2. Android($AndroidVersion): $($androidName)를 휴대폰으로 옮겨 설치합니다. 출처를 알 수 없는 앱 설치 허용을 물으면 허용합니다."
  '파일 이름은 만든 날짜-VoiceNote-버전 순서이며, 같은 날 두 번째로 낸 설치파일부터 끝에 -2, -3이 붙습니다.'
  ''
  'SHA256'
) + ($hashes.Keys | ForEach-Object { "$_  $($hashes[$_])" })
[IO.File]::WriteAllLines((Join-Path $staging '사용안내.txt'), [string[]]$guide, $utf8)

# 기존 최신과 zip은 이전버전\<기존버전>-<시각>으로 보존한다.
if (Test-Path -LiteralPath $latest) {
  $oldGuide = Join-Path $latest '사용안내.txt'
  $oldVersion = 'unknown'
  if (Test-Path -LiteralPath $oldGuide) { $m = [regex]::Match([IO.File]::ReadAllText($oldGuide), 'VoiceNote (\d+\.\d+\.\d+)'); if ($m.Success) { $oldVersion = $m.Groups[1].Value } }
  $backup = Assert-InDeploy (Join-Path $deploy "이전버전\$oldVersion-$stamp")
  New-Item -ItemType Directory -Force -Path (Split-Path $backup -Parent) | Out-Null
  Move-Item -LiteralPath (Assert-InDeploy $latest) -Destination $backup
  if (Test-Path -LiteralPath $zip) { Move-Item -LiteralPath (Assert-InDeploy $zip) -Destination (Join-Path $backup 'VoiceNote-배포.zip') }
} elseif (Test-Path -LiteralPath $zip) {
  $backup = Assert-InDeploy (Join-Path $deploy "이전버전\unknown-$stamp")
  New-Item -ItemType Directory -Force -Path $backup | Out-Null
  Move-Item -LiteralPath (Assert-InDeploy $zip) -Destination (Join-Path $backup 'VoiceNote-배포.zip')
}
Move-Item -LiteralPath $staging -Destination (Assert-InDeploy $latest)

# 최신 폴더 그대로 zip을 만들고 항목 4개의 이름·해시를 확인한다.
[IO.Compression.ZipFile]::CreateFromDirectory($latest, $zip, [IO.Compression.CompressionLevel]::Optimal, $false, [Text.Encoding]::UTF8)
$files = @(Get-ChildItem -LiteralPath $latest -File)
if ($files.Count -ne 4 -or @(Get-ChildItem -LiteralPath $latest -Directory).Count -ne 0) { throw '최신 폴더는 파일 4개만 있어야 합니다.' }
$archive = [IO.Compression.ZipFile]::OpenRead($zip)
try {
  if ($archive.Entries.Count -ne 4) { throw 'zip 항목이 4개가 아닙니다.' }
  $sha = [Security.Cryptography.SHA256]::Create()
  foreach ($entry in $archive.Entries) {
    $file = Join-Path $latest $entry.FullName
    if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { throw "zip 항목이 최신 폴더에 없습니다: $($entry.FullName)" }
    $stream = $entry.Open()
    try { $entryHash = -join ($sha.ComputeHash($stream) | ForEach-Object { $_.ToString('X2') }) } finally { $stream.Dispose() }
    if ($entryHash -ne (Get-Sha $file)) { throw "zip 항목 해시가 다릅니다: $($entry.FullName)" }
  }
} finally { $archive.Dispose() }

Write-Output "게시 완료: $latest"
Write-Output "zip: $zip"
foreach ($name in $hashes.Keys) { Write-Output "$name  $($hashes[$name])" }
