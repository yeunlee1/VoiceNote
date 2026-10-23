// 회의 시작 조건과 사용량 표시를 화면과 테스트가 함께 쓰는 순수 함수로 판정한다.
(function (root) {
  const NOTES_LIMIT = 4000, EXHAUSTED_MESSAGE = '새로운 API키를 등록하세요.';
  const Formats = typeof module === 'object' && module.exports ? require('./formats.js') : root.MeetingFormats;
  function canAnalyze(c) {
    // 체험권한 상태가 있으면 그것으로, 이전 응답이면 개인 키 등록 여부로 판단한다.
    return c && typeof c.accessMode === 'string' ? !c.mustRegister : !!(c && c.keyConfigured);
  }
  function accessText(c) {
    const labels = { saved: '이 휴대폰에 저장된 키를 사용합니다.', session: '앱을 닫을 때까지만 쓰는 키가 등록되어 있습니다.' };
    switch (c.accessMode) {
      case 'personal': return { chip: '준비됨', status: labels[c.keySource] || labels.saved };
      case 'unlimited': return { chip: '준비됨', status: '설치본의 기본 키를 횟수 제한 없이 사용합니다.' };
      case 'trial': return { chip: `체험 ${c.trialRemaining}회`, status: `설치본의 기본 키로 분석을 ${c.trialLimit}회까지 쓸 수 있습니다. 남은 횟수 ${c.trialRemaining}회.` };
      case 'exhausted': return { chip: '키 필요', status: c.trialError || EXHAUSTED_MESSAGE };
      default: return c.keyConfigured ? { chip: '준비됨', status: labels[c.keySource] || labels.saved } : { chip: '키 필요', status: 'API 키가 없습니다. 키를 등록해야 회의를 시작할 수 있습니다.' };
    }
  }
  function startBlockers(s) {
    const reasons = [];
    if (s.active) reasons.push({ id: 'active', text: '진행 중인 회의가 끝나야 새 회의를 시작할 수 있습니다.' });
    if (!s.keyConfigured) reasons.push({ id: 'key', text: s.trialExhausted ? EXHAUSTED_MESSAGE : 'AI 설정에서 API 키를 등록하세요.' });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(s.date || ''))) reasons.push({ id: 'date', text: '회의 날짜를 선택하세요.' });
    if (String(s.notes || '').length > NOTES_LIMIT) reasons.push({ id: 'notes', text: '상세 안건·배경은 4,000자 이내로 줄여 주세요.' });
    if (s.customMissing) reasons.push({ id: 'format', text: '출력 형식의 예시에서 내 형식을 먼저 저장하세요.' });
    if (s.opened) reasons.push({ id: "opened", text: "지난 회의를 닫고 새 회의를 준비하세요." });
    if (s.permissionPending || s.filePending) reasons.push({ id: "pending", text: "권한 요청이나 파일 선택을 먼저 마쳐 주세요." });
    if (s.modelError) reasons.push({ id: "model", text: "설정에서 요약 모델을 다시 선택하세요." });
    return reasons;
  }
  function canStart(s) {
    return !s.busy && startBlockers(s).length === 0;
  }
  function tokens(value) {
    return typeof value === 'number' && Number.isFinite(value) ? value.toLocaleString('ko-KR') : '미제공';
  }
  function usageRows(record) {
    const usage = record && record.analysis && Array.isArray(record.analysis.usage) ? record.analysis.usage : [];
    return usage.map(entry => {
      const requests = Number(entry.requests) || 0;
      const hasLedger = typeof entry.measuredRequests === 'number';
      const measured = hasLedger ? entry.measuredRequests : requests;
      const unknown = hasLedger ? Number(entry.unknownRequests) || 0 : 0;
      const tokenless = hasLedger && measured > 0 && !entry.inputTokens && !entry.outputTokens && entry.audioSeconds > 0;
      const shown = value => tokenless ? '해당 없음' : hasLedger && measured === 0 ? '미제공' : tokens(value);
      const notes = [];
      if (entry.audioSeconds > 0) notes.push(`음성 ${(entry.audioSeconds / 60).toLocaleString('ko-KR', { maximumFractionDigits: 1 })}분`);
      if (unknown > 0) notes.push(`${unknown}건 사용량 미확인`);
      return {
        kind: entry.kind === 'transcription' ? '전사' : '요약',
        model: String(entry.model || '모델 미상'),
        input: shown(entry.inputTokens),
        output: shown(entry.outputTokens),
        total: shown(entry.totalTokens),
        requests,
        note: notes.join(' · ')
      };
    });
  }
  const FORMAT_LABELS = { meeting: '회의록', summary: '핵심 요약', tasks: '업무 정리', custom: '내 형식' };
  function outputFormat(value) {
    return Object.prototype.hasOwnProperty.call(FORMAT_LABELS, value) ? value : 'meeting';
  }
  function actionLine(action, undecided) {
    // 업무 정리 형식은 담당·기한이 없을 때 지어내지 않고 미정으로 보여 준다.
    const owner = action.owner ? `담당 ${action.owner}` : undecided ? '담당 미정' : '';
    const due = action.due ? `기한 ${action.due}` : undecided ? '기한 미정' : '';
    return [action.task, owner, due].filter(Boolean).join(' · ');
  }
  function minutesSections(format, minutes, custom) {
    const m = minutes || {}, actions = undecided => (m.actions || []).map(a => actionLine(a, undecided));
    const overview = title => ({ type: 'overview', title, text: String(m.overview || '') });
    const list = (title, items, empty) => ({ type: 'list', title, items: items || [], empty });
    const topics = title => ({ type: 'topics', title, topics: m.topics || [] });
    // 내 형식은 정의가 있을 때만 고른 항목·순서·이름으로 보여 주고, 정의가 없으면 회의록으로 보여 준다.
    if (outputFormat(format) === 'custom' && custom) return Formats.customSections(m, custom).map(section => section.type === 'list' ? { ...section, empty: '없음' } : section);
    switch (outputFormat(format)) {
      case 'summary': return [overview('핵심 요약'), topics('주요 내용'), list('합의된 방향', m.decisions), list('다음 할 일', actions(false)), list('미확정 사항', m.openQuestions)];
      case 'tasks': return [overview('업무 요약'), list('할 일', actions(true), '정해진 할 일이 없습니다.'), list('확인 필요', m.openQuestions), list('결정 사항', m.decisions), topics('관련 논의')];
      default: return [overview('핵심 요약'), list('합의된 방향', m.decisions), topics(''), list('다음 할 일', actions(false)), list('미확정 사항', m.openQuestions)];
    }
  }
  const api = { NOTES_LIMIT, EXHAUSTED_MESSAGE, canAnalyze, accessText, FORMAT_LABELS, outputFormat, actionLine, minutesSections, startBlockers, canStart, usageRows, tokens };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.VoiceFlow = api;
})(typeof window === 'object' ? window : globalThis);
