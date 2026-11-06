// Windows 화면의 프로그램 정보(버전·업데이트·버전별 바뀐 점)와 상단 새 버전 표시가 업데이트 상태와 회의 상태에 맞게 움직이는지 검증한다.
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const crypto = require('node:crypto');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const notes = require('./릴리즈노트.js');

function snapshot(status, change = {}) {
  return { supported: status !== 'unsupported', currentVersion: '1.5.0', status, version: ['latest', 'unsupported', 'checking', 'unknown'].includes(status) ? null : '1.5.1',
    publishedAt: '2026-11-20T01:00:00Z', size: 26_214_400, received: 0, error: null, lastResult: null, pageUrl: 'https://github.com/yeunlee1/VoiceNote/releases/latest', ...change };
}

function fixture({ updates = [snapshot('latest')], webview = true, confirmAnswer = true, launch = () => snapshot('launching') } = {}) {
  const element = (tag = 'div') => {
    const listeners = {};
    const classes = new Set();
    const node = { tag, value: '', checked: false, style: {}, hidden: false, disabled: false, open: false, textContent: '', dataset: {}, children: [], attributes: {}, isConnected: true,
      classList: { add: (name) => classes.add(name), remove: (name) => classes.delete(name), toggle: (name, on) => (on ?? !classes.has(name)) ? classes.add(name) : classes.delete(name), contains: (name) => classes.has(name) },
      removeAttribute(name) { delete this.attributes[name]; }, setAttribute(name, value) { this.attributes[name] = String(value); }, getAttribute(name) { return this.attributes[name] ?? null; },
      addEventListener(type, fn) { (listeners[type] ||= []).push(fn); }, dispatch(type, event = {}) { for (const fn of listeners[type] || []) fn({ target: node, ...event }); },
      querySelectorAll() { return []; }, querySelector() { return null; }, append(...items) { this.children.push(...items); }, replaceChildren(...items) { this.children = items; },
      remove() {}, focus() { focused.push(node); }, scrollIntoView() {}, click() { this.dispatch('click'); }, showModal() { this.open = true; }, close() { this.open = false; this.dispatch('close'); } };
    return node;
  };
  const nodes = new Map(), calls = [], messages = [], toasts = [], focused = [];
  let closed = 0, removedGuard = 0;
  const queue = [...updates];
  const json = (body, status = 200) => Response.json(body, { status });
  const sandbox = { crypto, Blob, AbortController, DOMException, TextDecoder, setTimeout, clearTimeout, setInterval, clearInterval,
    confirm: () => confirmAnswer,
    window: { addEventListener() {}, removeEventListener(type) { if (type === 'beforeunload') removedGuard++; }, close() { closed++; },
      MeetingFormats: require('./출력형식.js'), VoiceNoteReleaseNotes: notes,
      ...(webview ? { chrome: { webview: { postMessage(message) { messages.push(message); }, addEventListener() {} } } } : {}) },
    URL: { createObjectURL: () => 'blob:test', revokeObjectURL() {} },
    document: { body: element('body'), getElementById(id) { if (!nodes.has(id)) nodes.set(id, element()); return nodes.get(id); }, createElement: (tag) => element(tag) },
    async fetch(url, options = {}) {
      calls.push({ url, method: options.method || 'GET' });
      if (url === '/api/update') return json({ update: queue.length > 1 ? queue.shift() : queue[0] });
      if (url === '/api/update/check') return json({ update: snapshot('checking') });
      if (url === '/api/update/download') return json({ update: snapshot('downloading') });
      if (url === '/api/update/launch') {
        try { return json({ update: await launch() }); }
        catch (error) { return json({ error: { code: error.code || 'UPDATE_LAUNCH_FAILED', message: error.message } }, 409); }
      }
      if (url === '/api/meetings') return json({ meetings: [], skipped: 0 });
      return json({});
    } };
  const original = fs.readFileSync(path.join(__dirname, '화면/app.js'), 'utf8');
  const source = original.replace(/  init\(\);\s*\}\)\(\);\s*$/,
    '  globalThis.review = { state, ui, bind, refresh, resetMeetingForm, loadUpdate, renderUpdate, startUpdate, launchUpdate, checkUpdate, openAbout, renderAbout, updateBlockers, startRecording, announce };\n})();');
  assert.notEqual(source, original);
  vm.runInNewContext(source, sandbox);
  const review = sandbox.review;
  review.state.updatePollMs = 5;
  review.bind();
  review.resetMeetingForm();
  const status = nodes.get('status');
  const realAnnounce = status;
  return { ...review, calls, messages, nodes, focused, toasts, status: realAnnounce, closed: () => closed, removedGuard: () => removedGuard,
    wait: (ms = 30) => new Promise((resolve) => setTimeout(resolve, ms)), count: (url, method = 'POST') => calls.filter((call) => call.url === url && call.method === method).length };
}
const texts = (node) => [node.textContent, ...(node.children || []).flatMap(texts)].filter(Boolean);

test('새 버전이 있으면 상단에 표시하고 프로그램 정보에 새 버전과 지금 업데이트 단추를 보인다', async () => {
  const review = fixture({ updates: [snapshot('available')] });
  await review.loadUpdate();
  assert.equal(review.ui['update-chip'].hidden, false);
  assert.match(review.ui['update-chip-label'].textContent, /1\.5\.1/);
  assert.match(review.ui['update-chip'].attributes['aria-label'], /프로그램 정보/);
  assert.match(review.ui['update-state'].textContent, /1\.5\.1 버전이 나왔습니다/);
  assert.equal(review.ui['update-install'].hidden, false);
  assert.equal(review.ui['update-install'].disabled, false);
  assert.equal(review.ui['update-install'].textContent, '지금 업데이트');
  assert.equal(review.ui['about-update'].dataset.status, 'available');
  assert.equal(review.ui['update-note'].hidden, false);
});

test('받는 중·설치 준비됨에는 다시 확인을 숨기고, 최신일 때는 닫혔다 열린다는 안내를 숨긴다', async () => {
  const review = fixture({ updates: [snapshot('downloading'), snapshot('ready', { received: 26_214_400 })] });
  await review.loadUpdate();
  assert.equal(review.ui['update-check'].hidden, true);
  await review.wait(40);
  assert.equal(review.ui['about-update'].dataset.status, 'ready');
  assert.equal(review.ui['update-check'].hidden, true);
  const latest = fixture({ updates: [snapshot('latest')] });
  await latest.loadUpdate();
  assert.equal(latest.ui['update-note'].hidden, true);
});

test('최신이거나 제공하지 않는 실행이면 상단 표시와 설치 단추를 숨긴다', async () => {
  const latest = fixture({ updates: [snapshot('latest')] });
  await latest.loadUpdate();
  assert.equal(latest.ui['update-chip'].hidden, true);
  assert.match(latest.ui['update-state'].textContent, /1\.5\.0 버전이 최신/);
  assert.equal(latest.ui['update-install'].hidden, true);
  assert.equal(latest.ui['update-check'].hidden, false);
  const dev = fixture({ updates: [snapshot('unsupported')] });
  await dev.loadUpdate();
  assert.equal(dev.ui['update-chip'].hidden, true);
  assert.equal(dev.ui['update-install'].hidden, true);
  assert.equal(dev.ui['update-check'].hidden, true);
  assert.match(dev.ui['update-state'].textContent, /설치한 VoiceNote/);
});

test('지금 업데이트를 한 번 누르면 받은 뒤 바로 설치를 시작하고 창을 닫는다', async () => {
  const review = fixture({ updates: [snapshot('available'), snapshot('downloading', { received: 13_107_200 }), snapshot('ready', { received: 26_214_400 })] });
  await review.loadUpdate();
  await review.startUpdate();
  assert.equal(review.count('/api/update/download'), 1);
  assert.equal(review.ui['update-progress-row'].hidden, false);
  await review.wait(80);
  assert.equal(review.count('/api/update/launch'), 1);
  assert.equal(review.state.updateLaunching, true);
  assert.match(review.ui['update-state'].textContent, /설치를 시작했습니다/);
  // 설치를 시작한 뒤에는 새 회의를 시작하지 못한다.
  review.refresh();
  assert.equal(review.ui.start.disabled, true);
  assert.equal(review.ui.prepare.disabled, true);
  await review.wait(1300);
  assert.equal(review.removedGuard(), 1);
  assert.equal(review.closed(), 1);
});

test('받는 동안 녹음을 시작하면 설치는 미루고 회의를 마친 뒤 누르게 한다', async () => {
  const review = fixture({ updates: [snapshot('available'), snapshot('downloading'), snapshot('ready', { received: 26_214_400 })] });
  await review.loadUpdate();
  await review.startUpdate();
  // 녹음 중인 것처럼 만든다. 녹음 상태는 화면에만 있어 서버는 알 수 없다.
  review.state.recorders.add({ recorder: { state: 'recording' } });
  await review.wait(80);
  assert.equal(review.count('/api/update/launch'), 0);
  assert.equal(review.ui['update-install'].textContent, '설치 시작');
  assert.equal(review.ui['update-install'].disabled, true);
  assert.equal(review.ui['update-lock'].hidden, false);
  assert.match(review.ui['update-lock'].textContent, /녹음/);
  await review.launchUpdate();
  assert.equal(review.count('/api/update/launch'), 0);
});

test('저장하지 않은 회의 내용이 있으면 설치를 시작하지 않고 이유를 보인다', async () => {
  const review = fixture({ updates: [snapshot('ready', { received: 26_214_400 })] });
  await review.loadUpdate();
  review.ui.transcript.value = '저장하지 않은 전사';
  review.state.notesSaved = false;
  review.renderUpdate();
  assert.match(review.ui['update-lock'].textContent, /저장하지 않은/);
  assert.equal(review.ui['update-install'].disabled, true);
  await review.launchUpdate();
  assert.equal(review.count('/api/update/launch'), 0);
  assert.equal(review.closed(), 0);
});

test('회의 준비에 적은 내용은 사라진다고 묻고, 취소하면 설치하지 않는다', async () => {
  const review = fixture({ updates: [snapshot('ready', { received: 26_214_400 })], confirmAnswer: false });
  await review.loadUpdate();
  review.ui.title.value = '다음 주 기획 회의';
  await review.launchUpdate();
  assert.equal(review.count('/api/update/launch'), 0);
  assert.equal(review.state.updateLaunching, false);
});

test('설치 시작이 거절되면 잠금을 풀고 이유를 알린다', async () => {
  const review = fixture({ updates: [snapshot('ready', { received: 26_214_400 })], launch: () => { throw Object.assign(new Error('진행 중인 AI 요청이 끝난 뒤 업데이트를 설치해 주세요.'), { code: 'BUSY' }); } });
  await review.loadUpdate();
  await review.launchUpdate();
  assert.equal(review.state.updateLaunching, false);
  assert.match(review.ui['update-detail'].textContent, /AI 요청이 끝난 뒤/);
  assert.equal(review.closed(), 0);
  review.refresh();
  assert.equal(review.ui.prepare.disabled, false);
});

test('지난 업데이트 결과는 한 번만 알리고 프로그램 정보에도 남긴다', async () => {
  const done = snapshot('latest', { lastResult: { outcome: 'installed', version: '1.5.0', message: 'VoiceNote를 1.5.0 버전으로 업데이트했습니다.' } });
  const review = fixture({ updates: [done] });
  await review.loadUpdate();
  assert.equal(review.status.textContent, 'VoiceNote를 1.5.0 버전으로 업데이트했습니다.');
  review.status.textContent = '';
  await review.loadUpdate();
  assert.equal(review.status.textContent, '');
  assert.match(review.ui['update-detail'].textContent, /업데이트했습니다/);
});

test('깃허브에서 보기는 Windows 창에 고정 메시지만 보내고, 창 밖에서는 숨긴다', async () => {
  const review = fixture({ updates: [snapshot('manual', { error: { code: 'UPDATE_MANUAL', message: '새 버전의 자동 설치 정보를 찾지 못했습니다. 깃허브 릴리즈 페이지에서 설치파일을 직접 받아 설치하세요.' } })] });
  await review.loadUpdate();
  assert.equal(review.ui['update-install'].hidden, true);
  assert.match(review.ui['update-detail'].textContent, /깃허브/);
  review.ui['update-page'].click();
  assert.deepEqual(review.messages, ['open-update-page']);
  const browser = fixture({ webview: false });
  assert.equal(browser.ui['update-page'].hidden, true);
});

test('다시 확인은 서버에 확인을 맡기고 확인 중에는 다시 누를 수 없다', async () => {
  const review = fixture({ updates: [snapshot('latest'), snapshot('checking'), snapshot('latest')] });
  await review.loadUpdate();
  await review.checkUpdate();
  assert.equal(review.count('/api/update/check'), 1);
  assert.equal(review.ui['update-check'].disabled, true);
  await review.wait(60);
  assert.equal(review.ui['update-check'].disabled, false);
});

test('프로그램 정보는 지금 버전과 버전별 바뀐 점을 최신 버전부터 보여 주고 지금 버전을 표시한다', async () => {
  const review = fixture({ updates: [snapshot('latest')] });
  await review.loadUpdate();
  review.openAbout(review.ui['open-about']);
  assert.equal(review.ui.about.open, true);
  assert.equal(review.ui['about-version'].textContent, '1.5.0');
  const items = review.ui['release-list'].children;
  assert.equal(items.length, notes.NOTES.length);
  assert.equal(items[0].dataset.current, String(notes.NOTES[0].version === '1.5.0'));
  const all = texts(review.ui['release-list']);
  assert.ok(all.includes('1.4.0'));
  assert.ok(all.includes('2026년 11월 6일'));
  assert.ok(all.includes(notes.find('1.4.0').items[0]));
  assert.ok(all.includes('지금 버전'));
});

test('상단 표시로 연 프로그램 정보를 닫을 때 그 표시가 숨었으면 설정 단추로 초점을 돌린다', async () => {
  const review = fixture({ updates: [snapshot('available')] });
  await review.loadUpdate();
  review.openAbout(review.ui['update-chip']);
  review.ui['update-chip'].hidden = true;
  review.focused.length = 0;
  review.ui.about.close();
  assert.equal(review.focused.at(-1), review.ui['open-settings']);
});
