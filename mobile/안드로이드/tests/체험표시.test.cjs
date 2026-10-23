// 공용 기본 키 체험 상태에 따라 시작 가능 여부와 AI 설정 안내 문구가 바뀌는지 검증한다.
const test = require('node:test');
const assert = require('node:assert/strict');
const Flow = require('../assets/flow.js');

const base = { keyConfigured: false, keySource: 'none', trialLimit: 3, trialUsed: 0, trialRemaining: 3, trialReserved: 0, unlocked: false, trialError: '' };

test('체험·해제·개인 키는 분석 가능, 소진·키 없음은 불가', () => {
  assert.equal(Flow.canAnalyze({ ...base, accessMode: 'trial', mustRegister: false }), true);
  assert.equal(Flow.canAnalyze({ ...base, accessMode: 'unlimited', mustRegister: false }), true);
  assert.equal(Flow.canAnalyze({ ...base, accessMode: 'personal', keyConfigured: true, mustRegister: false }), true);
  assert.equal(Flow.canAnalyze({ ...base, accessMode: 'exhausted', mustRegister: true }), false);
  assert.equal(Flow.canAnalyze({ ...base, accessMode: 'none', mustRegister: true }), false);
  assert.equal(Flow.canAnalyze({ keyConfigured: true }), true, '체험 필드가 없는 이전 응답은 개인 키로 판단');
});

test('남은 체험 횟수와 소진 안내 문구', () => {
  const trial = Flow.accessText({ ...base, accessMode: 'trial', trialUsed: 2, trialRemaining: 1 });
  assert.equal(trial.chip, '체험 1회'); assert.match(trial.status, /3회까지.*남은 횟수 1회/);
  assert.deepEqual(Flow.accessText({ ...base, accessMode: 'exhausted', trialRemaining: 0 }), { chip: '키 필요', status: '새로운 API키를 등록하세요.' });
  assert.equal(Flow.accessText({ ...base, accessMode: 'unlimited' }).chip, '준비됨');
  assert.equal(Flow.accessText({ ...base, accessMode: 'personal', keyConfigured: true, keySource: 'session' }).status, '앱을 닫을 때까지만 쓰는 키가 등록되어 있습니다.');
  assert.ok(!/보안|안전/.test(JSON.stringify(['trial', 'unlimited', 'exhausted'].map(m => Flow.accessText({ ...base, accessMode: m })))), '강한 보안 약속 문구 없음');
});

test('소진되면 시작 전 필요 항목이 정확한 등록 안내로 바뀐다', () => {
  const s = { busy: false, active: false, keyConfigured: false, trialExhausted: true, projectName: 'A', date: '2026-10-01', notes: '', recordConsent: true, aiConsent: true };
  assert.deepEqual(Flow.startBlockers(s).map(r => r.text), ['새로운 API키를 등록하세요.']);
  assert.deepEqual(Flow.startBlockers({ ...s, trialExhausted: false }).map(r => r.text), ['AI 설정에서 API 키를 등록하세요.']);
});
