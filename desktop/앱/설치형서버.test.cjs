// 설치형 서버의 사용자별 자료 보존과 안전한 종료를 검증한다.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { randomUUID } = require('node:crypto');

async function start(root, extra = [], script = path.join(__dirname, '설치형서버.cjs')) {
  const readyFile = path.join(root, `ready-${Date.now()}.json`);
  const child = spawn(process.execPath, [script, '--data-root', root, '--ready-file', readyFile, '--parent-pid', String(process.pid), ...extra], { windowsHide: true });
  let stderr = '';
  child.stderr.on('data', data => stderr += data);
  try {
    for (let count = 0; count < 100; count++) {
      const ready = readReady(readyFile);
      if (ready) {
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
    throw new Error('서버 시작 시간 초과');
  } catch (error) {
    child.kill();
    // 준비를 확인하지 못하면 띄운 서버를 끈다. 남은 서버가 시험 파일 프로세스를 붙잡아 전체 시험이 멈추지 않게 한다.
    throw error;
  }
}
function readReady(file) {
  // 준비 파일이 아직 없거나 덜 쓰였으면 null을 돌려 다음 차례에 다시 읽게 한다.
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
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
test('업데이트 표시를 받아도 설치 폴더가 아니면(개발용 Node 실행) 업데이트를 제공하지 않는다', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'meeting-updates-'));
  let server;
  try {
    for (const extra of [[], ['--app-updates']]) {
      server = await start(root, extra);
      const { update } = await server.api('/api/update');
      assert.equal(update.status, 'unsupported', extra.join(' '));
      assert.equal(update.supported, false);
      assert.equal(update.currentVersion, require('./앱버전.cjs').APP_VERSION);
      await stop(server);
    }
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
async function gone(pid, ms) {
  // 그 프로세스가 끝날 때까지 기다려 끝났으면 true를 돌려준다.
  for (const until = Date.now() + ms; Date.now() < until; await new Promise(resolve => setTimeout(resolve, 50))) {
    try { process.kill(pid, 0); } catch { return true; }
  }
  return false;
}
test('준비 파일은 쓰기가 느려도 다 쓴 뒤에만 그 이름으로 보인다', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'meeting-ready-'));
  const hook = path.join(root, '느린쓰기.cjs');
  fs.writeFileSync(hook, [
    "const fs = require('node:fs');",
    "const at = process.argv.indexOf('--ready-file'), target = at > 0 ? process.argv[at + 1] : null;",
    'const write = fs.writeFileSync;',
    'fs.writeFileSync = function (file, data, options) {',
    '  if (target && String(file) === target) {',
    "    fs.closeSync(fs.openSync(file, 'wx'));",
    '    for (const until = Date.now() + 400; Date.now() < until;);',
    "    return write.call(fs, file, data, { ...(options && typeof options === 'object' ? options : {}), flag: 'w' });",
    '  }',
    '  return write.apply(fs, arguments);',
    '};',
  ].join('\n'));
  // 준비 파일 이름으로 바로 쓰면 빈 파일부터 만들고 0.4초 뒤에 내용을 쓰게 해, 바쁜 PC에서 생긴 빈 준비 파일을 매번 재현한다.
  const readyFile = path.join(root, 'ready.json');
  const child = spawn(process.execPath, ['--require', hook, path.join(__dirname, '설치형서버.cjs'), '--data-root', root, '--ready-file', readyFile, '--parent-pid', String(process.pid)], { windowsHide: true });
  try {
    for (const started = Date.now(); !fs.existsSync(readyFile); await new Promise(resolve => setImmediate(resolve)))
      if (child.exitCode !== null || Date.now() - started > 15000) throw new Error('준비 파일이 생기지 않음');
    const ready = JSON.parse(fs.readFileSync(readyFile, 'utf8'));
    assert.match(ready.url, /^http:\/\/127\.0\.0\.1:\d+\/#/);
    assert.equal(ready.pid, child.pid);
  } finally {
    child.kill();
    assert.equal(await gone(child.pid, 5000), true);
    fs.rmSync(root, { recursive: true, force: true });
  }
});
test('시험 도우미는 준비 파일이 처음에 비어 있어도 다 쓰일 때까지 기다린다', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'meeting-ready-'));
  const fake = path.join(root, '늦게쓰는서버.cjs');
  fs.writeFileSync(fake, [
    "const fs = require('node:fs');",
    "const file = process.argv[process.argv.indexOf('--ready-file') + 1];",
    "fs.writeFileSync(file, '');",
    "setTimeout(() => fs.writeFileSync(file, JSON.stringify({ url: 'http://127.0.0.1:9/#' + 'a'.repeat(32), pid: process.pid })), 300);",
    'setTimeout(() => process.exit(0), 8000);',
  ].join('\n'));
  let server;
  try {
    server = await start(root, [], fake);
    assert.equal(JSON.parse(fs.readFileSync(server.readyFile, 'utf8')).pid, server.child.pid);
  } finally {
    if (server) { server.child.kill(); await gone(server.child.pid, 5000); }
    fs.rmSync(root, { recursive: true, force: true });
  }
});
test('시험 도우미는 준비 파일을 끝내 읽지 못하면 띄운 서버를 끄고 실패를 알린다', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'meeting-ready-'));
  const fake = path.join(root, '깨진준비서버.cjs');
  const pidFile = path.join(root, 'pid.txt');
  fs.writeFileSync(fake, [
    "const fs = require('node:fs');",
    `fs.writeFileSync(${JSON.stringify(pidFile)}, String(process.pid));`,
    "fs.writeFileSync(process.argv[process.argv.indexOf('--ready-file') + 1], '{');",
    'setTimeout(() => process.exit(0), 20000);',
  ].join('\n'));
  let pid = 0;
  try {
    const error = await start(root, [], fake).then(() => null, failure => failure);
    pid = Number(fs.readFileSync(pidFile, 'utf8'));
    assert.ok(error, '시작이 실패해야 함');
    assert.equal(await gone(pid, 3000), true, '준비를 확인하지 못한 서버가 남음');
    assert.match(error.message, /서버 시작 시간 초과/);
  } finally {
    if (pid) try { process.kill(pid); } catch {}
    fs.rmSync(root, { recursive: true, force: true });
  }
});
