// 회의 문서 변환기가 두 앱 공통 예시와 같은 Markdown·텍스트를 만드는지 검증한다.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { markdown, plainText } = require('./회의문서.cjs');
const { cases } = require('../tests/fixtures/회의문서-예시.json');

test('공통 예시의 모든 경우에서 markdown이 예시와 같다', () => {
  for (const item of cases) assert.equal(markdown(item.record), item.markdown, item.name);
});

test('공통 예시의 모든 경우에서 plainText가 예시와 같다', () => {
  for (const item of cases) assert.equal(plainText(item.record), item.text, item.name);
});

test('projectName이 없으면 프로젝트 줄을 쓰지 않는다', () => {
  const { record } = cases.find(item => item.name === '회의록');
  assert.equal('projectName' in record, false);
  assert.doesNotMatch(markdown(record), /프로젝트:/);
  assert.match(markdown({ ...record, projectName: '홈페이지 개편' }), /^프로젝트: 홈페이지 개편$/m);
});
