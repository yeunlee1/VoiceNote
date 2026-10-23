// Windows 설정파일.cjs와 Android SettingsFile의 정규화·거절 문구·바이트 경계를 직접 대조한다.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), { execFileSync } = require('node:child_process');
const desktop = require('../../../desktop/앱/설정파일.cjs');
const root = path.join(__dirname, '..');
const toolRoot = process.env.VOICENOTE_TOOLS || 'C:/DEV/VoiceNote/2026-09-30-회의록도구-안드로이드';
const jdk = path.join(toolRoot, '도구', 'JDK', fs.readdirSync(path.join(toolRoot, '도구', 'JDK'))[0], 'bin');
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'vn-settings-v2-'));
const source = name => path.join(root, 'src/kr/local/meetingjournal', name + '.java');
execFileSync(path.join(jdk, 'javac.exe'), ['-encoding', 'UTF-8', '-d', work, source('JsonText'), source('CustomFormat'), source('SettingsFile'), path.join(__dirname, 'SettingsFileTest.java')]);
const java = args => execFileSync(path.join(jdk, 'java.exe'), ['-Dfile.encoding=UTF-8', '-Dstdout.encoding=UTF-8', '-Dstderr.encoding=UTF-8', '-cp', work, 'kr.local.meetingjournal.SettingsFileTest', ...args], { encoding: 'utf8' });
const custom = { name: ' 주간 보고 😀 ', sections: [{ key: 'actions', title: ' 할 일 ' }, { key: 'overview', title: '요약' }], instruction: '  첫 줄\n따옴표 " \\ 와 탭\t  ' };
const valid = desktop.buildSettingsFile({ summaryModel: 'gpt-6.1-sol', defaultOutputFormat: 'custom', customFormat: custom, storage: { audio: 'D:\\합성\\원음', transcript: '', summary: '\\\\서버\\합성' } });
const phone = value => { const { storage, ...rest } = value; return rest; };
test('Windows 파일을 Android가 읽고 다시 내보내면 저장 위치만 빠진 같은 설정이다', () => {
  const from = path.join(work, 'Windows.json'), to = path.join(work, 'Android.json'), again = path.join(work, '다시.json');
  fs.writeFileSync(from, JSON.stringify(valid, null, 2));
  java(['--roundtrip', from, to]);
  assert.deepEqual(desktop.parseSettingsFile(fs.readFileSync(to)), phone(desktop.parseSettingsFile(fs.readFileSync(from))));
  assert.equal(Object.hasOwn(JSON.parse(fs.readFileSync(to)), 'storage'), false);
  java(['--roundtrip', to, again]); assert.deepEqual(fs.readFileSync(again), fs.readFileSync(to));
});
test('2판 JVM 단독 시험을 모두 통과한다', () => assert.match(java([]), /PASS \d+ settings v2 checks/));
test('같은 바이트를 주면 Windows와 Android의 값·거절 문구가 같다', () => {
  const json = JSON.stringify, edit = fn => { const value = structuredClone(valid); fn(value); return json(value); };
  const pad = (text, n) => text + ' '.repeat(n - Buffer.byteLength(text));
  const cases = {
    '정상': json(valid), 'BOM': '\uFEFF'+json(valid),
    '저장위치없음': edit(v=>delete v.storage), '내형식null': edit(v=>v.customFormat=null),
    '빈저장위치': edit(v=>v.storage={audio:'',transcript:'',summary:''}),
    '알수없는모델': edit(v=>v.summaryModel='다른 모델'), '공백모델':edit(v=>v.summaryModel=' '),
    '모델100': edit(v=>v.summaryModel='가'.repeat(100)), '모델101':edit(v=>v.summaryModel='가'.repeat(101)),
    '모델비문자': edit(v=>v.summaryModel=false), '모델null':edit(v=>v.summaryModel=null), '모델없음':edit(v=>delete v.summaryModel),
    '기본형식없음':edit(v=>delete v.defaultOutputFormat),'기본형식다름':edit(v=>v.defaultOutputFormat='minutes'),'기본형식null':edit(v=>v.defaultOutputFormat=null),
    '기본형식배열':edit(v=>v.defaultOutputFormat=['meeting']),'기본형식배열custom':edit(v=>v.defaultOutputFormat=['custom']),
    '내형식없음':edit(v=>delete v.customFormat), '내형식잘못':edit(v=>v.customFormat={}), '내형식문자':edit(v=>v.customFormat='x'),
    '지시null':edit(v=>v.customFormat.instruction=null),'지시없음':edit(v=>delete v.customFormat.instruction),
    '형식이름31':edit(v=>v.customFormat.name='가'.repeat(31)),'지시1001':edit(v=>v.customFormat.instruction='가'.repeat(1001)),
    '공백정규화':edit(v=>{v.customFormat.name='　\u00A0형식\uFEFF';v.customFormat.sections[0].title=' 요약 ';}),
    '서로게이트':edit(v=>{v.summaryModel='모델\ud800';v.customFormat.name='가\udc00나';}),
    '버전1':edit(v=>v.version=1),'버전3':edit(v=>v.version=3),'버전3지수':json(valid).replace('"version":2','"version":3e0'),
    '버전소수':edit(v=>v.version=2.5),'버전문자':edit(v=>v.version='2'),'버전불리언':edit(v=>v.version=true),
    '버전없음':edit(v=>delete v.version),'버전무한':json(valid).replace('"version":2','"version":1e400'),
    '다른파일':edit(v=>v.format='other'),'옛파일':edit(v=>{v.format='voicenote-project-settings';v.extra=1;}),
    '루트추가':edit(v=>v.apiKey='합성 값'),'추가긴이름':edit(v=>v['가'.repeat(50)]=0),
    '여러추가키순서':'{"z":0,"2":0,'+json(valid).slice(1),
    '저장위치null':edit(v=>v.storage=null),'저장위치배열':edit(v=>v.storage=[]),
    '저장위치칸없음':edit(v=>delete v.storage.audio),'저장위치숫자':edit(v=>v.storage.audio=1),'저장위치추가':edit(v=>v.storage.other=''),
    '저장위치1000':edit(v=>v.storage.audio='가'.repeat(1000)),'저장위치1001':edit(v=>v.storage.audio='가'.repeat(1001)),
    '저장위치상대경로':edit(v=>v.storage.audio='상대/경로'),
    '중복키':json(valid).replace('"version":2','"version":1,"version":2'),
    '중복형식':json(valid).replace('"format":"voicenote-settings"','"format":"other","format":"voicenote-settings"'),
    '깊은추가키':json(valid).replace(/}$/,',"extra":'+'['.repeat(80)+'0'+']'.repeat(80)+'}'),
    '정확히128KiB':pad(json(valid),desktop.MAX_BYTES),'BOM포함128KiB':'\uFEFF'+pad(json(valid),desktop.MAX_BYTES-3),
    '128KiB초과':pad(json(valid),desktop.MAX_BYTES+1),'BOM때문에초과':'\uFEFF'+pad(json(valid),desktop.MAX_BYTES-2),
    '빈파일':'','배열':'[]','null':'null','뒤쉼표':json(valid).slice(0,-1)+',}','뒤글자':json(valid)+'x',
    '작은따옴표':json(valid).replace('"format"',"'format'"),'주석':'// 주석\n'+json(valid),
    'UTF8오류':Buffer.from([0xC3,0x28]),'UTF16':Buffer.from(json(valid),'utf16le'),
  };
  const files = Object.entries(cases).map(([name,text])=>{const file=path.join(work,name+'.json');fs.writeFileSync(file,text);return file;});
  const mobile = new Map(java(['--verdict',...files]).trim().split(/\r?\n/).map(line=>{const row=JSON.parse(line);return [row.file,row];}));
  for(const file of files){
    let expected;try{const value=phone(desktop.parseSettingsFile(fs.readFileSync(file)));expected={ok:true,value:{format:desktop.FORMAT,version:desktop.VERSION,...value}};}catch(error){expected={ok:false,message:error.message};}
    const {file: label,...actual}=mobile.get(path.basename(file));assert.deepEqual(actual,expected,label);
  }
  console.log('설정 2판 호환 사례 '+files.length+'건 일치');
});
