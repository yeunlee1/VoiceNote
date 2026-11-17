// 회의록·핵심 요약·업무 정리 형식이 같은 요약 자료를 형식에 맞는 제목과 순서로 보여 주는지 검증한다.
const test = require('node:test');
const assert = require('node:assert/strict');
const Flow = require('../assets/flow.js');

const minutes = { overview: '전체 방향 | 먼저 구현', topics: [{ title: '문서 연결', points: ['이동을 단순하게 합니다.'] }], decisions: ['기존 DB 활용'], actions: [{ task: '화면 기획', owner: null, due: null }, { task: '양식 초안', owner: '화면 담당', due: '10월 7일' }], openQuestions: ['탭 방식은 미정'] };
const titles = format => Flow.minutesSections(format, minutes).map(s => s.title);
const I = (text, details = []) => ({ text, details });

test('형식 값이 없거나 모르는 값이면 기존 회의록으로 읽는다', () => {
  assert.equal(Flow.outputFormat(undefined), 'meeting');
  assert.equal(Flow.outputFormat('minutes'), 'meeting');
  assert.equal(Flow.outputFormat('__proto__'), 'meeting');
  assert.deepEqual(Object.values(Flow.FORMAT_LABELS), ['회의록', '핵심 요약', '업무 정리', '내 형식']);
});

test('회의록은 핵심 요약 바로 다음에 다음 할 일을 보여 주고 정해지지 않은 담당·기한을 쓰지 않는다', () => {
  assert.deepEqual(titles('meeting'), ['핵심 요약', '다음 할 일', '합의된 방향', '', '미확정 사항']);
  assert.deepEqual(Flow.minutesSections('meeting', minutes)[1].items, [I('화면 기획'), I('양식 초안 · 담당 화면 담당 · 기한 10월 7일')]);
});

test('핵심 요약은 개요와 주요 내용을 앞에 둔다', () => {
  assert.deepEqual(titles('summary'), ['핵심 요약', '주요 내용', '합의된 방향', '다음 할 일', '미확정 사항']);
  assert.equal(Flow.minutesSections('summary', minutes)[1].topics[0].title, '문서 연결');
});

test('업무 정리는 할 일을 먼저 보이고 없는 담당·기한은 미정으로 남긴다', () => {
  const sections = Flow.minutesSections('tasks', minutes);
  assert.deepEqual(titles('tasks'), ['업무 요약', '할 일', '확인 필요', '결정 사항', '관련 논의']);
  assert.deepEqual(sections[1].items, [I('화면 기획 · 담당 미정 · 기한 미정'), I('양식 초안 · 담당 화면 담당 · 기한 10월 7일')]);
  assert.equal(Flow.minutesSections('tasks', { ...minutes, actions: [] })[1].empty, '정해진 할 일이 없습니다.');
});

test('옛 문자열 결과도 핵심 요약·주제·결정·미확정을 항목 배열로 넘긴다', () => {
  const sections = Flow.minutesSections('meeting', minutes);
  assert.deepEqual(sections[0], { type: 'overview', title: '핵심 요약', items: [I('전체 방향', ['먼저 구현'])] });
  assert.deepEqual(sections[2].items, [I('기존 DB 활용')]);
  assert.deepEqual(sections[3].topics, [{ title: '문서 연결', points: [I('이동을 단순하게 합니다.')] }]);
  assert.deepEqual(sections[4].items, [I('탭 방식은 미정')]);
});

test('새 구조 결과는 하위 항목까지 그대로 넘기고 절 순서·제목은 같다', () => {
  const fresh = { overview: [I('전체 방향', ['시안 A 먼저'])], topics: [{ title: '양식', points: [I('공통 양식', ['이유: 혼선'])] }], decisions: [I('양식 — 공통', ['적용: 모든 부서'])], actions: [], openQuestions: [I('기한', ['미정이면 지연'])] };
  for (const format of ['meeting', 'summary', 'tasks']) assert.deepEqual(Flow.minutesSections(format, fresh).map(s => s.title), titles(format));
  const sections = Flow.minutesSections('summary', fresh);
  assert.deepEqual(sections[0].items, fresh.overview);
  assert.deepEqual(sections[1].topics[0].points, fresh.topics[0].points);
  assert.deepEqual(sections[2].items, fresh.decisions);
  assert.deepEqual(sections[4].items, fresh.openQuestions);
});

test('내 형식도 핵심 요약은 항목으로, 할 일은 한 줄 항목으로 넘긴다', () => {
  const custom = { name: '주간', sections: [{ key: 'overview', title: '요약' }, { key: 'actions', title: '할 일' }, { key: 'decisions', title: '결정' }], instruction: '' };
  const sections = Flow.minutesSections('custom', minutes, custom);
  assert.deepEqual(sections[0], { type: 'overview', title: '요약', items: [I('전체 방향', ['먼저 구현'])] });
  assert.deepEqual(sections[1].items, [I('화면 기획 · 담당 미정 · 기한 미정'), I('양식 초안 · 담당 화면 담당 · 기한 10월 7일')]);
  assert.deepEqual(sections[2].items, [I('기존 DB 활용')]);
  assert.equal(sections[2].empty, '없음');
});
