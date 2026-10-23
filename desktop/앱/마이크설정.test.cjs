// 마이크 설정 API의 인증과 성공 및 실패 응답을 실제 로컬 서버로 검증한다.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createMeetingServer } = require('./서버.cjs');

async function fixture(t, microphoneControl) {
  const meeting = createMeetingServer({ microphoneControl });
  await new Promise(resolve => meeting.server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => meeting.server.close(resolve)));
  const url = `http://127.0.0.1:${meeting.server.address().port}`;
  return { url, headers: { 'X-Meeting-Token': meeting.token, Origin: url } };
}

test('설정 후 읽어 온 장치와 음량을 반환한다', async t => {
  const expected = { name: '회의실 마이크', volume: 100, muted: false };
  const { url, headers } = await fixture(t, async () => expected);
  const response = await fetch(`${url}/api/microphone/volume`, { method: 'POST', headers });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), expected);
});

test('인증이나 동일 출처 확인에 실패하면 장치를 변경하지 않는다', async t => {
  let calls = 0;
  const { url, headers } = await fixture(t, async () => { calls++; });
  for (const [requestHeaders, expected] of [[{ Origin: url }, 401], [{ ...headers, Origin: 'https://example.com' }, 403]]) {
    const response = await fetch(`${url}/api/microphone/volume`, { method: 'POST', headers: requestHeaders });
    assert.equal(response.status, expected);
    await response.text();
  }
  assert.equal(calls, 0);
});

test('조회 요청으로는 마이크 음량을 변경하지 않는다', async t => {
  let calls = 0;
  const { url, headers } = await fixture(t, async () => { calls++; });
  const response = await fetch(`${url}/api/microphone/volume`, { headers });
  assert.equal(response.status, 404);
  await response.text();
  assert.equal(calls, 0);
});

test('장치 설정 실패는 성공 대신 사용자에게 오류를 반환한다', async t => {
  const { url, headers } = await fixture(t, async () => { throw new Error('마이크가 연결되어 있지 않습니다.'); });
  const response = await fetch(`${url}/api/microphone/volume`, { method: 'POST', headers });
  assert.equal(response.status, 503);
  assert.match((await response.json()).error.message, /마이크가 연결/);
});
