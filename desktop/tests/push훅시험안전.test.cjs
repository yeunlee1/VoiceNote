// push 비밀 검사 훅 시험이 실제 저장소를 건드리지 못하는지와 실패를 종료 코드로 알리는지 검증한다. 모든 실행은 버리는 저장소와 버리는 원격 안에서 한다.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('node:child_process');

const hooks = path.join(__dirname, '../../.githooks');
const bash = path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Git', 'bin', 'bash.exe');
const realGit = execFileSync('where', ['git'], { encoding: 'utf8' }).split(/\r?\n/)[0].trim();
const git = (cwd, ...args) => execFileSync(realGit, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

function throwawayRepo(t) {
  // 시험 스크립트가 잘못 돌아도 이 저장소와 이 원격만 망가지게 한다.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vn-hook-safety-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const remote = path.join(root, 'remote.git'), repo = path.join(root, 'repo');
  git(root, 'init', '-q', '--bare', remote);
  git(root, 'init', '-q', '-b', 'main', repo);
  git(repo, 'config', 'user.name', '원래 이름');
  git(repo, 'config', 'user.email', 'original@example.invalid');
  git(repo, 'config', 'core.autocrlf', 'true');
  for (const count of [1, 2, 3]) {
    fs.writeFileSync(path.join(repo, `기록${count}.md`), `기록 ${count}\n`);
    git(repo, 'add', '.');
    git(repo, 'commit', '-q', '-m', `기록 ${count}`);
  }
  git(repo, 'remote', 'add', 'origin', remote);
  git(repo, 'push', '-q', 'origin', 'main');
  fs.cpSync(hooks, path.join(repo, '.githooks'), { recursive: true });
  const state = () => ({
    head: git(repo, 'rev-parse', 'HEAD'), branch: git(repo, 'rev-parse', '--abbrev-ref', 'HEAD'), remoteMain: git(remote, 'rev-parse', 'refs/heads/main'),
    remoteRefs: git(remote, 'for-each-ref', '--format=%(refname)'), name: git(repo, 'config', 'user.name'), remotes: git(repo, 'remote'), files: fs.readdirSync(repo).sort(),
  });
  return { root, repo, state };
}
function environment(extra) {
  // Windows는 환경 변수 이름의 대소문자를 구분하지 않으므로 Path와 PATH가 겹치지 않게 합친다.
  const merged = {};
  for (const source of [process.env, extra]) {
    for (const [key, value] of Object.entries(source)) {
      for (const old of Object.keys(merged)) if (old.toUpperCase() === key.toUpperCase()) delete merged[old];
      merged[key] = value;
    }
  }
  return merged;
}
const run = (cwd, script, env = {}, shell = bash) => spawnSync(shell, [script], { cwd, encoding: 'utf8', env: environment(env) });

test('임시 저장소로 이동하지 못하면 아무것도 하지 않고 멈춘다', t => {
  const { root, repo, state } = throwawayRepo(t);
  // git init만 아무 일도 하지 않게 해서 임시 저장소가 생기지 않는 상황을 만든다.
  const fake = path.join(root, 'fake-bin');
  fs.mkdirSync(fake);
  fs.writeFileSync(path.join(fake, 'git'), `#!/bin/sh\nif [ "$1" = init ]; then exit 0; fi\nexec "${realGit.replace(/\\/g, '/')}" "$@"\n`);
  const before = state();
  // Git\bin\bash.exe는 PATH 맨 앞에 진짜 git을 넣으므로, 가짜 git이 쓰이도록 PATH를 바꾸지 않는 usr\bin의 bash를 쓴다.
  const usrBin = path.join(path.dirname(path.dirname(bash)), 'usr', 'bin');
  const result = run(repo, '.githooks/push-비밀검사-시험.sh', { PATH: [fake, usrBin, process.env.PATH].join(path.delimiter) }, path.join(usrBin, 'bash.exe'));
  assert.equal(result.status, 2, result.stdout + result.stderr);
  assert.match(result.stdout, /시험 중단/);
  assert.deepEqual(state(), before);
});

test('경로 변환을 끈 환경에서도 임시 저장소 안에서 끝까지 돌고 현재 저장소를 건드리지 않는다', t => {
  const { repo, state } = throwawayRepo(t);
  const before = state();
  const result = run(repo, '.githooks/push-비밀검사-시험.sh', { MSYS_NO_PATHCONV: '1' });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal((result.stdout.match(/^통과 /gm) || []).length, 16, result.stdout);
  assert.deepEqual(state(), before);
});

test('막아야 할 push를 훅이 막지 못하면 시험이 실패 종료 코드를 낸다', t => {
  const { root, repo, state } = throwawayRepo(t);
  // 아무것도 막지 않는 가짜 훅으로 시험 스크립트의 판정만 본다.
  const copy = path.join(root, 'hook-copy');
  fs.cpSync(hooks, copy, { recursive: true });
  fs.writeFileSync(path.join(copy, 'pre-push'), '#!/bin/sh\nexit 0\n');
  const before = state();
  const result = run(repo, path.join(copy, 'push-비밀검사-시험.sh').replace(/\\/g, '/'));
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /^실패 /m);
  assert.deepEqual(state(), before);
});
