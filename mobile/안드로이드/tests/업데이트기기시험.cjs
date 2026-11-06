// 검증 전용 가상기기에서 지금 버전이 앱 안 업데이트로 다음 버전(versionCode 하나 위)이 되는지 끝까지 본다.
// 버리는 서명으로 두 APK와 업데이트 목록을 만들고, 기기 시험(probe u-e2e)이 확인·받기·설치 세션·시스템 설치 화면까지 진행하면
// 사람 대신 '업데이트'를 누른 뒤 versionCode로 판정한다. 실기기와 개인 서명 폴더는 쓰지 않는다.
// 쓰는 법(저장소 루트): node mobile/안드로이드/tests/업데이트기기시험.cjs . <결과 폴더>. 빌드안내.txt의 검증 전용 가상기기 정션(C:\vn-emu)을 쓴다.
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), crypto = require('node:crypto');
const { spawn, spawnSync } = require('node:child_process');
const [rootArgument, resultArgument] = process.argv.slice(2);
if (!rootArgument || !resultArgument) { console.error('쓰는 법: node mobile/안드로이드/tests/업데이트기기시험.cjs <저장소 루트> <결과 폴더>'); process.exit(2); }
const worktree = path.resolve(rootArgument), resultDir = path.resolve(resultArgument);
fs.mkdirSync(resultDir, { recursive: true });
process.env.VOICENOTE_TOOLS = process.env.VOICENOTE_TOOLS || 'C:/DEV/VoiceNote/2026-09-30-회의록도구-안드로이드';
const tools = require(path.join(worktree, 'mobile', '안드로이드', 'tests', '자바도구.cjs'));
const SDK = 'C:\\vn-emu\\sdk', ADB = path.join(SDK, 'platform-tools', 'adb.exe'), EMULATOR = path.join(SDK, 'emulator', 'emulator.exe');
const PACKAGE = 'kr.local.meetingjournal', DEVICE = 'emulator-5554';
// 다음 버전은 지금 AndroidManifest의 버전에서 마지막 자리와 versionCode를 하나씩 올린 값이다.
const current = fs.readFileSync(path.join(worktree, 'mobile', '안드로이드', 'AndroidManifest.xml'), 'utf8').match(/android:versionCode="(\d+)" android:versionName="(\d+)\.(\d+)\.(\d+)"/);
if (!current) { console.error('AndroidManifest.xml에서 버전을 읽지 못했습니다.'); process.exit(2); }
const NEXT_CODE = Number(current[1]) + 1, NEXT = `${current[2]}.${current[3]}.${Number(current[4]) + 1}`;
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'vn-e2e-'));
const log = (...parts) => { const line = `[${new Date().toISOString().slice(11, 19)}] ${parts.join(' ')}`; console.log(line); fs.appendFileSync(path.join(resultDir, '진행.log'), line + '\n'); };
const run = (file, args, options = {}) => {
  const result = spawnSync(file, args, { encoding: options.input ? undefined : 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: options.timeout || 600000, ...options });
  if (options.check !== false && result.status !== 0) throw new Error(`${path.basename(file)} ${args.slice(0, 4).join(' ')} 실패(${result.status}): ${String(result.stderr || '').slice(-1500)}${String(result.stdout || '').slice(-1500)}`);
  return result;
};
const adb = (args, options) => run(ADB, ['-s', DEVICE, ...args], options);
const pwsh = (script, args) => run('pwsh', ['-NoProfile', '-NonInteractive', '-File', script, ...args], { timeout: 1200000 });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  // 1. 버리는 서명 키(RSA). 암호는 파일로만 넘긴다.
  const signing = path.join(work, 'signing');
  fs.mkdirSync(signing);
  const password = crypto.randomBytes(18).toString('hex');
  fs.writeFileSync(path.join(signing, '서명암호.txt'), password);
  tools.keytool(['-genkeypair', '-alias', 'e2e', '-keyalg', 'RSA', '-keysize', '2048', '-validity', '1', '-storetype', 'PKCS12', '-keystore', 'release.p12', '-storepass', password, '-dname', 'CN=VoiceNote E2E'], { cwd: signing });
  tools.keytool(['-exportcert', '-rfc', '-alias', 'e2e', '-keystore', 'release.p12', '-storepass', password, '-file', 'cert.pem'], { cwd: signing });
  log('버리는 서명 키를 만들었습니다.');

  // 2. 다음 버전(1.5.1, versionCode 8) release APK: 지금 커밋을 따로 풀고 버전만 올려 같은 키로 만든다.
  // 한글 파일 이름이 많아 tar 대신 원격 없는 로컬 복제본을 쓴다.
  const nextSource = path.join(work, 'next');
  run('git', ['clone', '-q', '--no-hardlinks', worktree, nextSource]);
  run('git', ['-C', nextSource, 'remote', 'remove', 'origin']);
  const manifestFile = path.join(nextSource, 'mobile', '안드로이드', 'AndroidManifest.xml');
  const manifestText = fs.readFileSync(manifestFile, 'utf8').replace(/android:versionCode="\d+" android:versionName="[\d.]+"/, `android:versionCode="${NEXT_CODE}" android:versionName="${NEXT}"`);
  if (!manifestText.includes(`android:versionCode="${NEXT_CODE}"`)) throw new Error('다음 버전 번호를 넣지 못했습니다.');
  fs.writeFileSync(manifestFile, manifestText);
  pwsh(path.join(nextSource, 'mobile', '안드로이드', '빌드.ps1'), ['-SigningDir', signing, '-KeystoreName', 'release.p12', '-OutputRoot', path.join(work, 'out-next')]);
  const nextApk = path.join(work, 'out-next', 'VoiceNote-android.apk');
  log('다음 버전 APK:', fs.statSync(nextApk).size, '바이트');

  // 3. 지금 버전(1.5.0, versionCode 7) 검증용 APK: 작업 폴더 그대로(기기 시험 포함) 같은 키로 만든다.
  pwsh(path.join(worktree, 'mobile', '안드로이드', '빌드.ps1'), ['-DebugBuild', '-SigningDir', signing, '-KeystoreName', 'release.p12', '-OutputRoot', path.join(work, 'out-current')]);
  const currentApk = path.join(work, 'out-current', 'VoiceNote-android-test.apk');
  log('지금 버전 검증용 APK:', fs.statSync(currentApk).size, '바이트');

  // 4. 다음 버전의 업데이트 목록을 같은 키로 서명하고 앱과 같은 규칙으로 확인한다. Windows 항목은 이 시험에서 쓰지 않는 자리 채움 파일이다.
  const files = path.join(work, 'files');
  fs.mkdirSync(files);
  const placeholder = path.join(work, 'windows-placeholder.exe');
  fs.writeFileSync(placeholder, crypto.randomBytes(2048));
  pwsh(path.join(worktree, '.github', '업데이트목록.ps1'), ['-Version', NEXT, '-VersionCode', String(NEXT_CODE), '-WindowsInstaller', placeholder, '-AndroidApk', nextApk, '-SigningDir', signing, '-KeystoreName', 'release.p12', '-Jdk', tools.jdk, '-OutputDir', files]);
  fs.copyFileSync(nextApk, path.join(files, `VoiceNote-${NEXT}-Android.apk`));
  fs.copyFileSync(placeholder, path.join(files, `VoiceNote-${NEXT}-Windows-Setup.exe`));
  const verified = run(process.execPath, [path.join(worktree, '.github', '업데이트목록확인.cjs'), '--manifest', path.join(files, `VoiceNote-${NEXT}-update.json`), '--version', NEXT, '--version-code', String(NEXT_CODE),
    '--windows', path.join(files, `VoiceNote-${NEXT}-Windows-Setup.exe`), '--android', path.join(files, `VoiceNote-${NEXT}-Android.apk`), '--certificate', path.join(signing, 'cert.pem')]);
  log(verified.stdout.trim());

  // 5. 가상기기. 이미 떠 있으면 그대로 쓰고, 이 스크립트가 띄운 것만 끝에 끈다.
  let started = false;
  if (!run(ADB, ['devices']).stdout.includes(DEVICE)) {
    const emulator = spawn(EMULATOR, ['-avd', 'VoiceNotePhone', '-no-window', '-no-metrics', '-no-boot-anim', '-no-snapshot-save', '-no-audio'], { env: { ...process.env, ANDROID_SDK_ROOT: SDK, ANDROID_HOME: SDK }, detached: true, stdio: 'ignore' });
    emulator.unref();
    started = true;
    log('가상기기를 띄웠습니다(창 없음).');
  }
  run(ADB, ['-s', DEVICE, 'wait-for-device'], { timeout: 300000 });
  for (let tries = 0; ; tries++) {
    if (adb(['shell', 'getprop', 'sys.boot_completed'], { check: false }).stdout?.trim() === '1') break;
    if (tries > 300) throw new Error('가상기기가 5분 안에 부팅을 마치지 않았습니다.');
    await sleep(1000);
  }
  log('가상기기 준비:', adb(['shell', 'getprop', 'ro.build.version.release']).stdout.trim(), 'API', adb(['shell', 'getprop', 'ro.build.version.sdk']).stdout.trim());

  try {
    // 6. 지금 버전을 깨끗하게 설치하고, 설치 허용을 켠 뒤 시험 릴리즈 파일을 앱 폴더에 넣는다.
    adb(['uninstall', PACKAGE], { check: false });
    adb(['install', currentApk]);
    adb(['shell', 'appops', 'set', PACKAGE, 'REQUEST_INSTALL_PACKAGES', 'allow']);
    adb(['shell', 'run-as', PACKAGE, 'mkdir', '-p', 'files/update-e2e']);
    // adb는 뒤 인자를 공백으로 이어 기기 셸에 넘기므로, 앱 권한으로 쓸 명령 전체를 한 덩어리로 따옴표 쳐서 넘긴다.
    for (const name of [`VoiceNote-${NEXT}-update.json`, `VoiceNote-${NEXT}-Android.apk`])
      run(ADB, ['-s', DEVICE, 'exec-in', `run-as ${PACKAGE} sh -c 'cat > files/update-e2e/${name}'`], { input: fs.readFileSync(path.join(files, name)) });
    log('앱 폴더의 시험 파일:', adb(['shell', 'run-as', PACKAGE, 'ls', '-l', 'files/update-e2e']).stdout.trim().replace(/\s+/g, ' '));
    const before = adb(['shell', 'dumpsys', 'package', PACKAGE]).stdout.match(/versionCode=(\d+)/)?.[1];
    log('설치한 versionCode:', before);

    // 7. 기기 시험이 확인·받기·설치 세션·시스템 설치 화면까지 진행한다.
    const instrument = spawn(ADB, ['-s', DEVICE, 'shell', 'am', 'instrument', '-w', '-r', '-e', 'probe', 'u-e2e', `${PACKAGE}/${PACKAGE}.AndroidChecks`]);
    let output = '', exited = null;
    instrument.stdout.on('data', (chunk) => { output += chunk; });
    instrument.stderr.on('data', (chunk) => { output += chunk; });
    instrument.on('exit', (code) => { exited = code; });
    for (let waited = 0; !output.includes('READY_FOR_TAP'); waited += 500) {
      if (exited !== null || waited > 300000) { fs.writeFileSync(path.join(resultDir, '기기시험출력.txt'), output); throw new Error(`설치 화면 전에 기기 시험이 끝났습니다: ${output.slice(-1500)}`); }
      await sleep(500);
    }
    log('기기 시험: 확인·받기·설치 세션을 마치고 시스템 설치 화면을 열었습니다.');

    // 8. 시스템 설치 화면에서 사람 대신 '업데이트'를 누른다.
    let tapped = null;
    for (let tries = 0; tries < 60 && !tapped; tries++) {
      await sleep(1000);
      const xml = adb(['exec-out', 'uiautomator', 'dump', '/dev/tty'], { check: false }).stdout || '';
      for (const node of xml.match(/<node [^>]*>/g) || []) {
        const value = (name) => node.match(new RegExp(`${name}="([^"]*)"`))?.[1] || '';
        if (!/packageinstaller/i.test(value('package')) || value('enabled') !== 'true') continue;
        if (!/^(update|install|업데이트|설치)$/i.test(value('text').trim())) continue;
        const [x1, y1, x2, y2] = value('bounds').match(/\d+/g).map(Number);
        fs.writeFileSync(path.join(resultDir, '설치화면.xml'), xml);
        fs.writeFileSync(path.join(resultDir, '설치화면.png'), adb(['exec-out', 'screencap', '-p'], { encoding: 'buffer' }).stdout);
        adb(['shell', 'input', 'tap', String(Math.round((x1 + x2) / 2)), String(Math.round((y1 + y2) / 2))]);
        tapped = `${value('text')} (${value('package')})`;
        break;
      }
    }
    if (!tapped) { fs.writeFileSync(path.join(resultDir, '찾지못한화면.png'), adb(['exec-out', 'screencap', '-p'], { encoding: 'buffer' }).stdout); throw new Error('시스템 설치 화면의 업데이트 단추를 찾지 못했습니다.'); }
    log('누른 단추:', tapped);

    // 9. 패키지가 바뀌면 기기 시험 프로세스가 끝난다. 그 뒤 versionCode로 판정한다.
    for (let waited = 0; exited === null && waited < 180000; waited += 500) await sleep(500);
    fs.writeFileSync(path.join(resultDir, '기기시험출력.txt'), output);
    let after = null, name = null;
    for (let tries = 0; tries < 60; tries++) {
      const info = adb(['shell', 'dumpsys', 'package', PACKAGE], { check: false }).stdout || '';
      after = info.match(/versionCode=(\d+)/)?.[1]; name = info.match(/versionName=([\d.]+)/)?.[1];
      if (after === String(NEXT_CODE)) break;
      await sleep(1000);
    }
    fs.writeFileSync(path.join(resultDir, '설치뒤.png'), adb(['exec-out', 'screencap', '-p'], { encoding: 'buffer' }).stdout);
    const result = { passed: after === String(NEXT_CODE) && name === NEXT, before, after, versionName: name, tapped, instrumentExit: exited, instrumentTail: output.slice(-600) };
    fs.writeFileSync(path.join(resultDir, '결과.json'), JSON.stringify(result, null, 2));
    log(result.passed ? `통과: versionCode ${before} → ${after}, versionName ${name}` : `실패: versionCode ${before} → ${after}, versionName ${name}`);
    if (!result.passed) process.exitCode = 1;
  } finally {
    if (started) { adb(['emu', 'kill'], { check: false }); log('띄운 가상기기를 껐습니다.'); }
    fs.rmSync(work, { recursive: true, force: true });
  }
}

main().catch((error) => { log('오류:', error.message); process.exitCode = 1; try { fs.rmSync(work, { recursive: true, force: true }); } catch {} });
