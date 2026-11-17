// 사람이 고친 할 일이 AI 결과와 따로 저장되고, 목록·체크·의견 반영·고른 폴더 사본에 맞게 이어지는지 검증한다.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { createMeetingServer } = require('./서버.cjs');
const { createMeetingStore } = require('./회의보관.cjs');

async function start(t, dataDir) {
  const meeting = createMeetingServer({ dataDir });
  await new Promise(resolve => meeting.server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => meeting.server.close(resolve)));
  const url = `http://127.0.0.1:${meeting.server.address().port}`;
  return async (route, body, auth = true) => {
    const response = await fetch(url + route, { method: body === undefined ? 'GET' : 'POST',
      headers: { Origin: url, 'Content-Type': 'application/json', ...(auth ? { 'X-Meeting-Token': meeting.token } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
  };
}
function folder(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'meeting-todo-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}
const action = (task, owner = null, due = null) => ({ task, owner, due });
const minutes = (...actions) => ({ overview: '준비 회의', topics: [], decisions: [], actions, openQuestions: [] });
const result = (extra = {}) => ({ id: randomUUID(), title: '출시 회의', date: '2026-11-09', participants: '김민수, 박서연', transcript: '전사', minutes: minutes(action('일정 공유'), action('발주 변경', '김민수')), ...extra });
const item = (task, owner = null, due = null, done = false) => ({ task, owner, due, done });
const pause = () => new Promise(resolve => setTimeout(resolve, 5));

test('수정본은 결과 파일을 바꾸지 않고 따로 저장해 회의를 열 때 함께 준다', async t => {
  const dir = folder(t), request = await start(t, dir);
  const record = result();
  await request('/api/meetings/main', record);
  const file = path.join(dir, '회의기록', `회의-${record.id}.json`);
  const bytes = fs.readFileSync(file);
  assert.equal((await request(`/api/meetings/main/${record.id}`)).body.todos, null);
  const saved = await request(`/api/meetings/main/${record.id}/todos`, { finalized: false, items: [item('일정 공유', '박서연', '11월 12일', true), item('발주 변경', '김민수')] });
  assert.equal(saved.status, 200);
  assert.equal(saved.body.todos.version, 1);
  assert.ok(saved.body.todos.savedAt);
  assert.deepEqual(fs.readFileSync(file), bytes);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, '회의기록', `할일-${record.id}.json`), 'utf8')), saved.body.todos);
  assert.deepEqual((await request(`/api/meetings/main/${record.id}`)).body.todos, saved.body.todos);
});

test('할일 파일은 회의 목록에 잘못 잡히지 않는다', async t => {
  const dir = folder(t), request = await start(t, dir);
  const record = result();
  await request('/api/meetings/main', record);
  await request(`/api/meetings/main/${record.id}/todos`, { finalized: false, items: [item('일정 공유'), item('발주 변경', '김민수')] });
  const list = (await request('/api/meetings')).body;
  assert.equal(list.skipped, 0);
  assert.deepEqual(list.meetings.map(meeting => meeting.id), [record.id]);
});

test('잘못된 수정본과 없는 회의, 분석 전 녹음은 저장하지 않는다', async t => {
  const request = await start(t, folder(t));
  const record = result();
  await request('/api/meetings/main', record);
  const route = `/api/meetings/main/${record.id}/todos`;
  const good = item('일정 공유');
  for (const body of [{}, { finalized: false, items: [good] }, { finalized: 'no', items: [good, good] }, { finalized: false, items: [good, { ...good, task: '' }] }, { finalized: false, items: [good, good], extra: 1 }])
    assert.equal((await request(route, body)).status, 400, JSON.stringify(body));
  assert.equal((await request(`/api/meetings/main/${randomUUID()}/todos`, { finalized: false, items: [] })).status, 404);
  const recordingId = randomUUID();
  await request(`/api/recordings/main/${recordingId}`, { title: '녹음', date: '2026-11-09', participants: '', expectedParts: 1 });
  assert.equal((await request(`/api/meetings/main/${recordingId}/todos`, { finalized: false, items: [] })).status, 404);
  assert.equal((await request(route, { finalized: false, items: [good, good] }, false)).status, 401);
});

test('깨진 수정본은 없는 것으로 보고 회의는 그대로 열린다', async t => {
  const dir = folder(t), request = await start(t, dir);
  const record = result();
  await request('/api/meetings/main', record);
  fs.writeFileSync(path.join(dir, '회의기록', `할일-${record.id}.json`), '{깨짐');
  const opened = await request(`/api/meetings/main/${record.id}`);
  assert.equal(opened.status, 200);
  assert.equal(opened.body.todos, null);
  assert.equal(opened.body.todosUnreadable, true);
  assert.equal((await request(`/api/meetings/main/${record.id}/todos`, { finalized: false, items: [item('일정 공유'), item('발주 변경', '김민수')] })).status, 200);
  const kept = fs.readdirSync(path.join(dir, '회의기록')).filter(name => name.startsWith(`할일-${record.id}-읽기실패-`));
  assert.equal(kept.length, 1, '읽지 못한 파일은 덮지 않고 남긴다');
  assert.equal(fs.readFileSync(path.join(dir, '회의기록', kept[0]), 'utf8'), '{깨짐');
  assert.equal((await request('/api/meetings')).body.skipped, 0);
});

test('의견 반영으로 새 결과를 저장하면 문장이 같은 일의 담당자와 체크를 잇는다', async t => {
  const request = await start(t, folder(t));
  const recordingId = randomUUID();
  await request(`/api/recordings/main/${recordingId}`, { title: '출시', date: '2026-11-09', participants: '김민수, 박서연', expectedParts: 1 });
  const first = result({ recordingId });
  await request('/api/meetings/main', first);
  await request(`/api/meetings/main/${first.id}/todos`, { finalized: true, items: [item('일정 공유', '박서연', null, true), item('발주 변경', '김민수')] });
  await pause();
  const second = result({ recordingId, feedback: '다시 정리', minutes: minutes(action('일정 공유'), action('새로 생긴 일')) });
  await request('/api/meetings/main', second);
  const opened = await request(`/api/meetings/main/${second.id}`);
  assert.deepEqual(opened.body.todos.items, [item('일정 공유', '박서연', null, true), item('새로 생긴 일')]);
  assert.equal(opened.body.todos.finalized, true);
});

test('이어 줄 수정본이 없으면 새 결과에 할일 파일을 만들지 않는다', async t => {
  const dir = folder(t), request = await start(t, dir);
  const recordingId = randomUUID();
  await request(`/api/recordings/main/${recordingId}`, { title: '출시', date: '2026-11-09', participants: '', expectedParts: 1 });
  await request('/api/meetings/main', result({ recordingId }));
  await pause();
  const second = result({ recordingId });
  await request('/api/meetings/main', second);
  assert.equal(fs.existsSync(path.join(dir, '회의기록', `할일-${second.id}.json`)), false);
});

test('고른 폴더 사본의 재료에는 사람이 맞춘 할 일이 이름순으로 들어간다', t => {
  const store = createMeetingStore(folder(t), value => value);
  const record = result();
  store.saveMeeting('main', record);
  store.saveTodos('main', record.id, { finalized: true, items: [item('일정 공유', '최유진'), item('발주 변경', '김민수')] });
  assert.deepEqual(store.resultFiles('main', record.id).record.minutes.actions, [action('발주 변경', '김민수'), action('일정 공유', '최유진')]);
});

test('할일 저장에 실패하면 오류를 돌려주고 기존 수정본은 그대로 둔다', t => {
  let broken = false;
  const dir = folder(t);
  const store = createMeetingStore(dir, value => value, { atomicWrite: (file, value) => { if (broken && /할일-/.test(file)) throw new Error('디스크 오류'); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, value); } });
  const record = result();
  store.saveMeeting('main', record);
  const data = { finalized: false, items: [item('일정 공유', '최유진'), item('발주 변경', '김민수')] };
  store.saveTodos('main', record.id, data);
  broken = true;
  assert.throws(() => store.saveTodos('main', record.id, { ...data, finalized: true }), /디스크 오류/);
  assert.equal(store.loadMeeting('main', record.id).todos.finalized, false);
});

test('항목 수가 결과와 다른 수정본은 읽기 실패로 알리고 덮지 않고 남긴다', async t => {
  const dir = folder(t), request = await start(t, dir);
  const record = result();
  await request('/api/meetings/main', record);
  fs.writeFileSync(path.join(dir, '회의기록', `할일-${record.id}.json`), JSON.stringify({ version: 1, finalized: false, items: [item('사람이 고친 문장', '김민수', null, true)], savedAt: '2026-11-09T00:00:00.000Z' }));
  const opened = await request(`/api/meetings/main/${record.id}`);
  assert.equal(opened.body.todos, null);
  assert.equal(opened.body.todosUnreadable, true);
  assert.equal((await request(`/api/meetings/main/${record.id}/todos`, { finalized: false, items: [item('일정 공유'), item('발주 변경', '김민수')] })).status, 200);
  const kept = fs.readdirSync(path.join(dir, '회의기록')).filter(name => name.startsWith(`할일-${record.id}-읽기실패-`));
  assert.equal(kept.length, 1);
  assert.match(fs.readFileSync(path.join(dir, '회의기록', kept[0]), 'utf8'), /사람이 고친 문장/);
});

test('AI 결과에 빈 문장이 있어도 체크와 저장이 막히지 않는다', async t => {
  const request = await start(t, folder(t));
  const record = result({ minutes: minutes(action(''), action('발주 변경')) });
  await request('/api/meetings/main', record);
  assert.equal((await request(`/api/meetings/main/${record.id}/todos`, { finalized: false, items: [item(''), item('발주 변경', null, null, true)] })).status, 200);
  assert.equal((await request(`/api/meetings/main/${record.id}/todos`, { finalized: false, items: [item('', null, null, true), item('발주 변경', '김민수')] })).status, 200);
});

test('의견 반영은 보던 결과의 수정본을 잇고 보던 결과를 모르면 가장 최근 결과를 잇는다', async t => {
  const request = await start(t, folder(t));
  const recordingId = randomUUID();
  await request(`/api/recordings/main/${recordingId}`, { title: '출시', date: '2026-11-09', participants: '', expectedParts: 1 });
  const base = minutes(action('일정 공유'));
  const first = result({ recordingId, minutes: base });
  await request('/api/meetings/main', first);
  await request(`/api/meetings/main/${first.id}/todos`, { finalized: false, items: [item('일정 공유', '첫째 담당')] });
  await pause();
  const second = result({ recordingId, minutes: base });
  await request('/api/meetings/main', second);
  await request(`/api/meetings/main/${second.id}/todos`, { finalized: false, items: [item('일정 공유', '둘째 담당')] });
  await pause();
  const fromFirst = result({ recordingId, minutes: base, sourceResultId: first.id });
  const saved = await request('/api/meetings/main', fromFirst);
  assert.equal(saved.body.todos.items[0].owner, '첫째 담당', '저장 응답에 이어받은 수정본이 온다');
  assert.equal(saved.body.meeting.sourceResultId, undefined, '보던 결과 표시는 기록에 남기지 않는다');
  await pause();
  const fromLatest = result({ recordingId, minutes: base });
  assert.equal((await request('/api/meetings/main', fromLatest)).body.todos.items[0].owner, '첫째 담당');
  await pause();
  const unknown = result({ recordingId, minutes: base, sourceResultId: randomUUID() });
  assert.equal((await request('/api/meetings/main', unknown)).body.todos.items[0].owner, '첫째 담당', '같은 회의에 없는 결과는 무시한다');
});

test('남은 일을 모으던 요청과 한 건만 끝내던 요청은 없어졌다', async t => {
  const request = await start(t, folder(t));
  const record = result();
  await request('/api/meetings/main', record);
  assert.equal((await request('/api/meetings/open-todos')).status, 404);
  assert.equal((await request(`/api/meetings/main/${record.id}/todos/1`, { done: true })).status, 404);
  assert.equal((await request(`/api/meetings/main/${record.id}`)).body.todos, null, '거절한 요청은 수정본을 만들지 않는다');
});

test('지난 회의 목록은 결과가 여러 개인 회의도 한 줄로 주고 회의 묶음 열쇠를 함께 준다', async t => {
  const request = await start(t, folder(t));
  const recordingId = randomUUID();
  await request(`/api/recordings/main/${recordingId}`, { title: '녹음 회의', date: '2026-11-09', participants: '', expectedParts: 1 });
  await request('/api/meetings/main', result({ recordingId }));
  const first = result({ date: '2026-11-08' });
  await request('/api/meetings/main', first);
  await pause();
  const second = result({ date: '2026-11-08', meetingId: first.id });
  await request('/api/meetings/main', second);
  const list = (await request('/api/meetings')).body.meetings;
  assert.deepEqual(list.map(meeting => meeting.groupId), [recordingId, first.id]);
  assert.equal(list[1].id, second.id, '녹음 없이 만든 회의는 최신 결과 id와 처음 결과 id(묶음 열쇠)가 다르다');
});
