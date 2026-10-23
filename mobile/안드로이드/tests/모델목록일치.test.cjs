// Android 요약 모델 목록이 Windows 서버의 모델 목록·요청 상한과 같은지 검증한다.
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const models = require('../../../desktop/앱/AI모델.cjs');

test('Android와 Windows가 같은 기본 모델과 모델별 요청 상한을 쓴다', () => {
  const java = fs.readFileSync(path.join(__dirname, '../src/kr/local/meetingjournal/AiModels.java'), 'utf8');
  const android = [...java.matchAll(/new Model\("([^"]+)","([^"]+)","[^"]*",(\d+)\)/g)].map(match => ({ id: match[1], label: match[2], modelMaxOutputTokens: Number(match[3]) }));
  assert.deepEqual(android, models.summaryModels().map(({ id, label, modelMaxOutputTokens }) => ({ id, label, modelMaxOutputTokens })));
  assert.match(java, new RegExp(`DEFAULT_MODEL="${models.DEFAULT_SUMMARY_MODEL}"`));
  assert.match(java, new RegExp(`TRANSCRIPTION_MODEL="${models.TRANSCRIPTION_MODEL}"`));
  assert.match(java, new RegExp(`OUTPUT_TOKENS=${models.SUMMARY_OUTPUT_TOKENS};`));
});
