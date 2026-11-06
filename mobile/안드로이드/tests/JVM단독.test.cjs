// 기기 없이 JVM만으로 돌릴 수 있는 Android 시험을 시험마다 필요한 소스만 컴파일해 실행한다. 로컬과 자동 배포가 같은 명령으로 돌린다.
const test = require('node:test');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { android, androidJar, javac, java } = require('./자바도구.cjs');

const sourceDir = path.join(android, 'src', 'kr', 'local', 'meetingjournal');
const source = name => path.join(sourceDir, `${name}.java`);
const allSources = () => fs.readdirSync(sourceDir).filter(name => name.endsWith('.java')).map(name => path.join(sourceDir, name));

function run(name, sources, classpath) {
  const output = fs.mkdtempSync(path.join(os.tmpdir(), 'vn-jvm-'));
  try {
    javac(['-encoding', 'UTF-8', '-nowarn', '-d', output, ...(classpath ? ['-cp', classpath] : []), ...sources, path.join(android, 'tests', `${name}.java`)]);
    java(['-Dfile.encoding=UTF-8', '-cp', [output, classpath].filter(Boolean).join(path.delimiter), `kr.local.meetingjournal.${name}`]);
  } finally {
    fs.rmSync(output, { recursive: true, force: true });
  }
}

// 아래 넷은 java.*만 쓰므로 해당 소스만으로 돈다.
const plain = { SettingsFileTest: ['JsonText', 'CustomFormat', 'SettingsFile'], TextChunksTest: ['TextChunks'], TrialAccessTest: ['TrialAccess'], AiUsageTest: ['AiUsage', 'AiModels'], UpdateRulesTest: ['JsonText', 'UpdateRules'] };
for (const [name, sources] of Object.entries(plain)) test(`JVM 시험 ${name}`, () => run(name, sources.map(source)));
// 아래 셋은 android.jar 스텁으로 컴파일하고, 실행 경로는 java.*만 쓰는 정적 메서드다.
for (const name of ['AiResponseModelTest', 'AiFeedbackTest', 'CopyFilesTest']) test(`JVM 시험 ${name}`, () => run(name, allSources(), androidJar));
