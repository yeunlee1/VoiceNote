// 녹음 서비스가 회의 기록으로 상태를 내놓을 때 의견 반영·녹음 파일 불러오기의 시도 번호를 끝까지 싣는지 소스로 확인한다. 실제 서비스 동작은 기기 시험 AndroidChecks가 확인한다.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'kr', 'local', 'meetingjournal', 'MeetingService.java'), 'utf8');

test('회의 기록으로 서비스 상태를 만들 때는 시도 번호를 싣는 publish()만 쓴다', () => {
  assert.match(source, /private void publish\(\)[^\n]*if\(attemptId!=null\)value\.put\("attemptId",attemptId\);snapshot=value\.toString\(\);/, 'publish()가 시도 번호를 싣지 않습니다.');
  const direct = source.match(/snapshot=record\.[^;]*;/g) || [];
  assert.deepEqual(direct, [], '회의 기록을 그대로 상태로 내놓아 시도 번호가 빠지는 곳이 있습니다.');
  // 분석이 성공으로 끝난 상태에 시도 번호가 없으면 화면이 이번 불러오기의 끝을 알아보지 못해 준비 중에 멈춘다.
});
