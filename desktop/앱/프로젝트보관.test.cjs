// 프로젝트 프리셋과 회의 기록의 재실행 보존 및 프로젝트 분리를 검증한다.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { createMeetingServer } = require('./서버.cjs');

async function start(t, dataDir) {
  const meeting = createMeetingServer({ dataDir });
  await new Promise(resolve => meeting.server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => meeting.server.close(resolve)));
  const url = `http://127.0.0.1:${meeting.server.address().port}`;
  const request = async (route, body, auth = true) => {
    const response = await fetch(url + route, { method: body === undefined ? 'GET' : 'POST',
      headers: { Origin: url, 'Content-Type': 'application/json', ...(auth ? { 'X-Meeting-Token': meeting.token } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
  };
  request.remove = async (route, body) => {
    const response = await fetch(url + route, { method: 'DELETE',
      headers: { Origin: url, 'Content-Type': 'application/json', 'X-Meeting-Token': meeting.token }, body: JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
  };
  request.audio = async (route, body) => {
    const response = await fetch(url + route, { method: body ? 'POST' : 'GET',
      headers: { Origin: url, 'X-Meeting-Token': meeting.token, 'Content-Type': 'audio/webm' }, body });
    return { status: response.status, bytes: Buffer.from(await response.arrayBuffer()) };
  };
  return request;
}
// 새 설치는 빈 프로젝트로 시작하므로 회의를 저장하는 시험은 1번 프로젝트를 먼저 등록한다.
async function register(request, slot = 1) {
  assert.equal((await request(`/api/projects/${slot}`, { name: '시험 프로젝트', title: '회의', context: '', revision: 0 })).status, 200);
}
function folder(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'meeting-presets-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}
function document() {
  return { id: randomUUID(), title: '표준화 준비', date: '2026-09-30', participants: '시험 참석자', context: '네 문서 표준화',
    transcript: '담당자는 다음에 정합니다.', minutes: { overview: '준비 회의', topics: [], decisions: [], actions: [{ task: '항목 확인', owner: null, due: null }], openQuestions: ['담당자 미정'] } };
}

test('새 설치는 빈 프리셋 3개로 시작하고 수정값을 재실행 후 불러온다', async t => {
  const dir = folder(t);
  const request = await start(t, dir);
  const initial = await request('/api/projects');
  assert.equal(initial.status, 200);
  assert.equal(initial.body.projects.length, 3);
  for (const project of initial.body.projects)
    assert.deepEqual([project.name, project.title, project.context, project.outputFormat, project.revision], ['', '', '', 'meeting', 0]);
  assert.deepEqual(fs.readdirSync(dir), []);
  const preset = { name: '다른 프로젝트', title: '주간 회의', context: '품질 검토', revision: 0 };
  assert.equal((await request('/api/projects/2', preset)).status, 200);
  const restarted = await start(t, dir);
  const loaded = (await restarted('/api/projects')).body.projects[1];
  assert.equal(loaded.name, preset.name);
  assert.equal(loaded.context, preset.context);
  assert.equal(loaded.revision, 1);
  assert.equal((await restarted('/api/projects/2', preset)).status, 409);
});

test('프로젝트는 3개까지만 쓰고 이전 버전의 4~9번 폴더는 건드리지 않는다', async t => {
  const dir = folder(t);
  const old = path.join(dir, '프로젝트-05');
  fs.mkdirSync(old);
  fs.writeFileSync(path.join(old, '설정.json'), JSON.stringify({ slot: 5, name: '이전 프로젝트', title: '', context: '', revision: 1 }));
  const request = await start(t, dir);
  assert.deepEqual((await request('/api/projects')).body.projects.map(project => project.slot), [1, 2, 3]);
  assert.equal((await request('/api/projects/4', { name: '넷째', title: '회의', context: '', revision: 0 })).status, 404);
  assert.equal((await request('/api/projects/5/meetings')).status, 404);
  assert.equal(fs.existsSync(path.join(dir, '프로젝트-04')), false);
  assert.match(fs.readFileSync(path.join(old, '설정.json'), 'utf8'), /이전 프로젝트/);
});

test('회의 기록이 없는 프로젝트만 삭제하고 기록이 있으면 막는다', async t => {
  const dir = folder(t);
  const request = await start(t, dir);
  await register(request, 1);
  await register(request, 2);
  assert.equal((await request.remove('/api/projects/2', { revision: 0 })).status, 409);
  const removed = await request.remove('/api/projects/2', { revision: 1 });
  assert.equal(removed.status, 200);
  assert.deepEqual(removed.body.projects.map(project => project.name), ['시험 프로젝트', '', '']);
  assert.equal(fs.existsSync(path.join(dir, '프로젝트-02', '설정.json')), false);
  assert.equal((await request.remove('/api/projects/2', { revision: 0 })).status, 400);
  assert.equal((await request('/api/projects/1/meetings', document())).status, 200);
  const blocked = await request.remove('/api/projects/1', { revision: 1 });
  assert.equal(blocked.status, 409);
  assert.match(blocked.body.error.message, /회의 기록/);
  assert.equal((await request('/api/projects')).body.projects[0].name, '시험 프로젝트');
});

test('회의 원문과 결과는 프로젝트별로 보존되고 재저장으로 덮어쓰지 않는다', async t => {
  const dir = folder(t);
  const request = await start(t, dir);
  await register(request);
  const record = document();
  const saved = await request('/api/projects/1/meetings', record);
  assert.equal(saved.status, 200);
  assert.equal((await request('/api/projects/1/meetings', record)).status, 200);
  assert.equal((await request('/api/projects/1/meetings')).body.meetings.length, 1);
  assert.equal((await request('/api/projects/2/meetings')).body.meetings.length, 0);
  const restarted = await start(t, dir);
  const restored = await restarted(`/api/projects/1/meetings/${record.id}`);
  assert.equal(restored.status, 200);
  assert.equal(restored.body.meeting.transcript, record.transcript);
  assert.deepEqual(restored.body.meeting.minutes, record.minutes);
  const shared = fs.readFileSync(path.join(dir, '프로젝트-01', `회의-${record.id}.md`), 'utf8');
  assert.doesNotMatch(shared, /전사 원문|사전 참고 정보|담당자는 다음에 정합니다\.|네 문서 표준화/);
  assert.match(shared, /준비 회의/);
  const artifacts = restored.body.meeting.artifacts;
  assert.equal(fs.readFileSync(path.join(dir, '프로젝트-01', artifacts.transcript), 'utf8'), record.transcript);
  assert.doesNotMatch(fs.readFileSync(path.join(dir, '프로젝트-01', artifacts.summary), 'utf8'), /담당자는 다음에 정합니다\./);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, '프로젝트-01', artifacts.response), 'utf8')), record.minutes);
  assert.equal((await request(`/api/projects/2/meetings/${record.id}`)).status, 404);
  assert.equal((await request('/api/projects/1/meetings', { ...record, title: '덮어쓰기' })).status, 409);
});

test('프리셋과 날짜마다 차수를 매기고 같은 녹음 재분석은 최신 결과로 연다', async t => {
  const dir = folder(t), request = await start(t, dir);
  await register(request);
  const first = document(), second = document(), tomorrow = { ...document(), date: '2026-10-01' };
  const draft = await request(`/api/projects/1/recordings/${first.id}`, { ...first, expectedParts: 1 });
  assert.equal(draft.body.recording.dailySequence, 1);
  const saved = await request('/api/projects/1/meetings', { ...first, id: randomUUID(), recordingId: first.id });
  const later = await request('/api/projects/1/meetings', second);
  const nextDay = await request('/api/projects/1/meetings', tomorrow);
  assert.equal(saved.body.meeting.dailySequence, 1);
  assert.equal(later.body.meeting.dailySequence, 2);
  assert.equal(nextDay.body.meeting.dailySequence, 1);
  const retry = await request('/api/projects/1/meetings', { ...first, id: randomUUID(), recordingId: first.id, title: 'AI가 정한 제목' });
  assert.equal(retry.body.meeting.dailySequence, 1);
  const history = (await request('/api/projects/1/meetings')).body.meetings;
  assert.equal(history.length, 3);
  assert.ok(history.some(record => record.title === 'AI가 정한 제목' && record.dailySequence === 1));
  await request('/api/projects/2', { name: '별도 프로젝트', title: '회의', context: '', revision: 0 });
  assert.equal((await request('/api/projects/2/meetings', document())).body.meeting.dailySequence, 1);
  assert.equal(fs.existsSync(path.join(dir, '프로젝트-01', `회의-${saved.body.meeting.id}.json`)), true);
});

test('잘못된 슬롯과 미등록 프로젝트 및 인증 없는 저장을 거절한다', async t => {
  const request = await start(t, folder(t));
  assert.equal((await request('/api/projects/0', { name: '잘못된 슬롯' })).status, 404);
  assert.equal((await request('/api/projects/10', { name: '잘못된 슬롯' })).status, 404);
  assert.equal((await request('/api/projects/2/meetings', document())).status, 400);
  assert.equal((await request('/api/projects/1/meetings', document(), false)).status, 401);
  assert.equal((await request('/api/projects/1/meetings', { ...document(), id: '../outside' })).status, 400);
});

test('손상된 설정 파일은 빈 설정으로 덮어쓰지 않는다', async t => {
  const dir = folder(t);
  const request = await start(t, dir);
  await request('/api/projects/2', { name: '보존 대상', title: '회의', context: '', revision: 0 });
  const file = path.join(dir, '프로젝트-02', '설정.json');
  fs.writeFileSync(file, '{broken');
  assert.equal((await request('/api/projects')).status, 503);
  assert.equal((await request('/api/projects/2', { name: '덮어쓰기', title: '회의', context: '', revision: 1 })).status, 503);
  assert.equal(fs.readFileSync(file, 'utf8'), '{broken');
});

test('분석 전 원음이 저장되고 재실행 후 복원되며 다른 프로젝트에서는 접근할 수 없다', async t => {
  const dir = folder(t);
  const request = await start(t, dir);
  await register(request);
  const record = document();
  const meta = { ...record, expectedParts: 2 };
  assert.equal((await request(`/api/projects/1/recordings/${record.id}`, meta)).status, 200);
  const bytes = Buffer.from('test microphone bytes');
  const route = `/api/projects/1/recordings/${record.id}/audio/1`;
  assert.equal((await request.audio(route, bytes)).status, 200);
  assert.equal((await request.audio(route, bytes)).status, 200);
  assert.equal((await request.audio(route, Buffer.from('different'))).status, 409);
  const restarted = await start(t, dir);
  const restored = await restarted(`/api/projects/1/meetings/${record.id}`);
  assert.equal(restored.status, 200);
  assert.equal(restored.body.meeting.minutes, null);
  assert.equal(restored.body.meeting.audio.length, 1);
  assert.equal(restored.body.meeting.expectedParts, 2);
  assert.deepEqual((await restarted.audio(route)).bytes, bytes);
  assert.equal((await restarted.audio(route.replace('/projects/1/', '/projects/2/'))).status, 404);
  assert.equal((await restarted('/api/projects/1/meetings')).body.meetings.length, 1);
});
test('요약 전 전사를 저장하면 재실행 후 재전사 없이 복원하고 원음을 보존한다', async t => {
  const dir = folder(t);
  const request = await start(t, dir);
  await register(request);
  const record = document();
  const route = `/api/projects/1/recordings/${record.id}`;
  await request(route, { ...record, expectedParts: 1 });
  assert.equal((await request(route + '/transcript', { text: '가'.repeat(14977) })).status, 409);
  const bytes = Buffer.from('preserved original recording');
  await request.audio(route + '/audio/1', bytes);
  assert.equal((await request(route + '/transcript', { text: '가'.repeat(14977) })).status, 200);
  const restarted = await start(t, dir);
  const result = await restarted(`/api/projects/1/meetings/${record.id}`);
  assert.equal(result.body.meeting.transcript.length, 14977);
  assert.equal(result.body.meeting.minutes, null);
  assert.deepEqual((await restarted.audio(route + '/audio/1')).bytes, bytes);
  assert.equal(fs.readFileSync(path.join(dir, '프로젝트-01', `전사-${record.id}.txt`), 'utf8').length, 14977);
  assert.equal((await restarted(route.replace('/projects/1/', '/projects/2/') + '/transcript', { text: '다른 프로젝트' })).status, 404);
  assert.equal((await restarted(route + '/transcript', { text: '인증 없음' }, false)).status, 401);
});
