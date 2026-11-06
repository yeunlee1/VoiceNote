// 휴대폰 화면의 앱 업데이트 표시(첫 화면 안내 줄, 프로그램 정보의 상태·단추·잠김 이유)가 업데이트 상태와 회의 상태에 맞게 정해지고, 버전별 바뀐 점 파일이 데스크톱과 같은지 검증한다.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const Flow = require('../assets/flow.js');

const base = { supported: true, currentVersion: '1.5.0', status: 'latest', version: null, publishedAt: '2026-11-20T01:00:00Z', size: 1_048_576, received: 0, error: null, needsPermission: false, canContinue: false };
const view = (change, reasons = []) => Flow.updateView({ ...base, ...change }, reasons);

test('휴대폰 화면의 바뀐 점 파일은 데스크톱과 같은 파일이다', () => {
  assert.deepEqual(fs.readFileSync(path.join(__dirname, '..', 'assets', 'release-notes.js')), fs.readFileSync(path.join(__dirname, '..', '..', '..', 'desktop', '앱', '릴리즈노트.js')));
});

test('최신·확인 중·확인 실패에는 첫 화면 안내 줄과 설치 단추가 없다', () => {
  assert.equal(view({}).note, null);
  assert.match(view({}).text, /1\.5\.0 버전이 최신/);
  assert.equal(view({}).action, null);
  assert.equal(view({ status: 'checking' }).check.disabled, true);
  const failed = view({ status: 'unknown', error: { code: 'UPDATE_CHECK_FAILED', message: '새 버전을 확인하지 못했습니다. 인터넷 연결을 확인한 뒤 다시 확인을 눌러 주세요.' } });
  assert.equal(failed.note, null);
  assert.match(failed.text, /인터넷/);
  assert.equal(failed.check.hidden, false);
  // 상태 정보가 없거나 브리지가 업데이트를 모르면 확인 중으로 두고 아무 단추도 내지 않는다.
  assert.equal(Flow.updateView(null, []).action, null);
  assert.equal(Flow.updateView(null, []).note, null);
});

test('새 버전이 있으면 안내 줄과 지금 업데이트를 보이고, 회의 중이면 받아 두기만 한다', () => {
  const ready = view({ status: 'available', version: '1.5.1' });
  assert.equal(ready.note, '새 버전 1.5.1');
  assert.match(ready.text, /1\.5\.1 버전이 나왔습니다/);
  assert.deepEqual(ready.action, { kind: 'download', label: '지금 업데이트', disabled: false });
  assert.equal(ready.lock, null);
  const busy = view({ status: 'available', version: '1.5.1' }, ['녹음이나 분석이 끝난 뒤 설치하세요.']);
  assert.deepEqual(busy.action, { kind: 'download', label: '받아 두기', disabled: false });
  assert.match(busy.lock, /받아 두기만/);
});

test('받는 중에는 받은 정도를 보이고 다시 확인을 숨긴다', () => {
  const result = view({ status: 'downloading', version: '1.5.1', received: 524_288 });
  assert.equal(result.note, '받는 중 50%');
  assert.deepEqual(result.progress, { percent: 50, text: '0.5 MB / 1.0 MB' });
  assert.equal(result.check.hidden, true);
  assert.equal(result.action, null);
});

test('받은 뒤에는 설치를 누르게 하고, 설치 허용이 꺼져 있으면 허용 켜기로 바꾸며, 잠김이면 이유를 보인다', () => {
  assert.deepEqual(view({ status: 'ready', version: '1.5.1' }).action, { kind: 'install', label: '설치', disabled: false });
  const permission = view({ status: 'ready', version: '1.5.1', needsPermission: true });
  assert.deepEqual(permission.action, { kind: 'permission', label: '설치 허용 켜기', disabled: false });
  assert.match(permission.text, /설치 허용/);
  const locked = view({ status: 'ready', version: '1.5.1' }, ['평가 의견을 저장한 뒤 설치하세요.']);
  assert.deepEqual(locked.action, { kind: 'install', label: '설치', disabled: true });
  assert.equal(locked.lock, '평가 의견을 저장한 뒤 설치하세요.');
});

test('설치 확인을 기다리면 화면이 닫혔을 때 설치 계속을 보이고, 실패는 이유를 남긴다', () => {
  assert.equal(view({ status: 'confirming', version: '1.5.1' }).action, null);
  assert.deepEqual(view({ status: 'confirming', version: '1.5.1', canContinue: true }).action, { kind: 'confirm', label: '설치 계속', disabled: false });
  assert.equal(view({ status: 'confirming', version: '1.5.1' }).note, '설치 확인 대기');
  // 설치 계속도 앱이 곧 닫히므로, 사라질 입력이 있으면 단추를 잠그고 이유를 단추 가까이에 보인다.
  const lockedContinue = view({ status: 'confirming', version: '1.5.1', canContinue: true }, ['내 형식 변경을 저장한 뒤 설치하세요.']);
  assert.deepEqual(lockedContinue.action, { kind: 'confirm', label: '설치 계속', disabled: true });
  assert.equal(lockedContinue.lock, '내 형식 변경을 저장한 뒤 설치하세요.');
  const aborted = view({ status: 'ready', version: '1.5.1', error: { code: 'UPDATE_INSTALL_FAILED', message: '설치가 취소되거나 중단되었습니다. 다시 설치를 눌러 주세요.' } });
  assert.deepEqual(aborted.detail, { text: '설치가 취소되거나 중단되었습니다. 다시 설치를 눌러 주세요.', tone: 'error' });
});

test('직접 받기·설치 끝은 그에 맞는 안내만 보인다', () => {
  const manual = view({ status: 'manual', version: '1.5.1', error: { code: 'UPDATE_SIGNATURE_INVALID', message: '업데이트 정보의 서명을 확인하지 못했습니다. 깃허브 릴리즈 페이지에서 설치파일을 직접 받아 설치하세요.' } });
  assert.equal(manual.note, '새 버전 1.5.1');
  assert.equal(manual.action, null);
  assert.deepEqual(manual.detail, { text: manual.detail.text, tone: 'info' });
  assert.match(manual.detail.text, /깃허브/);
  assert.match(view({ status: 'installed', version: '1.5.1' }).text, /다시 열어/);
});
