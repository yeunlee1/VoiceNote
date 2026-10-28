// 네이티브 녹음 상태와 보관함별 지난 회의 및 AI 설정을 연결한다.
(() => {
  const $ = id => document.getElementById(id), pending = new Map(), Flow = window.VoiceFlow;
  const state = { settings: {}, connection: { keyConfigured: false, keySource: 'none', models: [], summaryModel: '' }, active: false, recording: false, busy: false, opened: null, lastState: '', lastHistory: '', lastMeetingState: '', removeArmed: false, deleteArmed: false, opener: null };
  let serial = 0, draftTimer = 0;
  window.receive = (id, payload) => { const task = pending.get(id); if (!task) return; pending.delete(id); payload.error ? task.reject(new Error(payload.error)) : task.resolve(payload.value); };
  function call(method, data = {}) {
    return new Promise((resolve, reject) => {
      const id = String(++serial); pending.set(id, { resolve, reject });
      try { window.Native.request(id, method, JSON.stringify(data)); } catch (error) { pending.delete(id); reject(new Error('앱 연결을 확인하세요.')); }
    }).then(value => {
      if (['applySettings','saveSettings','pickFolder','clearFolder'].includes(method) && value?.settings) {
        state.settings = value.settings;
        if (value.connection) state.connection = value.connection;
        if (Object.prototype.hasOwnProperty.call(value, 'customFormat')) state.customFormat = value.customFormat;
        if (method === 'applySettings') { updateCustomOption(); loadEditor(); }
        renderSettings(); renderConnection(); renderFormatExample(); lock();
      }
      return value;
    });
  }
  function message(text) { $('message').textContent = text; $('message').hidden = false; clearTimeout(message.timer); message.timer = setTimeout(() => { $('message').hidden = true; }, 6000); }
  function node(tag, text, className) { const el = document.createElement(tag); if (text != null) el.textContent = text; if (className) el.className = className; return el; }
  function today() { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()); }
  const number = value => Number(value || 0).toLocaleString('ko-KR');

  function snapshot() {
    return { busy: state.busy, active: state.active || !!state.refining, opened: !!state.opened, keyConfigured: Flow.canAnalyze(state.connection), trialExhausted: state.connection.accessMode === 'exhausted',
      date: $('date').value, notes: $('notes').value, customMissing: $('output-format').value === 'custom' && !state.customFormat,
      permissionPending: !!state.connection.permissionPending, filePending: !!state.connection.filePending, modelError: !!state.connection.modelError };
  }
  function renderBlockers() {
    const reasons = Flow.startBlockers(snapshot()), list = $('blocker-list');
    $('blockers').hidden = state.active;
    list.replaceChildren(...(reasons.length ? reasons.map(reason => node('li', reason.text)) : [node('li', '하단의 회의 시작을 누르면 바로 녹음합니다.')]));
    $('blockers').classList.toggle('ready', reasons.length === 0);
    $('blockers').querySelector('.needs-title').textContent = reasons.length ? '시작 전 필요' : '준비 완료';
    $('blocker-settings').hidden = !reasons.some(reason => reason.id === 'key');
    const count = $('notes').value.length;
    $('notes-count').textContent = `${number(count)} / 4,000`;
    $('notes-count').classList.toggle('over', count > Flow.NOTES_LIMIT);
  }
  function renderStage() {
    const order = ['prepare', 'record', 'analyze', 'done'];
    const current = state.recording ? 'record' : state.active ? 'analyze' : state.lastMeetingState === 'complete' ? 'done' : 'prepare';
    for (const li of $('stage').children) {
      const index = order.indexOf(li.dataset.stage), at = order.indexOf(current);
      li.classList.toggle('done', index < at || current === 'done');
      if (li.dataset.stage === current) li.setAttribute('aria-current', 'step'); else li.removeAttribute('aria-current');
    }
  }
  function lock() {
    const idle = !state.busy && !state.active && !state.refining;
    $('prepare').disabled = !idle;
    $('start').hidden = state.recording; $('finish').hidden = !state.recording;
    $('start').disabled = !Flow.canStart(snapshot());
    $('start-label').textContent = state.active && !state.recording ? '분석 중' : '회의 시작';
    $('finish').disabled = state.busy || !state.recording;
    $('retry').disabled = !idle || !state.opened;
    $('save-key').disabled = !idle;
    $('remove-key').disabled = !idle || !state.connection.keyConfigured;
    $('settings-lock').hidden = idle;
    $('api-key').disabled = !idle;
    for (const input of document.querySelectorAll('input[name="persist"]')) input.disabled = !idle;
    $('model').disabled = !idle || !state.connection.models.length;
    for (const id of ['custom-save','custom-delete','custom-name','custom-instruction']) $(id).disabled = !idle;
    for (const input of document.querySelectorAll('#custom-section-list input,#custom-section-list button')) input.disabled = !idle || input.dataset.edge === 'true';
    for (const input of document.querySelectorAll('#prep input,#prep textarea,#prep select,#default-format,[data-pick-folder],[data-clear-folder],#export-settings,#import-settings,#apply-settings')) input.disabled = !idle;
    for (const button of $('history').querySelectorAll('button')) button.disabled = !idle;
    $('refresh').disabled = !idle; $('close-result').disabled = state.busy;
    $('result-version').disabled = !idle;
    const resultReady = idle && !!state.result?.minutes, comment = $('review-comment').value;
    $('review-comment').disabled = !resultReady;
    for (const button of document.querySelectorAll('[data-stars]')) button.disabled = !resultReady;
    $('save-review').disabled = !resultReady || comment.length > 1000 || (!state.stars && !comment.trim());
    $('refine').disabled = !resultReady || comment.length > 1000 || !comment.trim();
    $('refine-cost').hidden = !comment.trim();
    $('review-count').textContent = `${number(comment.length)} / 1,000`;
    $('copy-result').disabled = !idle || !(state.resultTab === 'transcript' ? state.result?.transcript : state.result?.minutes);
    $('share-result').disabled = $('copy-result').disabled;
    $('share-all').disabled = !idle || !state.opened;
    $('save-copies').disabled = !resultReady;
    renderBlockers(); renderStage();
  }
  // 체험 횟수를 다 쓴 뒤 분석을 시도하면 안내 문구를 보이고 AI 설정을 연다.
  async function task(work) { if (state.busy) return; state.busy = true; lock(); let exhausted = false; try { await work(); } catch (error) { message(error.message); exhausted = error.message === Flow.EXHAUSTED_MESSAGE; } finally { state.busy = false; lock(); } if (exhausted && !$('settings').open) openSettings(); }

  function setPrep(open) {
    $('prep').hidden = !open; $('prepare').setAttribute('aria-expanded', String(open));
  }
  // 모달 위에 미리보기 모달이 겹칠 수 있으므로 돌아갈 포커스는 모달마다 따로 기억한다.
  function openDialog(id, opener) { if ($(id).open) return; $(id).returnFocus = opener || document.activeElement; $(id).showModal(); }
  for (const dialog of document.querySelectorAll('dialog')) dialog.addEventListener('close', () => { const opener = dialog.returnFocus; dialog.returnFocus = null; if (opener && document.contains(opener)) opener.focus(); });
  for (const button of document.querySelectorAll('[data-close]')) button.addEventListener('click', () => $(button.dataset.close).close());

  function renderAccess() {
    const c = state.connection, text = Flow.accessText(c), ready = Flow.canAnalyze(c);
    $('connection').textContent = text.chip;
    $('open-settings').dataset.state = ready ? 'ready' : 'missing';
    $('open-settings').setAttribute('aria-label', `설정, ${ready ? text.chip : 'API 키 등록 필요'}`);
    $('key-status').textContent = text.status;
  }
  function renderConnection() {
    const c = state.connection; renderAccess();
    const select = $('model'); select.replaceChildren();
    for (const model of c.models) { const option = node('option', model.label || model.id); option.value = model.id; select.append(option); }
    select.value = c.summaryModel; select.disabled = state.active || state.busy || !c.models.length;
    $('model-list').replaceChildren(...c.models.map(model => { const li = node('li'); li.append(node('b', model.label || model.id), node('span', model.description || '')); return li; }));
    renderModelLimit();
  }
  function renderModelLimit() {
    const model = state.connection.models.find(item => item.id === $('model').value);
    $('model-limit').textContent = model ? `${model.label || model.id}로 요약합니다. 바꾼 모델은 다음 분석부터 적용됩니다.` : '요약 모델 목록을 불러오지 못했습니다.';
  }

  async function applyDraft() {
    let draft;
    try { draft = await call('draft'); } catch { draft = {}; message('작성 중 메모를 읽지 못했습니다. 빈 메모로 계속합니다.'); }
    $('title').value = draft.title || ''; $('date').value = draft.date || today(); $('participants').value = draft.participants || ''; $('notes').value = draft.notes || '';
    const format = Flow.outputFormat(state.settings?.defaultOutputFormat);
    $('output-format').value = format === 'custom' && !state.customFormat ? 'meeting' : format; renderFormatExample(); lock();
  }
  function draftData() { return { title: $('title').value, date: $('date').value, participants: $('participants').value, notes: $('notes').value, outputFormat: $('output-format').value }; }
  function formatFields() {
    const format = $('output-format').value;
    return format === 'custom' && state.customFormat ? { outputFormat: format, customFormat: state.customFormat } : { outputFormat: format === 'custom' ? 'meeting' : format };
  }
  function queueDraft() { clearTimeout(draftTimer); draftTimer = setTimeout(() => { draftTimer = 0; call('saveDraft', draftData()).catch(error => message(error.message)); }, 500); }
  async function flushDraft() { if (!draftTimer) return; clearTimeout(draftTimer); draftTimer = 0; await call('saveDraft', draftData()).catch(() => {}); }
  const stateLabels = { complete: '회의록', failed: '분석 실패', interrupted: '녹음 중단', saved: '음성 저장', analyzing: '분석 중', recording: '녹음 중' };
  async function history() {
    const data = await call('history'), entries = data.meetings; $('history').replaceChildren();
    if (data.skipped) $('history').append(node('p', '읽지 못한 기록 ' + data.skipped + '개', 'hint'));
    if (!entries.length) $('history').append(node('p', '보관된 회의가 없습니다.', 'empty'));
    for (const entry of entries) {
      const button = node('button'); button.type = 'button'; button.dataset.location = entry.location; button.dataset.id = entry.id;
      const label = entry.state !== 'complete' ? stateLabels[entry.state] : Flow.outputFormat(entry.outputFormat) === 'custom' && entry.customFormat?.name ? entry.customFormat.name : Flow.FORMAT_LABELS[Flow.outputFormat(entry.outputFormat)];
      button.append(node('small', entry.date + ' · ' + entry.dailySequence + '차'), node('strong', entry.title || '제목 미정 회의'), node('span', label || '보관', 'state ' + (entry.state === 'failed' || entry.state === 'interrupted' ? 'failed' : '')));
      if (entry.projectName) button.append(node('small', '이전 프로젝트: ' + entry.projectName));
      if (entry.stars) button.append(node('small', '★ ' + entry.stars));
      button.onclick = () => task(() => open(entry.location, entry.id, button, entry.resultId));
      $('history').append(button);
    }
  }
  function list(title, items, host = $('minutes')) { if (!items?.length) return; host.append(node('h3', title)); const ul = node('ul'); for (const item of items) ul.append(node('li', item)); host.append(ul); }
  function renderUsage(record) {
    const rows = Flow.usageRows(record), host = $('usage'); host.replaceChildren();
    if (!rows.length) { host.append(node('p', '미제공 · 이 회의에는 기록된 사용량이 없습니다.', 'hint')); return; }
    const table = node('table'), head = node('thead'), body = node('tbody'), headRow = node('tr');
    for (const label of ['모델', '입력', '출력', '합계']) { const th = node('th', label); th.scope = 'col'; headRow.append(th); }
    head.append(headRow);
    for (const row of rows) { const tr = node('tr'), th = node('th'); th.scope = 'row'; th.append(node('span', `${row.kind} · ${row.model}`), node('small', [`${row.requests}회`, row.note].filter(Boolean).join(' · '))); tr.append(th, node('td', row.input), node('td', row.output), node('td', row.total)); body.append(tr); }
    table.append(head, body); host.append(table);
  }
  async function open(location, id, opener, resultId = null) {
    const data = await call('open', { location, id, ...(resultId == null ? {} : { resultId }) });
    const { record, minutes, transcript } = data;
    const selected = data.resultId || record.resultId || resultId; state.opened = { location, id, ...(selected == null ? {} : { resultId: selected }) }; state.opener = opener || state.opener;
    $('meeting-date').textContent = `${record.date} · ${record.dailySequence}차 회의`;
    $('meeting-title').textContent = record.title || '회의';
    $('meeting-status').textContent = record.message || '녹음 파일을 보관했습니다.';
    $('meeting-notes').textContent = record.notes || ''; $('meeting-notes-wrap').hidden = !record.notes;
    $('transcript').textContent = transcript; $('minutes').replaceChildren();
    const format = Flow.outputFormat(record.outputFormat), custom = format === 'custom' ? record.customFormat || null : null, label = custom ? custom.name : Flow.FORMAT_LABELS[format === 'custom' ? 'meeting' : format];
    if (minutes) renderSections($('minutes'), Flow.minutesSections(format, minutes, custom));
    else $('minutes').append(node('p', `아직 ${label}${format === 'tasks' ? '가' : '이'} 없습니다. 아래 재분석으로 다시 만들 수 있습니다.`, 'hint'));
    renderUsage(record);
    state.result = { label, minutes: !!minutes, transcript: !!transcript };
    const versions = data.versions || []; $('result-version').replaceChildren(...versions.map((version,index) => {
      const option = node('option', [`${index + 1}번째 결과`, savedLabel(version.savedAt), Flow.FORMAT_LABELS[Flow.outputFormat(version.outputFormat)], version.refined && '의견 반영본', version.stars && `별 ${version.stars}개`].filter(Boolean).join(' · ')); option.value = version.id; return option;
    })); $('result-version').value = selected || ''; $('version-wrap').hidden = versions.length < 2;
    $('refined-badge').hidden = !record.feedback && !versions.find(version => version.id === selected)?.refined;
    $('review-panel').hidden = !minutes || !selected; state.stars = data.review?.stars || null;
    $('review-comment').value = data.review?.comment || ''; $('review-state').textContent = data.review ? '저장된 평가입니다.' : '별점과 의견은 선택입니다. 평가 저장에는 요금이 들지 않습니다.';
    renderStars(); renderCopies(data.copies);
    $('transcript-meta').textContent = transcript ? `전사 ${number(Array.from(transcript).length)}자 · 녹음에서 인식한 글을 그대로 보여 줍니다.` : '아직 전사문이 없습니다.';
    showTab('minutes');
    $('result').hidden = false; document.body.style.overflow = 'hidden'; $('main').inert = true; document.querySelector('.topbar').inert = true; document.querySelector('.dock').inert = true; $('result').scrollTop = 0; $('result').focus();
    lock();
  }
  function renderSections(host, sections) {
    // 출력 형식마다 같은 요약 자료를 다른 순서와 제목으로 보여 준다.
    for (const section of sections) {
      if (section.type === 'overview') {
        const summary = node('div', null, 'summary'); summary.append(node('strong', section.title));
        for (const line of section.text.split(/\n+/)) summary.append(node('p', line));
        host.append(summary);
      } else if (section.type === 'topics') {
        if (section.title && section.topics.length) host.append(node('h3', section.title));
        for (const topic of section.topics) { host.append(node(section.title ? 'h4' : 'h3', topic.title)); for (const text of topic.points || []) host.append(node('p', text)); }
      } else if (section.items.length) list(section.title, section.items, host);
      else if (section.empty) host.append(node('h3', section.title), node('p', section.empty, 'hint'));
    }
  }
  function updateCustomOption() {
    $('output-format').querySelector('option[value="custom"]').textContent = state.customFormat ? `내 형식 · ${state.customFormat.name}` : '내 형식 (새로 만들기)';
  }
  function renderFormatExample() {
    // 고른 형식으로 가상의 회의를 정리한 모습을 결과 화면과 같은 그리기 함수로 보여 준다.
    const open = !$('format-example').hidden, format = $('output-format').value;
    $('format-help').setAttribute('aria-expanded', String(open)); $('format-help').textContent = open ? '닫기' : '예시';
    $('custom-missing').hidden = format !== 'custom' || !!state.customFormat;
    renderCustomPreview();
    if (!open) return;
    const preview = format === 'custom' ? state.customFormat : null;
    $('format-example-text').textContent = `${MeetingFormats.DESCRIPTIONS[format]} 아래는 가상의 회의로 만든 예시입니다.`;
    $('format-example-body').replaceChildren();
    if (format === 'custom' && !preview) $('format-example-body').append(node('p', '설정에서 내 형식을 저장하면 예시가 보입니다.', 'hint'));
    else renderSections($('format-example-body'), Flow.minutesSections(format, MeetingFormats.SAMPLE.minutes, preview));
  }
  function loadEditor() {
    const base = state.customFormat || MeetingFormats.defaultCustom(), chosen = new Set(base.sections.map(section => section.key));
    state.customRows = [...base.sections.map(section => ({ ...section, on: true })), ...MeetingFormats.KEYS.filter(key => !chosen.has(key)).map(key => ({ key, title: MeetingFormats.KEY_LABELS[key], on: false }))];
    $('custom-name').value = state.customFormat?.name || ''; $('custom-instruction').value = state.customFormat?.instruction || '';
    $('custom-delete').hidden = !state.customFormat; state.customDeleteArmed = false; $('custom-delete').textContent = '내 형식 삭제';
    $('custom-status').textContent = state.customFormat ? '' : '아직 저장한 내 형식이 없습니다. 이름과 항목을 정하고 저장하세요.';
    renderEditorRows();
  }
  function renderEditorRows() {
    $('custom-section-list').replaceChildren(...state.customRows.map((row, index) => {
      const item = node('li', null, 'custom-row'), check = node('input'), title = node('input'), label = MeetingFormats.KEY_LABELS[row.key];
      check.type = 'checkbox'; check.checked = row.on; check.setAttribute('aria-label', `${label} 넣기`); check.onchange = () => { row.on = check.checked; renderFormatExample(); };
      title.value = row.title; title.maxLength = MeetingFormats.LIMITS.title; title.setAttribute('aria-label', `${label} 항목 이름`); title.oninput = () => { row.title = title.value; renderFormatExample(); };
      const move = (text, delta, disabled) => { const button = node('button', text, 'button move'); button.type = 'button'; button.disabled = disabled; button.dataset.edge = String(disabled); button.setAttribute('aria-label', `${label} ${delta < 0 ? '위로' : '아래로'}`);
        button.onclick = () => { [state.customRows[index], state.customRows[index + delta]] = [state.customRows[index + delta], state.customRows[index]]; renderEditorRows(); renderFormatExample(); }; return button; };
      const head = node('label', null, 'custom-check'); head.append(check, node('span', label));
      item.append(head, title, move('↑', -1, index === 0), move('↓', 1, index === state.customRows.length - 1)); return item;
    }));
  }
  function editorValue(strict) {
    // 미리보기는 비어 있는 이름을 기본 이름으로 채워 보여 주고, 저장할 때만 엄격하게 검사한다.
    const value = { name: $('custom-name').value.trim() || (strict ? '' : '내 형식'), sections: (state.customRows || []).filter(row => row.on).map(row => ({ key: row.key, title: row.title.trim() || (strict ? '' : MeetingFormats.KEY_LABELS[row.key]) })), instruction: $('custom-instruction').value };
    if (strict) return MeetingFormats.validateCustom(value);
    try { return MeetingFormats.validateCustom(value); } catch { return null; }
  }
  function renderCustomPreview() {
    const host = $('custom-preview'), value = editorValue(false); host.replaceChildren();
    if (value) renderSections(host, Flow.minutesSections('custom', MeetingFormats.SAMPLE.minutes, value));
    else host.append(node('p', '항목을 하나 이상 고르면 예시가 보입니다.', 'hint'));
  }
  function newMeetingFormat() {
    const format = Flow.outputFormat(state.settings.defaultOutputFormat);
    return format === 'custom' && !state.customFormat ? 'meeting' : format;
  }
  function renderSettings() {
    $('default-format').value = Flow.outputFormat(state.settings.defaultOutputFormat);
    if (!state.formatChosen) $('output-format').value = newMeetingFormat();
    for (const kind of ['audio','transcript','summary']) {
      const folder = state.settings.storage?.[kind]; $('folder-' + kind).textContent = folder?.uri ? folder.name || '고른 폴더' : '사용 안 함';
    }
    if (state.opened) renderCopies(state.copies);
  }
  function focusSettings(section) { const el = $('settings-' + section); el.focus({preventScroll:true}); $('settings').scrollTop = section === 'ai' ? 0 : el.offsetTop - 64; }
  function renderStars() {
    for (const button of document.querySelectorAll('[data-stars]')) button.setAttribute('aria-pressed', String(Number(button.dataset.stars) === state.stars));
  }
  function savedLabel(value) {
    try { return new Intl.DateTimeFormat('ko-KR', {timeZone:'Asia/Seoul',month:'long',day:'numeric',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(value)); }
    catch { return ''; }
  }
  const COPY_LABELS = {audio:'원음',transcript:'전사문',summaryMd:'요약본(.md)',summaryTxt:'요약본(.txt)',all:'사본'};
  function copyMessage(report) {
    if (report.failed?.length) {
      const groups = new Map();
      for (const item of report.failed) {
        const reason = String(item.message || '').replace(/\.$/, ''), label = COPY_LABELS[item.kind] || '사본';
        if (!groups.has(reason)) groups.set(reason, []);
        if (!groups.get(reason).includes(label)) groups.get(reason).push(label);
      }
      const reasons = [...groups].map(([reason, labels]) => `${labels.join('·')} — ${reason}`);
      return `고른 폴더에 저장하지 못했습니다: ${reasons.join(', ')}. 설정에서 폴더를 확인한 뒤 ‘고른 폴더에 다시 저장’을 누르세요.`;
    }
    const written = [...new Set((report.written || []).map(item => COPY_LABELS[item.kind]).filter(Boolean))];
    return written.length ? `고른 폴더에 사본을 저장했습니다: ${written.join(', ')}.` : '고른 폴더에 새로 저장할 사본이 없습니다.';
  }
  function renderCopies(report, attempted = false) {
    state.copies = report; state.copiesAttempted = attempted; const configured = ['audio','transcript','summary'].some(kind => state.settings.storage?.[kind]?.uri);
    $('copies-panel').hidden = !state.result?.minutes;
    $('save-copies').hidden = !configured || !state.result?.minutes; $('copies-guide').hidden = configured;
    $('copies-state').replaceChildren(); if (!configured || !report) return;
    let text = attempted || report.failed?.length || report.written?.length ? copyMessage(report) : '아직 이 폴더에 저장하지 않았습니다.';
    if (!attempted && report.failed?.length) text = text.replace('고른 폴더에 저장하지 못했습니다:', '고른 폴더의 사본을 확인하지 못했습니다:');
    $('copies-state').append(node('p', text, report.failed?.length ? 'copy-error' : 'hint'));
    for (const item of report.written || []) $('copies-state').append(node('p', `${COPY_LABELS[item.kind] || '사본'} · ${item.name || '저장 완료'}`, 'hint'));
  }
  async function saveReview(target) {
    const review = await call('review', {...target,stars:state.stars || null,comment:$('review-comment').value.trim()});
    $('review-state').textContent = '평가를 저장했습니다. 요금은 들지 않습니다.'; await history(); return review;
  }
  $('result-version').onchange = () => { const target = {...state.opened}, resultId = $('result-version').value; task(() => open(target.location,target.id,state.opener,resultId)); };
  for (const button of document.querySelectorAll('[data-stars]')) button.onclick = () => {
    const stars = Number(button.dataset.stars); state.stars = state.stars === stars ? null : stars; renderStars(); lock();
  };
  $('review-comment').oninput = lock;
  $('save-review').onclick = () => { const target = {...state.opened}; task(() => saveReview(target)); };
  $('refine').onclick = () => {
    const target = {...state.opened}, feedback = $('review-comment').value.trim();
    task(async () => {
      if (!feedback || $('review-comment').value.length > 1000) throw new Error('의견은 1,000자 이하로 입력하세요.');
      await saveReview(target);
      if (!state.result?.transcript) throw new Error('저장된 전사가 없어 의견을 반영할 수 없습니다.');
      if (!Flow.canAnalyze(state.connection)) { openSettings(null,'ai'); throw new Error(state.connection.accessMode === 'exhausted' ? Flow.EXHAUSTED_MESSAGE : '설정의 AI 연결에서 API 키를 먼저 등록하세요.'); }
      const attemptId = crypto.randomUUID(); state.refining = {...target,attemptId};
      try { await call('refine', {...target,feedback,attemptId}); }
      catch (error) { state.refining = null; throw error; }
      await poll(true);
    });
  };
  $('save-copies').onclick = () => { const target = {...state.opened}; task(async () => { const report = await call('copies',target); renderCopies(report, true); }); };
  $('default-format').onchange = () => task(async () => {
    try { await call('saveSettings',{defaultOutputFormat:$('default-format').value}); queueDraft(); }
    catch (error) { renderSettings(); throw error; }
  });
  for (const button of document.querySelectorAll('[data-pick-folder]')) button.onclick = () => task(async () => { await call('pickFolder',{kind:button.dataset.pickFolder}); });
  for (const button of document.querySelectorAll('[data-clear-folder]')) button.onclick = () => task(async () => { await call('clearFolder',{kind:button.dataset.clearFolder}); });
  for (const button of document.querySelectorAll('[data-settings-section]')) button.onclick = () => focusSettings(button.dataset.settingsSection);
  $('open-format-settings').onclick = event => openSettings(event,'format');
  $('export-settings').onclick = () => task(async () => { const result = await call('exportSettings'); if (!result?.cancelled) message('설정 파일을 저장했습니다.'); });
  $('import-settings').onclick = () => task(async () => {
    const result = await call('importSettings'); if (!result || result.cancelled) return;
    if (!$('settings').open) { await call('cancelSettings'); return; }
    state.importToken = result.token; $('preview-file').textContent = result.file || '설정 파일';
    const p = result.preview, host = $('settings-preview-body'); host.replaceChildren();
    host.append(node('p', '요약 모델 · ' + p.summaryModel.value + (p.summaryModel.apply ? '' : ' · ' + p.summaryModel.reason)));
    host.append(node('p', '기본 출력 형식 · ' + Flow.FORMAT_LABELS[Flow.outputFormat(p.defaultOutputFormat.value)]));
    host.append(node('p', '내 형식 · ' + (p.customFormat.name == null ? '현재 내 형식 삭제' : p.customFormat.name)));
    if (p.storageIgnored) host.append(node('p', 'Android에서는 저장 위치를 적용하지 않습니다. 휴대폰에서 직접 고른 폴더는 그대로 둡니다.', 'notice'));
    openDialog('settings-preview',$('import-settings'));
  });
  $('apply-settings').onclick = () => task(async () => { await call('applySettings',{token:state.importToken}); state.importToken = null; $('settings-preview').close(); queueDraft(); });
  $('cancel-settings').onclick = () => { if (!state.busy) $('settings-preview').close(); };
  $('settings-preview').addEventListener('cancel', event => { if (state.busy) event.preventDefault(); });
  $('settings-preview').addEventListener('close', () => { if (state.importToken) { state.importToken = null; call('cancelSettings').catch(() => {}); } });
  function closeResult() {
    if ($('result').hidden || state.busy) return; const target = state.opened; $('result').hidden = true; document.body.style.overflow = ''; $('main').inert = false; document.querySelector('.topbar').inert = false; document.querySelector('.dock').inert = false; state.opened = null;
    const opener = document.contains(state.opener) ? state.opener : [...$('history').querySelectorAll('button')].find(button => button.dataset.location === target?.location && button.dataset.id === target?.id);
    state.opener = null; if (opener) opener.focus(); lock();
  }

  async function poll(force = false) {
    if (state.polling || (state.busy && !force)) return;
    state.polling = true;
    try {
      const status = await call('status'), meeting = status.meeting;
      if (state.busy && !force) return;
      state.active = status.active; state.recording = status.active && meeting.state === 'recording';
      document.body.classList.toggle('recording', state.recording);
      if (state.active) {
        state.lastMeetingState = '';
        $('record-state').textContent = state.recording ? '녹음 중' : '분석 중';
        $('workflow').textContent = meeting.message || '처리 중';
        const seconds = Math.max(0, Math.floor((Date.now() - meeting.createdAt) / 1000));
        if (state.recording) $('timer').textContent = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
        if (!$('prep').hidden) setPrep(false);
      } else if (state.lastState) {
        state.lastMeetingState = meeting.state || '';
        $('record-state').textContent = meeting.state === 'complete' ? '보관 완료' : '확인 필요';
        $('workflow').textContent = meeting.message || '다음 회의를 준비하세요.'; $('timer').textContent = '00:00';
      }
      const target = state.refining;
      const finishedRefine = !status.active && target && meeting.attemptId === target.attemptId && target.id === meeting.id && target.location === meeting.location && ['complete','failed'].includes(meeting.state);
      const key = `${meeting.id || ''}-${meeting.state || ''}-${meeting.attemptId || ''}`;
      if (key !== state.lastHistory || finishedRefine) {
        state.lastHistory = key; await history();
        if (finishedRefine || (!target && !state.active && state.lastState && meeting.id && meeting.location)) {
          const failedRefine = finishedRefine && meeting.state === 'failed';
          const opener = [...$('history').querySelectorAll('button')].find(button => button.dataset.location === meeting.location && button.dataset.id === meeting.id);
          await open(meeting.location, meeting.id, opener, failedRefine ? target.resultId : meeting.resultId);
          if (failedRefine) $('review-state').textContent = '다시 정리하지 못했습니다. 평가는 저장되어 있고 앞선 결과는 그대로입니다.';
          if (finishedRefine) state.refining = null;
        }
        // 녹음 뒤 자동 분석이 체험 소진으로 멈췄으면 같은 안내와 함께 AI 설정을 연다.
        if (!state.active && state.lastState && meeting.state === 'failed' && meeting.message === Flow.EXHAUSTED_MESSAGE && !$('settings').open) { message(meeting.message); openSettings(); }
      }
      // 체험 남은 횟수가 분석 뒤 바뀌므로 상태 조회 때 연결 정보도 함께 갱신한다.
      if (status.connection) { state.connection = status.connection; renderAccess(); }
      if (state.opened && state.opened.id === meeting.id && state.opened.location === meeting.location && (status.active || meeting.state === 'failed')) $('meeting-status').textContent = meeting.message || '처리 중';
      state.connection.active = state.active;
      state.lastState = state.active ? 'active' : '';
      lock();
    } catch (error) { $('connection').textContent = '연결 확인 필요'; } finally { state.polling = false; }
  }

  $('prepare').onclick = () => { setPrep($('prep').hidden); if (state.lastMeetingState) { state.lastMeetingState = ''; lock(); } };
  for (const id of ['title', 'date', 'participants', 'notes']) $(id).addEventListener('input', () => { queueDraft(); lock(); });
  $('output-format').onchange = () => { state.formatChosen = true; queueDraft(); renderFormatExample(); lock(); };
  $('format-help').onclick = () => { $('format-example').hidden = !$('format-example').hidden; renderFormatExample(); };
  $('custom-name').oninput = renderFormatExample; $('custom-instruction').oninput = renderFormatExample;
  $('custom-save').onclick = () => task(async () => {
    state.customFormat = await call('saveCustomFormat', { customFormat: editorValue(true) }); updateCustomOption(); loadEditor();
    $('custom-status').textContent = `‘${state.customFormat.name}’ 형식을 저장했습니다. 다음 분석부터 이 형식으로 정리합니다.`; renderFormatExample(); lock();
  });
  $('custom-delete').onclick = () => task(async () => {
    if (!state.customDeleteArmed) { state.customDeleteArmed = true; $('custom-delete').textContent = '한 번 더 눌러 삭제'; return; }
    await call('deleteCustomFormat'); state.customFormat = null; updateCustomOption();
    if ($('output-format').value === 'custom') { $('output-format').value = 'meeting'; queueDraft(); }
    loadEditor(); renderSettings(); $('custom-status').textContent = '내 형식을 삭제했습니다. 이미 저장된 회의는 그대로입니다.'; renderFormatExample(); lock();
  });
  $('start').onclick = () => task(async () => {
    await flushDraft();
    await call('start', { date: $('date').value, title: $('title').value.trim(), participants: $('participants').value, notes: $('notes').value, ...formatFields() });
    clearTimeout(draftTimer); draftTimer = 0;
    for (const id of ['title', 'participants', 'notes']) $(id).value = '';
    state.formatChosen = false; $('output-format').value = newMeetingFormat(); setPrep(false); await poll(true);
  });
  $('finish').onclick = () => task(async () => { await call('finish'); $('workflow').textContent = '녹음을 저장하고 분석합니다.'; });
  $('retry').onclick = () => task(async () => {
    if (!Flow.canAnalyze(state.connection)) { openSettings(null, 'ai'); throw new Error(state.connection.accessMode === 'exhausted' ? Flow.EXHAUSTED_MESSAGE : '설정의 AI 연결에서 API 키를 먼저 등록하세요.'); }
    await call('analyze', { ...state.opened }); await poll(true); });
  $('refresh').onclick = () => task(history);
  $('close-result').onclick = closeResult;
  $('share-all').onclick = () => task(() => call('share', { ...state.opened, kind: 'all' }));
  // 결과 화면: 보고 있는 탭의 내용을 바로 복사하거나 다른 앱으로 공유한다.
  function showTab(tab) {
    state.resultTab = tab; const minutes = tab === 'minutes', r = state.result || {};
    $('tab-minutes').setAttribute('aria-selected', String(minutes)); $('tab-transcript').setAttribute('aria-selected', String(!minutes));
    $('tab-minutes').tabIndex = minutes ? 0 : -1; $('tab-transcript').tabIndex = minutes ? -1 : 0;
    $('panel-minutes').hidden = !minutes; $('panel-transcript').hidden = minutes;
    const name = minutes ? r.label || '정리본' : '전사문', ready = minutes ? r.minutes : r.transcript;
    $('copy-result').lastChild.textContent = `${name} 복사`; $('share-result').lastChild.textContent = `${name} 공유`;
    $('copy-result').disabled = !ready || state.busy || state.active; $('share-result').disabled = $('copy-result').disabled;
  }
  $('tab-minutes').onclick = () => showTab('minutes'); $('tab-transcript').onclick = () => showTab('transcript');
  for (const id of ['tab-minutes', 'tab-transcript']) $(id).addEventListener('keydown', event => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    const next = state.resultTab === 'minutes' ? 'transcript' : 'minutes'; showTab(next); $(next === 'minutes' ? 'tab-minutes' : 'tab-transcript').focus();
  });
  const resultKind = () => state.resultTab === 'transcript' ? 'transcript' : 'summary';
  $('copy-result').onclick = () => task(async () => { await call('copy', { ...state.opened, kind: resultKind() }); message(`‘${resultKind() === 'transcript' ? '전사문' : state.result?.label || '정리본'}’ 내용을 복사했습니다. 메신저나 메일에 붙여 넣으세요.`); });
  $('share-result').onclick = () => task(() => call('share', { ...state.opened, kind: resultKind() }));

  function openSettings(event, section = 'ai') { state.removeArmed = false; $('remove-key').textContent = '키 삭제'; renderConnection(); renderSettings(); lock(); openDialog('settings', event?.currentTarget); focusSettings(section); }
  $('open-settings').onclick = openSettings; $('blocker-settings').onclick = openSettings;
  async function saveKey() {
    const key = $('api-key').value.trim(); if (!key) throw new Error('API 키를 붙여 넣으세요.');
    const persist = document.querySelector('input[name="persist"]:checked').value === 'yes';
    state.connection = await call('key', { key, persist }); $('api-key').value = ''; renderConnection();
    message(state.connection.unlockApplied ? '설치본의 기본 키를 횟수 제한 없이 사용합니다.' : persist ? '키를 이 휴대폰에 저장했습니다.' : '키를 앱을 닫을 때까지만 사용합니다.');
  }
  $('save-key').onclick = () => task(saveKey);
  $('api-key').addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); task(saveKey); } });
  $('remove-key').onclick = () => task(async () => {
    if (!state.removeArmed) { state.removeArmed = true; $('remove-key').textContent = '한 번 더 눌러 삭제'; return; }
    state.removeArmed = false; $('remove-key').textContent = '키 삭제';
    state.connection = await call('removeKey'); renderConnection(); message('API 키를 삭제했습니다.');
  });
  $('model').onchange = () => task(async () => {
    const previous = state.connection.summaryModel;
    try { state.connection = await call('model', { model: $('model').value }); } catch (error) { $('model').value = previous; renderModelLimit(); throw error; }
    renderConnection(); message(state.active ? '요약 모델을 저장했습니다. 다음 분석부터 적용됩니다.' : '요약 모델을 저장했습니다.');
  });
  $('settings').addEventListener('close', () => { $('api-key').value = ''; lock(); });

  document.addEventListener('focusin', event => { const el = event.target; document.body.classList.toggle('typing', !!el.closest('main') && (el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && !['checkbox', 'radio'].includes(el.type)))); });
  document.addEventListener('focusout', () => setTimeout(() => { const el = document.activeElement; if (!el || !el.closest('main') || !['INPUT', 'TEXTAREA'].includes(el.tagName)) document.body.classList.remove('typing'); }, 0));
  document.addEventListener('visibilitychange', () => { if (document.hidden) flushDraft(); });
  window.handleBack = () => {
    for (const dialog of [...document.querySelectorAll('dialog')].reverse()) if (dialog.open) { if (dialog.id !== 'settings-preview' || !state.busy) dialog.close(); return true; }
    if (!$('result').hidden) { closeResult(); return true; }
    if (!$('prep').hidden) { setPrep(false); return true; }
    return false;
  };

  $('date').value = today(); lock();
  task(async () => {
    const init = await call('init'); state.settings = init.settings || {}; state.connection = init.connection; state.active = !!init.connection.active;
    state.customFormat = init.customFormat || null; updateCustomOption();
    loadEditor(); renderSettings(); renderConnection(); await applyDraft(); await history(); await poll(true); setInterval(poll, 1500);
  });
})();
