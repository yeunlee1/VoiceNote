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

function fixture({ routes = {}, confirm = () => true } = {}) {
  let focused = null;
  const clipboard = { fail: false, texts: [] };
  const element = (tag = 'div') => {
    const listeners = {};
    const node = { tag, value: '', checked: false, type: '', className: '', scrollTop: 0, style: {}, hidden: false, disabled: false, open: false, textContent: '', dataset: {}, children: [], attributes: {}, isConnected: true,
      classList: { add() {}, remove() {} }, removeAttribute(name) { delete this.attributes[name]; }, setAttribute(name, value) { this.attributes[name] = value; },
      addEventListener(type, fn) { (listeners[type] ||= []).push(fn); }, dispatch(type, event = {}) { for (const fn of listeners[type] || []) fn({ target: node, preventDefault() {}, ...event }); },
      querySelectorAll(selector) { return selector === 'button' ? this.children.filter((child) => child.tag === 'button') : []; },
      querySelector(selector) {
        const key = /^\[data-todo-focus="(.+)"\]$/.exec(selector)?.[1];
        if (key) return walk(node).find((child) => child.dataset.todoFocus === key) ?? null;
        return selector === '[data-close]' ? walk(node).find((child) => 'close' in child.dataset) ?? null : null;
      },
      // 브라우저가 내용을 갈면 스크롤이 올라가는 것을 흉내 낸다.
      append(...items) { this.children.push(...items); }, replaceChildren(...items) { this.children = items; this.scrollTop = 0; },
      remove() {}, focus() { focused = node; }, scrollIntoView() {}, click() { this.dispatch('click'); }, show() { this.open = true; }, showModal() { this.open = true; },
      // 실제 대화상자처럼 close 이벤트는 나중에 온다.
      close() { this.open = false; setTimeout(() => this.dispatch('close'), 0); } };
    return node;
  };
  const nodes = new Map(), calls = [];
  const json = (body, status = 200) => Response.json(body, { status });
  const body = element('body');
  const sandbox = { crypto, Blob, AbortController, DOMException, TextDecoder, setTimeout, clearTimeout, setInterval, clearInterval, confirm,
    navigator: { clipboard: { writeText: async (text) => { if (clipboard.fail) throw new Error('거절'); clipboard.texts.push(text); } } },
    window: { addEventListener() {}, MeetingFormats: require('./출력형식.js'), MeetingTodos: require('./할일정리.js') },
    URL: { createObjectURL: () => 'blob:test', revokeObjectURL() {} },
    document: { body, execCommand: () => false, addEventListener() {}, getElementById(id) { if (!nodes.has(id)) nodes.set(id, element()); return nodes.get(id); }, createElement: element },
    async fetch(url, options = {}) {
      calls.push({ url, options, body: typeof options.body === 'string' ? JSON.parse(options.body) : options.body });
      const route = routes[url] || Object.entries(routes).find(([key]) => key.startsWith('^') && new RegExp(key).test(url))?.[1];
      if (route) return route(calls.at(-1));
      if (url === '/api/meetings') return json({ meetings: [], skipped: 0 });
      return json({});
    } };
  const original = fs.readFileSync(path.join(__dirname, '화면/app.js'), 'utf8');
  const source = original.replace(/  init\(\);\s*\}\)\(\);\s*$/,
    '  globalThis.review = { state, ui, bind, refresh, resetMeetingForm, openMeeting, loadHistory, updateTodo, renderMine, saveMe, showResultTab, hasUnsavedWork, updateBlockers, openSettings, prepareMeeting };\n})();');
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
