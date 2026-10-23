// 설정 파일 2판(요약 모델·기본 출력 형식·내 형식·저장 위치)의 만들기·검증·미리보기·적용과 실패 시 되돌리기를 검증한다.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { createMeetingServer } = require('./서버.cjs');
const aiModels = require('./AI모델.cjs');
const { FORMAT, VERSION, MAX_BYTES, LEGACY_MESSAGE, buildSettingsFile, parseSettingsFile, checkFolder } = require('./설정파일.cjs');

const [FIRST, SECOND] = aiModels.summaryModels().map(model => model.id);
const MISSING = '이 PC에 없는 폴더라 적용하지 않습니다.';
const custom = { name: '주간 보고 😀', sections: [{ key: 'actions', title: '할 일' }, { key: 'overview', title: '요약' }], instruction: '담당자는 이름만 씁니다.\n기한은 날짜로 씁니다.' };
const emptyStorage = { audio: '', transcript: '', summary: '' };

function folder(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'voicenote-settings-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}
async function start(t, { dir = folder(t), settingsFile = path.join(dir, 'AI설정.json'), ...options } = {}) {
  const meeting = createMeetingServer({ dataDir: path.join(dir, '회의자료'), settingsFile, ...options });
  await new Promise(resolve => meeting.server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => meeting.server.close(resolve)));
  const url = `http://127.0.0.1:${meeting.server.address().port}`;
  const request = async (route, body, headers = {}) => {
    const response = await fetch(url + route, { method: body === undefined ? 'GET' : 'POST',
      headers: { Origin: url, 'Content-Type': 'application/json', 'X-Meeting-Token': meeting.token, ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
  };
  return { dir, settingsFile, request };
}
const fileText = value => JSON.stringify(buildSettingsFile(value), null, 2);

test('2판을 만들고 다시 읽으면 같은 값이다', () => {
  const value = { summaryModel: FIRST, defaultOutputFormat: 'custom', customFormat: custom, storage: { audio: 'D:\\회의\\원음', transcript: '', summary: '\\\\서버\\공유\\요약 😀' } };
  const file = buildSettingsFile(value);
  assert.deepEqual(Object.keys(file), ['format', 'version', 'summaryModel', 'defaultOutputFormat', 'customFormat', 'storage']);
  assert.equal(file.format, FORMAT);
  assert.equal(FORMAT, 'voicenote-settings');
  assert.equal(file.version, VERSION);
  assert.equal(VERSION, 2);
  assert.deepEqual(parseSettingsFile(JSON.stringify(file, null, 2)), value);
  const bytes = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(JSON.stringify(file))]);
  assert.deepEqual(parseSettingsFile(bytes), value, '바이트로 받은 BOM 파일');
  // 저장 위치가 없는 파일(Android가 만든 파일)과 내 형식이 없는 파일도 같은 값으로 돌아온다.
  const phone = { summaryModel: SECOND, defaultOutputFormat: 'tasks', customFormat: null };
  assert.deepEqual(Object.keys(buildSettingsFile(phone)), ['format', 'version', 'summaryModel', 'defaultOutputFormat', 'customFormat']);
  assert.deepEqual(parseSettingsFile(fileText(phone)), phone);
  assert.doesNotMatch(fileText(value), /apiKey|trial|usage|revision|projects/);
});

test('허용하지 않는 칸·잘못된 값·128KiB 초과·깨진 UTF-8을 거절하고 BOM은 받는다', () => {
  const valid = buildSettingsFile({ summaryModel: FIRST, defaultOutputFormat: 'meeting', customFormat: custom, storage: { audio: 'C:\\회의', transcript: '', summary: '' } });
  const json = value => JSON.stringify(value);
  const edit = change => { const copy = structuredClone(valid); change(copy); return json(copy); };
  const pad = (text, bytes) => text + ' '.repeat(bytes - Buffer.byteLength(text));
  const accepted = {
    'BOM': '\uFEFF' + json(valid),
    '정확히128KiB': pad(json(valid), MAX_BYTES),
    'BOM포함128KiB': '\uFEFF' + pad(json(valid), MAX_BYTES - 3),
    '저장위치모두빈값': edit(v => { v.storage = { ...emptyStorage }; }),
    '경로1000자': edit(v => { v.storage.audio = 'C:\\' + '가'.repeat(997); }),
    '모델100자': edit(v => { v.summaryModel = 'm'.repeat(100); }),
  };
  for (const [name, source] of Object.entries(accepted)) assert.doesNotThrow(() => parseSettingsFile(source), name);
  const [head, tail] = json(valid).split('주간 보고');
  const rejected = {
    '128KiB초과': pad(json(valid), MAX_BYTES + 1),
    'BOM때문에초과': '\uFEFF' + pad(json(valid), MAX_BYTES - 2),
    '깨진UTF8': Buffer.concat([Buffer.from(head), Buffer.from([0xc3, 0x28]), Buffer.from(tail)]),
    '루트추가키': edit(v => { v.apiKey = 'sk-test'; }),
    '저장위치추가키': edit(v => { v.storage.backup = ''; }),
    '저장위치빠진종류': edit(v => { delete v.storage.summary; }),
    '저장위치숫자': edit(v => { v.storage.audio = 1; }),
    '저장위치null': edit(v => { v.storage = null; }),
    '경로1001자': edit(v => { v.storage.audio = 'C:\\' + '가'.repeat(998); }),
    '모델없음': edit(v => { delete v.summaryModel; }),
    '모델빈값': edit(v => { v.summaryModel = ''; }),
    '모델숫자': edit(v => { v.summaryModel = 5; }),
    '모델101자': edit(v => { v.summaryModel = 'm'.repeat(101); }),
    '모르는기본형식': edit(v => { v.defaultOutputFormat = 'report'; }),
    '기본형식없음': edit(v => { delete v.defaultOutputFormat; }),
    '내형식칸없음': edit(v => { delete v.customFormat; }),
    '잘못된내형식': edit(v => { v.customFormat = { name: '', sections: [] }; }),
    '버전3': edit(v => { v.version = 3; }),
    '버전1': edit(v => { v.version = 1; }),
    '버전문자': edit(v => { v.version = '2'; }),
    '다른형식': edit(v => { v.format = 'other'; }),
    '배열루트': '[]',
    '빈파일': '',
    '뒤쉼표': json(valid).replace(/}$/, ',}'),
  };
  for (const [name, source] of Object.entries(rejected))
    assert.throws(() => parseSettingsFile(source), error => error.status === 400 && Boolean(error.message), name);
  assert.throws(() => parseSettingsFile(rejected['깨진UTF8']), /UTF-8/);
  assert.throws(() => parseSettingsFile(rejected['버전3']), /새 버전\(3\)/);
  assert.throws(() => parseSettingsFile(rejected['128KiB초과']), /128KiB/);
});

test('1판 파일은 정해진 문구로 거절한다', async t => {
  assert.equal(LEGACY_MESSAGE, '이전 버전의 프로젝트 설정 파일입니다. 프로젝트 기능이 없어져 불러올 수 없습니다.');
  const legacy = JSON.stringify({ format: 'voicenote-project-settings', version: 1, projects: [] });
  assert.throws(() => parseSettingsFile(legacy), { message: LEGACY_MESSAGE });
  const server = await start(t);
  const before = await server.request('/api/settings');
  for (const route of ['/api/settings/preview', '/api/settings/import']) {
    const result = await server.request(route, { file: legacy });
    assert.equal(result.status, 400, route);
    assert.equal(result.body.error.message, LEGACY_MESSAGE, route);
  }
  assert.deepEqual(await server.request('/api/settings'), before);
  assert.equal(fs.existsSync(server.settingsFile), false);
  assert.equal((await server.request('/api/project-settings/export')).status, 404, '1판 경로는 없앴다');
});

test('storage가 없는 파일은 지금 저장 위치를 유지하고 빈 값 종류는 사용 안 함으로 바꾼다', async t => {
  const server = await start(t);
  const [audio, transcript, summary] = [folder(t), folder(t), folder(t)];
  assert.equal((await server.request('/api/settings', { storage: { audio, transcript, summary } })).status, 200);
  const base = { summaryModel: FIRST, defaultOutputFormat: 'summary', customFormat: null };
  const kept = await server.request('/api/settings/import', { file: fileText(base) });
  assert.equal(kept.status, 200);
  assert.deepEqual(kept.body.settings, { summaryModel: FIRST, defaultOutputFormat: 'summary', storage: { audio, transcript, summary } });
  assert.deepEqual(kept.body.skipped, []);
  const preview = await server.request('/api/settings/preview', { file: fileText(base) });
  assert.equal(preview.body.preview.storage, null);
  const cleared = await server.request('/api/settings/import', { file: fileText({ ...base, storage: { audio: '', transcript: summary, summary: '' } }) });
  assert.deepEqual(cleared.body.settings.storage, { audio: '', transcript: summary, summary: '' });
  assert.deepEqual((await server.request('/api/settings')).body.settings.storage, { audio: '', transcript: summary, summary: '' });
  assert.deepEqual(JSON.parse(fs.readFileSync(server.settingsFile, 'utf8')).storage, { audio: '', transcript: summary, summary: '' });
});

test('이 PC에 없는 폴더는 건너뛰고 미리보기와 skipped에 이유를 담는다', async t => {
  const server = await start(t);
  const [kept, next] = [folder(t), folder(t)];
  await server.request('/api/settings', { storage: { audio: kept } });
  const missing = path.join(folder(t), '없는 폴더');
  const file = fileText({ summaryModel: FIRST, defaultOutputFormat: 'meeting', customFormat: custom, storage: { audio: missing, transcript: next, summary: '' } });
  const preview = await server.request('/api/settings/preview', { file });
  assert.equal(preview.status, 200);
  assert.deepEqual(preview.body.preview, {
    summaryModel: { value: FIRST, apply: true },
    defaultOutputFormat: { value: 'meeting', apply: true },
    customFormat: { name: custom.name, apply: true },
    storage: { audio: { value: missing, apply: false, reason: MISSING }, transcript: { value: next, apply: true }, summary: { value: '', apply: true } },
  });
  assert.equal(fs.existsSync(path.join(server.dir, '회의자료', '내형식.json')), false, '미리보기는 아무것도 쓰지 않는다');
  const imported = await server.request('/api/settings/import', { file });
  assert.equal(imported.status, 200);
  assert.deepEqual(imported.body.settings.storage, { audio: kept, transcript: next, summary: '' });
  assert.deepEqual(imported.body.customFormat, custom);
  assert.deepEqual(imported.body.skipped, [`오디오 저장 위치: ${MISSING}`]);
  assert.deepEqual((await server.request('/api/custom-format')).body.customFormat, custom);
});

test('목록에 없는 요약 모델은 적용하지 않는다', async t => {
  const server = await start(t);
  await server.request('/api/settings', { summaryModel: SECOND });
  const file = fileText({ summaryModel: 'gpt-없는-모델', defaultOutputFormat: 'tasks', customFormat: null });
  const preview = await server.request('/api/settings/preview', { file });
  assert.deepEqual(preview.body.preview.summaryModel, { value: 'gpt-없는-모델', apply: false, reason: '이 앱의 요약 모델 목록에 없어 적용하지 않습니다.' });
  assert.deepEqual(preview.body.preview.customFormat, { name: null, apply: true });
  const imported = await server.request('/api/settings/import', { file });
  assert.equal(imported.body.settings.summaryModel, SECOND);
  assert.equal(imported.body.settings.defaultOutputFormat, 'tasks');
  assert.deepEqual(imported.body.skipped, ['요약 모델: 이 앱의 요약 모델 목록에 없어 적용하지 않습니다.']);
  assert.equal((await server.request('/api/config')).body.summaryModel, SECOND);
});

test('파일에 내 형식이 없으면 지금 내 형식을 지우고, 지우지 못하면 다른 값도 되돌린다', async t => {
  const server = await start(t);
  assert.equal((await server.request('/api/custom-format', custom)).status, 200);
  const file = fileText({ summaryModel: FIRST, defaultOutputFormat: 'custom', customFormat: null });
  assert.deepEqual((await server.request('/api/settings/preview', { file })).body.preview.customFormat, { name: null, apply: true });
  const imported = await server.request('/api/settings/import', { file });
  assert.equal(imported.status, 200);
  assert.equal(imported.body.customFormat, null);
  assert.equal(imported.body.settings.defaultOutputFormat, 'custom');
  assert.deepEqual((await server.request('/api/custom-format')).body, { customFormat: null });
  const locked = await start(t, { removeFile: () => { throw new Error('다른 프로그램이 파일을 쓰고 있습니다.'); } });
  await locked.request('/api/settings', { summaryModel: SECOND });
  assert.equal((await locked.request('/api/custom-format', custom)).status, 200);
  const bytes = fs.readFileSync(locked.settingsFile);
  const failed = await locked.request('/api/settings/import', { file: fileText({ summaryModel: FIRST, defaultOutputFormat: 'tasks', customFormat: null }) });
  assert.equal(failed.status, 503);
  assert.equal(failed.body.error.code, 'SETTINGS_IMPORT_FAILED');
  assert.deepEqual(fs.readFileSync(locked.settingsFile), bytes);
  assert.deepEqual((await locked.request('/api/custom-format')).body.customFormat, custom);
  assert.deepEqual((await locked.request('/api/settings')).body.settings, { summaryModel: SECOND, defaultOutputFormat: 'meeting', storage: emptyStorage });
});

test('내 형식 저장이 실패하면 다른 값도 이전으로 되돌린다', async t => {
  const failing = (file, content) => { if (path.basename(file) === '내형식.json') throw new Error('디스크가 가득 찼습니다.'); fs.writeFileSync(file, content); };
  const server = await start(t, { atomicWrite: failing });
  await server.request('/api/settings', { summaryModel: SECOND, defaultOutputFormat: 'summary' });
  const bytes = fs.readFileSync(server.settingsFile);
  const before = await server.request('/api/settings');
  const file = fileText({ summaryModel: FIRST, defaultOutputFormat: 'tasks', customFormat: custom, storage: { audio: folder(t), transcript: '', summary: '' } });
  const result = await server.request('/api/settings/import', { file });
  assert.equal(result.status, 503);
  assert.equal(result.body.error.code, 'SETTINGS_IMPORT_FAILED');
  assert.deepEqual(await server.request('/api/settings'), before);
  assert.deepEqual(fs.readFileSync(server.settingsFile), bytes);
  assert.deepEqual((await server.request('/api/custom-format')).body, { customFormat: null });
  assert.equal((await server.request('/api/config')).body.summaryModel, SECOND);
});

test('POST /api/settings는 쓸 수 없는 폴더를 거절한다', async t => {
  const server = await start(t);
  const dir = folder(t);
  const notFolder = path.join(dir, '파일.txt');
  fs.writeFileSync(notFolder, '파일');
  const before = await server.request('/api/settings');
  const cases = [
    [path.join(dir, '없는 폴더'), MISSING],
    [notFolder, '폴더가 아닌 파일입니다. 폴더를 골라 주세요.'],
    ['상대\\경로', '폴더는 드라이브부터 적은 전체 경로로 골라 주세요.'],
  ];
  for (const [value, message] of cases) {
    const result = await server.request('/api/settings', { storage: { audio: value } });
    assert.equal(result.status, 400, value);
    assert.equal(result.body.error.message, message, value);
    assert.deepEqual(checkFolder(value), { ok: false, message }, value);
  }
  for (const body of [{ storage: { backup: dir } }, { storage: { audio: 1 } }, { storage: 'C:\\' }, { defaultOutputFormat: 'report' }, { summaryModel: 'gpt-없는-모델' }, { theme: 'dark' }])
    assert.equal((await server.request('/api/settings', body)).status, 400, JSON.stringify(body));
  assert.deepEqual(await server.request('/api/settings'), before);
  // 쓸 수 있는 폴더는 저장하고, 확인용으로 만든 파일은 남기지 않는다.
  const saved = await server.request('/api/settings', { storage: { audio: dir }, defaultOutputFormat: 'custom' });
  assert.equal(saved.status, 200);
  assert.deepEqual(saved.body.settings, { summaryModel: FIRST, defaultOutputFormat: 'custom', storage: { ...emptyStorage, audio: dir } });
  assert.deepEqual(fs.readdirSync(dir), ['파일.txt']);
  assert.deepEqual(checkFolder(dir), { ok: true, message: '' });
});

test('summaryModel만 있는 옛 AI설정.json을 읽으면 기본 형식 meeting, 저장 위치 빈 값이다', async t => {
  const dir = folder(t);
  const settingsFile = path.join(dir, 'AI설정.json');
  fs.writeFileSync(settingsFile, JSON.stringify({ summaryModel: SECOND }));
  const server = await start(t, { dir, settingsFile });
  const expected = { summaryModel: SECOND, defaultOutputFormat: 'meeting', storage: emptyStorage };
  assert.deepEqual((await server.request('/api/settings')).body, { settings: expected });
  assert.deepEqual((await server.request('/api/config')).body.settings, expected);
  await server.request('/api/settings', { defaultOutputFormat: 'tasks' });
  assert.deepEqual(JSON.parse(fs.readFileSync(settingsFile, 'utf8')), { summaryModel: SECOND, defaultOutputFormat: 'tasks', storage: emptyStorage });
});

test('새 설치에서 기본 형식만 저장하면 요약 모델은 앱 기본값을 계속 따른다', async t => {
  const server = await start(t);
  assert.equal((await server.request('/api/settings', { defaultOutputFormat: 'summary' })).status, 200);
  assert.deepEqual(JSON.parse(fs.readFileSync(server.settingsFile, 'utf8')), { defaultOutputFormat: 'summary', storage: emptyStorage });
  assert.equal((await server.request('/api/settings')).body.settings.summaryModel, aiModels.DEFAULT_SUMMARY_MODEL);
});

test('진행 중에는 설정 변경이 409다', async t => {
  let release, reached;
  const waiting = new Promise(resolve => { release = resolve; });
  const called = new Promise(resolve => { reached = resolve; });
  const minutes = { suggestedTitle: '시험', overview: '시험', topics: [], decisions: [], actions: [], openQuestions: [] };
  const server = await start(t, { apiFetch: async () => {
    reached();
    await waiting;
    return Response.json({ status: 'completed', usage: { input_tokens: 1, output_tokens: 1 }, output: [{ type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: JSON.stringify(minutes) }] }] });
  } });
  assert.equal((await server.request('/api/key', { apiKey: 'mock-only', persist: false })).status, 200);
  const summary = server.request('/api/summary', { title: '시험', date: '2026-10-23', participants: '', text: '설정 잠금을 확인합니다.' }, { 'X-Operation-Id': randomUUID() });
  await called;
  const file = fileText({ summaryModel: FIRST, defaultOutputFormat: 'tasks', customFormat: null });
  for (const [route, body] of [['/api/settings', { defaultOutputFormat: 'tasks' }], ['/api/settings/import', { file }]]) {
    const result = await server.request(route, body);
    assert.equal(result.status, 409, route);
    assert.equal(result.body.error.code, 'BUSY', route);
  }
  assert.equal((await server.request('/api/settings')).status, 200, '읽기는 막지 않는다');
  assert.equal((await server.request('/api/settings/preview', { file })).status, 200, '미리보기는 막지 않는다');
  release();
  assert.equal((await summary).status, 200);
  assert.equal((await server.request('/api/settings')).body.settings.defaultOutputFormat, 'meeting');
});
