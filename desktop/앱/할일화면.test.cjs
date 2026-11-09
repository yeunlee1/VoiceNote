// 결과 화면의 할 일 저장 순서, 편집 중 보호, 회의록 닫기, 남은 일 패널과 목록 강조를 검증한다.
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const crypto = require('node:crypto');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const action = (task, owner = null, due = null) => ({ task, owner, due });
const minutes = (...actions) => ({ overview: '요약', topics: [], decisions: [], actions, openQuestions: [] });
const refined = minutes(action('일정 공유'));
const SAVE = '^/api/meetings/main/[0-9a-f-]{36}/todos$';
const ok = () => Response.json({ todos: {} });
const failed = () => Response.json({ error: { code: 'X', message: '디스크 오류' } }, { status: 500 });
const settle = async () => { for (let i = 0; i < 30; i++) await new Promise((resolve) => setTimeout(resolve, 0)); };

function fixture({ routes = {}, confirm = () => true } = {}) {
  let focused = null;
  const documentListeners = {};
  const element = (tag = 'div') => {
    const listeners = {};
    const node = { tag, value: '', checked: false, style: {}, hidden: false, disabled: false, open: false, textContent: '', dataset: {}, children: [], attributes: {}, isConnected: true,
      classList: { add() {}, remove() {} }, removeAttribute(name) { delete this.attributes[name]; }, setAttribute(name, value) { this.attributes[name] = value; },
      addEventListener(type, fn) { (listeners[type] ||= []).push(fn); }, dispatch(type, event = {}) { for (const fn of listeners[type] || []) fn({ target: node, preventDefault() {}, ...event }); },
      querySelectorAll(selector) { return selector === 'button' ? this.children.filter((child) => child.tag === 'button') : []; }, querySelector() { return null; },
      append(...items) { this.children.push(...items); }, replaceChildren(...items) { this.children = items; },
      remove() {}, focus() { focused = node; }, scrollIntoView() {}, click() { this.dispatch('click'); }, show() { this.open = true; }, showModal() { this.open = true; },
      // 실제 대화상자처럼 close 이벤트는 나중에 온다.
      close() { this.open = false; setTimeout(() => this.dispatch('close'), 0); } };
    return node;
  };
  const nodes = new Map(), calls = [], mediaListeners = [];
  const json = (body, status = 200) => Response.json(body, { status });
  const body = element('body');
  const sandbox = { crypto, Blob, AbortController, DOMException, TextDecoder, setTimeout, clearTimeout, setInterval, clearInterval, confirm,
    window: { addEventListener() {}, matchMedia: () => ({ addEventListener(type, fn) { mediaListeners.push(fn); } }), MeetingFormats: require('./출력형식.js'), MeetingTodos: require('./할일정리.js') },
    URL: { createObjectURL: () => 'blob:test', revokeObjectURL() {} },
    document: { body, addEventListener(type, fn) { (documentListeners[type] ||= []).push(fn); }, getElementById(id) { if (!nodes.has(id)) nodes.set(id, element()); return nodes.get(id); }, createElement: element },
    async fetch(url, options = {}) {
      calls.push({ url, options, body: typeof options.body === 'string' ? JSON.parse(options.body) : options.body });
      const route = routes[url] || Object.entries(routes).find(([key]) => key.startsWith('^') && new RegExp(key).test(url))?.[1];
      if (route) return route(calls.at(-1));
      if (url === '/api/summary') return json({ minutes: refined });
      if (url.startsWith('/api/trial/')) return json({ accessMode: 'trial', trialLimit: 3, trialRemaining: 2, mustRegister: false });
      if (url === '/api/meetings') return json({ meetings: [], skipped: 0 });
      return json({});
    } };
  const original = fs.readFileSync(path.join(__dirname, '화면/app.js'), 'utf8');
  const source = original.replace(/  init\(\);\s*\}\)\(\);\s*$/,
    '  globalThis.review = { state, ui, bind, refresh, resetMeetingForm, openMeeting, loadHistory, loadOpenTodos, updateTodo, finishOpenTodo, exportDocument, refineSummary, hasUnsavedWork, updateBlockers, prepareMeeting, cancelTodoEdit };\n})();');
  assert.notEqual(source, original);
  vm.runInNewContext(source, sandbox);
  const review = sandbox.review;
  review.bind();
  review.resetMeetingForm();
  return { ...review, calls, body, focused: () => focused, mediaChange: (matches) => { for (const fn of mediaListeners) fn({ matches }); }, pressKey: (event) => { for (const fn of documentListeners.keydown || []) fn({ preventDefault() {}, ...event }); } };
}

const meeting = (extra = {}) => ({ id: crypto.randomUUID(), location: 'main', title: '출시 회의', date: '2026-11-09', dailySequence: 1, participants: '김민수, 박서연, 이도현', transcript: '전사',
  minutes: minutes(action('일정 공유'), action('발주 변경')), outputFormat: 'meeting', audio: [], savedAt: '2026-11-09T01:00:00.000Z', ...extra });
const opening = (record, todos = null) => ({ [`/api/meetings/main/${record.id}`]: () => Response.json({ meeting: record, versions: [{ id: record.id, savedAt: record.savedAt, outputFormat: 'meeting', refined: false }], review: null, todos }) });
const openWith = async (record, routes = {}, todos = null) => {
  const review = fixture({ routes: { ...opening(record, todos), ...routes } });
  await review.openMeeting('main', record.id, undefined);
  return review;
};

test('앞 저장만 실패하고 뒤 저장이 성공하면 화면과 복사는 마지막으로 누른 값을 쓴다', async () => {
  const record = meeting(), outcomes = [failed(), ok()];
  const review = await openWith(record, { [SAVE]: () => outcomes.shift() });
  review.updateTodo(0, { owner: '김민수' });
  await review.updateTodo(0, { owner: '박서연' });
  await settle();
  assert.equal(review.state.todos.items[0].owner, '박서연');
  assert.equal(review.exportDocument().minutes.actions.find((item) => item.task === '일정 공유').owner, '박서연');
  assert.equal(review.hasUnsavedWork(), false);
});

test('할 일을 저장하는 동안에는 회의를 다시 읽지 않아 저장 전 값이 화면에 올라오지 않는다', async () => {
  const first = meeting(), second = meeting({ title: '다른 회의' });
  let release;
  const held = new Promise((resolve) => { release = resolve; });
  const review = await openWith(first, { ...opening(second), [SAVE]: async () => { await held; return ok(); } });
  const loads = (record) => review.calls.filter((call) => call.url === `/api/meetings/main/${record.id}`).length;
  const saving = review.updateTodo(0, { owner: '김민수' });
  await settle();
  await review.openMeeting('main', second.id);
  await review.openMeeting('main', first.id);
  assert.equal(loads(second), 0);
  assert.equal(loads(first), 1);
  assert.equal(review.state.resultId, first.id);
  assert.equal(review.state.todos.items[0].owner, '김민수');
  assert.match(review.ui.status.textContent, /저장하는 중/);
  release();
  await saving;
  await settle();
  await review.openMeeting('main', second.id);
  assert.equal(loads(second), 1);
  assert.equal(review.state.resultId, second.id);
});

test('뒤 저장만 실패하면 마지막으로 저장에 성공한 값으로 되돌린다', async () => {
  const record = meeting(), outcomes = [ok(), failed()];
  const review = await openWith(record, { [SAVE]: () => outcomes.shift() });
  review.updateTodo(0, { owner: '김민수' });
  await review.updateTodo(0, { owner: '박서연' });
  await settle();
  assert.equal(review.state.todos.items[0].owner, '김민수');
  assert.match(review.ui['result-status'].textContent, /디스크 오류/);
});

test('연속 저장이 모두 실패하면 처음 상태로 되돌린다', async () => {
  const record = meeting(), outcomes = [failed(), failed()];
  const review = await openWith(record, { [SAVE]: () => outcomes.shift() });
  review.updateTodo(0, { owner: '김민수' });
  await review.updateTodo(0, { owner: '박서연' });
  await settle();
  assert.equal(review.state.todos, null);
});

test('남은 일 목록의 체크도 저장이 끝날 때까지 닫기와 업데이트 설치를 막는다', async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const review = fixture({ routes: { '^/api/meetings/main/[0-9a-f-]{36}/todos/0$': () => gate } });
  const check = { checked: true };
  const done = review.finishOpenTodo({ location: 'main', id: crypto.randomUUID(), index: 0 }, check);
  await settle();
  assert.equal(review.hasUnsavedWork(), true);
  assert.match(review.updateBlockers()[0], /저장하는 중/);
  release(Response.json({ todos: { finalized: false, items: [] } }));
  await done;
  await settle();
  assert.equal(review.hasUnsavedWork(), false);
  assert.equal(check.checked, true);
});

test('남은 일 목록의 체크가 실패하면 체크를 되돌린다', async () => {
  const review = fixture({ routes: { '^/api/meetings/main/[0-9a-f-]{36}/todos/0$': () => failed() } });
  const check = { checked: true };
  await review.finishOpenTodo({ location: 'main', id: crypto.randomUUID(), index: 0 }, check);
  assert.equal(check.checked, false);
  assert.match(review.ui['open-status'].textContent, /디스크 오류/);
});

test('지금 열린 회의의 일을 남은 일 목록에서 체크하면 회의록 저장과 같은 줄로 보낸다', async () => {
  const record = meeting();
  const review = await openWith(record, { [SAVE]: () => ok() });
  await review.finishOpenTodo({ location: 'main', id: record.id, index: 1 }, { checked: true });
  await settle();
  assert.equal(review.calls.some((call) => /\/todos\/1$/.test(call.url)), false, '한 줄만 고치는 요청을 따로 보내지 않는다');
  assert.equal(review.calls.filter((call) => /\/todos$/.test(call.url)).at(-1).body.items[1].done, true);
  assert.equal(review.state.todos.items[1].done, true);
});

test('현재 화면 비우기는 열린 회의록을 닫고 새 회의 입력으로 돌아간다', async () => {
  const review = await openWith(meeting());
  assert.equal(review.ui['meeting-detail'].open, true);
  review.ui.clear.click();
  await settle();
  assert.equal(review.ui['meeting-detail'].open, false);
  assert.equal(review.state.minutes, null);
  assert.equal(review.ui['meeting-setup'].hidden, false);
  assert.equal(review.ui['desk-work'].inert, false);
});

test('고치던 할 일이 있으면 의견 반영과 다시 분석, 회의록 닫기를 막는다', async () => {
  const review = await openWith(meeting());
  const dialog = review.ui['meeting-detail'], summaries = () => review.calls.filter((call) => call.url === '/api/summary').length;
  review.state.keyConfigured = true;
  review.state.todoEditing = { index: 0, task: '고치는 중', due: '' };
  review.ui['review-comment'].value = '담당자가 틀렸어요.';
  await review.refineSummary();
  assert.equal(summaries(), 0);
  assert.match(review.ui['review-status'].textContent, /저장하거나 취소/);
  review.ui.summarize.click();
  await settle();
  assert.equal(summaries(), 0);
  dialog.dispatch('click', { target: { closest: () => true } });
  assert.equal(dialog.open, true);
  dialog.dispatch('keydown', { key: 'Escape', defaultPrevented: false });
  assert.equal(dialog.open, true);
  assert.deepEqual({ ...review.state.todoEditing }, { index: 0, task: '고치는 중', due: '' });
});

test('고치기를 취소하면 막는 안내를 지우고 다른 안내는 남긴다', async () => {
  const review = await openWith(meeting());
  review.state.todoEditing = { index: 0, task: '고치는 중', due: '' };
  review.ui['meeting-detail'].dispatch('keydown', { key: 'Escape', defaultPrevented: false });
  assert.match(review.ui['result-status'].textContent, /저장하거나 취소/);
  review.cancelTodoEdit();
  assert.equal(review.ui['result-status'].textContent, '');
  review.ui['result-status'].textContent = '다른 안내';
  review.cancelTodoEdit();
  assert.equal(review.ui['result-status'].textContent, '다른 안내');
});

test('Esc를 누르면 회의록을 닫고 다른 곳에서 처리한 Esc는 무시한다', async () => {
  const review = await openWith(meeting());
  const dialog = review.ui['meeting-detail'];
  dialog.dispatch('keydown', { key: 'Escape', defaultPrevented: true });
  assert.equal(dialog.open, true);
  dialog.dispatch('keydown', { key: 'Escape', defaultPrevented: false });
  assert.equal(dialog.open, false);
});

test('결과를 보다가 새 회의를 누르면 목록이 아니라 회의명 칸으로 초점이 간다', async () => {
  const record = meeting();
  const review = fixture({ routes: opening(record) });
  let openerFocused = false;
  const opener = { isConnected: true, disabled: false, hidden: false, focus() { openerFocused = true; } };
  await review.openMeeting('main', record.id, opener);
  review.prepareMeeting();
  await settle();
  assert.equal(review.ui['meeting-detail'].open, false);
  assert.equal(openerFocused, false);
  assert.equal(review.focused(), review.ui.title);
});

test('창을 키워 패널을 접지 않게 되면 열린 표시를 지워 Esc가 회의록을 닫는다', async () => {
  const review = await openWith(meeting());
  review.ui['open-toggle'].click();
  assert.equal(review.body.dataset.panel, 'open');
  review.mediaChange(false);
  assert.equal(review.body.dataset.panel, '');
  assert.equal(review.ui['open-toggle'].attributes['aria-expanded'], 'false');
  review.ui['meeting-detail'].dispatch('keydown', { key: 'Escape', defaultPrevented: false });
  assert.equal(review.ui['meeting-detail'].open, false);
});

test('좁은 창의 남은 일 패널에서 회의를 열면 닫을 때 패널 단추로 초점이 돌아간다', async () => {
  const record = meeting();
  const item = { location: 'main', id: record.id, title: record.title, index: 0, task: '일정 공유', owner: null, due: null };
  const review = fixture({ routes: { ...opening(record), '/api/meetings/open-todos': () => Response.json({ items: [item], skipped: 0 }) } });
  await review.loadOpenTodos();
  review.ui['open-toggle'].click();
  const [row] = review.ui['open-todos'].children;
  row.children.at(-1).click();
  await settle();
  assert.equal(review.body.dataset.panel, '');
  assert.equal(review.ui['meeting-detail'].open, true);
  review.ui['meeting-detail'].dispatch('keydown', { key: 'Escape', defaultPrevented: false });
  await settle();
  assert.equal(review.focused(), review.ui['open-toggle']);
});

test('열린 회의는 왼쪽 목록에서 강조하고 닫으면 강조를 지운다', async () => {
  const record = meeting();
  const review = await openWith(record, { '/api/meetings': () => Response.json({ meetings: [{ location: 'main', id: record.id, title: record.title, date: record.date, dailySequence: 1, outputFormat: 'meeting', analyzed: true, audioCount: 0 }], skipped: 0 }) });
  await review.loadHistory();
  const [button] = review.ui['meeting-history'].children;
  assert.equal(button.attributes['aria-current'], 'true');
  review.ui['meeting-detail'].dispatch('keydown', { key: 'Escape', defaultPrevented: false });
  await settle();
  assert.equal(button.attributes['aria-current'], undefined);
});

test('저장 중이라 회의를 열지 못하면 좁은 창 패널과 초점을 그대로 둔다', async () => {
  const first = meeting(), second = meeting({ title: '다른 회의' });
  const item = { location: 'main', id: second.id, title: second.title, index: 0, task: '일정 공유', owner: null, due: null };
  let release;
  const held = new Promise((resolve) => { release = resolve; });
  const review = await openWith(first, { ...opening(second), [SAVE]: async () => { await held; return ok(); }, '/api/meetings/open-todos': () => Response.json({ items: [item], skipped: 0 }) });
  await review.loadOpenTodos();
  const saving = review.updateTodo(0, { owner: '김민수' });
  await settle();
  review.ui['open-toggle'].click();
  const button = review.ui['open-todos'].children[0].children.at(-1);
  button.focus();
  button.click();
  await settle();
  assert.equal(review.body.dataset.panel, 'open');
  assert.equal(review.ui['open-toggle'].attributes['aria-expanded'], 'true');
  assert.equal(review.focused(), button);
  assert.equal(review.state.resultId, first.id);
  release();
  await saving;
});

test('확인창을 취소해 회의를 열지 않으면 좁은 창 패널과 초점을 그대로 둔다', async () => {
  const first = meeting(), second = meeting({ title: '다른 회의' });
  const item = { location: 'main', id: second.id, title: second.title, index: 0, task: '일정 공유', owner: null, due: null };
  const review = fixture({ confirm: () => false, routes: { ...opening(first), ...opening(second), '/api/meetings/open-todos': () => Response.json({ items: [item], skipped: 0 }) } });
  await review.openMeeting('main', first.id, undefined);
  await review.loadOpenTodos();
  review.state.todoEditing = { index: 0, task: '고치는 중', due: '' };
  review.ui['open-toggle'].click();
  const button = review.ui['open-todos'].children[0].children.at(-1);
  button.focus();
  button.click();
  await settle();
  assert.equal(review.body.dataset.panel, 'open');
  assert.equal(review.focused(), button);
  assert.equal(review.state.resultId, first.id);
});

test('결과를 연 채 다른 회의를 열면 초점을 결과 안으로 옮기고 닫을 때 새로 누른 곳으로 돌아간다', async () => {
  const first = meeting(), second = meeting({ title: '다른 회의' });
  const review = await openWith(first, opening(second));
  let openerFocused = 0, closeFocused = 0;
  const opener = { isConnected: true, disabled: false, hidden: false, focus() { openerFocused++; } };
  review.ui['meeting-detail'].querySelector = (selector) => (selector === '[data-close]' ? { focus() { closeFocused++; } } : null);
  await review.openMeeting('main', second.id, opener);
  await settle();
  assert.equal(review.state.resultId, second.id);
  assert.equal(closeFocused, 1);
  review.ui['meeting-detail'].dispatch('keydown', { key: 'Escape', defaultPrevented: false });
  await settle();
  assert.equal(review.ui['meeting-detail'].open, false);
  assert.equal(openerFocused, 1);
});

test('결과 안에서 버전을 바꾸면 불러오는 동안 잃은 초점을 select로 되돌리고 처음 연 항목으로 돌아간다', async () => {
  const first = meeting(), second = meeting();
  let firstOpenerFocused = 0, closeFocused = 0;
  const firstOpener = { isConnected: true, disabled: false, hidden: false, focus() { firstOpenerFocused++; } };
  const review = fixture({ routes: { ...opening(first), ...opening(second) } });
  await review.openMeeting('main', first.id, firstOpener);
  const dialog = review.ui['meeting-detail'], select = review.ui['result-versions'];
  // 불러오는 동안 select가 잠겨 실제 브라우저처럼 초점은 결과 밖(BODY)으로 빠진다. select 자체는 결과 안에 있다.
  dialog.contains = (node) => node === select;
  dialog.querySelector = (selector) => (selector === '[data-close]' ? { focus() { closeFocused++; } } : null);
  select.value = second.id;
  select.dispatch('change');
  await settle();
  assert.equal(review.state.resultId, second.id);
  assert.equal(closeFocused, 0);
  assert.equal(review.focused(), select);
  dialog.dispatch('keydown', { key: 'Escape', defaultPrevented: false });
  await settle();
  assert.equal(dialog.open, false);
  assert.equal(firstOpenerFocused, 1);
});

test('창이 좁을 때 쓰는 남은 일 단추는 건수를 보여 주고 패널을 열고 닫는다', async () => {
  const review = fixture({ routes: { '/api/meetings/open-todos': () => Response.json({ items: [
    { location: 'main', id: crypto.randomUUID(), title: '회의', index: 0, task: '하나', owner: null, due: null }, { location: 'main', id: crypto.randomUUID(), title: '회의', index: 0, task: '둘', owner: null, due: null }], skipped: 0 }) } });
  await review.loadOpenTodos();
  const toggle = review.ui['open-toggle'];
  assert.match(toggle.textContent, /2건/);
  toggle.click();
  assert.equal(review.body.dataset.panel, 'open');
  assert.equal(toggle.attributes['aria-expanded'], 'true');
  assert.equal(review.focused(), review.ui['open-panel']);
  review.pressKey({ key: 'Escape' });
  assert.equal(review.body.dataset.panel, '');
  assert.equal(toggle.attributes['aria-expanded'], 'false');
  assert.equal(review.focused(), toggle);
});

test('의견 반영 결과를 저장할 때 보던 결과를 함께 보낸다', async () => {
  const record = meeting();
  const review = await openWith(record, { '^/api/meetings/main/[0-9a-f-]{36}/review$': (call) => Response.json({ review: { version: 1, stars: null, comment: call.body.comment, savedAt: 'x' } }),
    '/api/meetings/main': (call) => Response.json({ meeting: { ...call.body, location: 'main', savedAt: 'y', dailySequence: 1 }, copies: { ok: true, written: [], skipped: [], failed: [] }, todos: null }) });
  review.state.keyConfigured = true;
  review.ui['review-comment'].value = '담당자가 틀렸어요.';
  await review.refineSummary();
  const saved = review.calls.find((call) => call.url === '/api/meetings/main' && call.options.method === 'POST');
  assert.equal(saved.body.sourceResultId, record.id);
});
