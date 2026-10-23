// 회의별 AI 사용량 누적, 미확인 건수 처리, 옛 기록 호환을 검증한다.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const usage = require('./AI사용량.js');
const measured = (model, inputTokens, outputTokens, extra = {}) => ({ kind: 'summary', model, sent: true,
  usage: { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens, cachedInputTokens: null, reasoningTokens: null, ...extra } });

test('분할·실패 후 재시도·재분석 응답을 실제 모델별로 누적한다', () => {
  let ledger = [];
  ledger = usage.add(ledger, measured('gpt-6-sol', 1000, 300));
  ledger = usage.add(ledger, { kind: 'summary', model: 'gpt-6-sol', sent: true, usage: null });
  ledger = usage.add(ledger, measured('gpt-6-sol', 600, 200, { cachedInputTokens: 500, reasoningTokens: 150 }));
  ledger = usage.add(ledger, measured('gpt-6-luna', 2000, 100));
  assert.equal(ledger.length, 2);
  const sol = ledger.find(item => item.model === 'gpt-6-sol');
  assert.deepEqual({ ...sol }, { kind: 'summary', model: 'gpt-6-sol', requests: 3, measuredRequests: 2, unknownRequests: 1,
    inputTokens: 1600, outputTokens: 500, totalTokens: 2100, cachedInputTokens: 500, reasoningTokens: 150, audioSeconds: 0 });
  assert.equal(ledger.find(item => item.model === 'gpt-6-luna').totalTokens, 2100);
});

test('보내지 않은 요청과 형식이 틀린 호출은 세지 않는다', () => {
  const ledger = usage.add([], { kind: 'summary', model: 'gpt-6-sol', sent: false, usage: null });
  assert.deepEqual(ledger, []);
  assert.deepEqual(usage.add([], null), []);
  assert.deepEqual(usage.add([], { kind: 'image', model: 'gpt-6-sol', sent: true }), []);
  assert.deepEqual(usage.add([], { kind: 'summary', model: 'bad model', sent: true }), []);
});

test('전사와 요약을 같은 이름으로 섞지 않는다', () => {
  let ledger = usage.add([], { kind: 'transcription', model: 'gpt-transcribe', sent: true, usage: null, audioSeconds: 120 });
  ledger = usage.add(ledger, measured('gpt-6-sol', 10, 5));
  assert.deepEqual(ledger.map(item => `${item.kind}:${item.model}`), ['transcription:gpt-transcribe', 'summary:gpt-6-sol']);
  const text = usage.describe(ledger[0]);
  assert.equal(text.kindLabel, '음성 전사');
  assert.equal(text.total, '해당 없음');
  assert.match(text.detail, /120초/);
});

test('원래 배열을 바꾸지 않는다', () => {
  const original = usage.add([], measured('gpt-6-sol', 1, 1));
  const copy = JSON.stringify(original);
  usage.add(original, measured('gpt-6-sol', 5, 5));
  assert.equal(JSON.stringify(original), copy);
});

test('필드가 빠진 옛 기록과 모바일 초기 형식을 안전하게 읽는다', () => {
  assert.equal(usage.normalizeAnalysis(undefined), null);
  assert.deepEqual(usage.normalize(undefined), []);
  assert.deepEqual(usage.normalize('잘못된 값'), []);
  const old = usage.normalize([
    { model: 'gpt-6-sol', inputTokens: null, outputTokens: null, totalTokens: null, requests: 2 },
    { model: 'gpt-6-luna', inputTokens: 100, outputTokens: 20, requests: 1 },
    { model: '../x', requests: 5 },
    { kind: 'summary', model: 'gpt-6-sol', requests: 1, measuredRequests: 1, unknownRequests: 0, inputTokens: 7, outputTokens: 3, totalTokens: 10 },
  ]);
  assert.equal(old.length, 2);
  const sol = old.find(item => item.model === 'gpt-6-sol');
  assert.equal(sol.requests, 3);
  assert.equal(sol.unknownRequests, 2);
  assert.equal(sol.measuredRequests, 1);
  assert.equal(sol.totalTokens, 10);
  const luna = old.find(item => item.model === 'gpt-6-luna');
  assert.equal(luna.totalTokens, 120);
  assert.equal(luna.measuredRequests, 1);
  assert.deepEqual(usage.normalizeAnalysis({ summaryModel: 'gpt-6-sol' }), { summaryModel: 'gpt-6-sol', usage: [], callIds: [] });
});

test('사용량이 하나도 없으면 0 대신 미제공으로 표시하고 미확인 건수를 알린다', () => {
  const ledger = usage.add([], { kind: 'summary', model: 'gpt-6-sol', sent: true, usage: null });
  const text = usage.describe(ledger[0]);
  assert.equal(text.input, '미제공');
  assert.equal(text.total, '미제공');
  assert.match(text.unknownText, /1건/);
  const shown = usage.describe(usage.add([], measured('gpt-6-sol', 12345, 678, { cachedInputTokens: 2000, reasoningTokens: 500 }))[0]);
  assert.equal(shown.input, '12,345');
  assert.equal(shown.total, '13,023');
  assert.match(shown.detail, /입력 중 캐시 2,000 · 출력 중 추론 500 포함/);
  assert.equal(shown.unknownText, '');
});

test('같은 callId 응답은 한 번만 세고 처리 이력을 저장 형식에 보존한다', () => {
  const call = { ...measured('gpt-6-astra', 100, 50), callId: '1b6f0c7e-2a43-4c1a-9a55-0f8d6c3b2e11' };
  let analysis = usage.record(undefined, call);
  analysis = usage.record(analysis, call);
  analysis = usage.record(analysis, { kind: 'summary', model: 'gpt-6-astra', sent: true, usage: null, callId: '2b6f0c7e-2a43-4c1a-9a55-0f8d6c3b2e12' });
  analysis = usage.record(analysis, { kind: 'summary', model: 'gpt-6-astra', sent: true, usage: null, callId: '2b6f0c7e-2a43-4c1a-9a55-0f8d6c3b2e12' });
  analysis = usage.record(analysis, { kind: 'summary', model: 'gpt-6-astra', sent: false, callId: '3b6f0c7e-2a43-4c1a-9a55-0f8d6c3b2e13' });
  assert.equal(analysis.summaryModel, 'gpt-6-astra');
  assert.equal(analysis.usage[0].requests, 2);
  assert.equal(analysis.usage[0].measuredRequests, 1);
  assert.equal(analysis.usage[0].unknownRequests, 1);
  assert.equal(analysis.usage[0].totalTokens, 150);
  assert.equal(analysis.callIds.length, 2);
  const reopened = usage.normalizeAnalysis(JSON.parse(JSON.stringify(analysis)));
  assert.deepEqual(usage.record(reopened, call), reopened);
  assert.deepEqual(usage.normalizeAnalysis({ callIds: ['짧음', 7, '1b6f0c7e-2a43-4c1a-9a55-0f8d6c3b2e11', '1b6f0c7e-2a43-4c1a-9a55-0f8d6c3b2e11'] }).callIds, ['1b6f0c7e-2a43-4c1a-9a55-0f8d6c3b2e11']);
});

test('callId가 없는 옛 서버 응답도 실제 전송 건으로 센다', () => {
  let analysis = usage.record(null, measured('gpt-6-sol', 10, 5));
  analysis = usage.record(analysis, measured('gpt-6-sol', 10, 5));
  assert.equal(analysis.usage[0].requests, 2);
  assert.deepEqual(analysis.callIds, []);
});
