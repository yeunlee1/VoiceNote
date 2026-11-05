// 자동 배포 작업 흐름과 스크립트의 안전 조건을 소스에서 확인한다. 실제 동작은 작업 흐름의 빌드 시험이 확인한다.
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const root = path.join(__dirname, '../..');
const workflow = fs.readFileSync(path.join(root, '.github/workflows/자동배포.yml'), 'utf8').replace(/\r\n/g, '\n');
const script = fs.readFileSync(path.join(root, '.github/자동배포.ps1'), 'utf8').replace(/\r\n/g, '\n');
const hookTest = fs.readFileSync(path.join(root, '.githooks/push-비밀검사-시험.sh'), 'utf8').replace(/\r\n/g, '\n');
const job = name => workflow.slice(workflow.indexOf(`  ${name}:\n`)).split(/\n  (?=[a-z]+:\n)/)[0];

test('실제 릴리즈는 태그 push에서만 돌고 수동 실행과 브랜치는 빌드 시험만 돈다', () => {
  assert.match(job('release'), /if: github\.event_name == 'push' && github\.ref_type == 'tag'/);
  assert.match(job('rehearsal'), /if: github\.event_name == 'workflow_dispatch' \|\| github\.ref_type == 'branch'/);
});

test('서명 값과 쓰기 권한은 릴리즈 작업에만 있고 API 키는 어디에도 없다', () => {
  assert.doesNotMatch(job('rehearsal'), /secrets\.|contents: write|environment:/);
  assert.match(job('release'), /environment: release/);
  assert.match(job('release'), /contents: write/);
  assert.doesNotMatch(workflow + script, /OPENAI|DefaultKeyFile/);
});

test('임시 폴더를 지우기 전에 SDK와 JDK 정션을 정확한 경로로 푼다', () => {
  const cleanup = script.slice(script.indexOf('finally {\n  # 서명'));
  assert.ok(cleanup.includes("Join-Path $work 'android-tools\\SDK'"), cleanup);
  assert.ok(cleanup.includes("Join-Path $work 'android-tools\\도구\\JDK\\jdk'"), cleanup);
  assert.ok(script.includes("New-Item -ItemType Junction -Path (Join-Path $tools 'SDK')"));
  assert.ok(script.includes("New-Item -ItemType Junction -Path (Join-Path $tools '도구\\JDK\\jdk')"));
  assert.ok(cleanup.indexOf('.Delete()') < cleanup.indexOf('Remove-Item -LiteralPath $work'));
  assert.match(cleanup, /Attributes ReparsePoint/);
});

test('영어 Windows 러너에서도 Java가 읽도록 Android 빌드는 한글 없는 경로만 넘긴다', () => {
  const build = fs.readFileSync(path.join(root, 'mobile/안드로이드/빌드.ps1'), 'utf8').replace(/\r\n/g, '\n');
  // JDK와 소스는 임시 정션으로 넘기고, 끝나면 JAVA_HOME을 되돌려 지워진 정션을 가리키지 않게 한다.
  assert.ok(build.includes('$env:JAVA_HOME=$jdkLink'));
  assert.ok(build.includes("Join-Path $sourceLink 'src'"));
  assert.ok(build.includes("Join-Path $sourceLink 'tests\\AndroidChecks.java'"));
  assert.ok(build.includes('$env:JAVA_HOME=$previousJavaHome'));
  assert.ok(build.includes('$keystore=Join-Path $SigningDir $KeystoreName'));
  // 서명 파일 이름도 keytool과 apksigner에 그대로 넘어가므로 자동 배포에서는 한글을 쓰지 않는다.
  assert.ok(script.includes("$keystore = Join-Path $signing 'release.p12'"));
  assert.ok(script.includes("-KeystoreName 'release.p12'"));
  assert.ok(script.includes('$env:JAVA_HOME = $Jdk'));
});

test('훅 시험은 이 PC의 실제 키 파일을 읽지 않도록 자료 폴더를 임시 폴더로 바꾼다', () => {
  const exported = hookTest.indexOf('export LOCALAPPDATA="$W"');
  assert.ok(exported > 0, '자료 폴더를 바꾸는 줄이 없습니다');
  assert.ok(exported < hookTest.indexOf('git push'), '첫 push보다 먼저 바꿔야 합니다');
});
