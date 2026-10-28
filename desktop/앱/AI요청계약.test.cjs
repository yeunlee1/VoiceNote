// 요약 모델 선택 저장, 모델별 요청, 응답·오류의 사용량 계약을 모의 OpenAI로 검증한다.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { createMeetingServer } = require('./서버.cjs');
const SECRET = 'sk-test-SECRET-never-shown-1234567890';
const minutes = { overview: '회의', topics: [], decisions: [], actions: [], openQuestions: [] };
const completed = (usage = { input_tokens: 1200, input_tokens_details: { cached_tokens: 200 }, output_tokens: 900, output_tokens_details: { reasoning_tokens: 700 }, total_tokens: 2100 }) => ({
  status: 'completed', ...(usage ? { usage } : {}),
  output: [{ type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: JSON.stringify(minutes) }] }] });

async function start(t, reply, options = {}) {
  const calls = [];
  const meeting = createMeetingServer({ ...options, apiFetch: async (url, request) => {
    calls.push({ url, headers: request.headers, body: typeof request.body === 'string' ? JSON.parse(request.body) : request.body });
    const [status, body] = await reply(calls.length, calls.at(-1));
    return Response.json(body, { status, headers: { 'x-request-id': 'req_contract' } });
  } });
  await new Promise(resolve => meeting.server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => meeting.server.close(resolve)));
  const origin = `http://127.0.0.1:${meeting.server.address().port}`;
  const headers = { Origin: origin, 'X-Meeting-Token': meeting.token, 'Content-Type': 'application/json' };
  const post = async (route, body, extra = {}) => {
    const response = await fetch(origin + route, { method: 'POST', headers: { ...headers, ...extra }, body: typeof body === 'string' || body instanceof Uint8Array ? body : JSON.stringify(body) });
    const text = await response.text();
    return { status: response.status, text, body: JSON.parse(text) };
  };
  const ai = (route, body, type) => post(route, body, { 'X-Operation-Id': randomUUID(), 'X-AI-Consent': 'yes', ...(type ? { 'Content-Type': type } : {}) });
  const config = async () => (await fetch(origin + '/api/config', { headers })).json();
  if (!options.noKey) await post('/api/key', { apiKey: SECRET, persist: false });
  return { calls, post, ai, config, origin, headers };
}
const summaryBody = extra => ({ text: '회의 발언입니다.', title: '회의', date: '2026-10-01', participants: '', ...extra });

test('설정 조회는 모델 목록·기본값·선택값·요청 한도를 알려주고 선택을 저장한다', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'AI설정-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const keyFile = path.join(dir, '.env.회의록키');
  const first = await start(t, async () => [200, completed()], { keyFile, noKey: true });
  const config = await first.config();
  assert.equal(config.defaultSummaryModel, 'gpt-6.1-sol');
  assert.equal(config.summaryModel, 'gpt-6.1-sol');
  assert.equal(config.transcriptionModel, 'gpt-transcribe');
  assert.equal(config.summaryModelError, '');
  assert.equal(config.summaryModels.length, 3);
  assert.ok(config.summaryModels.every(model => model.maxOutputTokens === 32000));
  const saved = await first.post('/api/settings', { summaryModel: 'gpt-6-luna' });
  assert.deepEqual(saved.body.settings, { summaryModel: 'gpt-6-luna', defaultOutputFormat: 'meeting', storage: { audio: '', transcript: '', summary: '' } });
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'AI설정.json'), 'utf8')).summaryModel, 'gpt-6-luna');
  const rejected = await first.post('/api/settings', { summaryModel: 'gpt-made-up' });
  assert.equal(rejected.status, 400);
  assert.equal(rejected.body.error.code, 'INVALID_MODEL');
  const second = await start(t, async () => [200, completed()], { keyFile, noKey: true });
  assert.equal((await second.config()).summaryModel, 'gpt-6-luna');
});

test('저장된 모델이 목록에 없으면 기본 모델로 바꾸지 않고 요약을 보내지 않는다', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'AI설정-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'AI설정.json'), JSON.stringify({ summaryModel: 'gpt-retired' }));
  const server = await start(t, async () => [200, completed()], { keyFile: path.join(dir, '.env.회의록키') });
  const config = await server.config();
  assert.equal(config.summaryModel, null);
  assert.match(config.summaryModelError, /다시 선택/);
  const result = await server.ai('/api/summary', summaryBody());
  assert.equal(result.body.error.code, 'INVALID_MODEL');
  assert.equal(server.calls.length, 0);
});

test('선택한 모델과 회의별 상세 내용을 보내고 응답에 모델별 사용량을 싣는다', async t => {
  const server = await start(t, async () => [200, completed()]);
  const result = await server.ai('/api/summary', summaryBody({ model: 'gpt-6-astra', notes: '이번 회의는 화면 개편 안건입니다.' }));
  assert.equal(result.status, 200);
  const sent = server.calls[0].body;
  assert.equal(sent.model, 'gpt-6-astra');
  assert.equal(sent.max_output_tokens, 32000);
  assert.deepEqual(sent.reasoning, { effort: 'medium' });
  assert.equal('temperature' in sent || 'top_p' in sent, false);
  const user = JSON.parse(sent.input.find(item => item.role === 'user').content);
  assert.equal(user.notes, '이번 회의는 화면 개편 안건입니다.');
  assert.equal('context' in user, false);
  assert.match(sent.input.filter(item => item.role === 'system').map(item => item.content).join(' '), /notes가 있으면/);
  assert.equal(result.body.model, 'gpt-6-astra');
  assert.equal(result.body.maxOutputTokens, 32000);
  assert.deepEqual(result.body.usage, { inputTokens: 1200, outputTokens: 900, totalTokens: 2100, cachedInputTokens: 200, reasoningTokens: 700 });
  assert.match(result.body.aiCall.callId, /^[0-9a-f-]{36}$/);
  assert.deepEqual(result.body.aiCall, { callId: result.body.aiCall.callId, kind: 'summary', model: 'gpt-6-astra', sent: true, usage: result.body.usage });
  assert.doesNotMatch(result.text, /SECRET/);
});

test('모델을 지정하지 않으면 저장된 선택 모델을 쓰고 상세 내용이 없으면 요청 형식을 늘리지 않는다', async t => {
  const server = await start(t, async () => [200, completed()]);
  await server.post('/api/settings', { summaryModel: 'gpt-6-astra' });
  const result = await server.ai('/api/summary', summaryBody());
  assert.equal(server.calls[0].body.model, 'gpt-6-astra');
  assert.equal('notes' in JSON.parse(server.calls[0].body.input.find(item => item.role === 'user').content), false);
  assert.equal(result.body.model, 'gpt-6-astra');
});

test('목록에 없는 모델과 너무 긴 상세 내용은 OpenAI에 보내기 전에 거절한다', async t => {
  const server = await start(t, async () => [200, completed()]);
  const model = await server.ai('/api/summary', summaryBody({ model: 'gpt-4o' }));
  assert.equal(model.body.error.code, 'INVALID_MODEL');
  const notes = await server.ai('/api/summary', summaryBody({ notes: '가'.repeat(4001) }));
  assert.equal(notes.body.error.code, 'INVALID_INPUT');
  assert.equal(server.calls.length, 0);
  assert.equal(model.body.error.aiCall, undefined);
});

test('출력 한도 미완료 응답도 과금된 사용량을 오류와 함께 돌려준다', async t => {
  const server = await start(t, async () => [200, { status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' }, output: [],
    usage: { input_tokens: 5000, output_tokens: 32000, output_tokens_details: { reasoning_tokens: 31000 }, total_tokens: 37000 } }]);
  const result = await server.ai('/api/summary', summaryBody({ model: 'gpt-6-astra' }));
  assert.equal(result.body.error.code, 'AI_OUTPUT_LIMIT');
  assert.equal(result.body.error.aiCall.sent, true);
  assert.equal(result.body.error.aiCall.model, 'gpt-6-astra');
  assert.equal(result.body.error.aiCall.usage.totalTokens, 37000);
  assert.equal(server.calls.length, 1);
});

test('사용량 없이 실패하면 전송은 기록하되 사용량은 미확인으로 남기고 자동 재시도하지 않는다', async t => {
  const server = await start(t, async () => [429, { error: { code: 'rate_limit_exceeded', message: 'provider text' } }]);
  const result = await server.ai('/api/summary', summaryBody());
  assert.equal(result.body.error.code, 'AI_RATE_LIMIT');
  assert.deepEqual(result.body.error.aiCall, { callId: result.body.error.aiCall.callId, kind: 'summary', model: 'gpt-6.1-sol', sent: true, usage: null });
  assert.equal(server.calls.length, 1);
  assert.doesNotMatch(result.text, /SECRET|provider text/);
});

test('공급자가 사용량을 빼고 보내도 회의록은 버리지 않고 사용량을 null로 둔다', async t => {
  const server = await start(t, async () => [200, completed(null)]);
  const result = await server.ai('/api/summary', summaryBody());
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.minutes, minutes);
  assert.equal(result.body.usage, null);
  assert.equal(result.body.aiCall.usage, null);
});

test('계정에서 쓸 수 없는 모델은 다른 모델로 바꾸지 않고 모델명을 알려준다', async t => {
  const server = await start(t, async () => [404, { error: { code: 'model_not_found' } }]);
  const result = await server.ai('/api/summary', summaryBody({ model: 'gpt-6-astra' }));
  assert.equal(result.body.error.code, 'AI_MODEL_UNAVAILABLE');
  assert.match(result.body.error.message, /gpt-6-astra/);
  assert.equal(server.calls.length, 1);
  assert.equal(server.calls[0].body.model, 'gpt-6-astra');
});

test('전사 응답은 전사 모델과 초 단위 사용량을 요약 사용량과 구분해 싣는다', async t => {
  const server = await start(t, async () => [200, { text: '안녕하세요.', usage: { type: 'duration', seconds: 42 } }]);
  const wav = Buffer.alloc(44);
  wav.write('RIFF', 0); wav.writeUInt32LE(36, 4); wav.write('WAVE', 8);
  const result = await server.ai('/api/transcribe', new Uint8Array(wav), 'audio/wav');
  assert.equal(result.status, 200);
  assert.equal(server.calls[0].body.get('model'), 'gpt-transcribe');
  assert.equal(result.body.model, 'gpt-transcribe');
  assert.equal(result.body.audioSeconds, 42);
  assert.deepEqual(result.body.aiCall, { callId: result.body.aiCall.callId, kind: 'transcription', model: 'gpt-transcribe', sent: true, usage: null, audioSeconds: 42 });
});

test('공용 사용량 도구를 화면용 스크립트로 제공한다', async t => {
  const server = await start(t, async () => [200, completed()]);
  const response = await fetch(server.origin + '/ai-usage.js');
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /javascript/);
  assert.match(await response.text(), /MeetingAiUsage/);
});

test('같은 요청 식별자를 다시 보내면 OpenAI를 다시 부르지 않고 같은 callId를 돌려준다', async t => {
  const server = await start(t, async () => [200, completed()]);
  const id = randomUUID();
  const send = () => server.post('/api/summary', summaryBody(), { 'X-Operation-Id': id, 'X-AI-Consent': 'yes' });
  const first = await send(), second = await send();
  assert.equal(server.calls.length, 1);
  assert.equal(first.body.aiCall.callId, second.body.aiCall.callId);
  const other = await server.ai('/api/summary', summaryBody());
  assert.notEqual(other.body.aiCall.callId, first.body.aiCall.callId);
});

test('사용량 원장은 응답의 실제 스냅샷 모델을 쓰고 요청 모델 고정과 설정은 그대로 둔다', async t => {
  const server = await start(t, async () => [200, { ...completed(), model: 'gpt-6.1-sol-2026-09-15' }]);
  await server.post('/api/settings', { summaryModel: 'gpt-6-luna' });
  const result = await server.ai('/api/summary', summaryBody());
  assert.equal(server.calls[0].body.model, 'gpt-6-luna');
  assert.equal(result.body.model, 'gpt-6-luna');
  assert.equal(result.body.aiCall.model, 'gpt-6.1-sol-2026-09-15');
  assert.equal(result.body.aiCall.usage.totalTokens, 2100);
  assert.equal((await server.config()).summaryModel, 'gpt-6-luna');
});

for (const reported of [undefined, '', 42, '../bad model', 'x'.repeat(101)]) {
  test(`응답 모델이 ${JSON.stringify(reported)?.slice(0, 20)}이면 요청 모델로 기록한다`, async t => {
    const server = await start(t, async () => [200, { ...completed(), ...(reported === undefined ? {} : { model: reported }) }]);
    const result = await server.ai('/api/summary', summaryBody({ model: 'gpt-6-luna' }));
    assert.equal(result.body.aiCall.model, 'gpt-6-luna');
  });
}

test('출력 한도 미완료 응답도 실제 응답 모델로 사용량을 돌려준다', async t => {
  const server = await start(t, async () => [200, { status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' }, output: [], model: 'gpt-6-astra-2026-04-30',
    usage: { input_tokens: 10, output_tokens: 32000, total_tokens: 32010 } }]);
  const result = await server.ai('/api/summary', summaryBody({ model: 'gpt-6-astra' }));
  assert.equal(result.body.error.code, 'AI_OUTPUT_LIMIT');
  assert.equal(result.body.error.aiCall.model, 'gpt-6-astra-2026-04-30');
  assert.equal(result.body.error.aiCall.usage.totalTokens, 32010);
});

test('응답 전 HTTP 오류와 과금 전 오류는 요청 모델 그대로이며 과금 전 오류는 세지 않는다', async t => {
  const server = await start(t, async () => [503, { error: { code: 'server_error' } }]);
  const failed = await server.ai('/api/summary', summaryBody({ model: 'gpt-6-luna' }));
  assert.deepEqual({ model: failed.body.error.aiCall.model, sent: failed.body.error.aiCall.sent, usage: failed.body.error.aiCall.usage }, { model: 'gpt-6-luna', sent: true, usage: null });
  const rejected = await server.ai('/api/summary', summaryBody({ model: 'gpt-unknown' }));
  assert.equal(rejected.body.error.aiCall, undefined);
  assert.equal(server.calls.length, 1);
});

test('전사도 응답 모델이 있으면 그 이름으로, 없으면 전사 모델로 기록한다', async t => {
  const wav = Buffer.alloc(44);
  wav.write('RIFF', 0); wav.writeUInt32LE(36, 4); wav.write('WAVE', 8);
  const withModel = await start(t, async () => [200, { text: '안녕하세요.', model: 'gpt-transcribe-2026-03-01', usage: { type: 'duration', seconds: 5 } }]);
  const first = await withModel.ai('/api/transcribe', new Uint8Array(wav), 'audio/wav');
  assert.equal(first.body.aiCall.model, 'gpt-transcribe-2026-03-01');
  assert.equal(first.body.aiCall.kind, 'transcription');
  assert.equal(first.body.model, 'gpt-transcribe');
  const without = await start(t, async () => [200, { text: '안녕하세요.', model: 7 }]);
  const second = await without.ai('/api/transcribe', new Uint8Array(wav), 'audio/wav');
  assert.equal(second.body.aiCall.model, 'gpt-transcribe');
});

test('내 형식은 회의록형 기준 바로 다음에 사용자 항목·순서·추가 지시를 보내고 잘못된 정의는 보내지 않는다', async t => {
  const server = await start(t, async () => [200, completed()]);
  const customFormat = { name: '주간 보고', sections: [{ key: 'actions', title: '이번 주 할 일' }, { key: 'overview', title: '한 줄 요약' }], instruction: '할 일은 부서별로 묶어 주세요.' };
  const result = await server.ai('/api/summary', summaryBody({ outputFormat: 'custom', customFormat }));
  assert.equal(result.status, 200);
  const system = server.calls[0].body.input.filter(item => item.role === 'system').map(item => item.content);
  assert.match(system[0], /^회의록 작성 양식과 품질 기준을 따르세요/);
  assert.equal(system[1], require('./출력형식.js').customInstruction(customFormat));
  assert.match(system[1], /'주간 보고'.*이번 주 할 일\(actions\) → 한 줄 요약\(overview\)/s);
  assert.match(system[1], /사용자 추가 지시: 할 일은 부서별로 묶어 주세요\./);
  const plain = await server.ai('/api/summary', summaryBody({ outputFormat: 'summary' }));
  assert.equal(plain.status, 200);
  assert.doesNotMatch(server.calls[1].body.input.map(item => item.content).join('\n'), /사용자가 정한 출력 형식/);
  const before = server.calls.length;
  for (const bad of [undefined, { name: '', sections: [{ key: 'overview', title: '요약' }] }, { name: '형식', sections: [] }, { name: '형식', sections: [{ key: 'transcript', title: '원문' }] }]) {
    const rejected = await server.ai('/api/summary', summaryBody({ outputFormat: 'custom', customFormat: bad }));
    assert.equal(rejected.status, 400);
  }
  assert.equal(server.calls.length, before);
});
