// 버전이 적힌 모든 곳(설치 스크립트·실행 파일·앱 버전·안드로이드·안내 문서·릴리즈 노트)이 같은 버전을 가리키는지 검사한다.
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const root = path.join(__dirname, '..', '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8').replace(/^﻿/, '');
const pick = (file, pattern) => {
  const found = read(file).match(pattern);
  assert.ok(found, `${file}에서 버전을 찾지 못했습니다: ${pattern}`);
  return found[1];
};

const version = pick('desktop/앱/앱버전.cjs', /APP_VERSION:\s*'(\d+\.\d+\.\d+)'/);
const versionCode = Number(pick('mobile/안드로이드/AndroidManifest.xml', /android:versionCode="(\d+)"/));

test('앱이 업데이트를 비교할 때 쓰는 버전과 설치파일·실행 파일·안드로이드 버전이 같다', () => {
  assert.equal(pick('desktop/설치/설치파일.iss', /^AppVersion=(\d+\.\d+\.\d+)\s*$/m), version);
  assert.equal(pick('desktop/설치/설치파일.iss', /^AppVerName=VoiceNote (\d+\.\d+\.\d+)\s*$/m), version);
  assert.equal(pick('desktop/설치/설치파일.iss', /^OutputBaseFilename=\d{4}-\d{2}-\d{2}-VoiceNote-(\d+\.\d+\.\d+)-설치\s*$/m), version);
  assert.equal(pick('desktop/프로그램.cs', /AssemblyVersion\("(\d+\.\d+\.\d+)\.0"\)/), version);
  assert.equal(pick('desktop/프로그램.cs', /AssemblyFileVersion\("(\d+\.\d+\.\d+)\.0"\)/), version);
  assert.equal(pick('mobile/안드로이드/AndroidManifest.xml', /android:versionName="(\d+\.\d+\.\d+)"/), version);
  assert.ok(Number.isInteger(versionCode) && versionCode > 0);
});

test('안내 문서와 빌드 결과 이름도 같은 버전을 쓴다', () => {
  assert.equal(pick('desktop/소스안내.txt', /^버전 (\d+\.\d+\.\d+)/), version);
  const guide = read('mobile/안드로이드/빌드안내.txt').match(/^안드로이드 빌드 \(VoiceNote (\d+\.\d+\.\d+), versionCode (\d+)\)/);
  assert.ok(guide, '빌드안내.txt 첫 줄 형식');
  assert.deepEqual([guide[1], Number(guide[2])], [version, versionCode]);
  assert.match(read('desktop/앱/사용안내.md'), new RegExp(`\`VoiceNote-${version.replace(/\./g, '\\.')}-설치\\.exe\``));
  const names = read('mobile/안드로이드/빌드.ps1').match(/-VoiceNote-\d+\.\d+\.\d+-안드로이드-/g) || [];
  assert.ok(names.length >= 2, '안드로이드 빌드 결과 이름');
  for (const name of names) assert.equal(name, `-VoiceNote-${version}-안드로이드-`);
});

test('릴리즈 노트의 맨 위가 지금 버전이고 두 화면의 릴리즈 노트가 같은 파일이다', () => {
  const notes = require(path.join(root, 'desktop/앱/릴리즈노트.js'));
  assert.equal(notes.NOTES[0].version, version);
  assert.equal(read('mobile/안드로이드/assets/release-notes.js'), read('desktop/앱/릴리즈노트.js'));
});

test('자동 배포가 버전을 맞춰 볼 때 앱 버전 파일도 함께 본다', () => {
  const deploy = read('.github/자동배포.ps1');
  for (const file of ['desktop/설치/설치파일.iss', 'desktop/프로그램.cs', 'mobile/안드로이드/AndroidManifest.xml', 'desktop/앱/앱버전.cjs'])
    assert.ok(deploy.includes(`'${file}'`), `자동배포.ps1의 버전 확인에 ${file}이 없습니다.`);
});
