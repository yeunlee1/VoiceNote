// 할 일 담당자 맞추기의 참석자 나누기, 이름순 정렬, AI 결과와 사용자 수정본 합치기 규칙을 검증한다.
const test = require('node:test');
const assert = require('node:assert/strict');
const todos = require('./할일정리.js');

const action = (task, owner = null, due = null) => ({ task, owner, due });
const minutes = (...actions) => ({ overview: '요약', topics: [], decisions: [], actions, openQuestions: [] });

test('참석자는 쉼표·줄바꿈으로 나누고 공백으로는 나누지 않는다', () => {
  assert.deepEqual(todos.people('김민수 팀장, 박서연，이도현、최유진;정하늘\n오세훈'), ['김민수 팀장', '박서연', '이도현', '최유진', '정하늘', '오세훈']);
});

test('참석자의 빈칸과 중복은 빼고 20명까지만 번호를 붙인다', () => {
  assert.deepEqual(todos.people(' , 김민수,, 김민수 ,'), ['김민수']);
  assert.deepEqual(todos.people(''), []);
  assert.deepEqual(todos.people(null), []);
  assert.equal(todos.people(Array.from({ length: 25 }, (_, i) => `사람${i}`).join(',')).length, 20);
});

test('담당자 번호는 참석자 순서이고 명단에 없는 이름은 0이다', () => {
  const list = ['김민수', '박서연'];
  assert.equal(todos.ownerNumber('박서연', list), 2);
  assert.equal(todos.ownerNumber('화면 담당', list), 0);
  assert.equal(todos.ownerNumber(null, list), 0);
});

test('수정본이 없으면 AI 결과로 첫 항목을 만든다', () => {
  assert.deepEqual(todos.effective(minutes(action('일정 공유', '박서연', '11월 12일')), null), [{ task: '일정 공유', owner: '박서연', due: '11월 12일', done: false }]);
  assert.deepEqual(todos.effective({ overview: '내 형식' }, null), []);
});

test('수정본의 개수가 AI 결과와 다르면 믿지 않고 AI 결과를 쓴다', () => {
  const base = minutes(action('하나'), action('둘'));
  const broken = { finalized: false, items: [{ task: '하나', owner: null, due: null, done: true }] };
  assert.deepEqual(todos.effective(base, broken).map(item => item.done), [false, false]);
  assert.equal(todos.apply(base, broken), base);
});

test('이름은 가나다순이고 담당자 없는 일은 맨 뒤, 같은 사람은 원래 순서다', () => {
  const items = [
    { task: '가', owner: '최유진', due: null, done: false },
    { task: '나', owner: null, due: null, done: false },
    { task: '다', owner: '김민수', due: null, done: false },
    { task: '라', owner: '  ', due: null, done: false },
    { task: '마', owner: '김민수', due: null, done: false },
    { task: '바', owner: '박서연', due: null, done: false },
  ];
  assert.deepEqual(todos.sorted(items).map(item => item.task), ['다', '마', '바', '가', '나', '라']);
});

test('사람이 담당자를 맞춘 회의록은 이름순으로 합치고 완료 표시는 결과에 넣지 않는다', () => {
  const base = minutes(action('일정 공유'), action('발주 변경'), action('인증 확인'));
  const edits = { finalized: false, items: [
    { task: '일정 공유', owner: '최유진', due: null, done: false },
    { task: '발주 변경 수정', owner: '김민수', due: '11월 13일', done: true },
    { task: '인증 확인', owner: null, due: null, done: false },
  ] };
  assert.deepEqual(todos.apply(base, edits).actions, [action('발주 변경 수정', '김민수', '11월 13일'), action('일정 공유', '최유진'), action('인증 확인')]);
  assert.deepEqual(base.actions[0], action('일정 공유'));
});

test('체크만 한 회의록은 AI 순서를 바꾸지 않는다', () => {
  const base = minutes(action('둘째', '최유진'), action('첫째', '김민수'));
  const edits = { finalized: false, items: [{ task: '둘째', owner: '최유진', due: null, done: true }, { task: '첫째', owner: '김민수', due: null, done: false }] };
  assert.deepEqual(todos.apply(base, edits).actions.map(item => item.task), ['둘째', '첫째']);
});

test('맞추기 완료를 눌렀으면 담당자를 바꾸지 않았어도 이름순으로 정리한다', () => {
  const base = minutes(action('둘째', '최유진'), action('첫째', '김민수'));
  const edits = { finalized: true, items: [{ task: '둘째', owner: '최유진', due: null, done: false }, { task: '첫째', owner: '김민수', due: null, done: false }] };
  assert.deepEqual(todos.apply(base, edits).actions.map(item => item.task), ['첫째', '둘째']);
});

test('의견 반영으로 새 결과가 생기면 문장이 같은 일의 사람 수정과 체크를 잇는다', () => {
  const before = minutes(action('일정 공유', null, '11월 12일'), action('사라질 일'));
  const edits = { finalized: true, items: [{ task: '일정 공유', owner: '박서연', due: '11월 12일', done: true }, { task: '사라질 일', owner: '김민수', due: null, done: false }] };
  const next = todos.carryOver(before, edits, minutes(action('일정 공유', null, '11월 12일'), action('새 일')));
  assert.equal(next.finalized, true);
  assert.deepEqual(next.items, [{ task: '일정 공유', owner: '박서연', due: '11월 12일', done: true }, { task: '새 일', owner: null, due: null, done: false }]);
});

test('AI가 기한이나 담당을 바꾼 일은 끝났다는 표시를 잇지 않는다', () => {
  const before = minutes(action('일정 공유', null, '11월 12일'));
  const edits = { finalized: false, items: [{ task: '일정 공유', owner: '박서연', due: '11월 12일', done: true }] };
  assert.deepEqual(todos.carryOver(before, edits, minutes(action('일정 공유', null, '11월 15일'))).items, [{ task: '일정 공유', owner: '박서연', due: '11월 15일', done: false }]);
});

test('정렬은 원본 배열을 바꾸지 않아 화면 줄의 원래 위치로 저장할 수 있다', () => {
  const items = [{ task: '가', owner: '최유진', due: null, done: false, index: 0 }, { task: '나', owner: '김민수', due: null, done: false, index: 1 }];
  assert.deepEqual(todos.sorted(items).map(item => item.index), [1, 0]);
  assert.deepEqual(items.map(item => item.index), [0, 1]);
});

test('사람이 고치지 않은 담당자는 의견 반영으로 AI가 고친 값을 따른다', () => {
  const before = minutes(action('일정 공유', '김민수'));
  const edits = { finalized: false, items: [{ task: '일정 공유', owner: '김민수', due: '11월 20일', done: false }] };
  assert.deepEqual(todos.carryOver(before, edits, minutes(action('일정 공유', '이대리'))).items, [{ task: '일정 공유', owner: '이대리', due: '11월 20일', done: false }]);
  assert.equal(todos.carryOver(before, { finalized: false, items: [{ task: '일정 공유', owner: '김민수', due: null, done: true }] }, minutes(action('일정 공유', '이대리'))), null, '체크만 했으면 AI의 새 담당자를 그대로 쓴다');
});

test('사람이 고친 문장은 AI가 원래 문장을 다시 내면 그대로 잇는다', () => {
  const before = minutes(action('일정 공유'));
  const edits = { finalized: false, items: [{ task: '수정본 공유까지 마치기', owner: null, due: null, done: false }] };
  assert.equal(todos.carryOver(before, edits, minutes(action('일정  공유'))).items[0].task, '수정본 공유까지 마치기');
});

test('이어 줄 내용이 없으면 수정본을 만들지 않는다', () => {
  const before = minutes(action('일정 공유'));
  assert.equal(todos.carryOver(before, null, minutes(action('일정 공유'))), null);
  assert.equal(todos.carryOver(before, { finalized: false, items: [{ task: '일정 공유', owner: null, due: null, done: false }] }, minutes(action('전혀 다른 일'))), null);
});

test('같은 문장이 여럿이면 어느 일인지 모호하므로 잇지 않는다', () => {
  const before = minutes(action('확인'), action('확인'));
  const edits = { finalized: false, items: [{ task: '확인', owner: '김민수', due: null, done: true }, { task: '확인', owner: '박서연', due: null, done: false }] };
  assert.equal(todos.carryOver(before, edits, minutes(action('확인'), action('확인'))), null);
  assert.equal(todos.carryOver(minutes(action('확인')), { finalized: false, items: [{ task: '확인', owner: '김민수', due: null, done: false }] }, minutes(action('확인'), action('확인'))), null);
});

test('저장 전 확인은 앞뒤 공백을 지우고 빈 담당자·기한을 없음으로 바꾼다', () => {
  assert.deepEqual(todos.validate({ finalized: true, items: [{ task: ' 일정 공유 ', owner: ' ', due: ' 11월 12일 ', done: true }] }, 1), { version: 1, finalized: true, items: [{ task: '일정 공유', owner: null, due: '11월 12일', done: true }] });
});

test('저장 전 확인은 잘못된 형식을 거절한다', () => {
  const item = { task: '일', owner: null, due: null, done: false };
  for (const [data, count] of [
    [null, 1], [[], 1], [{ finalized: false }, 1], [{ finalized: 'yes', items: [item] }, 1], [{ finalized: false, items: [item], extra: 1 }, 1],
    [{ finalized: false, items: [item] }, 2], [{ finalized: false, items: [{ ...item, task: ' ' }] }, 1], [{ finalized: false, items: [{ ...item, task: 'x'.repeat(2001) }] }, 1],
    [{ finalized: false, items: [{ ...item, owner: 'x'.repeat(201) }] }, 1], [{ finalized: false, items: [{ ...item, due: 3 }] }, 1], [{ finalized: false, items: [{ ...item, done: 'no' }] }, 1], [{ finalized: false, items: [{ ...item, more: 1 }] }, 1],
  ]) assert.throws(() => todos.validate(data, count), /할 일/);
});

test('이전 일 하나가 새 일 둘의 후보이면 어느 쪽에도 잇지 않는다', () => {
  const before = minutes(action('견적 요청'));
  const edits = { finalized: false, items: [{ task: 'A사 견적 요청', owner: '김민수', due: null, done: true }] };
  assert.equal(todos.carryOver(before, edits, minutes(action('견적 요청'), action('A사 견적 요청'))), null);
});

test('AI가 담당자를 빈 글자나 공백이 붙은 이름으로 주어도 사람이 고친 것으로 보지 않는다', () => {
  const base = minutes(action('둘째', ''), action('첫째', ' 김민수 '));
  const edits = { finalized: false, items: [{ task: '둘째', owner: null, due: null, done: true }, { task: '첫째', owner: '김민수', due: null, done: false }] };
  assert.deepEqual(todos.apply(base, edits).actions.map(item => item.task), ['둘째', '첫째'], '체크만 했으면 순서를 바꾸지 않는다');
  const carried = todos.carryOver(minutes(action('일', '')), { finalized: false, items: [{ task: '일', owner: null, due: '11월 1일', done: false }] }, minutes(action('일', '이대리')));
  assert.equal(carried.items[0].owner, '이대리', '사람이 고치지 않은 담당자는 AI의 새 값을 따른다');
  assert.deepEqual(todos.effective(minutes(action('일', '  ')), null)[0], { task: '일', owner: null, due: null, done: false });
});

test('AI 결과에 빈 문장이 있어도 그 줄 때문에 나머지 저장이 막히지 않는다', () => {
  const actions = [action(''), action('발주 변경')];
  const item = (task, done = false) => ({ task, owner: null, due: null, done });
  assert.equal(todos.validate({ finalized: false, items: [item('', true), item('발주 변경')] }, 2, actions).items[0].done, true);
  assert.throws(() => todos.validate({ finalized: false, items: [item(''), item(' ')] }, 2, actions), /할 일/, '원래 문장이 있는 줄을 비울 수는 없다');
});
