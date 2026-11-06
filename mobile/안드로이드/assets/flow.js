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
    if (!s.keyConfigured) reasons.push({ id: 'key', text: s.trialExhausted ? EXHAUSTED_MESSAGE : '설정의 AI 연결에서 API 키를 등록하세요.' });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(s.date || ''))) reasons.push({ id: 'date', text: '회의 날짜를 선택하세요.' });
    if (String(s.notes || '').length > NOTES_LIMIT) reasons.push({ id: 'notes', text: '상세 안건·배경은 4,000자 이내로 줄여 주세요.' });
    if (s.customMissing) reasons.push({ id: 'format', text: '설정 › 출력 형식에서 내 형식을 먼저 만드세요.' });
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
      default: return [overview('핵심 요약'), list('다음 할 일', actions(false)), list('합의된 방향', m.decisions), topics(''), list('미확정 사항', m.openQuestions)];
    }
  }
  // 앱 업데이트 상태(네이티브가 알려 준 그대로)와 지금 설치를 막는 이유로 첫 화면 안내 줄과 프로그램 정보의 문장·단추를 정한다.
  // 받기는 회의 중에도 하고, 시스템 설치 화면으로 넘기는 설치만 막는다.
  function updateView(update, reasons) {
    const u = update && typeof update.status === 'string' ? update : { status: 'checking' };
    const version = u.version || '', blocked = Array.isArray(reasons) && reasons.length ? reasons[0] : null;
    const megabytes = bytes => `${(Number(bytes || 0) / 1048576).toFixed(1)} MB`;
    const percent = u.size ? Math.min(100, Math.round((Number(u.received) || 0) / u.size * 100)) : 0;
    let published = '';
    try { if (u.publishedAt) published = new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', month: 'long', day: 'numeric' }).format(new Date(u.publishedAt)); } catch { published = ''; }
    const facts = [published && `${published} 게시`, u.size && megabytes(u.size)].filter(Boolean).join(' · ');
    const texts = {
      latest: `지금 쓰는 ${u.currentVersion || ''} 버전이 최신입니다.`,
      unknown: (u.error && u.error.message) || '새 버전을 확인하지 못했습니다. 잠시 뒤 다시 확인을 눌러 주세요.',
      available: `${version} 버전이 나왔습니다.${facts ? ` (${facts})` : ''}`,
      manual: `${version} 버전이 나왔지만 앱에서 바로 설치할 수 없습니다.`,
      downloading: `${version} 버전을 받는 중입니다.`,
      ready: u.needsPermission ? `${version} 버전을 받았습니다. 설치하려면 VoiceNote의 설치 허용을 먼저 켜 주세요.` : `${version} 버전을 받았습니다. 설치를 누르면 휴대폰 설치 화면이 열립니다.`,
      confirming: u.canContinue ? '설치 화면에서 ‘업데이트’를 누르면 끝납니다. 설치 화면이 닫혔으면 ‘설치 계속’을 누르세요.' : '휴대폰 설치 화면을 여는 중입니다.',
      installed: '설치를 마쳤습니다. VoiceNote를 다시 열어 주세요.',
    };
    const notes = { available: `새 버전 ${version}`, manual: `새 버전 ${version}`, downloading: `받는 중 ${percent}%`, ready: '설치 준비됨', confirming: '설치 확인 대기' };
    let action = null;
    if (u.status === 'available') action = { kind: 'download', label: blocked ? '받아 두기' : '지금 업데이트', disabled: false };
    else if (u.status === 'ready') action = u.needsPermission ? { kind: 'permission', label: '설치 허용 켜기', disabled: false } : { kind: 'install', label: '설치', disabled: Boolean(blocked) };
    else if (u.status === 'confirming' && u.canContinue) action = { kind: 'confirm', label: '설치 계속', disabled: Boolean(blocked) };
    const error = u.error && u.status !== 'unknown' ? { text: u.error.message, tone: u.status === 'manual' ? 'info' : 'error' } : null;
    // 설치·설치 계속은 앱이 곧 닫히므로 사라질 입력이 있으면 잠그고 그 이유를 단추 가까이에 보인다.
    const lockable = (u.status === 'available' || (u.status === 'ready' && !u.needsPermission) || (u.status === 'confirming' && u.canContinue)) && blocked;
    return {
      status: u.status,
      note: notes[u.status] || null,
      text: texts[u.status] || '새 버전을 확인하는 중입니다.',
      detail: error,
      lock: lockable ? (u.status === 'available' ? `${blocked} 지금 누르면 받아 두기만 합니다.` : blocked) : null,
      progress: u.status === 'downloading' ? { percent, text: `${megabytes(u.received)} / ${megabytes(u.size)}` } : null,
      action,
      check: { hidden: ['downloading', 'ready', 'confirming', 'installed'].includes(u.status), disabled: ['idle', 'checking'].includes(u.status) },
      fine: ['available', 'downloading', 'ready', 'confirming'].includes(u.status),
    };
  }
  const api = { NOTES_LIMIT, EXHAUSTED_MESSAGE, canAnalyze, accessText, FORMAT_LABELS, outputFormat, actionLine, minutesSections, startBlockers, canStart, usageRows, tokens, updateView };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.VoiceFlow = api;
})(typeof window === 'object' ? window : globalThis);
