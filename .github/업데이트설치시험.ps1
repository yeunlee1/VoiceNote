# 러너에서만 도는 Windows 업데이트 설치 시험이다. 빌드한 설치파일을 임시 폴더에 설치하고 앱을 일반 실행으로 켠 뒤,
# 앱의 실제 업데이트 코드로 업데이트 모드 설치를 띄워 앱이 닫힐 때까지 기다렸다가 바꾸고 다시 켜는지 본다.
# 시작 확인에 실패하면 설치 프로세스 묶음이 남지 않는지, 지난 보관 폴더가 남았거나 바꾸던 중 실패하면 원래 파일을 지키는지도 본다.
# 사람이 쓰는 PC에는 설치하지 않으므로 GITHUB_ACTIONS가 없으면 멈춘다.
param(
  [Parameter(Mandatory)][string]$Files,
  [Parameter(Mandatory)][string]$Version,
  [Parameter(Mandatory)][string]$Certificate,
  [Parameter(Mandatory)][string]$Work
)
$ErrorActionPreference = 'Stop'
if (-not $env:GITHUB_ACTIONS) { throw '업데이트 설치 시험은 GitHub 러너에서만 돌립니다. 이 PC에는 설치하지 않습니다.' }

$installer = Join-Path $Files "VoiceNote-$Version-Windows-Setup.exe"
$appDir = Join-Path $Work 'VoiceNote'
$appExe = Join-Path $appDir '프로젝트 회의록.exe'
$backup = "$appDir.업데이트전"
$harness = Join-Path $PSScriptRoot '업데이트설치시험.cjs'
$node = (Get-Command node).Source
$marker = '/* 업데이트 설치 시험 표시 */'
New-Item -ItemType Directory -Path $Work -Force | Out-Null

function Wait-For([scriptblock]$Condition, [int]$Seconds, [string]$What) {
  $deadline = (Get-Date).AddSeconds($Seconds)
  do {
    $value = & $Condition
    if ($value) { return $value }
    Start-Sleep -Milliseconds 250
  } while ((Get-Date) -lt $deadline)
  throw "$Seconds초 안에 확인하지 못했습니다: $What"
}
# 설치 폴더에서 실행 중인 프로세스(앱 창과 그 서버 node.exe)다.
function Get-AppProcesses {
  @(Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith($appDir + '\', [StringComparison]::OrdinalIgnoreCase) })
}
# 이 시험이 띄운 설치파일 로더(.exe)와 그것이 띄운 실제 설치 프로세스(.tmp)다. 로더는 실행 경로가 시험의 설치파일이거나
# 시험 폴더 아래(앱의 업데이트 코드가 받은 사본)인 것만, 실제 설치는 그 로더의 자식만 이 시험의 것으로 본다. 한 번 본 번호는 기억한다.
$script:ownedSetup = New-Object 'System.Collections.Generic.HashSet[int]'
function Get-SetupProcesses {
  $all = @(Get-CimInstance Win32_Process)
  foreach ($process in $all) {
    $path = $process.ExecutablePath
    if ($path -and $process.Name -like "VoiceNote-$Version-Windows-Setup.exe" -and ($path -eq $installer -or $path.StartsWith($Work + '\', [StringComparison]::OrdinalIgnoreCase))) { $null = $script:ownedSetup.Add([int]$process.ProcessId) }
  }
  foreach ($process in $all) {
    if ($process.Name -like "VoiceNote-$Version-Windows-Setup.tmp" -and $script:ownedSetup.Contains([int]$process.ParentProcessId)) { $null = $script:ownedSetup.Add([int]$process.ProcessId) }
  }
  @($all | Where-Object { $script:ownedSetup.Contains([int]$_.ProcessId) -and $_.Name -like "VoiceNote-$Version-Windows-Setup*" })
}
# 실제 설치 프로세스가 떠 있는 동안 지켜보며 이 시험의 것으로 기억한다. 로더가 먼저 끝나도 자식을 놓치지 않게 한다.
function Watch-Setup($process) {
  $saw = $false
  while (-not $process.HasExited) {
    if (Get-SetupProcesses | Where-Object { $_.Name -like '*.tmp' }) { $saw = $true }
    Start-Sleep -Milliseconds 200
  }
  $saw
}
# 앱 창이 뜨고 그 서버가 자식 node.exe로 떴는지 기다린다.
function Wait-App($process) {
  $server = Wait-For { Get-AppProcesses | Where-Object { $_.ParentProcessId -eq $process.Id -and $_.Name -eq 'node.exe' } | Select-Object -First 1 } 120 '앱 서버 시작'
  Wait-For { $process.Refresh(); $process.MainWindowHandle -ne [IntPtr]::Zero } 120 '앱 창' | Out-Null
  # 창이 뜬 뒤 화면(WebView)까지 열려야 닫기 요청 때 앱이 화면 상태를 물어 바로 닫힌다. 그 전에 닫으면 종료 확인 창이 막으므로 잠시 기다린다.
  Start-Sleep -Seconds 12
  [pscustomobject]@{ Window = $process; ServerPid = [int]$server.ProcessId }
}
# 일반 실행으로 켠다. 실제 업데이트처럼 앱이 뮤텍스를 잡고 서버를 띄운다.
function Open-App {
  $process = Start-Process -FilePath $appExe -WorkingDirectory $appDir -PassThru
  $null = $process.Handle
  Wait-App $process
}
function Close-App($app) {
  $app.Window.Refresh()
  if (-not $app.Window.HasExited) { $null = $app.Window.CloseMainWindow() }
  if (-not $app.Window.WaitForExit(60000)) { throw '앱 창이 1분 안에 닫히지 않았습니다.' }
  Wait-For { -not (Get-Process -Id $app.ServerPid -ErrorAction SilentlyContinue) } 60 '앱 서버 종료' | Out-Null
}
# 설치파일이 다시 켠 앱을 찾는다.
function Find-Relaunched([int]$OldPid) {
  $found = Wait-For { Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.Id -ne $OldPid -and $_.Path -eq $appExe } | Select-Object -First 1 } 90 '설치파일이 다시 켠 앱'
  $null = $found.Handle
  Wait-App $found
}
function Read-Status([string]$File) {
  if (Test-Path -LiteralPath $File -PathType Leaf) { ([IO.File]::ReadAllText($File)).Trim() } else { '' }
}
function Add-Marker([string[]]$Paths) { foreach ($path in $Paths) { [IO.File]::AppendAllText($path, "`n$marker`n") } }
function Get-MarkerCount([string[]]$Paths) { @($Paths | Where-Object { [IO.File]::ReadAllText($_).Contains($marker) }).Count }
# 업데이트 모드로 띄운 설치파일이 끝날 때까지 기다리고 마지막 상태를 돌려준다.
function Wait-Setup([string]$StatusFile) {
  Wait-For { (Read-Status $StatusFile) -in 'installed', 'restored', 'failed', 'blocked', 'timeout' } 300 '업데이트 설치 결과' | Out-Null
  Wait-For { (Get-SetupProcesses).Count -eq 0 } 120 '설치 프로세스 종료' | Out-Null
  Read-Status $StatusFile
}
# 앱이 쓰는 것과 같은 인자로 업데이트 모드 설치를 띄운다.
function Start-UpdateSetup($app, [string]$StatusFile, [string]$Log) {
  $arguments = @('/SILENT', '/SUPPRESSMSGBOXES', '/NORESTART', '/update=1', "/DIR=`"$appDir`"", "/LOG=`"$Log`"", "/status=`"$StatusFile`"", "/pids=$($app.Window.Id),$($app.ServerPid)")
  $setup = Start-Process -FilePath $installer -ArgumentList $arguments -PassThru
  $null = $setup.Handle
  $null = $script:ownedSetup.Add($setup.Id)
  $setup
}
# 앱의 실제 업데이트 코드를 도우미로 돌린다. 결과(마지막 줄 JSON)는 파일로 받는다.
function Start-Harness($app, [string]$TempRoot, [string]$Output, [int]$StartTimeout = 15000, [switch]$BlockStatus, [switch]$NoKillTree) {
  $arguments = @("`"$harness`"", '--app-dir', "`"$appDir`"", '--files', "`"$Files`"", '--version', $Version, '--certificate', "`"$Certificate`"",
    '--host-pid', $app.Window.Id, '--server-pid', $app.ServerPid, '--temp-root', "`"$TempRoot`"", '--start-timeout', $StartTimeout)
  if ($BlockStatus) { $arguments += '--block-status' }
  if ($NoKillTree) { $arguments += '--no-kill-tree' }
  $process = Start-Process -FilePath $node -ArgumentList $arguments -RedirectStandardOutput $Output -NoNewWindow -PassThru
  $null = $process.Handle
  $process
}
function Read-Harness($process, [string]$Output) {
  if (-not $process.WaitForExit(600000)) { throw '업데이트 도우미가 10분 안에 끝나지 않았습니다.' }
  $line = @(Get-Content -LiteralPath $Output -Encoding utf8 | Where-Object { $_.Trim() })[-1]
  Write-Host "   도우미 결과: $line"
  $line | ConvertFrom-Json
}

$app = $null
try {
  Write-Host '-- 처음 설치'
  $firstLog = Join-Path $Work 'first-install.log'
  $first = Start-Process -FilePath $installer -ArgumentList @('/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', "/DIR=`"$appDir`"", "/LOG=`"$firstLog`"", '/MERGETASKS="!desktopicon"') -PassThru -Wait
  if ($first.ExitCode -ne 0 -or -not (Test-Path -LiteralPath $appExe)) { throw "처음 설치가 실패했습니다. 종료 코드 $($first.ExitCode)" }
  # 설치 기록에 적힌 순서로, 먼저 바뀌는 글 파일 세 개를 표시 파일로, 마지막에 바뀌는 화면 파일 하나를 중간 실패용 걸림돌로 쓴다.
  # 걸림돌은 화면 파일이라 지워도 앱 서버는 뜬다.
  $order = @([Text.Encoding]::UTF8.GetString([IO.File]::ReadAllBytes($firstLog)) -split "`r?`n" | ForEach-Object { if ($_ -match 'Dest filename: (.+)$') { $Matches[1].Trim() } } |
    Where-Object { $_.StartsWith($appDir + '\', [StringComparison]::OrdinalIgnoreCase) -and (Test-Path -LiteralPath $_ -PathType Leaf) })
  $screens = @($order | Where-Object { $_ -like (Join-Path $appDir '앱\화면\*') })
  if ($order.Count -lt 5 -or -not $screens.Count) { throw "설치 기록에서 설치 순서를 읽지 못했습니다(읽은 파일 $($order.Count)개). 기록의 글자 인코딩을 확인하세요." }
  $blocker = $screens[-1]
  $blockerAt = [array]::IndexOf($order, $blocker)
  if ($blockerAt -lt 3) { throw "걸림돌로 쓸 화면 파일이 너무 앞에 설치됩니다: $blocker" }
  $markers = @($order[0..($blockerAt - 1)] | Where-Object { $_ -match '\.(js|cjs|css)$' } | Select-Object -First 3)
  if ($markers.Count -lt 3) { throw '걸림돌보다 먼저 설치되는 글 파일을 세 개 찾지 못했습니다.' }
  Write-Host "   표시 파일: $($markers -join ', ') / 걸림돌: $blocker"

  Write-Host '-- 앱이 띄운 업데이트 설치'
  $app = Open-App
  Add-Marker $markers
  $output = Join-Path $Work 'A-harness.txt'
  $a = Read-Harness (Start-Harness $app (Join-Path $Work 'A') $output) $output
  if ($a.outcome -ne 'launching') { throw "앱이 업데이트 설치를 시작하지 못했습니다: $($a.outcome)" }
  if ((Read-Status $a.statusFile) -ne 'waiting') { throw "앱이 켜져 있는 동안 설치파일이 기다리지 않습니다: $(Read-Status $a.statusFile)" }
  Start-Sleep -Seconds 3
  if ((Get-MarkerCount $markers) -ne $markers.Count) { throw '앱이 켜져 있는데 파일이 바뀌었습니다.' }
  $old = $app.Window.Id
  Close-App $app
  $result = Wait-Setup $a.statusFile
  if ($result -ne 'installed') { throw "업데이트 설치 결과가 installed가 아닙니다: $result" }
  if (Get-MarkerCount $markers) { throw '업데이트했는데 옛 파일이 남았습니다.' }
  if (Test-Path -LiteralPath $backup) { throw '업데이트를 마쳤는데 보관 폴더가 남았습니다.' }
  $app = Find-Relaunched $old
  Write-Host '   통과: 앱이 닫힐 때까지 기다렸다가 바꾸고 다시 켰습니다.'

  Write-Host '-- 설치 시작 확인 실패'
  Add-Marker $markers
  $output = Join-Path $Work 'B-harness.txt'
  # 설치파일이 상태를 적지 못하게 해 시작 확인이 시간 안에 오지 않게 만든다. 그사이 실제 설치 프로세스가 떴는지도 본다.
  $process = Start-Harness $app (Join-Path $Work 'B') $output -StartTimeout 8000 -BlockStatus
  $sawSetup = Watch-Setup $process
  $b = Read-Harness $process $output
  if ($b.outcome -ne 'UPDATE_LAUNCH_FAILED') { throw "시작 확인 실패를 알리지 않았습니다: $($b.outcome)" }
  if (-not $sawSetup) { throw '실제 설치 프로세스가 뜨기 전에 끝나 시작 확인 실패 시험이 되지 않았습니다.' }
  Wait-For { (Get-SetupProcesses).Count -eq 0 } 20 '남은 설치 프로세스 정리' | Out-Null
  Close-App $app
  $app = $null
  Start-Sleep -Seconds 20
  if ((Get-SetupProcesses).Count) { throw '시작 확인에 실패한 설치 프로세스가 남아 있습니다.' }
  if ((Get-MarkerCount $markers) -ne $markers.Count) { throw '시작 확인에 실패했는데 파일이 바뀌었습니다.' }
  if ((Get-AppProcesses).Count) { throw '시작 확인에 실패했는데 앱이 다시 켜졌습니다.' }
  Write-Host '   통과: 설치 프로세스 묶음이 남지 않고 파일도 그대로입니다.'

  Write-Host '-- 설치 프로세스 묶음을 끝내지 못한 경우'
  # 로더만 끝나고 실제 설치 프로세스가 남아도, 앱이 남긴 취소 표시를 보고 아무것도 바꾸지 않고 스스로 끝나야 한다.
  $app = Open-App
  $output = Join-Path $Work 'B2-harness.txt'
  $process = Start-Harness $app (Join-Path $Work 'B2') $output -StartTimeout 8000 -BlockStatus -NoKillTree
  $sawSetup = Watch-Setup $process
  $b2 = Read-Harness $process $output
  if ($b2.outcome -ne 'UPDATE_LAUNCH_FAILED') { throw "시작 확인 실패를 알리지 않았습니다: $($b2.outcome)" }
  if (-not $sawSetup) { throw '실제 설치 프로세스가 뜨기 전에 끝나 취소 표시 시험이 되지 않았습니다.' }
  Wait-For { (Get-SetupProcesses).Count -eq 0 } 30 '취소 표시를 본 설치 프로세스 종료' | Out-Null
  # 남은 설치파일은 취소 표시를 보면 그 표시를 지우고 끝난다. 표시가 남아 있으면 설치파일이 보지 못한 것이다.
  if (Test-Path -LiteralPath "$($b2.statusFile).cancel") { throw '남은 설치파일이 취소 표시를 보지 못했습니다.' }
  Close-App $app
  $app = $null
  Start-Sleep -Seconds 10
  if ((Get-SetupProcesses).Count) { throw '취소된 설치 프로세스가 남아 있습니다.' }
  if ((Get-MarkerCount $markers) -ne $markers.Count) { throw '취소된 설치가 파일을 바꿨습니다.' }
  if ((Get-AppProcesses).Count) { throw '취소된 설치가 앱을 다시 켰습니다.' }
  Write-Host '   통과: 남은 실제 설치 프로세스가 취소 표시를 보고 아무것도 바꾸지 않고 끝났습니다.'

  Write-Host '-- 지난 보관 폴더가 남은 경우'
  $app = Open-App
  New-Item -ItemType Directory -Path $backup | Out-Null
  [IO.File]::WriteAllText((Join-Path $backup 'left.txt'), 'kept')
  $status = Join-Path $Work 'C-status.txt'
  $setup = Start-UpdateSetup $app $status (Join-Path $Work 'C-install.log')
  Wait-For { (Read-Status $status) -eq 'waiting' } 60 '설치파일 대기' | Out-Null
  $old = $app.Window.Id
  Close-App $app
  if (-not $setup.WaitForExit(300000)) { throw '설치파일이 5분 안에 끝나지 않았습니다.' }
  if ($setup.ExitCode -ne 7) { throw "보관 폴더가 남았는데 종료 코드가 $($setup.ExitCode)입니다." }
  if ((Read-Status $status) -ne 'blocked') { throw "보관 폴더가 남았는데 상태가 blocked가 아닙니다: $(Read-Status $status)" }
  if ((Get-MarkerCount $markers) -ne $markers.Count) { throw '보관 폴더가 남았는데 파일을 바꿨습니다.' }
  if (-not (Test-Path -LiteralPath (Join-Path $backup 'left.txt'))) { throw '남아 있던 보관 폴더를 지웠습니다.' }
  $app = Find-Relaunched $old
  Remove-Item -LiteralPath $backup -Recurse -Force
  Write-Host '   통과: 아무것도 바꾸지 않고 멈춘 뒤 앱을 다시 켰습니다.'

  Write-Host '-- 바꾸던 중 실패'
  # 같은 이름의 폴더를 두면 설치파일이 이 파일을 쓰지 못하고 멈춘다. 그 앞의 파일은 이미 바뀐 뒤다.
  # 걸림돌은 화면 파일이라 되돌린 뒤 다시 켠 앱이 화면을 못 읽으므로, 원본을 따로 두었다가 시험 끝에 되돌린다.
  $blockerCopy = Join-Path $Work 'blocker-original'
  Copy-Item -LiteralPath $blocker -Destination $blockerCopy
  Remove-Item -LiteralPath $blocker -Force
  New-Item -ItemType Directory -Path $blocker | Out-Null
  $status = Join-Path $Work 'D-status.txt'
  $setup = Start-UpdateSetup $app $status (Join-Path $Work 'D-install.log')
  Wait-For { (Read-Status $status) -eq 'waiting' } 60 '설치파일 대기' | Out-Null
  $old = $app.Window.Id
  Close-App $app
  if (-not $setup.WaitForExit(300000)) { throw '설치파일이 5분 안에 끝나지 않았습니다.' }
  if ($setup.ExitCode -in 0, 7) { throw "바꾸던 중 실패를 만들었는데 종료 코드가 $($setup.ExitCode)입니다." }
  if ((Read-Status $status) -ne 'restored') { throw "바꾸던 중 실패했는데 상태가 restored가 아닙니다: $(Read-Status $status)" }
  if ((Get-MarkerCount $markers) -ne $markers.Count) { throw '실패한 업데이트가 바꾼 파일을 되돌리지 않았습니다.' }
  if (Test-Path -LiteralPath $backup) { throw '되돌린 뒤에도 보관 폴더가 남았습니다.' }
  $app = Find-Relaunched $old
  # 다시 켠 앱은 걸림돌 때문에 화면 파일이 없어 닫기 확인에 답하지 못할 수 있다. 시험이 만든 상태이므로 강제로 끝내고 걸림돌을 되돌린다.
  foreach ($id in $app.ServerPid, $app.Window.Id) { Stop-Process -Id $id -Force -ErrorAction SilentlyContinue }
  Wait-For { -not (Get-AppProcesses).Count } 60 '다시 켠 앱 종료' | Out-Null
  $app = $null
  Remove-Item -LiteralPath $blocker -Recurse -Force
  Copy-Item -LiteralPath $blockerCopy -Destination $blocker
  Write-Host "   통과: 종료 코드 $($setup.ExitCode), 바꾼 파일을 되돌리고 앱을 다시 켰습니다."
}
finally {
  # 이 시험이 켠 앱과 설치 프로세스만 정리한다. 설치 폴더 밖의 프로세스는 건드리지 않는다.
  foreach ($process in @(Get-SetupProcesses) + @(Get-AppProcesses)) {
    try { Stop-Process -Id $process.ProcessId -Force -ErrorAction Stop } catch {}
  }
}
