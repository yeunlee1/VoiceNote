// 긴 회의 결과를 읽기 좋은 길이로 줄이는 규칙·요청과 참석자 이름 힌트를 모의 OpenAI로 검증한다.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { createMeetingServer } = require('./서버.cjs');
const formats = require('./출력형식.js');

const text = count => '가'.repeat(count);
const shaped = (body, kept = 0) => ({ overview: text(body), topics: [], decisions: kept ? [text(kept)] : [], actions: [], openQuestions: [] });
const completed = value => ({ status: 'completed', usage: { input_tokens: 10, output_tokens: 5 },
  output: [{ type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: JSON.stringify(value) }] }] });
const source = {
  suggestedTitle: '표준화 회의',
  overview: `전체 방향 | ${text(500)}`,
  topics: [{ title: '양식', points: [text(800), text(800)] }, { title: '일정', points: [text(800)] }],
  decisions: ['양식 — 공통 양식을 씁니다.'],
  actions: [{ task: '초안 작성', owner: '김과장', due: null }],
  openQuestions: ['기한 미정'],
};
const request = extra => ({ title: '표준화 회의', date: '2026-11-05', participants: '김과장, 이대리', targetCharacters: 1500, minutes: source, ...extra });

async function start(t, reply) {
  const calls = [];
  const meeting = createMeetingServer({ apiFetch: async (url, options) => {
    calls.push({ url, headers: options.headers, body: typeof options.body === 'string' ? JSON.parse(options.body) : options.body });
    const [status, body] = reply(calls.length, calls.at(-1));
    return Response.json(body, { status });
  } });
  await new Promise(resolve => meeting.server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => meeting.server.close(resolve)));
  const origin = `http://127.0.0.1:${meeting.server.address().port}`;
  const headers = { Origin: origin, 'X-Meeting-Token': meeting.token, 'Content-Type': 'application/json' };
  await (await fetch(origin + '/api/key', { method: 'POST', headers, body: JSON.stringify({ apiKey: 'mock-only', persist: false }) })).text();
  const post = async (route, body, extra = {}) => {
    const response = await fetch(origin + route, { method: 'POST', headers: { ...headers, 'X-Operation-Id': randomUUID(), 'X-AI-Consent': 'yes', ...extra }, body: body instanceof Uint8Array ? body : JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
  };
  return { calls, post };
}

test('글자 수는 주제 제목·문단과 할 일의 담당·기한까지 센다', () => {
  const minutes = { suggestedTitle: '세지 않는 제목', overview: '12345', topics: [{ title: '가나', points: ['다라마', '바'] }], decisions: ['1234'], actions: [{ task: '일', owner: '김과장', due: '내일' }], openQuestions: ['미정'] };
  assert.deepEqual(formats.minutesLengths(minutes), { body: 11, kept: 12 });
  assert.deepEqual(formats.minutesLengths({}), { body: 0, kept: 0 });
});

test('목표 길이의 1.2배까지는 줄이지 않는다', () => {
  assert.equal(formats.compactTarget(shaped(3600), 'meeting'), 0);
  assert.equal(formats.compactTarget(shaped(1200), 'summary'), 0);
  assert.equal(formats.compactTarget(shaped(2400), 'tasks'), 0);
});

test('목표를 넘으면 유지할 목록을 뺀 나머지를 본문 목표로 돌려준다', () => {
  assert.equal(formats.compactTarget(shaped(3601), 'meeting'), 3000);
  assert.equal(formats.compactTarget(shaped(3000, 1000), 'meeting'), 2000);
  assert.equal(formats.compactTarget(shaped(1201), 'summary'), 1000);
  assert.equal(formats.compactTarget(shaped(2401), 'tasks'), 2000);
});

test('유지할 목록이 많아도 본문 목표는 형식 목표의 절반 아래로 내려가지 않는다', () => {
  assert.equal(formats.compactTarget(shaped(2000, 5000), 'meeting'), 1500);
  assert.equal(formats.compactTarget(shaped(600, 1000), 'summary'), 500);
});

test('본문이 이미 목표 안이면 목록이 길어도 요청하지 않는다', () => {
  assert.equal(formats.compactTarget(shaped(1000, 5000), 'meeting'), 0);
  assert.equal(formats.compactTarget(shaped(500, 1000), 'summary'), 0);
});

test('내 형식은 회의록과 같은 목표를 쓰고 모르는 형식도 회의록으로 본다', () => {
  for (const format of ['custom', undefined, 'report']) assert.equal(formats.compactTarget(shaped(3601), format), 3000);
});

test('참석자 칸을 이름 단어로 나눈다', () => {
  assert.deepEqual(formats.participantKeywords('김철수, 이영희/박민수 · 최지은\n개발팀 김대리;John-Kim，A_팀'), ['김철수', '이영희', '박민수', '최지은', '개발팀', '김대리', 'John-Kim', 'A_팀']);
  assert.deepEqual(formats.participantKeywords(''), []);
  assert.deepEqual(formats.participantKeywords(null), []);
});

test('OpenAI가 거절하는 글자·한 글자 단어·중복은 뺀다', () => {
  assert.deepEqual(formats.participantKeywords('<김철수>, 외, 김철수, 이\u000d\u000a영희, 😀박민수'), ['김철수', '영희', '박민수']);
});

test('힌트 단어는 20개까지이고 30자를 넘는 단어는 뺀다', () => {
  const many = Array.from({ length: 25 }, (_, index) => `이름${index}`).join(',');
  assert.equal(formats.participantKeywords(many).length, 20);
  assert.deepEqual(formats.participantKeywords(`${text(31)},${'나'.repeat(30)}`), ['나'.repeat(30)]);
});

test('overview와 topics만 줄이고 제목·결정·할 일·미확정은 원문 그대로 되붙인다', async t => {
  const shorter = { overview: '전체 방향 | 짧게 씁니다.', topics: [{ title: '양식과 일정', points: ['합쳐서 씁니다.'] }] };
  const server = await start(t, () => [200, completed(shorter)]);
  const result = await server.post('/api/summary/compact', request());
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.minutes, { ...source, ...shorter });
  assert.equal(result.body.shortened, true);
  assert.equal(result.body.aiCall.kind, 'summary');
  assert.equal(server.calls.length, 1);
  const body = server.calls[0].body;
  assert.equal(server.calls[0].url, 'https://api.openai.com/v1/responses');
  assert.equal(body.store, false);
  assert.equal(body.max_output_tokens, 32000);
  assert.equal(body.text.format.strict, true);
  assert.deepEqual(body.text.format.schema.required, ['overview', 'topics']);
  assert.equal(body.text.format.schema.additionalProperties, false);
  assert.deepEqual(body.input.map(item => item.role), ['system', 'user']);
  assert.match(body.input[0].content, /overview와 topics만/);
  assert.match(body.input[0].content, /targetCharacters/);
  assert.match(body.input[0].content, /만들지 않습니다/);
  assert.match(body.input[0].content, /앞부분에만 나온/);
  const user = JSON.parse(body.input[1].content);
  assert.deepEqual(Object.keys(user), ['title', 'date', 'participants', 'targetCharacters', 'minutes']);
  assert.equal(user.targetCharacters, 1500);
  assert.deepEqual(user.minutes, source);
});

test('모델이 결정이나 할 일까지 돌려주면 형식 오류로 처리한다', async t => {
  const server = await start(t, () => [200, completed({ overview: '짧게', topics: [], decisions: [] })]);
  const result = await server.post('/api/summary/compact', request());
  assert.equal(result.body.error.code, 'AI_RESPONSE_INVALID');
});

for (const [name, answer] of [
  ['더 길면', { overview: text(4000), topics: [] }],
  ['핵심 요약이 비면', { overview: ' ', topics: [{ title: '양식', points: ['짧게'] }] }],
  ['주제를 모두 지우면', { overview: '짧게', topics: [] }],
]) {
  test(`${name} 원래 결과를 돌려준다`, async t => {
    const server = await start(t, () => [200, completed(answer)]);
    const result = await server.post('/api/summary/compact', request());
    assert.equal(result.status, 200);
    assert.deepEqual(result.body.minutes, source);
    assert.equal(result.body.shortened, false);
  });
}

test('앞선 결과에 주제가 없으면 주제 없는 답도 받아들인다', async t => {
  const plain = { ...source, topics: [] };
  const server = await start(t, () => [200, completed({ overview: '짧게', topics: [] })]);
  const result = await server.post('/api/summary/compact', request({ minutes: plain }));
  assert.equal(result.body.minutes.overview, '짧게');
});

test('내 형식의 지시를 함께 보내고 의견은 사용자 메시지 끝에 넣는다', async t => {
  const custom = { name: '주간', sections: [{ key: 'overview', title: '요약' }, { key: 'topics', title: '내용' }], instruction: '부서별로' };
  const server = await start(t, () => [200, completed({ overview: '짧게', topics: [{ title: '양식', points: ['짧게'] }] })]);
  const result = await server.post('/api/summary/compact', request({ outputFormat: 'custom', customFormat: custom, feedback: '일정을 자세히' }));
  assert.equal(result.status, 200);
  const body = server.calls[0].body;
  assert.deepEqual(body.input.map(item => item.role), ['system', 'system', 'user']);
  assert.equal(body.input[1].content, formats.customInstruction(formats.validateCustom(custom)));
  const user = JSON.parse(body.input[2].content);
  assert.deepEqual(Object.keys(user), ['title', 'date', 'participants', 'targetCharacters', 'minutes', 'feedback']);
  assert.equal(user.feedback, '일정을 자세히');
  assert.match(body.input[0].content, /feedback/);
});

for (const [name, extra] of [
  ['결과가 없으면', { minutes: undefined }],
  ['목표가 너무 작으면', { targetCharacters: 99 }],
  ['목표가 너무 크면', { targetCharacters: 12001 }],
  ['목표가 글이면', { targetCharacters: '1500' }],
  ['목표가 소수면', { targetCharacters: 1500.5 }],
  ['모르는 형식이면', { outputFormat: 'report' }],
  ['의견이 길면', { feedback: text(1001) }],
  ['결과가 너무 길면', { minutes: { ...source, overview: text(8001) } }],
]) {
  test(`${name} OpenAI를 부르지 않고 거절한다`, async t => {
    const server = await start(t, () => [200, completed({ overview: '짧게', topics: [] })]);
    const result = await server.post('/api/summary/compact', request(extra));
    assert.equal(result.status, 400);
    assert.equal(server.calls.length, 0);
  });
}

test('출력 한도 오류는 그대로 알린다', async t => {
  const server = await start(t, () => [200, { status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' }, output: [] }]);
  const result = await server.post('/api/summary/compact', request());
  assert.equal(result.body.error.code, 'AI_OUTPUT_LIMIT');
});

test('일반 요약은 말한 사람을 추측하지 말고 이름과 담당을 명단 표기로 맞추라고 지시한다', async t => {
  const server = await start(t, () => [200, completed({ overview: '회의', topics: [], decisions: [], actions: [], openQuestions: [] })]);
  const result = await server.post('/api/summary', { text: '회의 발언', title: '회의', date: '2026-11-05', participants: '김과장' });
  assert.equal(result.status, 200);
  const systems = server.calls[0].body.input.filter(item => item.role === 'system').map(item => item.content).join('\n');
  assert.match(systems, /누가 말했는지 추측하지/);
  assert.match(systems, /participants 명단의 표기/);
  assert.match(systems, /같은 담당끼리/);
  assert.match(systems, /이전 topics의 제목을 그대로 유지/);
});

test('회의록은 결정을 할 일로 되풀이하지 않되 합의한 일은 담당이 없어도 남기라고 지시한다', async t => {
  const server = await start(t, () => [200, completed({ overview: '회의', topics: [], decisions: [], actions: [], openQuestions: [] })]);
  await server.post('/api/summary', { text: '회의 발언', title: '회의', date: '2026-11-05', participants: '김과장' });
  const systems = server.calls[0].body.input.filter(item => item.role === 'system').map(item => item.content).join('\n');
  assert.match(systems, /decisions에 쓴 결정을 '적용합니다'나 '반영합니다'로 바꿔 되풀이하지/);
  assert.match(systems, /실행을 합의한 일은 담당이나 날짜가 없어도 남기/);
  assert.match(systems, /제안·검토 단계인 일을 확정된 할 일로 바꾸지/);
  assert.match(systems, /한 항목은 100자 안에서 쓰고 전체는 25개 안팎으로 정리/);
  assert.match(systems, /한 일을 여러 항목으로 쪼개지 말고/);
  assert.match(systems, /담당과 기한이 같은 세부 항목은 화면·업무별 대표 작업 하나로 묶/);
  assert.match(systems, /개수를 맞추려고 합의한 일을 빼거나 담당·기한이 다른 일을 합치지/);
  assert.match(systems, /topics를 쓰지 않는 형식이면 대표 작업 문장에 핵심만/);
  assert.doesNotMatch(systems, /한 가지 일로|많아도 25개/);
  assert.doesNotMatch(systems, /적용 범위는 전사 표현을 따르고/);
});

const emptyMinutes = { suggestedTitle: '회의', overview: '회의', topics: [], decisions: [], actions: [], openQuestions: [] };
const listLimits = [
  ['주제 수', schema => schema.properties.topics.maxItems, count => ({ topics: Array.from({ length: count }, () => ({ title: '주제', points: [] })) })],
  ['주제별 문단 수', schema => schema.properties.topics.items.properties.points.maxItems, count => ({ topics: [{ title: '주제', points: Array(count).fill('문단') }] })],
  ['결정 수', schema => schema.properties.decisions.maxItems, count => ({ decisions: Array(count).fill('결정') })],
  ['할 일 수', schema => schema.properties.actions.maxItems, count => ({ actions: Array.from({ length: count }, () => ({ task: '할 일', owner: null, due: null })) })],
  ['미확정 수', schema => schema.properties.openQuestions.maxItems, count => ({ openQuestions: Array(count).fill('미정') })],
];
const textLimits = [
  ['개요 길이', schema => schema.properties.overview.maxLength, length => ({ overview: text(length) })],
  ['주제 제목 길이', schema => schema.properties.topics.items.properties.title.maxLength, length => ({ topics: [{ title: text(length), points: [] }] })],
  ['주제 문단 길이', schema => schema.properties.topics.items.properties.points.items.maxLength, length => ({ topics: [{ title: '주제', points: [text(length)] }] })],
  ['결정 길이', schema => schema.properties.decisions.items.maxLength, length => ({ decisions: [text(length)] })],
  ['할 일 길이', schema => schema.properties.actions.items.properties.task.maxLength, length => ({ actions: [{ task: text(length), owner: null, due: null }] })],
  ['담당 길이', schema => schema.properties.actions.items.properties.owner.maxLength, length => ({ actions: [{ task: '할 일', owner: text(length), due: null }] })],
  ['기한 길이', schema => schema.properties.actions.items.properties.due.maxLength, length => ({ actions: [{ task: '할 일', owner: null, due: text(length) }] })],
  ['미확정 길이', schema => schema.properties.openQuestions.items.maxLength, length => ({ openQuestions: [text(length)] })],
];

// 앱이 받는 한도와 AI에 알리는 한도가 다르면, 한도를 넘긴 유료 응답을 통째로 버리게 된다.
for (const [name, limitOf, listOf] of [...listLimits, ...textLimits]) {
  test(`${name} 한도를 AI에 그대로 알리고 앱도 그 값까지 받는다`, async t => {
    let answer = emptyMinutes;
    const server = await start(t, () => [200, completed(answer)]);
    const meeting = { text: '회의 발언', title: '회의', date: '2026-11-05', participants: '' };
    assert.equal((await server.post('/api/summary', meeting)).status, 200);
    const limit = limitOf(server.calls[0].body.text.format.schema);
    assert.ok(Number.isInteger(limit) && limit > 0, `${name} 한도를 보내지 않았습니다`);
    answer = { ...emptyMinutes, ...listOf(limit) };
    assert.equal((await server.post('/api/summary', meeting)).status, 200);
    answer = { ...emptyMinutes, ...listOf(limit + 1) };
    assert.equal((await server.post('/api/summary', meeting)).body.error.code, 'AI_RESPONSE_INVALID');
  });
}

test('줄이기 요청도 개요·주제·문단 한도를 AI에 알린다', async t => {
  const server = await start(t, () => [200, completed({ overview: '짧게', topics: [{ title: '양식', points: ['짧게'] }] })]);
  assert.equal((await server.post('/api/summary/compact', request())).status, 200);
  const { properties } = server.calls[0].body.text.format.schema;
  assert.equal(properties.topics.maxItems, 30);
  assert.equal(properties.topics.items.properties.points.maxItems, 30);
  assert.equal(properties.overview.maxLength, 8000);
  assert.equal(properties.topics.items.properties.title.maxLength, 500);
  assert.equal(properties.topics.items.properties.points.items.maxLength, 2000);
});

for (const outputFormat of ['meeting', 'summary', 'tasks']) {
  test(`${outputFormat} 형식도 목록이 넘치면 버리지 말고 합치라고 지시한다`, async t => {
    const server = await start(t, () => [200, completed(emptyMinutes)]);
    assert.equal((await server.post('/api/summary', { text: '회의 발언', title: '회의', date: '2026-11-05', participants: '', outputFormat })).status, 200);
    const systems = server.calls[0].body.input.filter(item => item.role === 'system').map(item => item.content).join('\n');
    assert.match(systems, /결정·할 일·미확정은 각각 40개, 주제와 주제별 문단은 각각 30개를 넘을 수 없습니다/);
    assert.match(systems, /항목을 버리지 말고 비슷한 항목을 하나로 합치세요/);
    assert.match(systems, /주제를 합칠 때는 제목을 새로 써도/);
    assert.match(systems, /합칠 수 없는 할 일이 40개를 넘을 때만 마지막 항목 하나에 '그 외 할 일'로 모으고 각 일의 담당과 기한을 그 문장 안에/);
  });
}

test('전체 결과가 64000자를 넘으면 형식 오류가 아니라 출력 한도로 알려 나눠 처리하게 한다', async t => {
  let count = 33;
  const server = await start(t, () => [200, completed({ ...emptyMinutes, decisions: Array(count).fill(text(1900)) })]);
  const meeting = { text: '회의 발언', title: '회의', date: '2026-11-05', participants: '' };
  assert.equal((await server.post('/api/summary', meeting)).status, 200);
  count = 34;
  const result = await server.post('/api/summary', meeting);
  assert.equal(result.status, 503);
  assert.equal(result.body.error.code, 'AI_OUTPUT_LIMIT');
});

test('할 일만 고른 내 형식에는 세부 내용을 topics로 옮기라고 강요하지 않는다', async t => {
  const server = await start(t, () => [200, completed(emptyMinutes)]);
  const customFormat = { name: '할 일만', sections: [{ key: 'actions', title: '할 일' }], instruction: '' };
  assert.equal((await server.post('/api/summary', { text: '회의 발언', title: '회의', date: '2026-11-05', participants: '', outputFormat: 'custom', customFormat })).status, 200);
  const systems = server.calls[0].body.input.filter(item => item.role === 'system').map(item => item.content).join('\n');
  assert.match(systems, /목록에 없는 항목은 빈 배열/);
  assert.match(systems, /topics를 쓰지 않는 형식이면 대표 작업 문장에 핵심만/);
  assert.doesNotMatch(systems, /세부 내용은 topics에 남깁니다/);
});

test('요약과 줄이기 모두 일본어·중국어 글자를 섞지 말라고 지시한다', async t => {
  const server = await start(t, (count) => [200, completed(count === 1 ? emptyMinutes : { overview: '짧게', topics: [{ title: '양식', points: ['짧게'] }] })]);
  await server.post('/api/summary', { text: '회의 발언', title: '회의', date: '2026-11-05', participants: '' });
  await server.post('/api/summary/compact', request());
  for (const call of server.calls) assert.match(call.body.input.filter(item => item.role === 'system').map(item => item.content).join('\n'), /일본어·중국어 글자를 섞지/);
});

const audio = new Uint8Array([26, 69, 223, 163, 0, 0, 0, 0, 0, 0, 0, 0]);
const transcribed = { text: '전사 결과', usage: { type: 'duration', seconds: 1 } };

test('전사 요청에 참석자 이름을 힌트 단어로 넣는다', async t => {
  const server = await start(t, () => [200, transcribed]);
  const result = await server.post('/api/transcribe', audio, { 'Content-Type': 'audio/webm', 'X-Transcribe-Keywords': encodeURIComponent('김철수,<이영희>,외') });
  assert.equal(result.status, 200);
  const form = server.calls[0].body;
  assert.deepEqual(form.getAll('keywords[]'), ['김철수', '이영희']);
  assert.deepEqual(form.getAll('languages[]'), ['ko']);
  assert.equal(form.get('model'), 'gpt-transcribe');
});

test('힌트가 없거나 깨져 있어도 전사는 그대로 요청한다', async t => {
  const server = await start(t, () => [200, transcribed]);
  for (const extra of [{}, { 'X-Transcribe-Keywords': '%E0%A4%A' }]) {
    const result = await server.post('/api/transcribe', audio, { 'Content-Type': 'audio/webm', ...extra });
    assert.equal(result.status, 200);
  }
  for (const call of server.calls) assert.deepEqual(call.body.getAll('keywords[]'), []);
});
