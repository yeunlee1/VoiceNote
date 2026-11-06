// 프로그램 정보에 보여 줄 버전별 바뀐 점 목록이 최신 버전부터 정리돼 있고, 지금 앱 버전이 빠지지 않았으며, 서버가 화면에 그대로 내보내는지 검증한다.
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const notes = require('./릴리즈노트.js');
const { APP_VERSION } = require('./앱버전.cjs');
const check = require('./업데이트검증.cjs');
const { createMeetingServer } = require('./서버.cjs');

test('버전은 겹치지 않고 최신 버전부터 적혀 있으며 지금 앱 버전이 들어 있다', () => {
  const versions = notes.NOTES.map((note) => note.version);
  assert.equal(new Set(versions).size, versions.length);
  for (let index = 1; index < versions.length; index++) assert.equal(check.compareVersions(versions[index - 1], versions[index]), 1, versions.join(' '));
  // 버전을 올리면 그 버전의 바뀐 점도 먼저 적어야 한다.
  assert.ok(notes.find(APP_VERSION), `앱 버전 ${APP_VERSION}의 바뀐 점이 없습니다.`);
  assert.equal(notes.find('0.0.1'), null);
});

test('버전마다 제목과 바뀐 점이 있고 날짜는 실제 날짜이며 버전 순서와 맞다', () => {
  let later = null;
  for (const note of notes.NOTES) {
    assert.ok(note.title.trim(), note.version);
    assert.ok(note.items.length >= 1 && note.items.length <= 8, note.version);
    for (const item of note.items) {
      assert.equal(typeof item, 'string');
      assert.ok(item.trim().length >= 8 && item.length <= 120, item);
      // 화면 문장은 한국어와 영어만 쓴다.
      assert.doesNotMatch(item + note.title, /[぀-ヿ㐀-䶿一-鿿]/, item);
    }
    assert.ok(note.date === null || /^\d{4}-\d{2}-\d{2}$/.test(note.date), note.version);
    if (note.date) {
      assert.ok(!Number.isNaN(Date.parse(`${note.date}T00:00:00+09:00`)), note.date);
      if (later) assert.ok(note.date <= later, `${note.version} 날짜가 더 새 버전보다 늦습니다.`);
      later = note.date;
    }
  }
  assert.ok(Object.isFrozen(notes.NOTES) && Object.isFrozen(notes.NOTES[0]) && Object.isFrozen(notes.NOTES[0].items));
});

test('날짜는 한국어 날짜로 보여 주고 게시 전이면 비워 둔다', () => {
  assert.equal(notes.dateLabel('2026-11-06'), '2026년 11월 6일');
  assert.equal(notes.dateLabel(null), '');
  assert.equal(notes.dateLabel('11/06'), '');
});

test('서버는 바뀐 점 목록을 화면용 스크립트로 그대로 내보낸다', async (t) => {
  const meeting = createMeetingServer();
  await new Promise((resolve) => meeting.server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => meeting.server.close(resolve)));
  const response = await fetch(`http://127.0.0.1:${meeting.server.address().port}/release-notes.js`);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /javascript/);
  assert.equal(await response.text(), fs.readFileSync(path.join(__dirname, '릴리즈노트.js'), 'utf8'));
});
