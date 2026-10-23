// 내 형식 검증·AI 지시·항목 구성과 저장, 회의 기록 반영, 화면 제공 파일을 검증한다.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const formats = require('./출력형식.js');
const { createMeetingServer } = require('./서버.cjs');

const custom = { name: ' 주간 보고 ', sections: [{ key: 'actions', title: ' 이번 주 할 일 ' }, { key: 'overview', title: '한 줄 요약' }], instruction: '  부서별로 묶기  ' };
const minutes = { overview: '요약입니다.', topics: [{ title: '주제', points: ['문단'] }], decisions: ['결정'], actions: [{ task: '보고서 쓰기', owner: null, due: '금요일' }], openQuestions: [] };

test('내 형식은 앞뒤 공백을 지운 이름·항목·추가 지시만 받아들인다', () => {
  assert.deepEqual(formats.validateCustom(custom), { name: '주간 보고', sections: [{ key: 'actions', title: '이번 주 할 일' }, { key: 'overview', title: '한 줄 요약' }], instruction: '부서별로 묶기' });
  assert.equal(formats.validateCustom({ name: '짧게', sections: [{ key: 'topics', title: '내용' }] }).instruction, '');
  const bad = [null, [], { name: '', sections: [{ key: 'overview', title: '요약' }] }, { name: '가'.repeat(31), sections: [{ key: 'overview', title: '요약' }] },
    { name: '형식', sections: [] }, { name: '형식', sections: [{ key: 'overview', title: '요약' }, { key: 'overview', title: '다시' }] },
    { name: '형식', sections: [{ key: 'other', title: '기타' }] }, { name: '형식', sections: [{ key: 'overview', title: '' }] },
    { name: '형식', sections: [{ key: 'overview', title: '요약', extra: 1 }] }, { name: '형식', sections: [{ key: 'overview', title: '요약' }], instruction: '가'.repeat(1001) },
    { name: '형식', sections: [{ key: 'overview', title: '요약' }], apiKey: 'x' }];
  for (const value of bad) assert.throws(() => formats.validateCustom(value), error => error.status === 400 && typeof error.message === 'string', JSON.stringify(value));
});

test('내 형식 본문은 고른 순서와 이름으로 쓰고 빈 항목은 없음으로 남긴다', () => {
  const value = formats.validateCustom({ ...custom, sections: [...custom.sections, { key: 'openQuestions', title: '물어볼 것' }] });
  assert.deepEqual(formats.customText(minutes, value), ['## 이번 주 할 일', '- 보고서 쓰기 · 담당 미정 · 기한 금요일', '', '## 한 줄 요약', '요약입니다.', '', '## 물어볼 것', '- 없음', '']);
  assert.deepEqual(formats.customSections(minutes, value).map(section => section.type), ['list', 'overview', 'list']);
  assert.equal(formats.defaultCustom().sections.length, 5);
  for (const key of ['meeting', 'summary', 'tasks', 'custom']) assert.ok(formats.LABELS[key] && formats.DESCRIPTIONS[key]);
  assert.equal(formats.format('report'), null);
});

async function start(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'voicenote-format-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const meeting = createMeetingServer({ dataDir: dir });
  await new Promise(resolve => meeting.server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => meeting.server.close(resolve)));
  const url = `http://127.0.0.1:${meeting.server.address().port}`;
  const request = async (route, method = 'GET', body) => {
    const response = await fetch(url + route, { method, headers: { Origin: url, 'Content-Type': 'application/json', 'X-Meeting-Token': meeting.token }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
  };
  return { dir, request, url };
}

test('내 형식은 하나만 저장·조회·삭제하고 잘못된 정의는 파일을 바꾸지 않는다', async t => {
  const { dir, request } = await start(t);
  assert.deepEqual((await request('/api/custom-format')).body, { customFormat: null });
  const saved = await request('/api/custom-format', 'POST', custom);
  assert.equal(saved.status, 200);
  assert.equal(saved.body.customFormat.name, '주간 보고');
  assert.deepEqual((await request('/api/custom-format')).body.customFormat, saved.body.customFormat);
  const bytes = fs.readFileSync(path.join(dir, '내형식.json'));
  assert.equal((await request('/api/custom-format', 'POST', { name: '', sections: [] })).status, 400);
  assert.deepEqual(fs.readFileSync(path.join(dir, '내형식.json')), bytes);
  assert.deepEqual((await request('/api/custom-format', 'DELETE')).body, { customFormat: null });
  assert.equal(fs.existsSync(path.join(dir, '내형식.json')), false);
  const settings = await request('/api/settings/export');
  assert.doesNotMatch(JSON.stringify(settings.body), /주간 보고/);
});

test('내 형식 회의는 당시 정의를 기록에 남기고 저장 파일을 그 항목 순서로 쓴다', async t => {
  const { dir, request } = await start(t);
  const record = { id: randomUUID(), title: '주간 회의', date: '2026-10-02', participants: '', context: '', transcript: '발언', minutes, outputFormat: 'custom', customFormat: custom };
  const saved = await request('/api/meetings/main', 'POST', record);
  assert.equal(saved.status, 200);
  assert.equal(saved.body.meeting.outputFormat, 'custom');
  assert.equal(saved.body.meeting.customFormat.name, '주간 보고');
  const loaded = (await request(`/api/meetings/main/${record.id}`)).body.meeting;
  assert.deepEqual(loaded.customFormat, formats.validateCustom(custom));
  const text = fs.readFileSync(path.join(dir, '회의기록', saved.body.meeting.artifacts.summary), 'utf8');
  assert.ok(text.indexOf('## 이번 주 할 일') < text.indexOf('## 한 줄 요약'));
  assert.doesNotMatch(text, /## 결정 사항|## 주요 내용/);
  assert.equal((await request('/api/meetings/main', 'POST', { ...record, id: randomUUID(), customFormat: { name: '' } })).status, 400);
  const recordingId = randomUUID();
  const recording = { title: '녹음 회의', date: '2026-10-02', participants: '', context: '', expectedParts: 1, outputFormat: 'custom', customFormat: custom };
  assert.equal((await request(`/api/recordings/main/${recordingId}`, 'POST', recording)).status, 200);
  assert.equal((await request(`/api/recordings/main/${recordingId}`, 'POST', recording)).status, 200);
  assert.equal((await request(`/api/recordings/main/${recordingId}`, 'POST', { ...recording, customFormat: { ...custom, name: '다른 이름' } })).status, 409);
});

test('화면은 서버가 주는 같은 출력 형식 파일을 쓴다', async t => {
  const { url } = await start(t);
  const response = await fetch(url + '/formats.js');
  assert.equal(response.status, 200);
  assert.equal(await response.text(), fs.readFileSync(path.join(__dirname, '출력형식.js'), 'utf8'));
});
