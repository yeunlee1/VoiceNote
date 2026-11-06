// 설치된 Windows 앱의 업데이트를 맡는다. 깃허브 최신 릴리즈를 확인하고, 서명한 목록과 같은 설치파일을 받아 두었다가, 사람이 누르면 조용한 설치로 넘긴다.
'use strict';
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const childProcess = require('node:child_process');
const check = require('./업데이트검증.cjs');

// 설치파일(설치파일.iss)은 /update=1을 받으면 앱이 닫힐 때까지 기다렸다가 설치하고 앱을 다시 켠다.
// 그 뒤에 /DIR(지금 앱 폴더), /LOG, /status(진행 상태 파일), /pids(앱 창·서버 프로세스)를 붙인다.
const INSTALLER_ARGUMENTS = Object.freeze(['/SILENT', '/SUPPRESSMSGBOXES', '/NORESTART', '/update=1']);
const APP_EXE = '프로젝트 회의록.exe';
const FOLDER = 'VoiceNote-업데이트';
const STATUS_FILE = '업데이트상태.txt';
const RELEASE_LIMIT = 2 * 1024 * 1024;
const CHECK_TIMEOUT = 15_000, STALL_TIMEOUT = 60_000, RECHECK_GAP = 10_000, START_TIMEOUT = 15_000;
// 설치파일이 남긴 마지막 상태를 다음 실행 때 사람이 읽을 문장으로 바꾼다.
const RESULTS = {
  installed: (version) => `VoiceNote를 ${version} 버전으로 업데이트했습니다.`,
  restored: (version) => `${version} 버전 업데이트를 설치하지 못해 이전 버전으로 되돌렸습니다. 다시 받아 설치하거나 깃허브에서 직접 받아 설치하세요.`,
  failed: (version) => `${version} 버전 업데이트를 마치지 못했습니다. 앱이 이상하면 깃허브에서 설치파일을 직접 받아 다시 설치하세요.`,
  timeout: (version) => `앱이 닫히지 않아 ${version} 버전 업데이트를 멈췄습니다. 다시 시도하세요.`,
  blocked: (version) => `지난 업데이트에서 되돌리지 못한 파일이 남아 있어 ${version} 버전 자동 설치를 멈췄습니다. 깃허브에서 설치파일을 직접 받아 다시 설치하세요.`,
};
const DIRECT = '깃허브 릴리즈 페이지에서 설치파일을 직접 받아 설치하세요.';
const MESSAGES = {
  UPDATE_UNSUPPORTED: '설치한 VoiceNote에서만 업데이트할 수 있습니다.',
  UPDATE_CHECK_FAILED: '새 버전을 확인하지 못했습니다. 인터넷 연결을 확인한 뒤 다시 확인을 눌러 주세요.',
  UPDATE_RATE_LIMITED: '깃허브 확인 횟수 제한에 걸렸습니다. 잠시 뒤 다시 확인을 눌러 주세요.',
  UPDATE_NOT_AVAILABLE: '받을 새 버전이 없습니다. 다시 확인을 눌러 주세요.',
  UPDATE_DOWNLOAD_FAILED: '설치파일을 받지 못했습니다. 인터넷 연결을 확인한 뒤 다시 받아 주세요.',
  UPDATE_NOT_READY: '설치할 업데이트가 아직 준비되지 않았습니다.',
  UPDATE_LAUNCH_FAILED: `설치파일을 실행하지 못했습니다. 보안 프로그램이 막았는지 확인하거나 ${DIRECT}`,
  UPDATE_LAUNCH_BUSY: '앞서 띄운 설치파일을 정리하는 중입니다. 잠시 뒤 다시 눌러 주세요.',
  UPDATE_CANCEL_STUCK: `업데이트 임시 파일을 지우지 못해 앱에서 바로 설치할 수 없습니다. ${DIRECT}`,
};
// 끝내지 못한 설치파일이 취소 표시를 보고 지울 때까지 기다리는 최대 시간이다. 설치파일은 앱이 켜져 있는 동안 0.25초마다 이 표시를 본다.
const CANCEL_GRACE = 3 * 60 * 1000;

function fail(code, message = MESSAGES[code], status = 409) {
  return Object.assign(new Error(message), { code, status });
}
const reason = (error, fallback) => ({ code: typeof error?.code === 'string' && /^UPDATE_/.test(error.code) ? error.code : fallback, message: typeof error?.code === 'string' && /^UPDATE_/.test(error.code) ? error.message : MESSAGES[fallback] });

// 응답 본문을 정한 크기까지만 읽는다. 더 길면 읽기를 멈추고 실패로 다룬다.
async function readBytes(response, limit) {
  const chunks = [];
  let total = 0;
  for await (const chunk of response.body ?? []) {
    total += chunk.length;
    if (total > limit) throw fail('UPDATE_CHECK_FAILED');
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}
// 리디렉션이 끝난 최종 주소도 HTTPS여야 한다.
function httpsOnly(response, requested, code) {
  const final = response.url || requested;
  if (typeof final !== 'string' || !final.startsWith('https://')) throw fail(code, `안전한 주소(HTTPS)가 아니어서 받지 않았습니다. ${DIRECT}`);
}

// Inno Setup이 설치 폴더에 두는 제거 프로그램이 있어야 설치한 앱으로 본다. 빌드 폴더를 바로 실행한 경우는 제외된다.
const hasUninstaller = (folder) => {
  try { return fs.readdirSync(folder).some((name) => /^unins\d{3}\.exe$/i.test(name)); } catch { return false; }
};

// 설치파일(Inno 로더)은 실제 설치를 자식 프로세스로 띄우고 기다린다. 시작 확인에 실패하면 로더만이 아니라 그 자식까지 함께 끝낸다.
// 끝냈거나(0) 이미 없으면(128) true다. 로더는 자식이 끝나야 끝나므로 로더가 없으면 자식도 없다.
const endProcessTree = (pid) => {
  try {
    const result = childProcess.spawnSync('taskkill', ['/pid', String(pid), '/t', '/f'], { windowsHide: true, stdio: 'ignore', timeout: 10000 });
    return !result.error && (result.status === 0 || result.status === 128);
  } catch { return false; }
};

function createUpdater({ enabled = false, currentVersion, appDir, hostPid = 0, serverPid = process.pid, tempRoot = os.tmpdir(), fetch = globalThis.fetch, spawn = childProcess.spawn, publicKey, now = Date.now, startTimeout = START_TIMEOUT, killTree = endProcessTree } = {}) {
  if (!check.parseVersion(currentVersion)) throw new Error('앱 버전 형식을 확인하세요.');
  // Windows 창이 일반 실행으로 켜 준 경우에만, 그리고 설치 폴더(node.exe 옆)에 실행 파일과 제거 프로그램이 있을 때만 업데이트를 제공한다.
  // 개발용 실행, 시험 서버, 자체 검사(--self-test), 다른 자료 폴더(--data-root)는 제외된다.
  const supported = enabled === true && typeof appDir === 'string' && path.isAbsolute(appDir) && fs.existsSync(path.join(appDir, APP_EXE)) && hasUninstaller(appDir);
  const base = path.join(tempRoot, FOLDER);
  const headers = { 'User-Agent': `VoiceNote/${currentVersion} (Windows)` };
  let state = { status: supported ? 'idle' : 'unsupported', version: null, publishedAt: null, size: null, received: 0, error: null };
  let target = null;
  let job = null;
  let launchJob = null;
  let checkedAt = -Infinity;
  const readStatus = (file) => {
    try { return fs.readFileSync(file, 'latin1').trim().split(/\s+/)[0] || ''; } catch { return ''; }
  };
  const lastResult = supported ? readLastResult() : null;

  const status = () => ({ supported, currentVersion, ...state, error: state.error && { ...state.error }, lastResult: lastResult && { ...lastResult }, pageUrl: check.RELEASE_PAGE });
  const files = (version) => {
    const folder = path.join(base, version);
    return { folder, file: path.join(folder, check.assetNames(version).windows), log: path.join(folder, '설치기록.txt'), status: path.join(folder, STATUS_FILE) };
  };

  // 지난 업데이트가 남긴 결과를 한 번 읽는다. 지금 버전으로 설치를 마쳤으면 성공, 더 높은 버전 폴더에 실패 결과가 있으면 그 이유를 알린다.
  function readLastResult() {
    let names;
    try { names = fs.readdirSync(base).filter((name) => check.parseVersion(name)); } catch { return null; }
    const done = names.find((name) => name === currentVersion && readStatus(path.join(base, name, STATUS_FILE)) === 'installed');
    if (done) return { outcome: 'installed', version: done, message: RESULTS.installed(done) };
    const failed = names.filter((name) => check.compareVersions(name, currentVersion) > 0).sort((a, b) => check.compareVersions(b, a))
      .map((name) => ({ name, outcome: readStatus(path.join(base, name, STATUS_FILE)) })).find((item) => ['restored', 'failed', 'timeout', 'blocked'].includes(item.outcome));
    if (!failed) return null;
    try { fs.rmSync(path.join(base, failed.name, STATUS_FILE), { force: true }); } catch {}
    return { outcome: failed.outcome, version: failed.name, message: RESULTS[failed.outcome](failed.name) };
  }
  const run = (work) => {
    job = work().finally(() => { job = null; });
    return status();
  };

  // 이미 설치한 버전 이하의 받은 폴더는 다시 쓸 일이 없으므로 지운다. 이름이 버전이 아니거나 연결(정션)이면 건드리지 않는다.
  function cleanup() {
    let names;
    try { names = fs.readdirSync(base); } catch { return; }
    for (const name of names) {
      if (!check.parseVersion(name) || check.compareVersions(name, currentVersion) > 0) continue;
      const folder = path.join(base, name);
      try {
        const info = fs.lstatSync(folder);
        if (info.isDirectory() && !info.isSymbolicLink()) fs.rmSync(folder, { recursive: true, force: true });
      } catch {}
    }
  }

  async function runCheck() {
    state = { ...state, status: 'checking', error: null };
    target = null;
    cleanup();
    try {
      const response = await fetch(check.RELEASE_API, { headers: { ...headers, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' }, redirect: 'follow', signal: AbortSignal.timeout(CHECK_TIMEOUT) });
      if (response.status === 404) {
        await response.body?.cancel?.();
        state = { status: 'latest', version: null, publishedAt: null, size: null, received: 0, error: null };
        return;
      }
      if (response.status === 403 || response.status === 429) {
        await response.body?.cancel?.();
        throw fail('UPDATE_RATE_LIMITED');
      }
      if (!response.ok) throw fail('UPDATE_CHECK_FAILED');
      httpsOnly(response, check.RELEASE_API, 'UPDATE_CHECK_FAILED');
      let release;
      try { release = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await readBytes(response, RELEASE_LIMIT))); }
      catch (error) { throw error.code ? error : fail('UPDATE_CHECK_FAILED'); }
      const info = check.readRelease(release, currentVersion);
      if (info.status === 'latest') {
        state = { status: 'latest', version: null, publishedAt: null, size: null, received: 0, error: null };
        return;
      }
      if (info.status === 'manual') {
        state = { status: 'manual', version: info.version, publishedAt: info.publishedAt, size: null, received: 0, error: { code: 'UPDATE_MANUAL', message: info.reason } };
        return;
      }
      const manifestResponse = await fetch(info.manifest.url, { headers: { ...headers, Accept: 'application/octet-stream' }, redirect: 'follow', signal: AbortSignal.timeout(CHECK_TIMEOUT) });
      if (!manifestResponse.ok) throw fail('UPDATE_CHECK_FAILED');
      httpsOnly(manifestResponse, info.manifest.url, 'UPDATE_CHECK_FAILED');
      const bytes = await readBytes(manifestResponse, check.LIMITS.manifest);
      let payload;
      try {
        payload = check.verifyManifest(bytes, { version: info.version, publicKey });
        check.matchAsset(payload.windows, info.windows);
      } catch (error) {
        // 서명·형식이 맞지 않으면 설치파일을 받지 않는다. 사람이 깃허브에서 직접 확인하도록 안내만 남긴다.
        state = { status: 'manual', version: info.version, publishedAt: info.publishedAt, size: null, received: 0, error: reason(error, 'UPDATE_CHECK_FAILED') };
        return;
      }
      target = { version: info.version, url: info.windows.url, size: payload.windows.size, sha256: payload.windows.sha256 };
      state = { status: 'available', version: info.version, publishedAt: info.publishedAt, size: payload.windows.size, received: 0, error: null };
    } catch (error) {
      target = null;
      state = { status: 'unknown', version: null, publishedAt: null, size: null, received: 0, error: reason(error, 'UPDATE_CHECK_FAILED') };
    } finally {
      checkedAt = now();
    }
  }

  async function runDownload() {
    const { version, url, size, sha256 } = target;
    const { folder, file } = files(version);
    const part = `${file}.part`;
    state = { ...state, status: 'downloading', received: 0, error: null };
    const controller = new AbortController();
    let stall = null, handle = null;
    const arm = () => { clearTimeout(stall); stall = setTimeout(() => controller.abort(), STALL_TIMEOUT); };
    try {
      await fs.promises.mkdir(folder, { recursive: true });
      await fs.promises.rm(part, { force: true });
      await fs.promises.rm(file, { force: true });
      arm();
      const response = await fetch(url, { headers: { ...headers, Accept: 'application/octet-stream' }, redirect: 'follow', signal: controller.signal });
      httpsOnly(response, url, 'UPDATE_DOWNLOAD_FAILED');
      if (!response.ok || !response.body) throw fail('UPDATE_DOWNLOAD_FAILED');
      handle = await fs.promises.open(part, 'wx');
      const hash = crypto.createHash('sha256');
      let received = 0;
      for await (const chunk of response.body) {
        arm();
        received += chunk.length;
        if (received > size) throw fail('UPDATE_FILE_MISMATCH', `받은 설치파일이 업데이트 정보보다 깁니다. 다시 받거나 ${DIRECT}`);
        hash.update(chunk);
        await handle.write(chunk);
        state = { ...state, received };
      }
      await handle.close();
      handle = null;
      if (received !== size || hash.digest('hex') !== sha256) throw fail('UPDATE_FILE_MISMATCH', `받은 설치파일이 업데이트 정보와 다릅니다. 다시 받거나 ${DIRECT}`);
      await fs.promises.rename(part, file);
      state = { ...state, status: 'ready', received, error: null };
    } catch (error) {
      if (handle) await handle.close().catch(() => {});
      await fs.promises.rm(part, { force: true }).catch(() => {});
      await fs.promises.rm(file, { force: true }).catch(() => {});
      state = { ...state, status: 'available', received: 0, error: reason(error, 'UPDATE_DOWNLOAD_FAILED') };
    } finally {
      clearTimeout(stall);
    }
  }

  async function runLaunch() {
    const { version, size, sha256 } = target;
    const { file, log, status: statusFile } = files(version);
    // 받은 뒤 설치 사이에 파일이 바뀌지 않았는지 실행 직전에 다시 확인한다.
    try {
      await check.verifyFile(file, { size, sha256 });
    } catch (error) {
      await fs.promises.rm(file, { force: true }).catch(() => {});
      state = { ...state, status: 'available', received: 0, error: reason(error, 'UPDATE_DOWNLOAD_FAILED') };
      throw fail(state.error.code, state.error.message);
    }
    // 설치파일은 '<상태 파일>.cancel'이 있으면 그 표시를 지우고 아무것도 바꾸지 않고 끝난다.
    // 지난 시도의 설치파일을 끝내지 못해 표시가 남아 있으면, 그 설치파일이 표시를 보고 지울 때까지 새로 띄우지 않는다. 두 설치가 겹치지 않게 한다.
    // 오래 남은 표시는 남은 설치파일이 없는 것으로 보고 지운다(가짜 시계를 쓰는 시험과 섞이지 않게 실제 시각으로 잰다).
    const cancelFile = `${statusFile}.cancel`;
    let pending = null;
    try { pending = fs.statSync(cancelFile); } catch {}
    if (pending && Date.now() - pending.mtimeMs < CANCEL_GRACE) throw fail('UPDATE_LAUNCH_BUSY');
    await fs.promises.rm(statusFile, { force: true }).catch(() => {});
    // 오래된 표시를 지우지 못하면 새 설치파일도 그 표시를 보고 멈추고, 실패하며 표시를 새로 남겨 같은 안내가 끝없이 되풀이된다.
    // 그러니 띄우지 않고 직접 설치를 안내한다.
    await fs.promises.rm(cancelFile, { force: true }).catch(() => {});
    if (fs.existsSync(cancelFile)) throw fail('UPDATE_LAUNCH_FAILED', MESSAGES.UPDATE_CANCEL_STUCK);
    let child = null;
    try {
      await new Promise((resolve, reject) => {
        // 앱이 닫힌 뒤에도 설치가 이어지도록 부모와 떨어진 프로세스로 띄운다.
        child = spawn(file, [...INSTALLER_ARGUMENTS, `/DIR=${appDir}`, `/LOG=${log}`, `/status=${statusFile}`, `/pids=${hostPid},${serverPid}`], { detached: true, stdio: 'ignore', windowsHide: false });
        child.once('error', reject);
        child.once('spawn', () => { child.unref(); resolve(); });
      });
      // 설치파일이 스스로 대기 상태를 적어야 앱을 닫게 한다. 로그 파일을 못 만드는 등 초기에 멈추면 앱을 닫지 않는다.
      const deadline = Date.now() + startTimeout;
      for (;;) {
        const current = readStatus(statusFile);
        if (current === 'waiting' || current === 'installing') break;
        if (current) throw new Error(current);
        if (Date.now() >= deadline) throw new Error('start timeout');
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    } catch {
      // 남은 실제 설치가 나중에 앱이 닫힐 때 이어서 설치하지 않도록, 먼저 취소 표시를 남기고 프로세스 묶음 전체를 끝낸다.
      // 묶음을 끝냈으면 남은 설치가 없으므로 표시를 지운다. 끝내지 못했으면 남은 설치파일이 표시를 보고 지울 때까지 둔다.
      try { fs.writeFileSync(cancelFile, 'cancel'); } catch {}
      const ended = child?.pid ? killTree(child.pid) : true;
      try { child?.kill(); } catch {}
      if (ended) { try { fs.rmSync(cancelFile, { force: true }); } catch {} }
      state = { ...state, error: { code: 'UPDATE_LAUNCH_FAILED', message: MESSAGES.UPDATE_LAUNCH_FAILED } };
      throw fail('UPDATE_LAUNCH_FAILED');
    }
    state = { ...state, status: 'launching', error: null };
    return status();
  }

  return {
    status,
    // 설치 시작을 기다리는 중이거나 시작한 뒤에는 서버가 새 AI 요청을 받지 않는다.
    installing: () => Boolean(launchJob) || state.status === 'launching',
    // 화면이 처음 상태를 물을 때 한 번만 확인을 시작한다.
    ensureChecked() {
      if (state.status === 'idle' && !job) return run(runCheck);
      return status();
    },
    async check() {
      if (!supported) return status();
      if (job || launchJob || ['downloading', 'ready', 'launching'].includes(state.status) || now() - checkedAt < RECHECK_GAP) return status();
      return run(runCheck);
    },
    async download() {
      if (!supported) throw fail('UPDATE_UNSUPPORTED');
      if (['downloading', 'ready', 'launching'].includes(state.status)) return status();
      if (state.status !== 'available' || !target || job) throw fail('UPDATE_NOT_AVAILABLE');
      return run(runDownload);
    },
    async launch() {
      if (!supported) throw fail('UPDATE_UNSUPPORTED');
      if (state.status === 'launching') return status();
      if (launchJob) return launchJob;
      if (state.status !== 'ready' || !target || job) throw fail('UPDATE_NOT_READY');
      launchJob = runLaunch().finally(() => { launchJob = null; });
      return launchJob;
    },
    // 시험과 서버가 진행 중인 확인·받기가 끝날 때까지 기다릴 때 쓴다. 실패도 상태로 남기므로 거절하지 않는다.
    async settled() {
      while (job) await job;
      return status();
    },
  };
}

// 업데이트 담당이 없는 서버(개발·시험 실행)가 화면에 돌려줄 상태다.
const unsupportedStatus = (currentVersion) => ({ supported: false, currentVersion, status: 'unsupported', version: null, publishedAt: null, size: null, received: 0, error: null, lastResult: null, pageUrl: check.RELEASE_PAGE });

module.exports = { createUpdater, unsupportedStatus, INSTALLER_ARGUMENTS, APP_EXE, FOLDER, STATUS_FILE };
