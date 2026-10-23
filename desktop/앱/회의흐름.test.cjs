// 프리셋 저장의 날짜 보존과 분석 전에 원음을 저장하는 화면 동작을 검증한다.
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
function fixture(summaryResponse) {
  const element = () => ({ value: '', checked: true, hidden: false, disabled: false, textContent: '', dataset: {},
    classList: { add() {}, remove() {} }, append() {}, replaceChildren() {}, addEventListener() {}, setAttribute() {}, querySelectorAll() { return []; } });
  const nodes = new Map(), calls = [], summaryBodies = [];
  const sandbox = { crypto, Blob, AbortController, DOMException, setTimeout, clearTimeout, setInterval, clearInterval, confirm: () => true, window: { MeetingFormats: require('./출력형식.js') },
    URL: { createObjectURL: () => 'blob:test', revokeObjectURL() {} },
    document: { getElementById(id) { if (!nodes.has(id)) nodes.set(id, element()); return nodes.get(id); }, createElement: element },
    async fetch(url, options = {}) {
      calls.push(url);
      if (url === '/api/summary') {
        summaryBodies.push(JSON.parse(options.body));
        if (summaryResponse) return summaryResponse(summaryBodies.at(-1), summaryBodies.length);
      }
      let body = {};
      if (url === '/api/projects/1') body = { project: { ...JSON.parse(options.body), slot: 1, revision: 1 } };
      else if (url.endsWith('/meetings') && !options.method) body = { meetings: [] };
      else if (url === '/api/transcribe') body = { text: '시험 회의 발언입니다.' };
      else if (url === '/api/summary') body = { minutes: { overview: '시험', topics: [], decisions: [], actions: [], openQuestions: [] } };
      return Response.json(body);
    } };
  const original = fs.readFileSync(path.join(__dirname, '화면/app.js'), 'utf8');
  const source = original.replace(/  init\(\);\s*\}\)\(\);\s*$/, '  globalThis.review = { state, ui, savePreset, summarize, lines, exportDocument, documentObject };\n})();');
  assert.notEqual(source, original);
  vm.runInNewContext(source, sandbox);
  const { state, ui } = sandbox.review;
  state.projects = Array.from({ length: 9 }, (_, i) => ({ slot: i + 1, name: '시험 프로젝트', title: '시험 회의', context: '', revision: 0 }));
  ui['project-name'].value = '시험 프로젝트'; ui.title.value = '시험 회의'; ui.date.value = '2026-09-15';
  return { ...sandbox.review, calls, summaryBodies, closeStatus: sandbox.window.meetingDesktopStatus };
}
test('프리셋 저장이 사용자가 선택한 회의 날짜를 유지한다', async () => {
  const { savePreset, ui } = fixture();
  await savePreset();
  assert.equal(ui.date.value, '2026-09-15');
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
  ui['ai-consent'].checked = true;
  await summarize();
  const aiIndex = calls.indexOf('/api/transcribe');
  const audioIndex = calls.findIndex(url => /\/recordings\/[^/]+\/audio\/1$/.test(url));
  assert.ok(audioIndex >= 0 && aiIndex > audioIndex, JSON.stringify(calls));
  assert.equal(state.audioStored, true);
  assert.equal(state.resultStored, true);
  const transcriptIndex = calls.findIndex(url => /\/recordings\/[^/]+\/transcript$/.test(url));
  assert.ok(transcriptIndex > aiIndex && transcriptIndex < calls.indexOf('/api/summary'));
});
test('사용자가 붙여넣은 14977자 전사로 다시 분석하면 음성을 재전사하지 않는다', async () => {
  const { state, ui, summarize, calls } = fixture();
  state.keyConfigured = true;
  state.audioStored = true;
  state.meetingId = crypto.randomUUID();
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

test('회의록 내보내기는 전사와 배경을 제외하고 내부 복원 자료는 보존한다', () => {
  const { state, ui, lines, exportDocument, documentObject } = fixture();
  ui.transcript.value = '공유하지 않는 전사 발언';
  ui['meeting-context'].value = '내부 참고 배경';
  state.parts = [{ transcript: '분할 전사 발언' }];
  state.minutes = { overview: '핵심 내용', topics: [{ title: '검토', points: ['이유와 결과를 연결한 설명입니다.'] }], decisions: ['합의 내용'], actions: [], openQuestions: [] };
  const exported = JSON.stringify(exportDocument());
  assert.doesNotMatch(exported, /전사 발언|내부 참고 배경|partTranscripts|transcript|context/);
  assert.doesNotMatch(lines().join('\n'), /전사 발언|내부 참고 배경/);
  assert.match(lines().join('\n'), /이유와 결과를 연결한 설명입니다\./);
  assert.equal(documentObject().transcript, ui.transcript.value);
  assert.equal(documentObject().partTranscripts[0].transcript, '분할 전사 발언');
});
