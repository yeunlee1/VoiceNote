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
