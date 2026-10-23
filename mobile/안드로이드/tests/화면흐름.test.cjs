// 회의 시작 조건이 입력 순서와 무관하게 마지막 조건 충족 즉시 풀리는지 검증한다.
const test = require('node:test');
const assert = require('node:assert/strict');
const Flow = require('../assets/flow.js');

const base = { busy: false, active: false, keyConfigured: false, projectName: '', date: '2026-10-01', notes: '', recordConsent: false, aiConsent: false };
const actions = {
  key: s => ({ ...s, keyConfigured: true }),
  name: s => ({ ...s, projectName: '표준 문서' }),
  recordConsent: s => ({ ...s, recordConsent: true }),
  aiConsent: s => ({ ...s, aiConsent: true })
};
function permutations(items) {
  if (items.length <= 1) return [items];
  return items.flatMap((item, i) => permutations([...items.slice(0, i), ...items.slice(i + 1)]).map(rest => [item, ...rest]));
}

test('모든 입력 순서에서 마지막 조건을 채우는 즉시 시작할 수 있다', () => {
  const orders = permutations(Object.keys(actions));
  assert.equal(orders.length, 24);
  for (const order of orders) {
    let s = base;
    order.forEach((name, index) => {
      s = actions[name](s);
      assert.equal(Flow.canStart(s), index === order.length - 1, `${order.join('→')} 의 ${index + 1}번째 단계`);
    });
  }
});

test('준비 버튼을 누르거나 동의를 먼저 하지 않아도 시작 조건만으로 판정한다', () => {
  const ready = { ...base, keyConfigured: true, projectName: 'A', recordConsent: true, aiConsent: true };
  assert.equal(Flow.canStart(ready), true);
  assert.equal('prepared' in ready, false);
});

test('동의 하나만 빠져도 막고, 막힌 이유를 각각 보여 준다', () => {
  const s = { ...base, keyConfigured: true, projectName: 'A', recordConsent: true };
  assert.deepEqual(Flow.startBlockers(s).map(r => r.id), ['aiConsent']);
  assert.deepEqual(Flow.startBlockers(base).map(r => r.id), ['key', 'name', 'recordConsent', 'aiConsent']);
  for (const reason of Flow.startBlockers(base)) assert.ok(reason.text.length > 5);
});

test('진행 중·처리 중·날짜 오류·안건 초과는 시작을 막는다', () => {
  const ready = { ...base, keyConfigured: true, projectName: 'A', recordConsent: true, aiConsent: true };
  assert.equal(Flow.canStart({ ...ready, active: true }), false);
  assert.equal(Flow.canStart({ ...ready, busy: true }), false);
  assert.equal(Flow.startBlockers({ ...ready, busy: true }).length, 0, 'busy는 사유 목록이 아니라 잠깐의 잠금이다');
  assert.equal(Flow.canStart({ ...ready, date: '' }), false);
  assert.equal(Flow.canStart({ ...ready, notes: 'a'.repeat(4000) }), true);
  assert.equal(Flow.canStart({ ...ready, notes: 'a'.repeat(4001) }), false);
  assert.equal(Flow.canStart({ ...ready, projectName: '   ' }), false);
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
