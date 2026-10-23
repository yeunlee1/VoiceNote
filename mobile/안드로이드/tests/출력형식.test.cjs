// 회의록·핵심 요약·업무 정리 형식이 같은 요약 자료를 형식에 맞는 제목과 순서로 보여 주는지 검증한다.
const test = require('node:test');
const assert = require('node:assert/strict');
const Flow = require('../assets/flow.js');

const minutes = { overview: '전체 방향 | 먼저 구현', topics: [{ title: '문서 연결', points: ['이동을 단순하게 합니다.'] }], decisions: ['기존 DB 활용'], actions: [{ task: '화면 기획', owner: null, due: null }, { task: '양식 초안', owner: '화면 담당', due: '10월 7일' }], openQuestions: ['탭 방식은 미정'] };
const titles = format => Flow.minutesSections(format, minutes).map(s => s.title);

test('형식 값이 없거나 모르는 값이면 기존 회의록으로 읽는다', () => {
  assert.equal(Flow.outputFormat(undefined), 'meeting');
  assert.equal(Flow.outputFormat('minutes'), 'meeting');
  assert.equal(Flow.outputFormat('__proto__'), 'meeting');
  assert.deepEqual(Object.values(Flow.FORMAT_LABELS), ['회의록', '핵심 요약', '업무 정리', '내 형식']);
});

test('회의록은 기존 화면 순서를 유지하고 정해지지 않은 담당·기한을 쓰지 않는다', () => {
  assert.deepEqual(titles('meeting'), ['핵심 요약', '합의된 방향', '', '다음 할 일', '미확정 사항']);
  assert.deepEqual(Flow.minutesSections('meeting', minutes)[3].items, ['화면 기획', '양식 초안 · 담당 화면 담당 · 기한 10월 7일']);
});

test('핵심 요약은 개요와 주요 내용을 앞에 둔다', () => {
  assert.deepEqual(titles('summary'), ['핵심 요약', '주요 내용', '합의된 방향', '다음 할 일', '미확정 사항']);
  assert.equal(Flow.minutesSections('summary', minutes)[1].topics[0].title, '문서 연결');
});

test('업무 정리는 할 일을 먼저 보이고 없는 담당·기한은 미정으로 남긴다', () => {
  const sections = Flow.minutesSections('tasks', minutes);
  assert.deepEqual(titles('tasks'), ['업무 요약', '할 일', '확인 필요', '결정 사항', '관련 논의']);
  assert.deepEqual(sections[1].items, ['화면 기획 · 담당 미정 · 기한 미정', '양식 초안 · 담당 화면 담당 · 기한 10월 7일']);
  assert.equal(Flow.minutesSections('tasks', { ...minutes, actions: [] })[1].empty, '정해진 할 일이 없습니다.');
});
