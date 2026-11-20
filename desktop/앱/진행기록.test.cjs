// 진행 기록 공용 모듈(진행기록.js)의 줄 문구·기다림 글·일지 상태·그리기를 공통 예시와 작은 가짜 화면으로 검증한다.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Activity = require('./진행기록.js');

const cases = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'tests', 'fixtures', '진행기록-예시.json'), 'utf8'));
const at = (h, m, s) => new Date(2026, 10, 19, h, m, s).getTime();

function fakeDocument() {
  // 모듈이 쓰는 createElement·append·replaceChildren·textContent·className·hidden·setAttribute만 흉내 낸다.
  const createElement = tag => ({
    tagName: String(tag).toUpperCase(), className: '', textContent: '', hidden: false, children: [], attributes: {},
    append(...items) { this.children.push(...items); },
    replaceChildren(...items) { this.children = items; },
    setAttribute(name, value) { this.attributes[name] = String(value); },
  });
  return { createElement };
}
const texts = node => [node.textContent, ...(node.children || []).flatMap(texts)].filter(Boolean);

test('공통 예시의 줄 문구와 요청 이름이 그대로 나온다', () => {
  for (const item of cases.lines) assert.equal(Activity.lineText(item.event), item.text, JSON.stringify(item.event));
  for (const item of cases.labels) assert.equal(Activity.requestLabel(item.event), item.label, JSON.stringify(item.event));
});

test('기다림 글은 단계와 5분 경계와 제한 주인을 따른다', () => {
  const since = at(20, 42, 30);
  for (const item of cases.waiting) {
    const open = { since, ...item.open, waitSince: item.open.phase === 'wait' ? since + (item.open.waitSinceOffsetSeconds || 0) * 1000 : null };
    assert.equal(Activity.waitingText(open, since + item.elapsedSeconds * 1000, item.limitOwner), item.text, JSON.stringify(item));
  }
});

test('30줄을 넘으면 앞에서 버리고 순서 번호는 이어진다', () => {
  const log = Activity.create('analysis', at(20, 41, 0));
  for (let i = 1; i <= 31; i++) Activity.add(log, { type: 'saveAudio', part: i, total: 31 }, at(20, 41, 0) + i);
  assert.equal(log.entries.length, Activity.MAX_ENTRIES);
  assert.equal(log.entries[0].seq, 2);
  assert.equal(log.entries.at(-1).seq, 31);
  assert.equal(log.entries.at(-1).text, '음성 저장함 · 31/31개');
});

test('요청을 열면 보냄 줄이 남고 닫으면 열린 요청이 없다', () => {
  const log = Activity.create('analysis', at(20, 41, 0));
  const open = Activity.openRequest(log, { type: 'sendTranscript', part: 1, total: 2, bytes: 4299161 }, at(20, 41, 6), { size: 4299161 });
  assert.equal(log.entries.at(-1).text, '전사 요청 보냄 · 조각 1/2 · 4.1MB');
  assert.deepEqual(open, { label: '전사 · 조각 1/2', since: at(20, 41, 6), phase: 'upload', sent: 0, size: 4299161, waitSince: null });
  Activity.progress(log, 2202010);
  assert.equal(log.open.sent, 2202010);
  Activity.uploaded(log, at(20, 41, 20));
  assert.equal(log.open.phase, 'wait');
  assert.equal(log.open.waitSince, at(20, 41, 20));
  Activity.closeRequest(log);
  assert.equal(log.open, null);
  const summary = Activity.openRequest(log, { type: 'sendSummary', part: 1, total: 1 }, at(20, 42, 30));
  assert.equal(summary.phase, 'wait');
  assert.equal(summary.waitSince, at(20, 42, 30));
});

test('마지막 줄이 실패·취소면 lastIsFailure가 참이다', () => {
  const log = Activity.create('analysis', at(20, 41, 0));
  assert.equal(Activity.lastIsFailure(log), false);
  assert.equal(Activity.lastIsFailure(null), false);
  Activity.add(log, { type: 'recvSummary', part: 1, total: 1 }, at(20, 41, 1));
  assert.equal(Activity.lastIsFailure(log), false);
  Activity.add(log, { type: 'timeout' }, at(20, 41, 2));
  assert.equal(Activity.lastIsFailure(log), true);
  Activity.add(log, { type: 'canceled' }, at(20, 41, 3));
  assert.equal(Activity.lastIsFailure(log), true);
});

function sampleLog() {
  const log = Activity.create('analysis', at(20, 41, 0));
  Activity.add(log, { type: 'saveAudio', part: 1, total: 1 }, at(20, 41, 0));
  Activity.add(log, { type: 'sendTranscript', part: 1, total: 1, bytes: 4299161 }, at(20, 41, 6));
  Activity.add(log, { type: 'recvTranscript', part: 1, total: 1, chars: 2310 }, at(20, 41, 40));
  Activity.openRequest(log, { type: 'sendSummary', part: 1, total: 1 }, at(20, 42, 30));
  return log;
}

test('그리기는 머리·최근 줄·기다림 줄·안내를 붙이고 tick은 기다림 글만 바꾼다', () => {
  const document = fakeDocument(), container = document.createElement('div');
  const log = sampleLog();
  Activity.render(container, log, at(20, 42, 30), { limitOwner: 'server', maxRows: 4, document });
  assert.equal(container.hidden, false);
  const [head, list, hint] = container.children;
  assert.deepEqual(texts(head), ['AI 요청 기록', '마지막 기록 20:42:30']);
  assert.equal(list.tagName, 'OL');
  assert.equal(list.attributes['aria-label'], 'AI 요청 기록');
  assert.equal(list.children.length, 4);
  assert.deepEqual(list.children.slice(0, 3).map(li => texts(li).join(' ')), [
    '20:41:06 전사 요청 보냄 · 조각 1/1 · 4.1MB', '20:41:40 전사 받음 · 조각 1/1 · 2,310자', '20:42:30 회의록 정리 요청 보냄 · 구간 1/1']);
  const wait = list.children[3];
  assert.equal(wait.className, 'activity-wait');
  assert.deepEqual(texts(wait), ['지금', '응답 기다리는 중 · 0:00 / 최대 5:00']);
  assert.equal(hint.textContent, Activity.HINT);
  const before = list.children.slice();
  Activity.tick(container, log, at(20, 43, 1), { limitOwner: 'server' });
  assert.deepEqual(list.children, before);
  assert.equal(texts(wait)[1], '응답 기다리는 중 · 0:31 / 최대 5:00');
});

test('줄이 없으면 마지막 기록을 보이지 않는다', () => {
  const document = fakeDocument(), container = document.createElement('div');
  Activity.render(container, Activity.create('analysis', at(20, 41, 0)), at(20, 41, 0), { document });
  assert.equal(container.hidden, true);
  assert.equal(container.children.length, 0);
  const openOnly = { id: 'only-open', entries: [], open: { label: '회의록 정리 · 구간 1/1', since: at(20, 42, 30), phase: 'wait', sent: 0, size: null, waitSince: at(20, 42, 30) } };
  Activity.render(container, openOnly, at(20, 42, 40), { limitOwner: 'app', document });
  assert.equal(container.hidden, false);
  assert.deepEqual(texts(container.children[0]), ['AI 요청 기록']);
  assert.deepEqual(texts(container.children[1].children[0]), ['지금', '응답 기다리는 중 · 0:10 / 최대 5:00']);
  Activity.render(container, null, at(20, 42, 40), { document });
  assert.equal(container.hidden, true);
  assert.equal(container.children.length, 0);
});

test('같은 그림이면 다시 그리지 않는다', () => {
  const document = fakeDocument(), container = document.createElement('div');
  const log = sampleLog();
  Activity.render(container, log, at(20, 42, 30), { limitOwner: 'server', document });
  const list = container.children[1];
  Activity.render(container, log, at(20, 42, 45), { limitOwner: 'server', document });
  assert.equal(container.children[1], list);
  assert.equal(texts(list.children.at(-1))[1], '응답 기다리는 중 · 0:15 / 최대 5:00');
  Activity.add(log, { type: 'recvSummary', part: 1, total: 1 }, at(20, 43, 0));
  Activity.closeRequest(log);
  Activity.render(container, log, at(20, 43, 0), { limitOwner: 'server', document });
  assert.notEqual(container.children[1], list);
  assert.equal(container.children.length, 2);
});

test('일지 번호가 바뀌면 칸을 새로 그린다', () => {
  const document = fakeDocument(), container = document.createElement('div');
  const first = Activity.create('analysis', at(20, 41, 0));
  Activity.add(first, { type: 'saveAudio', part: 1, total: 2 }, at(20, 41, 0));
  Activity.render(container, first, at(20, 41, 0), { document });
  const second = Activity.create('analysis', at(21, 0, 0));
  Activity.add(second, { type: 'sendCompact' }, at(21, 0, 0));
  Activity.render(container, second, at(21, 0, 0), { document });
  const all = texts(container);
  assert.ok(!all.some(text => text.includes('음성 저장함')), all.join(' | '));
  assert.ok(all.includes('회의록 줄이기 요청 보냄'));
});

test('서버가 /activity-log.js로 진행기록.js를 그대로 준다', async t => {
  const os = require('node:os');
  const { createMeetingServer } = require('./서버.cjs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'voicenote-activity-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const meeting = createMeetingServer({ dataDir: dir });
  await new Promise(resolve => meeting.server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => meeting.server.close(resolve)));
  const response = await fetch(`http://127.0.0.1:${meeting.server.address().port}/activity-log.js`);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type') || '', /javascript/);
  assert.equal(await response.text(), fs.readFileSync(path.join(__dirname, '진행기록.js'), 'utf8'));
});

test('Windows 화면은 app.js보다 먼저 activity-log.js를 불러온다', () => {
  const html = fs.readFileSync(path.join(__dirname, '화면', 'index.html'), 'utf8');
  const log = html.indexOf('<script src="./activity-log.js" defer></script>'), app = html.indexOf('<script src="./app.js" defer></script>');
  assert.ok(log > 0 && log < app, `activity-log ${log}, app ${app}`);
});
