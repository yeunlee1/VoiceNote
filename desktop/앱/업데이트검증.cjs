// 업데이트 목록의 서명과 내려받은 설치파일을 확인한다. 목록은 Android 앱과 같은 개인 서명 키로 서명하고, 앱에는 그 공개 인증서만 넣는다.
'use strict';
const crypto = require('node:crypto');
const fs = require('node:fs');

const REPOSITORY = 'yeunlee1/VoiceNote';
const RELEASE_API = `https://api.github.com/repos/${REPOSITORY}/releases/latest`;
const RELEASE_PAGE = `https://github.com/${REPOSITORY}/releases/latest`;
const DOWNLOAD_ROOT = `https://github.com/${REPOSITORY}/releases/download/`;
// Android 1.3.0·1.4.0 APK에 들어 있는 서명 인증서다. 공개 정보이며 apksigner가 알려 주는 인증서 SHA-256과 같다.
const RELEASE_CERTIFICATE_SHA256 = 'f9a7e71bd8aab9d05c4e5475830dece73db25fd3b34005e30ad2955c2df08c61';
const RELEASE_CERTIFICATE = `-----BEGIN CERTIFICATE-----
MIID7DCCAlSgAwIBAgIJAIlTTUMsDZWNMA0GCSqGSIb3DQEBDAUAMCMxITAfBgNV
BAMTGFBlcnNvbmFsIE1lZXRpbmcgSm91cm5hbDAgFw0yNjA5MzAwNjE2NDBaGA8y
MDU0MDIxNTA2MTY0MFowIzEhMB8GA1UEAxMYUGVyc29uYWwgTWVldGluZyBKb3Vy
bmFsMIIBojANBgkqhkiG9w0BAQEFAAOCAY8AMIIBigKCAYEAnZV/8DxoHkuD59rV
Y1GisC/ugRs/99aPVorrjoOWCp2WxuB5O8IaIrn1CWE4tDoK4pfg9QhxRQP2quGV
uK3d5+QKisBvwpBwyl7gIWEJwwB/k4K9o+OHvx+0bza9tlzwipbhokI/ZuJ45uQ2
pmwYRa6FkQL8HBKWamBoGH3xWHxHyOTZ2zALwyM7zBmR1eUg2xx6gekR82nYGr4g
cHP2CWV84tb5elVI8rka1w9s+wN2RhNOCEnPTkabPnoG4FPOlvxkczeGiHmU9KMT
fjOh7ITy06HnDrmlBo/n81NHNuUPnbpS5ez/zNtkM6bxvYc0D/DiDTtGUCHk+GoO
KBW02GfDQKF9zTxf9m108512FD3tkMTpfT1EATWTolmPrL39CpI1dKDvyKrgHyky
IEl11UWWonpNMwX94vyItnoqyu2WzKFMBxiKbLRHUiVugiYA4Rcclb2AcYCrBint
s88+J+sPpvLj7Es9ATob1t9gnllT7n7zYCCAVlIMkkABpxLbAgMBAAGjITAfMB0G
A1UdDgQWBBQJyqpIv7lmeur1ASD25GiiWhq2DjANBgkqhkiG9w0BAQwFAAOCAYEA
Pcw3Ay7ggNmdPLrDAL1iOLTIgUnrDJb1dTV7TWTPSMSZVVHncmd8BY7FiJu7Xvmp
bzuEyzj/EN5m1qNjDHB/xmosq0U5o6ws604YdHQJNxsbcLSd02RGzxdZaUnFTLHR
Rp+PubN7ZSUS68e97pLdR0q+gLS++OPkKYWVw5sGLZ+Nfm+i9sXes5tBpFx0b5OF
5ByneU1vcuat/2/9MbsdvMNKoA9Vxij1e8OALEQQzqnHRI5UBT32eQ4jkTI9gCse
zgfWoFAwMn+NGFE3nPmfx929IjiA0umVHgnXy8hvxixxm6C9gMUtnsWZQa+WofbN
jShHa3c7AN7kQ/zvMbbaJZJeK3rjGakY2dF/MhjqheZx/dCLbxGtV0GYoz6It+dB
Q4/mkCC46c7mYzWobZtoTgnsaSwl/p737glCrjebKUQFo2ZtZuDCGAx2pRtBV+Xg
L332mXw9kjum9hNJtLKM+Qb/skiMTDnbxF6BLGQP2N5WYpOyl1dP3tczL5h1752Y
-----END CERTIFICATE-----
`;
const LIMITS = { manifest: 64 * 1024, windows: 512 * 1024 * 1024, android: 256 * 1024 * 1024 };
const DIRECT = '깃허브 릴리즈 페이지에서 설치파일을 직접 받아 설치하세요.';

function fail(code, message) {
  return Object.assign(new Error(message), { code });
}
const plainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const exactKeys = (value, keys) => plainObject(value) && Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));

// 1.4.0처럼 숫자 세 마디만 받는다. 앞자리 0, 접미사, 네 마디는 같은 버전을 다르게 쓸 수 있어 받지 않는다.
function parseVersion(value) {
  if (typeof value !== 'string') return null;
  const match = /^(0|[1-9]\d{0,3})\.(0|[1-9]\d{0,3})\.(0|[1-9]\d{0,3})$/.exec(value);
  return match ? match.slice(1).map(Number) : null;
}
function compareVersions(left, right) {
  const a = parseVersion(left), b = parseVersion(right);
  if (!a || !b) throw fail('UPDATE_VERSION_INVALID', '버전 형식을 확인하지 못했습니다.');
  for (let index = 0; index < 3; index++) if (a[index] !== b[index]) return a[index] > b[index] ? 1 : -1;
  return 0;
}

const assetNames = (version) => ({ windows: `VoiceNote-${version}-Windows-Setup.exe`, android: `VoiceNote-${version}-Android.apk`, manifest: `VoiceNote-${version}-update.json` });
const assetUrl = (version, name) => `${DOWNLOAD_ROOT}v${version}/${name}`;

// GitHub의 최신 릴리즈 응답에서 이번 버전 파일만 이름·주소·크기로 고른다. 하나라도 맞지 않으면 자동 설치하지 않고 직접 받기로 안내한다.
function readRelease(release, currentVersion) {
  if (!plainObject(release) || !Array.isArray(release.assets)) throw fail('UPDATE_RELEASE_INVALID', '깃허브 릴리즈 정보를 읽지 못했습니다.');
  const version = typeof release.tag_name === 'string' && release.tag_name.startsWith('v') ? release.tag_name.slice(1) : '';
  if (!parseVersion(version)) throw fail('UPDATE_RELEASE_INVALID', '깃허브 릴리즈의 버전 이름을 읽지 못했습니다.');
  if (release.draft !== false || release.prerelease !== false || compareVersions(version, currentVersion) <= 0) return { status: 'latest', version };
  const publishedAt = typeof release.published_at === 'string' ? release.published_at : null;
  const names = assetNames(version);
  const pick = (kind, limit) => {
    const asset = release.assets.find((item) => plainObject(item) && item.name === names[kind]);
    if (!asset || asset.state !== 'uploaded' || asset.browser_download_url !== assetUrl(version, names[kind])) return null;
    if (!Number.isSafeInteger(asset.size) || asset.size < 1 || asset.size > limit) return null;
    const digest = typeof asset.digest === 'string' && /^sha256:[0-9a-f]{64}$/.test(asset.digest) ? asset.digest : null;
    return { name: names[kind], url: asset.browser_download_url, size: asset.size, digest };
  };
  const manifest = pick('manifest', LIMITS.manifest), windows = pick('windows', LIMITS.windows), android = pick('android', LIMITS.android);
  if (!manifest || !windows) return { status: 'manual', version, publishedAt, reason: `새 버전의 자동 설치 정보를 찾지 못했습니다. ${DIRECT}` };
  return { status: 'available', version, publishedAt, manifest, windows, android };
}

let releaseKey = null;
function releasePublicKey() {
  if (!releaseKey) {
    const certificate = new crypto.X509Certificate(RELEASE_CERTIFICATE);
    if (crypto.createHash('sha256').update(certificate.raw).digest('hex') !== RELEASE_CERTIFICATE_SHA256) throw fail('UPDATE_SIGNATURE_INVALID', '앱의 업데이트 확인 인증서가 손상됐습니다.');
    releaseKey = certificate.publicKey;
  }
  return releaseKey;
}

function checkFile(entry, name, limit) {
  if (!exactKeys(entry, name.endsWith('.apk') ? ['name', 'size', 'sha256', 'versionCode'] : ['name', 'size', 'sha256'])) return false;
  if (entry.name !== name || !Number.isSafeInteger(entry.size) || entry.size < 1 || entry.size > limit) return false;
  if (typeof entry.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(entry.sha256)) return false;
  return !name.endsWith('.apk') || (Number.isSafeInteger(entry.versionCode) && entry.versionCode >= 1 && entry.versionCode <= 2100000000);
}

// 서명은 payload 글자 그대로(UTF-8)에 대해 확인하고, 확인한 뒤에만 그 글을 해석한다.
function verifyManifest(bytes, { version, publicKey = releasePublicKey() } = {}) {
  const invalid = () => fail('UPDATE_MANIFEST_INVALID', `업데이트 정보의 형식이 맞지 않습니다. ${DIRECT}`);
  if (!Buffer.isBuffer(bytes) || bytes.length > LIMITS.manifest || !parseVersion(version)) throw invalid();
  let outer;
  try { outer = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch { throw invalid(); }
  if (!exactKeys(outer, ['format', 'algorithm', 'payload', 'signature']) || outer.format !== 1 || outer.algorithm !== 'SHA256withRSA' || typeof outer.payload !== 'string') throw invalid();
  const signature = outer.signature;
  const badSignature = () => fail('UPDATE_SIGNATURE_INVALID', `업데이트 정보의 서명을 확인하지 못했습니다. ${DIRECT}`);
  // Node의 base64 해석은 틀린 글자를 건너뛰므로, 정해진 글자만 쓴 정규 형태인지 먼저 본다.
  if (typeof signature !== 'string' || signature.length < 4 || signature.length > 2048 || !/^[A-Za-z0-9+/]+={0,2}$/.test(signature) || signature.length % 4 !== 0) throw badSignature();
  const raw = Buffer.from(signature, 'base64');
  if (raw.toString('base64') !== signature) throw badSignature();
  let valid = false;
  try { valid = crypto.verify('sha256', Buffer.from(outer.payload, 'utf8'), { key: publicKey, padding: crypto.constants.RSA_PKCS1_PADDING }, raw); } catch { valid = false; }
  if (!valid) throw badSignature();
  let payload;
  try { payload = JSON.parse(outer.payload); } catch { throw invalid(); }
  const names = assetNames(version);
  if (!exactKeys(payload, ['app', 'format', 'version', 'windows', 'android']) || payload.app !== 'VoiceNote' || payload.format !== 1 || payload.version !== version) throw invalid();
  if (!checkFile(payload.windows, names.windows, LIMITS.windows) || !checkFile(payload.android, names.android, LIMITS.android)) throw invalid();
  return payload;
}

// 서명한 목록과 깃허브가 알려 준 파일 정보가 같은 파일을 가리키는지 본다. 깃허브 해시가 없으면 서명한 해시만 쓴다.
function matchAsset(entry, asset) {
  if (!plainObject(asset) || asset.size !== entry.size || (asset.digest != null && asset.digest !== `sha256:${entry.sha256}`))
    throw fail('UPDATE_MANIFEST_INVALID', `업데이트 정보와 깃허브 파일 정보가 서로 다릅니다. ${DIRECT}`);
}

async function verifyFile(file, { size, sha256 }) {
  const mismatch = () => fail('UPDATE_FILE_MISMATCH', `받은 설치파일이 업데이트 정보와 다릅니다. 다시 받거나 ${DIRECT}`);
  let info;
  try { info = await fs.promises.lstat(file); } catch { throw mismatch(); }
  if (!info.isFile() || info.size !== size) throw mismatch();
  const hash = crypto.createHash('sha256');
  try {
    for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  } catch { throw mismatch(); }
  if (hash.digest('hex') !== sha256) throw mismatch();
}

module.exports = { REPOSITORY, RELEASE_API, RELEASE_PAGE, RELEASE_CERTIFICATE, RELEASE_CERTIFICATE_SHA256, LIMITS,
  parseVersion, compareVersions, assetNames, assetUrl, readRelease, releasePublicKey, verifyManifest, matchAsset, verifyFile };
