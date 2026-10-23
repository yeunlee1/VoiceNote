// 회의 준비·동의·시작 조건과 상세내용·모델·사용량이 화면 상태에서 올바르게 이어지는지 검증한다.
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const crypto = require('node:crypto');
const { test } = require('node:test');
const assert = require('node:assert/strict');

function fixture({ summary, meeting, shared } = {}) {
  const element = () => {
    const node = { value: '', checked: false, style: {}, hidden: false, disabled: false, open: false, textContent: '', dataset: {}, children: [], attributes: {},
      classList: { add() {}, remove() {} }, addEventListener() {}, removeAttribute(name) { delete this.attributes[name]; },
      setAttribute(name, value) { this.attributes[name] = value; }, querySelectorAll() { return []; }, querySelector() { return null; },
      append(...items) { this.children.push(...items); }, replaceChildren(...items) { this.children = items; },
      focus() { focused = this; }, showModal() { this.open = true; }, close() { this.open = false; } };
    return node;
  };
  let focused = null;
  const nodes = new Map(), calls = [], summaryBodies = [], meetingBodies = [];
  const sandbox = { crypto, Blob, AbortController, DOMException, setTimeout, clearTimeout, setInterval, clearInterval, confirm: () => true, window: shared ? { MeetingAiUsage: require('./AI사용량.js'), MeetingFormats: require('./출력형식.js') } : { MeetingFormats: require('./출력형식.js') },
    URL: { createObjectURL: () => 'blob:test', revokeObjectURL() {} },
    document: { getElementById(id) { if (!nodes.has(id)) nodes.set(id, element()); return nodes.get(id); }, createElement: element },
    async fetch(url, options = {}) {
      calls.push(url);
      if (url === '/api/summary') {
        summaryBodies.push(JSON.parse(options.body));
        if (summary) return summary(summaryBodies.at(-1));
        return Response.json({ minutes: { overview: '시험', topics: [], decisions: [], actions: [], openQuestions: [] } });
      }
      if (url === '/api/projects/1' && options.method === 'POST') return Response.json({ project: { ...JSON.parse(options.body), slot: 1, revision: 2 } });
      if (url === '/api/projects/1/meetings' && options.method === 'POST') {
        meetingBodies.push(JSON.parse(options.body));
        return Response.json({ meeting: { dailySequence: 1 } });
      }
      if (url === '/api/projects/1/meetings') return Response.json({ meetings: [] });
      if (meeting && url.startsWith('/api/projects/1/meetings/')) return Response.json({ meeting });
      return Response.json({});
    } };
  const original = fs.readFileSync(path.join(__dirname, '화면/app.js'), 'utf8');
  const source = original.replace(/  init\(\);\s*\}\)\(\);\s*$/,
    '  globalThis.review = { state, ui, refresh, applyProject, applyModels, prepareMeeting, startBlockers, summarize, documentObject, exportDocument, lines, openMeeting, recordCall, renderUsage };\n})();');
  assert.notEqual(source, original);
  vm.runInNewContext(source, sandbox);
  const review = sandbox.review;
  review.state.projects = Array.from({ length: 9 }, (_, i) => ({ slot: i + 1, name: i ? '' : '시험 프로젝트', title: i ? '' : '주간 회의', context: '', revision: 1 }));
  review.applyProject(1);
  return { ...review, calls, summaryBodies, meetingBodies, focused: () => focused };
}
const config = { summaryModels: [{ id: 'model-a', label: '모델 A', maxOutputTokens: 32000 }, { id: 'model-b', label: '모델 B', maxOutputTokens: 32000 }], summaryModel: 'model-b' };

test('첫 실행에 준비를 먼저 누르고 동의를 체크하면 준비를 다시 누르지 않아도 시작할 수 있다', () => {
  const { state, ui, refresh, prepareMeeting } = fixture();
  state.keyConfigured = true;
  prepareMeeting();
  assert.equal(state.setupOpen, true);
  assert.equal(ui.start.disabled, true);
  ui['meeting-notes'].value = '안건 1';
  ui['record-consent'].checked = true;
  ui['ai-consent'].checked = true;
  refresh();
  assert.equal(ui.start.disabled, false);
  assert.equal(ui['start-hint'].dataset.state, 'ready');
});

test('키나 동의가 없어도 준비 버튼은 폼을 열고 부족한 조건을 구체적으로 안내한다', () => {
  const { state, ui, refresh, prepareMeeting, startBlockers } = fixture();
  refresh();
  assert.equal(ui.prepare.disabled, false);
  prepareMeeting();
  assert.equal(ui['meeting-setup'].hidden, false);
  assert.equal(ui.prepare.attributes['aria-expanded'], 'true');
  const blockers = startBlockers().join(' ');
  assert.match(blockers, /API 키/);
  assert.match(blockers, /녹음 동의/);
  assert.match(blockers, /AI 분석 동의/);
  assert.equal(ui.start.disabled, true);
  ui.title.value = '';
  ui['record-consent'].checked = true;
  ui['ai-consent'].checked = true;
  state.keyConfigured = true;
  refresh();
  assert.deepEqual([...startBlockers()], ['‘회의 준비’에서 회의명을 입력하세요.']);
  assert.equal(ui.start.disabled, true);
});

test('새 프로젝트를 고르면 준비 양식을 열고 이름 입력칸에 포커스한다', () => {
  const { state, applyProject, prepareMeeting, ui, focused } = fixture();
  applyProject(2);
  assert.equal(state.setupOpen, true);
  prepareMeeting();
  assert.equal(focused(), ui['project-name']);
});

test('녹음 중에는 프로젝트·회의 정보·AI 설정 변경을 잠근다', () => {
  const { state, ui, refresh, applyModels } = fixture();
  applyModels(config);
  state.keyConfigured = true;
  state.recorders.add({});
  state.recorder = { part: { chunkBytes: 0 } };
  refresh();
  for (const id of ['prepare', 'project-name', 'title', 'meeting-notes', 'summary-model', 'save-key', 'remove-key', 'api-key']) assert.equal(ui[id].disabled, true, id);
  assert.equal(ui['settings-lock'].hidden, false);
  assert.equal(ui.stop.disabled, false);
});

test('요약 요청에 상세내용과 서버 목록에서 고른 모델을 보내고 사용량을 모델별로 저장한다', async () => {
  const usage = { inputTokens: 100, outputTokens: 40, totalTokens: 140 };
  const { state, ui, summarize, summaryBodies, meetingBodies, applyModels, exportDocument, lines } = fixture({
    summary: body => Response.json({ minutes: { overview: '시험', topics: [], decisions: [], actions: [], openQuestions: [] }, model: body.model, usage,
      aiCall: { kind: 'summary', model: body.model, sent: true, usage } }) });
  applyModels(config);
  state.keyConfigured = true;
  ui['ai-consent'].checked = true;
  ui['meeting-notes'].value = '안건: 표준 양식 확정';
  ui.transcript.value = '양식을 확정합니다.';
  assert.equal(await summarize(true), true);
  assert.equal(summaryBodies[0].notes, '안건: 표준 양식 확정');
  assert.equal(summaryBodies[0].model, 'model-b');
  const saved = meetingBodies[0];
  assert.equal(saved.notes, '안건: 표준 양식 확정');
  assert.equal(saved.analysis.usage.length, 1);
  assert.equal(saved.analysis.usage[0].model, 'model-b');
  assert.equal(saved.analysis.usage[0].totalTokens, 140);
  assert.doesNotMatch(JSON.stringify(exportDocument()), /표준 양식 확정/);
  assert.doesNotMatch(lines().join('\n'), /표준 양식 확정/);
});

test('사용량을 주지 않은 응답과 과금된 실패 응답은 미확인 건수로 남긴다', async () => {
  const usage = { inputTokens: 10, outputTokens: 5, totalTokens: 15 };
  let count = 0;
  const { state, ui, summarize, applyModels } = fixture({ summary: body => {
    count++;
    if (count === 1) return Response.json({ error: { code: 'AI_UNAVAILABLE', message: '시험 실패', aiCall: { kind: 'summary', model: body.model, sent: true, usage } } }, { status: 503 });
    return Response.json({ minutes: { overview: '시험', topics: [], decisions: [], actions: [], openQuestions: [] }, aiCall: { kind: 'summary', model: body.model, sent: true, usage: null } });
  } });
  applyModels(config);
  state.keyConfigured = true;
  ui['ai-consent'].checked = true;
  ui.transcript.value = '발언';
  assert.equal(await summarize(true), false);
  assert.equal(await summarize(true), true);
  const [entry] = state.usage;
  assert.equal(entry.requests, 2);
  assert.equal(entry.measuredRequests, 1);
  assert.equal(entry.unknownRequests, 1);
  assert.equal(entry.totalTokens, 15);
});

test('모델 목록이 없는 옛 서버에서는 모델을 보내지 않고 사용량이 없으면 미제공으로 표시한다', async () => {
  const { state, ui, summarize, summaryBodies, renderUsage } = fixture();
  state.keyConfigured = true;
  ui['ai-consent'].checked = true;
  ui.transcript.value = '발언';
  assert.equal(await summarize(true), true);
  assert.equal('model' in summaryBodies[0], false);
  state.usage = [];
  renderUsage();
  assert.match(ui.usage.children[0].textContent, /미제공/);
});

test('저장된 모델 선택이 목록에 없으면 자동 대체하지 않고 다시 고르도록 안내한다', () => {
  const { state, ui, refresh, applyModels, startBlockers } = fixture();
  applyModels({ ...config, summaryModel: null, summaryModelError: '저장된 모델 old-model은 더 이상 지원하지 않습니다.' });
  state.keyConfigured = true;
  refresh();
  assert.equal(state.summaryModel, '');
  assert.match(startBlockers().join(' '), /요약 모델을 다시 선택/);
  assert.equal(ui['ai-status-label'].textContent, '모델 선택 필요');
});

test('지난 회의를 열면 상세내용과 저장된 사용량을 복원하고 상세 창을 연다', async () => {
  const id = crypto.randomUUID();
  const { state, ui, openMeeting, startBlockers } = fixture({ meeting: { id, title: '주간 회의', date: '2026-10-01', participants: '', context: '', notes: '복원할 안건',
    transcript: '발언', minutes: { overview: '시험', topics: [], decisions: [], actions: [], openQuestions: [] }, dailySequence: 1,
    analysis: { summaryModel: 'model-a', usage: [{ kind: 'summary', model: 'model-a', requests: 1, measuredRequests: 1, unknownRequests: 0, inputTokens: 3, outputTokens: 2, totalTokens: 5 }] } } });
  await openMeeting(id);
  assert.equal(ui['meeting-notes'].value, '복원할 안건');
  assert.equal(state.usage[0].totalTokens, 5);
  assert.equal(ui['meeting-detail'].open, true);
  assert.match(startBlockers()[0], /회의 준비/);
});

for (const shared of [true, false]) {
  test(`같은 callId 응답은 사용량에 한 번만 더한다 (${shared ? '공용 도구' : '대체 집계'})`, () => {
    const { state, recordCall, documentObject } = fixture({ shared });
    const call = { callId: 'call_0123456789', kind: 'summary', model: 'model-a', sent: true, usage: { inputTokens: 7, outputTokens: 3, totalTokens: 10 } };
    recordCall(call);
    recordCall(call);
    recordCall({ ...call, callId: 'call_9876543210' });
    recordCall({ ...call, callId: 'call_unsent0000', sent: false });
    assert.equal(state.usage[0].requests, 2);
    assert.equal(state.usage[0].totalTokens, 20);
    assert.equal(documentObject().analysis.callIds.length, 2);
  });
}

test('저장한 회의를 다시 분석하면 실패해도 이전 사용량을 유지하고 새 기록에 누적해 저장한다', async () => {
  const id = crypto.randomUUID();
  let count = 0;
  const usage = { inputTokens: 10, outputTokens: 5, totalTokens: 15 };
  const { state, ui, openMeeting, summarize, meetingBodies } = fixture({
    shared: true,
    meeting: { id, title: '주간 회의', date: '2026-10-01', participants: '', context: '', notes: '', transcript: '발언',
      minutes: { overview: '이전', topics: [], decisions: [], actions: [], openQuestions: [] }, dailySequence: 1,
      analysis: { summaryModel: 'model-a', callIds: ['call_old000001'], usage: [{ kind: 'summary', model: 'model-a', requests: 1, measuredRequests: 1, unknownRequests: 0, inputTokens: 3, outputTokens: 2, totalTokens: 5 }] } },
    summary: body => {
      count++;
      if (count === 1) return Response.json({ error: { code: 'AI_UNAVAILABLE', message: '시험 실패', aiCall: { callId: 'call_fail00001', kind: 'summary', model: 'model-a', sent: true, usage: null } } }, { status: 503 });
      return Response.json({ minutes: { overview: '새 결과', topics: [], decisions: [], actions: [], openQuestions: [] }, model: 'model-a', aiCall: { callId: 'call_ok0000001', kind: 'summary', model: 'model-a', sent: true, usage } });
    } });
  await openMeeting(id);
  state.keyConfigured = true;
  ui['ai-consent'].checked = true;
  ui.transcript.value = '발언을 고쳐 다시 분석합니다.';
  assert.equal(await summarize(true), false);
  assert.equal(state.usage[0].requests, 2);
  assert.equal(state.usage[0].totalTokens, 5);
  assert.equal(await summarize(true), true);
  const saved = meetingBodies.at(-1).analysis;
  assert.equal(saved.usage[0].requests, 3);
  assert.equal(saved.usage[0].measuredRequests, 2);
  assert.equal(saved.usage[0].unknownRequests, 1);
  assert.equal(saved.usage[0].totalTokens, 20);
  assert.deepEqual([...saved.callIds], ['call_old000001', 'call_fail00001', 'call_ok0000001']);
});

test('새 회의를 준비하면 이전 회의의 사용량과 callId를 비운다', async () => {
  const id = crypto.randomUUID();
  const { state, openMeeting, prepareMeeting } = fixture({ meeting: { id, title: '주간 회의', date: '2026-10-01', participants: '', context: '', transcript: '발언',
    minutes: { overview: '이전', topics: [], decisions: [], actions: [], openQuestions: [] }, dailySequence: 1,
    analysis: { summaryModel: 'model-a', callIds: ['call_old000001'], usage: [{ kind: 'summary', model: 'model-a', requests: 1, inputTokens: 3, outputTokens: 2, totalTokens: 5 }] } } });
  await openMeeting(id);
  assert.equal(state.usage.length, 1);
  prepareMeeting();
  assert.equal(state.usage.length, 0);
  assert.equal(state.callIds.length, 0);
});
