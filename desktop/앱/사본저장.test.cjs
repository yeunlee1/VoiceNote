// 분석 결과를 고른 폴더에 사본으로 쓰는 규칙(파일 이름·사본 기록·다시 저장·실패 처리)을 검증한다.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { createMeetingServer } = require('./서버.cjs');
const { markdown, plainText } = require('./회의문서.cjs');
const { artifactPrefix } = require('./회의보관.cjs');

function folder(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'voicenote-copy-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}
async function start(t, options = {}) {
  const dir = folder(t);
  const meeting = createMeetingServer({ dataDir: path.join(dir, '회의자료'), settingsFile: path.join(dir, 'AI설정.json'), ...options });
  await new Promise(resolve => meeting.server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => meeting.server.close(resolve)));
  const url = `http://127.0.0.1:${meeting.server.address().port}`;
  const request = async (route, body) => {
    const response = await fetch(url + route, { method: body === undefined ? 'GET' : 'POST',
      headers: { Origin: url, 'Content-Type': 'application/json', 'X-Meeting-Token': meeting.token }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
  };
  request.audio = async (route, bytes) => (await fetch(url + route, { method: 'POST', headers: { Origin: url, 'X-Meeting-Token': meeting.token, 'Content-Type': 'audio/webm' }, body: bytes })).status;
  return { dir, store: path.join(dir, '회의자료', '회의기록'), request };
}
const minutes = { overview: '전체 방향 | 시안 A로 진행합니다.', topics: [{ title: '일정', points: ['금요일까지 확정합니다.'] }], decisions: ['시안 A 채택'],
  actions: [{ task: '상세 화면 만들기', owner: '이대리', due: '10월 30일' }], openQuestions: ['버튼 색'] };
const result = (extra = {}) => ({ id: randomUUID(), title: '주간 회의', date: '2026-10-23', participants: '김과장, 이대리', transcript: '시안 A로 진행합니다.', minutes, ...extra });
// 원음 한 개가 있는 녹음을 만들고 그 원음 바이트를 돌려준다.
async function recording(request, title = '주간 회의') {
  const id = randomUUID(), bytes = Buffer.from(`원음 ${id}`);
  assert.equal((await request(`/api/recordings/main/${id}`, { title, date: '2026-10-23', participants: '', expectedParts: 1 })).status, 200);
  assert.equal(await request.audio(`/api/recordings/main/${id}/audio/1`, bytes), 200);
  return { id, bytes };
}
const files = dir => fs.readdirSync(dir).sort();
const log = (store, name) => JSON.parse(fs.readFileSync(path.join(store, name), 'utf8'));
// 임시 파일을 최종 이름으로 옮기는 단계(링크·복사·이름 바꾸기)에서 EPERM을 낸다.
const eperm = () => Object.assign(new Error('EPERM: operation not permitted'), { code: 'EPERM' });
const failPlace = when => ({ ...fs,
  linkSync(from, to) { if (when(to)) throw eperm(); return fs.linkSync(from, to); },
  openSync(file, flags, mode) { if (when(file)) throw eperm(); return fs.openSync(file, flags, mode); },
  copyFileSync(from, to, mode) { if (when(to)) throw eperm(); return fs.copyFileSync(from, to, mode); },
  renameSync(from, to) { if (when(to)) throw eperm(); return fs.renameSync(from, to); } });

test('결과 저장 뒤 고른 폴더에 전사·요약 두 파일·원음을 쓰고 내용은 변환기 결과와 같다', async t => {
  const { store, request } = await start(t);
  const [audio, transcript, summary] = [folder(t), folder(t), folder(t)];
  assert.equal((await request('/api/settings', { storage: { audio, transcript, summary } })).status, 200);
  const rec = await recording(request);
  const saved = await request('/api/meetings/main', result({ recordingId: rec.id }));
  assert.equal(saved.status, 200);
  const { meeting, copies } = saved.body;
  assert.equal(copies.ok, true);
  assert.deepEqual(copies.failed, []);
  assert.deepEqual(copies.written.map(item => item.kind).sort(), ['audio', 'summaryMd', 'summaryTxt', 'transcript']);
  const prefix = artifactPrefix(meeting);
  assert.equal(fs.readFileSync(path.join(transcript, `${prefix}-전사.txt`), 'utf8'), meeting.transcript);
  assert.equal(fs.readFileSync(path.join(summary, `${prefix}-요약.md`), 'utf8'), markdown(meeting));
  assert.equal(fs.readFileSync(path.join(summary, `${prefix}-요약.txt`), 'utf8'), plainText(meeting));
  const audioName = `${artifactPrefix({ ...meeting, id: rec.id })}-원음-01.webm`;
  assert.deepEqual(fs.readFileSync(path.join(audio, audioName)), rec.bytes);
  assert.deepEqual(log(store, `사본기록-${meeting.id}.json`).items.map(item => [item.kind, item.folder, item.ok]).sort(),
    [['summaryMd', summary, true], ['summaryTxt', summary, true], ['transcript', transcript, true]]);
  assert.deepEqual(log(store, `사본기록-원음-${rec.id}.json`).items, [{ index: 1, folder: audio, name: audioName, ok: true }]);
});

test('폴더를 고르지 않은 종류는 쓰지 않는다', async t => {
  const { request } = await start(t);
  const summary = folder(t);
  await request('/api/settings', { storage: { summary } });
  const rec = await recording(request);
  const { copies } = (await request('/api/meetings/main', result({ recordingId: rec.id }))).body;
  assert.deepEqual(copies.written.map(item => item.kind).sort(), ['summaryMd', 'summaryTxt']);
  assert.deepEqual(copies.skipped.map(item => item.kind).sort(), ['audio', 'transcript']);
  assert.ok(copies.skipped.every(item => item.reason));
  assert.equal(files(summary).length, 2);
});

test('.md만 성공하고 .txt가 실패한 뒤 다시 저장하면 .txt만 쓴다', async t => {
  let failing = true;
  const { request } = await start(t, { copyFs: failPlace(to => failing && to.endsWith('-요약.txt')) });
  const summary = folder(t);
  await request('/api/settings', { storage: { summary } });
  const saved = await request('/api/meetings/main', result());
  assert.equal(saved.status, 200);
  assert.equal(saved.body.copies.ok, false);
  assert.deepEqual(saved.body.copies.failed.map(item => item.kind), ['summaryTxt']);
  const md = files(summary);
  assert.equal(md.length, 1);
  const before = fs.statSync(path.join(summary, md[0])).mtimeMs;
  failing = false;
  const again = await request(`/api/meetings/main/${saved.body.meeting.id}/copies`, {});
  assert.equal(again.status, 200);
  assert.deepEqual(again.body.copies.written.map(item => item.kind), ['summaryTxt']);
  assert.ok(again.body.copies.skipped.some(item => item.kind === 'summaryMd'));
  assert.equal(files(summary).length, 2);
  assert.equal(fs.statSync(path.join(summary, md[0])).mtimeMs, before);
});

test('다시 분석해 제목이 바뀌어도 같은 원음은 다시 복사하지 않는다', async t => {
  const { request } = await start(t);
  const audio = folder(t);
  await request('/api/settings', { storage: { audio } });
  const rec = await recording(request);
  await request('/api/meetings/main', result({ recordingId: rec.id }));
  const retry = await request('/api/meetings/main', result({ recordingId: rec.id, title: '다시 분석한 제목' }));
  assert.deepEqual(retry.body.copies.written, []);
  assert.ok(retry.body.copies.skipped.some(item => item.kind === 'audio'));
  assert.equal(files(audio).length, 1);
});

test('고른 폴더가 잠시 없어졌다가 돌아와도 이미 쓴 사본과 원음을 다시 쓰지 않는다', async t => {
  const { request } = await start(t);
  const base = path.join(folder(t), '공유 폴더');
  const summary = path.join(base, '요약'), audio = path.join(base, '원음');
  fs.mkdirSync(summary, { recursive: true });
  fs.mkdirSync(audio, { recursive: true });
  await request('/api/settings', { storage: { summary, audio } });
  const rec = await recording(request);
  const saved = (await request('/api/meetings/main', result({ recordingId: rec.id }))).body;
  assert.equal(saved.copies.ok, true);
  // 폴더가 잠시 사라지면 다시 저장은 실패로 알린다.
  fs.renameSync(base, `${base}-잠시치움`);
  const missing = (await request(`/api/meetings/main/${saved.meeting.id}/copies`, {})).body.copies;
  assert.equal(missing.ok, false);
  // 폴더가 돌아오면 앞서 쓴 사본이 그대로 있으므로 아무것도 다시 쓰지 않는다.
  fs.renameSync(`${base}-잠시치움`, base);
  const back = (await request(`/api/meetings/main/${saved.meeting.id}/copies`, {})).body.copies;
  assert.deepEqual(back.written, []);
  assert.equal(back.ok, true);
  assert.deepEqual(files(summary).length, 2);
  assert.deepEqual(files(audio).length, 1);
});

test('세 종류를 같은 폴더로 골라도 이름이 겹치지 않는다', async t => {
  const { request } = await start(t);
  const same = folder(t);
  await request('/api/settings', { storage: { audio: same, transcript: same, summary: same } });
  const rec = await recording(request);
  const { copies } = (await request('/api/meetings/main', result({ recordingId: rec.id }))).body;
  assert.equal(copies.written.length, 4);
  assert.equal(files(same).length, 4);
  assert.equal(new Set(copies.written.map(item => item.path)).size, 4);
});

test('같은 날 같은 제목 회의는 기존 파일을 덮지 않고 (2)를 붙인다', async t => {
  const { request } = await start(t);
  const summary = folder(t);
  await request('/api/settings', { storage: { summary } });
  const record = result();
  const prefix = artifactPrefix({ ...record, dailySequence: 1 });
  fs.writeFileSync(path.join(summary, `${prefix}-요약.md`), '사용자가 따로 둔 파일');
  const { copies } = (await request('/api/meetings/main', record)).body;
  assert.equal(copies.ok, true);
  assert.equal(fs.readFileSync(path.join(summary, `${prefix}-요약.md`), 'utf8'), '사용자가 따로 둔 파일');
  assert.ok(fs.existsSync(path.join(summary, `${prefix}-요약 (2).md`)));
  assert.ok(fs.existsSync(path.join(summary, `${prefix}-요약.txt`)), '겹치지 않는 이름은 그대로 쓴다');
});

test('폴더를 바꾼 뒤 다시 저장하면 새 폴더에 쓰고 옛 사본은 남긴다', async t => {
  const { store, request } = await start(t);
  const [first, second] = [folder(t), folder(t)];
  await request('/api/settings', { storage: { summary: first } });
  const { meeting } = (await request('/api/meetings/main', result())).body;
  await request('/api/settings', { storage: { summary: second } });
  const again = await request(`/api/meetings/main/${meeting.id}/copies`, {});
  assert.deepEqual(again.body.copies.written.map(item => item.kind).sort(), ['summaryMd', 'summaryTxt']);
  assert.equal(files(first).length, 2);
  assert.equal(files(second).length, 2);
  assert.equal(log(store, `사본기록-${meeting.id}.json`).items.length, 4);
  fs.rmSync(path.join(second, files(second)[0]));
  const restored = await request(`/api/meetings/main/${meeting.id}/copies`, {});
  assert.equal(restored.body.copies.written.length, 1, '사라진 사본만 다시 쓴다');
  assert.equal(files(second).length, 2);
});

test('최종 이름을 붙이기 직전에 같은 이름 파일이 생겨도 덮지 않고 다음 이름으로 쓴다', async t => {
  let intruded = false;
  const summary = folder(t);
  const intrude = { ...fs, writeFileSync(file, data, options) {
    const written = fs.writeFileSync(file, data, options);
    // 임시 파일을 다 쓴 바로 뒤, 최종 이름을 붙이기 전에 다른 프로그램이 같은 이름 파일을 만든다.
    if (!intruded && String(file).endsWith('.tmp') && String(file).includes('-요약.md')) {
      intruded = true;
      fs.writeFileSync(path.join(path.dirname(file), path.basename(file).slice(1).replace(/\.[0-9a-f]{12}\.tmp$/, '')), '다른 프로그램이 만든 파일');
    }
    return written;
  } };
  const { request } = await start(t, { copyFs: intrude });
  await request('/api/settings', { storage: { summary } });
  const { meeting, copies } = (await request('/api/meetings/main', result())).body;
  assert.equal(intruded, true);
  assert.equal(copies.ok, true);
  const prefix = artifactPrefix(meeting);
  assert.equal(fs.readFileSync(path.join(summary, `${prefix}-요약.md`), 'utf8'), '다른 프로그램이 만든 파일');
  assert.equal(fs.readFileSync(path.join(summary, `${prefix}-요약 (2).md`), 'utf8'), markdown(meeting));
  assert.ok(copies.written.some(item => item.path.endsWith(`${prefix}-요약 (2).md`)));
  assert.equal(files(summary).some(name => name.endsWith('.tmp')), false);
});

test('하드 링크를 못 쓰는 드라이브에서는 대상 파일을 배타적으로 새로 만들어 쓴다', async t => {
  const noLink = { ...fs, linkSync() { throw Object.assign(new Error('EPERM: hard links not supported'), { code: 'EPERM' }); } };
  const { request } = await start(t, { copyFs: noLink });
  const summary = folder(t);
  await request('/api/settings', { storage: { summary } });
  const record = result();
  const prefix = artifactPrefix({ ...record, dailySequence: 1 });
  fs.writeFileSync(path.join(summary, `${prefix}-요약.md`), '사용자가 따로 둔 파일');
  const { meeting, copies } = (await request('/api/meetings/main', record)).body;
  assert.equal(copies.ok, true);
  assert.equal(fs.readFileSync(path.join(summary, `${prefix}-요약.md`), 'utf8'), '사용자가 따로 둔 파일');
  assert.equal(fs.readFileSync(path.join(summary, `${prefix}-요약 (2).md`), 'utf8'), markdown(meeting));
  assert.equal(fs.readFileSync(path.join(summary, `${prefix}-요약.txt`), 'utf8'), plainText(meeting));
  assert.equal(files(summary).some(name => name.endsWith('.tmp')), false);
});

test('하드 링크를 못 쓰는 드라이브에서 대상 만들기가 실패해도 그 이름의 남의 파일은 지우지 않는다', async t => {
  const summary = folder(t);
  // 링크를 못 쓰고, 대상을 만들려는 순간 다른 프로그램이 같은 이름 파일을 만든 뒤 권한 오류가 난다.
  const raced = file => { fs.writeFileSync(file, '다른 프로그램이 만든 파일'); throw Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' }); };
  const racing = { ...fs, linkSync() { throw eperm(); },
    copyFileSync(from, to, mode) { if (to.endsWith('-요약.md')) raced(to); return fs.copyFileSync(from, to, mode); },
    openSync(file, flags, mode) { if (String(file).endsWith('-요약.md')) raced(file); return fs.openSync(file, flags, mode); } };
  const { request } = await start(t, { copyFs: racing });
  await request('/api/settings', { storage: { summary } });
  const { meeting, copies } = (await request('/api/meetings/main', result())).body;
  const prefix = artifactPrefix(meeting);
  assert.equal(fs.readFileSync(path.join(summary, `${prefix}-요약.md`), 'utf8'), '다른 프로그램이 만든 파일');
  assert.deepEqual(copies.failed.map(item => item.kind), ['summaryMd']);
  assert.equal(fs.readFileSync(path.join(summary, `${prefix}-요약.txt`), 'utf8'), plainText(meeting));
  assert.equal(files(summary).some(name => name.endsWith('.tmp')), false);
});

test('쓰기가 EPERM으로 실패해도 결과 저장 응답은 200이고 copies.failed에 이유가 있고 임시 파일이 남지 않는다', async t => {
  const { request } = await start(t, { copyFs: failPlace(() => true) });
  const [audio, transcript, summary] = [folder(t), folder(t), folder(t)];
  await request('/api/settings', { storage: { audio, transcript, summary } });
  const rec = await recording(request);
  const saved = await request('/api/meetings/main', result({ recordingId: rec.id }));
  assert.equal(saved.status, 200);
  assert.equal(saved.body.copies.ok, false);
  assert.deepEqual(saved.body.copies.failed.map(item => item.kind).sort(), ['audio', 'summaryMd', 'summaryTxt', 'transcript']);
  assert.ok(saved.body.copies.failed.every(item => /권한/.test(item.message)));
  for (const target of [audio, transcript, summary]) assert.deepEqual(files(target), []);
  assert.equal((await request(`/api/meetings/main/${saved.body.meeting.id}`)).status, 200, '결과는 저장돼 있다');
  assert.equal((await request(`/api/meetings/main/${randomUUID()}/copies`, {})).status, 404);
});

test('금지 문자·이모지·줄바꿈·300자 제목도 유효한 이름이고 제목 부분은 80자 이하다', async t => {
  const titlePart = name => /^2026-10-23-0\d차-(.*)-[0-9a-f]{8}(-.*)?$/.exec(name)[1];
  const check = name => {
    assert.doesNotMatch(name, /[<>:"/\\|?*\x00-\x1f]/, name);
    assert.ok(name.isWellFormed(), `서로게이트 반쪽이 없다: ${name}`);
    assert.ok(Array.from(titlePart(name)).length <= 80, `${Array.from(titlePart(name)).length}자`);
  };
  // 이름 규칙은 저장소가 받는 길이(160자)보다 긴 300자 제목에서도 지켜진다.
  for (const title of ['회의: "A/B" \\ C | D? * <E>\n둘째 줄 😀' + '가'.repeat(300), '😀'.repeat(79) + '이모지 경계' + '나'.repeat(300), '끝에 점과 공백. . '])
    check(artifactPrefix({ id: randomUUID(), title, date: '2026-10-23', dailySequence: 1 }));
  // 실제 사본은 저장소가 받는 가장 긴 제목으로 쓴다. 이모지 79개 + 두 글자는 160 UTF-16 단위다.
  const { request } = await start(t);
  const target = folder(t);
  await request('/api/settings', { storage: { audio: target, transcript: target, summary: target } });
  const rec = await recording(request);
  const titles = ['회의: "A/B" \\ C | D? * <E>\n둘째 줄 😀', '😀'.repeat(79) + '경계'];
  for (const [index, title] of titles.entries()) {
    const { copies } = (await request('/api/meetings/main', result({ title, ...(index ? {} : { recordingId: rec.id }) }))).body;
    assert.equal(copies.ok, true);
    for (const item of copies.written) {
      check(path.basename(item.path));
      assert.ok(fs.existsSync(item.path));
    }
  }
  assert.equal(files(target).length, 7);
});
