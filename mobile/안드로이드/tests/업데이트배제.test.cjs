// 녹음·분석·의견 반영 서비스를 시작하는 요청이 업데이트 설치와 서로 막히는지 MainActivity 소스로 검사한다(기기 동작은 AndroidChecks와 가상기기 시험이 본다).
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'kr', 'local', 'meetingjournal', 'MainActivity.java'), 'utf8');
// switch 안의 한 요청 처리 부분(다음 case 앞까지)을 꺼낸다.
function block(name) {
  const start = source.indexOf(`case "${name}"`);
  assert.ok(start >= 0, `${name} 요청 처리를 찾지 못했습니다.`);
  const next = source.indexOf('case "', start + 6);
  return source.slice(start, next < 0 ? undefined : next);
}

test('회의 서비스를 시작하는 요청은 설치 확인 대기 중이면 거절한다', () => {
  for (const name of ['start', 'analyze', 'refine']) assert.match(block(name), /if\(Updates\.installing\(\)\)throw new IOException\(UPDATE_WAIT\);/, name);
});

test('서비스를 직접 시작하는 곳은 시작 요청을 보내기 전에 시작 중 표시를 세우고, 실패하면 지운다', () => {
  // 서비스가 active를 켜기 전에 업데이트 설치가 끼어들지 못하게 하려는 표시다(A7).
  const starts = [...source.matchAll(/startForegroundService\(/g)].map((found) => found.index);
  assert.ok(starts.length >= 2);
  for (const at of starts) {
    const before = source.slice(Math.max(0, source.lastIndexOf('case "', at), source.lastIndexOf('private void launch(', at)), at);
    assert.match(before, /MeetingService\.startingAt=System\.currentTimeMillis\(\);/, `시작 중 표시 없이 서비스를 시작합니다: ${source.slice(at, at + 80)}`);
    const after = source.slice(at, source.indexOf('\n', at));
    assert.match(after, /catch\(Exception ex\)\{MeetingService\.startingAt=0;/, `시작 실패 때 표시를 지우지 않습니다: ${source.slice(at, at + 80)}`);
  }
});

test('업데이트 설치 요청은 서비스가 돌거나 시작 중이면 거절한다', () => {
  assert.match(block('updateInstall'), /if\(MeetingService\.active\|\|MeetingService\.starting\(\)\)throw new IOException/);
});
