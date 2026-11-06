# 버전을 확인하고 저장소 시험을 돌린 뒤 Windows 설치파일과 Android APK를 한 폴더에 모은다. .github/workflows/자동배포.yml이 부른다.
# 저장소와 작업 흐름에는 서명 파일과 API 키를 두지 않는다. 태그 배포는 환경변수로 받은 서명을 임시 폴더에 풀어 쓰고 지우며, 빌드 시험은 버리는 서명을 새로 만든다.
param(
  [Parameter(Mandatory)][string]$OutputDir,
  [string]$Tag = '',
  [string]$AndroidSdk = $env:ANDROID_HOME,
  [string]$Jdk = $env:JAVA_HOME_21_X64
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem

# 공식 파일을 받아 쓰고, 내용이 바뀌면 빌드를 멈춘다. 버전을 올릴 때 주소와 해시를 함께 바꾼다.
$nodeUrl = 'https://nodejs.org/dist/v24.18.0/win-x64/node.exe'
$nodeSha256 = '9a4eb5f1c29c6a2e93852ead46b999e284a6a5ca8bab4d4e241d587d025a52de'
$webViewUrl = 'https://www.nuget.org/api/v2/package/Microsoft.Web.WebView2/1.0.4258.31'
$webViewSha256 = '56f7f4b8bf9aee4b8efefbbdd4f67d5f74ebd1b100ed0806da71bf76af481aa9'
# Microsoft가 내용을 계속 갱신하는 설치 도우미라 해시 대신 서명을 확인한다.
$webViewSetupUrl = 'https://go.microsoft.com/fwlink/p/?LinkId=2124703'
# 이전 버전과 같은 인증서여야 휴대폰에서 지우지 않고 업데이트된다. 이 지문은 공개 정보다.
$releaseCertificate = 'f9a7e71bd8aab9d05c4e5475830dece73db25fd3b34005e30ad2955c2df08c61'

$root = Split-Path $PSScriptRoot -Parent
$work = Join-Path ([IO.Path]::GetTempPath()) ('vn-deploy-' + [guid]::NewGuid().ToString('N'))
$signing = Join-Path $work 'signing'
New-Item -ItemType Directory -Path $work, $signing, $OutputDir -Force | Out-Null

function Get-AppVersion {
  # 네 곳에 적힌 버전이 같은지 확인해 잘못 올린 설치파일을 막는다. 앱버전.cjs는 앱이 새 버전과 견줄 때 쓰는 값이다.
  $sources = @(
    @('desktop/설치/설치파일.iss', '(?m)^AppVersion=(\d+\.\d+\.\d+)\s*$'),
    @('desktop/프로그램.cs', 'AssemblyVersion\("(\d+\.\d+\.\d+)\.0"\)'),
    @('mobile/안드로이드/AndroidManifest.xml', 'android:versionName="(\d+\.\d+\.\d+)"'),
    @('desktop/앱/앱버전.cjs', "APP_VERSION:\s*'(\d+\.\d+\.\d+)'")
  )
  $values = foreach ($source in $sources) {
    $found = [regex]::Match([IO.File]::ReadAllText((Join-Path $root $source[0])), $source[1])
    if (-not $found.Success) { throw "$($source[0])에서 버전을 찾지 못했습니다." }
    $found.Groups[1].Value
  }
  if (@($values | Select-Object -Unique).Count -ne 1) { throw "버전이 서로 다릅니다: $($values -join ', ')" }
  $values[0]
}

function Get-VersionCode {
  # 휴대폰이 새 버전으로 알아보는 번호다. 업데이트 목록에도 같은 번호를 적는다.
  $found = [regex]::Match([IO.File]::ReadAllText((Join-Path $root 'mobile/안드로이드/AndroidManifest.xml')), 'android:versionCode="(\d+)"')
  if (-not $found.Success) { throw 'AndroidManifest.xml에서 versionCode를 찾지 못했습니다.' }
  [int]$found.Groups[1].Value
}

function Invoke-Tests([string]$directory, [string[]]$patterns) {
  Push-Location $directory
  try {
    $files = @(foreach ($pattern in $patterns) { (Get-ChildItem -Path $pattern -File).FullName })
    if (-not $files.Count) { throw "$directory 에서 시험 파일을 찾지 못했습니다." }
    & node --test @files
    if ($LASTEXITCODE -ne 0) { throw "$directory 시험이 실패했습니다." }
  }
  finally { Pop-Location }
}

function Get-VerifiedFile([string]$url, [string]$file, [string]$sha256) {
  Invoke-WebRequest -Uri $url -OutFile $file
  if ((Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash -ne $sha256) { throw "내려받은 파일의 해시가 다릅니다: $url" }
}

try {
  $version = Get-AppVersion
  if ($Tag -and $Tag -ne "v$version") { throw "태그($Tag)와 앱 버전($version)이 다릅니다." }
  Write-Host "== 버전 $version | 시스템 코드 페이지 $((Get-ItemProperty 'HKLM:\SYSTEM\CurrentControlSet\Control\Nls\CodePage').ACP)"

  # Android 빌드와 시험이 기대하는 도구 폴더 모양을 러너의 SDK·JDK로 맞춘다.
  $tools = Join-Path $work 'android-tools'
  New-Item -ItemType Directory -Path (Join-Path $tools '도구\JDK') -Force | Out-Null
  New-Item -ItemType Junction -Path (Join-Path $tools 'SDK') -Target $AndroidSdk | Out-Null
  New-Item -ItemType Junction -Path (Join-Path $tools '도구\JDK\jdk') -Target $Jdk | Out-Null
  # 시험도 설치파일에 넣는 것과 같은 Node로 돌린다.
  $nodeDirectory = Join-Path $work 'node'
  New-Item -ItemType Directory -Path $nodeDirectory -Force | Out-Null
  $node = Join-Path $nodeDirectory 'node.exe'
  Get-VerifiedFile $nodeUrl $node $nodeSha256
  $env:VOICENOTE_TOOLS = $tools
  $env:JAVA_HOME = $Jdk
  $env:PATH = $nodeDirectory + [IO.Path]::PathSeparator + (Join-Path $Jdk 'bin') + [IO.Path]::PathSeparator + $env:PATH

  Write-Host '== 데스크톱 시험'
  Invoke-Tests (Join-Path $root 'desktop') @('앱/*.test.cjs', 'tests/*.test.cjs')
  Write-Host '== 모바일 시험'
  Invoke-Tests (Join-Path $root 'mobile/안드로이드') @('tests/*.test.cjs')
  Write-Host '== 화면 검사'
  & node (Join-Path $root 'mobile/안드로이드/tests/화면검증-브라우저.cjs') (Join-Path $work 'captures')
  if ($LASTEXITCODE -ne 0) { throw '화면 검사가 실패했습니다.' }

  Write-Host '== Windows 의존성 받기'
  $dependencies = Join-Path $work 'dependencies'
  New-Item -ItemType Directory -Path $dependencies -Force | Out-Null
  $package = Join-Path $work 'WebView2.nupkg'
  Get-VerifiedFile $webViewUrl $package $webViewSha256
  [IO.Compression.ZipFile]::ExtractToDirectory($package, (Join-Path $dependencies 'WebView2'))
  $webViewSetup = Join-Path $dependencies 'MicrosoftEdgeWebview2Setup.exe'
  Invoke-WebRequest -Uri $webViewSetupUrl -OutFile $webViewSetup
  $signature = Get-AuthenticodeSignature -LiteralPath $webViewSetup
  if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notlike 'CN=Microsoft Corporation,*') { throw 'WebView2 설치 도우미의 서명을 확인하지 못했습니다.' }

  Write-Host '== Windows 빌드'
  $windowsBuild = Join-Path $work 'windows'
  & (Join-Path $root 'desktop/설치/빌드.ps1') -BuildRoot $windowsBuild -NodePath $node -DependencyRoot $dependencies
  if (Get-ChildItem -LiteralPath (Join-Path $windowsBuild '배포') -Recurse -File | Where-Object Name -eq '기본키.json') { throw '설치파일에 공용 키 파일이 들어갔습니다.' }
  $installers = @(Get-ChildItem -LiteralPath (Join-Path $windowsBuild '설치파일') -File -Filter '*.exe')
  if ($installers.Count -ne 1) { throw "설치파일이 $($installers.Count)개입니다." }

  # 창을 띄우지 않고 앱을 실제로 시작해 화면까지 뜨는지 본다. 사람이 쓰는 PC의 화면을 건드리지 않게 러너에서만 돌린다.
  if ($env:GITHUB_ACTIONS) {
    Write-Host '== 앱 자체 검사'
    $app = Join-Path $windowsBuild '배포\프로젝트 회의록.exe'
    $process = Start-Process -FilePath $app -ArgumentList '--self-test', ('"' + (Join-Path $work 'self-test') + '"') -PassThru
    $null = $process.Handle
    if (-not $process.WaitForExit(180000)) { $process.Kill(); throw '앱 자체 검사가 3분 안에 끝나지 않았습니다.' }
    if ($process.ExitCode -ne 0) { throw "앱 자체 검사가 실패했습니다. 종료 코드 $($process.ExitCode)" }
  }

  Write-Host '== Android 서명 준비'
  $passwordFile = Join-Path $signing '서명암호.txt'
  # Java 도구가 읽을 수 있게 서명 파일 이름에 한글을 쓰지 않는다.
  $keystore = Join-Path $signing 'release.p12'
  if ($Tag) {
    if (-not $env:VOICENOTE_SIGN_P12_B64 -or -not $env:VOICENOTE_SIGN_PASS_B64) { throw '서명 값이 없습니다. .github/서명등록.ps1로 release 환경에 등록하세요.' }
    [IO.File]::WriteAllBytes($keystore, [Convert]::FromBase64String($env:VOICENOTE_SIGN_P12_B64))
    $passwordBytes = [Convert]::FromBase64String($env:VOICENOTE_SIGN_PASS_B64)
    [IO.File]::WriteAllBytes($passwordFile, $passwordBytes)
    Write-Host "::add-mask::$([Text.Encoding]::UTF8.GetString($passwordBytes).Trim())"
    $passwordBytes = $null
  }
  else {
    $throwaway = [guid]::NewGuid().ToString('N')
    [IO.File]::WriteAllText($passwordFile, $throwaway, (New-Object Text.UTF8Encoding($false)))
    & (Join-Path $Jdk 'bin\keytool.exe') -genkeypair -alias rehearsal -keyalg RSA -keysize 2048 -validity 1 -storetype PKCS12 -keystore $keystore -storepass $throwaway -dname 'CN=VoiceNote Rehearsal' *> $null
    if ($LASTEXITCODE -ne 0) { throw '시험용 서명을 만들지 못했습니다.' }
  }

  Write-Host '== Android 빌드'
  $androidBuild = Join-Path $work 'android'
  & (Join-Path $root 'mobile/안드로이드/빌드.ps1') -ToolRoot $tools -OutputRoot $androidBuild -SigningDir $signing -KeystoreName 'release.p12'
  $apk = Join-Path $androidBuild 'VoiceNote-android.apk'
  if ($Tag) {
    $certificates = & (Join-Path $AndroidSdk 'build-tools\36.0.0\apksigner.bat') verify --print-certs $apk
    if ($LASTEXITCODE -ne 0 -or -not ($certificates -match "SHA-256 digest: $releaseCertificate")) { throw 'APK 서명 인증서가 이전 버전과 달라 업데이트 설치가 막힙니다.' }
  }

  $windowsAsset = Join-Path $OutputDir "VoiceNote-$version-Windows-Setup.exe"
  $androidAsset = Join-Path $OutputDir "VoiceNote-$version-Android.apk"
  Copy-Item -LiteralPath $installers[0].FullName -Destination $windowsAsset
  Copy-Item -LiteralPath $apk -Destination $androidAsset

  # 앱이 새 버전을 받기 전에 확인하는 업데이트 목록을 Android 서명 키로 서명한다. 태그 배포는 개인 서명 인증서가 아니면 멈춘다.
  Write-Host '== 업데이트 목록 서명'
  $versionCode = Get-VersionCode
  $manifestArguments = @{ Version = $version; VersionCode = $versionCode; WindowsInstaller = $windowsAsset; AndroidApk = $androidAsset; SigningDir = $signing; KeystoreName = 'release.p12'; Jdk = $Jdk; OutputDir = $OutputDir }
  if ($Tag) { $manifestArguments.ExpectedCertificateSha256 = $releaseCertificate }
  & (Join-Path $PSScriptRoot '업데이트목록.ps1') @manifestArguments
  # 앱과 같은 검증기로 다시 확인한다. 리허설은 버리는 서명의 인증서로, 태그 배포는 앱에 넣은 인증서로 본다.
  $checkArguments = @((Join-Path $PSScriptRoot '업데이트목록확인.cjs'), '--manifest', (Join-Path $OutputDir "VoiceNote-$version-update.json"), '--version', $version, '--version-code', "$versionCode", '--windows', $windowsAsset, '--android', $androidAsset)
  $rehearsalCertificate = ''
  if (-not $Tag) {
    $rehearsalCertificate = Join-Path $signing 'rehearsal.pem'
    & (Join-Path $Jdk 'bin\keytool.exe') -exportcert -rfc -alias rehearsal -keystore $keystore -storepass $throwaway -file $rehearsalCertificate *> $null
    if ($LASTEXITCODE -ne 0) { throw '시험 서명의 인증서를 꺼내지 못했습니다.' }
    $checkArguments += '--certificate', $rehearsalCertificate
  }
  & node @checkArguments
  if ($LASTEXITCODE -ne 0) { throw '업데이트 목록 확인이 실패했습니다.' }

  # 실제로 설치하고 업데이트해 보는 시험은 러너에서만, 버리는 서명을 쓰는 리허설에서만 한다. 사람이 쓰는 PC에는 설치하지 않는다.
  if ($env:GITHUB_ACTIONS -and -not $Tag) {
    Write-Host '== 업데이트 설치 시험'
    & (Join-Path $PSScriptRoot '업데이트설치시험.ps1') -Files $OutputDir -Version $version -Certificate $rehearsalCertificate -Work (Join-Path $work 'update-e2e')
  }
  Write-Host '== 결과'
  foreach ($file in Get-ChildItem -LiteralPath $OutputDir -File) {
    Write-Host ('{0} | {1} 바이트 | {2}' -f $file.Name, $file.Length, (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash)
  }
}
finally {
  # 서명 파일은 성공·실패와 관계없이 지운다.
  $env:MEETING_SIGN_PASS = $null
  if (Test-Path -LiteralPath $signing) { Remove-Item -LiteralPath $signing -Recurse -Force }
  # 정션을 둔 채 임시 폴더를 지우면 원본 SDK·JDK까지 지워질 수 있으므로 정션부터 풀고, 정션이 하나도 남지 않았을 때만 지운다.
  foreach ($link in (Join-Path $work 'android-tools\SDK'), (Join-Path $work 'android-tools\도구\JDK\jdk')) {
    if (Test-Path -LiteralPath $link) { (Get-Item -LiteralPath $link).Delete() }
  }
  if (-not @(Get-ChildItem -LiteralPath $work -Recurse -Force -Attributes ReparsePoint -ErrorAction SilentlyContinue).Count) {
    Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
  }
}
