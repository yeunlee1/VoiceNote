// 서버의 앱 업데이트 경로가 인증·출처 검사를 거치고, 업데이트 담당에 그대로 넘기며, AI 요청과 설치 시작이 서로 겹치지 않게 막는지 검증한다.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { createMeetingServer } = require('./서버.cjs');
const { APP_VERSION } = require('./앱버전.cjs');

function fakeUpdater({ installing = false, fail = {} } = {}) {
  const calls = [];
  const snapshot = (status) => ({ supported: true, currentVersion: APP_VERSION, status, version: '9.0.0', publishedAt: null, size: 10, received: 0, error: null, lastResult: null, pageUrl: 'https://github.com/yeunlee1/VoiceNote/releases/latest' });
  const step = (name, status) => async () => {
    calls.push(name);
    if (fail[name]) throw Object.assign(new Error(fail[name].message), fail[name]);
    return snapshot(status);
  };
  return { calls, installing: () => installing, status: () => snapshot('available'), ensureChecked: () => { calls.push('ensure'); return snapshot('checking'); },
    check: step('check', 'checking'), download: step('download', 'downloading'), launch: step('launch', 'launching') };
}

async function fixture(t, options = {}) {
  const meeting = createMeetingServer(options);
  await new Promise((resolve) => meeting.server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => { meeting.server.closeAllConnections(); meeting.server.close(resolve); }));
  const url = `http://127.0.0.1:${meeting.server.address().port}`;
  const headers = { 'X-Meeting-Token': meeting.token, Origin: url };
  const call = async (route, method = 'GET', extra = {}) => {
    const response = await fetch(url + route, { method, headers: { ...headers, ...extra } });
    return { status: response.status, body: await response.json().catch(() => null) };
  };
  return { url, headers, call };
}

test('업데이트 담당이 없는 서버(개발·시험 실행)는 제공 안 함으로 답하고 확인·받기·설치를 거절한다', async (t) => {
  const { call } = await fixture(t);
  const read = await call('/api/update');
  assert.equal(read.status, 200);
  assert.equal(read.body.update.status, 'unsupported');
  assert.equal(read.body.update.supported, false);
  assert.equal(read.body.update.currentVersion, APP_VERSION);
  for (const route of ['/api/update/check', '/api/update/download', '/api/update/launch']) {
    const result = await call(route, 'POST');
    assert.equal(result.status, 409, route);
    assert.equal(result.body.error.code, 'UPDATE_UNSUPPORTED', route);
  }
});

test('조회는 첫 확인을 맡기고, 다시 확인·받기·설치 시작은 POST로만 업데이트 담당에 넘긴다', async (t) => {
  const updater = fakeUpdater();
  const { call } = await fixture(t, { updater });
  assert.equal((await call('/api/update')).body.update.status, 'checking');
  assert.equal((await call('/api/update/check', 'POST')).body.update.status, 'checking');
  assert.equal((await call('/api/update/download', 'POST')).body.update.status, 'downloading');
  assert.equal((await call('/api/update/launch', 'POST')).body.update.status, 'launching');
  assert.equal((await call('/api/update/launch')).status, 404);
  assert.deepEqual(updater.calls, ['ensure', 'check', 'download', 'launch']);
});

test('토큰이나 같은 출처가 없으면 업데이트 담당을 부르지 않는다', async (t) => {
  const updater = fakeUpdater();
  const { url, headers } = await fixture(t, { updater });
  const noToken = await fetch(`${url}/api/update`);
  assert.equal(noToken.status, 401);
  await noToken.text();
  for (const route of ['/api/update/download', '/api/update/launch']) {
    const response = await fetch(url + route, { method: 'POST', headers: { 'X-Meeting-Token': headers['X-Meeting-Token'], Origin: 'https://example.com' } });
    assert.equal(response.status, 403, route);
    await response.text();
  }
  assert.deepEqual(updater.calls, []);
});

test('업데이트 담당의 거절은 코드와 문장을 그대로 화면에 돌려준다', async (t) => {
  const updater = fakeUpdater({ fail: { download: { code: 'UPDATE_NOT_AVAILABLE', status: 409, message: '받을 새 버전이 없습니다. 다시 확인을 눌러 주세요.' } } });
  const { call } = await fixture(t, { updater });
  const result = await call('/api/update/download', 'POST');
  assert.equal(result.status, 409);
  assert.equal(result.body.error.code, 'UPDATE_NOT_AVAILABLE');
  assert.equal(result.body.error.message, '받을 새 버전이 없습니다. 다시 확인을 눌러 주세요.');
});

test('AI 요청이 진행 중이면 설치를 시작하지 않는다', async (t) => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const updater = fakeUpdater();
  const minutes = { overview: '요약', topics: [], decisions: [], actions: [], openQuestions: [] };
  const { url, headers, call } = await fixture(t, { updater, apiFetch: async () => {
    await gate;
    return Response.json({ status: 'completed', output: [{ type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: JSON.stringify(minutes) }] }] });
  } });
  await (await fetch(`${url}/api/key`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ apiKey: 'mock-only', persist: false }) })).text();
  const summary = fetch(`${url}/api/summary`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json', 'X-Operation-Id': randomUUID(), 'X-AI-Consent': 'yes' },
    body: JSON.stringify({ text: '회의 내용', title: '회의', date: '2026-11-06', participants: '' }) });
  // 요약 요청이 서버에서 AI 호출을 기다리는 동안 설치 시작을 누른다.
  await new Promise((resolve) => setTimeout(resolve, 150));
  const launch = await call('/api/update/launch', 'POST');
  assert.equal(launch.status, 409);
  assert.equal(launch.body.error.code, 'BUSY');
  assert.equal(updater.calls.includes('launch'), false);
  release();
  assert.equal((await summary).status, 200);
});

test('설치를 시작하는 중이면 새 AI 요청을 보내지 않는다', async (t) => {
  let sent = 0;
  const { url, headers } = await fixture(t, { updater: fakeUpdater({ installing: true }), apiFetch: async () => { sent++; return Response.json({}); } });
  await (await fetch(`${url}/api/key`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ apiKey: 'mock-only', persist: false }) })).text();
  const response = await fetch(`${url}/api/summary`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json', 'X-Operation-Id': randomUUID(), 'X-AI-Consent': 'yes' },
    body: JSON.stringify({ text: '회의 내용', title: '회의', date: '2026-11-06', participants: '' }) });
  assert.equal(response.status, 409);
  assert.equal((await response.json()).error.code, 'UPDATING');
  assert.equal(sent, 0);
});
