// 릴리즈 때 서명 도구(.github/업데이트목록.ps1)가 만든 업데이트 목록을 휴대폰 앱의 확인 코드(UpdateRules)가 같은 키로 받아들이고, 다른 키의 인증서로는 거절하는지 검증한다.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { spawnSync } = require('node:child_process');
const { android, jdk, javac, java, keytool } = require('./자바도구.cjs');

const repo = path.join(__dirname, '..', '..', '..');
const sha = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');

function keystore(folder, name) {
  const password = crypto.randomBytes(18).toString('hex');
  const store = path.join(folder, `${name}.p12`), cert = path.join(folder, `${name}.pem`);
  keytool(['-genkeypair', '-alias', name, '-keyalg', 'RSA', '-keysize', '3072', '-validity', '2', '-storetype', 'PKCS12', '-keystore', store, '-storepass', password, '-dname', 'CN=VoiceNote Test'], { cwd: folder });
  keytool(['-exportcert', '-rfc', '-alias', name, '-keystore', store, '-storepass', password, '-file', cert], { cwd: folder });
  return { store, cert, password };
}

test('서명 도구가 만든 목록을 휴대폰 확인 코드가 같은 키로 받아들이고 다른 키로는 거절한다', () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'vn-manifest-android-'));
  const classes = fs.mkdtempSync(path.join(os.tmpdir(), 'vn-manifest-classes-'));
  try {
    const signing = path.join(folder, 'signing');
    fs.mkdirSync(signing);
    const release = keystore(signing, 'release');
    const other = keystore(folder, 'other');
    fs.writeFileSync(path.join(signing, '서명암호.txt'), release.password);
    const windows = path.join(folder, 'setup.exe'), apk = path.join(folder, 'app.apk');
    fs.writeFileSync(windows, crypto.randomBytes(3000));
    fs.writeFileSync(apk, crypto.randomBytes(1200));
    const output = path.join(folder, 'out');
    const run = spawnSync('pwsh', ['-NoProfile', '-NonInteractive', '-File', path.join(repo, '.github', '업데이트목록.ps1'), '-Version', '1.5.1', '-VersionCode', '8', '-WindowsInstaller', windows,
      '-AndroidApk', apk, '-SigningDir', signing, '-KeystoreName', 'release.p12', '-Jdk', jdk, '-OutputDir', output], { timeout: 120_000 });
    assert.equal(run.status, 0, String(run.stderr));
    const src = path.join(android, 'src', 'kr', 'local', 'meetingjournal');
    javac(['-encoding', 'UTF-8', '-nowarn', '-d', classes, path.join(src, 'JsonText.java'), path.join(src, 'UpdateRules.java'), path.join(android, 'tests', 'UpdateManifestCheck.java')]);
    const manifest = path.join(output, 'VoiceNote-1.5.1-update.json');
    const check = (cert, version = '1.5.1') => java(['-Dfile.encoding=UTF-8', '-Dstdout.encoding=UTF-8', '-cp', classes, 'kr.local.meetingjournal.UpdateManifestCheck', manifest, cert, version]).toString('utf8').trim();
    assert.equal(check(release.cert), `ok VoiceNote-1.5.1-Android.apk 1200 ${sha(fs.readFileSync(apk))} 8`);
    assert.equal(check(other.cert), 'fail UPDATE_SIGNATURE_INVALID');
    assert.equal(check(release.cert, '1.5.2'), 'fail UPDATE_MANIFEST_INVALID');
  } finally {
    fs.rmSync(folder, { recursive: true, force: true });
    fs.rmSync(classes, { recursive: true, force: true });
  }
});
