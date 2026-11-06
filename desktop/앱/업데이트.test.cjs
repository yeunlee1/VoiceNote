// Windows 앱 업데이트의 확인·받기·설치 시작 흐름이 상태를 올바르게 바꾸고, 실패·중복 요청·설치 직전 변조를 안전하게 다루는지 검증한다.
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const check = require('./업데이트검증.cjs');
const { createUpdater, INSTALLER_ARGUMENTS } = require('./업데이트.cjs');

const keys = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const sha = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const INSTALLER = Buffer.from('fake installer bytes for VoiceNote 1.5.1');

function signedManifest(version, installer = INSTALLER, signer = keys.privateKey) {
  const payload = JSON.stringify({ app: 'VoiceNote', format: 1, version,
    windows: { name: `VoiceNote-${version}-Windows-Setup.exe`, size: installer.length, sha256: sha(installer) },
    android: { name: `VoiceNote-${version}-Android.apk`, size: 5, sha256: sha('apk'), versionCode: 8 } });
  return Buffer.from(JSON.stringify({ format: 1, algorithm: 'SHA256withRSA', payload, signature: crypto.sign('sha256', Buffer.from(payload), signer).toString('base64') }));
}
function releaseFor(version, installer = INSTALLER) {
  const names = check.assetNames(version);
  const asset = (name, size, digest = null) => ({ name, size, digest, state: 'uploaded', browser_download_url: check.assetUrl(version, name) });
  return { tag_name: `v${version}`, draft: false, prerelease: false, published_at: '2026-11-20T01:00:00Z',
    assets: [asset(names.windows, installer.length, `sha256:${sha(installer)}`), asset(names.android, 5), asset(names.manifest, signedManifest(version, installer).length)] };
}

// 깃허브 응답을 흉내 낸다. 내려받기는 최종 주소(리디렉션 뒤)를 url로 돌려준다.
function github({ release = releaseFor('1.5.1'), manifest = signedManifest('1.5.1'), installer = INSTALLER, apiStatus = 200, apiError = null, finalUrl = 'https://release-assets.githubusercontent.com/x', installerUrl = finalUrl, body = null } = {}) {
  const calls = [];
  const respond = (content, url, status = 200) => {
    const response = new Response(content, { status });
    Object.defineProperty(response, 'url', { value: url });
    return response;
  };
  const fetch = async (url, options = {}) => {
    calls.push({ url, options });
    if (url === check.RELEASE_API) {
      if (apiError) throw apiError;
      return respond(JSON.stringify(release), url, apiStatus);
    }
    if (url.endsWith('-update.json')) return respond(manifest, finalUrl);
    if (url.endsWith('-Windows-Setup.exe')) return respond(body ? body() : installer, installerUrl);
    return respond('', url, 404);
  };
  return { fetch, calls, count: (pattern) => calls.filter((call) => pattern.test(call.url)).length };
}

// 설치파일 실행을 흉내 낸다. 진짜 설치파일처럼 /status= 파일에 waiting을 적거나(기본), 아무것도 적지 않거나, 실행 자체가 실패한다.
function launcher(outcome = 'spawn') {
  const calls = [];
  const spawn = (file, args, options) => {
    const child = new EventEmitter();
    child.unref = () => { child.unreferenced = true; };
    child.kill = () => { child.killed = true; return true; };
    calls.push({ file, args, options, child });
    setImmediate(() => {
      if (outcome === 'error') return child.emit('error', Object.assign(new Error('blocked'), { code: 'EACCES' }));
      child.emit('spawn');
      const status = args.find((arg) => arg.startsWith('/status='))?.slice('/status='.length);
      if (outcome === 'spawn' && status) setTimeout(() => fs.writeFileSync(status, 'waiting'), 30);
    });
    return child;
  };
  return { spawn, calls };
}

function fixture(t, { current = '1.5.0', installed = true, enabled = true, uninstaller = true, site = github(), start = launcher(), clock, before } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vn-updater-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const appDir = path.join(root, '앱');
  fs.mkdirSync(appDir);
  if (installed) fs.writeFileSync(path.join(appDir, '프로젝트 회의록.exe'), 'exe');
  if (uninstaller) fs.writeFileSync(path.join(appDir, 'unins000.exe'), 'uninstall');
  const tempRoot = path.join(root, '임시');
  fs.mkdirSync(tempRoot);
  before?.(path.join(tempRoot, 'VoiceNote-업데이트'));
  let now = 1_000_000;
  const updater = createUpdater({ enabled, currentVersion: current, appDir, hostPid: 4321, serverPid: 8765, startTimeout: 400, tempRoot, fetch: site.fetch, spawn: start.spawn, publicKey: keys.publicKey, now: clock || (() => now) });
  return { updater, site, start, root, appDir, tempRoot, advance: (ms) => { now += ms; } };
}

test('설치본에서 켜 둔 경우가 아니면 업데이트를 제공하지 않고 깃허브에 묻지 않는다', async (t) => {
  for (const options of [{ installed: false }, { enabled: false }, { uninstaller: false }]) {
    const { updater, site } = fixture(t, options);
    assert.equal(updater.ensureChecked().status, 'unsupported', JSON.stringify(options));
    await updater.check();
    await updater.settled();
    assert.equal(updater.status().supported, false);
    assert.equal(updater.status().currentVersion, '1.5.0');
    assert.equal(site.calls.length, 0);
    await assert.rejects(updater.download(), (error) => error.code === 'UPDATE_UNSUPPORTED');
    await assert.rejects(updater.launch(), (error) => error.code === 'UPDATE_UNSUPPORTED');
    assert.equal(updater.installing(), false);
  }
});

test('처음 조회 때 한 번만 확인하고 새 버전과 게시일을 알린다', async (t) => {
  const { updater, site } = fixture(t);
  assert.equal(updater.ensureChecked().status, 'checking');
  assert.equal(updater.ensureChecked().status, 'checking');
  await updater.settled();
  const status = updater.status();
  assert.equal(status.status, 'available');
  assert.equal(status.version, '1.5.1');
  assert.equal(status.publishedAt, '2026-11-20T01:00:00Z');
  assert.equal(status.size, INSTALLER.length);
  assert.equal(status.pageUrl, check.RELEASE_PAGE);
  assert.equal(site.count(/api\.github\.com/), 1);
  const api = site.calls.find((call) => call.url === check.RELEASE_API);
  assert.equal(api.options.headers.Accept, 'application/vnd.github+json');
  assert.match(api.options.headers['User-Agent'], /^VoiceNote\/1\.5\.0/);
  assert.ok(api.options.signal, '시간 제한이 있어야 합니다');
  // 다시 조회해도 확인을 반복하지 않는다.
  updater.ensureChecked();
  await updater.settled();
  assert.equal(site.count(/api\.github\.com/), 1);
});

test('지금 버전이 최신이거나 릴리즈가 없으면 최신으로 둔다', async (t) => {
  const same = fixture(t, { site: github({ release: releaseFor('1.5.0') }) });
  same.updater.ensureChecked();
  await same.updater.settled();
  assert.equal(same.updater.status().status, 'latest');
  const none = fixture(t, { site: github({ apiStatus: 404 }) });
  none.updater.ensureChecked();
  await none.updater.settled();
  assert.equal(none.updater.status().status, 'latest');
});

test('인터넷·횟수 제한·형식 오류는 확인 못 함으로 두고 고칠 방법을 문장으로 남긴다', async (t) => {
  const offline = fixture(t, { site: github({ apiError: new TypeError('fetch failed') }) });
  offline.updater.ensureChecked();
  await offline.updater.settled();
  assert.equal(offline.updater.status().status, 'unknown');
  assert.match(offline.updater.status().error.message, /인터넷/);
  const limited = fixture(t, { site: github({ apiStatus: 403 }) });
  limited.updater.ensureChecked();
  await limited.updater.settled();
  assert.equal(limited.updater.status().error.code, 'UPDATE_RATE_LIMITED');
  assert.match(limited.updater.status().error.message, /잠시 뒤/);
  const broken = fixture(t, { site: github({ release: { tag_name: 'v1.5' } }) });
  broken.updater.ensureChecked();
  await broken.updater.settled();
  assert.equal(broken.updater.status().status, 'unknown');
});

test('서명이 맞지 않는 목록이면 자동 설치를 멈추고 직접 받기로 안내한다', async (t) => {
  const other = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const { updater, site } = fixture(t, { site: github({ manifest: signedManifest('1.5.1', INSTALLER, other.privateKey) }) });
  updater.ensureChecked();
  await updater.settled();
  assert.equal(updater.status().status, 'manual');
  assert.equal(updater.status().version, '1.5.1');
  assert.equal(updater.status().error.code, 'UPDATE_SIGNATURE_INVALID');
  await assert.rejects(updater.download(), (error) => error.code === 'UPDATE_NOT_AVAILABLE');
  assert.equal(site.count(/Windows-Setup/), 0);
});

test('받기는 한 번만 돌고, 다 받으면 크기·해시를 확인해 설치 준비로 바꾼다', async (t) => {
  let open;
  const gate = new Promise((resolve) => { open = resolve; });
  const site = github({ body: () => new ReadableStream({ async pull(controller) { await gate; controller.enqueue(INSTALLER); controller.close(); } }) });
  const { updater, tempRoot } = fixture(t, { site });
  updater.ensureChecked();
  await updater.settled();
  assert.equal((await updater.download()).status, 'downloading');
  assert.equal((await updater.download()).status, 'downloading');
  open();
  await updater.settled();
  const status = updater.status();
  assert.equal(status.status, 'ready');
  assert.equal(status.received, INSTALLER.length);
  assert.equal(site.count(/Windows-Setup/), 1);
  const file = path.join(tempRoot, 'VoiceNote-업데이트', '1.5.1', 'VoiceNote-1.5.1-Windows-Setup.exe');
  assert.deepEqual(fs.readFileSync(file), INSTALLER);
  assert.equal(fs.existsSync(`${file}.part`), false);
  // 준비된 뒤 다시 받기를 눌러도 새로 받지 않는다.
  assert.equal((await updater.download()).status, 'ready');
  assert.equal(site.count(/Windows-Setup/), 1);
});

test('받은 파일이 목록과 다르거나 더 길거나 HTTPS가 아니면 지우고 다시 받을 수 있게 둔다', async (t) => {
  for (const [name, options] of [
    ['해시 다름', { body: () => Buffer.from(INSTALLER).fill(0x41, 0, 1) }],
    ['더 김', { body: () => Buffer.concat([INSTALLER, Buffer.from('x')]) }],
    ['HTTP', { installerUrl: 'http://release-assets.githubusercontent.com/x' }],
  ]) {
    const { updater, tempRoot } = fixture(t, { site: github(options) });
    updater.ensureChecked();
    await updater.settled();
    await updater.download();
    await updater.settled();
    const status = updater.status();
    assert.equal(status.status, 'available', name);
    assert.ok(status.error && status.error.message, name);
    const folder = path.join(tempRoot, 'VoiceNote-업데이트', '1.5.1');
    assert.deepEqual(fs.existsSync(folder) ? fs.readdirSync(folder).filter((file) => /Setup\.exe/.test(file)) : [], [], name);
  }
});

test('설치 시작은 실행 직전에 해시를 다시 보고, 정해진 인수로 띄운 설치파일이 대기 상태를 알린 뒤에만 시작으로 바꾼다', async (t) => {
  const { updater, start, tempRoot, appDir } = fixture(t);
  updater.ensureChecked();
  await updater.settled();
  await updater.download();
  await updater.settled();
  const first = updater.launch();
  // 기다리는 동안에도 설치 중으로 보아 AI 요청을 막을 수 있어야 한다.
  assert.equal(updater.installing(), true);
  const second = updater.launch();
  assert.equal((await first).status, 'launching');
  assert.equal((await second).status, 'launching');
  assert.equal(start.calls.length, 1);
  const folder = path.join(tempRoot, 'VoiceNote-업데이트', '1.5.1');
  assert.equal(start.calls[0].file, path.join(folder, 'VoiceNote-1.5.1-Windows-Setup.exe'));
  assert.deepEqual(start.calls[0].args, [...INSTALLER_ARGUMENTS, `/DIR=${appDir}`, `/LOG=${path.join(folder, '설치기록.txt')}`, `/status=${path.join(folder, '업데이트상태.txt')}`, '/pids=4321,8765']);
  assert.deepEqual(INSTALLER_ARGUMENTS, ['/SILENT', '/SUPPRESSMSGBOXES', '/NORESTART', '/update=1']);
  assert.equal(start.calls[0].options.detached, true);
  assert.equal(start.calls[0].options.stdio, 'ignore');
  assert.equal(start.calls[0].child.unreferenced, true);
  assert.equal(updater.installing(), true);
  // 시작한 뒤 다시 눌러도 설치파일을 다시 띄우지 않는다.
  assert.equal((await updater.launch()).status, 'launching');
  assert.equal(start.calls.length, 1);
});

test('설치파일이 정한 시간 안에 대기 상태를 알리지 않으면 끝내고 앱을 닫지 않게 실패로 알린다', async (t) => {
  const { updater, start } = fixture(t, { start: launcher('silent') });
  updater.ensureChecked();
  await updater.settled();
  await updater.download();
  await updater.settled();
  await assert.rejects(updater.launch(), (error) => error.code === 'UPDATE_LAUNCH_FAILED');
  assert.equal(start.calls[0].child.killed, true);
  assert.equal(updater.status().status, 'ready');
  assert.equal(updater.installing(), false);
});

test('다음 실행 때 지난 업데이트 결과를 한 번 읽어 알린다', async (t) => {
  const done = fixture(t, { current: '1.5.1', before: (base) => {
    fs.mkdirSync(path.join(base, '1.5.1'), { recursive: true });
    fs.writeFileSync(path.join(base, '1.5.1', '업데이트상태.txt'), 'installed');
  } });
  assert.deepEqual(done.updater.status().lastResult, { outcome: 'installed', version: '1.5.1', message: 'VoiceNote를 1.5.1 버전으로 업데이트했습니다.' });
  const back = fixture(t, { current: '1.5.0', before: (base) => {
    fs.mkdirSync(path.join(base, '1.5.1'), { recursive: true });
    fs.writeFileSync(path.join(base, '1.5.1', '업데이트상태.txt'), 'restored\r\n');
  } });
  assert.equal(back.updater.status().lastResult.outcome, 'restored');
  assert.match(back.updater.status().lastResult.message, /이전 버전/);
  // 같은 결과를 다음 실행에 다시 알리지 않도록 결과 파일을 지운다.
  assert.equal(fs.existsSync(path.join(back.tempRoot, 'VoiceNote-업데이트', '1.5.1', '업데이트상태.txt')), false);
  const none = fixture(t);
  assert.equal(none.updater.status().lastResult, null);
  // 지난 업데이트가 다 되돌리지 못한 파일이 남아 자동 설치를 멈췄으면 직접 다시 설치하라고 알린다.
  const blocked = fixture(t, { current: '1.5.0', before: (base) => {
    fs.mkdirSync(path.join(base, '1.5.1'), { recursive: true });
    fs.writeFileSync(path.join(base, '1.5.1', '업데이트상태.txt'), 'blocked');
  } });
  assert.equal(blocked.updater.status().lastResult.outcome, 'blocked');
  assert.match(blocked.updater.status().lastResult.message, /직접 받아 다시 설치/);
});

test('받은 뒤 파일이 바뀌었으면 설치파일을 띄우지 않는다', async (t) => {
  const { updater, start, tempRoot } = fixture(t);
  updater.ensureChecked();
  await updater.settled();
  await updater.download();
  await updater.settled();
  fs.writeFileSync(path.join(tempRoot, 'VoiceNote-업데이트', '1.5.1', 'VoiceNote-1.5.1-Windows-Setup.exe'), Buffer.from(INSTALLER).fill(0x42, 0, 1));
  await assert.rejects(updater.launch(), (error) => error.code === 'UPDATE_FILE_MISMATCH');
  assert.equal(start.calls.length, 0);
  assert.equal(updater.status().status, 'available');
});

test('설치파일을 띄우지 못하면 준비 상태로 두고 이유를 알린다', async (t) => {
  const { updater } = fixture(t, { start: launcher('error') });
  updater.ensureChecked();
  await updater.settled();
  await updater.download();
  await updater.settled();
  await assert.rejects(updater.launch(), (error) => error.code === 'UPDATE_LAUNCH_FAILED');
  assert.equal(updater.status().status, 'ready');
  assert.match(updater.status().error.message, /설치파일/);
  assert.equal(updater.installing(), false);
});

test('준비 전에는 설치를 시작할 수 없다', async (t) => {
  const { updater, start } = fixture(t);
  updater.ensureChecked();
  await updater.settled();
  await assert.rejects(updater.launch(), (error) => error.code === 'UPDATE_NOT_READY');
  assert.equal(start.calls.length, 0);
});

test('다시 확인은 10초 안에 반복하지 않고, 받는 중·준비됨에서는 대상 버전을 바꾸지 않는다', async (t) => {
  const { updater, site, advance } = fixture(t);
  updater.ensureChecked();
  await updater.settled();
  await updater.check();
  await updater.settled();
  assert.equal(site.count(/api\.github\.com/), 1);
  advance(11_000);
  await updater.check();
  await updater.settled();
  assert.equal(site.count(/api\.github\.com/), 2);
  await updater.download();
  await updater.settled();
  advance(11_000);
  assert.equal((await updater.check()).status, 'ready');
  await updater.settled();
  assert.equal(site.count(/api\.github\.com/), 2);
});

test('확인할 때 이미 설치한 버전 이하의 받은 폴더만 지운다', async (t) => {
  const { updater, tempRoot } = fixture(t);
  const base = path.join(tempRoot, 'VoiceNote-업데이트');
  for (const name of ['1.4.0', '1.5.0', '1.5.1', '메모']) fs.mkdirSync(path.join(base, name), { recursive: true });
  fs.writeFileSync(path.join(base, '1.4.0', 'VoiceNote-1.4.0-Windows-Setup.exe'), 'old');
  updater.ensureChecked();
  await updater.settled();
  assert.deepEqual(fs.readdirSync(base).sort(), ['1.5.1', '메모']);
});
