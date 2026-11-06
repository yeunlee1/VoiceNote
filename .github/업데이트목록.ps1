# 릴리즈할 Windows 설치파일과 Android APK로 업데이트 목록(VoiceNote-<버전>-update.json)을 만들고 Android 개인 서명 키로 서명한다. 앱은 이 서명을 확인한 뒤에만 설치파일을 실행한다.
# 서명 파일과 암호는 읽어서 Java 서명 도구에 넘기기만 하고 출력하지 않는다. 같은 이름의 목록이 이미 있으면 덮어쓰지 않는다.
param(
  [Parameter(Mandatory)][string]$Version,
  [Parameter(Mandatory)][int]$VersionCode,
  [Parameter(Mandatory)][string]$WindowsInstaller,
  [Parameter(Mandatory)][string]$AndroidApk,
  [Parameter(Mandatory)][string]$SigningDir,
  [string]$KeystoreName = '회의록서명.p12',
  [Parameter(Mandatory)][string]$Jdk,
  [Parameter(Mandatory)][string]$OutputDir,
  # 실제 릴리즈에서는 Android 개인 서명 인증서 지문을 넘겨, 다른 키로 서명한 목록이 나가지 않게 한다.
  [string]$ExpectedCertificateSha256 = ''
)
$ErrorActionPreference = 'Stop'
$target = Join-Path $OutputDir "VoiceNote-$Version-update.json"
if (Test-Path -LiteralPath $target) { throw "업데이트 목록이 이미 있습니다. 덮어쓰지 않습니다: $target" }
$work = Join-Path ([IO.Path]::GetTempPath()) ('vn-manifest-' + [guid]::NewGuid().ToString('N'))
$jdkLink = Join-Path $work 'jdk'
try {
  New-Item -ItemType Directory -Path $work | Out-Null
  # Java는 영어 Windows에서 한글 경로를 열지 못하므로 JDK는 정션으로, 릴리즈 파일과 서명 도구는 한글 없는 임시 경로로 넘긴다.
  New-Item -ItemType Junction -Path $jdkLink -Target $Jdk | Out-Null
  Copy-Item -LiteralPath $WindowsInstaller -Destination (Join-Path $work 'windows.exe')
  Copy-Item -LiteralPath $AndroidApk -Destination (Join-Path $work 'android.apk')
  Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'UpdateManifest.java') -Destination (Join-Path $work 'UpdateManifest.java')
  $passwordFile = Join-Path $SigningDir '서명암호.txt'
  $keystore = Join-Path $SigningDir $KeystoreName
  if (!(Test-Path -LiteralPath $passwordFile) -or !(Test-Path -LiteralPath $keystore)) { throw "서명 파일이 없습니다: $SigningDir" }
  # Android 빌드(빌드.ps1)와 같은 방식으로 암호 파일 내용을 그대로 환경변수로 넘긴다.
  $env:MEETING_SIGN_PASS = [IO.File]::ReadAllText($passwordFile)
  $out = Join-Path $work 'update.json'
  # Java 안내 문구는 콘솔과 같은 인코딩으로 낸다. 콘솔이 UTF-8(러너 등)이면 UTF-8, 아니면 Java 기본값(이 PC의 한국어 코드 페이지)을 쓴다.
  $javaOptions = @('-Dfile.encoding=UTF-8')
  if ([Console]::OutputEncoding.CodePage -eq 65001) { $javaOptions += '-Dstdout.encoding=UTF-8', '-Dstderr.encoding=UTF-8' }
  $result = & (Join-Path $jdkLink 'bin\java.exe') @javaOptions (Join-Path $work 'UpdateManifest.java') --version $Version --version-code $VersionCode --windows (Join-Path $work 'windows.exe') --android (Join-Path $work 'android.apk') --keystore $keystore --out $out
  if ($LASTEXITCODE -ne 0) { throw '업데이트 목록을 서명하지 못했습니다. 위 Java 안내를 확인하세요.' }
  $env:MEETING_SIGN_PASS = $null
  $found = [regex]::Match(($result -join "`n"), '(?m)^certificateSha256=([0-9a-f]{64})\s*$')
  if (-not $found.Success -or -not (Test-Path -LiteralPath $out)) { throw '서명 도구의 결과를 확인하지 못했습니다.' }
  $certificate = $found.Groups[1].Value
  if ($ExpectedCertificateSha256 -and $certificate -ne $ExpectedCertificateSha256.ToLowerInvariant()) { throw "업데이트 목록을 서명한 인증서($certificate)가 Android 개인 서명 인증서와 다릅니다. 목록을 남기지 않습니다." }
  New-Item -ItemType Directory -Path $OutputDir -Force | Out-Null
  Copy-Item -LiteralPath $out -Destination $target
  "업데이트 목록: $(Split-Path $target -Leaf) | $((Get-Item -LiteralPath $target).Length) 바이트 | 서명 인증서 SHA-256 $certificate"
}
finally {
  $env:MEETING_SIGN_PASS = $null
  # 정션을 둔 채 폴더를 지우면 원본 JDK까지 지워질 수 있으므로 정션부터 풀고, 정션이 남지 않았을 때만 지운다.
  if (Test-Path -LiteralPath $jdkLink) { (Get-Item -LiteralPath $jdkLink).Delete() }
  if ((Test-Path -LiteralPath $work) -and -not @(Get-ChildItem -LiteralPath $work -Recurse -Force -Attributes ReparsePoint -ErrorAction SilentlyContinue).Count) {
    Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
  }
}
