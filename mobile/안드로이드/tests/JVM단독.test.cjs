// 기기 없이 JVM만으로 돌릴 수 있는 Android 시험을 시험마다 필요한 소스만 컴파일해 실행한다. 로컬과 자동 배포가 같은 명령으로 돌린다.
const test = require('node:test');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { android, androidJar, javac, java } = require('./자바도구.cjs');

const sourceDir = path.join(android, 'src', 'kr', 'local', 'meetingjournal');
const source = name => path.join(sourceDir, `${name}.java`);
const allSources = () => fs.readdirSync(sourceDir).filter(name => name.endsWith('.java')).map(name => path.join(sourceDir, name));

function run(name, sources, classpath, fixtures = []) {
  const output = fs.mkdtempSync(path.join(os.tmpdir(), 'vn-jvm-'));
  try {
    const args = fixtures.map(([file, as]) => { const target = path.join(output, as); fs.copyFileSync(file, target); return target; });
    // 공통 예시는 한글 없는 이름으로 임시 폴더에 복사해 넘긴다. Java 도구는 한글이 든 인자를 받지 않는다.
    javac(['-encoding', 'UTF-8', '-nowarn', '-d', output, ...(classpath ? ['-cp', classpath] : []), ...sources, path.join(android, 'tests', `${name}.java`)]);
    java(['-Dfile.encoding=UTF-8', '-cp', [output, classpath].filter(Boolean).join(path.delimiter), `kr.local.meetingjournal.${name}`, ...args]);
  } finally {
    fs.rmSync(output, { recursive: true, force: true });
  }
}

// 아래 넷은 java.*만 쓰므로 해당 소스만으로 돈다.
const plain = { SettingsFileTest: ['JsonText', 'CustomFormat', 'SettingsFile'], TextChunksTest: ['TextChunks'], TrialAccessTest: ['TrialAccess'], AiUsageTest: ['AiUsage', 'AiModels'], UpdateRulesTest: ['JsonText', 'UpdateRules'] };
for (const [name, sources] of Object.entries(plain)) test(`JVM 시험 ${name}`, () => run(name, sources.map(source)));
// 아래 셋은 android.jar 스텁으로 컴파일하고, 실행 경로는 java.*만 쓰는 정적 메서드다.
for (const name of ['AiResponseModelTest', 'AiFeedbackTest', 'CopyFilesTest', 'TextFileNameTest', 'AudioImportTest']) test(`JVM 시험 ${name}`, () => run(name, allSources(), androidJar));
// 아래 둘은 데스크톱과 같은 공통 예시로 항목 규칙과 회의 문서를 대조한다. org.json을 거치지 않는 Map·List 경로를 PC에서 돌린다.
const fixtures = path.join(__dirname, '..', '..', '..', 'desktop', 'tests', 'fixtures');
test('JVM 시험 MinutesItemsTest', () => run('MinutesItemsTest', allSources(), androidJar, [[path.join(fixtures, '회의결과-항목-예시.json'), 'minutes-items-cases.json']]));
test('JVM 시험 MeetingDocumentTest', () => run('MeetingDocumentTest', allSources(), androidJar, [[path.join(fixtures, '회의문서-예시.json'), 'meeting-document-cases.json']]));
// 기기 시험은 가상기기에서만 돌지만, 지운 메서드를 부르는 것 같은 깨짐은 PC에서 컴파일만 해 봐도 알 수 있다.
test('기기 시험 AndroidChecks가 컴파일된다', () => {
  const output = fs.mkdtempSync(path.join(os.tmpdir(), 'vn-jvm-'));
  try { javac(['-encoding', 'UTF-8', '-nowarn', '-d', output, '-cp', androidJar, ...allSources(), path.join(android, 'tests', 'AndroidChecks.java')]); }
  finally { fs.rmSync(output, { recursive: true, force: true }); }
});
