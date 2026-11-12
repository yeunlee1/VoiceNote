// 휴대폰 화면용 todos.js와 네이티브 Todos.java가 데스크톱 할일정리.js와 같은 참석자 번호·이름순·이어 주기·나 판정 결과를 내는지 검증한다.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const rules = require('../../../desktop/앱/할일정리.js');
const { android, javac, java } = require('./자바도구.cjs');

const b64 = value => value === null ? '-' : Buffer.from(value, 'utf8').toString('base64');
const un64 = value => value === '-' ? null : Buffer.from(value, 'base64').toString('utf8');
const row = item => `${b64(item.task)}:${b64(item.owner)}:${b64(item.due)}:${item.done ? 1 : 0}`;
const rows = items => items.map(row).join(',');
const item = (task, owner = null, due = null, done = false) => ({ task, owner, due, done });
const minutes = items => ({ actions: items.map(({ task, owner, due }) => ({ task, owner, due })) });

test('휴대폰 화면용 todos.js는 데스크톱 할일정리.js와 같은 파일이다', () => {
  assert.deepEqual(fs.readFileSync(path.join(__dirname, '..', 'assets', 'todos.js')), fs.readFileSync(path.join(__dirname, '../../../desktop/앱/할일정리.js')));
});

test('네이티브 Todos는 데스크톱과 같은 참석자·이름순·이어 주기·나 판정 결과를 낸다', () => {
  const peopleCases = ['김민수 팀장, 박서연，이도현、최유진;정하늘\n오세훈', ' , 김민수,, 김민수 ,', '', Array.from({ length: 25 }, (_, i) => `사람${i}`).join(','), `${'가'.repeat(201)},나`, ' 김민수　,박서연'];
  const sortCases = [
    [item('가', '최유진'), item('나'), item('다', '김민수'), item('라', '  '), item('마', '김민수'), item('바', '박서연')],
    [item('가', '이도현'), item('나', '이 도현'), item('다', '강 대리'), item('라', '가나다'), item('마', '김민수 팀장'), item('바', '김민수')],
    [],
  ];
  const orderCases = [
    [false, [item('둘째', '최유진', null, true), item('첫째', '김민수')], [item('둘째', '최유진'), item('첫째', '김민수')]],
    [true, [item('둘째', '최유진'), item('첫째', '김민수')], [item('둘째', '최유진'), item('첫째', '김민수')]],
    [false, [item('둘째', '최유진'), item('첫째', '김민수')], [item('둘째'), item('첫째', '김민수')]],
    [false, [item('둘째', null, null, true), item('첫째', '김민수')], [item('둘째', ''), item('첫째', ' 김민수 ')]],
  ];
  const carryCases = [
    [true, [item('일정 공유', null, '11월 12일'), item('사라질 일')], [item('일정 공유', '박서연', '11월 12일', true), item('사라질 일', '김민수')], [item('일정 공유', null, '11월 12일'), item('새 일')]],
    [false, [item('일정 공유', null, '11월 12일')], [item('일정 공유', '박서연', '11월 12일', true)], [item('일정 공유', null, '11월 15일')]],
    [false, [item('일정 공유', '김민수')], [item('일정 공유', '김민수', '11월 20일')], [item('일정 공유', '이대리')]],
    [false, [item('일정 공유', '김민수')], [item('일정 공유', '김민수', null, true)], [item('일정 공유', '이대리')]],
    [false, [item('일정 공유')], [item('수정본 공유까지 마치기')], [item('일정  공유')]],
    [false, [item('확인'), item('확인')], [item('확인', '김민수', null, true), item('확인', '박서연')], [item('확인'), item('확인')]],
    [false, [item('확인')], [item('확인', '김민수')], [item('확인'), item('확인')]],
    [false, [item('일정 공유')], [item('일정 공유')], [item('전혀 다른 일')]],
    [false, [item('견적 요청')], [item('A사 견적 요청', '김민수', null, true)], [item('견적 요청'), item('A사 견적 요청')]],
    [false, [item('일', '')], [item('일', null, '11월 1일')], [item('일', '이대리')]],
    [false, [item('일', ' 김민수 ')], [item('일', '김민수', null, true)], [item('일', ' 김민수 ')]],
  ];
  // 참석자, 할 일, 이 회의에 저장된 선택, 설정의 내 이름이다. 후보·나·내가 안 끝낸 일의 수를 대조한다.
  const meCases = [
    ['박서연, 김 민수, 김  민수, 이도현', [item('일', '다른 사람')], null, null],
    ['', [item('가', '김 민수'), item('나'), item('다', ' 박서연 '), item('라', '김  민수'), item('마', '  ')], null, '박서연'],
    ['', Array.from({ length: 25 }, (_, i) => item(`일${i}`, `사람${i}`)), '사람24', '사람3'],
    ['박서연 대리, 김민수', [item('가', '박서연 대리'), item('나', '김민수'), item('다', '김민수', null, true)], '김민수', '박서연 대리'],
    ['박서연 대리, 김민수', [item('가', '박서연 대리'), item('나', '김민수')], '이도현', ' 박서연　 대리 '],
    ['박서연 대리, 김민수', [item('가', '박서연 대리')], null, '박서연'],
    ['박서연 대리', [item('가', '박서연 대리'), item('나', '박서연 대리, 김민수')], null, '박서연 대리'],
    ['', [item('가'), item('나')], '박서연', '박서연'],
    ['', [], null, null],
  ];
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'vn-todos-'));
  try {
    const sources = ['JsonText', 'Todos'].map(name => path.join(android, 'src/kr/local/meetingjournal', `${name}.java`));
    javac(['-encoding', 'UTF-8', '-d', work, ...sources, path.join(android, 'tests', 'TodosTest.java')]);
    const input = path.join(work, 'in.txt'), output = path.join(work, 'out.txt');
    fs.writeFileSync(input, [
      ...peopleCases.map(value => `P ${b64(value)}`),
      ...sortCases.map(items => `S ${rows(items)}`),
      ...orderCases.map(([finalized, items, ai]) => `O ${finalized ? 1 : 0} ${rows(items)} ${rows(ai)}`),
      ...carryCases.map(([finalized, ai, edits, next]) => `C ${finalized ? 1 : 0} ${rows(ai)} ${rows(edits)} ${rows(next)}`),
      ...meCases.map(([participants, items]) => `K ${b64(participants)} ${rows(items)}`),
      ...meCases.map(([participants, items, saved, settings]) => `M ${b64(participants)} ${rows(items)} ${b64(saved)} ${b64(settings)}`),
    ].join('\n') + '\n');
    java(['-Dfile.encoding=UTF-8', '-cp', work, 'kr.local.meetingjournal.TodosTest', input, output]);
    const results = fs.readFileSync(output, 'utf8').split('\n').slice(0, -1);
    assert.equal(results.length, peopleCases.length + sortCases.length + orderCases.length + carryCases.length + meCases.length * 2);
    let at = 0;
    for (const value of peopleCases) assert.deepEqual(results[at++].split(',').filter(Boolean).map(un64), rules.people(value), JSON.stringify(value));
    const order = items => rules.sorted(items.map((entry, index) => ({ ...entry, index }))).map(entry => entry.index).join(',');
    for (const items of sortCases) assert.equal(results[at++], order(items), JSON.stringify(items));
    for (const [finalized, items, ai] of orderCases) {
      const applied = rules.apply(minutes(ai), { finalized, items }).actions.map(action => items.findIndex(entry => entry.task === action.task)).join(',');
      assert.equal(results[at++], applied, JSON.stringify({ finalized, items }));
    }
    for (const [finalized, ai, edits, next] of carryCases) {
      const carried = rules.carryOver(minutes(ai), { finalized, items: edits }, minutes(next));
      assert.equal(results[at++], carried ? `${carried.finalized ? 1 : 0};${rows(carried.items)}` : 'null', JSON.stringify({ ai, edits, next }));
    }
    for (const [participants, items] of meCases) assert.deepEqual(results[at++].split(',').filter(Boolean).map(un64), rules.candidates(participants, items).map(entry => entry.name), JSON.stringify(participants));
    for (const [participants, items, saved, settings] of meCases) {
      const me = rules.resolveMe(rules.candidates(participants, items), saved, settings), open = rules.mineOpen(participants, items, saved, settings);
      assert.equal(results[at++], `${b64(me ? me.name : null)};${open === null ? 'null' : open}`, JSON.stringify({ participants, saved, settings }));
    }
  } finally { fs.rmSync(work, { recursive: true, force: true }); }
});
