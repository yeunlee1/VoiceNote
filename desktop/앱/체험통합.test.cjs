// 설치 패키지 기본 키의 3회 체험·확정·회수·소진·해제와 개인 키 우선 동작을 서버 경로로 검증한다.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
// 실제 해제 문자를 저장소에 남기지 않도록 시험용 문자만 해제로 인정한다.
const trialModule = require('./체험권한.cjs');
const realUnlock = trialModule.isUnlockCode;
trialModule.isUnlockCode = text => (typeof text === 'string' && text.trim() === 'TEST-UNLOCK-ONLY') || realUnlock(text);
const { createMeetingServer } = require('./서버.cjs');
const DEFAULT_KEY = 'sk-default-PACKAGE-never-shown-123';
const PERSONAL_KEY = 'sk-personal-never-shown-456';
const minutes = { overview: '요약', topics: [], decisions: [], actions: [], openQuestions: [] };

async function start(t, { fail = () => false, defaultKey = true } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'voicenote-trial-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const defaultKeyFile = path.join(dir, '기본키.json');
  if (defaultKey) fs.writeFileSync(defaultKeyFile, JSON.stringify({ apiKey: DEFAULT_KEY }));
  const calls = [];
  const meeting = createMeetingServer({ dataDir: path.join(dir, '회의자료'), keyFile: path.join(dir, '.env.회의록키'), defaultKeyFile,
    apiFetch: async (url, request) => {
      calls.push({ authorization: request.headers.Authorization, body: request.body });
      if (fail(calls.length)) return Response.json({ error: { code: 'server_error' } }, { status: 500 });
      return Response.json({ status: 'completed', usage: { input_tokens: 1, output_tokens: 1 },
        output: [{ type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: JSON.stringify(minutes) }] }] });
    } });
  await new Promise(resolve => meeting.server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => meeting.server.close(resolve)));
  const origin = `http://127.0.0.1:${meeting.server.address().port}`;
  const headers = { Origin: origin, 'X-Meeting-Token': meeting.token, 'Content-Type': 'application/json' };
  const request = async (route, body, extra = {}) => {
    const response = await fetch(origin + route, { method: body === undefined ? 'GET' : 'POST', headers: { ...headers, ...extra }, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await response.text();
    return { status: response.status, text, body: JSON.parse(text) };
  };
  const summary = analysisId => request('/api/summary', { text: '회의 발언', title: '회의', date: '2026-10-01', participants: '', context: '' },
    { 'X-Operation-Id': randomUUID(), 'X-AI-Consent': 'yes', ...(analysisId ? { 'X-Analysis-Id': analysisId } : {}) });
  return { dir, calls, request, summary };
}

test('기본 키만 있으면 체험 3회로 시작하고 설정 응답에 키 값을 내보내지 않는다', async t => {
  const { request } = await start(t);
  const config = await request('/api/config');
  assert.equal(config.body.keyConfigured, false);
  assert.equal(config.body.accessMode, 'trial');
  assert.equal(config.body.trialRemaining, 3);
  assert.doesNotMatch(config.text, /PACKAGE/);
  const none = await start(t, { defaultKey: false });
  assert.equal((await none.request('/api/config')).body.accessMode, 'none');
  assert.equal((await none.summary(randomUUID())).body.error.code, 'AI_KEY_MISSING');
});

test('분석 하나의 여러 요청은 한 번만 세고 실패·취소는 차감하지 않으며 3회 뒤 새 키 등록을 요구한다', async t => {
  let failing = false;
  const server = await start(t, { fail: () => failing });
  assert.equal((await server.summary()).body.error.code, 'INVALID_ANALYSIS');
  assert.equal(server.calls.length, 0);

  const first = randomUUID();
  assert.equal((await server.summary(first)).status, 200);
  assert.equal((await server.summary(first)).status, 200);
  assert.equal(server.calls.every(call => call.authorization === `Bearer ${DEFAULT_KEY}`), true);
  assert.equal((await server.request('/api/trial/finish', { analysisId: first })).body.trialUsed, 1);
  assert.equal((await server.request('/api/trial/finish', { analysisId: first })).body.trialUsed, 1);
  assert.equal((await server.summary(first)).body.error.code, 'TRIAL_ID_FINISHED');

  failing = true;
  const failed = randomUUID();
  assert.equal((await server.summary(failed)).status, 503);
  const afterFailure = await server.request('/api/trial/finish', { analysisId: failed });
  assert.equal(afterFailure.body.counted, false);
  assert.equal(afterFailure.body.trialUsed, 1);
  failing = false;
  const cancelled = randomUUID();
  assert.equal((await server.summary(cancelled)).status, 200);
  assert.equal((await server.request('/api/trial/release', { analysisId: cancelled })).body.trialUsed, 1);

  for (const id of [randomUUID(), randomUUID()]) {
    assert.equal((await server.summary(id)).status, 200);
    await server.request('/api/trial/finish', { analysisId: id });
  }
  const exhausted = await server.summary(randomUUID());
  assert.equal(exhausted.status, 403);
  assert.deepEqual(exhausted.body.error, { code: 'TRIAL_EXHAUSTED', message: '새로운 API키를 등록하세요.', mustRegister: true });
  assert.equal((await server.request('/api/config')).body.accessMode, 'exhausted');
  assert.equal((await server.request('/api/projects')).status, 200);
  assert.equal((await server.request('/api/project-settings/export')).status, 200);
  const savedTrial = JSON.parse(fs.readFileSync(path.join(server.dir, '체험권한.json'), 'utf8'));
  assert.equal(savedTrial.used, 3);
  assert.doesNotMatch(JSON.stringify(savedTrial), /sk-/);
});

test('개인 키를 등록하면 분석 식별자 없이 개인 키로 보내고 체험 횟수를 쓰지 않는다', async t => {
  const server = await start(t);
  const key = await server.request('/api/key', { apiKey: PERSONAL_KEY, persist: false });
  assert.equal(key.body.accessMode, 'personal');
  assert.equal((await server.summary()).status, 200);
  assert.equal(server.calls[0].authorization, `Bearer ${PERSONAL_KEY}`);
  assert.equal((await server.request('/api/config')).body.trialUsed, 0);
});

test('해제 문자는 키로 저장하거나 외부로 보내지 않고 기본 키 횟수 제한만 푼다', async t => {
  const server = await start(t);
  const unlocked = await server.request('/api/key', { apiKey: ' TEST-UNLOCK-ONLY ', persist: true });
  assert.equal(unlocked.status, 200);
  assert.equal(unlocked.body.unlocked, true);
  assert.equal(unlocked.body.keyConfigured, false);
  assert.equal(unlocked.body.accessMode, 'unlimited');
  assert.equal(fs.existsSync(path.join(server.dir, '.env.회의록키')), false);
  for (let i = 0; i < 4; i++) {
    const id = randomUUID();
    assert.equal((await server.summary(id)).status, 200);
    await server.request('/api/trial/finish', { analysisId: id });
  }
  assert.equal((await server.request('/api/config')).body.trialUsed, 0);
  assert.equal(server.calls.every(call => call.authorization === `Bearer ${DEFAULT_KEY}` && !String(call.body).includes('TEST-UNLOCK')), true);
  const exported = await server.request('/api/project-settings/export');
  assert.doesNotMatch(exported.text, /unlock|trial|sk-/i);
});
