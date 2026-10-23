// 데스크톱 설정 교환 모듈과 휴대폰 SettingsExchange.java가 같은 파일을 같은 결과로 주고받고 같은 파일을 거절하는지 검증한다.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), { execFileSync } = require('node:child_process');
const desktop = require('../../../desktop/앱/프로젝트설정교환.cjs');

const root = path.join(__dirname, '..');
const toolRoot = process.env.VOICENOTE_TOOLS || 'C:/DEV/VoiceNote/2026-09-30-회의록도구-안드로이드';
const jdk = path.join(toolRoot, '도구', 'JDK', fs.readdirSync(path.join(toolRoot, '도구', 'JDK'))[0], 'bin');
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'vn-settings-'));
execFileSync(path.join(jdk, 'javac.exe'), ['-encoding', 'UTF-8', '-d', work, path.join(root, 'src/kr/local/meetingjournal/SettingsExchange.java'), path.join(root, 'tests/SettingsExchangeTest.java')]);
const java = args => execFileSync(path.join(jdk, 'java.exe'), ['-Dfile.encoding=UTF-8', '-Dstdout.encoding=UTF-8', '-cp', work, 'kr.local.meetingjournal.SettingsExchangeTest', ...args], { encoding: 'utf8' });
const desktopRead = file => desktop.parseSettingsFile(fs.readFileSync(file).toString('utf8'));

const projects = Array.from({ length: 9 }, (_, i) => ({ slot: i + 1, name: '', title: '', context: '', outputFormat: 'meeting' }));
projects[0] = { slot: 1, name: '예시 프로젝트 문서 표준화', title: '예시 프로젝트 "표준화" 회의', context: '[회의 목적]\n첫 줄\r\n\t탭과 \\ / 😀 \u2028 끝', outputFormat: 'meeting' };
projects[3] = { slot: 4, name: '요약 프로젝트', title: '', context: '설명', outputFormat: 'summary' };
projects[8] = { slot: 9, name: '업무 점검', title: '주간 점검', context: '', outputFormat: 'tasks' };
const valid = desktop.buildSettingsFile(projects);

test('데스크톱이 내보낸 파일 → 휴대폰 읽기·쓰기 → 데스크톱 읽기가 같은 설정이다', () => {
  const from = path.join(work, '데스크톱.json'), to = path.join(work, '휴대폰.json');
  fs.writeFileSync(from, JSON.stringify(valid, null, 2));
  java(['--roundtrip', from, to]);
  assert.deepEqual(desktopRead(to), desktopRead(from));
  assert.deepEqual(desktopRead(to), projects);
  const text = fs.readFileSync(to, 'utf8');
  assert.ok(!/apiKey|model|revision|usage/.test(text), '키·모델·사용량·revision 제외');
  assert.ok(text.indexOf('"slot": 1') < text.indexOf('"slot": 9'), 'slot 순서 정렬');
});

test('휴대폰이 다시 쓴 파일을 다시 돌려도 바이트가 같다', () => {
  const a = path.join(work, 'a.json'), b = path.join(work, 'b.json'), c = path.join(work, 'c.json');
  fs.writeFileSync(a, JSON.stringify(valid));
  java(['--roundtrip', a, b]); java(['--roundtrip', b, c]);
  assert.deepEqual(fs.readFileSync(c), fs.readFileSync(b));
});

test('받아들이는 파일과 거절하는 파일이 데스크톱과 같다', () => {
  const pad = (text, bytes) => text + ' '.repeat(bytes - Buffer.byteLength(text));
  const json = value => JSON.stringify(value);
  const edit = change => { const copy = structuredClone(valid); change(copy); return json(copy); };
  const cases = {
    '압축': json(valid),
    'BOM': '\uFEFF' + json(valid),
    '역순': edit(v => v.projects.reverse()),
    '공백뿐인빈슬롯': edit(v => { Object.assign(v.projects[1], { name: '  ', title: ' \t', context: '\n ' }); }),
    '앞뒤공백이름': edit(v => { Object.assign(v.projects[1], { name: '  이름 ', title: ' 제목 ', context: '  원문 ' }); }),
    '전각공백이름': edit(v => { Object.assign(v.projects[1], { name: '　 ', title: ' ', context: '﻿' }); }),
    'NBSP앞뒤': edit(v => { Object.assign(v.projects[1], { name: ' 이름　', title: ' 제목 ', context: '　설명' }); }),
    '제어문자이름': edit(v => { v.projects[1].name = '\u0001'; }),
    '짝없는서로게이트': edit(v => { Object.assign(v.projects[1], { name: '가\ud800나', title: '\udc00', context: '😀\ud83d' }); }),
    '정확히128KiB': pad(json(valid), desktop.MAX_BYTES),
    'BOM포함128KiB': '\uFEFF' + pad(json(valid), desktop.MAX_BYTES - 3),
    '128KiB초과': pad(json(valid), desktop.MAX_BYTES + 1),
    'BOM때문에초과': '\uFEFF' + pad(json(valid), desktop.MAX_BYTES - 2),
    '빈이름업무형식': edit(v => { v.projects[1].outputFormat = 'tasks'; }),
    '빈이름설명': edit(v => { v.projects[1].context = '남은 설명'; }),
    '8개': edit(v => v.projects.pop()),
    '10개': edit(v => v.projects.push({ ...v.projects[8] })),
    '중복슬롯': edit(v => { v.projects[1].slot = 1; }),
    '슬롯10': edit(v => { v.projects[8].slot = 10; }),
    '문자슬롯': edit(v => { v.projects[0].slot = '1'; }),
    '소수슬롯': edit(v => { v.projects[0].slot = 1.5; }),
    '루트추가키': edit(v => { v.model = 'gpt'; }),
    '항목추가키': edit(v => { v.projects[0].apiKey = 'x'; }),
    '제목없음': edit(v => { delete v.projects[0].title; }),
    '버전2': edit(v => { v.version = 2; }),
    '버전참': edit(v => { v.version = true; }),
    '버전문자': edit(v => { v.version = '1'; }),
    '다른형식': edit(v => { v.format = 'other'; }),
    '알수없는출력형식': edit(v => { v.projects[0].outputFormat = 'minutes'; }),
    '이름101': edit(v => { v.projects[0].name = '가'.repeat(101); }),
    '제목161': edit(v => { v.projects[0].title = '가'.repeat(161); }),
    '설명4001': edit(v => { v.projects[0].context = '가'.repeat(4001); }),
    '최대길이': edit(v => { Object.assign(v.projects[0], { name: '가'.repeat(100), title: '나'.repeat(160), context: '다'.repeat(4000) }); }),
    '이름null': edit(v => { v.projects[0].name = null; }),
    '뒤쉼표': json(valid).replace(/]}$/, ',]}'),
    '배열루트': '[]',
    '빈파일': ''
  };
  const files = Object.entries(cases).map(([name, text]) => { const file = path.join(work, `${name}.json`); fs.writeFileSync(file, text); return file; });
  const mobile = Object.fromEntries(java(['--verdict', ...files]).trim().split(/\r?\n/).map(line => { const at = line.lastIndexOf(' '); return [line.slice(0, at), line.slice(at + 1)]; }));
  const expectedAccept = ['압축', 'BOM', '역순', '공백뿐인빈슬롯', '앞뒤공백이름', '전각공백이름', 'NBSP앞뒤', '제어문자이름', '짝없는서로게이트', '정확히128KiB', 'BOM포함128KiB', '최대길이'];
  for (const file of files) {
    const name = path.basename(file), label = name.replace(/\.json$/, '');
    let verdict = 'accept'; try { desktopRead(file); } catch { verdict = 'reject'; }
    assert.equal(mobile[name], verdict, `${label}: 휴대폰 ${mobile[name]}, 데스크톱 ${verdict}`);
    assert.equal(verdict, expectedAccept.includes(label) ? 'accept' : 'reject', `${label} 기대 판정`);
  }
  for (const label of ['공백뿐인빈슬롯', '앞뒤공백이름', '전각공백이름', 'NBSP앞뒤', '제어문자이름', '짝없는서로게이트']) {
    const from = path.join(work, `${label}.json`), to = path.join(work, `${label}-휴대폰.json`);
    java(['--roundtrip', from, to]);
    assert.deepEqual(desktopRead(to), desktopRead(from), `${label} 정규화 결과 동일`);
  }
});

test.after(() => fs.rmSync(work, { recursive: true, force: true }));
