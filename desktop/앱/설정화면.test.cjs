// 설정 창(AI 연결·출력 형식·저장 위치·설정 파일·회의자료 폴더)과 출력 형식 선택, 기본 키 체험 안내가 상태와 요청에 맞게 이어지는지 검증한다.
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const crypto = require('node:crypto');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const minutes = { overview: '업무 요약 문장', topics: [{ title: '배경', points: ['설명'] }], decisions: [], actions: [{ task: '초안 작성', owner: null, due: null }], openQuestions: ['기한 미정'] };

function fixture({ routes = {}, confirmAnswer = true, webview = false } = {}) {
  const element = (tag = 'div') => {
    const listeners = {};
    const node = { tag, value: '', checked: false, style: {}, hidden: false, disabled: false, open: false, textContent: '', dataset: {}, children: [], attributes: {},
      classList: { add() {}, remove() {} }, removeAttribute(name) { delete this.attributes[name]; }, setAttribute(name, value) { this.attributes[name] = value; },
      addEventListener(type, fn) { (listeners[type] ||= []).push(fn); }, dispatch(type, event = {}) { for (const fn of listeners[type] || []) fn({ target: node, ...event }); },
      querySelectorAll() { return []; }, querySelector() { return null; }, append(...items) { this.children.push(...items); }, replaceChildren(...items) { this.children = items; },
      remove() {}, focus() {}, click() { this.clicked = (this.clicked || 0) + 1; this.dispatch('click'); }, showModal() { this.open = true; }, close() { this.open = false; this.dispatch('close'); } };
    return node;
  };
  const nodes = new Map(), calls = [], downloads = [], messages = [], anchors = [], webviewListeners = [];
  const json = (body, status = 200) => Response.json(body, { status });
  const sandbox = { crypto, Blob, AbortController, DOMException, TextDecoder, setTimeout, clearTimeout, setInterval, clearInterval,
    confirm: () => confirmAnswer, window: { addEventListener() {}, MeetingFormats: require('./출력형식.js'),
      // 웹뷰(Windows 창) 안에서는 화면과 창이 메시지를 주고받는다. 시험은 보낸 메시지를 모으고 받은 메시지를 직접 넣는다.
      ...(webview ? { chrome: { webview: { postMessage(message) { messages.push(message); }, addEventListener(type, fn) { if (type === 'message') webviewListeners.push(fn); } } } } : {}) },
    URL: { createObjectURL: (blob) => { downloads.push(blob); return 'blob:test'; }, revokeObjectURL() {} },
    document: { body: element('body'), getElementById(id) { if (!nodes.has(id)) nodes.set(id, element()); return nodes.get(id); }, createElement(tag) { const node = element(tag); if (tag === 'a') anchors.push(node); return node; } },
    async fetch(url, options = {}) {
      calls.push({ url, options, body: typeof options.body === 'string' ? JSON.parse(options.body) : options.body });
      if (routes[url]) return routes[url](calls.at(-1));
      if (url === '/api/summary') return json({ minutes });
      if (url.startsWith('/api/trial/')) return json({ accessMode: 'trial', trialLimit: 3, trialRemaining: 2, mustRegister: false });
      if (url === '/api/meetings/main' && options.method === 'POST') return json({ meeting: { dailySequence: 1 } });
      if (url === '/api/meetings') return json({ meetings: [], skipped: 0 });
      return json({});
    } };
  const original = fs.readFileSync(path.join(__dirname, '화면/app.js'), 'utf8');
  const source = original.replace(/  init\(\);\s*\}\)\(\);\s*$/,
    '  globalThis.review = { state, ui, bind, refresh, resetMeetingForm, renderMinutes, lines, exportDocument, summarize, openMeeting, startBlockers, applyAccess, stale, openSettings, saveCustom, deleteCustom, exportSettings, previewSettings, applyImportedSettings };\n})();');
  assert.notEqual(source, original);
  vm.runInNewContext(source, sandbox);
  const review = sandbox.review;
  // 출력 형식 선택지의 '내 형식' 항목 이름이 바뀌는지 보도록 그 항목만 흉내 낸다.
  const customOptions = {};
  for (const id of ['output-format', 'default-format']) {
    const option = element('option');
    customOptions[id] = option;
    sandbox.document.getElementById(id).querySelector = (selector) => selector === 'option[value="custom"]' ? option : null;
  }
  review.bind();
  const status = nodes.get('status');
  const announce = () => status.textContent;
  review.resetMeetingForm();
  return { ...review, calls, downloads, anchors, announce, messages, nodes, receive: (data) => { for (const fn of webviewListeners) fn({ data }); }, customOption: (id) => customOptions[id] };
}
const texts = (node) => [node.textContent, ...(node.children || []).flatMap(texts)].filter(Boolean);

test('선택한 출력 형식을 요청·저장·내보내기·화면에 쓰고 분석 식별자로 체험을 확정한다', async () => {
  const review = fixture();
  review.state.keyConfigured = true;
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
  assert.equal(review.calls.find((call) => call.url === '/api/meetings/main' && call.options.method === 'POST').body.outputFormat, 'tasks');
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

test('분석이 실패하면 체험 예약을 회수하고 소진 응답이면 새 키 등록 안내와 설정 창을 연다', async () => {
  const review = fixture({ routes: { '/api/summary': () => Response.json({ error: { code: 'TRIAL_EXHAUSTED', message: '새로운 API키를 등록하세요.', mustRegister: true } }, { status: 403 }),
    '/api/config': () => Response.json({ accessMode: 'exhausted', trialLimit: 3, trialRemaining: 0, mustRegister: true }) } });
  review.applyAccess({ accessMode: 'trial', trialLimit: 3, trialRemaining: 1, mustRegister: false });
  review.ui.transcript.value = '전사';
  await review.summarize(true);
  const id = review.calls.find((call) => call.url === '/api/summary').options.headers['X-Analysis-Id'];
  assert.equal(review.calls.find((call) => call.url === '/api/trial/release').body.analysisId, id);
  assert.equal(review.calls.some((call) => call.url === '/api/trial/finish'), false);
  assert.equal(review.announce(), '새로운 API키를 등록하세요.');
  assert.equal(review.ui.settings.open, true);
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(review.state.access.accessMode, 'exhausted');
  assert.ok(review.startBlockers().some((item) => item.startsWith('새로운 API키를 등록하세요.')));
});

test('체험을 모두 쓴 뒤 분석을 누르면 요청 없이 정확한 새 키 안내와 설정 창을 연다', async () => {
  const review = fixture();
  review.applyAccess({ accessMode: 'exhausted', trialLimit: 3, trialRemaining: 0, mustRegister: true });
  review.ui.transcript.value = '전사';
  review.refresh();
  assert.equal(review.ui.summarize.disabled, false);
  await review.summarize(true);
  assert.equal(review.calls.some((call) => call.url === '/api/summary'), false);
  assert.equal(review.announce(), '새로운 API키를 등록하세요.');
  assert.equal(review.ui.settings.open, true);
});

test('체험 확정 저장이 실패해도 결과는 보관하고 경고를 완료 안내와 함께 남기며 예약을 회수하지 않는다', async () => {
  const review = fixture({ routes: { '/api/trial/finish': () => Response.json({ error: { code: 'TRIAL_STORAGE_FAILED', message: '폴더의 쓰기 권한을 확인해 주세요.' } }, { status: 500 }) } });
  review.applyAccess({ accessMode: 'trial', trialLimit: 3, trialRemaining: 3, mustRegister: false });
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
  const opened = fixture({ routes: { [`/api/meetings/main/${meeting.id}`]: () => Response.json({ meeting, versions: [] }) } });
  await opened.openMeeting('main', meeting.id);
  assert.equal(opened.ui['output-format'].value, 'summary');
  assert.equal(opened.stale(), false);
  const shown = texts(opened.ui.minutes);
  assert.ok(shown.includes('핵심 요약') && shown.includes('후속 작업') && !shown.includes('상세 회의 내용') && !shown.includes('결정 사항'));
});

const file = (text, name = '설정.json', bytes = new TextEncoder().encode(text)) => ({ name, size: bytes.length, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length) });
const pick = (review, value) => review.previewSettings({ target: { files: [value], value: 'C:\\fakepath\\설정.json' } });
const settle = async () => { for (let i = 0; i < 20; i++) await new Promise((resolve) => setTimeout(resolve, 0)); };
const html = fs.readFileSync(path.join(__dirname, '화면/index.html'), 'utf8');
const settingsValue = (change = {}) => ({ summaryModel: 'gpt-6.1-sol', defaultOutputFormat: 'meeting', storage: { audio: '', transcript: '', summary: '' }, ...change });
const LEGACY = '이전 버전의 프로젝트 설정 파일입니다. 프로젝트 기능이 없어져 불러올 수 없습니다.';

test('설정 버튼이 다섯 구역의 설정 창을 연다(웹뷰가 아니면 회의자료 폴더 구역이 없다)', () => {
  const start = html.indexOf('<dialog id="settings"');
  assert.ok(start > 0, '설정 창이 있다');
  const dialog = html.slice(start, html.indexOf('</dialog>', start));
  for (const id of ['settings-ai', 'settings-format', 'settings-storage', 'settings-file', 'settings-data']) assert.match(dialog, new RegExp(`id="${id}"`), id);
  assert.match(html, /<button id="open-settings"[^>]*>[\s\S]*?<span>설정<\/span>/);
  assert.doesNotMatch(html, /id="ai-settings"|id="open-ai-settings"|>AI 설정</);
  assert.doesNotMatch(html.slice(0, start), /id="custom-editor"|id="open-data-folder"/, '내 형식 편집과 회의자료 폴더 열기는 설정 창으로 옮긴다');
  for (const webview of [false, true]) {
    const review = fixture({ webview });
    review.ui['open-settings'].click();
    assert.equal(review.ui.settings.open, true);
    assert.equal(review.ui['settings-data'].hidden, !webview, `웹뷰 ${webview}`);
    for (const kind of ['audio', 'transcript', 'summary']) assert.equal(review.ui[`pick-${kind}`].hidden, !webview, kind);
  }
});

test('내 형식을 설정 창에서 저장·삭제하고 회의 준비 선택지에 반영한다', async () => {
  const saved = [];
  const review = fixture({ routes: { '/api/custom-format': (call) => {
    if (call.options.method === 'POST') { saved.push(call.body); return Response.json({ customFormat: call.body }); }
    return Response.json({ customFormat: null });
  } } });
  review.openSettings('settings-format');
  assert.equal(review.ui.settings.open, true);
  review.ui['custom-name'].value = '주간 보고';
  await review.saveCustom();
  assert.equal(saved[0].name, '주간 보고');
  assert.equal(review.state.customFormat.name, '주간 보고');
  assert.equal(review.customOption('output-format').textContent, '내 형식 · 주간 보고');
  assert.equal(review.customOption('default-format').textContent, '내 형식 · 주간 보고');
  review.ui['output-format'].value = 'custom';
  assert.equal(review.startBlockers().some((item) => /내 형식/.test(item)), false);
  await review.deleteCustom();
  assert.equal(review.state.customFormat, null);
  assert.equal(review.ui['output-format'].value, 'meeting');
  assert.doesNotMatch(review.customOption('output-format').textContent, /주간 보고/);
  // 회의 준비에서 저장된 것이 없는 내 형식을 고르면 설정의 출력 형식 구역으로 안내한다.
  review.ui.settings.close();
  review.ui['output-format'].value = 'custom';
  review.ui['output-format'].dispatch('change');
  assert.equal(review.ui['custom-missing'].hidden, false);
  assert.match(review.startBlockers().join(' '), /설정 › 출력 형식에서 내 형식을 먼저 만드세요/);
  review.ui['open-format-settings'].click();
  assert.equal(review.ui.settings.open, true);
});

test('기본 출력 형식을 바꾸면 저장하고 비어 있는 새 회의 양식에 바로 쓴다', async () => {
  const posts = [];
  const review = fixture({ routes: { '/api/settings': (call) => { posts.push(call.body); return Response.json({ settings: settingsValue({ defaultOutputFormat: call.body.defaultOutputFormat }) }); } } });
  review.openSettings();
  review.ui['default-format'].value = 'summary';
  review.ui['default-format'].dispatch('change');
  await settle();
  assert.deepEqual(posts, [{ defaultOutputFormat: 'summary' }]);
  assert.equal(review.state.settings.defaultOutputFormat, 'summary');
  assert.equal(review.ui['output-format'].value, 'summary');
  review.ui['output-format'].value = 'tasks';
  review.resetMeetingForm();
  assert.equal(review.ui['output-format'].value, 'summary');
});

test('폴더 고르기 메시지를 보내고 folder-picked를 받으면 저장 위치를 저장한다', async () => {
  const posts = [];
  const review = fixture({ webview: true, routes: { '/api/settings': (call) => { posts.push(call.body); return Response.json({ settings: settingsValue({ storage: { audio: '', transcript: '', summary: '', ...call.body.storage } }) }); } } });
  review.openSettings('settings-storage');
  review.ui['pick-audio'].click();
  assert.deepEqual({ ...review.messages.at(-1) }, { type: 'pick-folder', kind: 'audio' });
  review.receive({ type: 'folder-picked', kind: 'audio', path: null });
  await settle();
  assert.equal(posts.length, 0, '고르지 않고 닫으면 저장하지 않는다');
  review.receive({ type: 'folder-picked', kind: 'audio', path: 'D:\\회의\\원음' });
  await settle();
  assert.deepEqual(posts, [{ storage: { audio: 'D:\\회의\\원음' } }]);
  assert.equal(review.ui['storage-audio'].textContent, 'D:\\회의\\원음');
  review.receive({ type: 'folder-picked', kind: 'backup', path: 'D:\\다른' });
  review.receive('open-data-folder');
  await settle();
  assert.equal(posts.length, 1, '모르는 종류나 다른 메시지는 무시한다');
});

test('사용 안 함을 누르면 그 종류만 빈 값으로 저장한다', async () => {
  const posts = [];
  const review = fixture({ routes: { '/api/settings': (call) => { posts.push(call.body); return Response.json({ settings: settingsValue({ storage: { audio: 'D:\\원음', transcript: 'D:\\전사', summary: '' } }) }); } } });
  review.state.settings = settingsValue({ storage: { audio: 'D:\\원음', transcript: 'D:\\전사', summary: 'D:\\요약' } });
  review.openSettings('settings-storage');
  assert.equal(review.ui['storage-summary'].textContent, 'D:\\요약');
  review.ui['clear-summary'].click();
  await settle();
  assert.deepEqual(posts, [{ storage: { summary: '' } }]);
  assert.equal(review.ui['storage-summary'].textContent, '사용 안 함');
  assert.equal(review.ui['storage-audio'].textContent, 'D:\\원음');
});

test('설정 내보내기는 2판 파일을 오늘 날짜 이름으로 내려받는다', async () => {
  const exported = { format: 'voicenote-settings', version: 2, summaryModel: 'gpt-6.1-sol', defaultOutputFormat: 'meeting', customFormat: null, storage: { audio: '', transcript: '', summary: '' } };
  const review = fixture({ routes: { '/api/settings/export': () => Response.json({ file: exported }) } });
  await review.exportSettings();
  assert.equal(review.downloads.length, 1);
  assert.deepEqual(JSON.parse(await review.downloads[0].text()), exported);
  assert.match(review.anchors.at(-1).download, /^\d{4}-\d{2}-\d{2}-VoiceNote-설정\.json$/);
});

test('불러오기 미리보기가 바뀔 값과 건너뛸 이유를 보여 주고 확인해야 적용한다', async () => {
  const preview = { summaryModel: { value: 'gpt-6-luna', apply: true }, defaultOutputFormat: { value: 'tasks', apply: true }, customFormat: { name: '주간 보고', apply: true },
    storage: { audio: { value: 'E:\\없는 폴더', apply: false, reason: '이 PC에 없는 폴더라 적용하지 않습니다.' }, transcript: { value: '', apply: true }, summary: { value: 'D:\\요약', apply: true } } };
  const imported = { settings: settingsValue({ summaryModel: 'gpt-6-luna', defaultOutputFormat: 'tasks', storage: { audio: '', transcript: '', summary: 'D:\\요약' } }),
    customFormat: { name: '주간 보고', sections: [{ key: 'overview', title: '요약' }], instruction: '' }, skipped: ['오디오 저장 위치: 이 PC에 없는 폴더라 적용하지 않습니다.'] };
  const review = fixture({ routes: { '/api/settings/preview': () => Response.json({ preview }), '/api/settings/import': () => Response.json(imported) } });
  const text = JSON.stringify({ format: 'voicenote-settings', version: 2 });
  await pick(review, file(text));
  assert.equal(review.ui['settings-import'].open, true);
  const shown = texts(review.ui['settings-preview']).join(' | ');
  for (const value of ['gpt-6-luna', '업무 정리', '주간 보고', 'E:\\없는 폴더', '이 PC에 없는 폴더라 적용하지 않습니다.', '사용 안 함', 'D:\\요약']) assert.ok(shown.includes(value), value);
  assert.equal(review.calls.some((call) => call.url === '/api/settings/import'), false, '확인 전에는 바꾸지 않는다');
  await review.applyImportedSettings();
  assert.equal(review.calls.find((call) => call.url === '/api/settings/import').body.file, text);
  assert.equal(review.state.settings.defaultOutputFormat, 'tasks');
  assert.equal(review.state.customFormat.name, '주간 보고');
  assert.equal(review.ui['settings-import'].open, false);
  assert.match(review.ui['settings-file-status'].textContent, /적용하지 않은 항목/);
  assert.match(review.ui['settings-file-status'].textContent, /이 PC에 없는 폴더/);
});

test('1판 파일은 정해진 문구만 보여 주고 아무것도 바꾸지 않는다', async () => {
  const review = fixture({ routes: { '/api/settings/preview': () => Response.json({ error: { code: 'SETTINGS_FILE_ERROR', message: LEGACY } }, { status: 400 }) } });
  await pick(review, file(JSON.stringify({ format: 'voicenote-project-settings', version: 1, projects: [] })));
  assert.equal(review.ui['settings-file-status'].textContent, LEGACY);
  assert.equal(review.ui['settings-import'].open, false);
  assert.equal(review.calls.some((call) => call.url === '/api/settings/import'), false);
});

test('128KiB가 넘거나 UTF-8이 깨진 파일은 서버로 보내지 않고 알린다', async () => {
  const review = fixture();
  await pick(review, { name: '큰.json', size: 128 * 1024 + 1, arrayBuffer: async () => new ArrayBuffer(128 * 1024 + 1) });
  assert.match(review.ui['settings-file-status'].textContent, /128KiB/);
  const broken = new Uint8Array([0x7b, 0xc3, 0x28, 0x7d]);
  await pick(review, { name: '깨진.json', size: broken.length, arrayBuffer: async () => broken.buffer });
  assert.match(review.ui['settings-file-status'].textContent, /UTF-8/);
  assert.equal(review.calls.some((call) => call.url.startsWith('/api/settings/')), false);
});

test('녹음·분석 중에는 설정 창 입력이 잠긴다', () => {
  const review = fixture({ webview: true });
  review.state.recorders.add({});
  review.refresh();
  for (const id of ['api-key', 'save-key', 'summary-model', 'default-format', 'custom-name', 'custom-save', 'pick-audio', 'clear-summary', 'export-settings', 'import-settings'])
    assert.equal(review.ui[id].disabled, true, id);
  assert.equal(review.ui['settings-lock'].hidden, false);
  review.state.recorders.clear();
  review.refresh();
  assert.equal(review.ui['default-format'].disabled, false);
  assert.equal(review.ui['settings-lock'].hidden, true);
});

test('늦게 온 앞 파일의 미리보기 응답은 마지막에 고른 파일을 덮지 않는다', async () => {
  let releaseFirst;
  const late = new Promise((resolve) => { releaseFirst = resolve; });
  const preview = (format) => ({ summaryModel: { value: 'gpt-6.1-sol', apply: true }, defaultOutputFormat: { value: format, apply: true }, customFormat: { name: null, apply: true }, storage: null });
  const textA = JSON.stringify({ format: 'voicenote-settings', version: 2, defaultOutputFormat: 'summary' });
  const textB = JSON.stringify({ format: 'voicenote-settings', version: 2, defaultOutputFormat: 'tasks' });
  const review = fixture({ routes: {
    '/api/settings/preview': async (call) => {
      if (call.body.file === textA) await late;
      return Response.json({ preview: preview(JSON.parse(call.body.file).defaultOutputFormat) });
    },
    '/api/settings/import': () => Response.json({ settings: settingsValue({ defaultOutputFormat: 'tasks' }), customFormat: null, skipped: [] }) } });
  const first = pick(review, file(textA));
  await pick(review, file(textB));
  assert.ok(texts(review.ui['settings-preview']).includes('업무 정리'));
  releaseFirst();
  await first;
  await settle();
  const shown = texts(review.ui['settings-preview']);
  assert.ok(shown.includes('업무 정리') && !shown.includes('핵심 요약'), '늦게 온 앞 파일 미리보기가 마지막 선택을 덮지 않는다');
  await review.applyImportedSettings();
  assert.equal(review.calls.find((call) => call.url === '/api/settings/import').body.file, textB);
});

test('BOM이 두 개 붙은 파일은 서버가 바이트로 받을 때와 같이 거절한다', async () => {
  const { parseSettingsFile } = require('./설정파일.cjs');
  const body = new TextEncoder().encode(JSON.stringify({ format: 'voicenote-settings', version: 2, summaryModel: 'gpt-6.1-sol', defaultOutputFormat: 'meeting', customFormat: null }));
  const withBom = (count) => new Uint8Array([...Array.from({ length: count }, () => [0xef, 0xbb, 0xbf]).flat(), ...body]);
  assert.throws(() => parseSettingsFile(withBom(2)));
  parseSettingsFile(withBom(1));
  // 화면이 보낸 글을 실제 해석기로 판정해, 화면과 서버가 같은 파일을 같게 판정하는지 본다.
  const review = fixture({ routes: { '/api/settings/preview': (call) => {
    try {
      parseSettingsFile(call.body.file);
      return Response.json({ preview: { summaryModel: { value: 'gpt-6.1-sol', apply: true }, defaultOutputFormat: { value: 'meeting', apply: true }, customFormat: { name: null, apply: true }, storage: null } });
    } catch (error) { return Response.json({ error: { code: 'SETTINGS_FILE_ERROR', message: error.message } }, { status: 400 }); }
  } } });
  await pick(review, file('', '설정.json', withBom(2)));
  assert.equal(review.ui['settings-import'].open, false);
  assert.match(review.ui['settings-file-status'].textContent, /JSON 형식이 아닌 파일/);
  await pick(review, file('', '설정.json', withBom(1)));
  assert.equal(review.ui['settings-import'].open, true, 'BOM 하나는 받아들인다');
});
