// 휴대폰 CustomFormat.java와 화면용 formats.js가 데스크톱 출력형식.js와 같은 판정·같은 AI 지시문을 만드는지 검증한다.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), { execFileSync } = require('node:child_process');
const formats = require('../../../desktop/앱/출력형식.js');

const root = path.join(__dirname, '..');
const toolRoot = process.env.VOICENOTE_TOOLS || 'C:/DEV/VoiceNote/2026-09-30-회의록도구-안드로이드';
const jdk = path.join(toolRoot, '도구', 'JDK', fs.readdirSync(path.join(toolRoot, '도구', 'JDK'))[0], 'bin');

test('휴대폰 화면용 formats.js는 데스크톱 출력형식.js와 같은 파일이다', () => {
  assert.deepEqual(fs.readFileSync(path.join(root, 'assets', 'formats.js')), fs.readFileSync(path.join(__dirname, '../../../desktop/앱/출력형식.js')));
});

test('화면이 불러오는 스크립트·스타일은 모두 앱이 넘겨주는 파일 목록에 있다', () => {
  // MainActivity는 정해진 파일만 WebView에 넘긴다. 목록에서 빠지면 실제 휴대폰에서만 화면 기능이 멈춘다.
  const html = fs.readFileSync(path.join(root, 'assets', 'index.html'), 'utf8');
  const activity = fs.readFileSync(path.join(root, 'src/kr/local/meetingjournal/MainActivity.java'), 'utf8');
  const files = [...html.matchAll(/<(?:script|link)[^>]+(?:src|href)="([^"]+)"/g)].map(match => match[1]).filter(file => /\.(js|css)$/.test(file));
  assert.ok(files.includes('formats.js') && files.includes('app.js'));
  for (const file of files) assert.ok(activity.includes(`"/${file}".equals(file)`), `${file}이 MainActivity 목록에 없습니다.`);
});

test('Java 내 형식 검증과 AI 지시문이 데스크톱과 같다', () => {
  const cases = [
    { name: ' 주간 보고 ', sections: [{ key: 'actions', title: ' 이번 주 할 일 ' }, { key: 'overview', title: '한 줄 요약' }], instruction: '  부서별로 묶기 😀\n둘째 줄  ' },
    { name: '짧게', sections: [{ key: 'topics', title: '내용' }] },
    { name: '공백 지시', sections: [{ key: 'decisions', title: '결정' }], instruction: '   ' },
    { name: 'null 지시', sections: [{ key: 'decisions', title: '결정' }], instruction: null },
    { name: '전부', sections: formats.KEYS.map(key => ({ key, title: formats.KEY_LABELS[key] })), instruction: '가'.repeat(1000) },
    { name: '　전각공백　', sections: [{ key: 'overview', title: '\u00a0요약\u00a0' }] },
    null, [], 'text',
    { name: '', sections: [{ key: 'overview', title: '요약' }] },
    { name: '가'.repeat(31), sections: [{ key: 'overview', title: '요약' }] },
    { name: '형식', sections: [] },
    { name: '형식', sections: formats.KEYS.concat('overview').map(key => ({ key, title: '항목' })) },
    { name: '형식', sections: [{ key: 'overview', title: '요약' }, { key: 'overview', title: '다시' }] },
    { name: '형식', sections: [{ key: 'other', title: '기타' }] },
    { name: '형식', sections: [{ key: 'overview', title: '' }] },
    { name: '형식', sections: [{ key: 'overview', title: '가'.repeat(31) }] },
    { name: '형식', sections: [{ key: 'overview', title: '요약', extra: 1 }] },
    { name: '형식', sections: ['overview'] },
    { name: '형식', sections: [{ key: 'overview', title: '요약' }], instruction: '가'.repeat(1001) },
    { name: '형식', sections: [{ key: 'overview', title: '요약' }], instruction: 3 },
    { name: '형식', sections: [{ key: 'overview', title: '요약' }], apiKey: 'x' },
    { name: 7, sections: [{ key: 'overview', title: '요약' }] },
  ];
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'vn-custom-'));
  execFileSync(path.join(jdk, 'javac.exe'), ['-encoding', 'UTF-8', '-d', work, path.join(root, 'src/kr/local/meetingjournal/SettingsExchange.java'), path.join(root, 'src/kr/local/meetingjournal/CustomFormat.java'), path.join(__dirname, 'CustomFormatTest.java')]);
  const input = path.join(work, 'in.jsonl'), output = path.join(work, 'out.jsonl');
  fs.writeFileSync(input, cases.map(value => JSON.stringify(value)).join('\n') + '\n');
  execFileSync(path.join(jdk, 'java.exe'), ['-Dfile.encoding=UTF-8', '-cp', work, 'kr.local.meetingjournal.CustomFormatTest', input, output]);
  const results = fs.readFileSync(output, 'utf8').trim().split('\n').map(line => JSON.parse(line));
  assert.equal(results.length, cases.length);
  cases.forEach((value, index) => {
    let expected;
    try { const normalized = formats.validateCustom(value); expected = { ok: true, value: normalized, instruction: formats.customInstruction(normalized) }; }
    catch (error) { expected = { ok: false, message: error.message }; }
    assert.deepEqual(results[index], expected, `사례 ${index}: ${JSON.stringify(value)?.slice(0, 80)}`);
  });
});
