// 화면의 설정 내보내기·불러오기 확인 흐름, 출력 형식 선택, 기본 키 체험 안내가 상태와 요청에 맞게 이어지는지 검증한다.
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const crypto = require('node:crypto');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const minutes = { overview: '업무 요약 문장', topics: [{ title: '배경', points: ['설명'] }], decisions: [], actions: [{ task: '초안 작성', owner: null, due: null }], openQuestions: ['기한 미정'] };
const project = (slot, name = '', extra = {}) => ({ slot, name, title: name ? '주간 회의' : '', context: '', outputFormat: 'meeting', revision: name ? 2 : 0, ...extra });

function fixture({ routes = {}, confirmAnswer = true } = {}) {
  const element = (tag = 'div') => {
    const listeners = {};
    const node = { tag, value: '', checked: false, style: {}, hidden: false, disabled: false, open: false, textContent: '', dataset: {}, children: [], attributes: {},
      classList: { add() {}, remove() {} }, removeAttribute(name) { delete this.attributes[name]; }, setAttribute(name, value) { this.attributes[name] = value; },
      addEventListener(type, fn) { (listeners[type] ||= []).push(fn); }, dispatch(type, event = {}) { for (const fn of listeners[type] || []) fn({ target: node, ...event }); },
      querySelectorAll() { return []; }, querySelector() { return null; }, append(...items) { this.children.push(...items); }, replaceChildren(...items) { this.children = items; },
      remove() {}, focus() {}, click() { this.clicked = (this.clicked || 0) + 1; this.dispatch('click'); }, showModal() { this.open = true; }, close() { this.open = false; this.dispatch('close'); } };
    return node;
  };
  const nodes = new Map(), calls = [], downloads = [], messages = [];
  const json = (body, status = 200) => Response.json(body, { status });
  const sandbox = { crypto, Blob, AbortController, DOMException, TextDecoder, setTimeout, clearTimeout, setInterval, clearInterval,
    confirm: () => confirmAnswer, window: { addEventListener() {}, MeetingFormats: require('./출력형식.js') },
    URL: { createObjectURL: (blob) => { downloads.push(blob); return 'blob:test'; }, revokeObjectURL() {} },
    document: { body: element('body'), getElementById(id) { if (!nodes.has(id)) nodes.set(id, element()); return nodes.get(id); }, createElement: element },
    async fetch(url, options = {}) {
      calls.push({ url, options, body: typeof options.body === 'string' ? JSON.parse(options.body) : options.body });
      if (routes[url]) return routes[url](calls.at(-1));
      if (url === '/api/summary') return json({ minutes });
      if (url.startsWith('/api/trial/')) return json({ accessMode: 'trial', trialLimit: 3, trialRemaining: 2, mustRegister: false });
      if (url === '/api/projects/1/meetings' && options.method === 'POST') return json({ meeting: { dailySequence: 1 } });
      if (url === '/api/projects/1/meetings') return json({ meetings: [] });
      return json({});
    } };
  const original = fs.readFileSync(path.join(__dirname, '화면/app.js'), 'utf8');
  const source = original.replace(/  init\(\);\s*\}\)\(\);\s*$/,
    '  globalThis.review = { state, ui, bind, refresh, applyProject, renderMinutes, lines, exportDocument, summarize, openMeeting, startBlockers, applyAccess, exportSettings, chooseSettingsFile, previewSettings, stale, presetChanged, savePreset };\n})();');
  assert.notEqual(source, original);
  vm.runInNewContext(source, sandbox);
  const review = sandbox.review;
  review.bind();
  const status = nodes.get('status');
  const announce = () => status.textContent;
  review.state.projects = Array.from({ length: 9 }, (_, i) => project(i + 1, i ? '' : '기존 프로젝트'));
  review.applyProject(1);
  return { ...review, calls, downloads, announce, messages, nodes };
}
const file = (text, name = '설정.json', bytes = new TextEncoder().encode(text)) => ({ name, size: bytes.length, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length) });
const pick = async (review, value) => review.previewSettings({ target: { files: [value], value: 'C:\\fakepath\\설정.json' } });
const previewRoute = (names) => () => Response.json({ projects: Array.from({ length: 9 }, (_, i) => ({ slot: i + 1, name: names[i] || '', outputFormat: i === 1 ? 'tasks' : 'meeting' })) });
const texts = (node) => [node.textContent, ...(node.children || []).flatMap(texts)].filter(Boolean);

test('미리보기는 이름을 글자로만 보여 주고 취소하면 설정을 바꾸지 않는다', async () => {
  const xss = '<img src=x onerror=alert(1)>';
  const review = fixture({ routes: { '/api/project-settings/preview': previewRoute(['예시 프로젝트 문서 표준화', xss]) } });
  const before = JSON.stringify(review.state.projects);
  await pick(review, file('{"format":"voicenote-project-settings"}'));
  const preview = review.calls.find((call) => call.url === '/api/project-settings/preview');
  assert.equal(preview.body.file, '{"format":"voicenote-project-settings"}');
  assert.equal(review.ui['settings-import'].open, true);
  const rows = review.ui['settings-preview'].children;
  assert.equal(rows.length, 9);
  assert.deepEqual(texts(rows[1]), ['2', xss, '업무 정리']);
  assert.deepEqual(texts(rows[2]), ['3', '비어 있음']);
  assert.doesNotMatch(fs.readFileSync(path.join(__dirname, '화면/app.js'), 'utf8'), /innerHTML|insertAdjacentHTML|outerHTML/);
  review.ui['settings-import'].close();
  review.ui['confirm-import'].click();
  assert.equal(review.calls.some((call) => call.url === '/api/project-settings/import'), false);
  assert.equal(JSON.stringify(review.state.projects), before);
});

test('확인하면 미리보기 때의 revision과 같은 파일로 9개를 교체하고 화면 목록을 새로 그린다', async () => {
  const replaced = Array.from({ length: 9 }, (_, i) => project(i + 1, i === 0 ? '예시 프로젝트 문서 표준화' : '', { revision: 3 }));
  const review = fixture({ routes: { '/api/project-settings/preview': previewRoute(['예시 프로젝트 문서 표준화']), '/api/project-settings/import': () => Response.json({ projects: replaced }) } });
  await pick(review, file('파일 내용'));
  review.ui['confirm-import'].click();
  await new Promise((resolve) => setTimeout(resolve, 10));
  const applied = review.calls.find((call) => call.url === '/api/project-settings/import');
  assert.deepEqual(applied.body, { file: '파일 내용', revisions: [2, 0, 0, 0, 0, 0, 0, 0, 0] });
  assert.equal(review.state.projects[0].name, '예시 프로젝트 문서 표준화');
  assert.equal(review.ui['header-project'].textContent, '예시 프로젝트 문서 표준화');
  assert.equal(review.ui['settings-import'].open, false);
  assert.match(review.announce(), /회의와 녹음은 그대로/);
});

test('서버 검증 실패나 동시 수정 거절이면 현재 설정을 그대로 둔다', async () => {
  const rejected = fixture({ routes: { '/api/project-settings/preview': () => Response.json({ error: { message: '5번 프로젝트가 중복됐습니다.' } }, { status: 400 }) } });
  await pick(rejected, file('{}'));
  assert.equal(rejected.ui['settings-import'].open, false);
  assert.match(rejected.announce(), /중복됐습니다.*현재 설정은 바뀌지 않았습니다/);
  assert.equal(rejected.state.pendingImport, null);

  const conflict = fixture({ routes: { '/api/project-settings/preview': previewRoute(['새 이름']),
    '/api/project-settings/import': () => Response.json({ error: { message: '다른 창에서 프로젝트 설정이 바뀌었습니다.' } }, { status: 409 }) } });
  const before = JSON.stringify(conflict.state.projects);
  await pick(conflict, file('{}'));
  conflict.ui['confirm-import'].click();
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(JSON.stringify(conflict.state.projects), before);
  assert.match(conflict.announce(), /바꾸지 못했습니다.*다른 창/);
});

test('원본 바이트가 128KiB를 넘거나 UTF-8이 손상된 파일은 서버로 보내지 않는다', async () => {
  const review = fixture();
  const bom = new Uint8Array(131073); bom.set([0xef, 0xbb, 0xbf]);
  await pick(review, file('', 'bom.json', bom));
  assert.match(review.announce(), /128KiB/);
  const lying = { name: 'x.json', size: 10, arrayBuffer: async () => new Uint8Array(131073).buffer };
  await pick(review, lying);
  assert.match(review.announce(), /128KiB/);
  await pick(review, file('', 'broken.json', new Uint8Array([0x7b, 0xff, 0x7d])));
  assert.match(review.announce(), /UTF-8 설정 파일이 아닙니다/);
  assert.equal(review.calls.some((call) => call.url.startsWith('/api/project-settings/')), false);
});

test('녹음·마이크 허가·AI 분석 중에는 설정 파일 선택과 내보내기를 막는다', async () => {
  const review = fixture();
  review.state.recorders.add({});
  review.refresh();
  assert.equal(review.ui['import-settings'].disabled, true);
  review.chooseSettingsFile();
  assert.equal(review.ui['settings-file'].clicked || 0, 0);
  review.state.recorders.clear();
  review.state.aiController = new AbortController();
  await pick(review, file('{}'));
  await review.exportSettings();
  assert.equal(review.calls.length, 0);
  review.state.aiController = null;
  review.state.permissionPending = true;
  review.refresh();
  assert.equal(review.ui['export-settings'].disabled, true);
});

test('저장하지 않은 프리셋 입력이 있으면 내보내기 전에 묻고 취소하면 아무것도 받지 않는다', async () => {
  const exported = { format: 'voicenote-project-settings', version: 1, projects: [] };
  const cancelled = fixture({ confirmAnswer: false, routes: { '/api/project-settings/export': () => Response.json({ file: exported }) } });
  cancelled.ui['project-name'].value = '아직 저장 안 한 이름';
  await cancelled.exportSettings();
  assert.equal(cancelled.calls.length, 0);
  assert.equal(cancelled.ui['project-name'].value, '아직 저장 안 한 이름');
  const accepted = fixture({ routes: { '/api/project-settings/export': () => Response.json({ file: exported }) } });
  accepted.ui['output-format'].value = 'summary';
  await accepted.exportSettings();
  assert.deepEqual(JSON.parse(await accepted.downloads[0].text()), exported);
  assert.equal(accepted.ui['output-format'].value, 'summary');
});

test('선택한 출력 형식을 요청·저장·내보내기·화면에 쓰고 분석 식별자로 체험을 확정한다', async () => {
  const review = fixture();
  review.state.keyConfigured = true;
  review.ui['ai-consent'].checked = true;
  review.ui['output-format'].value = 'tasks';
  review.ui.transcript.value = '초안을 작성합니다.';
  await review.summarize(true);
  const request = review.calls.find((call) => call.url === '/api/summary');
  assert.equal(request.body.outputFormat, 'tasks');
  const analysisId = request.options.headers['X-Analysis-Id'];
  assert.match(analysisId, /^[0-9a-f-]{36}$/);
  const finish = review.calls.find((call) => call.url === '/api/trial/finish');
  assert.equal(finish.body.analysisId, analysisId);
  assert.equal(review.calls.some((call) => call.url === '/api/trial/release'), false);
  assert.equal(review.calls.find((call) => call.url === '/api/projects/1/meetings' && call.options.method === 'POST').body.outputFormat, 'tasks');
  assert.equal(review.exportDocument().outputFormat, 'tasks');
  const headings = texts(review.ui.minutes).filter((value) => ['업무 요약', '할 일', '미확정 항목', '상세 회의 내용', '합의된 방향'].includes(value));
  assert.deepEqual(headings, ['업무 요약', '할 일', '미확정 항목']);
  assert.ok(texts(review.ui.minutes).includes('초안 작성 · 담당 미정 · 기한 미정'));
  assert.match(review.lines().join('\n'), /## 할 일\n- 초안 작성 · 담당 미정 · 기한 미정/);
  review.ui['output-format'].value = 'summary';
  assert.equal(review.stale(), true);
  review.renderMinutes();
  assert.ok(texts(review.ui.minutes).includes('업무 요약'));
});

test('분석이 실패하면 체험 예약을 회수하고 소진 응답이면 새 키 등록 안내와 AI 설정을 연다', async () => {
  const review = fixture({ routes: { '/api/summary': () => Response.json({ error: { code: 'TRIAL_EXHAUSTED', message: '새로운 API키를 등록하세요.', mustRegister: true } }, { status: 403 }),
    '/api/config': () => Response.json({ accessMode: 'exhausted', trialLimit: 3, trialRemaining: 0, mustRegister: true }) } });
  review.applyAccess({ accessMode: 'trial', trialLimit: 3, trialRemaining: 1, mustRegister: false });
  review.ui['ai-consent'].checked = true;
  review.ui.transcript.value = '전사';
  await review.summarize(true);
  const id = review.calls.find((call) => call.url === '/api/summary').options.headers['X-Analysis-Id'];
  assert.equal(review.calls.find((call) => call.url === '/api/trial/release').body.analysisId, id);
  assert.equal(review.calls.some((call) => call.url === '/api/trial/finish'), false);
  assert.equal(review.announce(), '새로운 API키를 등록하세요.');
  assert.equal(review.ui['ai-settings'].open, true);
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(review.state.access.accessMode, 'exhausted');
  assert.ok(review.startBlockers().some((item) => item.startsWith('새로운 API키를 등록하세요.')));
});

test('입력칸이 CRLF를 LF로 바꿔도 변경으로 보지 않고 다른 항목 저장 때 설명 원문을 보낸다', async () => {
  const context = '  첫 줄\r\n둘째 줄\r\n  ';
  let revision = 2;
  const review = fixture({ routes: { '/api/projects/1': (call) => Response.json({ project: { ...call.body, slot: 1, revision: ++revision } }) } });
  review.state.projects[0] = { ...review.state.projects[0], context };
  review.applyProject(1);
  review.ui['meeting-context'].value = context.replace(/\r\n/g, '\n');
  assert.equal(review.presetChanged(), false);
  review.ui.title.value = '바뀐 회의명';
  assert.equal(review.presetChanged(), true);
  await review.savePreset();
  const body = review.calls.find((call) => call.url === '/api/projects/1').body;
  assert.equal(body.context, context);
  review.ui['meeting-context'].value = '  고친 설명  ';
  assert.equal(review.presetChanged(), true);
  await review.savePreset();
  assert.equal(review.calls.filter((call) => call.url === '/api/projects/1').at(-1).body.context, '  고친 설명  ');
});

test('체험을 모두 쓴 뒤 분석을 누르면 요청 없이 정확한 새 키 안내와 AI 설정을 연다', async () => {
  const review = fixture();
  review.applyAccess({ accessMode: 'exhausted', trialLimit: 3, trialRemaining: 0, mustRegister: true });
  review.ui['ai-consent'].checked = true;
  review.ui.transcript.value = '전사';
  review.refresh();
  assert.equal(review.ui.summarize.disabled, false);
  await review.summarize(true);
  assert.equal(review.calls.some((call) => call.url === '/api/summary'), false);
  assert.equal(review.announce(), '새로운 API키를 등록하세요.');
  assert.equal(review.ui['ai-settings'].open, true);
});

test('체험 확정 저장이 실패해도 결과는 보관하고 경고를 완료 안내와 함께 남기며 예약을 회수하지 않는다', async () => {
  const review = fixture({ routes: { '/api/trial/finish': () => Response.json({ error: { code: 'TRIAL_STORAGE_FAILED', message: '폴더의 쓰기 권한을 확인해 주세요.' } }, { status: 500 }) } });
  review.applyAccess({ accessMode: 'trial', trialLimit: 3, trialRemaining: 3, mustRegister: false });
  review.ui['ai-consent'].checked = true;
  review.ui.transcript.value = '전사';
  await review.summarize(true);
  assert.equal(review.calls.filter((call) => call.url === '/api/trial/finish').length, 2);
  assert.equal(review.calls.some((call) => call.url === '/api/trial/release'), false);
  assert.match(review.announce(), /회의록을 보관했습니다.*체험 횟수 기록을 저장하지 못했습니다/);
  assert.ok(review.state.minutes);
});

test('체험 중에는 남은 횟수를 보여 주고 지난 회의를 열면 저장된 출력 형식으로 다시 보여 준다', async () => {
  const review = fixture();
  review.applyAccess({ accessMode: 'trial', trialLimit: 3, trialRemaining: 2, mustRegister: false });
  review.refresh();
  assert.equal(review.ui['ai-status-label'].textContent, '체험 2/3');
  assert.match(review.ui['key-state'].textContent, /남은 분석 2\/3회/);
  assert.equal(review.startBlockers().some((item) => /API 키/.test(item)), false);
  const meeting = { id: crypto.randomUUID(), title: '지난 회의', date: '2026-10-01', participants: '', context: '', transcript: '전사', minutes, outputFormat: 'summary', audio: [] };
  const opened = fixture({ routes: { [`/api/projects/1/meetings/${meeting.id}`]: () => Response.json({ meeting }) } });
  await opened.openMeeting(meeting.id);
  assert.equal(opened.ui['output-format'].value, 'summary');
  assert.equal(opened.stale(), false);
  const shown = texts(opened.ui.minutes);
  assert.ok(shown.includes('핵심 요약') && shown.includes('후속 작업') && !shown.includes('상세 회의 내용') && !shown.includes('결정 사항'));
});
