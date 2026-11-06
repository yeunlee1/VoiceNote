// 릴리즈 전에 쓰는 업데이트 목록 확인 스크립트가 서명·버전·versionCode·두 파일의 크기와 해시를 앱과 같은 규칙으로 확인하는지 검증한다.
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { isUtf8 } = require('node:buffer');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { jdk, keytool } = require('../../mobile/안드로이드/tests/자바도구.cjs');

const root = path.join(__dirname, '../..');
const signer = path.join(root, '.github', '업데이트목록.ps1');
const checker = path.join(root, '.github', '업데이트목록확인.cjs');
const text = (bytes) => new TextDecoder(isUtf8(bytes) ? 'utf-8' : 'euc-kr').decode(bytes);

// 버리는 서명 키로 1.5.0(versionCode 7) 목록을 만든다. 암호는 파일로만 넘긴다.
function prepare() {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'vn-manifest-check-'));
  const password = crypto.randomBytes(18).toString('hex');
  fs.writeFileSync(path.join(folder, '서명암호.txt'), password);
  const store = path.join(folder, 'release.p12');
  keytool(['-genkeypair', '-alias', 'release', '-keyalg', 'RSA', '-keysize', '3072', '-validity', '2', '-storetype', 'PKCS12', '-keystore', store, '-storepass', password, '-dname', 'CN=VoiceNote Test'], { cwd: folder });
  const certificate = path.join(folder, 'cert.pem');
  keytool(['-exportcert', '-rfc', '-alias', 'release', '-keystore', store, '-storepass', password, '-file', certificate], { cwd: folder });
  const out = path.join(folder, '배포물');
  fs.mkdirSync(out);
  const windows = path.join(out, 'VoiceNote-1.5.0-Windows-Setup.exe');
  const android = path.join(out, 'VoiceNote-1.5.0-Android.apk');
  fs.writeFileSync(windows, crypto.randomBytes(4096));
  fs.writeFileSync(android, crypto.randomBytes(1500));
  const run = spawnSync('pwsh', ['-NoProfile', '-NonInteractive', '-File', signer, '-Version', '1.5.0', '-VersionCode', '7', '-WindowsInstaller', windows, '-AndroidApk', android,
    '-SigningDir', folder, '-KeystoreName', 'release.p12', '-Jdk', jdk, '-OutputDir', out], { timeout: 120_000 });
  assert.equal(run.status, 0, text(run.stderr) + text(run.stdout));
  return { folder, certificate, windows, android, manifest: path.join(out, 'VoiceNote-1.5.0-update.json') };
}

function verify(files, change = {}) {
  const options = { manifest: files.manifest, version: '1.5.0', 'version-code': '7', windows: files.windows, android: files.android, certificate: files.certificate, ...change };
  const args = Object.entries(options).filter(([, value]) => value !== null).flatMap(([name, value]) => [`--${name}`, value]);
  const run = spawnSync(process.execPath, [checker, ...args], { timeout: 60_000 });
  return { status: run.status, out: text(run.stdout) + text(run.stderr) };
}

test('서명·버전·versionCode·두 파일이 모두 맞으면 통과하고, 하나라도 다르면 멈춘다', (t) => {
  const files = prepare();
  t.after(() => fs.rmSync(files.folder, { recursive: true, force: true }));
  const good = verify(files);
  assert.equal(good.status, 0, good.out);
  assert.match(good.out, /VoiceNote-1\.5\.0-Windows-Setup\.exe 4096 바이트.*versionCode 7/);

  // 앱에 넣은 개인 서명 인증서로는 버리는 키의 서명을 받지 않는다(실제 릴리즈는 이 경로로 확인한다).
  const pinned = verify(files, { certificate: null });
  assert.notEqual(pinned.status, 0);
  assert.match(pinned.out, /UPDATE_SIGNATURE_INVALID/);

  assert.match(verify(files, { version: '1.5.1' }).out, /UPDATE_MANIFEST_INVALID/);
  assert.match(verify(files, { 'version-code': '8' }).out, /versionCode/);

  // 목록을 만든 뒤 올릴 파일이 바뀌었으면 멈춘다.
  const changed = path.join(files.folder, 'changed.exe');
  fs.writeFileSync(changed, crypto.randomBytes(4096));
  const mismatch = verify(files, { windows: changed });
  assert.notEqual(mismatch.status, 0);
  assert.match(mismatch.out, /UPDATE_FILE_MISMATCH/);
  assert.match(verify(files, { android: files.windows }).out, /UPDATE_FILE_MISMATCH/);

  // 목록 글자를 한 글자만 바꿔도 서명 확인에서 멈춘다.
  const tampered = path.join(files.folder, 'tampered.json');
  const outer = JSON.parse(fs.readFileSync(files.manifest, 'utf8'));
  fs.writeFileSync(tampered, JSON.stringify({ ...outer, payload: outer.payload.replace('"versionCode":7', '"versionCode":9') }));
  assert.match(verify(files, { manifest: tampered, 'version-code': '9' }).out, /UPDATE_SIGNATURE_INVALID/);

  // 인자가 빠지거나 낯설면 확인하지 않고 멈춘다.
  assert.notEqual(verify(files, { android: null }).status, 0);
  assert.notEqual(verify(files, { 'version-code': '7a' }).status, 0);
});
