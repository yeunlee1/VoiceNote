// 회의마다 고른 나와 설정의 내 이름을 저장하고, 지난 회의 목록에 내가 안 끝낸 일의 수를 주는지 검증한다.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { createMeetingServer } = require('./서버.cjs');
const { createMeetingStore } = require('./회의보관.cjs');
const { legacyMeeting } = require('../tests/옛기록.cjs');

async function start(t, dataDir) {
  const meeting = createMeetingServer({ dataDir, settingsFile: path.join(dataDir, 'AI설정.json') });
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'meeting-me-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}
const action = (task, owner = null, due = null) => ({ task, owner, due });
const minutes = (...actions) => ({ overview: '준비 회의', topics: [], decisions: [], actions, openQuestions: [] });
const result = (extra = {}) => ({ id: randomUUID(), title: '출시 회의', date: '2026-11-09', participants: '김민수, 박서연', transcript: '전사', minutes: minutes(action('일정 공유'), action('발주 변경', '김민수')), ...extra });
const item = (task, owner = null, due = null, done = false) => ({ task, owner, due, done });
const pause = () => new Promise(resolve => setTimeout(resolve, 5));
const REJECTED = '이 회의의 참석자나 담당자 이름 가운데서 골라 주세요.';

test('고른 나는 회의마다 파일 하나로 저장하고 회의를 열 때 함께 준다', async t => {
  const dir = folder(t), request = await start(t, dir);
  const record = result({ participants: '박서연 대리, 김민수', minutes: minutes(action('일정 공유', '박서연 대리'), action('발주 변경', '김민수')) });
  await request('/api/meetings/main', record);
  assert.equal((await request(`/api/meetings/main/${record.id}`)).body.me, null);
  const saved = await request(`/api/meetings/main/${record.id}/me`, { name: ' 박서연  대리 ' });
  assert.deepEqual([saved.status, saved.body.me], [200, '박서연 대리']);
  const file = JSON.parse(fs.readFileSync(path.join(dir, '회의기록', `나-${record.id}.json`), 'utf8'));
  assert.deepEqual([file.version, file.name, typeof file.savedAt], [1, '박서연 대리', 'string']);
  assert.equal((await request(`/api/meetings/main/${record.id}`)).body.me, '박서연 대리');
  const list = (await request('/api/meetings')).body;
  assert.deepEqual([list.skipped, list.meetings.length], [0, 1], '나 파일은 회의 목록에 잡히지 않는다');
});

test('지난 회의 목록은 회의마다 최신 결과에서 내가 안 끝낸 일의 수를 준다', async t => {
  const request = await start(t, folder(t));
  await request('/api/settings', { myName: '박서연' });
  const two = result({ date: '2026-11-09', participants: '박서연, 김민수', minutes: minutes(action('가', '박서연'), action('나', '박서연'), action('다', '김민수')) });
  const done = result({ date: '2026-11-08', participants: '박서연', minutes: minutes(action('가', '박서연')) });
  const unknown = result({ date: '2026-11-07', participants: '이도현', minutes: minutes(action('가', '이도현')) });
  const picked = result({ date: '2026-11-06', participants: '박서연 대리, 김민수', minutes: minutes(action('가', '박서연 대리'), action('나', '김민수')) });
  for (const record of [two, done, unknown, picked]) await request('/api/meetings/main', record);
  await request(`/api/meetings/main/${done.id}/todos`, { finalized: false, items: [item('가', '박서연', null, true)] });
  await request(`/api/meetings/main/${picked.id}/me`, { name: '김민수' });
  const counts = async () => Object.fromEntries((await request('/api/meetings')).body.meetings.map(meeting => [meeting.id, meeting.mineOpen]));
  assert.deepEqual(await counts(), { [two.id]: 2, [done.id]: undefined, [unknown.id]: undefined, [picked.id]: 1 });
  await request(`/api/meetings/main/${two.id}/todos`, { finalized: false, items: [item('가', '박서연', null, true), item('나', '박서연'), item('다', '김민수')] });
  assert.equal((await counts())[two.id], 1, '체크하면 수가 줄어든다');
});

test('설정의 내 이름은 저장되고 다른 설정을 바꾸거나 설정 파일을 불러와도 남으며 내보내기 파일에는 없다', async t => {
  const dir = folder(t), request = await start(t, dir);
  assert.equal((await request('/api/settings')).body.settings.myName, '');
  assert.equal((await request('/api/settings', { myName: '  박서연 대리 ' })).body.settings.myName, '박서연 대리');
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'AI설정.json'), 'utf8')).myName, '박서연 대리');
  assert.equal((await request('/api/settings', { defaultOutputFormat: 'tasks' })).body.settings.myName, '박서연 대리');
  const exported = (await request('/api/settings/export')).body.file;
  assert.equal(JSON.stringify(exported).includes('박서연'), false);
  const imported = await request('/api/settings/import', { file: JSON.stringify({ ...exported, defaultOutputFormat: 'summary' }) });
  assert.deepEqual([imported.status, imported.body.settings.myName, imported.body.settings.defaultOutputFormat], [200, '박서연 대리', 'summary']);
  assert.equal((await (await start(t, dir))('/api/settings')).body.settings.myName, '박서연 대리', '다시 켜도 남는다');
  for (const bad of [{ myName: 3 }, { myName: 'x'.repeat(201) }]) assert.equal((await request('/api/settings', bad)).status, 400);
  assert.equal((await request('/api/settings', { myName: '' })).body.settings.myName, '');
});

test('나는 결과가 아니라 회의에 붙어 의견 반영 뒤 새 결과에서도 그대로다', async t => {
  const dir = folder(t), request = await start(t, dir);
  const recordingId = randomUUID();
  await request(`/api/recordings/main/${recordingId}`, { title: '출시', date: '2026-11-09', participants: '김민수, 박서연', expectedParts: 1 });
  const first = result({ recordingId });
  await request('/api/meetings/main', first);
  assert.equal((await request(`/api/meetings/main/${first.id}/me`, { name: '김민수' })).body.me, '김민수');
  assert.ok(fs.existsSync(path.join(dir, '회의기록', `나-${recordingId}.json`)), '나 파일은 회의 묶음 열쇠(녹음 id)로 이름을 붙인다');
  await pause();
  const second = result({ recordingId, feedback: '다시 정리' });
  await request('/api/meetings/main', second);
  assert.equal((await request(`/api/meetings/main/${second.id}`)).body.me, '김민수');
});

test('목록의 수는 옛 결과가 아니라 최신 결과로 센다', async t => {
  const request = await start(t, folder(t));
  await request('/api/settings', { myName: '김민수' });
  const recordingId = randomUUID();
  await request(`/api/recordings/main/${recordingId}`, { title: '출시', date: '2026-11-09', participants: '김민수, 박서연', expectedParts: 1 });
  await request('/api/meetings/main', result({ recordingId }));
  const mineOpen = async () => (await request('/api/meetings')).body.meetings[0].mineOpen;
  assert.equal(await mineOpen(), 1);
  await pause();
  await request('/api/meetings/main', result({ recordingId, minutes: minutes(action('일정 공유', '박서연')) }));
  assert.equal(await mineOpen(), undefined);
});

test('후보에 없는 이름과 잘못된 요청은 저장하지 않는다', async t => {
  const dir = folder(t), request = await start(t, dir);
  const record = result();
  await request('/api/meetings/main', record);
  const route = `/api/meetings/main/${record.id}/me`;
  for (const body of [{ name: '이도현' }, { name: '' }, { name: 3 }, {}, { name: '김민수', extra: 1 }, { name: 'x'.repeat(201) }])
    assert.equal((await request(route, body)).status, 400, JSON.stringify(body).slice(0, 60));
  assert.equal((await request(route, { name: '이도현' })).body.error.message, REJECTED);
  assert.equal(fs.readdirSync(path.join(dir, '회의기록')).some(name => name.startsWith('나-')), false, '거절한 요청은 나 파일을 만들지 않는다');
  assert.equal((await request(`/api/meetings/main/${randomUUID()}/me`, { name: '김민수' })).status, 404);
  const recordingId = randomUUID();
  await request(`/api/recordings/main/${recordingId}`, { title: '녹음', date: '2026-11-09', participants: '김민수', expectedParts: 1 });
  assert.equal((await request(`/api/meetings/main/${recordingId}/me`, { name: '김민수' })).status, 404, '분석 전 녹음에는 저장하지 않는다');
  assert.equal((await request(route, { name: '김민수' }, false)).status, 401);
});

test('참석자가 바뀐 옛 결과에서는 그 결과의 후보만 고를 수 있다', async t => {
  const request = await start(t, folder(t));
  const recordingId = randomUUID();
  await request(`/api/recordings/main/${recordingId}`, { title: '출시', date: '2026-11-09', participants: '김민수, 박서연', expectedParts: 1 });
  const first = result({ recordingId, participants: '김민수, 박서연', minutes: minutes(action('가', '박서연')) });
  await request('/api/meetings/main', first);
  await pause();
  const second = result({ recordingId, participants: '김민수, 이도현', minutes: minutes(action('가', '이도현')) });
  await request('/api/meetings/main', second);
  assert.equal((await request(`/api/meetings/main/${first.id}/me`, { name: '이도현' })).status, 400);
  assert.equal((await request(`/api/meetings/main/${first.id}/me`, { name: '박서연' })).body.me, '박서연');
  assert.equal((await request(`/api/meetings/main/${second.id}`)).body.me, '박서연', '선택은 회의에 하나다');
  assert.equal((await request('/api/meetings')).body.meetings[0].mineOpen, undefined, '최신 결과의 후보에 없는 선택은 목록의 수에 쓰이지 않는다');
});

test('참석자를 안 적은 회의는 사람이 고친 담당자 이름 가운데서만 고를 수 있다', async t => {
  const request = await start(t, folder(t));
  const record = result({ participants: '', minutes: minutes(action('가', '박서연'), action('나')) });
  await request('/api/meetings/main', record);
  const route = `/api/meetings/main/${record.id}/me`;
  assert.equal((await request(route, { name: '박서연' })).body.me, '박서연');
  await request(`/api/meetings/main/${record.id}/todos`, { finalized: false, items: [item('가', '최유진'), item('나')] });
  assert.equal((await request(route, { name: '박서연' })).status, 400, '사람이 담당자를 고치면 고친 이름이 후보다');
  assert.equal((await request(route, { name: '최유진' })).body.me, '최유진');
});

test('선택을 지우면 파일이 없어지고 다시 지워도 성공한다', async t => {
  const dir = folder(t), request = await start(t, dir);
  const record = result();
  await request('/api/meetings/main', record);
  const route = `/api/meetings/main/${record.id}/me`, file = path.join(dir, '회의기록', `나-${record.id}.json`);
  await request(route, { name: '김민수' });
  assert.ok(fs.existsSync(file));
  for (let round = 0; round < 2; round++) {
    const cleared = await request(route, { name: null });
    assert.deepEqual([cleared.status, cleared.body.me], [200, null]);
    assert.equal(fs.existsSync(file), false);
  }
  assert.equal((await request(`/api/meetings/main/${record.id}`)).body.me, null);
});

test('깨진 나 파일은 고른 적이 없는 것으로 보고 지우지 않으며 회의는 목록에 남는다', async t => {
  const dir = folder(t), request = await start(t, dir);
  await request('/api/settings', { myName: '김민수' });
  const record = result();
  await request('/api/meetings/main', record);
  const file = path.join(dir, '회의기록', `나-${record.id}.json`);
  for (const broken of ['{깨짐', JSON.stringify({ version: 2, name: '박서연' }), JSON.stringify({ version: 1, name: 3 })]) {
    fs.writeFileSync(file, broken);
    assert.equal((await request(`/api/meetings/main/${record.id}`)).body.me, null, broken);
    const list = (await request('/api/meetings')).body;
    assert.deepEqual([list.skipped, list.meetings.length, list.meetings[0].mineOpen], [0, 1, 1], '회의는 목록에 남고 설정의 내 이름으로 다시 센다');
    assert.equal(fs.readFileSync(file, 'utf8'), broken, '읽지 못한 파일을 지우거나 고치지 않는다');
  }
});

test('나 저장에 실패하면 오류를 돌려주고 앞선 선택은 그대로다', t => {
  let broken = false;
  const store = createMeetingStore(folder(t), value => value, { atomicWrite: (file, value) => { if (broken && /나-/.test(file)) throw new Error('디스크 오류'); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, value); } });
  const record = result();
  store.saveMeeting('main', record);
  assert.equal(store.saveMe('main', record.id, '김민수'), '김민수');
  broken = true;
  assert.throws(() => store.saveMe('main', record.id, '박서연'), /디스크 오류/);
  assert.equal(store.loadMeeting('main', record.id).me, '김민수');
});

test('옛 프로젝트 보관함의 회의도 새 회의와 똑같이 나를 저장하고 수를 센다', async t => {
  const dir = folder(t), old = legacyMeeting(dir, 1), request = await start(t, dir);
  await request('/api/settings', { myName: '박서연' });
  const again = result({ recordingId: old.recordingId, date: '2026-09-01', participants: '김민수, 박서연', minutes: minutes(action('가', '박서연')) });
  assert.equal((await request('/api/meetings/p1', again)).status, 200);
  assert.equal((await request(`/api/meetings/p1/${again.id}/me`, { name: '박서연' })).body.me, '박서연');
  assert.ok(fs.existsSync(path.join(dir, '프로젝트-01', `나-${old.recordingId}.json`)));
  const row = (await request('/api/meetings')).body.meetings.find(meeting => meeting.location === 'p1');
  assert.deepEqual([row.id, row.mineOpen], [again.id, 1]);
});
