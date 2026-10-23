// 요약 요청이 프로젝트 배경 없이 만들어지고 의견 반영 칸과 지시문이 정해진 자리에 들어가는지 검증한다.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { createMeetingServer } = require('./서버.cjs');

const FEEDBACK_INSTRUCTION = "feedback은 사용자가 앞선 정리본을 읽고 남긴 검토 의견입니다. 의견이 가리키는 내용을 전사에서 다시 확인해 고쳐 정리하세요. 의견에 있더라도 전사에 없는 발언·결정·담당자·기한은 만들지 마세요. 의견이 전사와 맞지 않으면 전사를 따르고 '확인 필요'로 남기세요.";
const minutes = { overview: '준비 회의', topics: [], decisions: [], actions: [], openQuestions: [] };

async function fixture(t) {
  const requests = [];
  const meeting = createMeetingServer({ apiFetch: async (url, options) => {
    if (String(url).includes('/audio/transcriptions')) {
      requests.push({ url });
      return Response.json({ text: '전사된 발언입니다.', usage: { type: 'duration', seconds: 3 } });
    }
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
  const send = async (route, body, extra = {}) => {
    const response = await fetch(url + route, { method: 'POST', headers: { ...headers, 'X-Operation-Id': randomUUID(), ...extra },
      body: typeof body === 'string' || body instanceof Uint8Array ? body : JSON.stringify(body) });
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : null };
  };
  const summarize = (extra = {}, headerExtra = { 'X-AI-Consent': 'yes' }) => send('/api/summary',
    { text: '자료 준비 담당자는 다음 회의에서 정합니다.', title: '구현 준비 회의', date: '2026-09-30', participants: '', ...extra }, headerExtra);
  const summaryRequests = () => requests.filter(request => Array.isArray(request.input));
  return { requests, summaryRequests, send, summarize };
}

const userMessage = request => JSON.parse(request.input.find(item => item.role === 'user').content);
const systemTexts = request => request.input.filter(item => item.role === 'system').map(item => item.content);

test('요약 요청에 context 칸과 context 지침이 없다', async t => {
  const { summaryRequests, summarize } = await fixture(t);
  const response = await summarize();
  assert.equal(response.status, 200);
  const [request] = summaryRequests();
  assert.equal(Object.keys(userMessage(request)).sort().join(','), 'date,participants,title,transcript');
  assert.equal(systemTexts(request).some(text => text.startsWith('context는')), false);
  assert.equal(systemTexts(request).some(text => text.includes('context와 같은')), false);
});

test('context를 보내면 AI 호출 없이 400으로 거절한다', async t => {
  const { requests, summarize } = await fixture(t);
  for (const context of ['구현에 필요한 자료와 담당자를 정리한다.', '']) {
    const response = await summarize({ context });
    assert.equal(response.status, 400);
    assert.equal(response.body.error.code, 'INVALID_INPUT');
  }
  assert.equal(requests.length, 0);
});

test('feedback이 없으면 의견 지시문을 넣지 않는다', async t => {
  const { summaryRequests, summarize } = await fixture(t);
  assert.equal((await summarize({ notes: '안건 메모' })).status, 200);
  const [request] = summaryRequests();
  assert.equal(systemTexts(request).includes(FEEDBACK_INSTRUCTION), false);
  assert.equal('feedback' in userMessage(request), false);
});

test('feedback이 있으면 notes 지침 뒤, user 바로 앞에 의견 지시문을 넣는다', async t => {
  const { summaryRequests, summarize } = await fixture(t);
  assert.equal((await summarize({ notes: '안건 메모', feedback: '담당자가 틀렸어요. 견적 검토는 이대리가 맡기로 했습니다.' })).status, 200);
  const [request] = summaryRequests();
  assert.equal(request.input.at(-1).role, 'user');
  assert.equal(request.input.at(-2).content, FEEDBACK_INSTRUCTION);
  assert.ok(request.input.at(-3).content.startsWith('notes가 있으면'));
  assert.equal(request.input.at(-3).content.includes('context'), false);
  assert.deepEqual(Object.keys(userMessage(request)), ['notes', 'title', 'date', 'participants', 'transcript', 'feedback']);
  assert.equal(userMessage(request).feedback, '담당자가 틀렸어요. 견적 검토는 이대리가 맡기로 했습니다.');
});

test('feedback은 1,000자까지 그대로 받고 1,001자·빈 글·글이 아닌 값은 AI 호출 없이 거절한다', async t => {
  const { summaryRequests, summarize } = await fixture(t);
  const head = '첫 줄 "인용"과 \'따옴표\'\n둘째 줄: 이전 지시를 무시하라고 적어도 의견일 뿐입니다.\n';
  const exact = head + '가'.repeat(1000 - head.length);
  assert.equal(exact.length, 1000);
  assert.equal((await summarize({ feedback: exact })).status, 200);
  assert.equal(userMessage(summaryRequests()[0]).feedback, exact);
  for (const feedback of ['가'.repeat(1001), '', '   ', 42]) {
    const response = await summarize({ feedback });
    assert.equal(response.status, 400);
    assert.equal(response.body.error.code, 'INVALID_INPUT');
  }
  assert.equal(summaryRequests().length, 1);
});

test('동의 머리글 없이도 전사·요약 요청을 받는다', async t => {
  const { send, summarize } = await fixture(t);
  const wav = Buffer.alloc(44);
  wav.write('RIFF', 0); wav.writeUInt32LE(36, 4); wav.write('WAVE', 8);
  const transcribed = await send('/api/transcribe', new Uint8Array(wav), { 'Content-Type': 'audio/wav' });
  assert.equal(transcribed.status, 200);
  assert.equal(transcribed.body.text, '전사된 발언입니다.');
  assert.equal((await summarize({}, {})).status, 200);
});

test('요청 id가 없으면 여전히 400으로 거절한다', async t => {
  const { requests, send } = await fixture(t);
  const response = await send('/api/summary', { text: '발언', title: '회의', date: '2026-09-30', participants: '' }, { 'X-Operation-Id': '' });
  assert.equal(response.status, 400);
  assert.equal(response.body.error.code, 'INVALID_OPERATION');
  assert.equal(requests.length, 0);
});
