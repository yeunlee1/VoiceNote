// 저장한 회의를 다시 열 때 요약 모델과 모델별 사용량이 보존되고 옛 기록도 읽히는지 검증한다.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { createMeetingServer } = require('./서버.cjs');

async function start(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'AI사용량보관-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const meeting = createMeetingServer({ dataDir: dir });
  await new Promise(resolve => meeting.server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => meeting.server.close(resolve)));
  const url = `http://127.0.0.1:${meeting.server.address().port}`;
  const request = async (route, body) => {
    const response = await fetch(url + route, { method: body === undefined ? 'GET' : 'POST',
      headers: { Origin: url, 'Content-Type': 'application/json', 'X-Meeting-Token': meeting.token }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
  };
  await request('/api/projects/1', { name: '시험', title: '회의', context: '', revision: 0 });
  return { request, dir };
}
const meeting = extra => ({ id: randomUUID(), title: '사용량 회의', date: '2026-10-01', participants: '', context: '', transcript: '발언',
  minutes: { overview: '요약', topics: [], decisions: [], actions: [], openQuestions: [] }, ...extra });

test('저장한 회의를 열면 모델별 사용량과 분석 모델이 그대로 돌아온다', async t => {
  const { request } = await start(t);
  const usage = [
    { kind: 'transcription', model: 'gpt-transcribe', requests: 2, measuredRequests: 2, unknownRequests: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0, cachedInputTokens: 0, reasoningTokens: 0, audioSeconds: 180 },
    { kind: 'summary', model: 'gpt-6-luna', requests: 3, measuredRequests: 2, unknownRequests: 1, inputTokens: 9000, outputTokens: 4000, totalTokens: 13000, cachedInputTokens: 1000, reasoningTokens: 2500, audioSeconds: 0 },
  ];
  const data = meeting({ analysis: { summaryModel: 'gpt-6-luna', usage } });
  const saved = await request('/api/projects/1/meetings', data);
  assert.equal(saved.status, 200);
  const loaded = await request(`/api/projects/1/meetings/${data.id}`);
  assert.deepEqual(loaded.body.meeting.analysis, { summaryModel: 'gpt-6-luna', usage, callIds: [] });
  const again = await request('/api/projects/1/meetings', data);
  assert.equal(again.status, 200);
});

test('사용량 필드가 없는 옛 기록과 잘못된 사용량 값도 회의를 막지 않는다', async t => {
  const { request, dir } = await start(t);
  const old = meeting();
  assert.equal((await request('/api/projects/1/meetings', old)).status, 200);
  const loadedOld = await request(`/api/projects/1/meetings/${old.id}`);
  assert.equal(loadedOld.body.meeting.analysis, undefined);
  const odd = meeting({ analysis: { summaryModel: 7, usage: [{ model: 'gpt-6-sol', inputTokens: -5, outputTokens: 'x', requests: 2 }, { model: '<script>' }] } });
  assert.equal((await request('/api/projects/1/meetings', odd)).status, 200);
  const loadedOdd = (await request(`/api/projects/1/meetings/${odd.id}`)).body.meeting.analysis;
  assert.equal(loadedOdd.summaryModel, null);
  assert.equal(loadedOdd.usage.length, 1);
  assert.equal(loadedOdd.usage[0].unknownRequests, 2);
  assert.equal(loadedOdd.usage[0].totalTokens, 0);
  const file = path.join(dir, '프로젝트-01', `회의-${odd.id}.json`);
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  raw.analysis.usage.push({ model: 'gpt-6-sol', requests: 'broken' });
  fs.writeFileSync(file, JSON.stringify(raw));
  assert.equal((await request(`/api/projects/1/meetings/${odd.id}`)).status, 200);
});
