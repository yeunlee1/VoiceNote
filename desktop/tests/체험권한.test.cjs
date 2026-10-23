// 공용 기본 키 3회 체험의 차감·예약·해제·재시작 보존 규칙을 실제 API 호출 없이 검증한다.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { createTrialAccess, isUnlockCode, EXHAUSTED_MESSAGE } = require('../앱/체험권한.cjs');

const defaultOnly = { personalKeyConfigured: false, defaultKeyAvailable: true };

function setup(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), '체험권한-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return path.join(dir, '체험권한.json');
}

function succeed(trial) {
  const id = randomUUID();
  assert.equal(trial.begin({ analysisId: id, ...defaultOnly }).allowed, true);
  assert.equal(trial.markSucceeded(id).marked, true);
  assert.equal(trial.finish(id).counted, true);
  return id;
}

test('3회 성공 후 4번째 분석은 새 키 등록을 요구한다', (t) => {
  const trial = createTrialAccess({ stateFile: setup(t) });
  assert.deepEqual(
    { mode: trial.status(defaultOnly).accessMode, remaining: trial.status(defaultOnly).trialRemaining, must: trial.status(defaultOnly).mustRegister },
    { mode: 'trial', remaining: 3, must: false },
  );
  for (let i = 0; i < 3; i++) succeed(trial);
  const fourth = trial.begin({ analysisId: randomUUID(), ...defaultOnly });
  assert.equal(fourth.allowed, false);
  assert.equal(fourth.code, 'TRIAL_EXHAUSTED');
  assert.equal(fourth.message, '새로운 API키를 등록하세요.');
  assert.equal(EXHAUSTED_MESSAGE, '새로운 API키를 등록하세요.');
  assert.equal(fourth.mustRegister, true);
  const status = trial.status(defaultOnly);
  assert.equal(status.accessMode, 'exhausted');
  assert.equal(status.trialRemaining, 0);
  assert.equal(status.mustRegister, true);
});

test('전사·분할·자동 재시도는 같은 분석 ID 안에서 한 번만 센다', (t) => {
  const trial = createTrialAccess({ stateFile: setup(t) });
  const id = randomUUID();
  for (let call = 0; call < 8; call++) {
    const result = trial.begin({ analysisId: id, ...defaultOnly });
    assert.equal(result.allowed, true);
    assert.equal(result.useKey, 'default');
  }
  assert.equal(trial.status(defaultOnly).trialReserved, 1);
  trial.markSucceeded(id);
  trial.markSucceeded(id);
  trial.finish(id);
  assert.equal(trial.status(defaultOnly).trialUsed, 1);
});

test('실패·취소는 차감하지 않고 예약을 돌려준다', (t) => {
  const trial = createTrialAccess({ stateFile: setup(t) });
  for (let i = 0; i < 5; i++) {
    const id = randomUUID();
    assert.equal(trial.begin({ analysisId: id, ...defaultOnly }).allowed, true);
    assert.equal(trial.release(id).released, true);
  }
  assert.equal(trial.release(randomUUID()).released, false);
  const status = trial.status(defaultOnly);
  assert.equal(status.trialUsed, 0);
  assert.equal(status.trialReserved, 0);
});

test('동시 분석 예약으로 3회를 넘기지 못한다', (t) => {
  const trial = createTrialAccess({ stateFile: setup(t) });
  succeed(trial);
  const a = randomUUID();
  const b = randomUUID();
  assert.equal(trial.begin({ analysisId: a, ...defaultOnly }).allowed, true);
  assert.equal(trial.begin({ analysisId: b, ...defaultOnly }).allowed, true);
  const c = trial.begin({ analysisId: randomUUID(), ...defaultOnly });
  assert.equal(c.allowed, false);
  assert.equal(c.code, 'TRIAL_IN_USE');
  trial.release(b);
  const d = randomUUID();
  assert.equal(trial.begin({ analysisId: d, ...defaultOnly }).allowed, true);
  for (const id of [a, d]) {
    trial.markSucceeded(id);
    trial.finish(id);
  }
  assert.equal(trial.status(defaultOnly).trialUsed, 3);
});

test('완료 확정은 멱등이며 끝난 ID와 예약 없는 ID는 차감하지 않는다', (t) => {
  const trial = createTrialAccess({ stateFile: setup(t) });
  const id = succeed(trial);
  assert.deepEqual(trial.finish(id), { counted: false, alreadyFinished: true });
  assert.deepEqual(trial.finish(id.toUpperCase()), { counted: false, alreadyFinished: true });
  assert.deepEqual(trial.finish(randomUUID()), { counted: false, alreadyFinished: false });
  assert.deepEqual(trial.finish('not-an-id'), { counted: false, alreadyFinished: false });
  assert.equal(trial.begin({ analysisId: id, ...defaultOnly }).code, 'TRIAL_ID_FINISHED');
  assert.equal(trial.begin({ analysisId: 'bad', ...defaultOnly }).code, 'INVALID_ANALYSIS');
  assert.equal(trial.status(defaultOnly).trialUsed, 1);
  // 성공한 회의를 명시적으로 다시 분석하면 새 ID로 새 1회가 된다.
  succeed(trial);
  assert.equal(trial.status(defaultOnly).trialUsed, 2);
});

test('재시작해도 횟수와 완료 ID는 유지되고 미완료 예약은 회수된다', (t) => {
  const file = setup(t);
  const first = createTrialAccess({ stateFile: file });
  const done = succeed(first);
  succeed(first);
  const pending = randomUUID();
  first.begin({ analysisId: pending, ...defaultOnly });
  const second = createTrialAccess({ stateFile: file });
  const status = second.status(defaultOnly);
  assert.equal(status.trialUsed, 2);
  assert.equal(status.trialReserved, 0);
  assert.deepEqual(second.finish(done), { counted: false, alreadyFinished: true });
  assert.deepEqual(second.finish(pending), { counted: false, alreadyFinished: false });
  assert.equal(second.begin({ analysisId: randomUUID(), ...defaultOnly }).allowed, true);
  const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.deepEqual(Object.keys(saved).sort(), ['finished', 'unlocked', 'used', 'version']);
});

test('오래 방치된 예약은 기한이 지나면 회수된다', (t) => {
  let clock = 1000;
  const trial = createTrialAccess({ stateFile: setup(t), leaseMs: 100, now: () => clock });
  const id = randomUUID();
  trial.begin({ analysisId: id, ...defaultOnly });
  trial.markSucceeded(id);
  clock += 101;
  assert.equal(trial.status(defaultOnly).trialReserved, 0);
  assert.equal(trial.finish(id).counted, false);
});

test('공개 소스에는 해제문자가 없고, 해제 상태는 기본 키 횟수만 풀어 재시작 후에도 유지된다', (t) => {
  const file = setup(t);
  const trial = createTrialAccess({ stateFile: file });
  for (let i = 0; i < 3; i++) succeed(trial);
  assert.equal(isUnlockCode(' UNLOCK-TEST '), false);
  assert.equal(isUnlockCode(''), false);
  assert.equal(isUnlockCode(null), false);
  assert.equal(trial.isUnlockCode('UNLOCK-TEST'), false);
  trial.unlock();
  const result = trial.begin({ analysisId: randomUUID(), ...defaultOnly });
  assert.deepEqual(result, { allowed: true, useKey: 'default', mode: 'unlimited', reserved: false });
  const after = createTrialAccess({ stateFile: file });
  const status = after.status(defaultOnly);
  assert.equal(status.accessMode, 'unlimited');
  assert.equal(status.mustRegister, false);
  assert.equal(status.trialUsed, 3);
  for (let i = 0; i < 5; i++) assert.equal(after.begin({ analysisId: randomUUID(), ...defaultOnly }).allowed, true);
});

test('개인 키는 체험 제한 없이 우선하고, 지워도 체험 횟수는 초기화되지 않는다', (t) => {
  const file = setup(t);
  const trial = createTrialAccess({ stateFile: file });
  for (let i = 0; i < 3; i++) succeed(trial);
  const own = { personalKeyConfigured: true, defaultKeyAvailable: true };
  for (let i = 0; i < 5; i++) {
    const result = trial.begin({ analysisId: randomUUID(), ...own });
    assert.deepEqual(result, { allowed: true, useKey: 'personal', mode: 'personal', reserved: false });
  }
  assert.equal(trial.status(own).accessMode, 'personal');
  assert.equal(trial.status(own).mustRegister, false);
  // 개인 키 삭제 뒤에도 소진 상태가 그대로다.
  assert.equal(trial.status(defaultOnly).accessMode, 'exhausted');
  assert.equal(createTrialAccess({ stateFile: file }).status(defaultOnly).trialUsed, 3);
});

test('개인 키를 쓴 분석은 체험 횟수를 차감하지 않는다', (t) => {
  const trial = createTrialAccess({ stateFile: setup(t) });
  const id = randomUUID();
  trial.begin({ analysisId: id, personalKeyConfigured: true, defaultKeyAvailable: true });
  assert.equal(trial.finish(id).counted, false);
  assert.equal(trial.status(defaultOnly).trialUsed, 0);
});

test('키가 하나도 없으면 등록을 요구한다', (t) => {
  const trial = createTrialAccess({ stateFile: setup(t) });
  const none = { personalKeyConfigured: false, defaultKeyAvailable: false };
  assert.equal(trial.status(none).accessMode, 'none');
  assert.equal(trial.status(none).mustRegister, true);
  assert.equal(trial.begin({ analysisId: randomUUID(), ...none }).code, 'AI_KEY_MISSING');
});

test('손상된 체험 기록은 0회로 되돌리지 않고 소진으로 처리하며 파일을 보존한다', (t) => {
  const file = setup(t);
  fs.writeFileSync(file, '{"version":1,"used":"0"');
  const trial = createTrialAccess({ stateFile: file });
  const status = trial.status(defaultOnly);
  assert.equal(status.accessMode, 'exhausted');
  assert.equal(status.trialRemaining, 0);
  assert.notEqual(status.trialError, '');
  assert.equal(fs.readFileSync(file, 'utf8'), '{"version":1,"used":"0"');
  assert.equal(trial.begin({ analysisId: randomUUID(), personalKeyConfigured: true, defaultKeyAvailable: true }).allowed, true);
  trial.unlock();
  assert.equal(trial.status(defaultOnly).accessMode, 'unlimited');
  assert.equal(createTrialAccess({ stateFile: file }).status(defaultOnly).accessMode, 'unlimited');
});

test('저장 실패 시 해제·확정을 적용하지 않고 예약을 남겨 다시 finish하면 영속된다', (t) => {
  const file = setup(t);
  const blocker = path.join(path.dirname(file), '막힘');
  fs.writeFileSync(blocker, '');
  const stateFile = path.join(blocker, '체험권한.json');
  const trial = createTrialAccess({ stateFile });
  assert.throws(() => trial.unlock(), { code: 'TRIAL_STORAGE_FAILED' });
  assert.equal(trial.status(defaultOnly).unlocked, false);
  const id = randomUUID();
  trial.begin({ analysisId: id, ...defaultOnly });
  trial.markSucceeded(id);
  assert.throws(() => trial.finish(id), { code: 'TRIAL_STORAGE_FAILED' });
  assert.equal(trial.status(defaultOnly).trialUsed, 0);
  assert.equal(trial.status(defaultOnly).trialReserved, 1);
  fs.rmSync(blocker);
  assert.deepEqual(trial.finish(id), { counted: true, alreadyFinished: false });
  assert.deepEqual(trial.finish(id), { counted: false, alreadyFinished: true });
  assert.equal(createTrialAccess({ stateFile }).status(defaultOnly).trialUsed, 1);
});

test('상태 파일의 상위 폴더가 없으면 만들어 저장한다', (t) => {
  const stateFile = path.join(path.dirname(setup(t)), '새 사용자', 'MeetingJournal', '체험권한.json');
  const trial = createTrialAccess({ stateFile });
  assert.equal(trial.status(defaultOnly).trialUsed, 0);
  succeed(trial);
  assert.equal(createTrialAccess({ stateFile }).status(defaultOnly).trialUsed, 1);
});

test('성공한 실제 요청이 없는 예약은 확정하지 않고 회수한다', (t) => {
  const trial = createTrialAccess({ stateFile: setup(t) });
  const id = randomUUID();
  trial.begin({ analysisId: id, ...defaultOnly });
  assert.deepEqual(trial.finish(id), { counted: false, alreadyFinished: false });
  assert.equal(trial.status(defaultOnly).trialReserved, 0);
  assert.equal(trial.status(defaultOnly).trialUsed, 0);
  assert.deepEqual(trial.markSucceeded(randomUUID()), { marked: false });
});

test('분석 ID 없는 공용키 요청은 해제 상태에서도 막고 개인 키는 허용한다', (t) => {
  const trial = createTrialAccess({ stateFile: setup(t) });
  assert.equal(trial.begin({ ...defaultOnly }).code, 'INVALID_ANALYSIS');
  trial.unlock();
  assert.equal(trial.begin({ analysisId: 'x', ...defaultOnly }).code, 'INVALID_ANALYSIS');
  assert.equal(trial.begin({ personalKeyConfigured: true, defaultKeyAvailable: true }).useKey, 'personal');
});

test('서버 경계에서 소진 시 모의 API를 부르지 않고 해제문자를 Authorization으로 보내지 않는다', async (t) => {
  const trial = createTrialAccess({ stateFile: setup(t) });
  const sent = [];
  const keys = { personal: '', default: 'mock-default-key' };
  const apiFetch = async (url, init) => { sent.push(init.headers.Authorization); return { ok: true }; };
  async function handleAi(analysisId) {
    const gate = trial.begin({ analysisId, personalKeyConfigured: Boolean(keys.personal), defaultKeyAvailable: Boolean(keys.default) });
    if (!gate.allowed) return gate;
    const response = await apiFetch('mock://ai', { headers: { Authorization: `Bearer ${keys[gate.useKey]}` } });
    if (response.ok && gate.reserved) trial.markSucceeded(analysisId);
    return gate;
  }
  const isTestUnlock = (text) => text.trim() === 'TEST-UNLOCK-ONLY';
  // 공개 소스에는 해제문자가 없어 이 시험에서만 쓰는 해제문자로 서버 경계를 확인한다.
  function saveKey(text) {
    if (isTestUnlock(text)) return trial.unlock();
    keys.personal = text.trim();
  }
  for (let i = 0; i < 3; i++) {
    const id = randomUUID();
    await handleAi(id);
    await handleAi(id);
    trial.finish(id);
  }
  assert.equal(sent.length, 6);
  const blocked = await handleAi(randomUUID());
  assert.equal(blocked.code, 'TRIAL_EXHAUSTED');
  assert.equal(sent.length, 6);
  saveKey(' TEST-UNLOCK-ONLY ');
  assert.equal(keys.personal, '');
  await handleAi(randomUUID());
  assert.equal(sent.length, 7);
  assert.ok(sent.every((header) => header === 'Bearer mock-default-key'));
});
