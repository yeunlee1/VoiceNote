// 검증 전용 가상기기에서 가짜 OpenAI로 휴대폰 진행 기록·요청 감시·알림 시간을 확인하는 실행기다. 실제 OpenAI·실기기·개인 서명 폴더는 쓰지 않는다.
// 쓰는 법(저장소 루트): node mobile/안드로이드/tests/진행기록기기시험.cjs <검증용 APK> <결과 폴더> [기준 검증용 APK]
// 기준 APK를 주면 먼저 그 APK의 기본 검사·f-mode 통과 수를 재고, 새 APK의 같은 검사와 비교한다. 빌드안내.txt의 검증 전용 가상기기 정션(C:\vn-emu)을 쓴다.
const fs = require('node:fs'), path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { startFakeOpenAI } = require('./가짜OpenAI.cjs');

const [apkArgument, resultArgument, baseArgument] = process.argv.slice(2);
if (!apkArgument || !resultArgument) { console.error('쓰는 법: node mobile/안드로이드/tests/진행기록기기시험.cjs <검증용 APK> <결과 폴더> [기준 검증용 APK]'); process.exit(2); }
const apk = path.resolve(apkArgument), resultDir = path.resolve(resultArgument), baseApk = baseArgument ? path.resolve(baseArgument) : null;
for (const file of [apk, baseApk].filter(Boolean)) if (!fs.existsSync(file)) { console.error(`APK가 없습니다: ${file}`); process.exit(2); }
fs.mkdirSync(resultDir, { recursive: true });
const SDK = 'C:\\vn-emu\\sdk', ADB = path.join(SDK, 'platform-tools', 'adb.exe'), EMULATOR = path.join(SDK, 'emulator', 'emulator.exe');
const PACKAGE = 'kr.local.meetingjournal', DEVICE = 'emulator-5554', RUNNER = `${PACKAGE}/${PACKAGE}.AndroidChecks`;
const log = (...parts) => { const line = `[${new Date().toISOString().slice(11, 19)}] ${parts.join(' ')}`; console.log(line); fs.appendFileSync(path.join(resultDir, '진행.log'), line + '\n'); };
const run = (file, args, options = {}) => {
  const result = spawnSync(file, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: options.timeout || 600000, ...options });
  if (options.check !== false && result.status !== 0) throw new Error(`${path.basename(file)} ${args.slice(0, 4).join(' ')} 실패(${result.status}): ${String(result.stderr || '').slice(-1500)}${String(result.stdout || '').slice(-1500)}`);
  return result;
};
const adb = (args, options) => run(ADB, ['-s', DEVICE, ...args], options);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const capture = name => { fs.writeFileSync(path.join(resultDir, name), adb(['exec-out', 'screencap', '-p'], { encoding: 'buffer' }).stdout); return name; };
const deviceState = () => (run(ADB, ['devices'], { check: false }).stdout || '').split(/\r?\n/).find(line => line.startsWith(DEVICE))?.split(/\s+/)[1] || '';

function launchEmulator(fresh) {
  // 창 없이 띄우고 빠른 부팅 상태는 저장하지 않는다. fresh면 저장된 빠른 부팅 상태를 읽지 않고 새로 부팅한다.
  const args = ['-avd', 'VoiceNotePhone', '-no-window', '-no-metrics', '-no-boot-anim', '-no-snapshot-save', '-no-audio', ...(fresh ? ['-no-snapshot-load'] : [])];
  spawn(EMULATOR, args, { env: { ...process.env, ANDROID_SDK_ROOT: SDK, ANDROID_HOME: SDK }, detached: true, stdio: 'ignore' }).unref();
  log(fresh ? '가상기기를 새로 부팅합니다(창 없음, 빠른 부팅 상태 안 읽음).' : '가상기기를 띄웁니다(창 없음).');
}
async function bootDevice() {
  // 이미 떠 있으면 그대로 쓴다. adb에 offline으로 보이면 빠른 부팅 상태가 깨진 것이라 끄고 새로 부팅한다.
  let started = false, fresh = false;
  if (deviceState() === 'offline') { adb(['emu', 'kill'], { check: false }); await sleep(5000); fresh = true; }
  if (deviceState() !== 'device') { launchEmulator(fresh); started = true; }
  for (let waited = 0; ; waited += 1000) {
    const state = deviceState();
    if (state === 'device' && adb(['shell', 'getprop', 'sys.boot_completed'], { check: false }).stdout?.trim() === '1') break;
    if (state === 'offline' && waited > 60000 && !fresh) { log('adb가 offline이라 새로 부팅합니다.'); adb(['emu', 'kill'], { check: false }); await sleep(5000); launchEmulator(true); fresh = true; started = true; waited = 0; }
    if (waited > 300000) throw new Error('가상기기가 5분 안에 부팅을 마치지 않았습니다.');
    await sleep(1000);
  }
  log('가상기기 준비:', adb(['shell', 'getprop', 'ro.build.version.release']).stdout.trim(), 'API', adb(['shell', 'getprop', 'ro.build.version.sdk']).stdout.trim());
  return started;
}
function installFresh(file) {
  // 새 APK 설치가 실패해도 옛 앱이 남아 시험이 통과해 보일 수 있어, 먼저 지우고 설치 출력의 Success를 확인한다.
  adb(['uninstall', PACKAGE], { check: false });
  const output = adb(['install', file]).stdout || '';
  if (!/\bSuccess\b/.test(output)) throw new Error(`설치가 Success로 끝나지 않았습니다: ${output.trim().slice(-500)}`);
  adb(['shell', 'pm', 'grant', PACKAGE, 'android.permission.POST_NOTIFICATIONS']);
  // 실제 사용자는 첫 회의를 시작할 때 알림 권한을 허용한다. 시험은 그 화면을 거치지 않으므로 설치 직후 주어야 Android 13 이상에서 서비스 알림이 보인다.
  log('설치:', path.basename(file), output.trim().split(/\r?\n/).pop(), '· 알림 권한 줌');
}
function airplaneOn() {
  // 진짜 인터넷에 닿지 않게 비행기 모드를 켠다. adb reverse는 adb 연결로 가므로 가짜 OpenAI에는 그대로 닿는다.
  adb(['shell', 'cmd', 'connectivity', 'airplane-mode', 'enable'], { check: false });
  const on = (adb(['shell', 'settings', 'get', 'global', 'airplane_mode_on'], { check: false }).stdout || '').trim();
  if (on !== '1') throw new Error(`비행기 모드를 켜지 못했습니다(airplane_mode_on=${on}).`);
  log('비행기 모드 켬');
}
function instrument(probe, extras = {}, onMark = null) {
  // 기기 시험 하나를 돌리고 끝 결과(PASS/FAIL)를 돌려준다. 진행 표지(mark)가 오면 onMark로 넘긴다.
  const args = ['-s', DEVICE, 'shell', 'am', 'instrument', '-w', '-r', ...(probe ? ['-e', 'probe', probe] : []), ...Object.entries(extras).flatMap(([key, value]) => ['-e', key, value]), RUNNER];
  return new Promise(resolve => {
    const child = spawn(ADB, args);
    let output = '', pending = '';
    const read = chunk => {
      const text = String(chunk);output += text;pending += text;
      const lines = pending.split(/\r?\n/);pending = lines.pop();
      for (const line of lines) { const match = line.match(/^INSTRUMENTATION_STATUS: mark=(.+)$/); if (match && onMark) onMark(match[1].trim()); }
    };
    child.stdout.on('data', read); child.stderr.on('data', read);
    const timer = setTimeout(() => child.kill(), 900000);
    child.on('exit', code => {
      clearTimeout(timer);
      const name = probe || '기본';fs.writeFileSync(path.join(resultDir, `기기시험-${name}.txt`), output);
      const pass = output.match(/PASS (\d+) ([^\r\n]*)/), fail = output.match(/FAIL ([^\r\n]*)/);
      resolve({ probe: name, code, passed: Boolean(pass) && !fail, count: pass ? Number(pass[1]) : 0, line: (pass || fail || [''])[0], output });
    });
  });
}
function notificationRecord() {
  // 이 앱의 알림 기록만 잘라 돌려준다. 갱신 시각 같은 값으로 알림이 다시 게시됐는지 볼 때 쓴다.
  const lines = (adb(['shell', 'dumpsys', 'notification', '--noredact'], { check: false }).stdout || '').split(/\r?\n/), out = [];
  lines.forEach((line, index) => { if (line.includes('NotificationRecord') && line.includes(PACKAGE)) out.push(...lines.slice(index, index + 45), '----'); });
  return out.join('\n');
}
async function withFake(options, work) {
  // 가짜 OpenAI를 띄워 기기의 같은 포트로 잇고, 끝나면 잇기를 풀고 닫는다.
  const fake = await startFakeOpenAI(options);
  adb(['reverse', `tcp:${fake.port}`, `tcp:${fake.port}`]);
  try { return await work(fake); } finally { adb(['reverse', '--remove', `tcp:${fake.port}`], { check: false }); await fake.close(); }
}
async function baseline(file, label) {
  // 기본 검사와 f-mode(기본 검사에 들지 않음)의 통과 수를 잰다.
  installFresh(file);airplaneOn();
  const main = await instrument(''), mode = await instrument('f-mode');
  log(`${label} 기본 검사:`, main.line, '/ f-mode:', mode.line);
  return { main, mode };
}

async function main() {
  const started = await bootDevice();
  const summary = { apk: path.basename(apk), base: baseApk ? path.basename(baseApk) : null, probes: {}, captures: [] };
  try {
    if (baseApk) summary.baseline = await baseline(baseApk, '기준 APK');
    summary.current = await baseline(apk, '새 APK');
    if (summary.baseline) summary.compare = { mainFailures: !summary.current.main.passed, mainCount: [summary.baseline.main.count, summary.current.main.count], modeCount: [summary.baseline.mode.count, summary.current.mode.count] };

    // 1. 요청 감시·일지·다시 분석·일지 없는 서비스 실패. 전사·회의록 요청은 첫 분석의 한 번씩뿐이어야 한다.
    summary.probes.activity = await withFake({ delayMs: 0 }, async fake => {
      const result = await instrument('activity', { apiUrl: fake.url });
      const counts = { ...fake.counts };
      result.counts = counts;
      result.requestsOk = counts['/v1/audio/transcriptions'] === 1 && counts['/v1/responses'] === 1;
      log('activity:', result.line, '가짜 OpenAI 요청 수', JSON.stringify(counts));
      return result;
    });

    // 2. 화면을 띄운 채 서비스 분석. 3초마다 앱 화면을, 표지마다 알림 화면을 찍는다.
    summary.probes.activityService = await withFake({ delayMs: 8000, transcriptBytesPerSecond: 1048576 }, async fake => {
      const marks = [];let shot = 0, last = 0, done = false;
      summary.marks = [];
      const running = instrument('activityService', { apiUrl: fake.url }, name => { marks.push(name); summary.marks.push(name); log('표지:', name); }).then(result => { done = true; return result; });
      const shade = name => {
        adb(['shell', 'cmd', 'statusbar', 'expand-notifications'], { check: false });
        return sleep(1500).then(() => { summary.captures.push(capture(`알림-${name}.png`)); adb(['shell', 'cmd', 'statusbar', 'collapse'], { check: false }); });
      };
      while (!done) {
        if (marks.length) {
          const name = marks.shift();
          if (name === 'upload') {
            // 올리는 동안 앞뒤 알림 기록을 남겨, 올린 양이 바뀌어도 알림이 다시 게시되지 않았는지(갱신 시각이 같은지) 직접 본다.
            const first = notificationRecord();
            fs.writeFileSync(path.join(resultDir, '알림기록-upload-1.txt'), first);
            await shade(name);await sleep(1000);
            const second = notificationRecord();
            fs.writeFileSync(path.join(resultDir, '알림기록-upload-2.txt'), second);
            const record = text => text.match(/NotificationRecord\((0x[0-9a-f]+)/)?.[1] || null, upload = text => /음성 올리는 중/.test(text);
            summary.uploadNotification = { first: record(first), second: record(second), stillUploading: upload(first) && upload(second), reposted: record(first) !== record(second) };
            log('올리는 동안 알림 기록:', JSON.stringify(summary.uploadNotification));
            // 다시 게시하면 시스템이 새 NotificationRecord를 만들어 번호가 바뀐다. 두 번 모두 올리는 중이고 번호가 같으면 그 사이 다시 게시하지 않은 것이다.
          } else if (name === 'wait-transcript' || name === 'wait-summary') await shade(name);
          // finished 표지는 기기 시험이 끝나는 순간에 와서 기록만 한다. 끝난 화면은 activityFinished의 첫 화면 캡처가 보여 준다.
        } else if (Date.now() - last >= 3000) { last = Date.now(); summary.captures.push(capture(`화면-${String(++shot).padStart(2, '0')}.png`)); }
        await sleep(300);
      }
      const result = await running;
      result.counts = { ...fake.counts };
      log('activityService:', result.line, '가짜 OpenAI 요청 수', JSON.stringify(result.counts));
      return result;
    });

    // 3. 화면 없이 끝난 분석을 처음 연 화면이 첫 조회에 보이는지.
    summary.probes.activityFinished = await withFake({ delayMs: 0 }, async fake => {
      const result = await instrument('activityFinished', { apiUrl: fake.url });
      result.counts = { ...fake.counts };
      summary.captures.push(capture('끝난기록-첫화면.png'));
      log('activityFinished:', result.line, '가짜 OpenAI 요청 수', JSON.stringify(result.counts));
      return result;
    });

    const probesOk = Object.values(summary.probes).every(result => result.passed) && summary.probes.activity.requestsOk;
    const baseOk = !summary.compare || (summary.current.main.passed && summary.current.main.count >= summary.baseline.main.count && summary.current.mode.passed);
    summary.passed = probesOk && baseOk && summary.current.main.passed && summary.current.mode.passed;
    log(summary.passed ? '통과' : '실패', JSON.stringify(Object.fromEntries(Object.entries(summary.probes).map(([key, value]) => [key, value.line]))));
    if (!summary.passed) process.exitCode = 1;
  } finally {
    adb(['reverse', '--remove-all'], { check: false });
    for (const result of [summary.baseline?.main, summary.baseline?.mode, summary.current?.main, summary.current?.mode, ...Object.values(summary.probes)]) if (result) delete result.output;
    fs.writeFileSync(path.join(resultDir, '결과.json'), JSON.stringify(summary, null, 2));
    if (started) { adb(['emu', 'kill'], { check: false }); log('띄운 가상기기를 껐습니다.'); }
  }
}

main().catch(error => { log('오류:', error.message); process.exitCode = 1; });
