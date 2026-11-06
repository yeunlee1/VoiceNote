// 릴리즈 때 쓰는 업데이트 목록 서명 도구가 만든 파일을 앱의 확인 코드가 그대로 받아들이고, 잘못된 서명 키·암호·인증서에는 파일을 남기지 않는지 검증한다.
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { isUtf8 } = require('node:buffer');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { jdk, keytool } = require('../../mobile/안드로이드/tests/자바도구.cjs');
const check = require('../앱/업데이트검증.cjs');

const root = path.join(__dirname, '../..');
const script = path.join(root, '.github', '업데이트목록.ps1');
const sha = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');

// 시험마다 버리는 서명 키를 새로 만든다. 암호는 파일로만 넘기고 화면에 내지 않는다.
function signingFolder({ aliases = ['release'], keystore = 'release.p12' } = {}) {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'vn-manifest-test-'));
  const password = crypto.randomBytes(18).toString('hex');
  fs.writeFileSync(path.join(folder, '서명암호.txt'), password);
  const store = path.join(folder, keystore);
  const cert = path.join(folder, 'cert.pem');
  for (const alias of aliases)
    keytool(['-genkeypair', '-alias', alias, '-keyalg', 'RSA', '-keysize', '3072', '-validity', '2', '-storetype', 'PKCS12', '-keystore', store, '-storepass', password, '-dname', 'CN=VoiceNote Test'], { cwd: folder });
  keytool(['-exportcert', '-rfc', '-alias', aliases[0], '-keystore', store, '-storepass', password, '-file', cert], { cwd: folder });
  return { folder, password, keystore, certificate: fs.readFileSync(cert, 'utf8') };
}

function releaseFiles(folder) {
  const files = path.join(folder, '릴리즈 파일');
  fs.mkdirSync(files);
  const windows = path.join(files, '2026-11-20-VoiceNote-1.5.0-설치.exe');
  const android = path.join(files, 'VoiceNote-android.apk');
  fs.writeFileSync(windows, crypto.randomBytes(4096));
  fs.writeFileSync(android, crypto.randomBytes(1500));
  return { windows, android };
}

// PowerShell은 콘솔 코드 페이지로 안내를 낸다. 러너는 UTF-8, 이 PC는 한국어 코드 페이지라 둘 다 읽는다.
const text = (bytes) => new TextDecoder(isUtf8(bytes) ? 'utf-8' : 'euc-kr').decode(bytes);
function sign(signing, files, output, extra = []) {
  const run = spawnSync('pwsh', ['-NoProfile', '-NonInteractive', '-File', script, '-Version', '1.5.0', '-VersionCode', '7', '-WindowsInstaller', files.windows, '-AndroidApk', files.android,
    '-SigningDir', signing.folder, '-KeystoreName', signing.keystore, '-Jdk', jdk, '-OutputDir', output, ...extra], { timeout: 120_000 });
  return { status: run.status, stdout: text(run.stdout), stderr: text(run.stderr) };
}

test('서명 도구가 만든 목록을 앱이 그 키로 확인하고 파일 크기·해시를 그대로 읽는다', () => {
  const signing = signingFolder();
  try {
    const files = releaseFiles(signing.folder);
    const output = path.join(signing.folder, '배포물');
    const run = sign(signing, files, output);
    assert.equal(run.status, 0, run.stderr + run.stdout);
    assert.doesNotMatch(run.stdout + run.stderr, new RegExp(signing.password));
    const bytes = fs.readFileSync(path.join(output, 'VoiceNote-1.5.0-update.json'));
    const publicKey = new crypto.X509Certificate(signing.certificate).publicKey;
    const payload = check.verifyManifest(bytes, { version: '1.5.0', publicKey });
    assert.deepEqual(payload.windows, { name: 'VoiceNote-1.5.0-Windows-Setup.exe', size: 4096, sha256: sha(fs.readFileSync(files.windows)) });
    assert.deepEqual(payload.android, { name: 'VoiceNote-1.5.0-Android.apk', size: 1500, sha256: sha(fs.readFileSync(files.android)), versionCode: 7 });
    assert.match(run.stdout, new RegExp(`서명 인증서 SHA-256 ${sha(new crypto.X509Certificate(signing.certificate).raw)}`));
    // 앱에 넣은 Android 개인 서명 인증서로는 버리는 키의 서명을 받지 않는다.
    assert.throws(() => check.verifyManifest(bytes, { version: '1.5.0' }), (error) => error.code === 'UPDATE_SIGNATURE_INVALID');
    // 같은 이름의 목록이 이미 있으면 덮어쓰지 않는다.
    const again = sign(signing, files, output);
    assert.notEqual(again.status, 0);
    assert.equal(fs.readFileSync(path.join(output, 'VoiceNote-1.5.0-update.json')).equals(bytes), true);
  } finally {
    fs.rmSync(signing.folder, { recursive: true, force: true });
  }
});

test('기대한 인증서와 다른 키로 서명하면 목록을 남기지 않는다', () => {
  const signing = signingFolder();
  try {
    const files = releaseFiles(signing.folder);
    const output = path.join(signing.folder, '배포물');
    const run = sign(signing, files, output, ['-ExpectedCertificateSha256', check.RELEASE_CERTIFICATE_SHA256]);
    assert.notEqual(run.status, 0);
    assert.match(run.stderr + run.stdout, /인증서/);
    assert.equal(fs.existsSync(path.join(output, 'VoiceNote-1.5.0-update.json')), false);
  } finally {
    fs.rmSync(signing.folder, { recursive: true, force: true });
  }
});

test('암호가 틀리거나 서명 키가 둘이면 목록을 남기지 않고 암호를 출력하지 않는다', () => {
  const two = signingFolder({ aliases: ['release', 'other'] });
  const wrong = signingFolder();
  try {
    const output = path.join(two.folder, '배포물');
    const run = sign(two, releaseFiles(two.folder), output);
    assert.notEqual(run.status, 0);
    assert.equal(fs.existsSync(path.join(output, 'VoiceNote-1.5.0-update.json')), false);
    fs.writeFileSync(path.join(wrong.folder, '서명암호.txt'), 'not-the-password');
    const output2 = path.join(wrong.folder, '배포물');
    const run2 = sign(wrong, releaseFiles(wrong.folder), output2);
    assert.notEqual(run2.status, 0);
    assert.equal(fs.existsSync(path.join(output2, 'VoiceNote-1.5.0-update.json')), false);
    assert.doesNotMatch(run2.stdout + run2.stderr, new RegExp(wrong.password));
    assert.doesNotMatch(run2.stdout + run2.stderr, /not-the-password/);
  } finally {
    fs.rmSync(two.folder, { recursive: true, force: true });
    fs.rmSync(wrong.folder, { recursive: true, force: true });
  }
});
