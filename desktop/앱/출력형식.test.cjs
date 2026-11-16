// 회의록·핵심 요약·업무 정리 출력 형식이 요청 지침, 프리셋, 녹음·회의 저장, 목록, 파일 출력에 유지되는지 검증한다.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { createMeetingServer } = require('./서버.cjs');
const minutes = { overview: '요약', topics: [{ title: '주제', points: ['설명'] }], decisions: [], actions: [{ task: '양식 초안 작성', owner: null, due: null }], openQuestions: ['기한 미정'] };

async function start(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'voicenote-format-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const calls = [];
  const meeting = createMeetingServer({ dataDir: dir, apiFetch: async (url, request) => {
    calls.push(JSON.parse(request.body));
    return Response.json({ status: 'completed', usage: { input_tokens: 1, output_tokens: 1 },
      output: [{ type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: JSON.stringify(minutes) }] }] });
  } });
  await new Promise(resolve => meeting.server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => meeting.server.close(resolve)));
  const origin = `http://127.0.0.1:${meeting.server.address().port}`;
  const headers = { Origin: origin, 'X-Meeting-Token': meeting.token, 'Content-Type': 'application/json' };
  const request = async (route, body, extra = {}) => {
    const response = await fetch(origin + route, { method: body === undefined ? 'GET' : 'POST', headers: { ...headers, ...extra }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
  };
  await request('/api/key', { apiKey: 'mock-only', persist: false });
  const summary = body => request('/api/summary', { text: '회의 발언', title: '회의', date: '2026-10-01', participants: '', ...body }, { 'X-Operation-Id': randomUUID(), 'X-AI-Consent': 'yes' });
  return { dir, calls, request, summary };
}

test('세 형식은 같은 스키마·32000토큰·공통 사실 보존 지침을 쓰고 첫 양식 지침만 다르다', async t => {
  const server = await start(t);
  for (const outputFormat of [undefined, 'meeting', 'summary', 'tasks']) assert.equal((await server.summary(outputFormat ? { outputFormat } : {})).status, 200);
  const [omitted, meeting, summary, tasks] = server.calls;
  assert.deepEqual(omitted, meeting);
  assert.match(meeting.input[0].content, /^회의록 작성 양식과 품질 기준을 따르세요\./);
  assert.match(meeting.input[0].content, /'전체 방향 \| 무엇을 왜 먼저 하는지/);
  assert.match(summary.input[0].content, /^핵심 요약형 양식/);
  assert.match(summary.input[0].content, /overview와 topics를 중심/);
  assert.match(tasks.input[0].content, /^업무 정리형 양식/);
  assert.match(tasks.input[0].content, /actions와 openQuestions를 중심/);
  for (const body of [summary, tasks]) {
    assert.match(body.input[0].content, /항목 머리말을 붙이지 않습니다/);
    assert.match(body.input[0].content, /전사에 (없는|명시된)/);
    assert.deepEqual(body.input.slice(1), meeting.input.slice(1));
    assert.deepEqual(body.text, meeting.text);
    assert.equal(body.max_output_tokens, 32000);
    assert.equal(body.model, meeting.model);
  }
  assert.equal('outputFormat' in JSON.parse(tasks.input.at(-1).content), false);
});

test('모르는 출력 형식은 OpenAI 호출 없이 거절한다', async t => {
  const server = await start(t);
  for (const outputFormat of ['report', '', null, 3]) {
    const result = await server.summary({ outputFormat });
    if (outputFormat === null) { assert.equal(result.status, 200); continue; }
    assert.equal(result.status, 400);
  }
  assert.equal(server.calls.length, 1);
});

test('녹음·회의 기록·목록·파일 출력에 형식을 보존하고 형식이 없는 기록은 회의록형으로 읽는다', async t => {
  const { dir, request } = await start(t);
  const recordingId = randomUUID();
  const meta = { title: '업무 회의', date: '2026-10-01', participants: '', expectedParts: 1, outputFormat: 'summary' };
  for (const outputFormat of ['report', ['summary']])
    assert.equal((await request(`/api/recordings/main/${recordingId}`, { ...meta, outputFormat })).status, 400, JSON.stringify(outputFormat));
  assert.equal((await request(`/api/recordings/main/${recordingId}`, meta)).body.recording.outputFormat, 'summary');
  assert.equal((await request(`/api/recordings/main/${recordingId}`, { ...meta, outputFormat: 'tasks' })).status, 409);
  assert.equal((await request(`/api/meetings/main/${recordingId}`)).body.meeting.outputFormat, 'summary');

  const base = { title: '업무 회의', date: '2026-10-01', participants: '', transcript: '양식 초안을 작성합니다.', minutes };
  const tasks = await request('/api/meetings/main', { ...base, id: randomUUID(), outputFormat: 'tasks' });
  const summary = await request('/api/meetings/main', { ...base, id: randomUUID(), outputFormat: 'summary' });
  const meeting = await request('/api/meetings/main', { ...base, id: randomUUID() });
  assert.equal(tasks.body.meeting.outputFormat, 'tasks');
  assert.equal('outputFormat' in meeting.body.meeting, false);
  const folder = path.join(dir, '회의기록');
  const markdown = record => fs.readFileSync(path.join(folder, record.artifacts.summary), 'utf8');
  assert.match(markdown(tasks.body.meeting), /## 업무 요약[\s\S]*## 할 일\n- 양식 초안 작성 · 담당 미정 · 기한 미정[\s\S]*## 미확정 항목/);
  assert.doesNotMatch(markdown(tasks.body.meeting), /## 상세 회의 내용|## 합의된 방향|## 결정 사항/);
  assert.match(markdown(summary.body.meeting), /## 핵심 요약[\s\S]*## 주요 내용[\s\S]*### 주제[\s\S]*## 후속 작업/);
  assert.doesNotMatch(markdown(summary.body.meeting), /## 상세 회의 내용|## 결정 사항/);
  assert.match(markdown(meeting.body.meeting), /## 핵심 요약[\s\S]*## 다음 할 일[\s\S]*## 상세 회의 내용[\s\S]*## 합의된 방향[\s\S]*## 미확정 사항/);

  const list = (await request('/api/meetings')).body.meetings;
  assert.deepEqual(new Set(list.map(item => item.outputFormat)), new Set(['tasks', 'summary', 'meeting']));
  assert.equal((await request(`/api/meetings/main/${tasks.body.meeting.id}`)).body.meeting.outputFormat, 'tasks');
  assert.equal((await request(`/api/meetings/main/${meeting.body.meeting.id}`)).body.meeting.outputFormat, 'meeting');
});

// 회의 결과 항목 규칙(옛 결과 바꾸기·빈 값 정리·목록 줄·길이 계산)을 두 앱 공통 예시로 확인한다.
const formats = require('./출력형식.js');
const itemExamples = require('../tests/fixtures/회의결과-항목-예시.json');

test('옛·새 결과 칸을 공통 예시대로 항목으로 바꾼다', () => {
  for (const c of itemExamples.normalize) assert.deepEqual(c.field === 'overview' ? formats.overviewItems(c.input) : formats.items(c.input), c.expected, c.name);
});

test('빈 값 정리를 공통 예시대로 한다', () => {
  for (const c of itemExamples.prune) assert.deepEqual(formats.pruneMinutes(c.input), c.expected, c.name);
});

test('목록 줄을 공통 예시대로 만든다', () => {
  for (const c of itemExamples.lines) assert.deepEqual(formats.itemLines(c.items, c.marker), c.expected, c.name);
});

test('normalizeMinutes는 입력을 바꾸지 않고 두 번 넣어도 같으며 할 일은 그대로 둔다', () => {
  const old = { suggestedTitle: '합성', overview: '전체 방향 | 먼저 진행\n주요 결정 | 시안 A', topics: [{ title: '주제', points: ['설명 하나', ''] }], decisions: ['- 결정'], actions: [{ task: '정리하기', owner: null, due: null }], openQuestions: ['미정'] };
  const before = JSON.stringify(old);
  const once = formats.normalizeMinutes(old);
  assert.equal(JSON.stringify(old), before);
  assert.deepEqual(formats.normalizeMinutes(once), once);
  assert.equal(once.actions, old.actions);
  assert.deepEqual(once.overview, [{ text: '전체 방향', details: ['먼저 진행'] }, { text: '주요 결정', details: ['시안 A'] }]);
  assert.deepEqual(once.topics, [{ title: '주제', points: [{ text: '설명 하나', details: [] }] }]);
  assert.deepEqual(once.decisions, [{ text: '결정', details: [] }]);
  assert.equal(once.suggestedTitle, '합성');
});

test('minutesLengths는 옛 문자열은 지금 길이 그대로, 항목은 본문과 하위 항목을 함께 센다', () => {
  const old = { overview: '가나다', topics: [{ title: '주제', points: ['라마'] }], decisions: ['바'], actions: [{ task: '사', owner: '아', due: null }], openQuestions: ['자차'] };
  assert.deepEqual(formats.minutesLengths(old), { body: 3 + 2 + 2, kept: 1 + 2 + 2 });
  const fresh = { overview: [{ text: '가나다', details: ['카'] }], topics: [{ title: '주제', points: [{ text: '라마', details: ['타파'] }] }], decisions: [{ text: '바', details: ['하'] }], actions: [{ task: '사', owner: '아', due: null }], openQuestions: [{ text: '자차', details: [] }] };
  assert.deepEqual(formats.minutesLengths(fresh), { body: 3 + 1 + 2 + 2 + 2, kept: 1 + 1 + 2 + 2 });
});

test('항목 규칙 상수를 내보낸다', () => {
  assert.deepEqual(formats.OVERVIEW_LABELS, ['전체 방향', '주요 결정', '다음 할 일', '남은 쟁점']);
  assert.deepEqual(formats.ITEM_LIMITS, { text: 1000, detail: 1000, details: 8, overview: 12 });
  assert.ok(Object.isFrozen(formats.OVERVIEW_LABELS) && Object.isFrozen(formats.ITEM_LIMITS));
});
