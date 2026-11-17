// 회의 결과의 항목 구조를 서버가 AI 응답 틀로 강제하고, 저장된 옛 결과는 그대로 열며, 다시 보낼 때만 새 구조로 바꾸는지 모의 OpenAI로 검증한다.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { createMeetingServer } = require('./서버.cjs');

const I = (text, details = []) => ({ text, details });
const completed = value => ({ status: 'completed', usage: { input_tokens: 10, output_tokens: 5 },
  output: [{ type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: JSON.stringify(value) }] }] });
const fresh = (extra = {}) => ({ suggestedTitle: '합성 회의', overview: [I('전체 방향', ['시안 A 먼저'])], topics: [{ title: '양식', points: [I('공통 양식 쓰기로 함', ['이유: 서식 혼선'])] }],
  decisions: [I('양식 — 공통 양식 사용', ['적용: 모든 부서'])], actions: [{ task: '양식 초안 만들기', owner: '김민수', due: null }], openQuestions: [I('기한', ['정해지지 않으면 배포 지연'])], ...extra });

async function start(t, reply, dataDir) {
  const calls = [];
  const meeting = createMeetingServer({ ...(dataDir ? { dataDir } : {}), apiFetch: async (url, options) => {
    calls.push(JSON.parse(options.body));
    return Response.json(reply(calls.length, calls.at(-1)), { status: 200 });
  } });
  await new Promise(resolve => meeting.server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => meeting.server.close(resolve)));
  const origin = `http://127.0.0.1:${meeting.server.address().port}`;
  const headers = { Origin: origin, 'X-Meeting-Token': meeting.token, 'Content-Type': 'application/json' };
  await (await fetch(origin + '/api/key', { method: 'POST', headers, body: JSON.stringify({ apiKey: 'mock-only', persist: false }) })).text();
  const post = async (route, body) => {
    const response = await fetch(origin + route, { method: 'POST', headers: { ...headers, 'X-Operation-Id': randomUUID(), 'X-AI-Consent': 'yes' }, body: JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
  };
  const get = async route => { const response = await fetch(origin + route, { headers }); return { status: response.status, body: await response.json() }; };
  return { calls, post, get };
}
const summary = extra => ({ text: '양식 이야기를 했습니다.', title: '합성 회의', date: '2026-11-16', participants: '김민수, 박서연', ...extra });
const compact = extra => ({ title: '합성 회의', date: '2026-11-16', participants: '김민수', targetCharacters: 300, minutes: fresh(), ...extra });

test('요약·줄이기 요청의 응답 틀이 항목 객체를 요구한다', async t => {
  const { calls, post } = await start(t, n => completed(n === 1 ? fresh() : { overview: [I('전체 방향')], topics: [] }));
  assert.equal((await post('/api/summary', summary())).status, 200);
  await post('/api/summary/compact', compact());
  const item = schema => assert.deepEqual([schema.type, schema.required, schema.properties.details.type, schema.additionalProperties], ['object', ['text', 'details'], 'array', false]);
  const minutes = calls[0].text.format.schema.properties;
  for (const key of ['overview', 'decisions', 'openQuestions']) { assert.equal(minutes[key].type, 'array', key); item(minutes[key].items); }
  item(minutes.topics.items.properties.points.items);
  assert.deepEqual(minutes.actions.items.required, ['task', 'owner', 'due']);
  const shortened = calls[1].text.format.schema.properties;
  item(shortened.overview.items);
  item(shortened.topics.items.properties.points.items);
});

test('옛 문자열 구조로 돌아온 응답은 형식 오류로 끝난다', async t => {
  const { post } = await start(t, () => completed({ suggestedTitle: '합성', overview: '문단', topics: [{ title: '주제', points: ['설명'] }], decisions: [], actions: [], openQuestions: [] }));
  const result = await post('/api/summary', summary());
  assert.equal(result.status, 503);
  assert.match(JSON.stringify(result.body), /AI 응답 형식을 확인할 수 없습니다/);
});

test('일본어·중국어 글자 정리로 빈 항목은 빈 값 정리 규칙대로 남는다', async t => {
  const { post } = await start(t, () => completed(fresh({ overview: [I('日本', ['中国']), I('전체 방향', ['中'])], decisions: [I('결정', ['日'])] })));
  const result = await post('/api/summary', summary());
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.minutes.overview, [I('전체 방향')]);
  assert.deepEqual(result.body.minutes.decisions, [I('결정')]);
});

test('줄이기에서 하위 항목만 줄어든 답은 받고 결정·미확정은 그대로 둔다', async t => {
  const before = fresh({ topics: [{ title: '양식', points: [I('공통 양식 쓰기로 함', ['가'.repeat(400)])] }] });
  const { post } = await start(t, () => completed({ overview: before.overview, topics: [{ title: '양식', points: [I('공통 양식 쓰기로 함', ['줄인 이유'])] }] }));
  const result = await post('/api/summary/compact', compact({ minutes: before }));
  assert.equal(result.status, 200);
  assert.equal(result.body.shortened, true);
  assert.deepEqual(result.body.minutes.topics[0].points[0].details, ['줄인 이유']);
  assert.deepEqual(result.body.minutes.decisions, before.decisions);
  assert.deepEqual(result.body.minutes.openQuestions, before.openQuestions);
});

test('줄이기에서 머리말만 남고 내용이 빈 답은 받지 않고 원래 결과를 쓴다', async t => {
  const before = fresh({ overview: [I('전체 방향', ['가'.repeat(300)]), I('주요 결정', ['나'.repeat(300)])] });
  const { post } = await start(t, () => completed({ overview: [I('전체 방향'), I('주요 결정')], topics: before.topics }));
  const result = await post('/api/summary/compact', compact({ minutes: before }));
  assert.equal(result.status, 200);
  assert.equal(result.body.shortened, false);
  assert.deepEqual(result.body.minutes, before);
});

test('앞 구간으로 보낸 긴 옛 문단과 13줄 핵심 요약을 거절하지 않고 새 구조로 바꿔 보낸다', async t => {
  const lines = Array.from({ length: 13 }, (_, i) => `줄 ${i + 1}`).join('\n');
  const previous = { suggestedTitle: '합성', overview: lines, topics: [{ title: '양식', points: ['가'.repeat(2000), ''] }], decisions: ['- 결정'], actions: [], openQuestions: [] };
  const { calls, post } = await start(t, () => completed(fresh()));
  const result = await post('/api/summary', summary({ previousMinutes: previous }));
  assert.equal(result.status, 200);
  const sent = JSON.parse(calls[0].input.find(x => x.role === 'user').content).previousMinutes;
  assert.equal(sent.overview.length, 13);
  assert.deepEqual(sent.overview[0], I('줄 1'));
  assert.deepEqual(sent.topics[0].points, [I('가'.repeat(2000))]);
  assert.deepEqual(sent.decisions, [I('결정')]);
});

test('옛 구조 저장 결과는 열리고 파일 바이트가 그대로이며 새 구조 결과도 열린다', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'voicenote-items-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const { post, get } = await start(t, () => completed(fresh()), dir);
  const old = { overview: Array.from({ length: 13 }, (_, i) => `줄 ${i + 1}`).join('\n'), topics: [{ title: '양식', points: ['가'.repeat(2000), ''] }], decisions: [''], actions: [], openQuestions: [] };
  const record = minutes => ({ id: randomUUID(), title: '합성 회의', date: '2026-11-16', participants: '김민수', transcript: '합성 전사', minutes });
  const oldRecord = record(old), newRecord = record(fresh());
  for (const item of [oldRecord, newRecord]) assert.equal((await post('/api/meetings/main', item)).status, 200);
  const file = path.join(dir, '회의기록', `회의-${oldRecord.id}.json`);
  const bytes = fs.readFileSync(file);
  const opened = await get(`/api/meetings/main/${oldRecord.id}`);
  assert.equal(opened.status, 200);
  assert.deepEqual(opened.body.meeting.minutes, old);
  assert.deepEqual(fs.readFileSync(file), bytes);
  assert.equal((await post('/api/meetings/main', oldRecord)).status, 200, '같은 옛 결과는 다시 저장해도 된다');
  assert.deepEqual((await get(`/api/meetings/main/${newRecord.id}`)).body.meeting.minutes, newRecord.minutes);
  assert.equal((await post('/api/meetings/main', newRecord)).status, 200, '같은 새 결과는 다시 저장해도 된다');
});

test('줄이기를 받지 않으면 옛 구조로 받은 원래 결과를 그대로 돌려준다', async t => {
  const old = { suggestedTitle: '합성', overview: '전체 방향 | 먼저 진행', topics: [{ title: '양식', points: ['공통 양식을 쓰기로 했습니다.'] }], decisions: ['양식 — 공통 양식'], actions: [], openQuestions: ['기한'] };
  const { post } = await start(t, () => completed({ overview: [I('가'.repeat(1000), ['나'.repeat(1000)])], topics: [{ title: '양식', points: [I('다'.repeat(500))] }] }));
  const result = await post('/api/summary/compact', compact({ minutes: old }));
  assert.equal(result.status, 200);
  assert.equal(result.body.shortened, false);
  assert.deepEqual(result.body.minutes, old);
});

const STYLE = [/항목 하나에 내용 하나/, /details에/, /글머리표 기호/];
const PROSE = ['2~4문장의 문단', '이어지는 문단', '짧은 문단', '완전한 문장', '한 문장으로만', '글머리표나 키워드만 출력하지 마세요', '3~6문장', '2~4문장', '한 문장으로 씁니다', '짧은 문장으로'];
const systemsOf = call => call.input.filter(item => item.role === 'system').map(item => item.content).join('\n');

test('네 출력 형식과 줄이기 지시에 개조식 규칙이 있고 문장형 요구가 남지 않았다', async t => {
  const { calls, post } = await start(t, n => completed(n <= 4 ? fresh() : { overview: [I('전체 방향')], topics: [] }));
  const custom = { name: '주간', sections: [{ key: 'actions', title: '할 일' }, { key: 'decisions', title: '결정' }], instruction: '결정은 자세히' };
  for (const outputFormat of ['meeting', 'summary', 'tasks']) assert.equal((await post('/api/summary', summary({ outputFormat }))).status, 200);
  assert.equal((await post('/api/summary', summary({ outputFormat: 'custom', customFormat: custom }))).status, 200);
  await post('/api/summary/compact', compact());
  assert.equal(calls.length, 5);
  for (const call of calls) {
    const systems = systemsOf(call);
    for (const rule of STYLE) assert.match(systems, rule);
    for (const prose of PROSE) assert.equal(systems.includes(prose), false, `문장형 요구가 남음: ${prose}`);
  }
  assert.match(systemsOf(calls[3]), /overview가 목록에 없으면 항목 하나로만/);
  assert.match(systemsOf(calls[3]), /개조식·사실 확인·근거 규칙/);
  for (const call of calls.slice(0, 4)) assert.match(systemsOf(call), /모순되지 않는지 검토/);
  // 사실 보존 규칙(확정 여부·담당·기한의 모순 검토)은 개조식으로 바꿔도 네 형식에 그대로 남는다.
  assert.match(systemsOf(calls[0]), /'전체 방향', '주요 결정', '다음 할 일', '남은 쟁점'/);
  assert.match(systemsOf(calls[0]), /확정된 내용 없음/);
  assert.match(systemsOf(calls[4]), /머리말만 남기고 내용을 모두 지우지 않습니다/);
});

test('줄이기를 받으면 제목·결정·할 일·미확정은 받은 원본 글자 그대로 되붙인다', async t => {
  const before = fresh({ decisions: [I('  결정  ', ['  조건  '])], openQuestions: [I('  미정  ', ['  영향  '])], topics: [{ title: '양식', points: [I('공통 양식 쓰기로 함', ['가'.repeat(400)])] }] });
  const { post } = await start(t, () => completed({ overview: before.overview, topics: [{ title: '양식', points: [I('공통 양식 쓰기로 함', ['줄인 이유'])] }] }));
  const result = await post('/api/summary/compact', compact({ minutes: before }));
  assert.equal(result.status, 200);
  assert.equal(result.body.shortened, true);
  for (const key of ['suggestedTitle', 'decisions', 'actions', 'openQuestions']) assert.deepEqual(result.body.minutes[key], before[key], key);
});

test('옛 구조를 줄여 받으면 새 구조 하나로 돌려주고 그 결과를 저장할 수 있다', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'voicenote-items-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const old = { suggestedTitle: '합성', overview: `전체 방향 | ${'가'.repeat(600)}`, topics: [{ title: '양식', points: ['나'.repeat(800)] }], decisions: ['- 양식 — 공통 양식'], actions: [], openQuestions: ['기한'] };
  const { post } = await start(t, () => completed({ overview: [I('전체 방향', ['짧게'])], topics: [{ title: '양식', points: [I('짧게')] }] }), dir);
  const result = await post('/api/summary/compact', compact({ minutes: old }));
  assert.equal(result.body.shortened, true);
  assert.deepEqual(result.body.minutes.decisions, [I('양식 — 공통 양식')]);
  assert.deepEqual(result.body.minutes.openQuestions, [I('기한')]);
  const record = { id: randomUUID(), title: '합성 회의', date: '2026-11-16', participants: '김민수', transcript: '합성 전사', minutes: result.body.minutes };
  assert.equal((await post('/api/meetings/main', record)).status, 200);
});

test('옛 결정 글이 새 항목 한도보다 길어 합친 결과를 저장할 수 없으면 줄이기를 받지 않는다', async t => {
  const old = { suggestedTitle: '합성', overview: `전체 방향 | ${'가'.repeat(600)}`, topics: [{ title: '양식', points: ['나'.repeat(800)] }], decisions: ['다'.repeat(1500)], actions: [], openQuestions: [] };
  const { post } = await start(t, () => completed({ overview: [I('전체 방향', ['짧게'])], topics: [{ title: '양식', points: [I('짧게')] }] }));
  const result = await post('/api/summary/compact', compact({ minutes: old }));
  assert.equal(result.status, 200);
  assert.equal(result.body.shortened, false);
  assert.deepEqual(result.body.minutes, old);
});
