// 휴대폰 SummaryRules.java가 데스크톱과 같은 길이 판정·이름 힌트를 내고, 빌드가 줄이기 지시문을 데스크톱 서버에서 뽑는지 검증한다.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), { execFileSync } = require('node:child_process');
const formats = require('../../../desktop/앱/출력형식.js');

const root = path.join(__dirname, '..');
const toolRoot = process.env.VOICENOTE_TOOLS || 'C:/DEV/VoiceNote/2026-09-30-회의록도구-안드로이드';
const jdk = path.join(toolRoot, '도구', 'JDK', fs.readdirSync(path.join(toolRoot, '도구', 'JDK'))[0], 'bin');
const shaped = (body, kept) => ({ overview: '가'.repeat(body), topics: [], decisions: kept ? ['나'.repeat(kept)] : [], actions: [], openQuestions: [] });

test('Java 길이 판정과 이름 힌트가 데스크톱과 같다', () => {
  const targets = [];
  for (const format of ['meeting', 'summary', 'tasks', 'custom', 'report']) {
    for (const body of [0, 400, 500, 501, 1000, 1001, 1200, 1201, 1500, 1501, 2000, 2001, 2400, 2401, 3000, 3001, 3600, 3601, 9000]) {
      for (const kept of [0, 1, 199, 200, 201, 500, 501, 1000, 1500, 1501, 2999, 3000, 3601, 9000]) targets.push({ format, body, kept });
    }
  }
  const keywordCases = ['', '김철수', '김철수, 이영희', '김철수,이영희/박민수;최지은', '김철수·이영희・박민수、최지은，정하나；강두리|윤세찌', '개발팀 김대리\n영업팀\t이과장\r\n박사원',
    '<김철수>, 외, 김철수', '이　영희\u00a0박민수\u2003최지은\ufeff정하나', '😀박민수 𠮷田 A_팀 John-Kim', '김철수 "이영희" (박민수) [최지은]', '가'.repeat(30) + ' ' + '나'.repeat(31),
    Array.from({ length: 25 }, (_, index) => `이름${index}`).join(', '), '   ', ',,,', '가', '12 34', 'a b cd'];
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'vn-summary-rules-'));
  try {
    const sources = ['JsonText', 'SummaryRules'].map(name => path.join(root, 'src/kr/local/meetingjournal', `${name}.java`));
    execFileSync(path.join(jdk, 'javac.exe'), ['-encoding', 'UTF-8', '-d', work, ...sources, path.join(__dirname, 'SummaryRulesTest.java')]);
    const input = path.join(work, 'in.txt'), output = path.join(work, 'out.txt');
    fs.writeFileSync(input, [...targets.map(item => `T ${item.format} ${item.body} ${item.kept}`), ...keywordCases.map(value => `K ${Buffer.from(value, 'utf8').toString('base64')}`)].join('\n') + '\n');
    execFileSync(path.join(jdk, 'java.exe'), ['-Dfile.encoding=UTF-8', '-cp', work, 'kr.local.meetingjournal.SummaryRulesTest', input, output]);
    const results = fs.readFileSync(output, 'utf8').trim().split('\n');
    assert.equal(results.length, targets.length + keywordCases.length);
    targets.forEach((item, index) => assert.equal(Number(results[index]), formats.compactTarget(shaped(item.body, item.kept), item.format), JSON.stringify(item)));
    keywordCases.forEach((value, index) => assert.deepEqual(JSON.parse(results[targets.length + index]), formats.participantKeywords(value), value.slice(0, 40)));
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
});

test('빌드가 데스크톱 서버에서 줄이기 지시문을 뽑는다', () => {
  const destination = fs.mkdtempSync(path.join(os.tmpdir(), 'vn-contract-'));
  try {
    execFileSync(process.execPath, [path.join(root, '요약계약추출.cjs'), destination, path.join(__dirname, '../../../desktop/앱/서버.cjs')], { stdio: 'pipe' });
    const asset = JSON.parse(fs.readFileSync(path.join(destination, 'summary-compact.json'), 'utf8'));
    assert.deepEqual(asset.input.map(item => item.role), ['system']);
    assert.match(asset.input[0].content, /overview와 topics만/);
    assert.deepEqual(asset.text.format.schema.required, ['overview', 'topics']);
    assert.equal(asset.text.format.strict, true);
    assert.equal(asset.store, false);
    const meeting = JSON.parse(fs.readFileSync(path.join(destination, 'summary-meeting.json'), 'utf8'));
    assert.match(meeting.input.map(item => item.content).join('\n'), /누가 말했는지 추측하지/);
    assert.deepEqual(meeting.text.format.schema.required, ['suggestedTitle', 'overview', 'topics', 'decisions', 'actions', 'openQuestions']);
    assert.equal(meeting.text.format.schema.properties.actions.maxItems, 40);
    assert.equal(asset.text.format.schema.properties.topics.maxItems, 30);
  } finally {
    fs.rmSync(destination, { recursive: true, force: true });
  }
});

test('Android 원본은 줄이기 단계와 이름 힌트를 분석과 의견 반영 모두에 건다', () => {
  const source = fs.readFileSync(path.join(root, 'src/kr/local/meetingjournal/Ai.java'), 'utf8');
  assert.match(source, /previous=shorten\(record,previous,dir,null\);/);
  assert.match(source, /previous=shorten\(work,previous,dir,feedback\);/);
  assert.match(source, /SummaryRules\.participantKeywords\(record\.optString\("participants"\)\)/);
  const build = fs.readFileSync(path.join(root, '빌드.ps1'), 'utf8');
  assert.match(build, /assets\/summary-compact\.json/);
});
