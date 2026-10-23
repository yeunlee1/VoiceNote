// 화면의 출력 형식 선택과 기본 키 체험 안내가 상태와 요청에 맞게 이어지는지 검증한다.
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const crypto = require('node:crypto');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const minutes = { overview: '업무 요약 문장', topics: [{ title: '배경', points: ['설명'] }], decisions: [], actions: [{ task: '초안 작성', owner: null, due: null }], openQuestions: ['기한 미정'] };

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
      if (url === '/api/meetings/main' && options.method === 'POST') return json({ meeting: { dailySequence: 1 } });
      if (url === '/api/meetings') return json({ meetings: [], skipped: 0 });
      return json({});
    } };
  const original = fs.readFileSync(path.join(__dirname, '화면/app.js'), 'utf8');
  const source = original.replace(/  init\(\);\s*\}\)\(\);\s*$/,
    '  globalThis.review = { state, ui, bind, refresh, resetMeetingForm, renderMinutes, lines, exportDocument, summarize, openMeeting, startBlockers, applyAccess, stale };\n})();');
  assert.notEqual(source, original);
  vm.runInNewContext(source, sandbox);
  const review = sandbox.review;
  review.bind();
  const status = nodes.get('status');
  const announce = () => status.textContent;
  review.resetMeetingForm();
  return { ...review, calls, downloads, announce, messages, nodes };
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

test('분석이 실패하면 체험 예약을 회수하고 소진 응답이면 새 키 등록 안내와 AI 설정을 연다', async () => {
  const review = fixture({ routes: { '/api/summary': () => Response.json({ error: { code: 'TRIAL_EXHAUSTED', message: '새로운 API키를 등록하세요.', mustRegister: true } }, { status: 403 }),
    '/api/config': () => Response.json({ accessMode: 'exhausted', trialLimit: 3, trialRemaining: 0, mustRegister: true }) } });
  review.applyAccess({ accessMode: 'trial', trialLimit: 3, trialRemaining: 1, mustRegister: false });
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

test('체험을 모두 쓴 뒤 분석을 누르면 요청 없이 정확한 새 키 안내와 AI 설정을 연다', async () => {
  const review = fixture();
  review.applyAccess({ accessMode: 'exhausted', trialLimit: 3, trialRemaining: 0, mustRegister: true });
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
