// Java 도구에 한글 경로가 넘어가지 않게 하는 공통 코드를 검증한다. 영어 Windows 러너에서만 나던 실패를 로컬에서도 잡기 위한 시험이다.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), { execFileSync, spawnSync } = require('node:child_process');
const tools = require('./자바도구.cjs');

test('JDK·소스·SDK를 한글 없는 경로로 넘긴다', () => {
  for (const value of [tools.android, tools.androidJar]) assert.doesNotMatch(value, /[^\x00-\x7f]/, value);
  assert.ok(fs.existsSync(tools.androidJar), tools.androidJar);
  assert.ok(fs.existsSync(path.join(tools.android, 'src')), tools.android);
});

test('Java가 실제로 컴파일·실행되고 자기 위치에 한글이 없다', () => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'vn-java-home-'));
  try {
    fs.writeFileSync(path.join(work, 'Home.java'), 'public class Home { public static void main(String[] args) { System.out.print(System.getProperty("java.home")); } }');
    tools.javac(['-encoding', 'UTF-8', '-d', work, path.join(work, 'Home.java')]);
    // 성공 코드만 돌려주는 도구가 통과하지 못하도록 컴파일 결과와 실행 출력을 직접 본다.
    assert.ok(fs.existsSync(path.join(work, 'Home.class')), '컴파일 결과가 없습니다');
    const home = tools.java(['-cp', work, 'Home'], { encoding: 'utf8' });
    assert.ok(fs.existsSync(path.join(home, 'bin', 'java.exe')), `Java가 알린 위치가 맞지 않습니다: ${home}`);
    assert.doesNotMatch(home, /[^\x00-\x7f]/, home);
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
});

test('한글이 든 인자는 Java를 부르기 전에 막는다', () => {
  assert.throws(() => tools.java(['-cp', path.join(os.tmpdir(), '한글폴더'), 'Home']), /한글/);
  assert.throws(() => tools.javac(['-d', os.tmpdir(), path.join(os.tmpdir(), '다시.java')]), /한글/);
});

test('끝나면 정션만 풀리고 원본 JDK와 소스는 남는다', () => {
  // 공통 코드를 불러 경로만 알리고 끝나는 별도 프로세스로 정리 동작을 본다.
  const output = execFileSync(process.execPath, ['-e', `const t=require(${JSON.stringify(path.join(__dirname, '자바도구.cjs'))});process.stdout.write(t.android)`], { encoding: 'utf8' });
  const work = path.dirname(output);
  assert.equal(fs.existsSync(work), false, work);
  assert.ok(fs.existsSync(path.join(__dirname, '자바도구.cjs')));
  const toolRoot = process.env.VOICENOTE_TOOLS || 'C:/DEV/VoiceNote/2026-09-30-회의록도구-안드로이드';
  const jdkRoot = path.join(toolRoot, '도구', 'JDK');
  assert.ok(fs.existsSync(path.join(jdkRoot, fs.readdirSync(jdkRoot)[0], 'bin', 'java.exe')));
});

test('빌드 준비 중 JDK 정션을 못 만들어도 앞서 만든 정션이 남지 않는다', () => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'vn-build-setup-'));
  const temp = path.join(scratch, 'temp');
  fs.mkdirSync(path.join(scratch, 'tools', '도구', 'JDK'), { recursive: true });
  fs.mkdirSync(temp);
  try {
    const result = spawnSync('pwsh', ['-NoProfile', '-File', path.join(__dirname, '..', '빌드.ps1'), '-ToolRoot', path.join(scratch, 'tools'), '-OutputRoot', path.join(scratch, 'out'), '-SigningDir', path.join(scratch, 'sign')], { encoding: 'utf8', env: { ...process.env, TEMP: temp, TMP: temp } });
    assert.equal(result.error, undefined);
    assert.notEqual(result.status, 0, '빈 JDK 폴더로 빌드가 성공하면 안 됩니다');
    assert.deepEqual(fs.readdirSync(temp).filter(name => name.startsWith('vn-')), []);
  } finally {
    // 시험이 실패해 정션이 남아도 원본을 건드리지 않도록 정션을 먼저 하나씩 푼다.
    for (const name of fs.readdirSync(temp)) {
      const location = path.join(temp, name);
      if (fs.lstatSync(location).isSymbolicLink()) fs.rmdirSync(location);
    }
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});
