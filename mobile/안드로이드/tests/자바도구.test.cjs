// Java 도구에 한글 경로가 넘어가지 않게 하는 공통 코드를 검증한다. 영어 Windows 러너에서만 나던 실패를 로컬에서도 잡기 위한 시험이다.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), { execFileSync } = require('node:child_process');
const tools = require('./자바도구.cjs');

test('JDK·소스·SDK를 한글 없는 경로로 넘겨 Java가 실제로 돈다', () => {
  for (const value of [tools.android, tools.androidJar]) assert.doesNotMatch(value, /[^\x00-\x7f]/, value);
  assert.ok(fs.existsSync(tools.androidJar), tools.androidJar);
  assert.ok(fs.existsSync(path.join(tools.android, 'src')), tools.android);
  const settings = tools.java(['-XshowSettings:properties', '-version'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  assert.equal(typeof settings, 'string');
});

test('Java가 보는 자기 위치에 한글이 없다', () => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'vn-java-home-'));
  try {
    fs.writeFileSync(path.join(work, 'Home.java'), 'public class Home { public static void main(String[] args) { System.out.print(System.getProperty("java.home")); } }');
    tools.javac(['-encoding', 'UTF-8', '-d', work, path.join(work, 'Home.java')]);
    const home = tools.java(['-cp', work, 'Home'], { encoding: 'utf8' });
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
