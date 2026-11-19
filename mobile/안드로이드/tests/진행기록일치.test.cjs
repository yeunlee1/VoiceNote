// 휴대폰 화면용 activity-log.js가 데스크톱 진행기록.js와 같은 파일이고 app.js보다 먼저 불러오는지 검증한다.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const android = path.join(__dirname, '..');

test('휴대폰 activity-log.js는 데스크톱 진행기록.js와 같은 파일이다', () => {
  assert.deepEqual(fs.readFileSync(path.join(android, 'assets', 'activity-log.js')), fs.readFileSync(path.join(android, '..', '..', 'desktop', '앱', '진행기록.js')));
});

test('휴대폰 화면은 app.js보다 먼저 activity-log.js를 불러온다', () => {
  const html = fs.readFileSync(path.join(android, 'assets', 'index.html'), 'utf8');
  const log = html.indexOf('<script src="activity-log.js" defer></script>'), app = html.indexOf('<script src="app.js" defer></script>');
  assert.ok(log > 0 && log < app, `activity-log ${log}, app ${app}`);
});

test('cleartext 허용은 검증용 분기 안에만 있다', () => {
  // 기기 시험의 가짜 OpenAI(http://127.0.0.1)만 평문으로 받는다. 설치본 매니페스트는 그대로 꺼 둔다.
  assert.match(fs.readFileSync(path.join(android, 'AndroidManifest.xml'), 'utf8'), /android:usesCleartextTraffic="false"/);
  const lines = fs.readFileSync(path.join(android, '빌드.ps1'), 'utf8').split(/\r?\n/).filter(line => line.includes('usesCleartextTraffic="true"'));
  assert.ok(lines.length >= 1, '검증용 빌드가 cleartext를 켜는 줄이 있어야 한다');
  for (const line of lines) assert.match(line.trim(), /^if\(\$DebugBuild\)\{/, `검증용 분기 밖에서 cleartext를 켜면 안 된다: ${line.trim()}`);
});
