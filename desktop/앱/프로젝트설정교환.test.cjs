// 프로젝트 설정 파일(교환 파일 9칸, 앱은 3개)의 내보내기·검증·전체 교체와 실패 시 무변경·롤백을 검증한다.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { createMeetingServer } = require('./서버.cjs');
const { createProjectStore } = require('./프로젝트보관.cjs');
const { parseSettingsFile, buildSettingsFile, limitProjects, MAX_BYTES } = require('./프로젝트설정교환.cjs');

function folder(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'voicenote-settings-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}
async function start(t, dataDir) {
  const meeting = createMeetingServer({ dataDir });
  await new Promise(resolve => meeting.server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => meeting.server.close(resolve)));
  const url = `http://127.0.0.1:${meeting.server.address().port}`;
  return async (route, body) => {
    const response = await fetch(url + route, { method: body === undefined ? 'GET' : 'POST',
      headers: { Origin: url, 'Content-Type': 'application/json', 'X-Meeting-Token': meeting.token }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
  };
}
const empty = slot => ({ slot, name: '', title: '', context: '', outputFormat: 'meeting' });
function settings(change = {}) {
  const projects = Array.from({ length: 9 }, (_, i) => empty(i + 1));
  projects[0] = { slot: 1, name: '예시 프로젝트 문서 표준화', title: '표준화 회의', context: '1줄\n2줄 · 😀 <b>굵게</b>', outputFormat: 'meeting' };
  projects[2] = { slot: 3, name: '업무 점검', title: '', context: '', outputFormat: 'tasks' };
  return { format: 'voicenote-project-settings', version: 1, projects, ...change };
}
const text = value => JSON.stringify(value);
const fileState = dir => fs.existsSync(dir) ? fs.readdirSync(dir, { recursive: true }).sort().map(name => {
  const full = path.join(dir, name);
  return fs.statSync(full).isFile() ? [name, fs.readFileSync(full, 'base64')] : [name];
}) : [];

test('정상 파일은 slot 순서로 정렬하고 줄바꿈·이모지·HTML 글자를 그대로 보존한다', () => {
  const source = settings();
  source.projects.reverse();
  const parsed = parseSettingsFile('﻿' + text(source));
  assert.deepEqual(parsed.map(item => item.slot), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
  assert.equal(parsed[0].context, '1줄\n2줄 · 😀 <b>굵게</b>');
  assert.equal(parsed[2].title, '');
  assert.equal(parsed[2].outputFormat, 'tasks');
  assert.deepEqual(buildSettingsFile(parsed.map(item => ({ ...item, revision: 3 }))), settings());
});

const rejected = {
  'JSON 아님': () => '{"format":',
  '다른 형식': () => text(settings({ format: 'other' })),
  '버전 초과': () => text(settings({ version: 2 })),
  '버전 문자열': () => text(settings({ version: '1' })),
  '모르는 root 키': () => text(settings({ apiKey: 'sk-x' })),
  '8개만 있음': () => { const value = settings(); value.projects.pop(); return text(value); },
  '10개 있음': () => { const value = settings(); value.projects.push(empty(9)); return text(value); },
  '중복 slot': () => { const value = settings(); value.projects[8] = empty(1); return text(value); },
  'slot 범위 밖': () => { const value = settings(); value.projects[8] = empty(10); return text(value); },
  'slot 소수': () => { const value = settings(); value.projects[8] = { ...empty(9), slot: 8.5 }; return text(value); },
  '모르는 entry 키': () => { const value = settings(); value.projects[1] = { ...empty(2), revision: 4 }; return text(value); },
  '이름 없이 내용': () => { const value = settings(); value.projects[1] = { ...empty(2), context: '내용' }; return text(value); },
  '이름 없이 다른 형식': () => { const value = settings(); value.projects[1] = { ...empty(2), outputFormat: 'summary' }; return text(value); },
  '모르는 출력 형식': () => { const value = settings(); value.projects[0].outputFormat = 'report'; return text(value); },
  '이름 101자': () => { const value = settings(); value.projects[0].name = '가'.repeat(101); return text(value); },
  '회의명 161자': () => { const value = settings(); value.projects[0].title = '가'.repeat(161); return text(value); },
  '설명 4001자': () => { const value = settings(); value.projects[0].context = '가'.repeat(4001); return text(value); },
  '회의명 누락': () => { const value = settings(); delete value.projects[0].title; return text(value); },
  '128KiB 초과': () => text(settings()) + ' '.repeat(MAX_BYTES),
};
for (const [name, source] of Object.entries(rejected)) {
  test(`잘못된 설정 파일은 거절한다: ${name}`, () => {
    assert.throws(() => parseSettingsFile(source()), error => error.status === 400 && typeof error.message === 'string');
  });
}

test('별도로 제공하는 예시 프로젝트 설정 파일은 1번만 채워진 계약 파일이다', t => {
  const provided = path.join(__dirname, '..', '..', '설정파일', '예시-프로젝트설정.json');
  if (!fs.existsSync(provided)) return t.skip('소스 묶음에는 별도 설정 파일이 없습니다.');
  const parsed = parseSettingsFile(fs.readFileSync(provided, 'utf8'));
  assert.match(parsed[0].name, /예시 프로젝트/);
  assert.ok(parsed[0].title && parsed[0].context.includes('\n'));
  assert.equal(parsed[0].outputFormat, 'meeting');
  assert.deepEqual(parsed.slice(1), Array.from({ length: 8 }, (_, i) => empty(i + 2)));
  assert.deepEqual(require('./기본프로젝트.json'), { name: '', title: '', context: '', outputFormat: 'meeting' });
});

test('경계값 100·160·4000자와 128KiB 이하 파일은 받아들인다', () => {
  const value = settings();
  Object.assign(value.projects[0], { name: '가'.repeat(100), title: '나'.repeat(160), context: '다'.repeat(4000) });
  assert.equal(parseSettingsFile(text(value))[0].context.length, 4000);
  assert.ok(Buffer.byteLength(text(value)) <= MAX_BYTES);
});

test('새 설치는 3개 모두 빈 값이고 기존 사용자 설정은 출력 형식이 없어도 회의록형으로 유지한다', async t => {
  const fresh = folder(t);
  const projects = (await (await start(t, fresh))('/api/projects')).body.projects;
  assert.deepEqual(projects.map(item => [item.name, item.title, item.context, item.outputFormat]), Array(3).fill(['', '', '', 'meeting']));
  const upgrade = folder(t);
  fs.mkdirSync(path.join(upgrade, '프로젝트-01'));
  const legacy = { slot: 1, name: '기존 프로젝트', title: '기존 회의', context: '기존 설명', revision: 7 };
  fs.writeFileSync(path.join(upgrade, '프로젝트-01', '설정.json'), JSON.stringify(legacy));
  const loaded = (await (await start(t, upgrade))('/api/projects')).body.projects[0];
  assert.deepEqual(loaded, { ...legacy, outputFormat: 'meeting' });
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(upgrade, '프로젝트-01', '설정.json'), 'utf8')), legacy);
});

test('내보낸 파일을 다시 불러오면 같은 설정이 되고 회의와 녹음은 그대로다', async t => {
  const dir = folder(t), request = await start(t, dir);
  await request('/api/projects/1', { name: '원래 프로젝트', title: '주간 회의', context: '여러 줄\n설명', outputFormat: 'summary', revision: 0 });
  const meeting = { id: randomUUID(), title: '보존 회의', date: '2026-10-01', participants: '', context: '', transcript: '보존할 전사',
    minutes: { overview: '보존', topics: [], decisions: [], actions: [], openQuestions: [] } };
  assert.equal((await request('/api/projects/1/meetings', meeting)).status, 200);
  const exported = (await request('/api/project-settings/export')).body.file;
  assert.deepEqual(Object.keys(exported), ['format', 'version', 'projects']);
  assert.deepEqual(exported.projects[0], { slot: 1, name: '원래 프로젝트', title: '주간 회의', context: '여러 줄\n설명', outputFormat: 'summary' });
  assert.doesNotMatch(JSON.stringify(exported), /revision|apiKey|보존할 전사|summaryModel/);

  const replacement = settings();
  const before = (await request('/api/projects')).body.projects.map(item => item.revision);
  const preview = await request('/api/project-settings/preview', { file: text(replacement) });
  assert.equal(preview.status, 200);
  assert.deepEqual(preview.body.projects[0], { slot: 1, name: '예시 프로젝트 문서 표준화', outputFormat: 'meeting' });
  assert.equal((await request('/api/projects')).body.projects[0].name, '원래 프로젝트');
  const applied = await request('/api/project-settings/import', { file: text(replacement), revisions: before });
  assert.equal(applied.status, 200);
  assert.deepEqual(applied.body.projects.map(({ revision, ...item }) => item), replacement.projects.slice(0, 3));
  assert.equal((await request('/api/projects/1/meetings')).body.meetings.length, 1);
  assert.equal((await request(`/api/projects/1/meetings/${meeting.id}`)).body.meeting.transcript, '보존할 전사');

  const again = (await request('/api/project-settings/export')).body.file;
  assert.deepEqual(again, replacement);
  const back = await request('/api/project-settings/import', { file: text(exported), revisions: applied.body.projects.map(item => item.revision) });
  assert.equal(back.status, 200);
  assert.deepEqual((await request('/api/project-settings/export')).body.file, exported);
  assert.equal(fs.readdirSync(path.join(dir, '프로젝트-01')).some(name => name.startsWith('설정-교체전-')), false);
});

test('잘못된 파일·오래된 revision·크기 초과 요청은 설정 파일을 하나도 바꾸지 않는다', async t => {
  const dir = folder(t), request = await start(t, dir);
  await request('/api/projects/2', { name: '그대로', title: '회의', context: '', revision: 0 });
  const revisions = (await request('/api/projects')).body.projects.map(item => item.revision);
  const before = fileState(dir);
  const duplicate = settings(); duplicate.projects[8] = empty(1);
  for (const body of [{ file: text(duplicate), revisions }, { file: text(settings({ version: 2 })), revisions }, { file: 42, revisions },
    { file: text(settings()), revisions: revisions.map(() => 0) }, { file: text(settings()) }]) {
    const result = await request('/api/project-settings/import', body);
    assert.ok([400, 409].includes(result.status), JSON.stringify(result.body));
    assert.deepEqual(fileState(dir), before);
  }
  const huge = await request('/api/project-settings/import', { file: 'x'.repeat(600_000), revisions });
  assert.equal(huge.status, 413);
  assert.deepEqual(fileState(dir), before);
});

test('4번 이후 프로젝트가 채워진 이전 버전 파일은 미리보기와 적용 모두 거절하고 아무것도 바꾸지 않는다', async t => {
  const dir = folder(t), request = await start(t, dir);
  await request('/api/projects/1', { name: '그대로', title: '회의', context: '', revision: 0 });
  const revisions = (await request('/api/projects')).body.projects.map(item => item.revision);
  const before = fileState(dir);
  const legacy = settings();
  legacy.projects[4] = { slot: 5, name: '이전 다섯째', title: '', context: '', outputFormat: 'summary' };
  legacy.projects[8] = { slot: 9, name: '이전 아홉째', title: '', context: '', outputFormat: 'meeting' };
  for (const route of ['/api/project-settings/preview', '/api/project-settings/import']) {
    const result = await request(route, { file: text(legacy), revisions });
    assert.equal(result.status, 400);
    assert.match(result.body.error.message, /3개까지만.*5번, 9번/);
    assert.deepEqual(fileState(dir), before);
  }
  assert.deepEqual(limitProjects(parseSettingsFile(text(settings()))).map(item => item.slot), [1, 2, 3]);
});

test('내보내기는 이전 버전도 읽도록 4~9번을 빈 칸으로 채운 9칸 파일이다', async t => {
  const request = await start(t, folder(t));
  await request('/api/projects/2', { name: '둘째', title: '회의', context: '', revision: 0 });
  const exported = (await request('/api/project-settings/export')).body.file;
  assert.deepEqual(exported.projects.map(item => item.slot), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
  assert.equal(exported.projects[1].name, '둘째');
  assert.deepEqual(exported.projects.slice(3), Array.from({ length: 6 }, (_, i) => empty(i + 4)));
  assert.deepEqual(parseSettingsFile(text(exported))[1].name, '둘째');
});

test('여러 설정 중 일부를 쓴 뒤 실패하면 원래 바이트로 되돌리고 새로 만든 설정은 지운다', t => {
  const dir = folder(t);
  let writes = 0, failAt = Infinity;
  const real = createProjectStore(dir, value => value);
  real.savePreset(1, { name: '하나', title: '회의', context: '원래', revision: 0 });
  real.savePreset(3, { name: '셋', title: '회의', context: '원래', revision: 0 });
  const original = fileState(dir);
  const store = createProjectStore(dir, value => value, { atomicWrite(file, value) {
    if (++writes === failAt) throw new Error('disk full');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, value);
  } });
  const next = parseSettingsFile(text(settings()));
  failAt = 2;
  assert.throws(() => store.replacePresets(next, store.projects().map(item => item.revision)), error => error.status === 503 && /되돌렸습니다/.test(error.message));
  assert.deepEqual(fileState(dir), original);
  writes = 0; failAt = Infinity;
  const result = store.replacePresets(next, store.projects().map(item => item.revision));
  assert.equal(result[2].outputFormat, 'tasks');
  assert.equal(result[1].name, '');
  assert.equal(result[2].revision, 2);
});

test('되돌리기까지 실패하면 교체전 사본을 남기고 그 위치를 알려 준다', t => {
  const dir = folder(t);
  const real = createProjectStore(dir, value => value);
  real.savePreset(1, { name: '원본', title: '회의', context: '보존', revision: 0 });
  const originalBytes = fs.readFileSync(path.join(dir, '프로젝트-01', '설정.json'));
  let writes = 0;
  const store = createProjectStore(dir, value => value, { atomicWrite(file, value) {
    writes++;
    if (writes === 1) { fs.writeFileSync(file, value); return; }
    throw new Error('disk full');
  } });
  const restore = fs.renameSync;
  t.after(() => { fs.renameSync = restore; });
  const next = parseSettingsFile(text(settings()));
  fs.renameSync = (from, to) => { if (to.endsWith(`프로젝트-01${path.sep}설정.json`)) throw new Error('locked'); return restore(from, to); };
  assert.throws(() => store.replacePresets(next, store.projects().map(item => item.revision)), error => /프로젝트-01\\설정-교체전-[0-9a-f]{8}\.json에 원래 내용/.test(error.message));
  fs.renameSync = restore;
  const copy = fs.readdirSync(path.join(dir, '프로젝트-01')).find(name => name.startsWith('설정-교체전-'));
  assert.deepEqual(fs.readFileSync(path.join(dir, '프로젝트-01', copy)), originalBytes);
});
