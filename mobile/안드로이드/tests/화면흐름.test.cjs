// 회의 시작 조건이 입력 순서와 무관하게 마지막 조건 충족 즉시 풀리는지 검증한다.
const test = require('node:test');
const assert = require('node:assert/strict');
const Flow = require('../assets/flow.js');

const base = { busy: false, active: false, keyConfigured: false, date: '2026-10-01', notes: '' };

test('프로젝트·회의명·동의 없이 키만 등록하면 시작할 수 있다', () => {
  assert.equal(Flow.canStart(base), false);
  assert.equal(Flow.canStart({ ...base, keyConfigured: true }), true);
  assert.deepEqual(Flow.startBlockers(base).map(r => r.id), ['key']);
  assert.equal(Flow.canStart({ ...base, keyConfigured: true, title: '', projectName: '', recordConsent: false, aiConsent: false }), true);
});

test('진행 중·처리 중·날짜 오류·안건 초과·지난 회의 열기는 시작을 막는다', () => {
  const ready = { ...base, keyConfigured: true };
  for (const extra of [{ active: true }, { busy: true }, { date: '' }, { notes: 'a'.repeat(4001) }, { opened: true }, { permissionPending: true }, { filePending: true }])
    assert.equal(Flow.canStart({ ...ready, ...extra }), false, JSON.stringify(extra));
  assert.equal(Flow.startBlockers({ ...ready, busy: true }).length, 0);
  assert.equal(Flow.canStart({ ...ready, notes: 'a'.repeat(4000) }), true);
});

test('저장된 내 형식이 없는 선택과 모델 오류는 여전히 시작을 막는다', () => {
  const ready = { ...base, keyConfigured: true };
  assert.equal(Flow.canStart({ ...ready, customMissing: true }), false);
  assert.equal(Flow.canStart({ ...ready, modelError: true }), false);
  assert.equal(Flow.startBlockers({ ...ready, customMissing: true }).find(r => r.id === 'format').text, '설정 › 출력 형식에서 내 형식을 먼저 만드세요.');
  assert.equal(Flow.startBlockers(base)[0].text, '설정의 AI 연결에서 API 키를 등록하세요.');
});

test('사용량은 모델별로 표시하고 값이 없으면 미제공으로 쓴다', () => {
  assert.deepEqual(Flow.usageRows({}), []);
  assert.deepEqual(Flow.usageRows({ analysis: { usage: [] } }), []);
  const rows = Flow.usageRows({ analysis: { usage: [
    { model: 'gpt-6-sol', inputTokens: 12345, outputTokens: 2100, totalTokens: 14445, requests: 3 },
    { model: 'gpt-transcribe', inputTokens: null, outputTokens: null, totalTokens: null, requests: 1 }
  ] } });
  assert.deepEqual(rows[0], { kind: '요약', model: 'gpt-6-sol', input: '12,345', output: '2,100', total: '14,445', requests: 3, note: '' });
  assert.deepEqual(rows[1], { kind: '요약', model: 'gpt-transcribe', input: '미제공', output: '미제공', total: '미제공', requests: 1, note: '' });
});

test('AI 워커 사용량 원장(종류·측정/미확인 건수·음성 시간)을 해석한다', () => {
  const rows = Flow.usageRows({ analysis: { usage: [
    { kind: 'summary', model: 'gpt-6-sol', requests: 4, measuredRequests: 3, unknownRequests: 1, inputTokens: 30000, outputTokens: 4000, totalTokens: 34000, audioSeconds: 0 },
    { kind: 'summary', model: 'gpt-6-luna', requests: 1, measuredRequests: 0, unknownRequests: 1, inputTokens: 0, outputTokens: 0, totalTokens: 0, audioSeconds: 0 },
    { kind: 'transcription', model: 'gpt-transcribe', requests: 2, measuredRequests: 2, unknownRequests: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0, audioSeconds: 1500 }
  ] } });
  assert.equal(rows[0].total, '34,000'); assert.equal(rows[0].note, '1건 사용량 미확인');
  assert.deepEqual([rows[1].input, rows[1].output, rows[1].total], ['미제공', '미제공', '미제공'], '측정 0건은 0이 아니라 미제공');
  assert.equal(rows[1].note, '1건 사용량 미확인');
  assert.equal(rows[2].kind, '전사'); assert.equal(rows[2].total, '해당 없음', '초 단위 과금 전사는 토큰 해당 없음'); assert.equal(rows[2].note, '음성 25분');
});

test('조회 전에는 분석 멈춤으로 보지 않는다', () => {
  assert.equal(Flow.analysisStopped({ id: 'm1', location: 'main', state: 'analyzing' }, undefined), false);
});

test('서비스가 분석하지 않는 analyzing 회의는 분석 멈춤이다', () => {
  const entry = { id: 'm1', location: 'main', state: 'analyzing' };
  const status = (active, meeting) => ({ active, meeting });
  assert.equal(Flow.analysisStopped(entry, status(false, null)), true, '서비스가 쉬고 있음');
  assert.equal(Flow.analysisStopped(entry, status(true, { id: 'm1', location: 'main', state: 'analyzing' })), false, '같은 회의를 분석 중');
  assert.equal(Flow.analysisStopped(entry, status(true, { id: 'm1', location: 'main', state: 'recording' })), true, '같은 회의지만 분석 중이 아님');
  assert.equal(Flow.analysisStopped(entry, status(true, { id: 'm2', location: 'main', state: 'analyzing' })), true, '다른 회의를 분석 중');
  assert.equal(Flow.analysisStopped({ ...entry, state: 'complete' }, status(false, null)), false, '분석 중이 아닌 회의');
  assert.equal(Flow.analysisStopped({ id: 'm1', state: 'analyzing' }, status(true, { id: 'm1', state: 'analyzing' })), false, '위치 생략은 main');
  assert.equal(Flow.analysisStopped({ id: 'm1', state: 'analyzing' }, status(true, { id: 'm1', location: 'shared', state: 'analyzing' })), true, '위치가 다르면 다른 회의');
});
