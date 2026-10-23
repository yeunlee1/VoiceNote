// 설치형 서버의 사용자별 자료 보존과 안전한 종료를 검증한다.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { randomUUID } = require('node:crypto');

async function start(root) {
  const readyFile = path.join(root, `ready-${Date.now()}.json`);
  const child = spawn(process.execPath, [path.join(__dirname, '설치형서버.cjs'), '--data-root', root, '--ready-file', readyFile, '--parent-pid', String(process.pid)], { windowsHide: true });
  let stderr = '';
  child.stderr.on('data', data => stderr += data);
  for (let count = 0; count < 100; count++) {
    if (fs.existsSync(readyFile)) {
      const ready = JSON.parse(fs.readFileSync(readyFile, 'utf8'));
      const url = new URL(ready.url);
      return { child, readyFile, async api(route, body) {
        const response = await fetch(url.origin + route, { method: body ? 'POST' : 'GET', headers: { 'X-Meeting-Token': url.hash.slice(1), Origin: url.origin, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
        assert.equal(response.status, 200);
        return response.json();
      } };
    }
    if (child.exitCode !== null) throw new Error(stderr || `server exit ${child.exitCode}`);
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  child.kill();
  throw new Error('서버 시작 시간 초과');
}
async function stop(server) {
  const exited = once(server.child, 'exit');
  await server.api('/api/shutdown', {});
  await exited;
  assert.equal(fs.existsSync(server.readyFile), false);
}
test('설치 위치 밖에 회의 기록과 키를 저장하고 재실행 후 보존한다', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'meeting-desktop-'));
  let server;
  try {
    server = await start(root);
    assert.deepEqual((await server.api('/api/meetings')).meetings, []);
    const record = { id: randomUUID(), title: '설치본 시험', date: '2026-10-23', participants: '', transcript: '발언',
      minutes: { overview: '요약', topics: [], decisions: [], actions: [], openQuestions: [] } };
    await server.api('/api/meetings/main', record);
    await server.api('/api/key', { apiKey: 'test-only-no-network', persist: true });
    await stop(server);
    server = await start(root);
    assert.equal((await server.api('/api/meetings')).meetings[0].title, '설치본 시험');
    assert.equal((await server.api('/api/config')).keySaved, true);
    assert.ok(fs.existsSync(path.join(root, '회의자료', '회의기록', `회의-${record.id}.json`)));
    await stop(server);
  } finally {
    if (server && server.child.exitCode === null) server.child.kill();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
test('부모 프로그램이 없으면 서버를 남기지 않고 종료한다', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'meeting-parent-'));
  try {
    const child = spawn(process.execPath, [path.join(__dirname, '설치형서버.cjs'), '--data-root', root, '--ready-file', path.join(root, 'ready.json'), '--parent-pid', '2147483647'], { windowsHide: true });
    const timer = setTimeout(() => child.kill(), 7000);
    const [code] = await once(child, 'exit');
    clearTimeout(timer);
    assert.equal(code, 0);
    assert.equal(fs.existsSync(path.join(root, 'ready.json')), false);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
