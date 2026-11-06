# Android SDK 도구로 APK를 만들어 원본 자료와 분리된 산출물 폴더에 저장한다. 공용 기본 키는 -DefaultKeyFile로 명시할 때만 release 패키징 임시 자산에 넣는다.
# 빌드 결과는 산출물 아래 내부용이다. 사용자 전달은 루트 배포준비.ps1로 배포\최신 폴더와 배포\VoiceNote-배포.zip만 갱신한다.
param(
  [string]$ToolRoot='C:\DEV\VoiceNote\2026-09-30-회의록도구-안드로이드',
  [string]$OutputRoot=(Join-Path (Split-Path (Split-Path $PSScriptRoot -Parent) -Parent) ('산출물\안드로이드\'+(Get-Date -Format 'yyyy-MM-dd-HHmmss'))),
  [string]$ServerScript=(Join-Path $PSScriptRoot '..\..\desktop\앱\서버.cjs'),
  [string]$SigningDir='',
  [string]$DefaultKeyFile='',
  # 자동 배포는 Java 도구가 읽도록 한글 없는 이름의 서명 파일을 넘긴다.
  [string]$KeystoreName='회의록서명.p12',
  [switch]$DebugBuild
)
$ErrorActionPreference='Stop'
if([string]::IsNullOrWhiteSpace($SigningDir)){$SigningDir=Join-Path $ToolRoot '개인서명'}
New-Item -ItemType Directory -Path $OutputRoot -Force | Out-Null
$suffix=[guid]::NewGuid().ToString('N')
$toolLink=Join-Path $env:TEMP ('vn-tools-'+$suffix)
$outLink=Join-Path $env:TEMP ('vn-out-'+$suffix)
# Java 도구는 자기 위치와 명령줄을 시스템 코드 페이지로 읽어 영어 Windows에서 한글 경로를 열지 못하므로 JDK와 소스도 한글 없는 정션으로 넘긴다.
$sourceLink=Join-Path $env:TEMP ('vn-src-'+$suffix)
$jdkLink=Join-Path $env:TEMP ('vn-jdk-'+$suffix)
$previousJavaHome=$env:JAVA_HOME
try {
  # 준비 중 실패해도 finally가 이미 만든 정션을 풀도록 try 안에서 만든다.
  New-Item -ItemType Junction -Path $toolLink -Target $ToolRoot | Out-Null
  New-Item -ItemType Junction -Path $outLink -Target $OutputRoot | Out-Null
  New-Item -ItemType Junction -Path $sourceLink -Target $PSScriptRoot | Out-Null
  New-Item -ItemType Junction -Path $jdkLink -Target (Get-ChildItem -LiteralPath (Join-Path $ToolRoot '도구\JDK') -Directory | Select-Object -First 1).FullName | Out-Null
  $env:JAVA_HOME=$jdkLink
  $javaBin=Join-Path $env:JAVA_HOME 'bin'
  $sdk=Join-Path $toolLink 'SDK'
  $tools=Join-Path $sdk 'build-tools\36.0.0'
  $androidJar=Join-Path $sdk 'platforms\android-36\android.jar'
  $stage=Join-Path $outLink ('stage-'+$(if($DebugBuild){'debug'}else{'release'}))
  if(Test-Path -LiteralPath $stage){Remove-Item -LiteralPath $stage -Recurse -Force}
  $assets=Join-Path $stage 'assets'
  $classes=Join-Path $stage 'classes'
  $dex=Join-Path $stage 'dex'
  New-Item -ItemType Directory -Path $assets,$classes,$dex -Force | Out-Null
  Copy-Item -Path (Join-Path $PSScriptRoot 'assets\*') -Destination $assets
  if($DebugBuild){Copy-Item -LiteralPath (Join-Path $PSScriptRoot '..\..\desktop\tests\fixtures\회의문서-예시.json') -Destination (Join-Path $assets 'meeting-document-cases.json')}
  & node (Join-Path $PSScriptRoot '요약계약추출.cjs') $assets $ServerScript
  if($LASTEXITCODE -ne 0){throw '요약 계약 추출 실패'}
  Remove-Item -LiteralPath (Join-Path $assets '임시검증') -Recurse -Force -ErrorAction SilentlyContinue
  if(Get-ChildItem -LiteralPath $assets -Recurse -File | Where-Object {$_.Name -in 'personal.key','default.key'}){throw '원본 자산에 API 키 파일이 섞였습니다.'}
  $defaultKeyAsset=Join-Path $assets 'default.key'
  if($DefaultKeyFile){
    # 키 값은 출력하지 않고 형식만 확인한 뒤 패키징 임시 자산에만 쓴다. 검증용 APK에는 넣지 않는다.
    if($DebugBuild){throw '검증용 APK에는 공용 기본 키를 넣지 않습니다.'}
    $stored=[IO.File]::ReadAllText($DefaultKeyFile) | ConvertFrom-Json
    $value=[string]$stored.apiKey
    if([string]::IsNullOrWhiteSpace($value) -or $value.Trim().Length -gt 500){throw '기본 키 파일에 apiKey가 없거나 형식이 맞지 않습니다.'}
    [IO.File]::WriteAllText($defaultKeyAsset,(@{apiKey=$value.Trim()} | ConvertTo-Json -Compress),(New-Object Text.UTF8Encoding($false)))
    $stored=$null;$value=$null
  }
  $utf8=New-Object Text.UTF8Encoding($false)
  $manifest=[IO.File]::ReadAllText((Join-Path $PSScriptRoot 'AndroidManifest.xml'))
  if($DebugBuild){$manifest=$manifest.Replace('<application ','<application android:debuggable="true" ').Replace('</manifest>','<instrumentation android:name="kr.local.meetingjournal.AndroidChecks" android:targetPackage="kr.local.meetingjournal" /></manifest>')}
  [IO.File]::WriteAllText((Join-Path $stage 'AndroidManifest.xml'),$manifest,$utf8)
  $sources=@(Get-ChildItem -LiteralPath (Join-Path $sourceLink 'src') -Recurse -Filter '*.java' | ForEach-Object {$_.FullName})
  if($DebugBuild){$sources+=Join-Path $sourceLink 'tests\AndroidChecks.java'}
  & (Join-Path $javaBin 'javac.exe') -encoding UTF-8 -source 8 -target 8 -Xlint:-options -bootclasspath "$androidJar;$(Join-Path $tools 'core-lambda-stubs.jar')" -d $classes @sources
  if($LASTEXITCODE -ne 0){throw 'Java 컴파일 실패'}
  # d8.bat은 배치 파일이라 명령줄이 cmd 한도(8191자)를 넘으면 실패한다. 클래스 파일을 하나씩 넘기지 않고 jar 하나로 묶어 넘긴다.
  $classesJar=Join-Path $stage 'classes.jar'
  & (Join-Path $javaBin 'jar.exe') --create --file $classesJar -C $classes .
  if($LASTEXITCODE -ne 0){throw '클래스 묶기 실패'}
  & (Join-Path $tools 'd8.bat') --lib $androidJar --min-api 26 --output $dex $classesJar
  if($LASTEXITCODE -ne 0){throw 'DEX 생성 실패'}
  $unsigned=Join-Path $stage 'unsigned.apk'
  $res=Join-Path $stage 'res'
  Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'res') -Destination $res -Recurse
  $compiled=Join-Path $stage 'res.zip'
  & (Join-Path $tools 'aapt2.exe') compile --dir $res -o $compiled
  if($LASTEXITCODE -ne 0){throw '앱 아이콘 리소스 컴파일 실패'}
  & (Join-Path $tools 'aapt2.exe') link -o $unsigned -I $androidJar --manifest (Join-Path $stage 'AndroidManifest.xml') -A $assets $compiled
  if($LASTEXITCODE -ne 0){throw 'APK 자산 패키징 실패'}
  & (Join-Path $javaBin 'jar.exe') uf $unsigned -C $dex classes.dex
  if($LASTEXITCODE -ne 0){throw 'APK 코드 패키징 실패'}
  $aligned=Join-Path $stage 'aligned.apk'
  & (Join-Path $tools 'zipalign.exe') -f 4 $unsigned $aligned
  if($LASTEXITCODE -ne 0){throw 'APK 정렬 실패'}
  # 기존 설치본 위에 업데이트해 데이터를 보존하도록 기존 개인 서명을 읽기만 한다. 서명 파일이 없으면 만들지 않고 중단한다.
  $passwordFile=Join-Path $SigningDir '서명암호.txt'
  $keystore=Join-Path $SigningDir $KeystoreName
  if(!(Test-Path -LiteralPath $passwordFile) -or !(Test-Path -LiteralPath $keystore)){throw "서명 파일이 없습니다: $SigningDir"}
  $env:MEETING_SIGN_PASS=[IO.File]::ReadAllText($passwordFile)
  $output=Join-Path $outLink $(if($DebugBuild){'VoiceNote-android-test.apk'}else{'VoiceNote-android.apk'})
  & (Join-Path $tools 'apksigner.bat') sign --ks $keystore --ks-pass env:MEETING_SIGN_PASS --out $output $aligned
  if($LASTEXITCODE -ne 0){throw 'APK 서명 실패'}
  & (Join-Path $tools 'apksigner.bat') verify $output
  if($LASTEXITCODE -ne 0){throw 'APK 서명 검증 실패'}
  # 키 값을 읽지 않고 APK 안 항목 이름만 확인한다. 명시한 경우에만 기본 키가 있고 개인 키 파일은 없어야 한다.
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $zip=[IO.Compression.ZipFile]::OpenRead((Join-Path $OutputRoot (Split-Path $output -Leaf)))
  try{$entries=@($zip.Entries | ForEach-Object FullName)}finally{$zip.Dispose()}
  if($entries -contains 'assets/personal.key'){throw 'APK에 개인 키 파일이 들어 있습니다.'}
  if([bool]$DefaultKeyFile -ne ($entries -contains 'assets/default.key')){throw 'APK의 공용 기본 키 포함 여부가 요청과 다릅니다.'}
  if($entries -notcontains 'assets/formats.js'){throw 'APK에 출력 형식 파일(formats.js)이 없습니다.'}
  foreach($format in 'meeting','summary','tasks'){if($entries -notcontains "assets/summary-$format.json"){throw "APK에 $format 요약 양식이 없습니다."}}
  if($entries -notcontains 'assets/summary-feedback.json'){throw 'APK에 의견 반영 지시문(summary-feedback.json)이 없습니다.'}
  if($entries -notcontains 'assets/summary-compact.json'){throw 'APK에 결과 줄이기 지시문(summary-compact.json)이 없습니다.'}
  '의견 반영 지시문 포함: 예'
  "공용 기본 키 포함: $(if($entries -contains 'assets/default.key'){'예'}else{'아니요'})"
  $korean=Join-Path $OutputRoot $(if($DebugBuild){((Get-Date -Format 'yyyy-MM-dd')+'-VoiceNote-1.5.0-안드로이드-검증용.apk')}else{((Get-Date -Format 'yyyy-MM-dd')+'-VoiceNote-1.5.0-안드로이드-설치본.apk')})
  Copy-Item -LiteralPath (Join-Path $OutputRoot (Split-Path $output -Leaf)) -Destination $korean -Force
  Get-Item -LiteralPath $korean | Select-Object FullName,Length
} finally {
  $env:MEETING_SIGN_PASS=$null
  # 공용 키가 든 임시 자산과 서명 전 중간 APK는 산출물 폴더에 남기지 않는다.
  if($stage -and (Test-Path -LiteralPath (Join-Path $stage 'assets\default.key'))){foreach($name in 'assets\default.key','unsigned.apk','aligned.apk'){$file=Join-Path $stage $name;if(Test-Path -LiteralPath $file){[IO.File]::Delete((Get-Item -LiteralPath $file).FullName)}}}
  foreach($link in $toolLink,$outLink,$sourceLink,$jdkLink){if(Test-Path -LiteralPath $link){(Get-Item -LiteralPath $link).Delete()}}
  $env:JAVA_HOME=$previousJavaHome
}
