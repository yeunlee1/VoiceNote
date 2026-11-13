// 네이티브 녹음 상태와 보관함별 지난 회의 및 AI 설정을 연결한다.
(() => {
  const $ = id => document.getElementById(id), pending = new Map(), Flow = window.VoiceFlow, Todos = window.MeetingTodos;
  const state = { settings: {}, connection: { keyConfigured: false, keySource: 'none', models: [], summaryModel: '' }, active: false, recording: false, busy: false, opened: null, lastState: '', lastHistory: '', lastMeetingState: '', removeArmed: false, deleteArmed: false, opener: null,
    // 앱 업데이트 상태(네이티브가 알려 준 그대로), 한 번 누름으로 받은 뒤 설치까지 이어 갈지, 실행 중 여부와 마지막 오류다.
    update: null, updateIntent: false, updateRunning: false, updateError: '',
    // 업데이트로 앱이 닫히면 사라질 입력이다. 평가 의견·별점, 내 형식 편집, 회의 준비 저장 실패를 따로 기억한다.
    reviewDirty: false, customDirty: false, draftSaving: null, draftFailed: false,
    // 지금 보는 탭과, 사람이 고친 할 일 수정본·고치는 중인 줄·저장 중인 요청 수다.
    view: 'new', todos: null, todoConfirmed: null, todoEditing: null, todoPending: 0, todoSerial: 0, todoQueue: Promise.resolve(),
    // me는 이 회의에 저장된 나의 선택(없으면 null), mePicking은 나 고르기 상자를 펼쳤는지, meBusy는 나를 저장하는 중인지, resultTab은 결과 화면에서 보는 탭이다.
    me: null, mePicking: false, meBusy: false, resultTab: 'mine' };
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
    return { busy: state.busy, active: state.active || !!state.refining || !!state.importing, opened: !!state.opened, keyConfigured: Flow.canAnalyze(state.connection), trialExhausted: state.connection.accessMode === 'exhausted',
      date: $('date').value, notes: $('notes').value, customMissing: $('output-format').value === 'custom' && !state.customFormat,
      permissionPending: !!state.connection.permissionPending, filePending: !!state.connection.filePending, modelError: !!state.connection.modelError };
  }
  function renderBlockers() {
    const reasons = Flow.startBlockers(snapshot()), list = $('blocker-list');
    $('blockers').hidden = state.active || !!state.importing;
    list.replaceChildren(...(reasons.length ? reasons.map(reason => node('li', reason.text)) : [node('li', '위쪽의 회의 시작을 누르면 바로 녹음합니다.')]));
    $('blockers').classList.toggle('ready', reasons.length === 0);
    $('blockers').querySelector('.needs-title').textContent = reasons.length ? '시작 전 필요' : '준비 완료';
    $('blocker-settings').hidden = !reasons.some(reason => reason.id === 'key');
    const count = $('notes').value.length;
    $('notes-count').textContent = `${number(count)} / 4,000`;
    $('notes-count').classList.toggle('over', count > Flow.NOTES_LIMIT);
  }
  function renderStage() {
    const order = ['prepare', 'record', 'analyze', 'done'];
    const current = state.recording ? 'record' : state.active || state.importing ? 'analyze' : state.lastMeetingState === 'complete' ? 'done' : 'prepare';
    for (const li of $('stage').children) {
      const index = order.indexOf(li.dataset.stage), at = order.indexOf(current);
      li.classList.toggle('done', index < at || current === 'done');
      if (li.dataset.stage === current) li.setAttribute('aria-current', 'step'); else li.removeAttribute('aria-current');
    }
  }
  function lock() {
    const idle = !state.busy && !state.active && !state.refining;
    $('prepare').disabled = !idle;
    // 회의가 진행 중이면 준비 칸을 접고 회의 전에 적은 내용을 읽기로 보여 준다.
    setPrep(!state.active && !state.refining && !state.importing);
    $('start').hidden = state.recording || state.view !== 'new'; $('finish').hidden = !state.recording;
    $('console-heading').textContent = state.recording ? '녹음 중' : state.view === 'records' ? '회의 기록' : '새 회의';
    renderPeople($('people-preview'), Todos.people($('participants').value));
    // 업데이트 설치 확인 화면을 기다리는 동안에는 네이티브도 새 회의를 거절하므로 시작 단추를 잠근다.
    $('start').disabled = !Flow.canStart(snapshot()) || state.update?.status === 'confirming';
    $('import-audio').disabled = $('start').disabled; $('import-wrap').hidden = state.active || !!state.refining || !!state.importing;
    // 녹음 파일 불러오기는 회의 시작과 같은 조건에서만 누를 수 있고, 녹음·분석 중에는 감춘다.
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
    for (const input of document.querySelectorAll('#prep input,#prep textarea,#prep select,#default-format,[data-pick-folder],[data-clear-folder],#export-settings,#import-settings,#apply-settings,#my-name,#my-name-save')) input.disabled = !idle;
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
    $('share-result').disabled = $('copy-result').disabled; $('save-text').disabled = $('copy-result').disabled;
    $('share-all').disabled = !idle || !state.opened;
    $('save-copies').disabled = !resultReady;
    // 받는 동안 녹음 시작·분석·저장 같은 작업이 끼면 '지금 업데이트'의 자동 설치 예약을 취소한다. 받은 뒤에는 사람이 '설치'를 다시 누른다.
    if (state.updateIntent && (state.active || state.refining || state.busy)) state.updateIntent = false;
    renderBlockers(); renderStage(); renderUpdate();
  }
  // 체험 횟수를 다 쓴 뒤 분석을 시도하면 안내 문구를 보이고 AI 설정을 연다.
  async function task(work) { if (state.busy) return; state.busy = true; lock(); let exhausted = false; try { await work(); } catch (error) { message(error.message); exhausted = error.message === Flow.EXHAUSTED_MESSAGE; } finally { state.busy = false; lock(); } if (exhausted && !$('settings').open) openSettings(); }

  function showView(view) {
    state.view = view; $('view-new').hidden = view !== 'new'; $('view-records').hidden = view !== 'records';
    for (const [id, name] of [['tab-new', 'new'], ['tab-records', 'records']]) { if (name === view) $(id).setAttribute('aria-current', 'page'); else $(id).removeAttribute('aria-current'); }
    window.scrollTo(0, 0); lock();
  }
  function renderPeople(host, names) { host.replaceChildren(...names.map((name, index) => { const row = node('li'); row.append(node('b', index + 1), node('span', name)); return row; })); }
  function filterHistory() { const query = $('history-search').value.trim().toLowerCase(); for (const button of $('history').querySelectorAll('button')) button.hidden = Boolean(query) && !button.dataset.search.includes(query); }
  function setPrep(open) {
    $('prep').hidden = !open; $('prepare').setAttribute('aria-expanded', String(open));
  }
  // 모달 위에 미리보기 모달이 겹칠 수 있으므로 돌아갈 포커스는 모달마다 따로 기억한다.
  function openDialog(id, opener) { if ($(id).open) return; $(id).returnFocus = opener || document.activeElement; $(id).showModal(); }
  // 연 단추가 그 사이 숨었으면(예: 새 버전 안내 줄이 사라짐) 프로그램 정보는 설정 단추로 초점을 돌린다.
  for (const dialog of document.querySelectorAll('dialog')) dialog.addEventListener('close', () => { const opener = dialog.returnFocus; dialog.returnFocus = null; if (opener && document.contains(opener) && !opener.hidden) opener.focus(); else if (dialog.id === 'about') $('open-settings').focus(); else if (!$('result').hidden) focusResultControl(opener?.dataset?.todoFocus); });
  // 결과 화면에서 연 창의 단추가 그사이 다시 그려졌으면 같은 열쇠의 새 단추로 돌아가고, 그런 단추가 없으면(설정에 내 이름을 적어 나를 알게 된 경우 등) 내 할 일의 바꾸기·후보나 보고 있던 탭으로 간다.
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
  // 회의 준비 저장을 하나 보내고, 끝날 때까지 진행 중으로 기억한다. 실패하면 업데이트 설치가 막히도록 실패를 남긴다.
  function saveDraftNow() {
    // 끝났다는 표시는 결과를 받는 그 자리에서 지운다. 이 저장을 기다린 쪽이 다음 줄에서 볼 때 이미 지워져 있어야 한다.
    const job = call('saveDraft', draftData()).then(
      () => { if (state.draftSaving === job) state.draftSaving = null; state.draftFailed = false; },
      error => { if (state.draftSaving === job) state.draftSaving = null; state.draftFailed = true; throw error; });
    state.draftSaving = job;
    return job;
  }
  function queueDraft() { clearTimeout(draftTimer); draftTimer = setTimeout(() => { draftTimer = 0; saveDraftNow().catch(error => message(error.message)); }, 500); }
  async function flushDraft() { if (!draftTimer) return; clearTimeout(draftTimer); draftTimer = 0; await saveDraftNow().catch(() => {}); }
  // 업데이트 설치 직전에 쓰는 엄격한 저장이다. 기다리던 저장과, 그사이 새로 적어 타이머에 걸린 저장까지 끝나야 하고 실패하면 설치하지 않는다.
  // 계속 새로 적고 있으면 세 번까지만 기다린다.
  // 지난 저장이 실패했으면 여기서 한 번 다시 저장해 본다. 그래서 실패해도 설치 단추를 잠그지 않고, 누르면 다시 저장한 뒤에만 설치한다.
  async function settleDraft() {
    if (state.draftFailed && !draftTimer && !state.draftSaving) await saveDraftNow();
    for (let round = 0; round < 3 && (draftTimer || state.draftSaving); round++) {
      if (draftTimer) { clearTimeout(draftTimer); draftTimer = 0; await saveDraftNow(); }
      else await state.draftSaving;
    }
    if (draftTimer || state.draftSaving) throw new Error('회의 준비 내용을 저장하는 중입니다. 잠시 뒤 다시 눌러 주세요.');
    if (state.draftFailed) throw new Error('회의 준비 내용을 저장하지 못했습니다. 잠시 뒤 다시 눌러 주세요.');
  }
  const stateLabels = { complete: '회의록', failed: '분석 실패', interrupted: '녹음 중단', saved: '음성 저장', analyzing: '분석 중', recording: '녹음 중' };
  async function history() {
    const data = await call('history'), entries = data.meetings, rows = [];
    if (data.skipped) rows.push(node('p', '읽지 못한 기록 ' + data.skipped + '개', 'hint'));
    if (!entries.length) rows.push(node('p', '보관된 회의가 없습니다.', 'empty'));
    for (const entry of entries) {
      const button = node('button'); button.type = 'button'; button.dataset.location = entry.location; button.dataset.id = entry.id; button.dataset.search = `${entry.title || '제목 미정 회의'} ${entry.date || ''} ${entry.projectName || ''}`.toLowerCase();
      const label = entry.state !== 'complete' ? stateLabels[entry.state] : Flow.outputFormat(entry.outputFormat) === 'custom' && entry.customFormat?.name ? entry.customFormat.name : Flow.FORMAT_LABELS[Flow.outputFormat(entry.outputFormat)];
      const status = node('span', null, 'state ' + (entry.state === 'failed' || entry.state === 'interrupted' ? 'failed' : ''));
      if (entry.mineOpen) status.append(node('span', `내 일 ${entry.mineOpen}`, 'mine-count'));
      // 최신 결과에서 내가 아직 안 끝낸 일의 수를 형식 이름 위에 둔다. 0이거나 내가 누구인지 모르면 네이티브가 주지 않는다.
      status.append(node('span', label || '보관'));
      button.append(node('small', entry.date + ' · ' + entry.dailySequence + '차'), node('strong', entry.title || '제목 미정 회의'), status);
      if (entry.projectName) button.append(node('small', '이전 프로젝트: ' + entry.projectName));
      if (entry.stars) button.append(node('small', '★ ' + entry.stars));
      button.onclick = () => openRow(entry.location, entry.id, button, entry.resultId);
      rows.push(button);
    }
    const y = window.scrollY; $('history').replaceChildren(...rows); window.scrollTo(0, y);
    // 할 일을 저장할 때마다 목록을 다시 읽으므로, 한 번에 갈고 보던 자리를 되돌려 목록이 위로 튀지 않게 한다.
    filterHistory();
  }
  function currentTodos() { return Todos.effective(state.result.data, state.todos); }
  function renderMinutes() {
    const r = state.result; $('minutes').replaceChildren();
    if (r?.data) renderSections($('minutes'), Flow.minutesSections(r.format, Todos.apply(r.data, state.todos), r.custom), renderTodos);
    renderMine();
    // 정리본과 내 할 일 탭은 같은 할 일 목록을 보여 주므로 함께 다시 그린다.
  }
  function renderTodosAgain(focusKey) { renderMinutes(); if (focusKey) (state.resultTab === 'mine' ? $('panel-mine') : $('minutes')).querySelector(`[data-todo-focus="${focusKey}"]`)?.focus(); }
  // 초점은 보고 있는 탭의 패널에서 되찾는다. 내 할 일 탭의 체크 상자는 mine:<번호> 열쇠를 쓴다.
  function renderTodosKeepingFocus(fallbackKey) {
    // 늦게 온 응답으로 다시 그릴 때 쓴다. 초점이 보고 있는 패널 안에 있었으면 같은 열쇠의 새 요소로, 잃었으면 fallbackKey로 돌려준다.
    const panel = state.resultTab === 'mine' ? $('panel-mine') : $('minutes'), active = document.activeElement;
    const inside = panel.contains(active), lost = !active || active === document.body;
    renderTodosAgain(inside ? active.dataset?.todoFocus || fallbackKey : lost ? fallbackKey : null);
    // 사용자가 그사이 패널 밖으로 옮긴 초점은 빼앗지 않는다.
  }
  function focusResultControl(key) {
    // 결과 화면에서 연 창의 단추가 그사이 다시 그려졌으면 같은 열쇠의 새 단추로, 없으면 내 할 일의 바꾸기·후보나 보고 있던 탭으로 초점을 돌린다.
    const panel = state.resultTab === 'mine' ? $('panel-mine') : $('minutes'), again = key ? panel.querySelector(`[data-todo-focus="${key}"]`) : null;
    if (again && !again.disabled) { again.focus(); return; }
    if (!(state.resultTab === 'mine' && focusMineControl())) $(`tab-${state.resultTab}`).focus();
  }
  function sameResult(target) {
    // 늦게 온 응답이 지금 열린 회의의 같은 결과에 대한 것인지 본다. 옛 회의는 결과 표지(legacy)가 같을 수 있어 보관함과 회의까지 함께 비교한다.
    return state.opened?.location === target.location && state.opened?.id === target.id && state.opened?.resultId === target.resultId;
  }
  function currentMe() {
    // 이 회의에서 나로 정해진 사람이다. 이 회의에 저장된 선택, 설정의 내 이름 순서로 정하고 모르면 null이다.
    return Todos.resolveMe(Todos.candidates(state.result?.participants || '', currentTodos()), state.me, state.settings?.myName || '');
  }
  function focusMine(key) {
    const target = $('panel-mine').querySelector(`[data-todo-focus="${key}"]`);
    if (!target || target.disabled) return false;
    target.focus(); return true;
  }
  function focusMineControl() {
    // 내 할 일 패널을 다시 그린 뒤 초점을 둘 곳이다. 나를 알면 바꾸기, 모르면 눌린 이름이나 첫 후보로 간다.
    return focusMine('me-change') || focusMine('who:pressed') || focusMine('who:0');
  }
  function restLine(items, meName) {
    // 내 일이 아닌 일의 수와 정리본으로 가는 단추다. 담당 미정은 아직 아무에게도 가지 않은 일이라 굵게 쓴다.
    const { unassigned, others } = Todos.rest(items, meName), line = node('div', null, 'mine-rest'), text = node('p');
    if (unassigned) text.append(node('b', `담당 미정 ${unassigned}건`));
    if (unassigned && others) text.append(' · ');
    if (others) text.append(`다른 사람 일 ${others}건`);
    if (text.childNodes.length) line.append(text);
    const all = node('button', '정리본에서 전체 보기', 'button mine-all'); all.type = 'button'; all.dataset.todoFocus = 'mine-all';
    all.onclick = () => { showTab('minutes'); $('tab-minutes').focus(); };
    line.append(all); return line;
  }
  function whoBox(list, me) {
    // 이 회의에서 나를 고르는 상자다. 참석자 번호와 이름(참석자를 안 적은 회의는 담당자 이름)이 후보다.
    const box = node('div', null, 'who-box'), group = node('div', null, 'who-list'), locked = !state.opened?.resultId || state.meBusy;
    group.setAttribute('role', 'group'); group.setAttribute('aria-label', '이 회의의 사람 중에서 나 고르기');
    list.forEach((entry, index) => {
      const pressed = me?.name === entry.name, pick = node('button', null, 'who-button');
      pick.type = 'button'; pick.disabled = locked; pick.setAttribute('aria-pressed', String(pressed)); pick.dataset.todoFocus = pressed ? 'who:pressed' : `who:${index}`;
      if (entry.number) pick.append(node('b', entry.number, 'num'));
      pick.append(node('span', entry.name));
      pick.onclick = () => {
        if (!pressed) return saveMe(entry.name);
        state.mePicking = false; renderMine(); focusMine('me-change');
        // 눌린 이름을 다시 누르면 바꾸지 않고 상자만 닫는다.
      };
      group.append(pick);
    });
    box.append(node('p', '이 회의에서 나는 누구인가요?', 'who-lead'), group, node('p', '한 번 고르면 이 회의에 기억합니다. 설정에 적어 둔 내 이름과 같은 사람이 있으면 앱이 미리 골라 둡니다.', 'hint'));
    if (state.me !== null) {
      const clear = node('button', '선택 지우기', 'button who-clear'); clear.type = 'button'; clear.disabled = locked; clear.dataset.todoFocus = 'who-clear';
      clear.onclick = () => saveMe(null); box.append(clear);
      // 이 회의에 저장된 선택이 있으면 지울 수 있다. 지금 결과의 후보에 없어 적용되지 않는 옛 선택도 지울 수 있어야 한다.
    }
    if (!state.settings?.myName) {
      const settings = node('button', '설정에 내 이름 적어 두기', 'link who-settings'); settings.type = 'button'; settings.dataset.todoFocus = 'who-settings'; settings.setAttribute('aria-haspopup', 'dialog');
      settings.onclick = () => openSettings({ currentTarget: settings }, 'me'); box.append(settings);
      // 설정에 내 이름이 없으면 회의마다 고르지 않아도 되게 설정의 내 이름 칸으로 가는 길을 둔다.
    }
    return box;
  }
  function renderMine() {
    // 내 할 일 탭을 다시 그린다. 판정하지 못한 회의가 내 일이 없는 회의처럼 보이지 않게 상태마다 다른 말로 보여 준다.
    const panel = $('panel-mine');
    if (!state.result?.data) return panel.replaceChildren();
    const items = currentTodos();
    if (!items.length) return panel.replaceChildren(node('p', '이 회의에는 정리된 할 일이 없습니다.', 'mine-empty'));
    const list = Todos.candidates(state.result.participants, items);
    if (!list.length) return panel.replaceChildren(node('p', '참석자를 적지 않은 회의라 누가 맡았는지 알 수 없습니다.', 'mine-empty'), restLine(items, null));
    const me = currentMe();
    if (!me) return panel.replaceChildren(...[whoBox(list, null), shareBlock()].filter(Boolean));
    const mine = Todos.mine(items, me.name), left = mine.filter(item => !item.done).length, editable = !!state.opened?.resultId;
    const head = node('div', null, 'mine-head'), title = node('div', null, 'mine-title'), row = node('div', null, 'me-row');
    title.append(node('h3', '내가 맡은 일'));
    if (mine.length) title.append(node('span', left ? `${left}건 남음` : '모두 끝냄', 'mine-left'));
    const change = node('button', '바꾸기', 'link me-change'); change.type = 'button'; change.dataset.todoFocus = 'me-change'; change.setAttribute('aria-expanded', String(state.mePicking));
    change.onclick = () => { state.mePicking = !state.mePicking; renderMine(); if (!state.mePicking || !(focusMine('who:pressed') || focusMine('who:0'))) focusMine('me-change'); };
    row.append(node('span', '나', 'me-chip'), node('span', me.name, 'me-name'), change);
    head.append(title, row);
    const parts = [head];
    if (state.mePicking) parts.push(whoBox(list, me));
    if (!mine.length) parts.push(node('p', '이 회의에서 내가 맡은 일은 없습니다.', 'mine-empty'));
    else {
      const rows = node('ul', null, 'mine-list');
      for (const item of mine) {
        const line = node('li', null, `mine-row${item.done ? ' is-done' : ''}`), label = node('label'), check = node('input'), text = node('span', null, 'mine-text');
        check.type = 'checkbox'; check.checked = item.done; check.disabled = !editable; check.dataset.todoFocus = `mine:${item.index}`;
        check.onchange = () => updateTodo(item.index, { done: check.checked }, check.dataset.todoFocus);
        text.append(node('span', item.task, 'mine-task'), node('span', item.due || '', 'mine-due'));
        // 기한은 저장된 글자 그대로 문장 아래에 쓰고, 없으면 비워 둔다.
        label.append(check, text); line.append(label); rows.append(line);
      }
      parts.push(rows);
    }
    parts.push(restLine(items, me.name));
    const share = shareBlock(); if (share) parts.push(share);
    panel.replaceChildren(...parts);
  }
  function shareGroups() { return Todos.shareGroups(state.result?.participants || '', currentTodos()); }
  function shareReady() {
    // 사람별 글은 정리본이 있는 결과에서만 만든다. 담당자가 있는 남은 일이 한 건도 없으면 보낼 글이 없다.
    return !!state.result?.data && shareGroups().length > 0;
  }
  function shareBlock() {
    // 내 할 일 패널 끝에서 사람별 할 일 복사 창을 여는 단추다. 내가 누구인지와 상관없이 보낼 글이 있으면 보인다.
    if (!shareReady()) return null;
    const block = node('div', null, 'send-block'), open = node('button', '사람별 할 일 복사', 'button share-open');
    open.type = 'button'; open.dataset.todoFocus = 'share-open'; open.setAttribute('aria-haspopup', 'dialog'); open.onclick = () => openShare(open);
    block.append(open, node('p', '받는 사람마다 그 사람의 남은 일만 담은 글을 복사해 메신저나 메일에 붙여 넣습니다.', 'hint'));
    return block;
  }
  function setShareStatus(text, tone = '') { $('share-status').textContent = text; $('share-status').dataset.tone = tone; }
  function renderSharePreview(groups) {
    const group = groups.find(entry => entry.name === state.shareCurrent);
    $('share-preview-title').textContent = group ? `${group.name} 님에게 갈 글` : '';
    $('share-preview').textContent = group ? Todos.shareText(state.result.title, state.result.date, group) : '';
  }
  function renderShare() {
    // 남은 일이 한 건이라도 있는 사람을 번호순으로 한 줄씩 보여 주고, 고른 사람에게 갈 글을 아래에 미리 보여 준다.
    const groups = shareGroups(), me = currentMe();
    if (!groups.some(group => group.name === state.shareCurrent)) state.shareCurrent = groups[0]?.name ?? null;
    $('share-list').replaceChildren(...groups.map(group => {
      const row = node('li', null, 'copy-row'), who = node('span', null, 'copy-who'), copied = state.shareCopied.has(group.name);
      row.dataset.current = String(group.name === state.shareCurrent);
      if (group.number) who.append(node('b', group.number, 'num'));
      who.append(node('span', Todos.sameName(group.name, me?.name) ? `${group.name} (나)` : group.name, 'copy-name'), node('span', `${group.tasks.length}건`, 'copy-count'));
      const pick = () => {
        state.shareCurrent = group.name;
        for (const other of $('share-list').children) { const on = other === row; other.dataset.current = String(on); other.querySelector('.copy-show')?.setAttribute('aria-pressed', String(on)); }
        renderSharePreview(groups);
        // 줄을 다시 그리지 않고 표시만 바꿔 누른 단추에 초점이 남게 한다.
      };
      const show = node('button', '보기', 'link copy-show'); show.type = 'button'; show.setAttribute('aria-pressed', String(group.name === state.shareCurrent)); show.setAttribute('aria-label', `${group.name} 님에게 갈 글 보기`); show.onclick = pick;
      const copy = node('button', copied ? '복사함' : '복사', 'button copy-button'); copy.type = 'button'; copy.dataset.copied = String(copied); copy.setAttribute('aria-label', `${group.name} 님 할 일 ${copied ? '다시 복사' : '복사'}`);
      copy.onclick = async () => {
        const session = state.shareSession; pick();
        try {
          await call('copyText', { text: Todos.shareText(state.result.title, state.result.date, group) });
          if (session !== state.shareSession) return;
          // 창을 닫았다 다시 열었으면 그 사이 끝난 이전 복사는 새 창에 표시하지 않는다.
          state.shareCopied.add(group.name); copy.textContent = '복사함'; copy.dataset.copied = 'true'; copy.setAttribute('aria-label', `${group.name} 님 할 일 다시 복사`);
          setShareStatus(`${group.name} 님 할 일을 복사했습니다. 메신저에 붙여 넣으세요.`);
        } catch (error) { if (session === state.shareSession) setShareStatus(error.message.includes('복사') ? error.message : `복사하지 못했습니다. ${error.message}`, 'error'); }
        // 실패하면 복사함으로 바꾸지 않고, 아래 미리보기 글을 직접 골라 복사할 수 있게 둔다.
      };
      row.append(who, show, copy);
      return row;
    }));
    const unassigned = currentTodos().filter(item => !item.done && !String(item.owner ?? '').trim()).length;
    $('share-unassigned').hidden = !unassigned;
    $('share-unassigned').textContent = unassigned ? `담당 미정 ${unassigned}건은 누구에게도 가지 않습니다. 정리본에서 담당자를 먼저 맞추세요.` : '';
    renderSharePreview(groups);
  }
  function openShare(opener) {
    // 창을 열 때마다 복사함 표시를 지운다. 누구에게 보냈는지는 저장하지 않는다. 떠 있는 알림은 창을 가리지 않게 치운다.
    state.shareCopied = new Set(); state.shareCurrent = null; state.shareSession = (state.shareSession || 0) + 1; setShareStatus('');
    // 창을 열 때마다 새 차례를 매겨, 이전 창에서 누른 복사의 늦은 결과가 새 창을 바꾸지 않게 한다.
    clearTimeout(message.timer); $('message').hidden = true;
    renderShare(); openDialog('share', opener);
  }
  async function saveMe(name) {
    // 이 회의에서 나를 고르거나(이름) 고른 것을 지운다(null). 먼저 화면에 반영하고, 실패하면 앞선 선택으로 되돌린다.
    if (state.meBusy || !state.opened?.resultId) return false;
    const target = { ...state.opened }, before = state.me, hadFocus = $('panel-mine').contains(document.activeElement);
    // 저장할 결과를 지금 결과로 고정한다. 누른 단추는 다시 그리며 사라지므로 초점이 이 패널 안에 있었는지 기억해 둔다.
    const same = () => state.opened?.location === target.location && state.opened?.id === target.id && state.opened?.resultId === target.resultId;
    state.me = name; state.mePicking = false; state.meBusy = true; state.todoPending++;
    // 할 일 저장과 같은 대기 수를 올려 저장이 끝날 때까지 결과 닫기·버전 바꾸기·다시 분석·업데이트 설치를 같은 규칙으로 막는다.
    renderMine(); if (hadFocus) focusMineControl(); lock();
    try {
      const { me = null } = await call('saveMe', { ...target, name });
      if (same()) { state.me = me; message(me ? `이 회의에서 나는 ${me}입니다.` : '고른 나를 지웠습니다.'); }
      await history().catch(() => {});
      // 지난 회의 목록의 내 일 수를 다시 센다. 목록을 다시 읽지 못해도 나는 저장되었으므로 실패로 되돌리지 않는다.
      return true;
    } catch (error) {
      if (same()) { state.me = before; message(`나를 저장하지 못했습니다. ${error.message}`); }
      else message(`이전 회의의 나를 저장하지 못했습니다. ${error.message}`);
      return false;
    } finally {
      state.meBusy = false; state.todoPending--; clearTodoNotice();
      if (same()) {
        const active = document.activeElement, inside = $('panel-mine').contains(active), lost = !active || active === document.body;
        const key = inside ? active.dataset?.todoFocus : '';
        // 다시 그리면 패널 안의 조작 요소가 새것으로 바뀐다. 저장 중에 옮겨 둔 패널 안 초점은 같은 열쇠의 새 요소로 돌려주고, 그 요소가 없거나 잠겨 초점을 잃었으면 바꾸기·후보로 간다.
        renderMine();
        if (inside || (hadFocus && lost)) { if (!key || !focusMine(key)) focusMineControl(); }
        // 사용자가 그사이 패널 밖으로 옮긴 초점은 빼앗지 않는다.
      }
      lock();
    }
  }
  function renderTodos(host, title, undecided) {
    // 저장된 결과에서만 고칠 수 있다. 참석자를 안 적은 회의는 번호 없이 체크만 된다.
    const section = node('section', null, 'todo-section'), people = Todos.people(state.result.participants), finalized = !!state.todos?.finalized, editable = !!state.opened?.resultId, assigning = editable && people.length > 0 && !finalized;
    section.append(node('h3', title));
    if (assigning) { section.append(node('p', '번호를 누르면 담당자 이름이 들어가고 복사·공유에도 반영됩니다.', 'todo-hint')); const legend = node('ol', null, 'people'); renderPeople(legend, people); section.append(legend); }
    const items = currentTodos().map((item, index) => ({ ...item, index })), rows = node('ol', null, 'todo-list');
    // 번호를 누르는 동안에는 줄이 움직이지 않게 맞추기를 끝낸 뒤에만 이름순으로 보여 준다.
    for (const item of finalized ? Todos.sorted(items) : items) rows.append(todoRow(item, people, assigning, editable, undecided));
    section.append(rows);
    if (editable && people.length) {
      const finish = node('button', finalized ? '담당자 다시 맞추기' : '맞추기 완료', 'button todo-finish'); finish.type = 'button'; finish.dataset.todoFocus = 'finish';
      finish.onclick = () => commitTodos({ finalized: !finalized, items: currentTodos() }, 'finish'); section.append(finish);
    }
    if (shareReady()) { const share = node('button', '사람별 할 일 복사', 'button todo-share'); share.type = 'button'; share.dataset.todoFocus = 'share'; share.setAttribute('aria-haspopup', 'dialog'); share.onclick = () => openShare(share); section.append(share); }
    // 담당자를 맞춘 자리에서 바로 사람마다 보낼 글을 복사할 수 있게 같은 창을 여는 단추를 둔다.
    host.append(section);
  }
  function todoRow(item, people, assigning, editable, undecided) {
    const row = node('li', null, `todo-row${item.done ? ' is-done' : ''}`), check = node('input'), box = node('label', null, 'todo-check');
    check.type = 'checkbox'; check.checked = item.done; check.disabled = !editable; check.setAttribute('aria-label', `${item.task} 완료`); check.dataset.todoFocus = `${item.index}:check`;
    check.onchange = () => updateTodo(item.index, { done: check.checked }, check.dataset.todoFocus); box.append(check); row.append(box);
    if (state.todoEditing?.index === item.index) { row.append(todoEditor()); return row; }
    row.append(node('span', item.task, 'todo-task'));
    const meta = node('span', null, 'todo-meta'); meta.append(node('span', item.owner || (undecided ? '담당 미정' : ''), 'todo-owner'), node('span', item.due || (undecided ? '기한 미정' : ''), 'todo-due')); row.append(meta);
    if (editable && people.length) {
      const tools = node('div', null, 'todo-tools');
      if (assigning) people.forEach((name, position) => {
        const button = node('button', position + 1, 'todo-num'); button.type = 'button'; button.setAttribute('aria-pressed', String(item.owner === name)); button.setAttribute('aria-label', `${position + 1}번 ${name}`); button.dataset.todoFocus = `${item.index}:n${position + 1}`;
        button.onclick = () => updateTodo(item.index, { owner: currentTodos()[item.index].owner === name ? null : name }, button.dataset.todoFocus); tools.append(button);
      });
      const edit = node('button', '수정', 'todo-edit'); edit.type = 'button'; edit.setAttribute('aria-label', `${item.task} 수정`); edit.dataset.todoFocus = `${item.index}:edit`;
      edit.onclick = () => { state.todoEditing = { index: item.index, task: item.task, due: item.due || '' }; renderTodosAgain(`${item.index}:task`); lock(); }; tools.append(edit); row.append(tools);
    }
    return row;
  }
  function todoEditor() {
    const box = node('div', null, 'todo-editor'), editing = state.todoEditing;
    const field = (name, label, max, placeholder) => { const input = node('input'); input.value = editing[name]; input.maxLength = max; input.placeholder = placeholder; input.setAttribute('aria-label', label); input.dataset.todoFocus = `${editing.index}:${name}`; input.oninput = () => { editing[name] = input.value; }; return input; };
    const actions = node('div', null, 'row'), save = node('button', '저장', 'button primary'), cancel = node('button', '취소', 'button'); save.type = 'button'; cancel.type = 'button';
    save.onclick = saveTodoEdit; cancel.onclick = () => { const index = editing.index; state.todoEditing = null; clearTodoNotice(); renderTodosAgain(`${index}:edit`); lock(); }; actions.append(save, cancel);
    box.append(field('task', '할 일 문장', Todos.LIMITS.task, '할 일'), field('due', '기한', Todos.LIMITS.field, '기한 (선택)'), actions); return box;
  }
  async function saveTodoEdit() {
    const editing = state.todoEditing; if (!editing) return;
    if (!editing.task.trim()) { message('할 일 문장을 적어 주세요.'); return; }
    const items = currentTodos().map(item => ({ ...item })); Object.assign(items[editing.index], { task: editing.task.trim(), due: editing.due.trim() || null });
    // 저장에 실패하면 고치던 칸을 그대로 두어 입력을 잃지 않게 한다.
    if (await commitTodos({ finalized: !!state.todos?.finalized, items }, `${editing.index}:task`)) { state.todoEditing = null; clearTodoNotice(); renderTodosAgain(`${editing.index}:edit`); lock(); }
  }
  function updateTodo(index, patch, focusKey) { const items = currentTodos().map(item => ({ ...item })); Object.assign(items[index], patch); return commitTodos({ finalized: !!state.todos?.finalized, items }, focusKey); }
  function commitTodos(next, focusKey) {
    // 저장 대상을 지금 결과로 고정한다. 저장 도중 화면이 바뀌어도 원래 결과에만 저장한다.
    const target = { ...state.opened }, serial = ++state.todoSerial; state.todos = next; state.todoPending++; renderTodosAgain(focusKey); lock();
    state.todoQueue = state.todoQueue.then(async () => {
      try { await call('saveTodos', { ...target, todos: { finalized: next.finalized, items: next.items.map(({ task, owner, due, done }) => ({ task, owner, due, done })) } }); if (sameResult(target)) state.todoConfirmed = next; await history().catch(() => {}); return true; }
      // 뒤에 더 누른 저장이 남아 있으면 그 저장이 목록 전체를 다시 쓰므로 되돌리지 않는다. 마지막 저장이 실패했을 때만 저장이 확인된 값으로 돌아간다.
      catch (error) { if (sameResult(target) && serial === state.todoSerial) { state.todos = state.todoConfirmed; renderTodosKeepingFocus(focusKey); } message(`할 일을 저장하지 못했습니다. ${error.message}`); return false; }
      finally { state.todoPending--; clearTodoNotice(); lock(); }
    });
    return state.todoQueue;
  }
  const TODO_NOTICES = { editing: '고치던 할 일을 저장하거나 취소해 주세요.', saving: '할 일을 저장하는 중입니다. 잠시 뒤 다시 눌러 주세요.' };
  function todoHolding() { if (!state.todoEditing && !state.todoPending) return false; message(state.todoEditing ? TODO_NOTICES.editing : TODO_NOTICES.saving); return true; }
  // 막을 이유가 없어졌으면 안내를 남겨 두지 않는다. 저장 실패처럼 다른 안내는 그대로 둔다.
  function clearTodoNotice() { if (state.todoEditing || state.todoPending || !Object.values(TODO_NOTICES).includes($('message').textContent)) return; clearTimeout(message.timer); $('message').hidden = true; }
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
  // 저장이 끝나기 전에 회의를 다시 읽으면 저장 전 할 일이 화면에 올라와 저장본과 어긋난다.
  function openRow(location, id, opener, resultId) { if (state.todoPending) { message(TODO_NOTICES.saving); return; } task(() => open(location, id, opener, resultId)); }
  async function open(location, id, opener, resultId = null, tab = 'mine') {
    // 목록에서 열면 내 할 일 탭을, 결과 버전을 바꾸면 보던 탭을, 분석·의견 반영이 끝나 저절로 열리면 정리본 탭을 연다.
    const data = await call('open', { location, id, ...(resultId == null ? {} : { resultId }) });
    const { record, minutes, transcript } = data;
    // 목록의 회의를 열면 닫았을 때 그 목록으로 돌아오게 회의 기록 탭으로 옮겨 둔다.
    if (opener?.closest?.('#view-records') && state.view !== 'records') showView('records');
    const selected = data.resultId || record.resultId || resultId; state.opened = { location, id, ...(selected == null ? {} : { resultId: selected }) }; state.opener = opener || state.opener;
    $('meeting-date').textContent = `${record.date} · ${record.dailySequence}차 회의`;
    $('meeting-title').textContent = record.title || '회의';
    $('meeting-status').textContent = record.message || '녹음 파일을 보관했습니다.';
    $('meeting-notes').textContent = record.notes || ''; $('meeting-notes-wrap').hidden = !record.notes;
    $('transcript').textContent = transcript;
    const format = Flow.outputFormat(record.outputFormat), custom = format === 'custom' ? record.customFormat || null : null, label = custom ? custom.name : Flow.FORMAT_LABELS[format === 'custom' ? 'meeting' : format];
    state.todos = data.todos || null; state.todoConfirmed = state.todos; state.todoEditing = null; state.me = data.me ?? null; state.mePicking = false; if (data.todosUnreadable) message('저장된 할 일 수정본을 읽지 못해 AI 결과를 보여 줍니다. 원본 파일은 보존합니다.');
    state.result = { label, minutes: !!minutes, transcript: !!transcript, data: minutes || null, format, custom, participants: record.participants || '', title: record.title || '', date: record.date || '' };
    renderMinutes();
    if (!minutes) $('minutes').append(node('p', `아직 ${label}${format === 'tasks' ? '가' : '이'} 없습니다. 아래 재분석으로 다시 만들 수 있습니다.`, 'hint'));
    renderUsage(record);
    const versions = data.versions || []; $('result-version').replaceChildren(...versions.map((version,index) => {
      const option = node('option', [`${index + 1}번째 결과`, savedLabel(version.savedAt), Flow.FORMAT_LABELS[Flow.outputFormat(version.outputFormat)], version.refined && '의견 반영본', version.stars && `별 ${version.stars}개`].filter(Boolean).join(' · ')); option.value = version.id; return option;
    })); $('result-version').value = selected || ''; $('version-wrap').hidden = versions.length < 2;
    $('refined-badge').hidden = !record.feedback && !versions.find(version => version.id === selected)?.refined;
    $('review-panel').hidden = !minutes || !selected; state.stars = data.review?.stars || null; state.reviewDirty = false;
    $('review-comment').value = data.review?.comment || ''; $('review-state').textContent = data.review ? '저장된 평가입니다.' : '별점과 의견은 선택입니다. 평가 저장에는 요금이 들지 않습니다.';
    renderStars(); renderCopies(data.copies);
    $('transcript-meta').textContent = transcript ? `전사 ${number(Array.from(transcript).length)}자 · 녹음에서 인식한 글을 그대로 보여 줍니다.` : '아직 전사문이 없습니다.';
    showTab(availableTab(tab));
    $('result').hidden = false; document.body.style.overflow = 'hidden'; $('main').inert = true; document.querySelector('.topbar').inert = true; document.querySelector('.dock').inert = true; $('result').scrollTop = 0; $('result').focus();
    lock();
  }
  function renderSections(host, sections, renderActions = null) {
    // 출력 형식마다 같은 요약 자료를 다른 순서와 제목으로 보여 준다.
    for (const section of sections) {
      if (section.type === 'overview') {
        const summary = node('div', null, 'summary'); summary.append(node('strong', section.title));
        for (const line of section.text.split(/\n+/)) summary.append(node('p', line));
        host.append(summary);
      } else if (section.type === 'topics') {
        if (section.title && section.topics.length) host.append(node('h3', section.title));
        for (const topic of section.topics) { host.append(node(section.title ? 'h4' : 'h3', topic.title)); for (const text of topic.points || []) host.append(node('p', text)); }
      } else if (section.key === 'actions' && section.items.length && renderActions) renderActions(host, section.title, section.empty != null);
      else if (section.items.length) list(section.title, section.items, host);
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
    $('custom-delete').hidden = !state.customFormat; state.customDeleteArmed = false; state.customDirty = false; $('custom-delete').textContent = '내 형식 삭제';
    $('custom-status').textContent = state.customFormat ? '' : '아직 저장한 내 형식이 없습니다. 이름과 항목을 정하고 저장하세요.';
    renderEditorRows();
  }
  function renderEditorRows() {
    $('custom-section-list').replaceChildren(...state.customRows.map((row, index) => {
      const item = node('li', null, 'custom-row'), check = node('input'), title = node('input'), label = MeetingFormats.KEY_LABELS[row.key];
      check.type = 'checkbox'; check.checked = row.on; check.setAttribute('aria-label', `${label} 넣기`); check.onchange = () => { row.on = check.checked; state.customDirty = true; renderFormatExample(); };
      title.value = row.title; title.maxLength = MeetingFormats.LIMITS.title; title.setAttribute('aria-label', `${label} 항목 이름`); title.oninput = () => { row.title = title.value; state.customDirty = true; renderFormatExample(); };
      const move = (text, delta, disabled) => { const button = node('button', text, 'button move'); button.type = 'button'; button.disabled = disabled; button.dataset.edge = String(disabled); button.setAttribute('aria-label', `${label} ${delta < 0 ? '위로' : '아래로'}`);
        button.onclick = () => { [state.customRows[index], state.customRows[index + delta]] = [state.customRows[index + delta], state.customRows[index]]; state.customDirty = true; renderEditorRows(); renderFormatExample(); }; return button; };
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
  function focusSettings(section) { const el = $('settings-' + section); (section === 'me' ? $('my-name') : el).focus({preventScroll:true}); $('settings').scrollTop = section === 'ai' ? 0 : el.offsetTop - 64; }
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
    state.reviewDirty = false; $('review-state').textContent = '평가를 저장했습니다. 요금은 들지 않습니다.'; await history(); return review;
  }
  $('result-version').onchange = () => { if (todoHolding()) { $('result-version').value = state.opened.resultId || ''; return; } const target = {...state.opened}, resultId = $('result-version').value; task(() => open(target.location,target.id,state.opener,resultId,state.resultTab)); };
  for (const button of document.querySelectorAll('[data-stars]')) button.onclick = () => {
    const stars = Number(button.dataset.stars); state.stars = state.stars === stars ? null : stars; state.reviewDirty = true; renderStars(); lock();
  };
  $('review-comment').oninput = () => { state.reviewDirty = true; lock(); };
  $('save-review').onclick = () => { const target = {...state.opened}; task(() => saveReview(target)); };
  $('refine').onclick = () => {
    if (todoHolding()) return;
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
    if ($('result').hidden || state.busy || todoHolding()) return; const target = state.opened; state.reviewDirty = false; $('result').hidden = true; document.body.style.overflow = ''; $('main').inert = false; document.querySelector('.topbar').inert = false; document.querySelector('.dock').inert = false; state.opened = null;
    const opener = document.contains(state.opener) ? state.opener : [...$('history').querySelectorAll('button')].find(button => button.dataset.location === target?.location && button.dataset.id === target?.id);
    state.opener = null; if (opener) { opener.focus({ preventScroll: true }); opener.scrollIntoView({ block: 'nearest' }); } lock();
    // 초점을 줄 때 브라우저가 스스로 스크롤하면 목록 끝의 줄이 아래쪽 탭에 가릴 수 있다. 스크롤 여백을 지키는 가까운 위치로만 옮긴다.
  }

  async function poll(force = false) {
    if (state.polling || (state.busy && !force)) return;
    state.polling = true;
    try {
      const status = await call('status'), meeting = status.meeting;
      if (state.busy && !force) return;
      const mine = !!state.importing && meeting.attemptId === state.importing, watching = !!state.lastState || mine;
      // 녹음 파일 불러오기는 이번 시도 번호가 실린 상태만 이번 불러오기의 것으로 본다. 그 상태가 끝 상태면 앞선 진행 상태를 못 봤어도 녹음 뒤 분석이 끝났을 때와 같이 안내하고 결과를 연다.
      state.active = status.active; state.recording = status.active && meeting.state === 'recording';
      // 받는 동안 녹음·분석이 시작되면 '지금 업데이트'의 자동 설치 예약을 취소한다. 받은 뒤에는 사람이 다시 눌러야 설치한다.
      if (state.active || state.refining) state.updateIntent = false;
      document.body.classList.toggle('recording', state.recording);
      // 녹음 중에는 준비 칸이 접히므로 회의 전에 적은 참석자와 내용을 읽기로 보여 준다.
      const recordingInfo = state.recording ? [meeting.participants && `참석자 ${meeting.participants}`, meeting.notes].filter(Boolean).join('\n') : '';
      $('recording-info').textContent = recordingInfo; $('recording-info').hidden = !recordingInfo;
      if (state.active) {
        state.lastMeetingState = '';
        $('record-state').textContent = state.recording ? '녹음 중' : '분석 중';
        $('workflow').textContent = meeting.message || '처리 중';
        const seconds = Math.max(0, Math.floor((Date.now() - meeting.createdAt) / 1000));
        if (state.recording) $('timer').textContent = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
        if (!$('prep').hidden) setPrep(false);
      } else if (watching) {
        state.lastMeetingState = meeting.state || '';
        $('record-state').textContent = meeting.state === 'complete' ? '보관 완료' : '확인 필요';
        $('workflow').textContent = meeting.message || '다음 회의를 준비하세요.'; $('timer').textContent = '00:00';
      }
      if (state.importing) {
        if (mine && meeting.id) { state.importing = null; clearNewMeeting(); }
        else if (mine && !status.active) { state.importing = null; $('workflow').textContent = meeting.message || '녹음 파일을 불러오지 못했습니다. 다시 골라 주세요.'; }
        else if (!mine) { $('record-state').textContent = '분석 중'; $('workflow').textContent = '녹음 파일을 준비하는 중'; }
      }
      // 이번 상태에 회의 id가 생기면 회의가 만들어진 것이라 칸을 비우고, id 없이 끝나면 실패라 칸 값을 지우지 않는다. 앞선 회의의 상태나 서비스가 아직 시작되지 않은 상태는 준비 중과 같게 보여 준다.
      const target = state.refining;
      const finishedRefine = !status.active && target && meeting.attemptId === target.attemptId && target.id === meeting.id && target.location === meeting.location && ['complete','failed'].includes(meeting.state);
      const key = `${meeting.id || ''}-${meeting.state || ''}-${meeting.attemptId || ''}`;
      if (key !== state.lastHistory || finishedRefine) {
        state.lastHistory = key; await history();
        if (finishedRefine || (!target && !state.active && watching && meeting.id && meeting.location)) {
          const failedRefine = finishedRefine && meeting.state === 'failed';
          const opener = [...$('history').querySelectorAll('button')].find(button => button.dataset.location === meeting.location && button.dataset.id === meeting.id);
          await open(meeting.location, meeting.id, opener, failedRefine ? target.resultId : meeting.resultId, 'minutes');
          if (failedRefine) $('review-state').textContent = '다시 정리하지 못했습니다. 평가는 저장되어 있고 앞선 결과는 그대로입니다.';
          if (finishedRefine) state.refining = null;
        }
        // 녹음 뒤 자동 분석이 체험 소진으로 멈췄으면 같은 안내와 함께 AI 설정을 연다.
        if (!state.active && watching && meeting.state === 'failed' && meeting.message === Flow.EXHAUSTED_MESSAGE && !$('settings').open) { message(meeting.message); openSettings(); }
      }
      // 체험 남은 횟수가 분석 뒤 바뀌므로 상태 조회 때 연결 정보도 함께 갱신한다.
      if (status.connection) { state.connection = status.connection; renderAccess(); }
      // 업데이트 확인·받기 진행도 같은 상태 조회로 받는다.
      if (status.update) applyUpdate(status.update);
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
  $('custom-name').oninput = () => { state.customDirty = true; renderFormatExample(); }; $('custom-instruction').oninput = () => { state.customDirty = true; renderFormatExample(); };
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
    clearNewMeeting(); setPrep(false); await poll(true);
  });
  function clearNewMeeting() {
    clearTimeout(draftTimer); draftTimer = 0;
    for (const id of ['title', 'participants', 'notes']) $(id).value = '';
    state.formatChosen = false; $('output-format').value = newMeetingFormat();
  }
  // 회의가 만들어진 뒤 새 회의 칸을 비운다. 회의 시작은 요청이 끝나면 곧바로, 녹음 파일 불러오기는 서비스가 회의를 만든 것을 상태 조회로 본 뒤에 부른다.
  $('import-audio').onclick = () => task(async () => {
    await flushDraft();
    const attemptId = crypto.randomUUID();
    const started = await call('importAudio', { date: $('date').value, title: $('title').value.trim(), participants: $('participants').value, notes: $('notes').value, ...formatFields(), attemptId });
    if (!started || started.cancelled) return;
    state.importing = attemptId; setPrep(false); await poll(true);
  });
  // 파일 선택 창이 열린 동안에는 task가 화면을 잠그고, 시작된 뒤에는 시도 번호로 이번 불러오기를 따라간다. 칸 값은 회의가 실제로 만들어진 뒤에 비우므로 그 전에 실패하면 적은 값이 그대로 남는다.
  $('finish').onclick = () => task(async () => { await call('finish'); $('workflow').textContent = '녹음을 저장하고 분석합니다.'; });
  $('retry').onclick = () => { if (!todoHolding()) task(async () => {
    if (!Flow.canAnalyze(state.connection)) { openSettings(null, 'ai'); throw new Error(state.connection.accessMode === 'exhausted' ? Flow.EXHAUSTED_MESSAGE : '설정의 AI 연결에서 API 키를 먼저 등록하세요.'); }
    await call('analyze', { ...state.opened }); await poll(true); }); };
  $('refresh').onclick = () => task(history);
  $('tab-new').onclick = () => showView('new');
  $('tab-records').onclick = () => showView('records');
  $('history-search').oninput = filterHistory;
  $('close-result').onclick = closeResult;
  $('share-all').onclick = () => task(() => call('share', { ...state.opened, kind: 'all' }));
  // 결과 화면: 내 할 일·정리본·전사문 탭으로 나누고, 정리본·전사문 탭에서는 보고 있는 내용을 바로 복사하거나 다른 앱으로 공유한다.
  const RESULT_TABS = ['mine', 'minutes', 'transcript'];
  function availableTab(wanted) {
    // 내 할 일 탭은 정리본이 있는 결과에만 있다. 정리본이 없으면 다시 분석 안내가 있는 정리본 탭을 연다.
    return wanted === 'mine' && !state.result?.minutes ? 'minutes' : wanted;
  }
  function showTab(tab) {
    state.resultTab = tab; const minutes = tab === 'minutes', mine = tab === 'mine', r = state.result || {};
    $('tab-mine').hidden = !r.minutes;
    for (const name of RESULT_TABS) { const chosen = name === tab; $(`tab-${name}`).setAttribute('aria-selected', String(chosen)); $(`tab-${name}`).tabIndex = chosen ? 0 : -1; $(`panel-${name}`).hidden = !chosen; }
    document.querySelector('.result-actions').hidden = mine; $('result-more').hidden = mine;
    // 내 할 일 탭에서는 정리본·전사문을 다루는 복사·공유 단추와 사용량·내보내기·다시 분석 묶음을 감춘다.
    if (state.mePicking) { state.mePicking = false; renderMine(); }
    // 탭을 옮기면 펼쳐 둔 나 고르기 상자를 접는다.
    const name = minutes ? r.label || '정리본' : '전사문', ready = minutes ? r.minutes : r.transcript;
    $('copy-result').lastChild.textContent = `${name} 복사`; $('share-result').lastChild.textContent = `${name} 공유`;
    $('copy-result').disabled = !ready || state.busy || state.active; $('share-result').disabled = $('copy-result').disabled;
    $('save-text').hidden = !minutes; $('save-text').disabled = $('copy-result').disabled;
    // 텍스트 파일로 저장은 정리본 탭에만 있고 복사·공유와 같은 조건으로 잠긴다.
  }
  for (const name of RESULT_TABS) {
    $(`tab-${name}`).onclick = () => showTab(name);
    $(`tab-${name}`).addEventListener('keydown', event => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      const order = RESULT_TABS.filter(item => !$(`tab-${item}`).hidden), step = event.key === 'ArrowRight' ? 1 : -1;
      const next = order[(order.indexOf(state.resultTab) + step + order.length) % order.length]; showTab(next); $(`tab-${next}`).focus();
      // 보이는 탭 사이만 돈다. 정리본이 없는 회의는 내 할 일 탭이 감춰져 있다.
    });
  }
  const resultKind = () => state.resultTab === 'transcript' ? 'transcript' : 'summary';
  $('copy-result').onclick = () => task(async () => { await call('copy', { ...state.opened, kind: resultKind() }); message(`‘${resultKind() === 'transcript' ? '전사문' : state.result?.label || '정리본'}’ 내용을 복사했습니다. 메신저나 메일에 붙여 넣으세요.`); });
  $('share-result').onclick = () => task(() => call('share', { ...state.opened, kind: resultKind() }));
  $('save-text').onclick = () => task(async () => {
    const result = await call('saveText', { ...state.opened });
    // 글과 파일 이름은 네이티브가 저장된 결과와 할 일 수정본으로 만든다. 화면은 어느 회의의 어느 결과인지만 알린다.
    if (!result?.cancelled) message(result?.file ? `‘${result.file}’ 파일로 저장했습니다.` : '텍스트 파일로 저장했습니다.');
  });

  function openSettings(event, section = 'ai') {
    state.removeArmed = false; $('remove-key').textContent = '키 삭제'; renderConnection(); renderSettings(); lock();
    if (!$('settings').open) { $('my-name').value = state.settings?.myName || ''; $('my-name-status').textContent = ''; }
    // 내 이름 칸은 창을 새로 열 때만 채운다. 다른 설정을 저장하며 다시 그릴 때 적고 있던 글자를 지우지 않는다.
    openDialog('settings', event?.currentTarget); focusSettings(section);
  }
  async function saveMyName() {
    // 설정의 내 이름을 저장한다. 저장되면 지난 회의 목록의 내 일 수와 열려 있는 내 할 일 탭을 다시 계산한다.
    try { await call('saveSettings', { myName: $('my-name').value.trim() }); }
    catch (error) { $('my-name-status').textContent = `내 이름을 저장하지 못했습니다. ${error.message}`; return; }
    // 실패하면 적어 둔 글자를 그대로 둬 다시 누를 수 있게 한다.
    $('my-name').value = state.settings?.myName || ''; $('my-name-status').textContent = state.settings?.myName ? '내 이름을 저장했습니다.' : '내 이름을 지웠습니다.';
    renderMine(); await history().catch(() => {});
  }
  function saveMyNameKeepingFocus() {
    // 저장하는 동안 칸과 단추가 잠기며 초점이 빠지므로, 저장이 끝나면 누른 곳으로 초점을 돌려준다.
    const back = document.activeElement;
    return task(saveMyName).then(() => { const now = document.activeElement; if ((!now || now === document.body) && back && document.contains(back) && !back.disabled) back.focus(); });
  }
  $('my-name-save').onclick = saveMyNameKeepingFocus;
  $('my-name').addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); saveMyNameKeepingFocus(); } });
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
    if (state.view === 'records') { showView('new'); return true; }
    return false;
  };

  // 앱 업데이트와 프로그램 정보. 네이티브가 확인·받기·설치 세션을 맡고, 화면은 상태를 보여 주며 사라질 입력이 있으면 설치만 막는다.
  const Notes = window.VoiceNoteReleaseNotes || { NOTES: [], find: () => null, dateLabel: () => '' };
  // 같은 글을 다시 넣지 않아야 상태 알림(role=status)이 같은 문장을 반복해 읽지 않는다. lock()이 먼저 부를 수 있어 함수 선언으로 둔다.
  function setText(el, text) { if (el.textContent !== text) el.textContent = text; }
  function updateReasons() {
    const reasons = [];
    if (state.active || state.refining) reasons.push('녹음이나 분석이 끝난 뒤 설치하세요.');
    else if (state.busy) reasons.push('진행 중인 작업이 끝난 뒤 설치하세요.');
    // 별점과 의견을 모두 비운 것은 저장할 수 없는 상태(저장 단추가 잠김)라 지켜야 할 입력으로 보지 않는다.
    if (state.reviewDirty && (state.stars || $('review-comment').value.trim())) reasons.push('평가 의견을 저장하거나 지운 뒤 설치하세요.');
    if (state.todoPending) reasons.push('할 일을 저장하는 중입니다. 저장이 끝난 뒤 설치하세요.');
    if (state.todoEditing) reasons.push('고치던 할 일을 저장하거나 취소한 뒤 설치하세요.');
    if (state.customDirty) reasons.push('내 형식 변경을 저장한 뒤 설치하세요.');
    if (state.importToken) reasons.push('설정 불러오기 확인을 먼저 마치세요.');
    if ($('api-key').value.trim()) reasons.push('입력한 API 키를 등록하거나 지운 뒤 설치하세요.');
    // 회의 준비 저장 실패는 여기서 막지 않는다. 설치를 누르면 settleDraft가 다시 저장해 보고, 그래도 실패하면 설치하지 않는다.
    return reasons;
  }
  function applyUpdate(update) {
    if (!update || typeof update.status !== 'string') return;
    const before = state.update?.status;
    state.update = update;
    if (update.status === 'available' && update.error) state.updateIntent = false;
    renderUpdate();
    // 한 번 누른 '지금 업데이트'는 받기가 끝나면 설치 화면까지 이어 간다. 그 사이 회의를 시작했으면 이유를 보이고 멈춘다.
    if (update.status === 'ready' && before !== 'ready' && state.updateIntent) runUpdate('install');
  }
  function renderUpdate() {
    const v = Flow.updateView(state.update, updateReasons());
    $('update-note').hidden = !v.note;
    if (v.note) { setText($('update-note-label'), v.note); $('update-note').setAttribute('aria-label', `${v.note}, 프로그램 정보 열기`); }
    setText($('update-state'), v.text);
    $('about-update').dataset.status = v.status;
    $('update-progress-row').hidden = !v.progress;
    if (v.progress) { $('update-progress').value = v.progress.percent; setText($('update-progress-text'), v.progress.text); }
    const detail = state.updateError ? { text: state.updateError, tone: 'error' } : v.detail;
    $('update-detail').hidden = !detail;
    if (detail) { setText($('update-detail'), detail.text); $('update-detail').dataset.tone = detail.tone; }
    $('update-lock').hidden = !v.lock;
    if (v.lock) setText($('update-lock'), v.lock);
    const action = $('update-action');
    action.hidden = !v.action;
    if (v.action) { setText(action, v.action.label); action.dataset.kind = v.action.kind; action.disabled = v.action.disabled || state.updateRunning; }
    $('update-check').hidden = v.check.hidden;
    $('update-check').disabled = v.check.disabled || state.updateRunning;
    $('update-fine').hidden = !v.fine;
  }
  // 설치로 넘기기 직전의 마지막 확인이다. 막는 이유도, 기다리는 회의 준비 저장도 없어야 한다. 넘기지 못하면 그 이유를 알린다.
  function readyToLeave() {
    const reason = updateReasons()[0] || (draftTimer || state.draftSaving ? '회의 준비 내용을 저장하는 중입니다. 잠시 뒤 다시 눌러 주세요.' : '');
    if (reason) throw new Error(reason);
  }
  async function runUpdate(kind) {
    if (state.updateRunning || !kind) return;
    state.updateRunning = true; state.updateError = ''; renderUpdate();
    try {
      if (kind === 'download') {
        state.updateIntent = updateReasons().length === 0;
        applyUpdate(await call('updateDownload'));
      } else if (kind === 'install') {
        state.updateIntent = false;
        if (updateReasons().length) return;
        await settleDraft();
        // 저장을 기다리는 사이 새로 생긴 입력·작업이 있으면 설치로 넘기지 않는다.
        readyToLeave();
        applyUpdate(await call('updateInstall'));
      } else if (kind === 'permission') await call('updatePermission');
      else if (kind === 'confirm') {
        // 설치 화면을 다시 열면 곧 앱이 닫히므로 같은 확인을 한다.
        if (updateReasons().length) return;
        await settleDraft();
        readyToLeave();
        applyUpdate(await call('updateConfirm'));
      }
    } catch (error) {
      state.updateIntent = false; state.updateError = error.message; message(error.message);
    } finally { state.updateRunning = false; renderUpdate(); }
  }
  function renderAbout() {
    const version = state.update?.currentVersion || '', note = Notes.find(version), date = note ? Notes.dateLabel(note.date) : '';
    setText($('about-version'), version);
    setText($('about-version-meta'), version ? `지금 쓰는 버전${date ? ` · ${date} 배포` : ''}` : '버전 정보를 불러오는 중입니다.');
    $('release-list').replaceChildren(...Notes.NOTES.map(entry => {
      const item = node('li', null, 'release'), head = node('div', null, 'release-head'), list = node('ul', null, 'release-items');
      item.dataset.current = String(entry.version === version);
      head.append(node('span', entry.version, 'release-version'));
      const when = Notes.dateLabel(entry.date);
      if (when) head.append(node('span', when, 'release-date'));
      if (entry.version === version) head.append(node('span', '지금 버전', 'release-badge'));
      list.append(...entry.items.map(text => node('li', text)));
      item.append(head, node('p', entry.title, 'release-title'), list);
      return item;
    }));
  }
  function openAbout(opener) { renderAbout(); renderUpdate(); openDialog('about', opener); }
  $('update-note').onclick = event => openAbout(event.currentTarget);
  $('open-about').onclick = event => openAbout(event.currentTarget);
  $('update-action').onclick = () => runUpdate($('update-action').dataset.kind);
  $('update-check').onclick = async () => { state.updateError = ''; try { applyUpdate(await call('updateCheck')); } catch (error) { state.updateError = error.message; renderUpdate(); } };
  $('update-page').onclick = () => call('updatePage').catch(error => message(error.message));

  $('date').value = today(); lock();
  task(async () => {
    const init = await call('init'); state.settings = init.settings || {}; state.connection = init.connection; state.active = !!init.connection.active;
    state.customFormat = init.customFormat || null; updateCustomOption();
    loadEditor(); renderSettings(); renderConnection(); applyUpdate(init.update); await applyDraft(); await history(); await poll(true); setInterval(poll, 1500);
    // 새 버전 확인은 첫 화면을 기다리게 하지 않도록 마지막에 따로 시작한다. 이 요청을 모르는 이전 브리지에서는 조용히 넘어간다.
    call('update').then(applyUpdate).catch(() => {});
  });
})();
