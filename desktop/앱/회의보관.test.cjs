// 기본 보관함과 옛 프로젝트 보관함을 합친 회의 목록·열기·저장·평가와, 보관함마다 기록을 나눠 지키는지를 검증한다.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { createMeetingServer } = require('./서버.cjs');
const { legacyMeeting } = require('../tests/옛기록.cjs');

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
  request.audio = async (route, body) => {
    const response = await fetch(url + route, { method: body ? 'POST' : 'GET',
      headers: { Origin: url, 'X-Meeting-Token': meeting.token, 'Content-Type': 'audio/webm' }, body });
    return { status: response.status, bytes: Buffer.from(await response.arrayBuffer()) };
  };
  return request;
}
function folder(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'meeting-store-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}
const minutes = { overview: '준비 회의', topics: [], decisions: [], actions: [{ task: '항목 확인', owner: null, due: null }], openQuestions: ['담당자 미정'] };
const result = (extra = {}) => ({ id: randomUUID(), title: '표준화 준비', date: '2026-09-30', participants: '시험 참석자', transcript: '담당자는 다음에 정합니다.', minutes, ...extra });
const recordingMeta = (extra = {}) => ({ title: '표준화 준비', date: '2026-09-30', participants: '시험 참석자', expectedParts: 1, ...extra });
const pause = () => new Promise(resolve => setTimeout(resolve, 5));

test('새 회의는 회의기록 폴더에 location main으로 저장한다', async t => {
  const dir = folder(t), request = await start(t, dir);
  const recordingId = randomUUID();
  const recording = await request(`/api/recordings/main/${recordingId}`, recordingMeta());
  assert.equal(recording.status, 200);
  assert.equal(recording.body.recording.location, 'main');
  assert.equal('slot' in recording.body.recording, false);
  assert.equal('projectName' in recording.body.recording, false);
  const record = result({ recordingId });
  const saved = await request('/api/meetings/main', record);
  assert.equal(saved.status, 200);
  assert.equal(saved.body.meeting.location, 'main');
  assert.equal('slot' in saved.body.meeting, false);
  assert.equal('projectName' in saved.body.meeting, false);
  const store = path.join(dir, '회의기록');
  assert.equal(fs.existsSync(path.join(store, `회의-${record.id}.json`)), true);
  const shared = fs.readFileSync(path.join(store, `회의-${record.id}.md`), 'utf8');
  assert.doesNotMatch(shared, /프로젝트:|담당자는 다음에 정합니다\./);
  assert.equal((await request('/api/meetings/main', record)).status, 200, '같은 내용은 다시 저장해도 된다');
  assert.equal((await request('/api/meetings/main', { ...record, title: '덮어쓰기' })).status, 409);
  const restarted = await start(t, dir);
  const restored = await restarted(`/api/meetings/main/${record.id}`);
  assert.equal(restored.status, 200);
  assert.equal(restored.body.meeting.transcript, record.transcript);
  assert.deepEqual(restored.body.meeting.minutes, record.minutes);
  const artifacts = restored.body.meeting.artifacts;
  assert.equal(fs.readFileSync(path.join(store, artifacts.transcript), 'utf8'), record.transcript);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(store, artifacts.response), 'utf8')), record.minutes);
  assert.equal((await restarted(`/api/meetings/p2/${record.id}`)).status, 404);
  assert.equal(fs.existsSync(path.join(dir, '프로젝트-01')), false, '옛 폴더를 새로 만들지 않는다');
});

test('옛 프로젝트-01~03 기록과 새 회의를 한 목록에 날짜 최신순으로 보여 주고 옛 기록에 projectName을 붙인다', async t => {
  const dir = folder(t);
  const first = legacyMeeting(dir, 1, { projectName: '홈페이지 개편', date: '2026-09-01' });
  const third = legacyMeeting(dir, 3, { projectName: '업무 점검', title: '점검 회의', date: '2026-10-05' });
  legacyMeeting(dir, 4, { projectName: '옛 4번', date: '2026-12-01' });
  const request = await start(t, dir);
  const fresh = result({ date: '2026-09-15', title: '새 회의' });
  assert.equal((await request('/api/meetings/main', fresh)).status, 200);
  const list = await request('/api/meetings');
  assert.equal(list.status, 200);
  assert.equal(list.body.skipped, 0);
  assert.deepEqual(list.body.meetings.map(item => [item.location, item.id, item.date]),
    [['p3', third.id, '2026-10-05'], ['main', fresh.id, '2026-09-15'], ['p1', first.id, '2026-09-01']]);
  assert.equal(list.body.meetings[0].projectName, '업무 점검');
  assert.equal(list.body.meetings[2].projectName, '홈페이지 개편');
  assert.equal(list.body.meetings[2].recordingId, first.recordingId);
  assert.equal('projectName' in list.body.meetings[1], false);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, '프로젝트-01', '설정.json'), 'utf8')).name, '홈페이지 개편', '옛 프리셋 파일은 지우지 않는다');
});

test('녹음마다 최신 결과 하나만 목록에 보이고 loadMeeting은 결과 버전을 저장 시각 순으로 준다', async t => {
  const request = await start(t, folder(t));
  const recordingId = randomUUID();
  await request(`/api/recordings/main/${recordingId}`, recordingMeta());
  const first = result({ recordingId });
  assert.equal((await request('/api/meetings/main', first)).status, 200);
  await pause();
  const second = result({ recordingId, title: '다시 분석한 제목', outputFormat: 'summary' });
  assert.equal((await request('/api/meetings/main', second)).status, 200);
  const list = (await request('/api/meetings')).body.meetings;
  assert.deepEqual(list.map(item => [item.id, item.recordingId, item.analyzed]), [[second.id, recordingId, true]]);
  for (const id of [first.id, second.id]) {
    const opened = (await request(`/api/meetings/main/${id}`)).body;
    assert.equal(opened.meeting.id, id);
    assert.deepEqual(opened.versions.map(version => [version.id, version.outputFormat, version.refined]), [[first.id, 'meeting', false], [second.id, 'summary', false]]);
    assert.ok(opened.versions[0].savedAt < opened.versions[1].savedAt);
  }
});

test('깨진 JSON·남은 .tmp·다른 파일이 섞인 옛 폴더에서도 나머지를 보여 주고 skipped를 센다', async t => {
  const dir = folder(t);
  const good = legacyMeeting(dir, 1);
  fs.writeFileSync(path.join(good.dir, `회의-${randomUUID()}.json`), '{broken');
  fs.writeFileSync(path.join(good.dir, `회의-${randomUUID()}.json`), JSON.stringify({ ...good.record, id: 'other' }));
  fs.writeFileSync(path.join(good.dir, `녹음-${randomUUID()}.json.${randomUUID()}.tmp`), '{}');
  fs.writeFileSync(path.join(good.dir, '메모.txt'), '사용자 메모');
  fs.writeFileSync(path.join(good.dir, '회의-이름만.json'), '{}');
  const request = await start(t, dir);
  const fresh = result();
  assert.equal((await request('/api/meetings/main', fresh)).status, 200);
  fs.writeFileSync(path.join(dir, '회의기록', `녹음-${randomUUID()}.json`), '');
  const list = await request('/api/meetings');
  assert.equal(list.status, 200);
  assert.deepEqual(list.body.meetings.map(item => item.id).sort(), [good.id, fresh.id].sort());
  assert.equal(list.body.skipped, 3);
  const later = await request('/api/meetings/main', result({ date: fresh.date }));
  assert.equal(later.status, 200, '깨진 파일이 있어도 새 회의를 저장한다');
  assert.equal(later.body.meeting.dailySequence, 2);
});

test('녹음 파일만 깨지고 결과는 멀쩡한 옛 회의도 목록에 보이고 원음 없이 열린다', async t => {
  const dir = folder(t);
  const old = legacyMeeting(dir, 1);
  fs.writeFileSync(path.join(old.dir, `녹음-${old.recordingId}.json`), '{broken');
  const request = await start(t, dir);
  const list = await request('/api/meetings');
  assert.equal(list.status, 200);
  assert.deepEqual(list.body.meetings.map(item => item.id), [old.id], '결과가 멀쩡하면 목록에서 빼지 않는다');
  assert.equal(list.body.skipped, 1, '깨진 녹음 파일만 읽지 못한 기록으로 센다');
  const opened = await request(`/api/meetings/p1/${old.id}`);
  assert.equal(opened.status, 200);
  assert.equal(opened.body.meeting.minutes.overview, old.record.minutes.overview);
  assert.equal(opened.body.meeting.audio, undefined, '읽지 못한 원음 목록은 비워 둔다');
});

test('옛 보관함 회의를 다시 분석한 결과는 같은 옛 폴더에 location p1과 옛 projectName으로 저장한다', async t => {
  const dir = folder(t);
  const old = legacyMeeting(dir, 1, { projectName: '홈페이지 개편', dailySequence: 2 });
  const request = await start(t, dir);
  assert.equal((await request(`/api/recordings/p1/${old.recordingId}/transcript`, { text: '다시 전사한 발언' })).status, 200);
  assert.equal(fs.readFileSync(path.join(old.dir, `전사-${old.recordingId}.txt`), 'utf8'), '다시 전사한 발언');
  const again = result({ recordingId: old.recordingId, title: 'AI가 정한 제목', date: old.record.date });
  const saved = await request('/api/meetings/p1', again);
  assert.equal(saved.status, 200);
  assert.equal(saved.body.meeting.location, 'p1');
  assert.equal(saved.body.meeting.projectName, '홈페이지 개편');
  assert.equal('slot' in saved.body.meeting, false);
  assert.equal(saved.body.meeting.dailySequence, 2);
  assert.equal(fs.existsSync(path.join(old.dir, `회의-${again.id}.json`)), true);
  assert.match(fs.readFileSync(path.join(old.dir, `회의-${again.id}.md`), 'utf8'), /^프로젝트: 홈페이지 개편$/m);
  assert.equal(fs.existsSync(path.join(dir, '회의기록')), false);
  const list = (await request('/api/meetings')).body.meetings;
  assert.deepEqual(list.map(item => [item.location, item.id, item.projectName]), [['p1', again.id, '홈페이지 개편']]);
  assert.equal((await request('/api/meetings/main', result({ recordingId: old.recordingId }))).status, 404, '다른 보관함의 녹음으로는 저장하지 않는다');
});

test('녹음 없는 옛 회의를 다시 분석한 결과는 같은 회의로 묶이고 옛 projectName을 옮긴다', async t => {
  const dir = folder(t);
  const old = legacyMeeting(dir, 1, { projectName: '홈페이지 개편', dailySequence: 3, recording: false });
  const request = await start(t, dir);
  const again = result({ meetingId: old.id, title: '다시 정리한 제목', date: old.record.date });
  const saved = await request('/api/meetings/p1', again);
  assert.equal(saved.status, 200);
  assert.equal(saved.body.meeting.meetingId, old.id);
  assert.equal(saved.body.meeting.projectName, '홈페이지 개편');
  assert.equal(saved.body.meeting.dailySequence, 3);
  assert.equal('recordingId' in saved.body.meeting, false);
  const list = (await request('/api/meetings')).body.meetings;
  assert.deepEqual(list.map(item => [item.location, item.id, item.projectName]), [['p1', again.id, '홈페이지 개편']]);
  for (const id of [old.id, again.id])
    assert.deepEqual((await request(`/api/meetings/p1/${id}`)).body.versions.map(version => version.id), [old.id, again.id]);
  assert.equal((await request('/api/meetings/p1', result({ meetingId: randomUUID() }))).status, 404);
  assert.equal((await request('/api/meetings/main', result({ meetingId: old.id }))).status, 404, '다른 보관함의 회의로는 잇지 않는다');
});

test('본문이 손상돼 열 수 없는 결과는 결과 버전에 넣지 않는다', async t => {
  const dir = folder(t), request = await start(t, dir);
  const recordingId = randomUUID();
  await request(`/api/recordings/main/${recordingId}`, recordingMeta());
  const good = result({ recordingId });
  await request('/api/meetings/main', good);
  const badId = randomUUID();
  fs.writeFileSync(path.join(dir, '회의기록', `회의-${badId}.json`), JSON.stringify({ id: badId, location: 'main', recordingId, title: '본문 손상', date: '2026-09-30',
    minutes: { broken: true }, savedAt: '2099-01-01T00:00:00.000Z' }));
  assert.deepEqual((await request(`/api/meetings/main/${good.id}`)).body.versions.map(version => version.id), [good.id]);
  assert.equal((await request(`/api/meetings/main/${badId}`)).status, 503);
  assert.deepEqual((await request('/api/meetings')).body.meetings.map(item => item.id), [good.id]);
});

test('새 녹음은 main에서만 만든다', async t => {
  const dir = folder(t);
  const old = legacyMeeting(dir, 1);
  const request = await start(t, dir);
  const before = fs.readdirSync(old.dir).sort();
  const id = randomUUID();
  assert.equal((await request(`/api/recordings/p1/${id}`, recordingMeta())).status, 400);
  assert.equal((await request.audio(`/api/recordings/p1/${old.recordingId}/audio/2`, Buffer.from('추가 원음'))).status, 400);
  assert.equal((await request(`/api/recordings/p4/${id}`, recordingMeta())).status, 404);
  assert.deepEqual(fs.readdirSync(old.dir).sort(), before);
  assert.deepEqual((await request.audio(`/api/recordings/p1/${old.recordingId}/audio/1`)).bytes, old.bytes, '옛 원음은 읽을 수 있다');
});

test('회의명이 빈 녹음을 만들 수 있고 결과 제목이 비면 회의로 저장한다', async t => {
  const request = await start(t, folder(t));
  const recordingId = randomUUID();
  const recording = await request(`/api/recordings/main/${recordingId}`, recordingMeta({ title: '' }));
  assert.equal(recording.status, 200);
  assert.equal(recording.body.recording.title, '');
  assert.deepEqual((await request('/api/meetings')).body.meetings.map(item => [item.id, item.title, item.analyzed]), [[recordingId, '', false]]);
  const saved = await request('/api/meetings/main', result({ recordingId, title: '  ' }));
  assert.equal(saved.status, 200);
  assert.equal(saved.body.meeting.title, '회의');
  assert.match(saved.body.meeting.artifacts.transcript, /-회의-[0-9a-f]{8}-전사\.txt$/);
});

test('평가는 정해진 범위만 받고 결과 파일을 바꾸지 않는다', async t => {
  const dir = folder(t), request = await start(t, dir);
  const record = result();
  await request('/api/meetings/main', record);
  const file = path.join(dir, '회의기록', `회의-${record.id}.json`);
  const bytes = fs.readFileSync(file);
  const route = `/api/meetings/main/${record.id}/review`;
  const saved = await request(route, { stars: 4, comment: '담당자가 틀렸어요.' });
  assert.equal(saved.status, 200);
  assert.deepEqual(Object.keys(saved.body.review), ['version', 'stars', 'comment', 'savedAt']);
  assert.deepEqual([saved.body.review.version, saved.body.review.stars, saved.body.review.comment], [1, 4, '담당자가 틀렸어요.']);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, '회의기록', `평가-${record.id}.json`), 'utf8')), saved.body.review);
  assert.deepEqual(fs.readFileSync(file), bytes);
  for (const body of [{ stars: 0 }, { stars: 6 }, { stars: 3.5 }, { stars: '4' }, { stars: null, comment: ' ' }, { stars: null }, {}, { comment: '가'.repeat(1001) },
    { stars: 3, comment: 1 }, { stars: 3, extra: 1 }])
    assert.equal((await request(route, body)).status, 400, JSON.stringify(body));
  const onlyComment = await request(route, { stars: null, comment: '의견만 남깁니다.' });
  assert.equal(onlyComment.status, 200);
  assert.equal(onlyComment.body.review.stars, null);
  assert.equal((await request(route, { comment: '가'.repeat(1000) })).status, 200);
  assert.equal((await request(`/api/meetings/main/${randomUUID()}/review`, { stars: 3 })).status, 404);
  const recordingId = randomUUID();
  await request(`/api/recordings/main/${recordingId}`, recordingMeta());
  assert.equal((await request(`/api/meetings/main/${recordingId}/review`, { stars: 3 })).status, 404, '분석 전 녹음에는 평가를 남기지 않는다');
});

test('목록 항목에 최신 결과의 별 개수와 의견 반영 여부가 붙는다', async t => {
  const request = await start(t, folder(t));
  const recordingId = randomUUID();
  await request(`/api/recordings/main/${recordingId}`, recordingMeta());
  const first = result({ recordingId });
  await request('/api/meetings/main', first);
  await request(`/api/meetings/main/${first.id}/review`, { stars: 2, comment: '담당자를 고쳐 주세요.' });
  let [item] = (await request('/api/meetings')).body.meetings;
  assert.deepEqual([item.id, item.stars, item.refined], [first.id, 2, false]);
  await pause();
  const refined = result({ recordingId, feedback: '담당자를 고쳐 주세요.' });
  const saved = await request('/api/meetings/main', refined);
  assert.equal(saved.body.meeting.feedback, '담당자를 고쳐 주세요.');
  [item] = (await request('/api/meetings')).body.meetings;
  assert.deepEqual([item.id, item.refined, 'stars' in item], [refined.id, true, false]);
  await request(`/api/meetings/main/${refined.id}/review`, { stars: 5 });
  [item] = (await request('/api/meetings')).body.meetings;
  assert.equal(item.stars, 5);
  const versions = (await request(`/api/meetings/main/${refined.id}`)).body.versions;
  assert.deepEqual(versions.map(version => [version.id, version.refined, version.stars]), [[first.id, false, 2], [refined.id, true, 5]]);
  assert.equal((await request('/api/meetings/main', result({ recordingId, feedback: '가'.repeat(1001) }))).status, 400);
});

test('결과를 열면 그 결과의 평가를 함께 돌려주고 평가가 없으면 null이다', async t => {
  const request = await start(t, folder(t));
  const recordingId = randomUUID();
  await request(`/api/recordings/main/${recordingId}`, recordingMeta());
  const first = result({ recordingId });
  await request('/api/meetings/main', first);
  assert.equal((await request(`/api/meetings/main/${first.id}`)).body.review, null);
  await request(`/api/meetings/main/${first.id}/review`, { stars: null, comment: '담당자가 틀렸어요.' });
  await pause();
  const second = result({ recordingId, feedback: '담당자가 틀렸어요.' });
  await request('/api/meetings/main', second);
  const opened = (await request(`/api/meetings/main/${first.id}`)).body;
  assert.deepEqual([opened.review.stars, opened.review.comment], [null, '담당자가 틀렸어요.']);
  assert.equal((await request(`/api/meetings/main/${second.id}`)).body.review, null);
});

test('보관함 이름과 폴더가 맞지 않는 기록은 읽지 않는다', async t => {
  const dir = folder(t);
  const old = legacyMeeting(dir, 1);
  const request = await start(t, dir);
  const fresh = result();
  await request('/api/meetings/main', fresh);
  for (const target of ['프로젝트-02', '프로젝트-03']) fs.mkdirSync(path.join(dir, target), { recursive: true });
  fs.copyFileSync(path.join(old.dir, `회의-${old.id}.json`), path.join(dir, '프로젝트-02', `회의-${old.id}.json`));
  fs.copyFileSync(path.join(old.dir, `회의-${old.id}.json`), path.join(dir, '회의기록', `회의-${old.id}.json`));
  fs.copyFileSync(path.join(dir, '회의기록', `회의-${fresh.id}.json`), path.join(dir, '프로젝트-03', `회의-${fresh.id}.json`));
  assert.equal((await request(`/api/meetings/p2/${old.id}`)).status, 503);
  assert.equal((await request(`/api/meetings/main/${old.id}`)).status, 503);
  assert.equal((await request(`/api/meetings/p3/${fresh.id}`)).status, 503);
  const list = (await request('/api/meetings')).body;
  assert.deepEqual(list.meetings.map(item => `${item.location}:${item.id}`).sort(), [`main:${fresh.id}`, `p1:${old.id}`].sort());
  assert.equal(list.skipped, 3);
});

test('날짜별 차수는 보관함 안에서 센다', async t => {
  const dir = folder(t);
  legacyMeeting(dir, 1, { date: '2026-10-01', dailySequence: 1 });
  const request = await start(t, dir);
  assert.equal((await request('/api/meetings/main', result({ date: '2026-10-01' }))).body.meeting.dailySequence, 1);
  assert.equal((await request('/api/meetings/main', result({ date: '2026-10-01' }))).body.meeting.dailySequence, 2);
  assert.equal((await request(`/api/recordings/main/${randomUUID()}`, recordingMeta({ date: '2026-10-01' }))).body.recording.dailySequence, 3);
  assert.equal((await request('/api/meetings/main', result({ date: '2026-10-02' }))).body.meeting.dailySequence, 1);
  const list = (await request('/api/meetings')).body.meetings;
  assert.equal(list.find(item => item.location === 'p1').dailySequence, 1);
});

test('잘못된 보관함·식별자와 인증 없는 저장을 거절한다', async t => {
  const request = await start(t, folder(t));
  assert.equal((await request('/api/meetings/p4', result())).status, 404);
  assert.equal((await request(`/api/meetings/p0/${randomUUID()}`)).status, 404);
  assert.equal((await request(`/api/meetings/main/${randomUUID()}`)).status, 404);
  assert.equal((await request('/api/meetings/main', result(), false)).status, 401);
  assert.equal((await request('/api/meetings/main', { ...result(), id: '../outside' })).status, 400);
  assert.equal((await request('/api/projects')).status, 404, '프로젝트 경로는 없앴다');
});

test('분석 전 원음이 저장되고 재실행 후 복원되며 다른 보관함에서는 접근할 수 없다', async t => {
  const dir = folder(t), request = await start(t, dir);
  const id = randomUUID();
  assert.equal((await request(`/api/recordings/main/${id}`, recordingMeta({ expectedParts: 2 }))).status, 200);
  const bytes = Buffer.from('test microphone bytes');
  const route = `/api/recordings/main/${id}/audio/1`;
  assert.equal((await request.audio(route, bytes)).status, 200);
  assert.equal((await request.audio(route, bytes)).status, 200);
  assert.equal((await request.audio(route, Buffer.from('different'))).status, 409);
  const restarted = await start(t, dir);
  const restored = await restarted(`/api/meetings/main/${id}`);
  assert.equal(restored.status, 200);
  assert.equal(restored.body.meeting.minutes, null);
  assert.equal(restored.body.meeting.audio.length, 1);
  assert.equal(restored.body.meeting.expectedParts, 2);
  assert.deepEqual(restored.body.versions, []);
  assert.deepEqual((await restarted.audio(route)).bytes, bytes);
  assert.equal((await restarted.audio(route.replace('/main/', '/p2/'))).status, 404);
  assert.equal((await restarted('/api/meetings')).body.meetings.length, 1);
});

test('요약 전 전사를 저장하면 재실행 후 재전사 없이 복원하고 원음을 보존한다', async t => {
  const dir = folder(t), request = await start(t, dir);
  const id = randomUUID();
  const route = `/api/recordings/main/${id}`;
  await request(route, recordingMeta());
  assert.equal((await request(route + '/transcript', { text: '가'.repeat(14977) })).status, 409);
  const bytes = Buffer.from('preserved original recording');
  await request.audio(route + '/audio/1', bytes);
  assert.equal((await request(route + '/transcript', { text: '가'.repeat(14977) })).status, 200);
  const restarted = await start(t, dir);
  const restored = await restarted(`/api/meetings/main/${id}`);
  assert.equal(restored.body.meeting.transcript.length, 14977);
  assert.equal(restored.body.meeting.minutes, null);
  assert.deepEqual((await restarted.audio(route + '/audio/1')).bytes, bytes);
  assert.equal(fs.readFileSync(path.join(dir, '회의기록', `전사-${id}.txt`), 'utf8').length, 14977);
  assert.equal((await restarted(route.replace('/main/', '/p2/') + '/transcript', { text: '다른 보관함' })).status, 404);
  assert.equal((await restarted(route + '/transcript', { text: '인증 없음' }, false)).status, 401);
});
