# 자동 배포에 쓸 Android 서명을 GitHub 환경 release의 비밀 값으로 등록한다. 값은 화면과 로그에 출력하지 않으며, 저장소 주인이 직접 한 번 실행한다.
param(
  [string]$SigningDir = 'C:\DEV\VoiceNote\2026-09-30-회의록도구-안드로이드\개인서명',
  [string]$Repo = 'yeunlee1/VoiceNote'
)
$ErrorActionPreference = 'Stop'
$keystore = Join-Path $SigningDir '회의록서명.p12'
$passwordFile = Join-Path $SigningDir '서명암호.txt'
foreach ($file in $keystore, $passwordFile) {
  if (-not (Test-Path -LiteralPath $file)) { throw "서명 파일이 없습니다: $file" }
}

# 비밀 값을 v로 시작하는 태그의 실행에서만 읽도록 환경을 제한한다.
'{"deployment_branch_policy":{"protected_branches":false,"custom_branch_policies":true}}' | gh api -X PUT "repos/$Repo/environments/release" --input - | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'release 환경을 만들지 못했습니다.' }
$policies = gh api "repos/$Repo/environments/release/deployment-branch-policies" --jq '.branch_policies[] | .type + ":" + .name'
if ($LASTEXITCODE -ne 0) { throw 'release 환경의 태그 제한을 읽지 못했습니다.' }
if (@($policies) -notcontains 'tag:v*') {
  gh api -X POST "repos/$Repo/environments/release/deployment-branch-policies" -f 'name=v*' -f 'type=tag' | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'release 환경의 태그 제한을 넣지 못했습니다.' }
}

[Convert]::ToBase64String([IO.File]::ReadAllBytes($keystore)) | gh secret set VOICENOTE_SIGN_P12_B64 --env release --repo $Repo
if ($LASTEXITCODE -ne 0) { throw '서명 파일을 등록하지 못했습니다.' }
[Convert]::ToBase64String([IO.File]::ReadAllBytes($passwordFile)) | gh secret set VOICENOTE_SIGN_PASS_B64 --env release --repo $Repo
if ($LASTEXITCODE -ne 0) { throw '서명 암호를 등록하지 못했습니다.' }
'서명 등록을 마쳤습니다. 값은 화면에 출력하지 않았습니다.'
