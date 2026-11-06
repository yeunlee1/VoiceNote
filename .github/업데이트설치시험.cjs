// 러너의 업데이트 설치 시험(업데이트설치시험.ps1)이 쓰는 도우미다. 앱의 실제 업데이트 코드(업데이트.cjs)로 확인·받기·설치 시작을 하되,
// 깃허브 대신 이번 빌드의 파일을 내주는 가짜 연결을 쓴다. 결과는 마지막 줄에 JSON 한 줄로 낸다.
// 쓰는 법: node 업데이트설치시험.cjs --app-dir <설치 폴더> --files <릴리즈 파일 폴더> --version <버전> --certificate <인증서 PEM>
//          --host-pid <앱 창> --server-pid <앱 서버> --temp-root <임시 폴더> [--start-timeout <ms>] [--block-status]
// --block-status는 설치파일이 진행 상태를 적지 못하게 상태 파일 자리에 폴더를 둔다. 시작 확인 실패 경로를 만들 때만 쓴다.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const check = require(path.join(__dirname, '..', 'desktop', '앱', '업데이트검증.cjs'));
const { createUpdater, FOLDER, STATUS_FILE } = require(path.join(__dirname, '..', 'desktop', '앱', '업데이트.cjs'));

function readOptions(argv) {
  const options = { 'start-timeout': '15000', 'block-status': false };
  for (let index = 0; index < argv.length; index++) {
    const name = argv[index].replace(/^--/, '');
    if (name === 'block-status') { options[name] = true; continue; }
    options[name] = argv[++index];
  }
  for (const name of ['app-dir', 'files', 'version', 'certificate', 'host-pid', 'server-pid', 'temp-root'])
    if (!options[name]) throw new Error(`--${name}이 필요합니다.`);
  return options;
}

async function main() {
  const options = readOptions(process.argv.slice(2));
  const version = options.version;
  const names = check.assetNames(version);
  const bytes = Object.fromEntries(['windows', 'android', 'manifest'].map((kind) => [kind, fs.readFileSync(path.join(options.files, names[kind]))]));
  const sha = (content) => crypto.createHash('sha256').update(content).digest('hex');
  const asset = (kind) => ({ name: names[kind], size: bytes[kind].length, digest: `sha256:${sha(bytes[kind])}`, state: 'uploaded', browser_download_url: check.assetUrl(version, names[kind]) });
  const release = { tag_name: `v${version}`, draft: false, prerelease: false, published_at: new Date().toISOString(), assets: [asset('windows'), asset('android'), asset('manifest')] };
  const respond = (content, url, status = 200) => {
    const response = new Response(content, { status });
    Object.defineProperty(response, 'url', { value: url });
    return response;
  };
  const fetch = async (url) => {
    if (url === check.RELEASE_API) return respond(JSON.stringify(release), url);
    if (url === check.assetUrl(version, names.manifest)) return respond(bytes.manifest, url);
    if (url === check.assetUrl(version, names.windows)) return respond(bytes.windows, url);
    return respond('', url, 404);
  };
  const tempRoot = path.resolve(options['temp-root']);
  fs.mkdirSync(tempRoot, { recursive: true });
  const updater = createUpdater({
    enabled: true, currentVersion: '1.0.0', appDir: path.resolve(options['app-dir']),
    hostPid: Number(options['host-pid']), serverPid: Number(options['server-pid']), tempRoot, fetch,
    publicKey: new crypto.X509Certificate(fs.readFileSync(options.certificate)).publicKey, startTimeout: Number(options['start-timeout']),
  });
  const statusFile = path.join(tempRoot, FOLDER, version, STATUS_FILE);
  const report = (outcome, extra = {}) => console.log(JSON.stringify({ outcome, statusFile, ...extra }));
  if (!updater.status().supported) return report('unsupported');
  updater.ensureChecked();
  await updater.settled();
  if (updater.status().status !== 'available') return report('not-available', { state: updater.status() });
  await updater.download();
  await updater.settled();
  if (updater.status().status !== 'ready') return report('not-ready', { state: updater.status() });
  if (options['block-status']) fs.mkdirSync(statusFile, { recursive: true });
  try {
    report((await updater.launch()).status);
  } catch (error) {
    report(error.code || error.message);
  }
}

main().catch((error) => {
  console.log(JSON.stringify({ outcome: 'error', message: error.message }));
  process.exitCode = 1;
});
