// 분석 전에 원음을 저장하는 화면 동작과 지난 회의 목록·보관함 경로 연결을 검증한다.
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
function fixture(summaryResponse, responses = {}) {
  const element = () => ({ value: '', checked: true, hidden: false, disabled: false, open: false, textContent: '', dataset: {}, style: {}, children: [],
    classList: { add() {}, remove() {} }, append(...items) { this.children.push(...items); }, replaceChildren(...items) { this.children = items; },
    addEventListener() {}, setAttribute() {}, removeAttribute() {}, querySelectorAll() { return []; }, querySelector() { return null; },
    focus() {}, showModal() { this.open = true; }, close() { this.open = false; } });
  const nodes = new Map(), calls = [], summaryBodies = [], posts = [];
  const sandbox = { crypto, Blob, AbortController, DOMException, setTimeout, clearTimeout, setInterval, clearInterval, confirm: () => true, window: { MeetingFormats: require('./출력형식.js') },
    URL: { createObjectURL: () => 'blob:test', revokeObjectURL() {} },
    document: { getElementById(id) { if (!nodes.has(id)) nodes.set(id, element()); return nodes.get(id); }, createElement: element },
    async fetch(url, options = {}) {
      calls.push(url);
      if (options.method === 'POST' && typeof options.body === 'string') posts.push({ url, body: JSON.parse(options.body) });
      if (url === '/api/summary') {
        summaryBodies.push(JSON.parse(options.body));
        if (summaryResponse) return summaryResponse(summaryBodies.at(-1), summaryBodies.length);
      }
      let body = {};
      if (Object.hasOwn(responses, url)) body = responses[url];
      else if (url === '/api/meetings') body = { meetings: [], skipped: 0 };
      else if (url === '/api/transcribe') body = { text: '시험 회의 발언입니다.' };
      else if (url === '/api/summary') body = { minutes: { overview: '시험', topics: [], decisions: [], actions: [], openQuestions: [] } };
      return Response.json(body);
    } };
  const original = fs.readFileSync(path.join(__dirname, '화면/app.js'), 'utf8');
  const source = original.replace(/  init\(\);\s*\}\)\(\);\s*$/, '  globalThis.review = { state, ui, summarize, lines, exportDocument, documentObject, loadHistory, openMeeting };\n})();');
  assert.notEqual(source, original);
  vm.runInNewContext(source, sandbox);
  const { state, ui } = sandbox.review;
  ui.title.value = '시험 회의'; ui.date.value = '2026-09-15';
  return { ...sandbox.review, calls, summaryBodies, posts, closeStatus: sandbox.window.meetingDesktopStatus };
}
const texts = node => [node.textContent, ...(node.children || []).flatMap(texts)].filter(Boolean);
const historyItems = ui => ui['meeting-history'].children.map(button => texts(button).join(' | '));

test('지난 회의 목록에 이전 프로젝트 꼬리표·별 개수·읽지 못한 기록 수를 보여 준다', async () => {
  const { ui, loadHistory } = fixture(null, { '/api/meetings': { skipped: 2, meetings: [
    { location: 'p1', id: crypto.randomUUID(), title: '옛 회의', date: '2026-09-01', dailySequence: 1, projectName: '홈페이지 개편', outputFormat: 'meeting', analyzed: true, audioCount: 1, stars: 4, refined: false },
    { location: 'main', id: crypto.randomUUID(), title: '새 회의', date: '2026-09-15', dailySequence: 1, outputFormat: 'tasks', analyzed: true, audioCount: 1, refined: false }] } });
  await loadHistory();
  assert.match(ui['history-status'].textContent, /2개 회의/);
  assert.match(ui['history-status'].textContent, /읽지 못한 기록 2개/);
  const [old, fresh] = historyItems(ui);
  assert.match(old, /이전 프로젝트: 홈페이지 개편/);
  assert.match(old, /별 4개/);
  assert.match(fresh, /업무 정리 완료/);
  assert.doesNotMatch(fresh, /이전 프로젝트|별 \d개/);
});

test('분석 전 녹음은 목록에 제목 미정 회의로 보인다', async () => {
  const { ui, loadHistory } = fixture(null, { '/api/meetings': { skipped: 0, meetings: [
    { location: 'main', id: crypto.randomUUID(), title: '', date: '2026-10-23', dailySequence: 2, outputFormat: 'meeting', analyzed: false, audioCount: 2, expectedParts: 2, refined: false }] } });
  await loadHistory();
  const [item] = historyItems(ui);
  assert.match(item, /2026-10-23 · 2차 · 제목 미정 회의/);
  assert.match(item, /분석 대기/);
  assert.doesNotMatch(ui['history-status'].textContent, /읽지 못한/);
});

test('옛 기록을 열고 다시 분석하면 그 보관함 경로로 저장한다', async () => {
  const id = crypto.randomUUID(), recordingId = crypto.randomUUID();
  const meeting = { id, location: 'p1', recordingId, title: '옛 회의', date: '2026-09-01', participants: '김과장', context: '옛 프로젝트 배경', transcript: '옛 회의 발언입니다.',
    minutes: { overview: '옛 요약', topics: [], decisions: [], actions: [], openQuestions: [] }, dailySequence: 1, projectName: '홈페이지 개편', audio: [{ index: 1 }], expectedParts: 1 };
  const { state, ui, openMeeting, summarize, calls, posts, lines } = fixture(null, { [`/api/meetings/p1/${id}`]: { meeting, versions: [] } });
  state.keyConfigured = true;
  await openMeeting('p1', id);
  assert.equal(state.location, 'p1');
  assert.equal(state.recordingId, recordingId);
  assert.ok(calls.includes(`/api/recordings/p1/${recordingId}/audio/1`), JSON.stringify(calls));
  assert.match(lines().join('\n'), /^프로젝트: 홈페이지 개편$/m);
  ui.transcript.value = '옛 회의 발언을 고쳤습니다.';
  assert.equal(await summarize(true), true);
  assert.ok(calls.includes(`/api/recordings/p1/${recordingId}/transcript`), JSON.stringify(calls));
  const saved = posts.find(post => post.url.startsWith('/api/meetings/'));
  assert.equal(saved.url, '/api/meetings/p1');
  assert.equal(saved.body.recordingId, recordingId);
  assert.equal('context' in saved.body, false);
  assert.equal(calls.some(url => /\/api\/(meetings|recordings)\/main/.test(url)), false);
});

test('녹음 없이 전사로만 만든 옛 회의를 다시 분석하면 같은 회의로 이어 저장한다', async () => {
  const id = crypto.randomUUID();
  const meeting = { id, location: 'p1', title: '원음 없는 옛 회의', date: '2026-09-01', participants: '', context: '옛 프로젝트 배경', transcript: '옛 전사 원문',
    minutes: { overview: '옛 요약', topics: [], decisions: [], actions: [], openQuestions: [] }, dailySequence: 1, projectName: '옛 업무' };
  const { state, ui, openMeeting, summarize, posts, calls } = fixture(null, { [`/api/meetings/p1/${id}`]: { meeting, versions: [] } });
  state.keyConfigured = true;
  await openMeeting('p1', id);
  ui.transcript.value += ' 보완된 전사';
  assert.equal(await summarize(true), true);
  const saved = posts.find(post => post.url.startsWith('/api/meetings/'));
  assert.equal(saved.url, '/api/meetings/p1');
  assert.equal(saved.body.meetingId, id);
  assert.equal('recordingId' in saved.body, false);
  assert.equal(calls.some(url => url.startsWith('/api/recordings/')), false, '없는 녹음에 전사를 저장하지 않는다');
});

test('회의명 없이 녹음·분석하면 AI 제목으로 저장한다', async () => {
  const { state, ui, summarize, posts } = fixture(() => Response.json({ minutes: { suggestedTitle: 'AI가 정한 제목', overview: '시험', topics: [], decisions: [], actions: [], openQuestions: [] } }));
  state.keyConfigured = true;
  ui.title.value = '';
  state.parts = [{ blob: new Blob(['시험 원음'], { type: 'audio/webm' }), saved: false, transcript: '', applied: false }];
  await summarize();
  const recording = posts.find(post => /^\/api\/recordings\/main\/[0-9a-f-]{36}$/.test(post.url));
  assert.ok(recording, JSON.stringify(posts.map(post => post.url)));
  assert.equal(recording.body.title, '');
  const saved = posts.find(post => post.url === '/api/meetings/main');
  assert.equal(saved.body.title, 'AI가 정한 제목');
  assert.equal(ui.title.value, 'AI가 정한 제목');
});

const successfulSummary = body => Response.json({ minutes: { overview: '전체 방향 | 기준을 정합니다.\n주요 결정 | 표준화합니다.\n다음 할 일 | 항목을 검토합니다.\n남은 쟁점 | 담당자 미정입니다.', topics: [], decisions: [...(body.previousMinutes?.decisions || []), body.text], actions: [], openQuestions: [] } });
const failedSummary = code => Response.json({ error: { code, message: '시험 한도 오류' } }, { status: 503 });

test('출력 한도에 걸린 구간만 나누고 전체 전사와 누적 결과를 보존한다', async () => {
  const { state, ui, summarize, summaryBodies } = fixture((body, count) => count === 1 ? failedSummary('AI_OUTPUT_LIMIT') : successfulSummary(body));
  state.keyConfigured = true;
  const text = ('문장을 유지합니다. 😀 다음 안건입니다.\n').repeat(250);
  ui.transcript.value = text;
  assert.equal(await summarize(true), true);
  assert.ok(summaryBodies.length > 2);
  assert.equal(summaryBodies.slice(1).map(body => body.text).join(''), text.trim());
  assert.ok(summaryBodies.slice(1).every(body => body.text.length < text.length));
  assert.equal(state.minutes.decisions.join(''), text.trim());
  assert.equal(state.resultStored, true);
});

test('분할 중 멈춰도 같은 화면에서 재시도하면 성공 구간은 다시 요청하지 않는다', async () => {
  let stopOnce = true;
  const { state, ui, summarize, summaryBodies } = fixture((body, count) => {
    if (count === 1) return failedSummary('AI_OUTPUT_LIMIT');
    if (count === 3 && stopOnce) { stopOnce = false; return failedSummary('AI_QUOTA_EXCEEDED'); }
    return successfulSummary(body);
  });
  state.keyConfigured = true; ui.transcript.value = '가'.repeat(12000);
  assert.equal(await summarize(true), false);
  assert.equal(summaryBodies.length, 3);
  assert.equal(state.resultStored, false);
  assert.equal(await summarize(true), true);
  assert.equal(summaryBodies.length, 4);
  assert.equal(summaryBodies[3].text, summaryBodies[2].text);
  assert.equal(state.minutes.decisions.join(''), ui.transcript.value);
});

for (const code of ['AI_QUOTA_EXCEEDED', 'AI_RATE_LIMIT', 'AI_UNAVAILABLE']) {
  test(`${code} 오류에는 자동 분할 재요청을 하지 않는다`, async () => {
    const { state, ui, summarize, summaryBodies } = fixture(() => failedSummary(code));
    state.keyConfigured = true; ui.transcript.value = '가'.repeat(12000);
    assert.equal(await summarize(true), false);
    assert.equal(summaryBodies.length, 1);
    assert.equal(ui.transcript.value.length, 12000);
  });
}

test('계속 출력 제한이 나면 추가 요청 상한 안에서 멈추고 전사를 보존한다', async () => {
  const { state, ui, summarize, summaryBodies } = fixture(() => failedSummary('AI_OUTPUT_LIMIT'));
  state.keyConfigured = true; ui.transcript.value = '가'.repeat(24000);
  assert.equal(await summarize(true), false);
  assert.ok(summaryBodies.length > 1 && summaryBodies.length <= 7);
  assert.equal(ui.transcript.value.length, 24000);
  assert.equal(state.resultStored, false);
});

test('일부 구간이 성공해도 자동 추가 요청은 6회를 넘지 않는다', async () => {
  const { state, ui, summarize, summaryBodies } = fixture(body => body.text.length > 3000 ? failedSummary('AI_OUTPUT_LIMIT') : successfulSummary(body));
  state.keyConfigured = true; ui.transcript.value = '가'.repeat(24000);
  assert.equal(await summarize(true), false);
  assert.equal(summaryBodies.length, 7);
  assert.equal(state.resultStored, false);
});

test('AI 제목을 화면과 저장 자료에 적용해도 결과가 오래된 것으로 처리되지 않는다', async () => {
  const { state, ui, summarize, lines } = fixture(() => Response.json({ minutes: { suggestedTitle: '문서 표준화와 개발 순서', overview: '전체 방향 | 제조지시서를 먼저 만듭니다.\n주요 결정 | JPA를 사용합니다.\n다음 할 일 | 화면을 그립니다.\n남은 쟁점 | 기준 제품 미정.', topics: [{title:'상세 설명',points:['전체 양식을 확정하기보다 먼저 사용할 화면을 검토합니다.']}], decisions: [], actions: [], openQuestions: [] } }));
  state.keyConfigured = true; ui.transcript.value = '제조지시서부터 개발합니다.';
  assert.equal(await summarize(true), true);
  assert.equal(ui.title.value, '문서 표준화와 개발 순서');
  assert.equal(state.resultStored, true);
  const output = lines().join('\n');
  assert.ok(output.indexOf('핵심 요약') < output.indexOf('상세 회의 내용'));
  assert.match(output, /전체 양식을 확정하기보다/);
});
test('수동 재분석 경로도 음성을 저장한 다음 AI를 호출한다', async () => {
  const { state, ui, summarize, calls } = fixture();
  state.keyConfigured = true;
  state.parts = [{ blob: new Blob(['시험 원음'], { type: 'audio/webm' }), saved: true, transcript: '', applied: false }];
  await summarize();
  const aiIndex = calls.indexOf('/api/transcribe');
  const audioIndex = calls.findIndex(url => /\/recordings\/main\/[^/]+\/audio\/1$/.test(url));
  assert.ok(audioIndex >= 0 && aiIndex > audioIndex, JSON.stringify(calls));
  assert.equal(state.audioStored, true);
  assert.equal(state.resultStored, true);
  const transcriptIndex = calls.findIndex(url => /\/recordings\/main\/[^/]+\/transcript$/.test(url));
  assert.ok(transcriptIndex > aiIndex && transcriptIndex < calls.indexOf('/api/summary'));
});
test('사용자가 붙여넣은 14977자 전사로 다시 분석하면 음성을 재전사하지 않는다', async () => {
  const { state, ui, summarize, calls } = fixture();
  state.keyConfigured = true;
  state.audioStored = true;
  state.recordingId = crypto.randomUUID();
  state.parts = [{ blob: new Blob(['audio'], { type: 'audio/webm' }), saved: true, applied: false }];
  ui.transcript.value = '가'.repeat(14977);
  await summarize(true);
  assert.equal(calls.includes('/api/transcribe'), false);
  assert.equal(calls.includes('/api/summary'), true);
  assert.equal(ui.transcript.value.length, 14977);
  assert.equal(state.resultStored, true);
});
test('독립 창 종료 상태는 녹음과 저장하지 않은 내용을 구분한다', () => {
  const { state, ui, closeStatus } = fixture();
  assert.equal(closeStatus().unsaved, false);
  state.recorders.add({});
  assert.equal(closeStatus().unsaved, true);
  state.recorders.clear();
  state.parts = [{ blob: new Blob(['audio']), saved: false }];
  assert.equal(closeStatus().unsaved, true);
  state.parts[0].saved = true;
  assert.equal(closeStatus().unsaved, false);
  ui.transcript.value = '아직 저장하지 않은 발언';
  state.notesSaved = false;
  assert.equal(closeStatus().unsaved, true);
});
test('29956자 전사는 두 구간으로 보내고 첫 요약을 다음 요청에 연결한다', async () => {
  const { state, ui, summarize, summaryBodies } = fixture();
  state.keyConfigured = true;
  const transcript = '문서 표준 항목을 확인합니다. '.repeat(2000).slice(0,29956).trim();
  ui.transcript.value = transcript;
  await summarize(true);
  assert.equal(summaryBodies.length, 2);
  assert.equal(summaryBodies.map(x => x.text).join(''), transcript);
  assert.ok(summaryBodies.every(x => x.text.length <= 24000));
  assert.equal(summaryBodies[0].previousMinutes, null);
  assert.equal(summaryBodies[1].previousMinutes.overview, '시험');
  assert.equal(state.resultStored, true);
});

test('회의록 내보내기는 전사와 상세 메모를 제외하고 내부 복원 자료는 보존한다', () => {
  const { state, ui, lines, exportDocument, documentObject } = fixture();
  ui.transcript.value = '공유하지 않는 전사 발언';
  ui['meeting-notes'].value = '내부 참고 배경';
  state.parts = [{ transcript: '분할 전사 발언' }];
  state.minutes = { overview: '핵심 내용', topics: [{ title: '검토', points: ['이유와 결과를 연결한 설명입니다.'] }], decisions: ['합의 내용'], actions: [], openQuestions: [] };
  const exported = JSON.stringify(exportDocument());
  assert.doesNotMatch(exported, /전사 발언|내부 참고 배경|partTranscripts|transcript|context/);
  assert.doesNotMatch(lines().join('\n'), /전사 발언|내부 참고 배경/);
  assert.match(lines().join('\n'), /이유와 결과를 연결한 설명입니다\./);
  assert.equal(documentObject().transcript, ui.transcript.value);
  assert.equal(documentObject().partTranscripts[0].transcript, '분할 전사 발언');
});
