// push 전에 보낼 커밋의 추가 내용에서 실제 API 키 값·키 모양 문자열·키 파일을 찾아, 있으면 push를 멈춘다. 키 값은 어디에도 출력하지 않는다.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ZERO = /^0+$/;
// 한글 파일 이름이 \355… 같은 이스케이프로 바뀌지 않게 경로를 그대로 출력하게 한다.
const git = (...args) => execFileSync('git', ['-c', 'core.quotePath=false', ...args], { encoding: 'utf8', maxBuffer: 1 << 30 });
// 이 PC의 Windows 앱 키 파일과 VOICENOTE_KEY_FILES(경로를 ;로 나열)에서 실제 키 값을 읽는다. 값은 메모리에서 비교만 한다.
function realKeys() {
  const files = [path.join(process.env.LOCALAPPDATA || '', 'MeetingJournal', '.env.회의록키'),
    ...String(process.env.VOICENOTE_KEY_FILES || '').split(';').filter(Boolean)];
  const keys = new Set();
  for (const file of files) {
    let text;
    try { text = fs.readFileSync(file, 'utf8'); } catch { continue; }
    let value = text;
    try { value = String(JSON.parse(text).apiKey || ''); } catch {}
    for (const piece of value.split(/\s+/)) if (piece.length >= 20) keys.add(piece);
  }
  return [...keys];
}
const KEY_SHAPE = /sk-[A-Za-z0-9_-]{20,}/g;
// 시험에서 쓰는 가짜 값 모양만 허용한다(sk- 뒤에 단어와 하이픈이 오는 모양이라 실제 키와 겹치지 않는다). 이 PC의 실제 키 값은 이와 관계없이 막는다.
const FAKE = /^sk-(test-|mock-|only-synthetic-|default-PACKAGE-never-shown|personal-never-shown)/;
const BLOCKED_FILE = /(^|\/)(\.env[^/]*|[^/]*\.(key|p12|jks|keystore|pk8|pem)|기본키\.json|서명암호[^/]*|AI설정\.json)$/i;

function commitsToPush(lines) {
  const commits = new Set();
  for (const line of lines) {
    const [, localSha, , remoteSha] = line.trim().split(/\s+/);
    if (!localSha || ZERO.test(localSha)) continue;
    const list = ZERO.test(remoteSha || '0') ? git('rev-list', localSha, '--not', '--remotes') : git('rev-list', `${remoteSha}..${localSha}`);
    for (const sha of list.split('\n').filter(Boolean)) commits.add(sha);
  }
  return [...commits];
}

function check(commits, keys) {
  const problems = [];
  for (const sha of commits) {
    const parents = git('rev-list', '--parents', '-n', '1', sha).trim().split(' ').slice(1);
    const base = parents[0] || git('hash-object', '-t', 'tree', process.platform === 'win32' ? 'NUL' : '/dev/null').trim();
    for (const line of git('diff', '--name-status', '--no-renames', base, sha).split('\n').filter(Boolean)) {
      const [status, file] = line.split('\t');
      if (status !== 'D' && BLOCKED_FILE.test(file)) problems.push(`${sha.slice(0, 7)} ${file} — 키·서명·설정 파일`);
    }
    let current = '';
    for (const line of git('diff', '--no-color', '--no-ext-diff', base, sha).split('\n')) {
      if (line.startsWith('+++ ')) { current = line.slice(6); continue; }
      if (!line.startsWith('+')) continue;
      if (keys.some(key => line.includes(key))) problems.push(`${sha.slice(0, 7)} ${current} — 이 PC에 저장된 실제 API 키`);
      for (const match of line.match(KEY_SHAPE) || []) if (!FAKE.test(match)) problems.push(`${sha.slice(0, 7)} ${current} — API 키 모양 문자열`);
    }
  }
  return [...new Set(problems)];
}

if (require.main === module) {
  const input = fs.readFileSync(0, 'utf8').split('\n').filter(line => line.trim());
  const problems = check(commitsToPush(input), realKeys());
  if (problems.length) {
    console.error('push를 멈췄습니다. 공개 저장소에 올리면 안 되는 내용이 있습니다(값은 표시하지 않습니다).');
    for (const problem of problems) console.error(`- ${problem}`);
    process.exit(1);
  }
}

module.exports = { check, commitsToPush, realKeys };
