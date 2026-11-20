// 회의 종료 hold·분석 방식·분석 시도 번호가 화면 요청에서 서비스까지 이어지는지 소스로 확인한다. 실제 서비스 동작은 기기 시험 AndroidChecks(probe f-mode)가 본다.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');

const dir = path.join(__dirname, '..', 'src', 'kr', 'local', 'meetingjournal');
const read = name => fs.readFileSync(path.join(dir, name), 'utf8');
const activity = read('MainActivity.java'), service = read('MeetingService.java'), ai = read('Ai.java');
function block(source, name) {
  const start = source.indexOf(`case "${name}"`);
  assert.ok(start >= 0, `${name} 요청 처리를 찾지 못했습니다.`);
  const next = source.indexOf('case "', start + 6);
  return source.slice(start, next < 0 ? undefined : next);
}
function method(source, signature) {
  const start = source.indexOf(signature);
  assert.ok(start >= 0, `${signature}를 찾지 못했습니다.`);
  return source.slice(start, source.indexOf('\n    }', start));
}

test('화면의 회의 종료는 hold 값을 서비스에 넘긴다', () => {
  assert.match(block(activity, 'finish'), /putExtra\("hold",hold\)/);
});

test('다시 분석 요청은 검사한 분석 방식과 시도 번호를 서비스에 넘긴다', () => {
  const analyze = block(activity, 'analyze');
  assert.match(analyze, /MeetingService\.mode\(data\.optString\("mode",null\)\)/);
  assert.match(analyze, /data\.optString\("attemptId"\)/);
  assert.match(activity, /putExtra\("mode",mode\)/);
  assert.match(activity, /putExtra\("attemptId",attemptId\)/);
});

test('녹음 파일 불러오기 요청도 분석 방식을 먼저 검사한다', () => {
  assert.match(block(activity, 'importAudio'), /MeetingService\.mode\(data\.optString\("mode",null\)\)/);
});

test('서비스의 회의 종료는 hold면 분석을 시작하지 않고, 없으면 지금처럼 회의록까지 만든다', () => {
  const finish = service.match(/if\("finish"\.equals\(action\)\)\{[^\n]*/)[0];
  assert.match(finish, /if\(intent\.getBooleanExtra\("hold",false\)\)hold\(\);else analyze\("minutes"\);/);
  assert.doesNotMatch(method(service, 'private void hold()'), /analyze\(|new Ai\(/);
});

test('서비스는 분석 요청의 방식과 시도 번호를 받아 상태에 싣는다', () => {
  assert.match(service, /attemptId=\(refining\|\|"analyze"\.equals\(action\)\)\?intent\.getStringExtra\("attemptId"\):null;/);
  assert.match(service, /analyze\(mode\(intent\.getStringExtra\("mode"\)\)\)/);
  assert.match(service, /analyze\(mode\(fields\.optString\("mode",null\)\),activity\)/);
  // 불러오기는 녹음 파일을 나눈 줄이 든 일지를 분석에 그대로 넘긴다.
});

test('전사까지만은 요약 없이 transcribed 상태를 저장한 뒤 체험을 확정한다', () => {
  const body = method(ai, 'void transcribeOnly(JSONObject record)');
  assert.match(body, /transcribeAll\(record\)/);
  assert.doesNotMatch(body, /section\(|shorten\(|store\.finish\(|copyResult\(/);
  assert.ok(body.indexOf('"transcribed"') > 0 && body.indexOf('"transcribed"') < body.indexOf('finishAccess(record)'));
  assert.match(body, /catch\(Exception ex\)\{store\.trial\(\)\.release\(analysisId\);throw ex;\}/);
});
