// 서명한 업데이트 목록을 앱과 같은 검증기로 다시 확인하고, 목록이 가리키는 두 파일이 실제로 올릴 파일과 같은지 본다. 자동 배포와 로컬 릴리즈가 올리기 전에 쓴다.
// 쓰는 법: node .github/업데이트목록확인.cjs --manifest <목록> --version <버전> --version-code <번호> --windows <설치파일> --android <APK> [--certificate <인증서 PEM>]
// --certificate가 없으면 앱에 넣은 Android 개인 서명 인증서로 확인한다(실제 릴리즈). 버리는 시험 서명은 그 인증서를 넘긴다.
const fs = require('node:fs');
const crypto = require('node:crypto');
const path = require('node:path');
const check = require(path.join(__dirname, '..', 'desktop', '앱', '업데이트검증.cjs'));

const REQUIRED = ['manifest', 'version', 'version-code', 'windows', 'android'];

function readOptions(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index]?.startsWith('--') ? argv[index].slice(2) : '';
    if (![...REQUIRED, 'certificate'].includes(name) || argv[index + 1] === undefined || Object.hasOwn(options, name)) throw new Error(`인자를 확인하세요: ${argv[index]}`);
    options[name] = argv[index + 1];
  }
  for (const name of REQUIRED) if (!options[name]) throw new Error(`--${name}이 필요합니다.`);
  if (!/^\d+$/.test(options['version-code'])) throw new Error('--version-code는 숫자여야 합니다.');
  return options;
}

async function main() {
  const options = readOptions(process.argv.slice(2));
  const publicKey = options.certificate ? new crypto.X509Certificate(fs.readFileSync(options.certificate)).publicKey : check.releasePublicKey();
  const payload = check.verifyManifest(fs.readFileSync(options.manifest), { version: options.version, publicKey });
  if (payload.android.versionCode !== Number(options['version-code']))
    throw new Error(`목록의 versionCode(${payload.android.versionCode})가 앱의 versionCode(${options['version-code']})와 다릅니다.`);
  // 목록에 적은 크기·해시가 실제로 올릴 두 파일과 같아야 앱이 받은 뒤 확인을 통과한다.
  await check.verifyFile(options.windows, payload.windows);
  await check.verifyFile(options.android, payload.android);
  console.log(`업데이트 목록 확인: ${path.basename(options.manifest)} 서명 확인(${options.certificate ? '넘긴 인증서' : '앱에 넣은 인증서'}), ` +
    `${payload.windows.name} ${payload.windows.size} 바이트, ${payload.android.name} ${payload.android.size} 바이트 versionCode ${payload.android.versionCode}`);
}

main().catch((error) => {
  console.error(`업데이트 목록 확인 실패: ${error.code ? `${error.code} ` : ''}${error.message}`);
  process.exitCode = 1;
});
