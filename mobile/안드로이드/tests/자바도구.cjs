// Android 시험이 Java 도구를 부르는 공통 코드다. Java는 자기 위치와 명령줄을 시스템 코드 페이지로 읽어 영어 Windows(GitHub 러너)에서 한글 경로를 열지 못하므로, 한글 없는 임시 정션으로 JDK·SDK·소스를 넘긴다.
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), { execFileSync } = require('node:child_process');

const toolRoot = process.env.VOICENOTE_TOOLS || 'C:/DEV/VoiceNote/2026-09-30-회의록도구-안드로이드';
const jdkRoot = path.join(toolRoot, '도구', 'JDK');
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'vn-java-'));
const links = [];
function link(name, target) {
  const location = path.join(work, name);
  fs.symlinkSync(path.resolve(target), location, 'junction');
  links.push(location);
  return location;
}
process.on('exit', () => {
  // 정션을 먼저 풀고 빈 폴더만 지운다. 재귀 삭제를 쓰지 않아 원본 JDK와 소스가 함께 지워질 일이 없다.
  for (const location of links) fs.rmdirSync(location);
  fs.rmdirSync(work);
});
const jdk = link('jdk', path.join(jdkRoot, fs.readdirSync(jdkRoot)[0]));
const tools = link('tools', toolRoot);
const android = link('android', path.join(__dirname, '..'));

function run(tool, args, options) {
  // 한글 인자는 이 PC에서는 통과해도 러너에서 실패하므로 부르기 전에 막는다.
  const hangul = args.find(value => /[^\x00-\x7f]/.test(value));
  if (hangul) throw new Error(`Java 도구에 한글이 든 인자를 넘기면 영어 Windows에서 실패합니다: ${hangul}`);
  return execFileSync(path.join(jdk, 'bin', `${tool}.exe`), args, { stdio: 'pipe', cwd: work, ...options });
}

module.exports = {
  android,
  // 업데이트 목록 서명 시험이 PowerShell 스크립트에 넘길 한글 없는 JDK 경로다.
  jdk,
  androidJar: path.join(tools, 'SDK', 'platforms', 'android-36', 'android.jar'),
  javac: (args, options) => run('javac', args, options),
  java: (args, options) => run('java', args, options),
  keytool: (args, options) => run('keytool', args, options),
};
