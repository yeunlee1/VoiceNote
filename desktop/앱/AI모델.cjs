// 요약 모델 목록과 모델별 요청 값, OpenAI 응답 사용량 해석을 한곳에서 관리한다.
'use strict';

// 근거: developers.openai.com/api/docs/models/<id> (2026-10-02 확인). 세 모델 모두 Responses API·Structured Outputs를 지원하고 최대 출력은 128,000토큰이다.
// GPT-6.1 계열은 Sol만 있어 Luna·Astra는 GPT-6 판을 쓴다. 이전 기본 GPT-6 Sol과 GPT-5.6 Terra는 목록에서 뺐다.
const DEFAULT_SUMMARY_MODEL = 'gpt-6.1-sol';
const TRANSCRIPTION_MODEL = 'gpt-transcribe';
const SUMMARY_OUTPUT_TOKENS = 32000;
const catalog = Object.freeze([
  { id: 'gpt-6.1-sol', label: 'GPT-6.1 Sol (기본)', description: '기본 요약 모델입니다. 품질과 요금이 중간입니다.', modelMaxOutputTokens: 128000 },
  { id: 'gpt-6-luna', label: 'GPT-6 Luna', description: '가장 저렴하고 빠른 모델입니다. 긴 회의는 정리 품질을 확인하세요.', modelMaxOutputTokens: 128000 },
  { id: 'gpt-6-astra', label: 'GPT-6 Astra', description: '가장 정확하지만 요금이 Sol의 약 5배입니다.', modelMaxOutputTokens: 128000 },
].map(model => Object.freeze({
  ...model,
  maxOutputTokens: Math.min(SUMMARY_OUTPUT_TOKENS, model.modelMaxOutputTokens),
  reasoningEffort: 'medium',
})));

function summaryModels() {
  return catalog.map(model => ({ ...model }));
}
function findSummaryModel(id) {
  return typeof id === 'string' ? catalog.find(model => model.id === id) || null : null;
}
function requestOptions(id) {
  // 추론 강도가 none이 아니면 temperature·top_p를 보내지 않는다는 공식 지침에 따라 해당 값은 넣지 않는다.
  const model = findSummaryModel(id);
  if (!model) return null;
  return { model: model.id, max_output_tokens: model.maxOutputTokens, reasoning: { effort: model.reasoningEffort } };
}
const count = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value) ? value : null;
function responseUsage(raw) {
  // 캐시·추론 토큰은 입력·출력 토큰에 이미 포함된 세부 내역이므로 합계에 더하지 않는다.
  const usage = plain(raw);
  const inputTokens = count(usage?.input_tokens), outputTokens = count(usage?.output_tokens);
  if (inputTokens === null || outputTokens === null) return null;
  const total = count(usage.total_tokens);
  return {
    inputTokens,
    outputTokens,
    totalTokens: total ?? inputTokens + outputTokens,
    cachedInputTokens: count(plain(usage.input_tokens_details)?.cached_tokens),
    reasoningTokens: count(plain(usage.output_tokens_details)?.reasoning_tokens),
  };
}
function transcriptionUsage(raw) {
  // 전사 사용량은 공식 문서상 duration(초) 또는 tokens 형식으로 온다.
  const usage = plain(raw);
  if (usage?.type === 'duration' && typeof usage.seconds === 'number' && Number.isFinite(usage.seconds) && usage.seconds >= 0)
    return { usage: null, audioSeconds: usage.seconds };
  return { usage: responseUsage(usage), audioSeconds: null };
}

module.exports = {
  DEFAULT_SUMMARY_MODEL,
  TRANSCRIPTION_MODEL,
  SUMMARY_OUTPUT_TOKENS,
  summaryModels,
  findSummaryModel,
  requestOptions,
  responseUsage,
  transcriptionUsage,
};
