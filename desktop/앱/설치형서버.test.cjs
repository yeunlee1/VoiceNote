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
  const flag = path.join(root, '쓰는중.flag'), ack = path.join(root, '확인함.flag');
  fs.writeFileSync(hook, [
    "const fs = require('node:fs');",
    "const target = process.argv[process.argv.indexOf('--ready-file') + 1];",
    `const flag = ${JSON.stringify(flag)}, ack = ${JSON.stringify(ack)};`,
    "const isTemp = name => name.startsWith(target + '.') && name.endsWith('.tmp');",
    'const temps = new Set(), open = fs.openSync, write = fs.writeFileSync;',
    'fs.openSync = function (file, ...rest) { const fd = open.call(fs, file, ...rest); if (isTemp(String(file))) temps.add(fd); return fd; };',
    'fs.writeFileSync = function (file, data, options) {',
    "  if (typeof file === 'number' ? temps.has(file) : isTemp(String(file))) {",
    "    write.call(fs, flag, '1');",
    '    for (const until = Date.now() + 10000; !fs.existsSync(ack) && Date.now() < until;);',
    "  } else if (typeof file !== 'number' && String(file) === target) {",
    "    fs.closeSync(open.call(fs, file, 'wx'));",
    '    for (const until = Date.now() + 1000; Date.now() < until;);',
    "    return write.call(fs, file, data, { ...(options && typeof options === 'object' ? options : {}), flag: 'w' });",
    '  }',
    '  return write.apply(fs, arguments);',
    '};',
  ].join('\n'));
  // 준비 파일 이름으로 바로 쓰면 빈 파일부터 만들고 1초 뒤에 내용을 쓰게 해, 바쁜 PC에서 생긴 빈 준비 파일을 매번 재현한다.
  // 임시 파일에 쓸 때는 쓰는중 표시를 남기고 시험이 확인함 표시를 남길 때까지 멈춰, 그동안 준비 파일 이름이 보이지 않는지 본다.
  const readyFile = path.join(root, 'ready.json');
  const child = spawn(process.execPath, ['--require', hook, path.join(__dirname, '설치형서버.cjs'), '--data-root', root, '--ready-file', readyFile, '--parent-pid', String(process.pid)], { windowsHide: true });
  try {
    let flagSeen = false;
    for (const started = Date.now(); !fs.existsSync(readyFile); await new Promise(resolve => setImmediate(resolve))) {
      if (!flagSeen && fs.existsSync(flag)) {
        flagSeen = true;
        assert.equal(fs.existsSync(readyFile), false, '임시 파일을 쓰는 동안 준비 파일 이름이 보임');
        fs.writeFileSync(ack, '1');
      }
      if (child.exitCode !== null || Date.now() - started > 15000) throw new Error('준비 파일이 생기지 않음');
    }
    const ready = JSON.parse(fs.readFileSync(readyFile, 'utf8'));
    assert.equal(flagSeen, true, '임시 파일에 먼저 다 쓰지 않음');
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
function serverWith(hookLines, root, readyFile) {
  // 훅을 먼저 불러온 설치형 서버를 띄운다. 훅은 준비 파일을 내놓는 순간의 경합을 흉내 낸다.
  const hook = path.join(root, '경합.cjs');
  fs.writeFileSync(hook, hookLines.join('\n'));
  return spawn(process.execPath, ['--require', hook, path.join(__dirname, '설치형서버.cjs'), '--data-root', root, '--ready-file', readyFile, '--parent-pid', String(process.pid)], { windowsHide: true });
}
const tempLeft = (root, readyFile) => fs.readdirSync(root).filter(name => name.startsWith(`${path.basename(readyFile)}.`) && name.endsWith('.tmp'));
const exitWithin = (child, ms) => Promise.race([once(child, 'exit'), new Promise(resolve => setTimeout(() => resolve(['시간 초과']), ms))]);
test('준비 파일을 내놓기 직전에 같은 이름이 생기면 덮지 않고 서버를 끝낸다', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'meeting-ready-'));
  const readyFile = path.join(root, 'ready.json');
  const child = serverWith([
    "const fs = require('node:fs');",
    "const target = process.argv[process.argv.indexOf('--ready-file') + 1];",
    "for (const name of ['renameSync', 'linkSync', 'copyFileSync']) {",
    '  const original = fs[name];',
    '  fs[name] = function (from, to, ...rest) {',
    "    if (String(to) === target && !fs.existsSync(target)) fs.writeFileSync(target, '기존');",
    '    return original.call(fs, from, to, ...rest);',
    '  };',
    '}',
  ], root, readyFile);
  try {
    const [code] = await exitWithin(child, 8000);
    assert.equal(code, 0, '서버가 준비 파일을 덮지 않고 끝나야 함');
    assert.equal(fs.readFileSync(readyFile, 'utf8'), '기존');
    assert.deepEqual(tempLeft(root, readyFile), []);
  } finally {
    if (child.exitCode === null) { child.kill(); await gone(child.pid, 5000); }
    fs.rmSync(root, { recursive: true, force: true });
  }
});
test('링크를 만들 수 없는 드라이브에서도 준비 파일을 내놓고 임시 파일을 남기지 않는다', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'meeting-ready-'));
  const readyFile = path.join(root, 'ready.json');
  const child = serverWith([
    "const fs = require('node:fs');",
    "const target = process.argv[process.argv.indexOf('--ready-file') + 1];",
    "fs.linkSync = function () { const error = new Error('링크 없음'); error.code = 'EPERM'; throw error; };",
    'const open = fs.openSync, write = fs.writeFileSync;',
    'fs.writeFileSync = function (file, data, options) {',
    "  if (typeof file !== 'number' && String(file) === target) {",
    "    fs.closeSync(open.call(fs, file, 'wx'));",
    '    for (const until = Date.now() + 1000; Date.now() < until;);',
    "    return write.call(fs, file, data, { ...(options && typeof options === 'object' ? options : {}), flag: 'w' });",
    '  }',
    '  return write.apply(fs, arguments);',
    '};',
  ], root, readyFile);
  // 대체 경로가 준비 파일 이름에 바로 쓰면 빈 파일부터 보이게 해, 그 경로에서도 빈 준비 파일이 보이지 않는지 본다.
  try {
    for (const started = Date.now(); !fs.existsSync(readyFile); await new Promise(resolve => setImmediate(resolve)))
      if (child.exitCode !== null || Date.now() - started > 15000) throw new Error('준비 파일이 생기지 않음');
    assert.equal(JSON.parse(fs.readFileSync(readyFile, 'utf8')).pid, child.pid);
    for (const until = Date.now() + 2000; tempLeft(root, readyFile).length && Date.now() < until; await new Promise(resolve => setTimeout(resolve, 20)));
    assert.deepEqual(tempLeft(root, readyFile), []);
    assert.equal(child.exitCode, null, '서버는 계속 돌아야 함');
  } finally {
    if (child.exitCode === null) { child.kill(); await gone(child.pid, 5000); }
    fs.rmSync(root, { recursive: true, force: true });
  }
});
test('링크를 만들 수 없는 드라이브에서도 먼저 있던 준비 파일은 덮지 않고 서버를 끝낸다', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'meeting-ready-'));
  const readyFile = path.join(root, 'ready.json');
  const child = serverWith([
    "const fs = require('node:fs');",
    "const target = process.argv[process.argv.indexOf('--ready-file') + 1];",
    "fs.linkSync = function () { const error = new Error('링크 없음'); error.code = 'EPERM'; throw error; };",
    'const open = fs.openSync;',
    "fs.openSync = function (file, ...rest) { if (String(file).startsWith(target + '.') && !fs.existsSync(target)) fs.writeFileSync(target, '기존'); return open.call(fs, file, ...rest); };",
  ], root, readyFile);
  try {
    const [code] = await exitWithin(child, 8000);
    assert.equal(code, 0, '서버가 준비 파일을 덮지 않고 끝나야 함');
    assert.equal(fs.readFileSync(readyFile, 'utf8'), '기존');
    assert.deepEqual(tempLeft(root, readyFile), []);
  } finally {
    if (child.exitCode === null) { child.kill(); await gone(child.pid, 5000); }
    fs.rmSync(root, { recursive: true, force: true });
  }
});
test('이미 있던 임시 파일은 지우지 않고 서버를 끝낸다', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'meeting-ready-'));
  const readyFile = path.join(root, 'ready.json');
  const child = serverWith([
    "const fs = require('node:fs');",
    "const target = process.argv[process.argv.indexOf('--ready-file') + 1];",
    "const isTemp = name => name.startsWith(target + '.') && name.endsWith('.tmp');",
    'const open = fs.openSync, write = fs.writeFileSync;',
    "const plant = name => { if (isTemp(name) && !fs.existsSync(name)) write.call(fs, name, '남의 임시'); };",
    'fs.openSync = function (file, ...rest) { plant(String(file)); return open.call(fs, file, ...rest); };',
    "fs.writeFileSync = function (file, ...rest) { if (typeof file !== 'number') plant(String(file)); return write.call(fs, file, ...rest); };",
  ], root, readyFile);
  try {
    const [code] = await exitWithin(child, 8000);
    assert.equal(code, 0, '서버가 실패를 알리고 끝나야 함');
    assert.deepEqual(tempLeft(root, readyFile).map(name => fs.readFileSync(path.join(root, name), 'utf8')), ['남의 임시']);
    assert.equal(fs.existsSync(readyFile), false);
  } finally {
    if (child.exitCode === null) { child.kill(); await gone(child.pid, 5000); }
    fs.rmSync(root, { recursive: true, force: true });
  }
});
test('임시 파일을 만든 뒤 쓰기에 실패하면 그 임시 파일을 지우고 서버를 끝낸다', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'meeting-ready-'));
  const readyFile = path.join(root, 'ready.json');
  const child = serverWith([
    "const fs = require('node:fs');",
    "const target = process.argv[process.argv.indexOf('--ready-file') + 1];",
    "const isTemp = name => name.startsWith(target + '.') && name.endsWith('.tmp');",
    'const temps = new Set(), open = fs.openSync, write = fs.writeFileSync, writeSync = fs.writeSync;',
    "const full = () => Object.assign(new Error('디스크 공간 없음'), { code: 'ENOSPC' });",
    'fs.openSync = function (file, ...rest) { const fd = open.call(fs, file, ...rest); if (isTemp(String(file))) temps.add(fd); return fd; };',
    "fs.writeSync = function (fd, ...rest) { if (temps.has(fd)) { writeSync.call(fs, fd, '{'); throw full(); } return writeSync.call(fs, fd, ...rest); };",
    'fs.writeFileSync = function (file, ...rest) {',
    "  if (typeof file === 'number' ? temps.has(file) : isTemp(String(file))) {",
    "    if (typeof file === 'number') writeSync.call(fs, file, '{'); else write.call(fs, file, '{');",
    '    throw full();',
    '  }',
    '  return write.call(fs, file, ...rest);',
    '};',
  ], root, readyFile);
  // 임시 파일에 한 글자를 쓴 뒤 디스크가 꽉 찬 것처럼 실패시켜, 덜 쓴 임시 파일이 남지 않는지 본다.
  try {
    const [code] = await exitWithin(child, 8000);
    assert.equal(code, 0, '서버가 실패를 알리고 끝나야 함');
    assert.deepEqual(tempLeft(root, readyFile), []);
    assert.equal(fs.existsSync(readyFile), false);
  } finally {
    if (child.exitCode === null) { child.kill(); await gone(child.pid, 5000); }
    fs.rmSync(root, { recursive: true, force: true });
  }
});
