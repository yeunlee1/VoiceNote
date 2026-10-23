// 회의 한 건의 AI 호출 사용량을 모델별로 누적하고 옛 기록을 안전하게 읽는 브라우저·Node 공용 도구다.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MeetingAiUsage = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const kinds = ['summary', 'transcription'];
  const tokenFields = ['inputTokens', 'outputTokens', 'totalTokens', 'cachedInputTokens', 'reasoningTokens'];
  const count = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
  const seconds = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
  const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value) ? value : null;
  const modelId = value => typeof value === 'string' && /^[A-Za-z0-9._:-]{1,100}$/.test(value) ? value : null;

  function emptyEntry(kind, model) {
    return { kind, model, requests: 0, measuredRequests: 0, unknownRequests: 0, inputTokens: 0, outputTokens: 0,
      totalTokens: 0, cachedInputTokens: 0, reasoningTokens: 0, audioSeconds: 0 };
  }
  function usageOf(value) {
    // 입력·출력 토큰이 모두 있어야 측정된 사용량으로 본다. 캐시·추론 토큰은 그 안에 포함된 내역이다.
    const usage = plain(value);
    const inputTokens = count(usage?.inputTokens), outputTokens = count(usage?.outputTokens);
    if (inputTokens === null || outputTokens === null) return null;
    return { inputTokens, outputTokens, totalTokens: count(usage.totalTokens) ?? inputTokens + outputTokens,
      cachedInputTokens: count(usage.cachedInputTokens) ?? 0, reasoningTokens: count(usage.reasoningTokens) ?? 0 };
  }
  function normalizeEntry(value) {
    const item = plain(value);
    const model = modelId(item?.model);
    if (!model) return null;
    const kind = kinds.includes(item.kind) ? item.kind : item.kind === undefined ? 'summary' : null;
    if (!kind) return null;
    const entry = emptyEntry(kind, model);
    const requests = count(item.requests) ?? 0;
    const hasTokens = count(item.inputTokens) !== null && count(item.outputTokens) !== null;
    // 측정 건수가 없는 옛 기록은 토큰 값이 있으면 모두 측정, 없으면 모두 미확인으로 해석한다.
    let measured = count(item.measuredRequests);
    let unknown = count(item.unknownRequests);
    if (measured === null && unknown === null) {
      measured = hasTokens || seconds(item.audioSeconds) > 0 ? requests : 0;
      unknown = requests - measured;
    }
    entry.measuredRequests = measured ?? 0;
    entry.unknownRequests = unknown ?? 0;
    entry.requests = Math.max(requests, entry.measuredRequests + entry.unknownRequests);
    for (const field of tokenFields) entry[field] = count(item[field]) ?? 0;
    if (count(item.totalTokens) === null) entry.totalTokens = entry.inputTokens + entry.outputTokens;
    entry.audioSeconds = seconds(item.audioSeconds) ?? 0;
    return entry;
  }
  function normalize(value) {
    const list = Array.isArray(value) ? value : Array.isArray(plain(value)?.usage) ? value.usage : [];
    const result = [];
    for (const item of list) {
      const entry = normalizeEntry(item);
      if (!entry) continue;
      const same = result.find(other => other.kind === entry.kind && other.model === entry.model);
      if (!same) { result.push(entry); continue; }
      for (const field of ['requests', 'measuredRequests', 'unknownRequests', ...tokenFields, 'audioSeconds']) same[field] += entry[field];
    }
    return result.slice(0, 50);
  }
  const callId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{8,80}$/.test(value) ? value : null;
  function callIdsOf(value) {
    const ids = Array.isArray(value) ? [...new Set(value.map(callId).filter(Boolean))] : [];
    return ids.slice(-1000);
  }
  function normalizeAnalysis(value) {
    const analysis = plain(value);
    if (!analysis) return null;
    return { summaryModel: modelId(analysis.summaryModel), usage: normalize(analysis.usage), callIds: callIdsOf(analysis.callIds) };
  }
  function record(analysis, aiCall) {
    // 같은 callId 응답(같은 요청 식별자 재전송의 캐시 응답 등)은 한 번만 센다.
    const result = normalizeAnalysis(analysis) || { summaryModel: null, usage: [], callIds: [] };
    const call = plain(aiCall);
    if (!call || call.sent !== true) return result;
    const id = callId(call.callId);
    if (id && result.callIds.includes(id)) return result;
    const usage = add(result.usage, call);
    if (usage.reduce((sum, item) => sum + item.requests, 0) === result.usage.reduce((sum, item) => sum + item.requests, 0)) return result;
    return { summaryModel: call.kind === 'summary' ? call.model : result.summaryModel, usage,
      callIds: id ? callIdsOf([...result.callIds, id]) : result.callIds };
  }
  function add(ledger, aiCall) {
    // OpenAI로 전송한 호출만 센다. 사용량이 없는 실패는 0이 아니라 미확인 건수로 남긴다.
    const result = normalize(ledger);
    const call = plain(aiCall);
    if (!call || call.sent !== true || !kinds.includes(call.kind) || !modelId(call.model)) return result;
    let entry = result.find(item => item.kind === call.kind && item.model === call.model);
    if (!entry) { entry = emptyEntry(call.kind, call.model); result.push(entry); }
    entry.requests++;
    const usage = usageOf(call.usage), audio = seconds(call.audioSeconds);
    if (!usage && audio === null) { entry.unknownRequests++; return result; }
    entry.measuredRequests++;
    if (usage) for (const field of tokenFields) entry[field] += usage[field];
    if (audio !== null) entry.audioSeconds += audio;
    return result;
  }
  const number = value => value.toLocaleString('ko-KR');
  function describe(value) {
    const entry = normalizeEntry(value);
    if (!entry) return null;
    const kindLabel = entry.kind === 'transcription' ? '음성 전사' : '회의록 요약';
    const empty = entry.measuredRequests === 0 ? '미제공' : entry.kind === 'transcription' && entry.totalTokens === 0 ? '해당 없음' : '';
    const tokens = !empty;
    const audio = entry.audioSeconds > 0 ? `음성 ${Math.round(entry.audioSeconds * 10) / 10}초` : '';
    const parts = [];
    if (entry.cachedInputTokens) parts.push(`입력 중 캐시 ${number(entry.cachedInputTokens)}`);
    if (entry.reasoningTokens) parts.push(`출력 중 추론 ${number(entry.reasoningTokens)}`);
    return {
      kind: entry.kind,
      kindLabel,
      model: entry.model,
      requests: entry.requests,
      input: tokens ? number(entry.inputTokens) : empty,
      output: tokens ? number(entry.outputTokens) : empty,
      total: tokens ? number(entry.totalTokens) : empty,
      detail: [parts.length ? `${parts.join(' · ')} 포함` : '', audio].filter(Boolean).join(' · '),
      unknownText: entry.unknownRequests ? `${entry.unknownRequests}건은 사용량을 받지 못해 합계에서 빠졌습니다.` : '',
    };
  }
  return { add, record, normalize, normalizeAnalysis, describe, emptyEntry };
});
