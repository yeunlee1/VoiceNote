// push 전에 보낼 커밋·태그의 파일 내용·파일 이름·메시지에서 실제 API 키 값·키 모양 문자열·키 파일을 찾아, 있으면 push를 멈춘다. 키 값은 어디에도 출력하지 않는다.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ZERO = /^0+$/;
const git = (...args) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 1 << 30 });
const gitBytes = (...args) => execFileSync('git', args, { maxBuffer: 1 << 30 });
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
// 키·서명·설정 파일과, 속을 읽을 수 없는 압축·실행 파일은 이름만으로 막는다.
const BLOCKED_FILE = /(^|\/)(\.env[^/]*|[^/]*\.(key|p12|jks|keystore|pk8|pem|zip|apk|aab|jar|7z|rar|gz|tgz|tar|docx|xlsx|pptx|exe|dll|idsig)|기본키\.json|서명암호[^/]*|AI설정\.json)$/i;

// 바이트를 latin1로 읽으면 UTF-8·바이너리 안의 영문 키가 그대로 남는다. NUL을 뺀 글은 UTF-16으로 저장된 키를 잡는다.
function scan(where, bytes, keys, problems) {
  const plain = Buffer.from(bytes).toString('latin1');
  for (const text of [plain, plain.replace(/\0/g, '')]) {
    if (keys.some(key => text.includes(key))) problems.push(`${where} — 이 PC에 저장된 실제 API 키`);
    for (const match of text.match(KEY_SHAPE) || []) if (!FAKE.test(match)) problems.push(`${where} — API 키 모양 문자열`);
  }
}

// 보낼 원격에 이미 있는 커밋만 빼고 나머지를 모두 검사 대상으로 삼는다. 다른 원격에만 있는 커밋은 아직 공개되지 않았으므로 뺀다고 보지 않는다.
function commitsToPush(lines, remote = '') {
  const commits = new Set(), tags = new Set();
  const notPushed = remote ? [`--remotes=${remote}`] : [];
  for (const line of lines) {
    const [, localSha, , remoteSha] = line.trim().split(/\s+/);
    if (!localSha || ZERO.test(localSha)) continue;
    if (git('cat-file', '-t', localSha).trim() === 'tag') tags.add(localSha);
    let list;
    try { list = ZERO.test(remoteSha || '0') ? git('rev-list', localSha, '--not', ...notPushed) : git('rev-list', `${remoteSha}..${localSha}`); }
    catch { list = git('rev-list', localSha, '--not', ...notPushed); }
    for (const sha of list.split('\n').filter(Boolean)) commits.add(sha);
  }
  return { commits: [...commits], tags: [...tags] };
}

function check({ commits, tags }, keys) {
  const problems = [];
  const emptyTree = git('hash-object', '-t', 'tree', process.platform === 'win32' ? 'NUL' : '/dev/null').trim();
  for (const tag of tags) scan(`태그 ${tag.slice(0, 7)} 메시지`, gitBytes('cat-file', 'tag', tag), keys, problems);
  for (const sha of commits) {
    const short = sha.slice(0, 7);
    scan(`${short} 커밋 메시지`, gitBytes('cat-file', 'commit', sha), keys, problems);
    const parents = git('rev-list', '--parents', '-n', '1', sha).trim().split(' ').slice(1);
    // -z 출력은 ':옛모드 새모드 옛blob 새blob 상태' 다음에 이스케이프 없는 경로가 온다.
    const fields = gitBytes('diff', '--raw', '-z', '--no-renames', '--no-ext-diff', parents[0] || emptyTree, sha).toString('utf8').split('\0');
    for (let i = 0; i + 1 < fields.length; i += 2) {
      const [, , newMode, , blob, status] = fields[i].split(/[: ]/), file = fields[i + 1];
      if (status === 'D') continue;
      if (BLOCKED_FILE.test(file)) problems.push(`${short} ${file} — 키·서명·설정·압축 파일`);
      scan(`${short} 파일 이름`, Buffer.from(file), keys, problems);
      if (newMode !== '160000') scan(`${short} ${file}`, gitBytes('cat-file', 'blob', blob), keys, problems);
    }
  }
  return [...new Set(problems)];
}

if (require.main === module) {
  const input = fs.readFileSync(0, 'utf8').split('\n').filter(line => line.trim());
  const problems = check(commitsToPush(input, process.argv[2] || ''), realKeys());
  if (problems.length) {
    console.error('push를 멈췄습니다. 공개 저장소에 올리면 안 되는 내용이 있습니다(값은 표시하지 않습니다).');
    for (const problem of problems) console.error(`- ${problem}`);
    process.exit(1);
  }
}

module.exports = { check, commitsToPush, realKeys, scan };
