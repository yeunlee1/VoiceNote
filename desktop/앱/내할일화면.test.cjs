// 결과 화면의 내 할 일 탭, 나 고르기, 탭 전환과 저장 중 보호를 가짜 화면으로 검증한다.
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const crypto = require('node:crypto');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const action = (task, owner = null, due = null) => ({ task, owner, due });
const minutes = (...actions) => ({ overview: '요약', topics: [], decisions: [], actions, openQuestions: [] });
const SAVE = '^/api/meetings/main/[0-9a-f-]{36}/todos$';
const ME = '^/api/meetings/main/[0-9a-f-]{36}/me$';
const ok = () => Response.json({ todos: {} });
const meSaved = (call) => Response.json({ me: call.body.name });
const failed = () => Response.json({ error: { code: 'X', message: '디스크 오류' } }, { status: 500 });
const settle = async () => { for (let i = 0; i < 30; i++) await new Promise((resolve) => setTimeout(resolve, 0)); };
// 가짜 화면에는 CSS 선택자가 없어 자손을 직접 훑어 클래스·종류로 찾는다.
const walk = (node) => (node.children || []).filter((child) => child && typeof child === 'object').flatMap((child) => [child, ...walk(child)]);
const byClass = (node, name) => walk(node).filter((child) => String(child.className || '').split(' ').includes(name));
const checks = (node) => walk(node).filter((child) => child.type === 'checkbox');
const texts = (node) => [node.textContent, ...(node.children || []).flatMap(texts)].filter(Boolean);
const detach = (node) => { node.isConnected = false; for (const child of node.children || []) if (child && typeof child === 'object') detach(child); };

function fixture({ routes = {}, confirm = () => true } = {}) {
  let focused = null;
  const clipboard = { fail: false, texts: [], hold: null };
  const element = (tag = 'div') => {
    const listeners = {};
    const node = { tag, value: '', checked: false, type: '', className: '', scrollTop: 0, style: {}, hidden: false, disabled: false, open: false, textContent: '', dataset: {}, children: [], attributes: {}, isConnected: true,
      classList: { add() {}, remove() {} }, removeAttribute(name) { delete this.attributes[name]; }, setAttribute(name, value) { this.attributes[name] = value; },
      addEventListener(type, fn) { (listeners[type] ||= []).push(fn); }, dispatch(type, event = {}) { for (const fn of listeners[type] || []) fn({ target: node, preventDefault() {}, ...event }); },
      querySelectorAll(selector) { return selector === 'button' ? this.children.filter((child) => child.tag === 'button') : []; },
      contains(other) { return other === node || walk(node).includes(other); },
      querySelector(selector) {
        const key = /^\[data-todo-focus="(.+)"\]$/.exec(selector)?.[1];
        if (key) return walk(node).find((child) => child.dataset.todoFocus === key) ?? null;
        return selector === '[data-close]' ? walk(node).find((child) => 'close' in child.dataset) ?? null : null;
      },
      // 브라우저가 내용을 갈면 스크롤이 올라가는 것을 흉내 낸다.
      append(...items) { this.children.push(...items); }, replaceChildren(...items) { for (const old of this.children) if (old && typeof old === 'object' && !items.includes(old)) detach(old); this.children = items; this.scrollTop = 0; },
      remove() {}, select() {}, focus() { if (!node.disabled) focused = node; }, scrollIntoView() {}, click() { this.dispatch('click'); }, show() { this.open = true; }, showModal() { this.open = true; },
      // 실제 대화상자처럼 close 이벤트는 나중에 온다.
      close() { this.open = false; setTimeout(() => this.dispatch('close'), 0); } };
    return node;
  };
  const nodes = new Map(), calls = [];
  const json = (body, status = 200) => Response.json(body, { status });
  const body = element('body');
  const sandbox = { crypto, Blob, AbortController, DOMException, TextDecoder, setTimeout, clearTimeout, setInterval, clearInterval, confirm,
    navigator: { clipboard: { writeText: async (text) => { if (clipboard.hold) await clipboard.hold; if (clipboard.fail) throw new Error('거절'); clipboard.texts.push(text); } } },
    window: { addEventListener() {}, MeetingFormats: require('./출력형식.js'), MeetingTodos: require('./할일정리.js') },
    URL: { createObjectURL: () => 'blob:test', revokeObjectURL() {} },
    document: { body, get activeElement() { return focused && focused.isConnected && !focused.disabled ? focused : body; }, execCommand: () => false, addEventListener() {}, getElementById(id) { if (!nodes.has(id)) nodes.set(id, element()); return nodes.get(id); }, createElement: element },
    async fetch(url, options = {}) {
      calls.push({ url, options, body: typeof options.body === 'string' ? JSON.parse(options.body) : options.body });
      const route = routes[url] || Object.entries(routes).find(([key]) => key.startsWith('^') && new RegExp(key).test(url))?.[1];
      if (route) return route(calls.at(-1));
      if (url === '/api/meetings') return json({ meetings: [], skipped: 0 });
      return json({});
    } };
  const original = fs.readFileSync(path.join(__dirname, '화면/app.js'), 'utf8');
  const source = original.replace(/  init\(\);\s*\}\)\(\);\s*$/,
    '  globalThis.review = { state, ui, bind, refresh, resetMeetingForm, openMeeting, loadHistory, updateTodo, renderMine, saveMe, showResultTab, hasUnsavedWork, updateBlockers, openSettings, prepareMeeting, openShare, saveMyName };\n})();');
  assert.notEqual(source, original);
  vm.runInNewContext(source, sandbox);
  const review = sandbox.review;
  review.bind();
  review.resetMeetingForm();
  return { ...review, calls, body, clipboard, focused: () => focused };
}

const meeting = (extra = {}) => ({ id: crypto.randomUUID(), location: 'main', title: '출시 회의', date: '2026-11-09', dailySequence: 1, participants: '김민수, 박서연, 이도현', transcript: '전사',
  minutes: minutes(action('일정 공유'), action('발주 변경')), outputFormat: 'meeting', audio: [], savedAt: '2026-11-09T01:00:00.000Z', ...extra });
const opening = (record, { todos = null, me = null, todosUnreadable = false } = {}) => ({ [`/api/meetings/main/${record.id}`]: () => Response.json({ meeting: record, versions: [{ id: record.id, savedAt: record.savedAt, outputFormat: 'meeting', refined: false }], review: null, todos, me, todosUnreadable }) });
const openWith = async (record, routes = {}, options = {}) => {
  const review = fixture({ routes: { ...opening(record, options), ...routes } });
  review.state.settings = { myName: options.myName ?? '' };
  await review.openMeeting('main', record.id, undefined);
  return review;
};

const item = (task, owner = null, due = null, done = false) => ({ task, owner, due, done });

test('지난 회의 목록에서 열면 내 할 일 탭이 열리고 내 일만 안 끝낸 일부터 보인다', async () => {
  const record = meeting({ participants: '박서연, 김민수', minutes: minutes(action('끝낸 일', '박서연'), action('발주 변경', '김민수'), action('일정 공유', '박서연', '11월 12일'), action('미정인 일')) });
  const review = await openWith(record, {}, { myName: '박서연', todos: { finalized: false, items: [item('끝낸 일', '박서연', null, true), item('발주 변경', '김민수'), item('일정 공유', '박서연', '11월 12일'), item('미정인 일')] } });
  const panel = review.ui['panel-mine'];
  assert.equal(review.state.resultTab, 'mine');
  assert.deepEqual([panel.hidden, review.ui['panel-minutes'].hidden, review.ui['tab-mine'].hidden, review.ui['tab-mine'].attributes['aria-selected']], [false, true, false, 'true']);
  assert.deepEqual(byClass(panel, 'mine-task').map((node) => node.textContent), ['일정 공유', '끝낸 일']);
  assert.deepEqual(byClass(panel, 'mine-due').map((node) => node.textContent), ['11월 12일', '']);
  assert.equal(byClass(panel, 'mine-left')[0].textContent, '1건 남음');
  assert.equal(byClass(panel, 'me-name')[0].textContent, '박서연');
  assert.equal(texts(byClass(panel, 'mine-rest')[0]).join('').includes('담당 미정 1건 · 다른 사람 일 1건'), true);
  for (const id of ['copy-result', 'save-result', 'share-result']) assert.equal(review.ui[id].hidden, true, id);
});

test('회의록 보기로 열면 정리본 탭이 열리고 결과 버전을 바꾸면 보던 탭에 머문다', async () => {
  const first = meeting(), second = meeting();
  const review = await openWith(first, opening(second));
  review.ui['meeting-detail'].close();
  await settle();
  review.ui['open-result'].click();
  assert.equal(review.state.resultTab, 'minutes');
  for (const tab of ['transcript', 'mine']) {
    review.showResultTab(tab);
    const next = review.state.resultId === first.id ? second.id : first.id;
    review.ui['result-versions'].value = next;
    review.ui['result-versions'].dispatch('change');
    await settle();
    assert.deepEqual([review.state.resultId, review.state.resultTab], [next, tab]);
  }
});

test('내 할 일 탭에서 체크하면 정리본과 같은 수정본에 저장하고 줄이 내려가도 초점이 따라간다', async () => {
  const record = meeting({ participants: '박서연, 김민수', minutes: minutes(action('가', '박서연'), action('나', '김민수'), action('다', '박서연')) });
  const review = await openWith(record, { [SAVE]: () => ok() }, { myName: '박서연' });
  const [first] = checks(review.ui['panel-mine']);
  first.checked = true;
  first.dispatch('change');
  await settle();
  assert.deepEqual(review.calls.filter((call) => /\/todos$/.test(call.url)).at(-1).body, { finalized: false, items: [item('가', '박서연', null, true), item('나', '김민수'), item('다', '박서연')] });
  assert.deepEqual(byClass(review.ui['panel-mine'], 'mine-task').map((node) => node.textContent), ['다', '가']);
  assert.equal(review.focused().dataset.todoFocus, 'mine:0');
  review.showResultTab('minutes');
  assert.equal(walk(review.ui.minutes).find((node) => node.dataset.todoFocus === '0:check').checked, true, '정리본 탭도 같은 상태다');
});

test('상태마다 다른 말로 보여 준다', async () => {
  const cases = [
    ['맡은 일을 다 끝냄', { participants: '박서연', actions: [action('가', '박서연')], todos: [item('가', '박서연', null, true)], myName: '박서연' }, (panel) => {
      assert.equal(byClass(panel, 'mine-left')[0].textContent, '모두 끝냄');
      assert.equal(byClass(panel, 'mine-row').length, 1);
    }],
    ['맡은 일이 없음', { participants: '박서연, 김민수', actions: [action('가', '김민수'), action('나')], myName: '박서연' }, (panel) => {
      assert.equal(byClass(panel, 'mine-empty')[0].textContent, '이 회의에서 내가 맡은 일은 없습니다.');
      assert.equal(texts(byClass(panel, 'mine-rest')[0]).join('').includes('담당 미정 1건'), true);
      assert.equal(byClass(panel, 'mine-left').length, 0);
    }],
    ['내가 누구인지 모름', { participants: '박서연 대리, 김민수', actions: [action('가', '김민수')], myName: '박서연' }, (panel) => {
      assert.equal(byClass(panel, 'who-lead')[0].textContent, '이 회의에서 나는 누구인가요?');
      assert.deepEqual(byClass(panel, 'who-button').map((node) => texts(node).join('')), ['1박서연 대리', '2김민수']);
      assert.deepEqual([byClass(panel, 'mine-row').length, byClass(panel, 'who-clear').length], [0, 0]);
    }],
    ['참석자도 담당자 이름도 없음', { participants: '', actions: [action('가'), action('나')], myName: '박서연' }, (panel) => {
      assert.equal(byClass(panel, 'mine-empty')[0].textContent, '참석자를 적지 않은 회의라 누가 맡았는지 알 수 없습니다.');
      assert.deepEqual([byClass(panel, 'who-box').length, byClass(panel, 'mine-all').length], [0, 1]);
    }],
    ['참석자는 없고 담당자 이름만 있음', { participants: '', actions: [action('가', '김민수'), action('나', '박서연')], myName: '' }, (panel) => {
      assert.deepEqual(byClass(panel, 'who-button').map((node) => texts(node).join('')), ['김민수', '박서연']);
      assert.equal(byClass(panel, 'who-settings').length, 1, '설정에 내 이름이 없으면 설정으로 가는 길을 둔다');
    }],
    ['정리된 할 일이 없음', { participants: '', actions: [], myName: '박서연' }, (panel) => {
      assert.equal(byClass(panel, 'mine-empty')[0].textContent, '이 회의에는 정리된 할 일이 없습니다.');
      assert.equal(byClass(panel, 'mine-all').length, 0);
    }],
  ];
  for (const [name, { participants, actions, todos, myName }, check] of cases) {
    const review = await openWith(meeting({ participants, minutes: minutes(...actions) }), {}, { myName, todos: todos ? { finalized: false, items: todos } : null });
    assert.equal(review.state.resultTab, 'mine', name);
    check(review.ui['panel-mine']);
  }
});

test('분석하지 않은 녹음에는 내 할 일 탭이 없고 지금처럼 열린다', async () => {
  const blank = await openWith(meeting({ minutes: null, transcript: '' }));
  assert.deepEqual([blank.ui['tab-mine'].hidden, blank.state.resultTab], [true, 'minutes']);
  const heard = await openWith(meeting({ minutes: null, transcript: '전사만 있음' }));
  assert.deepEqual([heard.ui['tab-mine'].hidden, heard.state.resultTab], [true, 'transcript']);
});

test('체크 저장이 실패하면 저장이 확인된 상태로 되돌리고 알린다', async () => {
  const record = meeting({ participants: '박서연', minutes: minutes(action('가', '박서연'), action('나', '박서연')) });
  const review = await openWith(record, { [SAVE]: () => failed() }, { myName: '박서연' });
  const [first] = checks(review.ui['panel-mine']);
  first.checked = true;
  first.dispatch('change');
  await settle();
  assert.equal(byClass(review.ui['panel-mine'], 'mine-left')[0].textContent, '2건 남음');
  assert.match(review.ui['result-status'].textContent, /디스크 오류/);
});

test('저장되지 않은 결과에서는 체크와 나 고르기를 누를 수 없다', async () => {
  const known = await openWith(meeting({ participants: '박서연', minutes: minutes(action('가', '박서연')) }), {}, { myName: '박서연' });
  assert.equal(checks(known.ui['panel-mine']).some((node) => node.disabled), false);
  known.state.resultStored = false;
  known.renderMine();
  assert.deepEqual([checks(known.ui['panel-mine']).length, checks(known.ui['panel-mine']).every((node) => node.disabled)], [1, true]);
  const unknown = await openWith(meeting({ participants: '박서연, 김민수', minutes: minutes(action('가', '박서연')) }));
  unknown.state.resultStored = false;
  unknown.renderMine();
  assert.deepEqual([byClass(unknown.ui['panel-mine'], 'who-button').length, byClass(unknown.ui['panel-mine'], 'who-button').every((node) => node.disabled)], [2, true]);
});

test('나를 고르면 그 결과를 가리켜 저장하고 그 사람의 일을 보여 준다', async () => {
  const record = meeting({ participants: '박서연, 김민수', minutes: minutes(action('가', '박서연'), action('나', '김민수')) });
  const review = await openWith(record, { [ME]: meSaved });
  const lists = () => review.calls.filter((call) => call.url === '/api/meetings').length, before = lists();
  byClass(review.ui['panel-mine'], 'who-button')[1].click();
  await settle();
  const sent = review.calls.find((call) => call.url === `/api/meetings/main/${record.id}/me`);
  assert.deepEqual([sent.options.method, sent.body], ['POST', { name: '김민수' }]);
  assert.equal(byClass(review.ui['panel-mine'], 'me-name')[0].textContent, '김민수');
  assert.deepEqual(byClass(review.ui['panel-mine'], 'mine-task').map((node) => node.textContent), ['나']);
  assert.equal(lists(), before + 1);
  assert.equal(review.ui.status.textContent, '이 회의에서 나는 김민수입니다.');
});

test('바꾸기를 누르면 고른 사람이 눌린 상태로 보이고 다시 누르면 저장하지 않고 닫는다', async () => {
  const record = meeting({ participants: '박서연, 김민수', minutes: minutes(action('가', '김민수')) });
  const review = await openWith(record, { [ME]: meSaved }, { me: '김민수' });
  const panel = review.ui['panel-mine'];
  byClass(panel, 'me-change')[0].click();
  assert.deepEqual(byClass(panel, 'who-button').map((node) => node.attributes['aria-pressed']), ['false', 'true']);
  assert.equal(byClass(panel, 'who-clear').length, 1);
  byClass(panel, 'who-button')[1].click();
  await settle();
  assert.equal(review.calls.some((call) => /\/me$/.test(call.url)), false);
  assert.equal(byClass(panel, 'who-box').length, 0);
  assert.equal(review.focused(), byClass(panel, 'me-change')[0]);
});

test('저장된 선택이 없으면 선택 지우기가 없다', async () => {
  const record = meeting({ participants: '박서연, 김민수', minutes: minutes(action('가', '박서연')) });
  const review = await openWith(record, {}, { myName: '박서연' });
  byClass(review.ui['panel-mine'], 'me-change')[0].click();
  assert.deepEqual([byClass(review.ui['panel-mine'], 'who-box').length, byClass(review.ui['panel-mine'], 'who-clear').length], [1, 0]);
});

test('후보에서 사라진 옛 선택도 선택 지우기로 지울 수 있다', async () => {
  const record = meeting({ participants: '김민수, 이도현', minutes: minutes(action('가', '김민수')) });
  const review = await openWith(record, { [ME]: meSaved }, { me: '박서연', myName: '김민수' });
  const panel = review.ui['panel-mine'];
  assert.equal(byClass(panel, 'me-name')[0].textContent, '김민수');
  byClass(panel, 'me-change')[0].click();
  assert.deepEqual(byClass(panel, 'who-button').map((node) => node.attributes['aria-pressed']), ['true', 'false']);
  byClass(panel, 'who-clear')[0].click();
  await settle();
  assert.deepEqual(review.calls.find((call) => /\/me$/.test(call.url)).body, { name: null });
  assert.equal(review.state.me, null);
});

test('선택 지우기는 고른 것을 지우고 설정의 내 이름으로 다시 정한다', async () => {
  const record = meeting({ participants: '박서연, 김민수', minutes: minutes(action('가', '박서연'), action('나', '김민수')) });
  const review = await openWith(record, { [ME]: meSaved }, { me: '김민수', myName: '박서연' });
  byClass(review.ui['panel-mine'], 'me-change')[0].click();
  byClass(review.ui['panel-mine'], 'who-clear')[0].click();
  await settle();
  assert.equal(byClass(review.ui['panel-mine'], 'me-name')[0].textContent, '박서연');
  assert.equal(review.ui.status.textContent, '고른 나를 지웠습니다.');
  const lone = await openWith(record, { [ME]: meSaved }, { me: '김민수', myName: '' });
  byClass(lone.ui['panel-mine'], 'me-change')[0].click();
  byClass(lone.ui['panel-mine'], 'who-clear')[0].click();
  await settle();
  assert.deepEqual([byClass(lone.ui['panel-mine'], 'who-box').length, byClass(lone.ui['panel-mine'], 'me-name').length], [1, 0], '설정의 내 이름과 같은 사람이 없으면 다시 묻는다');
});

test('나 저장이 실패하면 고르기 전으로 되돌리고 알린다', async () => {
  const record = meeting({ participants: '박서연, 김민수', minutes: minutes(action('가', '박서연')) });
  const review = await openWith(record, { [ME]: () => failed() });
  byClass(review.ui['panel-mine'], 'who-button')[0].click();
  await settle();
  assert.equal(review.state.me, null);
  assert.equal(byClass(review.ui['panel-mine'], 'who-box').length, 1);
  assert.equal(review.ui['result-status'].textContent, '나를 저장하지 못했습니다. 디스크 오류');
});

test('나를 저장하는 동안에는 다른 회의를 열거나 결과를 닫거나 업데이트를 설치할 수 없다', async () => {
  const first = meeting({ participants: '박서연, 김민수', minutes: minutes(action('가', '박서연')) }), second = meeting({ title: '다른 회의' });
  let release;
  const held = new Promise((resolve) => { release = resolve; });
  const review = await openWith(first, { ...opening(second), [ME]: async (call) => { await held; return meSaved(call); } });
  const panel = review.ui['panel-mine'];
  byClass(panel, 'who-button')[0].click();
  await settle();
  await review.openMeeting('main', second.id);
  assert.equal(review.state.resultId, first.id);
  assert.match(review.ui.status.textContent, /저장하는 중/);
  review.ui['meeting-detail'].dispatch('keydown', { key: 'Escape', defaultPrevented: false });
  assert.equal(review.ui['meeting-detail'].open, true);
  assert.equal(review.hasUnsavedWork(), true);
  assert.match(review.updateBlockers()[0], /저장하는 중/);
  byClass(panel, 'me-change')[0].click();
  const controls = [...byClass(panel, 'who-button'), ...byClass(panel, 'who-clear')];
  assert.deepEqual([controls.length, controls.every((node) => node.disabled)], [3, true], '저장하는 동안에는 다시 고르거나 지울 수 없다');
  release();
  await settle();
  assert.equal(review.hasUnsavedWork(), false);
  review.ui['meeting-detail'].dispatch('keydown', { key: 'Escape', defaultPrevented: false });
  assert.equal(review.ui['meeting-detail'].open, false);
});

test('나를 저장하는 중에 실패하면 원래 결과의 선택으로 되돌린다', async () => {
  const record = meeting({ participants: '박서연, 김민수', minutes: minutes(action('가', '박서연')) });
  let release;
  const held = new Promise((resolve) => { release = resolve; });
  const review = await openWith(record, { [ME]: async () => { await held; return failed(); } }, { me: '김민수' });
  byClass(review.ui['panel-mine'], 'me-change')[0].click();
  byClass(review.ui['panel-mine'], 'who-button')[0].click();
  await settle();
  assert.equal(review.state.me, '박서연', '먼저 화면에 반영한다');
  release();
  await settle();
  assert.equal(review.state.me, '김민수');
  assert.equal(byClass(review.ui['panel-mine'], 'me-name')[0].textContent, '김민수');
  assert.match(review.ui['result-status'].textContent, /나를 저장하지 못했습니다/);
});

test('나를 저장하는 중에 새 회의로 넘어가면 늦게 온 응답이 새 화면을 바꾸지 않는다', async () => {
  for (const outcome of ['성공', '실패']) {
    const record = meeting({ participants: '박서연, 김민수', minutes: minutes(action('가', '박서연')) });
    let release;
    const held = new Promise((resolve) => { release = resolve; });
    const review = await openWith(record, { [ME]: async (call) => { await held; return outcome === '성공' ? meSaved(call) : failed(); } });
    byClass(review.ui['panel-mine'], 'who-button')[0].click();
    await settle();
    review.prepareMeeting();
    await settle();
    assert.deepEqual([review.state.resultId, review.state.me], [null, null], outcome);
    release();
    await settle();
    assert.deepEqual([review.state.me, review.ui['result-status'].textContent, review.hasUnsavedWork()], [null, '', false], outcome);
    if (outcome === '실패') assert.match(review.ui.status.textContent, /이전 회의의 나를 저장하지 못했습니다/);
  }
});

test('수정본을 읽지 못한 회의는 AI 결과로 내 일을 보여 주고 안내를 남긴다', async () => {
  const record = meeting({ participants: '박서연', minutes: minutes(action('가', '박서연')) });
  const review = await openWith(record, {}, { myName: '박서연', todosUnreadable: true });
  assert.match(review.ui['result-status'].textContent, /수정본을 읽지 못해/);
  assert.deepEqual(byClass(review.ui['panel-mine'], 'mine-task').map((node) => node.textContent), ['가']);
});

test('내 할 일 탭의 체크도 저장이 끝날 때까지 닫기와 업데이트 설치를 막는다', async () => {
  const record = meeting({ participants: '박서연', minutes: minutes(action('가', '박서연')) });
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const review = await openWith(record, { [SAVE]: async () => { await gate; return ok(); } }, { myName: '박서연' });
  const [first] = checks(review.ui['panel-mine']);
  first.checked = true;
  first.dispatch('change');
  await settle();
  assert.equal(review.hasUnsavedWork(), true);
  assert.match(review.updateBlockers()[0], /저장하는 중/);
  review.ui['meeting-detail'].dispatch('keydown', { key: 'Escape', defaultPrevented: false });
  assert.equal(review.ui['meeting-detail'].open, true);
  release();
  await settle();
  assert.equal(review.hasUnsavedWork(), false);
});

test('좌우 화살표는 보이는 탭만 돈다', async () => {
  const review = await openWith(meeting());
  review.ui['tab-mine'].dispatch('keydown', { key: 'ArrowLeft' });
  assert.deepEqual([review.state.resultTab, review.focused()], ['transcript', review.ui['tab-transcript']]);
  review.ui['tab-transcript'].dispatch('keydown', { key: 'ArrowRight' });
  assert.equal(review.state.resultTab, 'mine');
  const draft = await openWith(meeting({ minutes: null, transcript: '전사만 있음' }));
  draft.ui['tab-transcript'].dispatch('keydown', { key: 'ArrowRight' });
  assert.equal(draft.state.resultTab, 'minutes');
  draft.ui['tab-minutes'].dispatch('keydown', { key: 'ArrowRight' });
  assert.equal(draft.state.resultTab, 'transcript', '내 할 일 탭은 감춰져 있어 건너뛴다');
});

test('옛 결과 버전을 보면 그 결과의 할 일과 참석자로 내 일을 센다', async () => {
  const first = meeting({ participants: '박서연, 김민수', minutes: minutes(action('가', '박서연')) });
  const second = meeting({ participants: '김민수, 이도현', minutes: minutes(action('가', '이도현')) });
  const review = await openWith(first, opening(second), { myName: '박서연' });
  assert.equal(byClass(review.ui['panel-mine'], 'mine-row').length, 1);
  review.ui['result-versions'].value = second.id;
  review.ui['result-versions'].dispatch('change');
  await settle();
  assert.deepEqual([review.state.resultId, review.state.resultTab], [second.id, 'mine']);
  assert.deepEqual([byClass(review.ui['panel-mine'], 'who-box').length, byClass(review.ui['panel-mine'], 'mine-row').length], [1, 0]);
});

const row = (extra) => ({ location: 'main', id: crypto.randomUUID(), groupId: crypto.randomUUID(), title: '회의', date: '2026-11-09', dailySequence: 1, outputFormat: 'meeting', analyzed: true, audioCount: 0, ...extra });

test('지난 회의 목록은 내가 안 끝낸 일의 수를 제목 옆에 붙이고 0이거나 모르면 붙이지 않는다', async () => {
  const review = fixture({ routes: { '/api/meetings': () => Response.json({ meetings: [row({ mineOpen: 2 }), row({})], skipped: 0 }) } });
  await review.loadHistory();
  const [first, second] = review.ui['meeting-history'].children;
  assert.deepEqual(byClass(first, 'mine-count').map((node) => node.textContent), ['내 일 2']);
  assert.equal(byClass(second, 'mine-count').length, 0);
});

test('체크하면 다시 켜지 않아도 목록의 수가 바로 바뀐다', async () => {
  const record = meeting({ participants: '박서연', minutes: minutes(action('가', '박서연'), action('나', '박서연')) });
  let open = 2;
  const listed = () => Response.json({ meetings: [row({ id: record.id, groupId: record.id, mineOpen: open })], skipped: 0 });
  const review = await openWith(record, { '/api/meetings': listed, [SAVE]: () => { open = 1; return ok(); } }, { myName: '박서연' });
  await review.loadHistory();
  const count = () => byClass(review.ui['meeting-history'].children[0], 'mine-count')[0].textContent;
  assert.equal(count(), '내 일 2');
  const [first] = checks(review.ui['panel-mine']);
  first.checked = true;
  first.dispatch('change');
  await settle();
  assert.equal(count(), '내 일 1');
});

test('복사하면 그 사람의 글이 클립보드에 들어가고 복사함으로 바뀌며 창을 다시 열면 지워진다', async () => {
  const record = meeting({ title: '주간 업무 회의', date: '2026-11-09', participants: '박서연, 김민수', minutes: minutes(action('일정표', '박서연'), action('서버 점검 결과 공유', '김민수', '11월 10일(화)'), action('장비 반입 절차 확인', '김민수'), action('미정인 일')) });
  const review = await openWith(record, {}, { myName: '박서연' });
  assert.equal(review.ui['share-open'].hidden, false);
  review.ui['share-open'].click();
  const rows = () => review.ui['share-list'].children;
  assert.deepEqual(rows().map((row) => texts(row).join('|')), ['1|박서연 (나)|1건|복사', '2|김민수|2건|복사']);
  assert.equal(review.ui['share-unassigned'].textContent, '담당 미정 1건은 누구에게도 가지 않습니다. 정리본에서 담당자를 먼저 맞추세요.');
  assert.equal(review.ui['share-preview-title'].textContent, '박서연 님에게 갈 글');
  const copy = rows()[1].children.at(-1);
  copy.dispatch('focus');
  assert.equal(review.ui['share-preview'].textContent, '[주간 업무 회의] 2026-11-09\n김민수 님이 맡은 일 2건\n- 서버 점검 결과 공유 · 기한 11월 10일(화)\n- 장비 반입 절차 확인');
  copy.click();
  await settle();
  assert.deepEqual(review.clipboard.texts, [review.ui['share-preview'].textContent]);
  assert.equal(rows()[1].children.at(-1).textContent, '복사함');
  assert.equal(review.ui['share-status'].textContent, '김민수 님 할 일을 복사했습니다. 메신저에 붙여 넣으세요.');
  review.ui['share-dialog'].close();
  await settle();
  review.ui['share-open'].click();
  assert.equal(rows()[1].children.at(-1).textContent, '복사');
});

test('복사에 실패하면 알리고 복사함으로 바꾸지 않는다', async () => {
  const record = meeting({ participants: '박서연, 김민수', minutes: minutes(action('가', '김민수')) });
  const review = await openWith(record);
  review.clipboard.fail = true;
  review.ui['share-open'].click();
  const copy = review.ui['share-list'].children[0].children.at(-1);
  copy.click();
  await settle();
  assert.deepEqual([copy.textContent, review.clipboard.texts.length], ['복사', 0]);
  assert.equal(review.ui['share-status'].textContent, '복사하지 못했습니다. 아래 글을 직접 골라 복사해 주세요.');
});

test('사람별 할 일 복사는 담당자가 있는 남은 일이 있을 때만 보이고 나를 몰라도 보인다', async () => {
  const record = meeting({ participants: '박서연, 김민수', minutes: minutes(action('가', '김민수'), action('나')) });
  const review = await openWith(record, { [SAVE]: () => ok() });
  assert.equal(byClass(review.ui['panel-mine'], 'who-box').length, 1, '나를 아직 모른다');
  assert.equal(review.ui['share-open'].hidden, false);
  await review.updateTodo(0, { done: true });
  await settle();
  assert.equal(review.ui['share-open'].hidden, true, '담당자가 있는 일을 모두 끝내면 감춘다');
  const nobody = await openWith(meeting({ participants: '', minutes: minutes(action('가'), action('나')) }));
  assert.equal(nobody.ui['share-open'].hidden, true, '담당자가 한 명도 없으면 감춘다');
});

test('명단에 없는 담당자는 번호 없이 뒤에 나온다', async () => {
  const record = meeting({ participants: '박서연', minutes: minutes(action('가', '외부 김 실장'), action('나', '박서연')) });
  const review = await openWith(record, {}, { myName: '박서연' });
  review.ui['share-open'].click();
  assert.deepEqual(review.ui['share-list'].children.map((row) => texts(row).join('|')), ['1|박서연 (나)|1건|복사', '외부 김 실장|1건|복사']);
  assert.equal(review.ui['share-unassigned'].hidden, true);
});

test('정리본의 할 일 목록 아래에도 같은 단추가 있고 내 할 일 탭 밖에서는 위쪽 단추를 감춘다', async () => {
  const record = meeting({ participants: '박서연, 김민수', minutes: minutes(action('가', '김민수')) });
  const review = await openWith(record);
  review.showResultTab('minutes');
  assert.equal(review.ui['share-open'].hidden, true);
  const [inline] = byClass(review.ui.minutes, 'todo-share');
  inline.click();
  assert.deepEqual([review.ui['share-dialog'].open, review.ui['share-list'].children.length], [true, 1]);
});

test('아주 긴 이름과 문장도 잘라 내지 않고 글에 넣는다', async () => {
  const name = '가'.repeat(200), task = '나'.repeat(2000);
  const review = await openWith(meeting({ participants: name, minutes: minutes(action(task, name)) }));
  review.ui['share-open'].click();
  const expected = `[출시 회의] 2026-11-09\n${name} 님이 맡은 일 1건\n- ${task}`;
  assert.equal(review.ui['share-preview'].textContent, expected);
  review.ui['share-list'].children[0].children.at(-1).click();
  await settle();
  assert.deepEqual(review.clipboard.texts, [expected]);
});

test('입력을 고쳐 다시 분석해야 하는 결과에서는 사람별 할 일 복사를 감춘다', async () => {
  const review = await openWith(meeting({ participants: '박서연, 김민수', minutes: minutes(action('가', '김민수')) }));
  assert.equal(review.ui['share-open'].hidden, false);
  review.ui.transcript.value = '고친 전사';
  review.refresh();
  assert.equal(review.ui['share-open'].hidden, true);
});

test('설정의 내 이름을 저장하면 목록의 수와 열려 있는 내 할 일을 다시 계산한다', async () => {
  const record = meeting({ participants: '박서연, 김민수', minutes: minutes(action('가', '박서연')) });
  const review = await openWith(record, { '/api/settings': (call) => Response.json({ settings: { summaryModel: 'gpt-6.1-sol', defaultOutputFormat: 'meeting', storage: {}, myName: call.body.myName } }) }, { myName: '' });
  assert.equal(byClass(review.ui['panel-mine'], 'who-box').length, 1);
  const lists = () => review.calls.filter((call) => call.url === '/api/meetings').length, before = lists();
  byClass(review.ui['panel-mine'], 'who-settings')[0].click();
  assert.deepEqual([review.ui.settings.open, review.focused()], [true, review.ui['my-name']]);
  review.ui['my-name'].value = ' 박서연 ';
  review.ui['my-name-save'].click();
  await settle();
  assert.deepEqual(review.calls.find((call) => call.url === '/api/settings').body, { myName: '박서연' });
  assert.deepEqual([review.ui['my-name'].value, review.ui['my-name-status'].textContent], ['박서연', '내 이름을 저장했습니다.']);
  assert.equal(byClass(review.ui['panel-mine'], 'me-name')[0].textContent, '박서연');
  assert.equal(lists(), before + 1);
});

const SETTINGS = { '/api/settings': (call) => Response.json({ settings: { summaryModel: 'gpt-6.1-sol', defaultOutputFormat: 'meeting', storage: {}, myName: call.body.myName } }) };

test('직접 고른 선택이 저장된 회의는 설정의 내 이름을 바꿔도 그대로다', async () => {
  const record = meeting({ participants: '박서연, 김민수', minutes: minutes(action('가', '박서연'), action('나', '김민수')) });
  const review = await openWith(record, SETTINGS, { me: '김민수', myName: '' });
  review.openSettings('settings-me');
  review.ui['my-name'].value = '박서연';
  await review.saveMyName();
  assert.equal(review.state.settings.myName, '박서연');
  assert.equal(byClass(review.ui['panel-mine'], 'me-name')[0].textContent, '김민수');
});

test('내 이름을 비워 저장하면 지웠다고 알린다', async () => {
  const review = await openWith(meeting({ participants: '박서연' }), SETTINGS, { myName: '박서연' });
  review.openSettings('settings-me');
  assert.equal(review.ui['my-name'].value, '박서연', '창을 열면 저장된 이름을 채운다');
  review.ui['my-name'].value = '  ';
  await review.saveMyName();
  assert.deepEqual([review.ui['my-name'].value, review.ui['my-name-status'].textContent], ['', '내 이름을 지웠습니다.']);
});

test('내 이름 저장이 실패하면 적은 글자를 그대로 두고 알린다', async () => {
  const review = await openWith(meeting(), { '/api/settings': () => Response.json({ error: { code: 'X', message: '디스크 오류' } }, { status: 500 }) }, { myName: '' });
  review.openSettings('settings-me');
  review.ui['my-name'].value = '이도현 ';
  await review.saveMyName();
  assert.equal(review.ui['my-name'].value, '이도현 ');
  assert.match(review.ui['my-name-status'].textContent, /설정을 저장하지 못했습니다/);
});

test('녹음이나 분석 중에는 내 이름을 바꿀 수 없다', async () => {
  const review = await openWith(meeting());
  review.refresh();
  assert.deepEqual([review.ui['my-name'].disabled, review.ui['my-name-save'].disabled], [false, false]);
  review.state.flowBusy = true;
  review.refresh();
  assert.deepEqual([review.ui['my-name'].disabled, review.ui['my-name-save'].disabled], [true, true]);
});

test('내 이름 칸에서 Enter를 누르면 저장한다', async () => {
  const review = await openWith(meeting({ participants: '박서연' }), SETTINGS, { myName: '' });
  review.openSettings('settings-me');
  review.ui['my-name'].value = '박서연';
  review.ui['my-name'].dispatch('keydown', { key: 'Enter' });
  await settle();
  assert.deepEqual(review.calls.find((call) => call.url === '/api/settings').body, { myName: '박서연' });
});

test('나 고르기 상자에서 연 설정 창을 닫으면 결과 화면의 내 할 일 탭으로 초점이 돌아온다', async () => {
  const record = meeting({ participants: '박서연, 김민수', minutes: minutes(action('가', '박서연')) });
  const review = await openWith(record, SETTINGS, { myName: '' });
  const [opener] = byClass(review.ui['panel-mine'], 'who-settings');
  opener.click();
  review.ui['my-name'].value = '박서연';
  await review.saveMyName();
  opener.isConnected = false;
  review.ui.settings.close();
  await settle();
  assert.equal(review.focused(), review.ui['tab-mine']);
});

test('긴 기한도 문장 칸을 밀어내지 않게 기한 칸의 폭을 제한하고 줄을 바꾼다', () => {
  // 짝 검증 2의 W-1. 기한 칸이 내용 길이만큼(auto) 넓어지고 줄을 바꾸지 않으면, 허용 길이(200자) 안의 긴 기한이 문장 칸의 폭을 0으로 만든다.
  const css = fs.readFileSync(path.join(__dirname, '화면', 'app.css'), 'utf8').replace(/\r\n/g, '\n');
  const rule = (selector) => css.split('\n').find((line) => line.startsWith(`${selector} {`)) ?? '';
  assert.match(rule('.mine-row'), /grid-template-columns: minmax\(0, 1fr\) fit-content\(40%\)/);
  assert.doesNotMatch(rule('.mine-due'), /nowrap/);
  assert.match(rule('.mine-due'), /overflow-wrap: anywhere/);
});

test('선택을 지운 뒤 나를 모르게 되면 다시 고를 수 있는 첫 후보에 초점을 둔다', async () => {
  // 짝 검증 2의 W-2. 누른 선택 지우기 단추가 다시 그리며 사라지고 바꾸기 단추도 없어, 초점이 body에 남았다.
  const record = meeting({ participants: '김민수, 이도현', minutes: minutes(action('가', '김민수')) });
  const review = await openWith(record, { [ME]: meSaved }, { me: '김민수', myName: '박서연' });
  const panel = review.ui['panel-mine'];
  byClass(panel, 'me-change')[0].click();
  const [clear] = byClass(panel, 'who-clear');
  clear.focus();
  clear.click();
  await settle();
  const [first] = byClass(panel, 'who-button');
  assert.equal(byClass(panel, 'who-lead').length, 1, '나를 다시 묻는다');
  assert.deepEqual([review.focused() === first, first.disabled], [true, false]);
});

test('나를 저장하는 사이 다른 곳으로 옮긴 초점은 빼앗지 않는다', async () => {
  const record = meeting({ participants: '김민수, 이도현', minutes: minutes(action('가', '김민수')) });
  let release;
  const held = new Promise((resolve) => { release = resolve; });
  const review = await openWith(record, { [ME]: async (call) => { await held; return meSaved(call); } }, { me: '김민수', myName: '박서연' });
  const panel = review.ui['panel-mine'];
  byClass(panel, 'me-change')[0].click();
  const [clear] = byClass(panel, 'who-clear');
  clear.focus();
  clear.click();
  await settle();
  review.ui['tab-minutes'].focus();
  release();
  await settle();
  assert.equal(review.focused(), review.ui['tab-minutes']);
});

test('나를 저장하는 사이 패널 안에서 옮긴 초점은 다시 그린 같은 조작 요소로 돌려준다', async () => {
  // 짝 재확인의 W-2 보완. 응답 뒤 패널을 다시 그리면서, 저장 중에 설정 단추나 체크 상자로 옮겨 둔 초점을 바꾸기·첫 후보로 빼앗았다.
  const cases = [
    ['설정 이름이 없어 나를 다시 묻는 회의', { participants: '김민수, 이도현', actions: [action('가', '김민수')], myName: '' }, (panel) => byClass(panel, 'who-settings')[0]],
    ['설정 이름으로 나를 다시 정하는 회의', { participants: '박서연, 김민수', actions: [action('가', '박서연'), action('나', '김민수')], myName: '박서연' }, (panel) => walk(panel).find((node) => node.dataset?.todoFocus === 'mine:0')],
  ];
  for (const [name, { participants, actions, myName }, pick] of cases) {
    let release;
    const held = new Promise((resolve) => { release = resolve; });
    const review = await openWith(meeting({ participants, minutes: minutes(...actions) }), { [ME]: async (call) => { await held; return meSaved(call); } }, { me: '김민수', myName });
    const panel = review.ui['panel-mine'];
    byClass(panel, 'me-change')[0].click();
    const [clear] = byClass(panel, 'who-clear');
    clear.focus();
    clear.click();
    await settle();
    const moved = pick(panel);
    assert.ok(moved, `${name}: 저장 중에도 옮길 곳이 있다`);
    moved.focus();
    release();
    await settle();
    const again = pick(panel);
    assert.notEqual(again, moved, `${name}: 응답 뒤 다시 그렸다`);
    assert.equal(review.focused(), again, name);
  }
});

test('할 일 저장이 실패하는 사이 패널 밖으로 옮긴 초점은 빼앗지 않는다', async () => {
  // 짝 검증 3의 A-3과 같은 규칙이다. 실패한 저장을 되돌리며 다시 그릴 때, 그사이 탭으로 옮긴 초점을 체크 상자로 빼앗았다.
  let release;
  const held = new Promise((resolve) => { release = resolve; });
  const record = meeting({ participants: '박서연, 김민수', minutes: minutes(action('가', '박서연')) });
  const review = await openWith(record, { [SAVE]: async () => { await held; return failed(); } }, { myName: '박서연' });
  const [first] = checks(review.ui['panel-mine']);
  first.focus();
  first.checked = true;
  first.dispatch('change');
  await settle();
  review.ui['tab-mine'].focus();
  release();
  await settle();
  const [again] = checks(review.ui['panel-mine']);
  assert.deepEqual([review.focused(), again.checked], [review.ui['tab-mine'], false]);
});

test('할 일 저장이 실패해도 패널 안에 둔 초점은 다시 그린 같은 체크 상자로 돌려준다', async () => {
  let release;
  const held = new Promise((resolve) => { release = resolve; });
  const record = meeting({ participants: '박서연, 김민수', minutes: minutes(action('가', '박서연'), action('나', '박서연')) });
  const review = await openWith(record, { [SAVE]: async () => { await held; return failed(); } }, { myName: '박서연' });
  const panel = review.ui['panel-mine'];
  const [first] = checks(panel);
  first.focus();
  first.checked = true;
  first.dispatch('change');
  await settle();
  const moved = walk(panel).find((node) => node.dataset?.todoFocus === 'mine:1');
  moved.focus();
  release();
  await settle();
  const again = walk(panel).find((node) => node.dataset?.todoFocus === 'mine:1');
  assert.notEqual(again, moved, '되돌리며 다시 그렸다');
  assert.equal(review.focused(), again);
});

test('나를 저장하는 사이 연 설정 창을 닫으면 다시 그린 같은 단추로 돌아간다', async () => {
  // 짝 검증 3의 A-2와 같은 규칙이다. 응답으로 패널을 다시 그려 연 단추가 바뀌었어도 같은 열쇠의 새 단추가 있으면 그리로 돌아간다.
  let release;
  const held = new Promise((resolve) => { release = resolve; });
  const record = meeting({ participants: '김민수, 이도현', minutes: minutes(action('가', '김민수')) });
  const review = await openWith(record, { [ME]: async (call) => { await held; return meSaved(call); } }, { me: '김민수', myName: '' });
  const panel = review.ui['panel-mine'];
  byClass(panel, 'me-change')[0].click();
  byClass(panel, 'who-clear')[0].click();
  await settle();
  const [opener] = byClass(panel, 'who-settings');
  opener.focus();
  opener.click();
  assert.equal(review.ui.settings.open, true);
  release();
  await settle();
  assert.equal(opener.isConnected, false, '응답 뒤 패널을 다시 그렸다');
  review.ui.settings.close();
  await settle();
  assert.equal(review.focused(), byClass(panel, 'who-settings')[0]);
});

test('복사 창을 닫았다 다시 열면 그 사이 끝난 이전 복사는 새 창에 표시하지 않는다', async () => {
  // 짝 검증 3의 A-1과 같은 규칙이다. 창을 열 때마다 복사함 표시를 지우므로, 이전 창에서 누른 복사의 늦은 결과도 새 창에 남기지 않는다.
  const record = meeting({ participants: '박서연, 김민수', minutes: minutes(action('가', '김민수')) });
  const review = await openWith(record);
  let release;
  review.clipboard.hold = new Promise((resolve) => { release = resolve; });
  review.ui['share-open'].click();
  review.ui['share-list'].children[0].children.at(-1).click();
  review.ui['share-dialog'].close();
  await settle();
  review.ui['share-open'].click();
  release();
  await settle();
  const copy = review.ui['share-list'].children[0].children.at(-1);
  assert.deepEqual([review.ui['share-status'].textContent, copy.textContent, review.clipboard.texts.length], ['', '복사', 1]);
});
