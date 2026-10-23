// 요약 길이 제한과 계정 제한을 구분하고 유료 요청을 자동 반복하지 않는지 검증한다.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { createMeetingServer } = require('./서버.cjs');
async function run(t, status, body) {
  const calls = [];
  const meeting = createMeetingServer({ apiFetch: async (url, options) => {
    calls.push(JSON.parse(options.body));
    return Response.json(body, { status, headers: { 'x-request-id': 'req_summary_test' } });
  } });
  await new Promise(resolve => meeting.server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => meeting.server.close(resolve)));
  const origin = `http://127.0.0.1:${meeting.server.address().port}`;
  const headers = { Origin: origin, 'X-Meeting-Token': meeting.token, 'Content-Type': 'application/json' };
  const key = await fetch(origin + '/api/key', { method: 'POST', headers, body: JSON.stringify({ apiKey: 'mock-only', persist: false }) });
  await key.text();
  const response = await fetch(origin + '/api/summary', { method: 'POST', headers: { ...headers, 'X-Operation-Id': randomUUID(), 'X-AI-Consent': 'yes' },
    body: JSON.stringify({ text: '가'.repeat(14977), title: '회의', date: '2026-09-30', participants: '' }) });
  return { status: response.status, body: await response.json(), calls };
}
test('14977자 전사를 자르지 않고 Sol 모델과 32000토큰 출력 여유를 요청한다', async t => {
  const minutes = { overview: '회의', topics: [], decisions: [], actions: [], openQuestions: [] };
  const result = await run(t, 200, { status: 'completed', usage: { input_tokens: 15000, output_tokens: 1000 }, output: [{ type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: JSON.stringify(minutes) }] }] });
  assert.equal(result.status, 200);
  assert.equal(result.calls[0].max_output_tokens, 32000);
  assert.equal(result.calls[0].model, 'gpt-6.1-sol');
  assert.equal(result.calls[0].reasoning.effort, 'medium');
  assert.match(result.calls[0].input.filter(x => x.role === 'system').map(x => x.content).join(' '), /이전 topics의 제목을 그대로 유지/);
  assert.equal(JSON.parse(result.calls[0].input.find(x => x.role === 'user').content).transcript.length, 14977);
});
test('출력 한도에 도달한 미완료 응답은 형식 오류와 구분한다', async t => {
  const result = await run(t, 200, { status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' }, output: [] });
  assert.equal(result.body.error.code, 'AI_OUTPUT_LIMIT');
  assert.match(result.body.error.message, /출력 한도/);
  assert.match(result.body.error.message, /req_summary_test/);
  assert.equal(result.calls.length, 1);
});
for (const code of ['insufficient_quota', 'credit_balance_exhausted', 'organization_spend_limit_exceeded', 'project_spend_limit_exceeded', 'organization_usage_limit_exceeded']) {
  test(`계정 제한 ${code}는 기다리라는 안내로 처리하지 않는다`, async t => {
    const result = await run(t, 429, { error: { code, type: 'insufficient_quota', message: 'SECRET_PROVIDER_TEXT' } });
    assert.equal(result.body.error.code, 'AI_QUOTA_EXCEEDED');
    assert.doesNotMatch(result.body.error.message, /잠시 후|SECRET_PROVIDER_TEXT/);
    assert.equal(result.calls.length, 1);
  });
}
test('분당 처리량 제한은 계정 잔액 부족과 구분한다', async t => {
  const result = await run(t, 429, { error: { code: 'rate_limit_exceeded', type: 'tokens' } });
  assert.equal(result.body.error.code, 'AI_RATE_LIMIT');
  assert.match(result.body.error.message, /분당/);
});
test('입력 문맥 한도 초과는 출력 한도와 구분한다', async t => {
  const result = await run(t, 400, { error: { code: 'context_length_exceeded' } });
  assert.equal(result.body.error.code, 'AI_INPUT_LIMIT');
});
