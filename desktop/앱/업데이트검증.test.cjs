// 업데이트 목록 서명 확인, 릴리즈 정보 읽기, 받은 파일 대조가 위조·변조·형식 오류를 막는지 검증한다.
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const check = require('./업데이트검증.cjs');

const RELEASE_FINGERPRINT = 'f9a7e71bd8aab9d05c4e5475830dece73db25fd3b34005e30ad2955c2df08c61';
const sha = (text) => crypto.createHash('sha256').update(text).digest('hex');

// 시험마다 새 RSA 키를 만들어 쓴다. 개인 키는 파일로 남기지 않는다.
const testKeys = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const otherKeys = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });

function payload(version = '1.5.0', change = {}) {
  return {
    app: 'VoiceNote', format: 1, version,
    windows: { name: `VoiceNote-${version}-Windows-Setup.exe`, size: 11, sha256: sha('windows-app') },
    android: { name: `VoiceNote-${version}-Android.apk`, size: 7, sha256: sha('android'), versionCode: 7 },
    ...change,
  };
}
function manifest(body, { keys = testKeys, signature, outer = {} } = {}) {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  const signed = signature ?? crypto.sign('sha256', Buffer.from(text, 'utf8'), keys.privateKey).toString('base64');
  return Buffer.from(JSON.stringify({ format: 1, algorithm: 'SHA256withRSA', payload: text, signature: signed, ...outer }), 'utf8');
}
const verify = (bytes, version = '1.5.0', publicKey = testKeys.publicKey) => check.verifyManifest(bytes, { version, publicKey });
const rejects = (fn, code) => assert.throws(fn, (error) => error.code === code && typeof error.message === 'string' && error.message.length > 0);

test('앱에 넣은 공개 인증서가 Android 개인 서명 인증서와 같다', () => {
  const certificate = new crypto.X509Certificate(check.RELEASE_CERTIFICATE);
  assert.equal(sha(certificate.raw), RELEASE_FINGERPRINT);
  assert.equal(check.RELEASE_CERTIFICATE_SHA256, RELEASE_FINGERPRINT);
  assert.match(certificate.subject, /CN=Personal Meeting Journal/);
  assert.equal(check.releasePublicKey().asymmetricKeyType, 'rsa');
  assert.equal(check.releasePublicKey().asymmetricKeyDetails.modulusLength, 3072);
});

test('버전은 숫자 세 마디만 받고 자릿수가 아니라 값으로 비교한다', () => {
  assert.equal(check.compareVersions('1.5.0', '1.4.0'), 1);
  assert.equal(check.compareVersions('1.10.0', '1.9.9'), 1);
  assert.equal(check.compareVersions('1.4.0', '1.4.0'), 0);
  assert.equal(check.compareVersions('1.4.0', '2.0.0'), -1);
  for (const bad of ['1.4', 'v1.4.0', '1.04.0', '1.4.0-beta', ' 1.4.0', '1.4.0.0', '', null, 1.4, '99999.0.0'])
    assert.equal(check.parseVersion(bad), null, String(bad));
  assert.throws(() => check.compareVersions('1.4', '1.4.0'));
});

function release(version = '1.5.0', change = {}, assets = null) {
  const names = check.assetNames(version);
  const asset = (name, size, digest) => ({ name, size, state: 'uploaded', digest, browser_download_url: `https://github.com/yeunlee1/VoiceNote/releases/download/v${version}/${name}` });
  return {
    tag_name: `v${version}`, draft: false, prerelease: false, published_at: '2026-11-20T01:00:00Z', html_url: `https://github.com/yeunlee1/VoiceNote/releases/tag/v${version}`,
    assets: assets ?? [asset(names.windows, 11, `sha256:${sha('windows-app')}`), asset(names.android, 7, `sha256:${sha('android')}`), asset(names.manifest, 900, null)],
    ...change,
  };
}

test('새 버전 릴리즈에서 정해진 이름과 주소의 파일만 고른다', () => {
  const result = check.readRelease(release(), '1.4.0');
  assert.equal(result.status, 'available');
  assert.equal(result.version, '1.5.0');
  assert.equal(result.publishedAt, '2026-11-20T01:00:00Z');
  assert.equal(result.manifest.url, 'https://github.com/yeunlee1/VoiceNote/releases/download/v1.5.0/VoiceNote-1.5.0-update.json');
  assert.equal(result.windows.url, 'https://github.com/yeunlee1/VoiceNote/releases/download/v1.5.0/VoiceNote-1.5.0-Windows-Setup.exe');
  assert.equal(result.windows.size, 11);
  assert.equal(result.android.name, 'VoiceNote-1.5.0-Android.apk');
});

test('같거나 낮은 버전, 초안·시험판 릴리즈는 새 버전으로 보지 않는다', () => {
  assert.equal(check.readRelease(release('1.4.0'), '1.4.0').status, 'latest');
  assert.equal(check.readRelease(release('1.3.9'), '1.4.0').status, 'latest');
  assert.equal(check.readRelease(release('1.5.0', { draft: true }), '1.4.0').status, 'latest');
  assert.equal(check.readRelease(release('1.5.0', { prerelease: true }), '1.4.0').status, 'latest');
});

test('새 버전이지만 파일이 빠졌거나 주소가 다르면 자동 설치하지 않고 직접 받기로 안내한다', () => {
  const names = check.assetNames('1.5.0');
  const base = release();
  const without = (name) => ({ ...base, assets: base.assets.filter((asset) => asset.name !== name) });
  assert.equal(check.readRelease(without(names.manifest), '1.4.0').status, 'manual');
  assert.equal(check.readRelease(without(names.windows), '1.4.0').status, 'manual');
  const moved = { ...base, assets: base.assets.map((asset) => asset.name === names.windows ? { ...asset, browser_download_url: 'https://github.com/someone/VoiceNote/releases/download/v1.5.0/VoiceNote-1.5.0-Windows-Setup.exe' } : asset) };
  assert.equal(check.readRelease(moved, '1.4.0').status, 'manual');
  const plain = { ...base, assets: base.assets.map((asset) => asset.name === names.manifest ? { ...asset, browser_download_url: asset.browser_download_url.replace('https:', 'http:') } : asset) };
  assert.equal(check.readRelease(plain, '1.4.0').status, 'manual');
  const pending = { ...base, assets: base.assets.map((asset) => asset.name === names.windows ? { ...asset, state: 'new' } : asset) };
  assert.equal(check.readRelease(pending, '1.4.0').status, 'manual');
  const huge = { ...base, assets: base.assets.map((asset) => asset.name === names.manifest ? { ...asset, size: 65 * 1024 } : asset) };
  assert.equal(check.readRelease(huge, '1.4.0').status, 'manual');
  const result = check.readRelease(without(names.manifest), '1.4.0');
  assert.equal(result.version, '1.5.0');
  assert.match(result.reason, /깃허브/);
});

test('릴리즈 정보 형식이 틀리면 확인 실패로 다룬다', () => {
  for (const bad of [null, [], { tag_name: 'v1.5' }, { tag_name: 'latest', assets: [] }, { ...release(), assets: 'x' }])
    rejects(() => check.readRelease(bad, '1.4.0'), 'UPDATE_RELEASE_INVALID');
});

test('맞는 키로 서명한 목록만 통과하고 내용은 서명한 글 그대로 읽는다', () => {
  const body = payload();
  assert.deepEqual(verify(manifest(body)), body);
  rejects(() => verify(manifest(body, { keys: otherKeys })), 'UPDATE_SIGNATURE_INVALID');
  // 서명한 뒤 글 한 글자만 바꿔도 거절한다.
  const text = JSON.stringify(body);
  const signature = crypto.sign('sha256', Buffer.from(text), testKeys.privateKey).toString('base64');
  rejects(() => verify(manifest(text.replace('"size":11', '"size":12'), { signature })), 'UPDATE_SIGNATURE_INVALID');
  // 기본값(앱에 넣은 Android 인증서)으로는 시험 키 서명을 받지 않는다.
  rejects(() => check.verifyManifest(manifest(body), { version: '1.5.0' }), 'UPDATE_SIGNATURE_INVALID');
});

test('서명 글자와 목록 겉모양이 정해진 형식이 아니면 거절한다', () => {
  const body = payload();
  const good = JSON.parse(manifest(body).toString('utf8'));
  rejects(() => verify(manifest(body, { signature: `${good.signature}!` })), 'UPDATE_SIGNATURE_INVALID');
  rejects(() => verify(manifest(body, { signature: ` ${good.signature}` })), 'UPDATE_SIGNATURE_INVALID');
  rejects(() => verify(manifest(body, { signature: '' })), 'UPDATE_SIGNATURE_INVALID');
  rejects(() => verify(manifest(body, { outer: { algorithm: 'SHA1withRSA' } })), 'UPDATE_MANIFEST_INVALID');
  rejects(() => verify(manifest(body, { outer: { format: 2 } })), 'UPDATE_MANIFEST_INVALID');
  rejects(() => verify(Buffer.from('{"format":1')), 'UPDATE_MANIFEST_INVALID');
  rejects(() => verify(Buffer.alloc(64 * 1024 + 1, 0x20)), 'UPDATE_MANIFEST_INVALID');
  rejects(() => verify('문자열'), 'UPDATE_MANIFEST_INVALID');
});

test('서명이 맞아도 내용이 이번 버전·파일 이름·형식과 다르면 거절한다', () => {
  rejects(() => verify(manifest(payload('1.5.0')), '1.5.1'), 'UPDATE_MANIFEST_INVALID');
  rejects(() => verify(manifest(payload('1.5.0', { app: 'Other' }))), 'UPDATE_MANIFEST_INVALID');
  rejects(() => verify(manifest(payload('1.5.0', { format: 2 }))), 'UPDATE_MANIFEST_INVALID');
  const windows = (change) => payload('1.5.0', { windows: { ...payload().windows, ...change } });
  rejects(() => verify(manifest(windows({ name: 'VoiceNote-1.4.0-Windows-Setup.exe' }))), 'UPDATE_MANIFEST_INVALID');
  rejects(() => verify(manifest(windows({ name: '..\\VoiceNote-1.5.0-Windows-Setup.exe' }))), 'UPDATE_MANIFEST_INVALID');
  rejects(() => verify(manifest(windows({ size: 0 }))), 'UPDATE_MANIFEST_INVALID');
  rejects(() => verify(manifest(windows({ size: 1.5 }))), 'UPDATE_MANIFEST_INVALID');
  rejects(() => verify(manifest(windows({ size: 600 * 1024 * 1024 }))), 'UPDATE_MANIFEST_INVALID');
  rejects(() => verify(manifest(windows({ sha256: 'ABC' }))), 'UPDATE_MANIFEST_INVALID');
  rejects(() => verify(manifest(windows({ sha256: sha('x').toUpperCase() }))), 'UPDATE_MANIFEST_INVALID');
  const android = (change) => payload('1.5.0', { android: { ...payload().android, ...change } });
  rejects(() => verify(manifest(android({ versionCode: 0 }))), 'UPDATE_MANIFEST_INVALID');
  rejects(() => verify(manifest(android({ versionCode: '7' }))), 'UPDATE_MANIFEST_INVALID');
  rejects(() => verify(manifest(android({ name: 'VoiceNote-1.5.0-Android.apk.exe' }))), 'UPDATE_MANIFEST_INVALID');
  rejects(() => verify(manifest(payload('1.5.0', { extra: true }))), 'UPDATE_MANIFEST_INVALID');
  rejects(() => verify(manifest('[1]')), 'UPDATE_MANIFEST_INVALID');
});

test('목록의 Windows 크기·해시가 깃허브 파일 정보와 어긋나면 받지 않는다', () => {
  const body = payload();
  const asset = check.readRelease(release(), '1.4.0').windows;
  assert.doesNotThrow(() => check.matchAsset(body.windows, asset));
  rejects(() => check.matchAsset(body.windows, { ...asset, size: 12 }), 'UPDATE_MANIFEST_INVALID');
  rejects(() => check.matchAsset(body.windows, { ...asset, digest: `sha256:${sha('other')}` }), 'UPDATE_MANIFEST_INVALID');
  // 깃허브가 해시를 주지 않으면 서명한 목록의 해시만 쓴다.
  assert.doesNotThrow(() => check.matchAsset(body.windows, { ...asset, digest: null }));
});

test('받은 파일은 서명한 목록의 크기와 SHA-256이 모두 같아야 한다', async () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'vn-update-check-'));
  try {
    const file = path.join(folder, '설치파일.exe');
    fs.writeFileSync(file, 'windows-app');
    await check.verifyFile(file, { size: 11, sha256: sha('windows-app') });
    await assert.rejects(check.verifyFile(file, { size: 12, sha256: sha('windows-app') }), (error) => error.code === 'UPDATE_FILE_MISMATCH');
    fs.writeFileSync(file, 'windows-apq');
    await assert.rejects(check.verifyFile(file, { size: 11, sha256: sha('windows-app') }), (error) => error.code === 'UPDATE_FILE_MISMATCH');
    await assert.rejects(check.verifyFile(path.join(folder, '없음.exe'), { size: 11, sha256: sha('windows-app') }), (error) => error.code === 'UPDATE_FILE_MISMATCH');
  } finally {
    fs.rmSync(folder, { recursive: true, force: true });
  }
});

test('확인 주소와 내려받기 주소는 이 저장소의 HTTPS 주소로 고정돼 있다', () => {
  assert.equal(check.RELEASE_API, 'https://api.github.com/repos/yeunlee1/VoiceNote/releases/latest');
  assert.equal(check.RELEASE_PAGE, 'https://github.com/yeunlee1/VoiceNote/releases/latest');
  assert.equal(check.assetUrl('1.5.0', 'VoiceNote-1.5.0-update.json'), 'https://github.com/yeunlee1/VoiceNote/releases/download/v1.5.0/VoiceNote-1.5.0-update.json');
});
