// 회의 배경이 실제 요약 요청에 전달되고 잘못된 입력은 외부 호출 전에 거절되는지 검증한다.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { createMeetingServer } = require('./서버.cjs');

async function fixture(t) {
  const requests = [];
  const minutes = { overview: '준비 회의', topics: [], decisions: [], actions: [], openQuestions: [] };
  const meeting = createMeetingServer({ apiFetch: async (url, options) => {
    requests.push(JSON.parse(options.body));
    return Response.json({ status: 'completed', usage: { input_tokens: 10, output_tokens: 10 }, output: [{ type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: JSON.stringify(minutes) }] }] });
  } });
  await new Promise(resolve => meeting.server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => meeting.server.close(resolve)));
  const url = `http://127.0.0.1:${meeting.server.address().port}`;
  const headers = { 'X-Meeting-Token': meeting.token, Origin: url, 'Content-Type': 'application/json' };
  const key = await fetch(`${url}/api/key`, { method: 'POST', headers, body: JSON.stringify({ apiKey: 'test-only', persist: false }) });
  assert.equal(key.status, 200);
  await key.text();
  return { requests, async summarize(context) {
    return fetch(`${url}/api/summary`, { method: 'POST', headers: { ...headers, 'X-Operation-Id': randomUUID(), 'X-AI-Consent': 'yes' },
      body: JSON.stringify({ text: '자료 준비 담당자는 다음 회의에서 정합니다.', title: '예시 프로젝트 프로젝트 구현 준비 회의', date: '2026-09-30', participants: '', context }) });
  } };
}

test('회의 배경을 녹취와 분리해 요약 요청에 전달한다', async t => {
  const { requests, summarize } = await fixture(t);
  const context = '구현에 필요한 자료와 담당자 및 미정 사항을 정리한다.';
  const response = await summarize(context);
  assert.equal(response.status, 200);
  await response.text();
  const input = JSON.parse(requests[0].input.find(item => item.role === 'user').content);
  assert.equal(input.context, context);
  assert.equal(input.transcript, '자료 준비 담당자는 다음 회의에서 정합니다.');
  assert.match(requests[0].input.filter(item => item.role === 'system').map(item => item.content).join(' '), /사전 참고/);
});

test('너무 긴 배경이나 문자열이 아닌 배경은 AI 호출 없이 거절한다', async t => {
  const { requests, summarize } = await fixture(t);
  for (const context of ['가'.repeat(4001), { arbitrary: true }]) {
    const response = await summarize(context);
    assert.equal(response.status, 400);
    await response.text();
  }
  assert.equal(requests.length, 0);
});

test('배경이 없는 기존 요약 요청도 처리한다', async t => {
  const { summarize } = await fixture(t);
  const response = await summarize(undefined);
  assert.equal(response.status, 200);
  await response.text();
});
