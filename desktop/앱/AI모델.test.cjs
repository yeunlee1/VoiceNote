// 요약 모델 목록, 모델별 요청 값, OpenAI 사용량 해석을 검증한다.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const models = require('./AI모델.cjs');

test('GPT-6.1 Sol을 기본으로 공식 문서로 확인한 세 모델만 제공한다', () => {
  const list = models.summaryModels();
  assert.equal(models.DEFAULT_SUMMARY_MODEL, 'gpt-6.1-sol');
  assert.deepEqual(list.map(item => item.id), ['gpt-6.1-sol', 'gpt-6-luna', 'gpt-6-astra']);
  assert.equal(new Set(list.map(item => item.label)).size, list.length);
  for (const item of list) {
    assert.equal(item.maxOutputTokens, 32000);
    assert.ok(item.maxOutputTokens > 12000 && item.maxOutputTokens <= item.modelMaxOutputTokens);
    assert.equal(item.reasoningEffort, 'medium');
  }
});

test('목록을 바꿔도 내부 목록은 바뀌지 않는다', () => {
  const list = models.summaryModels();
  list[0].maxOutputTokens = 1;
  assert.equal(models.summaryModels()[0].maxOutputTokens, 32000);
});

test('모델별 요청 값에는 temperature와 top_p를 넣지 않고 모르는 모델은 대체하지 않는다', () => {
  const options = models.requestOptions('gpt-6-astra');
  assert.deepEqual(options, { model: 'gpt-6-astra', max_output_tokens: 32000, reasoning: { effort: 'medium' } });
  assert.equal('temperature' in options || 'top_p' in options, false);
  assert.equal(models.requestOptions('gpt-unknown'), null);
  assert.equal(models.requestOptions(undefined), null);
  assert.equal(models.findSummaryModel('GPT-6-SOL'), null);
});

test('캐시와 추론 토큰은 포함 내역으로만 읽고 합계에 다시 더하지 않는다', () => {
  const usage = models.responseUsage({ input_tokens: 1000, input_tokens_details: { cached_tokens: 400, cache_write_tokens: 10 },
    output_tokens: 800, output_tokens_details: { reasoning_tokens: 600 }, total_tokens: 1800 });
  assert.deepEqual(usage, { inputTokens: 1000, outputTokens: 800, totalTokens: 1800, cachedInputTokens: 400, reasoningTokens: 600 });
});

test('합계가 없으면 입력과 출력으로 계산하고 잘못된 사용량은 없는 것으로 본다', () => {
  assert.equal(models.responseUsage({ input_tokens: 5, output_tokens: 7 }).totalTokens, 12);
  assert.equal(models.responseUsage({ input_tokens: 5, output_tokens: 7 }).cachedInputTokens, null);
  assert.equal(models.responseUsage(null), null);
  assert.equal(models.responseUsage({ input_tokens: -1, output_tokens: 7 }), null);
  assert.equal(models.responseUsage({ input_tokens: 1.5, output_tokens: 7 }), null);
  assert.equal(models.responseUsage({ output_tokens: 7 }), null);
});

test('전사 사용량은 초 단위와 토큰 단위를 구분한다', () => {
  assert.deepEqual(models.transcriptionUsage({ type: 'duration', seconds: 61.5 }), { usage: null, audioSeconds: 61.5 });
  assert.deepEqual(models.transcriptionUsage({ type: 'tokens', input_tokens: 30, output_tokens: 20, total_tokens: 50 }).usage,
    { inputTokens: 30, outputTokens: 20, totalTokens: 50, cachedInputTokens: null, reasoningTokens: null });
  assert.deepEqual(models.transcriptionUsage(undefined), { usage: null, audioSeconds: null });
});
