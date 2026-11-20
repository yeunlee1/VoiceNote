// 분석 전에 원음을 저장하는 화면 동작과 지난 회의 목록·보관함 경로 연결을 검증한다.
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
function fixture(summaryResponse, responses = {}, { finishMode = 'minutes', ...extra } = {}) {
  const seen = { focused: null };
  const element = (tag = '') => {
    const listeners = {};
    return { tagName: String(tag).toUpperCase(), value: '', checked: true, hidden: false, disabled: false, open: false, textContent: '', dataset: {}, style: {}, children: [],
      classList: { add() {}, remove() {} }, append(...items) { this.children.push(...items); }, replaceChildren(...items) { this.children = items; },
      addEventListener(type, handler) { (listeners[type] ||= []).push(handler); }, removeEventListener(type, handler) { listeners[type] = (listeners[type] || []).filter(item => item !== handler); },
      dispatch(type, event = {}) { for (const handler of [...(listeners[type] || [])]) handler({ type, target: this, currentTarget: this, preventDefault() {}, ...event }); },
      click() { if (!this.disabled) this.dispatch('click'); },
      setAttribute() {}, removeAttribute() {}, querySelector() { return null; },
      querySelectorAll(selector) {
        if (!selector.startsWith('.') || /[\s.#[:>]/.test(selector.slice(1))) return [];
        const found = [], visit = node => { for (const child of node.children || []) { if (String(child.className || '').split(' ').includes(selector.slice(1))) found.push(child); visit(child); } };
        visit(this);
        return found;
      },
      focus() { seen.focused = this; }, show() { this.open = true; }, showModal() { this.open = true; }, close() { if (!this.open) return; this.open = false; setTimeout(() => this.dispatch('close'), 0); } };
  };
  // 처리기를 기억했다가 click()·close()로 부른다. 브라우저처럼 close 이벤트는 조금 뒤에 보낸다. 고르는 창은 열릴 때 finishMode의 단추를 누르고(null이면 닫고, 'manual'이면 시험이 직접 누름), 열린 때의 안내 글을 choices에 모은다.
  const nodes = new Map(), calls = [], summaryBodies = [], posts = [], requests = [];
  const sandbox = { crypto, Blob, File, AbortController, DOMException, setTimeout, clearTimeout, setInterval, clearInterval, confirm: () => true, window: { MeetingFormats: require('./출력형식.js'), MeetingTodos: require('./할일정리.js'), MeetingActivity: require('./진행기록.js'), addEventListener() {}, removeEventListener() {} },
    URL: { createObjectURL: () => 'blob:test', revokeObjectURL() {} },
    document: { getElementById(id) { if (!nodes.has(id)) nodes.set(id, element()); return nodes.get(id); }, createElement: element },
    async fetch(url, options = {}) {
      calls.push(url);
      requests.push({ url, headers: options.headers || {}, body: options.body });
      if (options.method === 'POST' && typeof options.body === 'string') posts.push({ url, body: JSON.parse(options.body) });
      if (url === '/api/summary') {
        summaryBodies.push(JSON.parse(options.body));
        if (summaryResponse) return summaryResponse(summaryBodies.at(-1), summaryBodies.length, options);
      }
      if (responses[url] instanceof Response) return responses[url];
      if (typeof responses[url] === 'function') return responses[url](typeof options.body === 'string' ? JSON.parse(options.body) : options.body, options);
      let body = {};
      if (Object.hasOwn(responses, url)) body = responses[url];
      else if (url === '/api/meetings') body = { meetings: [], skipped: 0 };
      else if (url === '/api/transcribe') body = { text: '시험 회의 발언입니다.' };
      else if (url === '/api/summary') body = { minutes: { overview: '시험', topics: [], decisions: [], actions: [], openQuestions: [] } };
      return Response.json(body);
    } };
  Object.assign(sandbox.window, extra.window);
  Object.assign(sandbox, { ...extra, window: sandbox.window });
  const choices = [], node = id => sandbox.document.getElementById(id);
  node('finish-choice').showModal = function () {
    this.open = true;
    choices.push(node('finish-choice-note').textContent);
    if (finishMode === 'manual') return;
    queueMicrotask(() => finishMode ? node(finishMode === 'transcript' ? 'finish-transcript' : 'finish-minutes').click() : this.close());
  };
  // 시험마다 필요한 브라우저 기능(예: 가짜 마이크)을 더한다. window는 이미 있는 내용에 합친다.
  const original = fs.readFileSync(path.join(__dirname, '화면/app.js'), 'utf8');
  const source = original.replace(/  init\(\);\s*\}\)\(\);\s*$/, '  globalThis.review = { state, ui, summarize, lines, exportDocument, documentObject, renderMinutesInto, plainText, loadHistory, openMeeting, importAudio, finishMeeting, clearLocal, archiveResult, startRecording, bindDialog, bind, transcribe, resetMeetingForm, tickActivity: typeof tickActivity === \'function\' ? tickActivity : undefined };\n})();');
  assert.notEqual(source, original);
  vm.runInNewContext(source, sandbox);
  const { state, ui } = sandbox.review;
  ui.title.value = '시험 회의'; ui.date.value = '2026-09-15';
  return { ...sandbox.review, calls, summaryBodies, posts, requests, closeStatus: sandbox.window.meetingDesktopStatus, choices, focused: () => seen.focused };
}
const texts = node => [node.textContent, ...(node.children || []).flatMap(texts)].filter(Boolean);
const historyItems = ui => ui['meeting-history'].children.map(button => texts(button).join(' | '));

test('지난 회의 목록에 이전 프로젝트 꼬리표·별 개수·읽지 못한 기록 수를 보여 준다', async () => {
  const { ui, loadHistory } = fixture(null, { '/api/meetings': { skipped: 2, meetings: [
    { location: 'p1', id: crypto.randomUUID(), title: '옛 회의', date: '2026-09-01', dailySequence: 1, projectName: '홈페이지 개편', outputFormat: 'meeting', analyzed: true, audioCount: 1, stars: 4, refined: false },
    { location: 'main', id: crypto.randomUUID(), title: '새 회의', date: '2026-09-15', dailySequence: 1, outputFormat: 'tasks', analyzed: true, audioCount: 1, refined: false }] } });
  await loadHistory();
  assert.match(ui['history-status'].textContent, /2개 회의/);
  assert.match(ui['history-status'].textContent, /읽지 못한 기록 2개/);
  const [old, fresh] = historyItems(ui);
  assert.match(old, /이전 프로젝트: 홈페이지 개편/);
  assert.match(old, /별 4개/);
  assert.match(fresh, /업무 정리/);
  assert.doesNotMatch(fresh, /이전 프로젝트|별 \d개/);
});

test('분석 전 녹음은 목록에 제목 미정 회의로 보인다', async () => {
  const { ui, loadHistory } = fixture(null, { '/api/meetings': { skipped: 0, meetings: [
    { location: 'main', id: crypto.randomUUID(), title: '', date: '2026-10-23', dailySequence: 2, outputFormat: 'meeting', analyzed: false, audioCount: 2, expectedParts: 2, refined: false }] } });
  await loadHistory();
  const [item] = historyItems(ui);
  assert.match(item, /제목 미정 회의 \| 2026-10-23 · 2차/);
  assert.match(item, /분석 대기/);
  assert.doesNotMatch(ui['history-status'].textContent, /읽지 못한/);
});

test('옛 기록을 열고 다시 분석하면 그 보관함 경로로 저장한다', async () => {
  const id = crypto.randomUUID(), recordingId = crypto.randomUUID();
  const meeting = { id, location: 'p1', recordingId, title: '옛 회의', date: '2026-09-01', participants: '김과장', context: '옛 프로젝트 배경', transcript: '옛 회의 발언입니다.',
    minutes: { overview: '옛 요약', topics: [], decisions: [], actions: [], openQuestions: [] }, dailySequence: 1, projectName: '홈페이지 개편', audio: [{ index: 1 }], expectedParts: 1 };
  const { state, ui, openMeeting, summarize, calls, posts, lines } = fixture(null, { [`/api/meetings/p1/${id}`]: { meeting, versions: [] } });
  state.keyConfigured = true;
  await openMeeting('p1', id);
  assert.equal(state.location, 'p1');
  assert.equal(state.recordingId, recordingId);
  assert.ok(calls.includes(`/api/recordings/p1/${recordingId}/audio/1`), JSON.stringify(calls));
  assert.match(lines().join('\n'), /^프로젝트: 홈페이지 개편$/m);
  ui.transcript.value = '옛 회의 발언을 고쳤습니다.';
  assert.equal(await summarize(true), true);
  assert.ok(calls.includes(`/api/recordings/p1/${recordingId}/transcript`), JSON.stringify(calls));
  const saved = posts.find(post => post.url.startsWith('/api/meetings/'));
  assert.equal(saved.url, '/api/meetings/p1');
  assert.equal(saved.body.recordingId, recordingId);
  assert.equal('context' in saved.body, false);
  assert.equal(calls.some(url => /\/api\/(meetings|recordings)\/main/.test(url)), false);
});

test('녹음 없이 전사로만 만든 옛 회의를 다시 분석하면 같은 회의로 이어 저장한다', async () => {
  const id = crypto.randomUUID();
  const meeting = { id, location: 'p1', title: '원음 없는 옛 회의', date: '2026-09-01', participants: '', context: '옛 프로젝트 배경', transcript: '옛 전사 원문',
    minutes: { overview: '옛 요약', topics: [], decisions: [], actions: [], openQuestions: [] }, dailySequence: 1, projectName: '옛 업무' };
  const { state, ui, openMeeting, summarize, posts, calls } = fixture(null, { [`/api/meetings/p1/${id}`]: { meeting, versions: [] } });
  state.keyConfigured = true;
  await openMeeting('p1', id);
  ui.transcript.value += ' 보완된 전사';
  assert.equal(await summarize(true), true);
  const saved = posts.find(post => post.url.startsWith('/api/meetings/'));
  assert.equal(saved.url, '/api/meetings/p1');
  assert.equal(saved.body.meetingId, id);
  assert.equal('recordingId' in saved.body, false);
  assert.equal(calls.some(url => url.startsWith('/api/recordings/')), false, '없는 녹음에 전사를 저장하지 않는다');
});

test('회의명 없이 녹음·분석하면 AI 제목으로 저장한다', async () => {
  const { state, ui, summarize, posts } = fixture(() => Response.json({ minutes: { suggestedTitle: 'AI가 정한 제목', overview: '시험', topics: [], decisions: [], actions: [], openQuestions: [] } }));
  state.keyConfigured = true;
  ui.title.value = '';
  state.parts = [{ blob: new Blob(['시험 원음'], { type: 'audio/webm' }), saved: false, transcript: '', applied: false }];
  await summarize();
  const recording = posts.find(post => /^\/api\/recordings\/main\/[0-9a-f-]{36}$/.test(post.url));
  assert.ok(recording, JSON.stringify(posts.map(post => post.url)));
  assert.equal(recording.body.title, '');
  const saved = posts.find(post => post.url === '/api/meetings/main');
  assert.equal(saved.body.title, 'AI가 정한 제목');
  assert.equal(ui.title.value, 'AI가 정한 제목');
});

const mp4Head = () => Uint8Array.from([0, 0, 0, 24, ...Buffer.from('ftypM4A '), 0, 0, 0, 0, ...Buffer.from('M4A isom')]);
const webmHead = () => Uint8Array.from([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81, 0x01, 0x42, 0xf7, 0x81]);
const wavHead = () => Uint8Array.from([...Buffer.from('RIFF'), 4, 0, 0, 0, ...Buffer.from('WAVE')]);
const picked = (...files) => ({ target: { files: files.map(file => file instanceof File ? file : new File([file[2]], file[0], { type: file[1] })), value: 'C:\\fakepath\\선택' } });
// 크롬 계열(WebView2)은 파일 형식 이름을 확장자로 정한다. .m4a는 audio/x-m4a, .mp4는 video/mp4, .webm은 video/webm이다(2026-11-12 이고라이트 실측).
function heldFile(bytes, name, type) {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  class HeldFile extends File {
    slice(...args) { const part = super.slice(...args); return { arrayBuffer: () => gate.then(() => part.arrayBuffer()) }; }
    arrayBuffer() { return gate.then(() => super.arrayBuffer()); }
  }
  return { file: new HeldFile([bytes], name, { type }), release };
}
// 앞부분 읽기를 시험이 release를 부를 때까지 붙잡아 두는 파일이다. 형식을 확인하는 사이에 다른 일이 끼어드는 경우를 만든다.

test('불러온 음성 파일은 브라우저가 붙인 형식 이름과 달라도 내용대로 서버가 받는 형식으로 저장하고 전사한다', async () => {
  for (const [name, browserType, head, want] of [
    ['통화 녹음.m4a', 'audio/x-m4a', mp4Head(), 'audio/mp4'],
    ['화면 녹화.mp4', 'video/mp4', mp4Head(), 'audio/mp4'],
    ['원음-file001.webm', 'video/webm', webmHead(), 'audio/webm'],
    ['녹음.wav', 'audio/wav', wavHead(), 'audio/wav'],
    ['확장자 없는 녹음', '', mp4Head(), 'audio/mp4'],
    ['이름만 wav.wav', 'audio/wav', mp4Head(), 'audio/mp4'],
  ]) {
    const { state, importAudio, finishMeeting, requests } = fixture();
    state.keyConfigured = true;
    await importAudio(picked([name, browserType, head]));
    await finishMeeting();
    const saved = requests.find(request => /^\/api\/recordings\/main\/[0-9a-f-]{36}\/audio\/1$/.test(request.url));
    assert.equal(saved?.headers['Content-Type'], want, `${name} 저장`);
    assert.deepEqual([...new Uint8Array(await saved.body.arrayBuffer())], [...head], `${name} 저장 바이트`);
    const transcribed = requests.find(request => request.url === '/api/transcribe');
    assert.equal(transcribed?.headers['Content-Type'], want, `${name} 전사`);
  }
});

test('고른 파일 중 하나라도 불러올 수 없으면 하나도 바꾸지 않고 앞서 불러온 원음과 전사를 지키며 그 파일 이름을 알린다', async () => {
  const wrongLengthWav = wavHead(); new DataView(wrongLengthWav.buffer).setUint32(4, 100, true);
  for (const [badName, badBytes] of [
    ['빈 파일.m4a', new Uint8Array(0)],
    ['짧은 파일.m4a', mp4Head().slice(0, 8)],
    ['메모.m4a', new TextEncoder().encode('음성이 아닌 메모입니다')],
    ['길이가 틀린 녹음.wav', wrongLengthWav],
  ]) {
    const { state, ui, importAudio } = fixture();
    await importAudio(picked(['통화 녹음.m4a', 'audio/x-m4a', mp4Head()]));
    ui.transcript.value = '앞서 받은 전사';
    await importAudio(picked(['회의 앞부분.m4a', 'audio/x-m4a', mp4Head()], [badName, 'audio/x-m4a', badBytes]));
    assert.deepEqual(Array.from(state.parts, part => part.blob.name), ['통화 녹음.m4a'], badName);
    assert.equal(ui.transcript.value, '앞서 받은 전사', badName);
    assert.ok(ui.status.textContent.includes(badName), `${badName}: ${ui.status.textContent}`);
  }
});

test('형식을 확인하는 동안 다른 파일을 고르면 늦게 끝난 앞선 확인으로 덮어쓰지 않는다', async () => {
  const { state, importAudio } = fixture();
  const held = heldFile(mp4Head(), '먼저 고른 통화.m4a', 'audio/x-m4a');
  const first = importAudio(picked(held.file));
  await importAudio(picked(['나중에 고른 통화.m4a', 'audio/x-m4a', mp4Head()]));
  held.release();
  await first;
  assert.deepEqual(Array.from(state.parts, part => part.blob.name), ['나중에 고른 통화.m4a']);
});

test('형식을 확인하는 동안 나중에 고른 파일이 크기 상한에 걸려 거절돼도 앞선 확인은 적용하지 않는다', async () => {
  const { state, ui, importAudio } = fixture();
  state.maxAudioBytes = 100;
  await importAudio(picked(['통화 녹음.m4a', 'audio/x-m4a', mp4Head()]));
  const held = heldFile(mp4Head(), '먼저 고른 통화.m4a', 'audio/x-m4a');
  const first = importAudio(picked(held.file));
  await importAudio(picked(['큰 통화.m4a', 'audio/x-m4a', new Uint8Array(101)]));
  held.release();
  await first;
  assert.deepEqual(Array.from(state.parts, part => part.blob.name), ['통화 녹음.m4a']);
  assert.match(ui.status.textContent, /22MB 이하/);
});

test('빈 선택은 확인 중인 불러오기를 취소하지 않는다', async () => {
  const { state, importAudio } = fixture();
  const held = heldFile(mp4Head(), '고른 통화.m4a', 'audio/x-m4a');
  const pending = importAudio(picked(held.file));
  await importAudio(picked());
  held.release();
  await pending;
  assert.deepEqual(Array.from(state.parts, part => part.blob.name), ['고른 통화.m4a']);
});

test('형식을 확인하는 동안 분석이 시작되면 불러오지 않고 지금 원음을 지킨다', async () => {
  const { state, importAudio } = fixture();
  await importAudio(picked(['통화 녹음.m4a', 'audio/x-m4a', mp4Head()]));
  const held = heldFile(mp4Head(), '새 통화.m4a', 'audio/x-m4a');
  const pending = importAudio(picked(held.file));
  state.aiController = new AbortController();
  held.release();
  await pending;
  assert.deepEqual(Array.from(state.parts, part => part.blob.name), ['통화 녹음.m4a']);
});

test('형식을 확인하는 동안 원음 저장을 시작해 마쳐도 늦게 끝난 확인으로 저장한 원음을 바꾸지 않는다', async () => {
  const { state, ui, importAudio, finishMeeting } = fixture();
  await importAudio(picked(['통화 녹음.m4a', 'audio/x-m4a', mp4Head()]));
  const held = heldFile(mp4Head(), '새 통화.m4a', 'audio/x-m4a');
  const pending = importAudio(picked(held.file));
  await finishMeeting();
  assert.equal(state.flowBusy, false);
  assert.equal(state.audioStored, true);
  assert.match(ui['workflow-status'].textContent, /음성은 저장했습니다/);
  held.release();
  await pending;
  assert.deepEqual(Array.from(state.parts, part => part.blob.name), ['통화 녹음.m4a']);
  assert.equal(state.audioStored, true);
});
// 키가 없어 분석 없이 원음 저장만 하고 끝나는 경우다. 분석이 성공하면 마지막 자동 보관도 불러오기를 버리므로 저장 시작의 취소만 따로 보려고 분석을 뺐다.

test('형식을 확인하는 동안 전사·요약을 시작해 끝내도 늦게 끝난 확인으로 지금 원음과 전사를 바꾸지 않는다', async () => {
  const { state, ui, importAudio, finishMeeting, summarize } = fixture(() => Response.json({ error: { code: 'AI_SERVER_ERROR', message: '시험 요약 오류' } }, { status: 503 }));
  await importAudio(picked(['통화 녹음.m4a', 'audio/x-m4a', mp4Head()]));
  await finishMeeting();
  assert.equal(state.audioStored, true);
  state.keyConfigured = true;
  const held = heldFile(mp4Head(), '새 통화.m4a', 'audio/x-m4a');
  const pending = importAudio(picked(held.file));
  await summarize();
  assert.equal(state.aiController, null);
  const transcript = ui.transcript.value;
  assert.match(transcript, /시험 회의 발언입니다/);
  held.release();
  await pending;
  assert.deepEqual(Array.from(state.parts, part => part.blob.name), ['통화 녹음.m4a']);
  assert.equal(ui.transcript.value, transcript);
});
// 키 없이 원음을 먼저 저장해 두고(그래야 summarize가 finishMeeting으로 넘어가지 않는다), 요약이 실패해 자동 보관까지 가지 않게 했다. 전사·요약 시작(setBusy)의 취소만 따로 본다.

test('형식을 확인하는 동안 녹음을 시작하려 했으면 마이크가 거절돼도 늦게 끝난 확인을 적용하지 않는다', async () => {
  const denied = () => Promise.reject(Object.assign(new Error('마이크 거절'), { name: 'NotAllowedError' }));
  const { state, ui, importAudio, startRecording } = fixture(null, {}, { navigator: { mediaDevices: { getUserMedia: denied } }, window: { MediaRecorder: class {} } });
  state.keyConfigured = true;
  const held = heldFile(mp4Head(), '새 통화.m4a', 'audio/x-m4a');
  const pending = importAudio(picked(held.file));
  await startRecording();
  assert.equal(state.permissionPending, false);
  assert.match(ui.status.textContent, /마이크 사용이 거절됐습니다/);
  held.release();
  await pending;
  assert.equal(state.parts.length, 0);
});
// 불러온 파일이 열린 화면에서는 녹음 시작이 '지난 회의 기록이 열려 있음'으로 막히므로 빈 화면에서 시작한다.

test('형식을 확인하는 동안 지난 회의를 열려고 했으면 열기가 실패해도 늦게 끝난 확인을 적용하지 않는다', async () => {
  const id = crypto.randomUUID();
  const { state, importAudio, openMeeting } = fixture(null, { [`/api/meetings/main/${id}`]: Response.json({ error: { message: '회의를 읽지 못했습니다.' } }, { status: 500 }) });
  await importAudio(picked(['통화 녹음.m4a', 'audio/x-m4a', mp4Head()]));
  const held = heldFile(mp4Head(), '새 통화.m4a', 'audio/x-m4a');
  const pending = importAudio(picked(held.file));
  await openMeeting('main', id);
  assert.equal(state.historyBusy, false);
  held.release();
  await pending;
  assert.deepEqual(Array.from(state.parts, part => part.blob.name), ['통화 녹음.m4a']);
});

test('형식을 확인하는 동안 화면을 비우면 늦게 끝난 확인으로 다시 채우지 않는다', async () => {
  const { state, importAudio, clearLocal } = fixture();
  await importAudio(picked(['통화 녹음.m4a', 'audio/x-m4a', mp4Head()]));
  const held = heldFile(mp4Head(), '새 통화.m4a', 'audio/x-m4a');
  const pending = importAudio(picked(held.file));
  assert.equal(clearLocal(true), true);
  held.release();
  await pending;
  assert.equal(state.parts.length, 0);
});

test('형식을 확인하는 동안 회의록을 보관하면 늦게 끝난 확인으로 보관한 화면을 바꾸지 않는다', async () => {
  const { state, ui, importAudio, finishMeeting, archiveResult } = fixture();
  state.keyConfigured = true;
  await importAudio(picked(['통화 녹음.m4a', 'audio/x-m4a', mp4Head()]));
  await finishMeeting();
  const transcript = ui.transcript.value;
  const held = heldFile(mp4Head(), '새 통화.m4a', 'audio/x-m4a');
  const pending = importAudio(picked(held.file));
  await archiveResult();
  assert.equal(state.archiveBusy, false);
  held.release();
  await pending;
  assert.deepEqual(Array.from(state.parts, part => part.blob.name), ['통화 녹음.m4a']);
  assert.equal(ui.transcript.value, transcript);
});

const successfulSummary = body => Response.json({ minutes: { overview: '전체 방향 | 기준을 정합니다.\n주요 결정 | 표준화합니다.\n다음 할 일 | 항목을 검토합니다.\n남은 쟁점 | 담당자 미정입니다.', topics: [], decisions: [...(body.previousMinutes?.decisions || []), body.text], actions: [], openQuestions: [] } });
const failedSummary = code => Response.json({ error: { code, message: '시험 한도 오류' } }, { status: 503 });

test('출력 한도에 걸린 구간만 나누고 전체 전사와 누적 결과를 보존한다', async () => {
  const { state, ui, summarize, summaryBodies } = fixture((body, count) => count === 1 ? failedSummary('AI_OUTPUT_LIMIT') : successfulSummary(body));
  state.keyConfigured = true;
  const text = ('문장을 유지합니다. 😀 다음 안건입니다.\n').repeat(250);
  ui.transcript.value = text;
  assert.equal(await summarize(true), true);
  assert.ok(summaryBodies.length > 2);
  assert.equal(summaryBodies.slice(1).map(body => body.text).join(''), text.trim());
  assert.ok(summaryBodies.slice(1).every(body => body.text.length < text.length));
  assert.equal(state.minutes.decisions.join(''), text.trim());
  assert.equal(state.resultStored, true);
});

test('분할 중 멈춰도 같은 화면에서 재시도하면 성공 구간은 다시 요청하지 않는다', async () => {
  let stopOnce = true;
  const { state, ui, summarize, summaryBodies } = fixture((body, count) => {
    if (count === 1) return failedSummary('AI_OUTPUT_LIMIT');
    if (count === 3 && stopOnce) { stopOnce = false; return failedSummary('AI_QUOTA_EXCEEDED'); }
    return successfulSummary(body);
  });
  state.keyConfigured = true; ui.transcript.value = '가'.repeat(12000);
  assert.equal(await summarize(true), false);
  assert.equal(summaryBodies.length, 3);
  assert.equal(state.resultStored, false);
  assert.equal(await summarize(true), true);
  assert.equal(summaryBodies.length, 4);
  assert.equal(summaryBodies[3].text, summaryBodies[2].text);
  assert.equal(state.minutes.decisions.join(''), ui.transcript.value);
});

for (const code of ['AI_QUOTA_EXCEEDED', 'AI_RATE_LIMIT', 'AI_UNAVAILABLE']) {
  test(`${code} 오류에는 자동 분할 재요청을 하지 않는다`, async () => {
    const { state, ui, summarize, summaryBodies } = fixture(() => failedSummary(code));
    state.keyConfigured = true; ui.transcript.value = '가'.repeat(12000);
    assert.equal(await summarize(true), false);
    assert.equal(summaryBodies.length, 1);
    assert.equal(ui.transcript.value.length, 12000);
  });
}

test('계속 출력 제한이 나면 추가 요청 상한 안에서 멈추고 전사를 보존한다', async () => {
  const { state, ui, summarize, summaryBodies } = fixture(() => failedSummary('AI_OUTPUT_LIMIT'));
  state.keyConfigured = true; ui.transcript.value = '가'.repeat(24000);
  assert.equal(await summarize(true), false);
  assert.ok(summaryBodies.length > 1 && summaryBodies.length <= 7);
  assert.equal(ui.transcript.value.length, 24000);
  assert.equal(state.resultStored, false);
});

test('일부 구간이 성공해도 자동 추가 요청은 6회를 넘지 않는다', async () => {
  const { state, ui, summarize, summaryBodies } = fixture(body => body.text.length > 3000 ? failedSummary('AI_OUTPUT_LIMIT') : successfulSummary(body));
  state.keyConfigured = true; ui.transcript.value = '가'.repeat(24000);
  assert.equal(await summarize(true), false);
  assert.equal(summaryBodies.length, 7);
  assert.equal(state.resultStored, false);
});

test('AI 제목을 화면과 저장 자료에 적용해도 결과가 오래된 것으로 처리되지 않는다', async () => {
  const { state, ui, summarize, lines } = fixture(() => Response.json({ minutes: { suggestedTitle: '문서 표준화와 개발 순서', overview: '전체 방향 | 제조지시서를 먼저 만듭니다.\n주요 결정 | JPA를 사용합니다.\n다음 할 일 | 화면을 그립니다.\n남은 쟁점 | 기준 제품 미정.', topics: [{title:'상세 설명',points:['전체 양식을 확정하기보다 먼저 사용할 화면을 검토합니다.']}], decisions: [], actions: [{task:'화면 시안 작성',owner:null,due:null}], openQuestions: ['기준 제품'] } }));
  state.keyConfigured = true; ui.transcript.value = '제조지시서부터 개발합니다.';
  assert.equal(await summarize(true), true);
  assert.equal(ui.title.value, '문서 표준화와 개발 순서');
  assert.equal(state.resultStored, true);
  const output = lines().join('\n');
  const positions = ['## 핵심 요약', '## 다음 할 일', '## 상세 회의 내용', '## 합의된 방향', '## 상세 설명', '## 미확정 사항'].map(title => output.indexOf(title));
  assert.ok(positions.every(position => position >= 0), '회의록 절이 모두 있어야 합니다');
  assert.deepEqual(positions, [...positions].sort((a, b) => a - b), '핵심 요약 다음에 다음 할 일이 와야 합니다');
  assert.match(output, /전체 양식을 확정하기보다/);
});
test('수동 재분석 경로도 음성을 저장한 다음 AI를 호출한다', async () => {
  const { state, ui, summarize, calls } = fixture();
  state.keyConfigured = true;
  state.parts = [{ blob: new Blob(['시험 원음'], { type: 'audio/webm' }), saved: true, transcript: '', applied: false }];
  await summarize();
  const aiIndex = calls.indexOf('/api/transcribe');
  const audioIndex = calls.findIndex(url => /\/recordings\/main\/[^/]+\/audio\/1$/.test(url));
  assert.ok(audioIndex >= 0 && aiIndex > audioIndex, JSON.stringify(calls));
  assert.equal(state.audioStored, true);
  assert.equal(state.resultStored, true);
  const transcriptIndex = calls.findIndex(url => /\/recordings\/main\/[^/]+\/transcript$/.test(url));
  assert.ok(transcriptIndex > aiIndex && transcriptIndex < calls.indexOf('/api/summary'));
});
test('사용자가 붙여넣은 14977자 전사로 다시 분석하면 음성을 재전사하지 않는다', async () => {
  const { state, ui, summarize, calls } = fixture();
  state.keyConfigured = true;
  state.audioStored = true;
  state.recordingId = crypto.randomUUID();
  state.parts = [{ blob: new Blob(['audio'], { type: 'audio/webm' }), saved: true, applied: false }];
  ui.transcript.value = '가'.repeat(14977);
  await summarize(true);
  assert.equal(calls.includes('/api/transcribe'), false);
  assert.equal(calls.includes('/api/summary'), true);
  assert.equal(ui.transcript.value.length, 14977);
  assert.equal(state.resultStored, true);
});
test('독립 창 종료 상태는 녹음과 저장하지 않은 내용을 구분한다', () => {
  const { state, ui, closeStatus } = fixture();
  assert.equal(closeStatus().unsaved, false);
  state.recorders.add({});
  assert.equal(closeStatus().unsaved, true);
  state.recorders.clear();
  state.parts = [{ blob: new Blob(['audio']), saved: false }];
  assert.equal(closeStatus().unsaved, true);
  state.parts[0].saved = true;
  assert.equal(closeStatus().unsaved, false);
  ui.transcript.value = '아직 저장하지 않은 발언';
  state.notesSaved = false;
  assert.equal(closeStatus().unsaved, true);
});
test('29956자 전사는 두 구간으로 보내고 첫 요약을 다음 요청에 연결한다', async () => {
  const { state, ui, summarize, summaryBodies } = fixture();
  state.keyConfigured = true;
  const transcript = '문서 표준 항목을 확인합니다. '.repeat(2000).slice(0,29956).trim();
  ui.transcript.value = transcript;
  await summarize(true);
  assert.equal(summaryBodies.length, 2);
  assert.equal(summaryBodies.map(x => x.text).join(''), transcript);
  assert.ok(summaryBodies.every(x => x.text.length <= 24000));
  assert.equal(summaryBodies[0].previousMinutes, null);
  assert.equal(summaryBodies[1].previousMinutes.overview, '시험');
  assert.equal(state.resultStored, true);
});

test('회의록 내보내기는 전사와 상세 메모를 제외하고 내부 복원 자료는 보존한다', () => {
  const { state, ui, lines, exportDocument, documentObject } = fixture();
  ui.transcript.value = '공유하지 않는 전사 발언';
  ui['meeting-notes'].value = '내부 참고 배경';
  state.parts = [{ transcript: '분할 전사 발언' }];
  state.minutes = { overview: '핵심 내용', topics: [{ title: '검토', points: ['이유와 결과를 연결한 설명입니다.'] }], decisions: ['합의 내용'], actions: [], openQuestions: [] };
  const exported = JSON.stringify(exportDocument());
  assert.doesNotMatch(exported, /전사 발언|내부 참고 배경|partTranscripts|transcript|context/);
  assert.doesNotMatch(lines().join('\n'), /전사 발언|내부 참고 배경/);
  assert.match(lines().join('\n'), /이유와 결과를 연결한 설명입니다\./);
  assert.equal(documentObject().transcript, ui.transcript.value);
  assert.equal(documentObject().partTranscripts[0].transcript, '분할 전사 발언');
});

const longResult = { suggestedTitle: '긴 회의', overview: `전체 방향 | ${'가'.repeat(3000)}`, topics: [{ title: '주제', points: ['나'.repeat(1000)] }], decisions: ['결정 내용'], actions: [{ task: '할 일', owner: '김과장', due: null }], openQuestions: ['미정 사항'] };
const shortened = body => Response.json({ minutes: { ...body.minutes, overview: '전체 방향 | 짧게', topics: [{ title: '주제', points: ['짧은 문단'] }] } });
const compactFailure = () => Response.json({ error: { code: 'AI_UNAVAILABLE', message: '시험 장애' } }, { status: 503 });
function analyzeLong(compact) {
  const compactBodies = [];
  const view = fixture(() => Response.json({ minutes: longResult }), { '/api/summary/compact': body => { compactBodies.push(body); return compact(body, view); } });
  view.state.keyConfigured = true;
  view.ui.transcript.value = '회의 발언입니다.';
  view.ui.participants.value = '김과장, 이대리';
  return { ...view, compactBodies };
}
const savedMeeting = posts => posts.find(post => post.url === '/api/meetings/main').body;

test('결과가 목표보다 길면 한 번 줄여서 저장한다', async () => {
  const { state, ui, summarize, compactBodies, posts } = analyzeLong(shortened);
  assert.equal(await summarize(true), true);
  assert.equal(compactBodies.length, 1);
  assert.equal(compactBodies[0].targetCharacters, 2984);
  assert.equal(compactBodies[0].participants, '김과장, 이대리');
  assert.equal(compactBodies[0].outputFormat, 'meeting');
  assert.deepEqual(compactBodies[0].minutes, longResult);
  assert.equal('text' in compactBodies[0], false);
  assert.equal(state.minutes.overview, '전체 방향 | 짧게');
  assert.equal(savedMeeting(posts).minutes.overview, '전체 방향 | 짧게');
  assert.equal(state.resultStored, true);
  assert.doesNotMatch(ui.status.textContent, /길이를 줄이지 못해/);
});

test('결과가 목표 안이면 줄이기 요청을 보내지 않는다', async () => {
  const { state, ui, summarize, calls } = fixture();
  state.keyConfigured = true;
  ui.transcript.value = '회의 발언입니다.';
  assert.equal(await summarize(true), true);
  assert.equal(calls.includes('/api/summary/compact'), false);
});

test('줄이기가 실패해도 전체 결과를 저장하고 알린다', async () => {
  const { state, ui, summarize, posts } = analyzeLong(compactFailure);
  assert.equal(await summarize(true), true);
  assert.equal(state.minutes.overview, longResult.overview);
  assert.equal(state.resultStored, true);
  assert.equal(savedMeeting(posts).minutes.overview, longResult.overview);
  assert.match(ui.status.textContent, /길이를 줄이지 못해/);
  assert.match(ui['workflow-status'].textContent, /길이를 줄이지 못해/);
  assert.match(ui['workflow-status'].textContent, /의견 칸에 요청을 적고/);
});

test('모델이 줄이지 못한 답을 주면 실패로 알리고 다음 분석에서 다시 시도한다', async () => {
  let attempts = 0;
  const { state, ui, summarize, compactBodies, summaryBodies } = analyzeLong(body => (++attempts === 1 ? Response.json({ minutes: body.minutes, shortened: false }) : shortened(body)));
  ui.title.value = '긴 회의';
  assert.equal(await summarize(true), true);
  assert.equal(state.minutes.overview, longResult.overview);
  assert.match(ui['workflow-status'].textContent, /길이를 줄이지 못해/);
  assert.equal(await summarize(true), true);
  assert.equal(summaryBodies.length, 1);
  assert.equal(compactBodies.length, 2, '효과 없던 줄이기는 성공으로 재사용하지 않는다');
  assert.equal(state.minutes.overview, '전체 방향 | 짧게');
  assert.doesNotMatch(ui['workflow-status'].textContent, /길이를 줄이지 못해/);
});

test('줄이는 중에 멈추면 저장하지 않는다', async () => {
  const { state, summarize, posts } = analyzeLong((body, view) => { view.state.aiController.abort(); return compactFailure(); });
  assert.equal(await summarize(true), false);
  assert.equal(state.resultStored, false);
  assert.equal(posts.some(post => post.url === '/api/meetings/main'), false);
});

test('줄이는 중에 입력을 고치면 저장하지 않고 고친 내용을 유지한다', async () => {
  const { state, ui, summarize } = analyzeLong((body, view) => { view.ui.title.value = '고친 제목'; return shortened(body); });
  assert.equal(await summarize(true), false);
  assert.equal(state.resultStored, false);
  assert.equal(ui.title.value, '고친 제목');
});

test('같은 화면에서 다시 분석하면 성공한 요약은 재사용하고 줄이기만 다시 한다', async () => {
  let attempts = 0;
  const { summarize, summaryBodies, compactBodies, state, ui } = analyzeLong(body => (++attempts === 1 ? compactFailure() : shortened(body)));
  ui.title.value = '긴 회의';
  assert.equal(await summarize(true), true);
  assert.equal(await summarize(true), true);
  assert.equal(summaryBodies.length, 1);
  assert.equal(compactBodies.length, 2);
  assert.equal(state.minutes.overview, '전체 방향 | 짧게');
  assert.equal(await summarize(true), true);
  assert.equal(compactBodies.length, 2, '성공한 줄이기는 다시 요청하지 않는다');
});

test('의견 반영과 내 형식의 정의를 줄이기 요청에도 싣는다', async () => {
  const custom = { name: '주간', sections: [{ key: 'overview', title: '요약' }, { key: 'topics', title: '내용' }], instruction: '' };
  const { state, ui, summarize, compactBodies } = analyzeLong(shortened);
  ui['output-format'].value = 'custom';
  state.meetingCustom = custom;
  assert.equal(await summarize(true, '일정을 자세히'), true);
  assert.equal(compactBodies[0].feedback, '일정을 자세히');
  assert.equal(compactBodies[0].outputFormat, 'custom');
  assert.deepEqual(compactBodies[0].customFormat, custom);
});

test('전사 요청에 참석자 이름 힌트를 보낸다', async () => {
  const { state, ui, summarize, requests } = fixture();
  state.keyConfigured = true;
  ui.participants.value = '김철수, <이영희>';
  state.parts = [{ blob: new Blob(['시험 원음'], { type: 'audio/webm' }), saved: false, transcript: '', applied: false }];
  await summarize();
  const sent = requests.find(request => request.url === '/api/transcribe');
  assert.equal(decodeURIComponent(sent.headers['X-Transcribe-Keywords']), '김철수,이영희');
});

test('참석자가 없으면 힌트를 보내지 않는다', async () => {
  const { state, summarize, requests } = fixture();
  state.keyConfigured = true;
  state.parts = [{ blob: new Blob(['시험 원음'], { type: 'audio/webm' }), saved: false, transcript: '', applied: false }];
  await summarize();
  const sent = requests.find(request => request.url === '/api/transcribe');
  assert.equal('X-Transcribe-Keywords' in sent.headers, false);
});

const I = (text, details = []) => ({ text, details });
const walk = node => [node, ...(node.children || []).flatMap(walk)];
const rendered = (renderMinutesInto, minutes, format, custom) => {
  const root = { children: [], append(...items) { this.children.push(...items); } };
  renderMinutesInto(root, minutes, format, custom);
  return walk(root);
};
const itemTrees = nodes => nodes.filter(node => node.tagName === 'UL' && node.className === 'minutes-items').flatMap(list => list.children.map(li => {
  assert.equal(li.tagName, 'LI');
  const [text, details] = li.children;
  if (details) { assert.equal(details.tagName, 'UL'); for (const detail of details.children) assert.equal(detail.tagName, 'LI'); }
  return I(text.textContent, (details?.children || []).map(detail => detail.textContent));
}));
const itemMinutes = { suggestedTitle: '합성', overview: [I('전체 방향', ['공통 양식부터 정리함']), I('주요 결정', ['시안 A 사용'])],
  topics: [{ title: '양식', points: [I('공통 양식 쓰기로 함', ['이유: 서식 혼선'])] }], decisions: [I('양식 — 공통 양식 사용', ['적용: 모든 부서'])],
  actions: [{ task: '초안 만들기', owner: '김민수', due: '11월 20일' }], openQuestions: [I('배포 시점', ['정해지지 않음'])] };
const oldMinutes = { overview: Array.from({ length: 13 }, (_, i) => `줄 ${i + 1}`).join('\n'), topics: [{ title: '긴 내용', points: ['가'.repeat(2000)] }],
  decisions: ['- 결정'], actions: [{ task: '정리하기', owner: '박서연', due: '금요일' }], openQuestions: ['미정'] };
const itemCustom = { name: '주간', sections: [{ key: 'overview', title: '요약' }, { key: 'decisions', title: '결정' }, { key: 'topics', title: '논의' }, { key: 'openQuestions', title: '남은 것' }, { key: 'actions', title: '할 일' }], instruction: '' };

test('세 형식과 내 형식이 핵심 요약·주제·결정·미확정을 ul/li와 그 li 안의 ul로 그린다', () => {
  const { renderMinutesInto } = fixture();
  for (const [format, custom] of [['meeting'], ['summary'], ['tasks'], ['custom', itemCustom]]) {
    const nodes = rendered(renderMinutesInto, itemMinutes, format, custom);
    const trees = itemTrees(nodes);
    for (const expected of [I('전체 방향', ['공통 양식부터 정리함']), I('공통 양식 쓰기로 함', ['이유: 서식 혼선']), I('양식 — 공통 양식 사용', ['적용: 모든 부서']), I('배포 시점', ['정해지지 않음'])])
      assert.ok(trees.some(tree => JSON.stringify(tree) === JSON.stringify(expected)), `${format}: ${expected.text}`);
    assert.equal(nodes.some(node => node.tagName === 'P' && /공통 양식|배포 시점|전체 방향/.test(node.textContent)), false, `${format}: 결과를 문단으로 그리면 안 됨`);
  }
});

test('옛 문자열 결과도 항목 하나씩 li로 그린다(13줄 핵심 요약은 13개, 2000자 문단은 자르지 않음)', () => {
  const { renderMinutesInto } = fixture();
  const trees = itemTrees(rendered(renderMinutesInto, oldMinutes, 'meeting'));
  for (let i = 1; i <= 13; i++) assert.ok(trees.some(tree => tree.text === `줄 ${i}`), `줄 ${i}`);
  assert.ok(trees.some(tree => tree.text === '가'.repeat(2000)));
  assert.ok(trees.some(tree => tree.text === '결정'), '앞 글머리표는 떼고 그린다');
  assert.ok(trees.some(tree => tree.text === '미정'));
});

test('위쪽 복사 글은 항목을 •, 하위 항목을 두 칸 들인 - 로 쓰고 여러 줄 본문의 이어지는 줄은 항목 깊이로 들여 쓴다', () => {
  const { state, lines, plainText } = fixture();
  state.minutes = { ...itemMinutes, decisions: [I('여러 줄 결정\n이어지는 줄', ['하위'])] };
  const text = plainText(lines());
  assert.match(text, /^• 여러 줄 결정$/m);
  assert.match(text, /^ {2}이어지는 줄$/m);
  assert.match(text, /^ {2}- 하위$/m);
  assert.match(text, /^• 배포 시점$/m);
  assert.doesNotMatch(text, /^(?:• |- | {2}- )이어지는 줄$/m);
});

test('아래쪽 md 저장 글은 같은 기록의 회의문서.cjs markdown과 같다(네 형식, 옛·새 구조)', () => {
  const { markdown } = require('./회의문서.cjs');
  for (const minutes of [itemMinutes, oldMinutes]) for (const format of ['meeting', 'summary', 'tasks', 'custom']) {
    const { state, ui, lines } = fixture();
    ui['output-format'].value = format;
    if (format === 'custom') state.customFormat = itemCustom;
    ui.participants.value = '김민수';
    state.dailySequence = 1;
    state.minutes = minutes;
    const record = { title: ui.title.value, date: ui.date.value, dailySequence: 1, participants: '김민수', outputFormat: format, ...(format === 'custom' ? { customFormat: itemCustom } : {}), minutes };
    assert.equal(lines().join('\n'), markdown(record), `${format} ${minutes === oldMinutes ? '옛 구조' : '새 구조'}`);
  }
});

test('JSON 저장은 옛 결과도 원본 그대로 내고 화면 그리기·복사 글 만들기도 원본을 바꾸지 않는다', () => {
  const { state, exportDocument, lines, plainText, renderMinutesInto } = fixture();
  const snapshot = JSON.stringify(oldMinutes);
  state.minutes = JSON.parse(snapshot);
  // 기대값은 호출 전에 글로 고정한다. 상태와 같은 객체를 기대값으로 쓰면 원본을 바꾸는 구현도 통과한다(짝보고 8).
  rendered(renderMinutesInto, state.minutes, 'meeting');
  plainText(lines());
  assert.equal(JSON.stringify(exportDocument().minutes), snapshot);
  assert.equal(JSON.stringify(state.minutes), snapshot);
  assert.equal(typeof exportDocument().minutes.overview, 'string');
});

// 회의 종료·불러오기 뒤 '회의록까지 만들기'와 '전사까지만'을 고르는 창(tm 37)
const recorded = () => ({ blob: new Blob(['시험 원음'], { type: 'audio/webm' }), saved: false, transcript: '', applied: false });
const transcriptSaves = posts => posts.filter(post => /^\/api\/recordings\/main\/[0-9a-f-]{36}\/transcript$/.test(post.url));
const count = (calls, url) => calls.filter(item => item === url).length;
const waitFor = async (check) => { for (let i = 0; i < 200 && !check(); i++) await new Promise(resolve => setTimeout(resolve, 5)); };
const failed = message => Response.json({ error: { message } }, { status: 500 });
const TRANSCRIBED = '전사를 저장했습니다. 회의록이 필요하면 정리본 탭의 ‘회의록 만들기’를 누르세요.';

test('회의 종료 뒤 전사까지만을 고르면 전사를 녹음에 저장하고 요약은 요청하지 않는다', async () => {
  const { state, ui, finishMeeting, calls, posts, choices } = fixture(null, {}, { finishMode: 'transcript' });
  state.keyConfigured = true;
  state.parts = [recorded()];
  await finishMeeting();
  assert.deepEqual(choices, ['음성은 저장했습니다.']);
  assert.equal(count(calls, '/api/transcribe'), 1);
  assert.equal(count(calls, '/api/summary'), 0);
  assert.deepEqual(transcriptSaves(posts).map(post => post.body), [{ text: '시험 회의 발언입니다.' }]);
  assert.equal(count(calls, '/api/trial/finish'), 1);
  assert.equal(calls.includes('/api/meetings/main'), false, '회의록을 보관하지 않는다');
  assert.equal(ui['workflow-status'].textContent, TRANSCRIBED);
  assert.equal(ui['retry-analysis'].hidden, true);
});

test('회의 종료 뒤 회의록까지를 고르면 저장→전사→전사 저장→요약→결과 저장 순서로 한다', async () => {
  const { state, finishMeeting, calls, posts, choices } = fixture();
  state.keyConfigured = true;
  state.parts = [recorded()];
  await finishMeeting();
  assert.deepEqual(choices, ['음성은 저장했습니다.']);
  const at = pattern => calls.findIndex(url => pattern.test(url));
  const order = [at(/\/recordings\/main\/[^/]+\/audio\/1$/), calls.indexOf('/api/transcribe'), at(/\/recordings\/main\/[^/]+\/transcript$/), calls.indexOf('/api/summary'), calls.indexOf('/api/meetings/main')];
  assert.ok(order.every((value, index) => value >= 0 && (index === 0 || value > order[index - 1])), JSON.stringify(calls));
  assert.deepEqual(transcriptSaves(posts).map(post => post.body), [{ text: '시험 회의 발언입니다.' }]);
});

test('고르는 창을 닫으면 AI 요청 없이 음성만 저장하고 다시 시도 단추를 보인다', async () => {
  const { state, ui, finishMeeting, calls, choices } = fixture(null, {}, { finishMode: null });
  state.keyConfigured = true;
  state.parts = [recorded()];
  await finishMeeting();
  assert.equal(choices.length, 1);
  assert.equal(state.audioStored, true);
  assert.equal(count(calls, '/api/transcribe') + count(calls, '/api/summary'), 0);
  assert.equal(ui['retry-analysis'].hidden, false);
  assert.equal(ui['workflow-status'].textContent, '음성은 저장했습니다. 회의록이나 전사가 필요하면 ‘저장·분석 다시 시도’를 누르세요.');
});

test('전사가 이미 있으면 창 없이 회의록을 만든다', async () => {
  const { state, ui, finishMeeting, calls, choices } = fixture();
  state.keyConfigured = true;
  state.parts = [{ ...recorded(), saved: true, applied: true, transcript: '이미 받은 전사' }];
  state.audioStored = true; state.recordingStored = true; state.recordingId = crypto.randomUUID(); state.location = 'main';
  ui.transcript.value = '이미 받은 전사';
  await finishMeeting();
  assert.equal(choices.length, 0);
  assert.equal(count(calls, '/api/transcribe'), 0);
  assert.equal(count(calls, '/api/summary'), 1);
});

test('원음을 불러온 뒤 저장·분석 다시 시도를 누르면 저장한 뒤 고르는 창이 뜬다', async () => {
  const { state, importAudio, finishMeeting, calls, choices } = fixture(null, {}, { finishMode: 'transcript' });
  state.keyConfigured = true;
  await importAudio(picked(['통화 녹음.m4a', 'audio/x-m4a', mp4Head()]));
  await finishMeeting();
  assert.deepEqual(choices, ['음성은 저장했습니다.']);
  assert.ok(calls.some(url => /\/recordings\/main\/[^/]+\/audio\/1$/.test(url)));
  assert.equal(count(calls, '/api/transcribe'), 1);
  assert.equal(count(calls, '/api/summary'), 0);
});

test('전사까지만에서 전사 요청이 실패하면 체험 예약을 돌려주고 다시 시도는 창 없이 전사만 이어 간다', async () => {
  let fail = true;
  const { state, finishMeeting, calls, posts, choices } = fixture(null, { '/api/transcribe': () => fail ? failed('전사 실패') : Response.json({ text: '다시 받은 전사' }) }, { finishMode: 'transcript' });
  state.keyConfigured = true;
  state.parts = [recorded()];
  await finishMeeting();
  assert.equal(count(calls, '/api/trial/release'), 1);
  assert.equal(transcriptSaves(posts).length, 0);
  fail = false;
  await finishMeeting();
  assert.equal(choices.length, 1, '다시 시도는 고른 방식을 이어 간다');
  assert.equal(count(calls, '/api/transcribe'), 2);
  assert.equal(count(calls, '/api/summary'), 0);
  assert.deepEqual(transcriptSaves(posts).map(post => post.body), [{ text: '다시 받은 전사' }]);
});

test('전사까지만에서 전사 저장이 실패해도 다시 시도는 요약하지 않고 전사 저장만 다시 한다', async () => {
  let fail = true;
  const id = crypto.randomUUID(), route = `/api/recordings/main/${id}/transcript`;
  const { state, finishMeeting, calls, choices, closeStatus } = fixture(null, { [route]: () => fail ? failed('저장 실패') : Response.json({}) }, { finishMode: 'transcript' });
  state.keyConfigured = true; state.location = 'main'; state.recordingId = id;
  state.parts = [recorded()];
  await finishMeeting();
  assert.equal(count(calls, '/api/transcribe'), 1);
  assert.equal(closeStatus().unsaved, true, '보관하지 못한 전사는 미저장으로 남는다');
  fail = false;
  await finishMeeting();
  assert.equal(choices.length, 1);
  assert.equal(count(calls, '/api/transcribe'), 1, '받은 전사를 다시 요청하지 않는다');
  assert.equal(count(calls, '/api/summary'), 0);
  assert.equal(count(calls, route), 2);
  assert.equal(closeStatus().unsaved, false);
});

test('전사만 저장이 끝나면 미저장 경고가 없고 전사를 고치면 다시 생긴다', async () => {
  const { state, ui, finishMeeting, bind, closeStatus } = fixture(null, {}, { finishMode: 'transcript' });
  bind();
  state.keyConfigured = true;
  state.parts = [recorded()];
  await finishMeeting();
  assert.equal(closeStatus().unsaved, false);
  ui.transcript.value += ' 고친 내용';
  ui.transcript.dispatch('input');
  assert.equal(closeStatus().unsaved, true);
});

test('전사만 저장 뒤 회의록 만들기가 실패해도 다시 시도는 전사를 다시 하지 않고 요약을 다시 요청한다', async () => {
  let failing = true;
  const { state, ui, finishMeeting, calls } = fixture(() => failing ? failed('요약 실패') : Response.json({ minutes: { overview: '시험', topics: [], decisions: [], actions: [], openQuestions: [] } }), {}, { finishMode: 'transcript' });
  state.keyConfigured = true;
  state.parts = [recorded()];
  await finishMeeting();
  const make = walk(ui.minutes).find(node => node.tagName === 'BUTTON' && String(node.className).includes('make-minutes'));
  make.click();
  await waitFor(() => count(calls, '/api/summary') === 1 && !state.aiController);
  assert.equal(ui['retry-analysis'].hidden, false);
  failing = false;
  await finishMeeting();
  assert.equal(count(calls, '/api/transcribe'), 1, '전사는 다시 요청하지 않는다');
  assert.equal(count(calls, '/api/summary'), 2, '다시 시도는 요약을 다시 요청한다');
  assert.ok(state.minutes);
  assert.equal(state.resultStored, true);
});

test('고르는 창이 열려 있는 동안과 원음 저장 전에는 AI를 요청하지 않고 한 번 고르면 분석은 한 번만 시작한다', async () => {
  const id = crypto.randomUUID();
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const { state, ui, finishMeeting, calls, choices, focused } = fixture(null, { [`/api/recordings/main/${id}/audio/1`]: () => gate.then(() => Response.json({})) }, { finishMode: 'manual' });
  state.keyConfigured = true; state.location = 'main'; state.recordingId = id;
  state.parts = [recorded()];
  const running = finishMeeting();
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(choices.length, 0, '원음 저장 전에는 창을 띄우지 않는다');
  release();
  await waitFor(() => ui['finish-choice'].open);
  assert.equal(ui['finish-choice'].open, true);
  assert.equal(focused(), ui['finish-minutes'], '처음 초점은 회의록까지 만들기');
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(count(calls, '/api/transcribe') + count(calls, '/api/summary'), 0, '고르기 전에는 AI를 부르지 않는다');
  ui['finish-transcript'].click();
  ui['finish-minutes'].click();
  await running;
  assert.equal(count(calls, '/api/transcribe'), 1);
  assert.equal(count(calls, '/api/summary'), 0);
  assert.equal(ui['finish-choice'].open, false);
});

test('summarize 우회 경로에서도 회의록까지·전사까지만·닫기가 각각 동작한다', async () => {
  for (const [mode, transcribed, summarized] of [['minutes', 1, 1], ['transcript', 1, 0], [null, 0, 0]]) {
    const { state, summarize, calls, choices } = fixture(null, {}, { finishMode: mode });
    state.keyConfigured = true;
    state.parts = [recorded()];
    await summarize();
    assert.equal(choices.length, 1, String(mode));
    assert.equal(count(calls, '/api/transcribe'), transcribed, String(mode));
    assert.equal(count(calls, '/api/summary'), summarized, String(mode));
  }
});

test('실제 등록(bind)을 거친 고르는 창은 닫기 단추와 배경 누르기로 닫히고 AI를 부르지 않으며 초점이 회의 준비로 돌아간다', async () => {
  for (const how of ['닫기 단추', '배경']) {
    const { state, ui, finishMeeting, bind, calls, focused } = fixture(null, {}, { finishMode: 'manual' });
    bind();
    state.keyConfigured = true;
    state.parts = [recorded()];
    const running = finishMeeting();
    await waitFor(() => ui['finish-choice'].open);
    if (how === '닫기 단추') ui['finish-choice'].dispatch('click', { target: { closest: selector => selector === '[data-close]' ? {} : null } });
    else ui['finish-choice'].click();
    await Promise.race([running, new Promise(resolve => setTimeout(resolve, 1000))]);
    // 등록이 빠져 창이 닫히지 않으면 회의 종료가 끝나지 않으므로 기다리지 않고 실패로 알린다.
    assert.equal(ui['finish-choice'].open, false, how);
    assert.equal(count(calls, '/api/transcribe') + count(calls, '/api/summary'), 0, how);
    assert.equal(focused(), ui.prepare, how);
  }
});

test('키가 없으면 고르는 창을 띄우지 않는다', async () => {
  const { state, finishMeeting, calls, choices } = fixture();
  state.keyConfigured = false;
  state.parts = [recorded()];
  await finishMeeting();
  assert.equal(state.audioStored, true);
  assert.equal(choices.length, 0);
  assert.equal(count(calls, '/api/transcribe') + count(calls, '/api/summary'), 0);
});

// 전사만 저장한 회의의 목록 꼬리표와 정리본 탭의 회의록 만들기(tm 37)
const draftMeeting = (extra = {}) => ({ id: extra.id, location: 'main', title: '고객 응답 회의', date: '2026-11-17', participants: '김민수, 박서연', transcript: '전사만 저장한 발언입니다.',
  minutes: null, dailySequence: 1, outputFormat: 'meeting', audio: [{ index: 1 }], expectedParts: 1, ...extra });

test('전사만 저장한 회의는 목록에 전사만으로 보이고 음성만 있는 회의는 분석 대기 그대로다', async () => {
  const { ui, loadHistory } = fixture(null, { '/api/meetings': { skipped: 0, meetings: [
    { location: 'main', id: crypto.randomUUID(), title: '첫 회의', date: '2026-11-17', dailySequence: 1, outputFormat: 'meeting', analyzed: false, transcribed: true, audioCount: 1, expectedParts: 1, refined: false },
    { location: 'main', id: crypto.randomUUID(), title: '둘째 회의', date: '2026-11-17', dailySequence: 2, outputFormat: 'meeting', analyzed: false, audioCount: 1, expectedParts: 1, refined: false }] } });
  await loadHistory();
  const [heard, blank] = historyItems(ui);
  assert.match(heard, /1차 · 전사만 · 음성 1개/);
  assert.match(blank, /2차 · 분석 대기 · 음성 1개/);
});

test('전사만 저장한 회의를 열면 정리본 탭에 안내와 회의록 만들기 단추가 보이고 누르면 요약만 요청한다', async () => {
  const id = crypto.randomUUID();
  const { state, ui, openMeeting, calls } = fixture(null, { [`/api/meetings/main/${id}`]: { meeting: draftMeeting({ id }), versions: [] } });
  state.keyConfigured = true;
  await openMeeting('main', id);
  assert.equal(state.resultTab, 'minutes');
  assert.ok(texts(ui.minutes).includes('전사만 저장한 회의입니다. 전사문은 옆 ‘전사문’ 탭에 있습니다.'), JSON.stringify(texts(ui.minutes)));
  const make = walk(ui.minutes).find(node => node.tagName === 'BUTTON' && String(node.className).includes('make-minutes'));
  assert.equal(make?.textContent, '회의록 만들기');
  make.click();
  make.click();
  await waitFor(() => state.resultStored);
  assert.equal(count(calls, '/api/transcribe'), 0, '저장된 전사를 다시 쓴다');
  assert.equal(count(calls, '/api/summary'), 1, '빠르게 두 번 눌러도 요약은 한 번');
  assert.ok(calls.includes('/api/meetings/main'));
});

test('음성만 있는 회의의 정리본 안내는 실제 상자 이름을 가리킨다', async () => {
  const id = crypto.randomUUID();
  const { state, ui, openMeeting } = fixture(null, { [`/api/meetings/main/${id}`]: { meeting: draftMeeting({ id, transcript: '' }), versions: [] } });
  await openMeeting('main', id);
  assert.equal(state.resultTab, 'minutes');
  assert.deepEqual(texts(ui.minutes), ['아직 회의록이 없습니다. 전사문 탭의 ‘전사 고치기 · 다시 분석’에서 분석을 요청할 수 있습니다.']);
  assert.equal(walk(ui.minutes).some(node => String(node.className).includes('make-minutes')), false);
});

// ── 진행 기록(B안): 분석 흐름이 AI 요청 보냄·받음·실패·저장 줄을 차례로 남기는지 검증한다.
const activityLines = state => (state.activity ? state.activity.entries.map(entry => entry.text) : []);
const failureCount = state => (state.activity ? state.activity.entries.filter(entry => ['timeout', 'uploadStall', 'requestStall', 'disconnected', 'apiError', 'badFormat', 'saveFailed', 'failed', 'canceled'].includes(entry.type)).length : 0);
const spoken = '시험 회의 발언입니다.';
const abortable = options => new Promise((resolve, reject) => options.signal.addEventListener('abort', () => reject(new DOMException('요청 취소', 'AbortError'))));

test('보통 분석은 음성 저장·전사·회의록·저장 줄을 차례로 남긴다', async () => {
  const { state, finishMeeting } = fixture();
  state.keyConfigured = true;
  state.parts = [recorded(), recorded()];
  await finishMeeting();
  assert.deepEqual(activityLines(state), [
    '음성 저장함 · 1/2개', '음성 저장함 · 2/2개',
    '전사 요청 보냄 · 조각 1/2 · 0.1MB', `전사 받음 · 조각 1/2 · ${spoken.length}자`,
    '전사 요청 보냄 · 조각 2/2 · 0.1MB', `전사 받음 · 조각 2/2 · ${spoken.length}자`,
    '회의록 정리 요청 보냄 · 구간 1/1', '회의록 정리 받음 · 구간 1/1', '회의록 저장함']);
  assert.equal(state.activity.open, null);
});

test('받아 둔 전사·회의록은 보냄 줄이 없다', async () => {
  let transcribeCalls = 0;
  const transcriptView = fixture(null, { '/api/transcribe': () => (++transcribeCalls === 2 ? failed('전사 실패') : Response.json({ text: spoken })) });
  transcriptView.state.keyConfigured = true;
  transcriptView.state.parts = [recorded(), recorded()];
  await transcriptView.finishMeeting();
  await transcriptView.finishMeeting();
  const retried = activityLines(transcriptView.state);
  assert.ok(retried.includes('받아 둔 전사 씀 · 조각 1/2'), retried.join(' | '));
  assert.ok(!retried.includes('전사 요청 보냄 · 조각 1/2 · 0.1MB'), retried.join(' | '));
  let archiveCalls = 0;
  const minutesView = fixture(null, { '/api/meetings/main': () => (++archiveCalls === 1 ? failed('저장 실패') : Response.json({ meeting: {} })) });
  minutesView.state.keyConfigured = true;
  minutesView.ui.transcript.value = spoken;
  await minutesView.summarize(true);
  await minutesView.summarize(true);
  const reused = activityLines(minutesView.state);
  assert.ok(reused.includes('받아 둔 회의록 씀 · 구간 1/1'), reused.join(' | '));
  assert.ok(!reused.includes('회의록 정리 요청 보냄 · 구간 1/1'), reused.join(' | '));
  assert.equal(reused.at(-1), '회의록 저장함');
});

test('취소하면 마지막 줄이 분석 취소함이다', async () => {
  const { state, finishMeeting, calls } = fixture(null, { '/api/transcribe': (body, options) => abortable(options) });
  state.keyConfigured = true;
  state.parts = [recorded()];
  const running = finishMeeting();
  await waitFor(() => calls.includes('/api/transcribe') && state.aiController);
  state.aiController.abort();
  await running;
  assert.equal(activityLines(state).at(-1), '분석 취소함');
  assert.equal(failureCount(state), 1);
});

test('취소 뒤에 늦게 온 성공 응답은 받음으로 적지 않는다', async () => {
  let release = null;
  const { state, ui, summarize } = fixture(body => new Promise(resolve => { release = () => resolve(successfulSummary(body)); }));
  state.keyConfigured = true;
  ui.transcript.value = spoken;
  const running = summarize(true);
  await waitFor(() => release && state.aiController);
  state.aiController.abort();
  release();
  await running;
  const lines = activityLines(state);
  assert.ok(lines.includes('회의록 정리 요청 보냄 · 구간 1/1'), lines.join(' | '));
  assert.ok(!lines.some(line => line.startsWith('회의록 정리 받음') || line === '회의록 저장함'), lines.join(' | '));
  assert.equal(lines.at(-1), '분석 취소함');
  assert.equal(failureCount(state), 1);
});

test('시간 초과는 응답 없음 줄로 한 번만 끝난다', async () => {
  const { state, ui, summarize } = fixture(() => Response.json({ error: { code: 'AI_TIMEOUT', message: 'AI 응답 시간이 초과됐습니다. 다시 시도하면 비용이 발생할 수 있습니다.' } }, { status: 503 }));
  state.keyConfigured = true;
  ui.transcript.value = spoken;
  await summarize(true);
  assert.equal(activityLines(state).at(-1), '응답 없음 · 5분 기다린 뒤 멈춤');
  assert.equal(failureCount(state), 1);
});

test('회의록 저장에 실패하면 받음 줄 뒤에 저장 실패 줄이 한 번 온다', async () => {
  const { state, ui, summarize } = fixture(null, { '/api/meetings/main': () => failed('저장 실패') });
  state.keyConfigured = true;
  ui.transcript.value = spoken;
  await summarize(true);
  assert.deepEqual(activityLines(state).slice(-2), ['회의록 정리 받음 · 구간 1/1', '실패 · 저장하지 못함']);
  assert.equal(failureCount(state), 1);
});

test('원음 저장에 실패하면 저장 실패 줄로 끝난다', async () => {
  const { state, finishMeeting } = fixture(null, { '/api/recordings/main/rec-activity/audio/1': () => failed('원음 저장 실패') });
  state.keyConfigured = true;
  state.location = 'main';
  state.recordingId = 'rec-activity';
  state.parts = [recorded()];
  await finishMeeting();
  assert.equal(activityLines(state).at(-1), '실패 · 저장하지 못함');
  assert.equal(failureCount(state), 1);
});

test('길이 한도면 나눔 줄과 하위 구간 줄을 남긴다', async () => {
  const { state, ui, summarize } = fixture((body, count) => count === 1 ? failedSummary('AI_OUTPUT_LIMIT') : successfulSummary(body));
  state.keyConfigured = true;
  ui.transcript.value = ('문장을 유지합니다. 다음 안건입니다.\n').repeat(250);
  assert.equal(await summarize(true), true);
  const lines = activityLines(state);
  const split = lines.indexOf('길이 한도에 닿아 나눠 다시 보냄 · 구간 1');
  assert.ok(split > 0, lines.join(' | '));
  assert.equal(lines[split + 1], '회의록 정리 요청 보냄 · 구간 1-1/2');
  assert.equal(failureCount(state), 0);
  assert.equal(lines.at(-1), '회의록 저장함');
});

test('줄이기 결과를 못 쓰면 원래 길이로 저장 줄을 남긴다', async () => {
  const { state, summarize } = analyzeLong(body => Response.json({ minutes: body.minutes, shortened: false }));
  assert.equal(await summarize(true), true);
  const lines = activityLines(state);
  assert.deepEqual(lines.slice(-4), ['회의록 줄이기 요청 보냄', '회의록 줄이기 받음', '줄이기 결과를 못 써 원래 길이로 저장', '회의록 저장함']);
});

test('의견 반영은 의견 반영 줄을 쓴다', async () => {
  const { state, ui, summarize } = fixture();
  state.keyConfigured = true;
  ui.transcript.value = spoken;
  await summarize(true, '담당자를 고쳐 주세요');
  const lines = activityLines(state);
  assert.ok(lines.includes('의견 반영 요청 보냄 · 구간 1/1'), lines.join(' | '));
  assert.ok(lines.includes('의견 반영 받음 · 구간 1/1'), lines.join(' | '));
  assert.equal(state.activity.kind, 'refine');
});

test('전사만 하기는 전사 저장함으로 끝난다', async () => {
  const { state, finishMeeting } = fixture(null, {}, { finishMode: 'transcript' });
  state.keyConfigured = true;
  state.parts = [recorded()];
  await finishMeeting();
  assert.deepEqual(activityLines(state), ['음성 저장함 · 1/1개', '전사 요청 보냄 · 조각 1/1 · 0.1MB', `전사 받음 · 조각 1/1 · ${spoken.length}자`, '전사 저장함']);
});

test('승계는 그 실행에만 쓰인다', async () => {
  const { state, finishMeeting, transcribe } = fixture();
  state.keyConfigured = true;
  state.parts = [recorded()];
  await finishMeeting();
  const first = state.activity.id;
  await transcribe();
  assert.notEqual(state.activity.id, first);
  assert.deepEqual(activityLines(state), ['받아 둔 전사 씀 · 조각 1/1']);
});

// ── 진행 기록 화면: 진행 칸·결과 칸 그리기, 1초 타이머, 회의가 바뀔 때 지우기
function fakeClock(start = new Date(2026, 10, 19, 20, 42, 30).getTime()) {
  let now = start, next = 1;
  class FakeDate extends Date {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return now; }
  }
  const timers = new Map(), cleared = [];
  return { Date: FakeDate, timers, cleared, advance: ms => { now += ms; },
    setInterval: fn => { const id = next++; timers.set(id, fn); return id; },
    clearInterval: id => { cleared.push(id); timers.delete(id); } };
}
async function pendingSummary() {
  const clock = fakeClock();
  let release = null;
  const view = fixture(body => new Promise(resolve => { release = () => resolve(successfulSummary(body)); }), {}, { Date: clock.Date, setInterval: clock.setInterval, clearInterval: clock.clearInterval });
  view.state.keyConfigured = true;
  view.ui.transcript.value = spoken;
  const running = view.summarize(true);
  await waitFor(() => release);
  return { ...view, clock, running, release: () => release() };
}
const waitRow = box => box.children[1].children.at(-1);

test('분석 중에는 진행 칸과 결과 칸에 일지와 기다림 줄이 보인다', async () => {
  const view = await pendingSummary();
  for (const id of ['activity-log', 'detail-activity']) {
    assert.equal(view.ui[id].hidden, false, id);
    assert.deepEqual(texts(waitRow(view.ui[id])), ['지금', '응답 기다리는 중 · 0:00 / 최대 5:00'], id);
  }
  view.release();
  await view.running;
});

test('1초 타이머는 열린 요청이 있을 때만 돈다', async () => {
  const view = await pendingSummary();
  assert.equal(view.clock.timers.size, 1);
  view.release();
  await view.running;
  assert.equal(view.clock.timers.size, 0);
  assert.ok(view.clock.cleared.length >= 1);
});

test('tick은 기다림 줄 글만 바꾼다', async () => {
  const view = await pendingSummary();
  const list = view.ui['activity-log'].children[1];
  const before = list.children.slice();
  view.clock.advance(31_000);
  view.tickActivity();
  assert.deepEqual(list.children, before);
  assert.equal(texts(list.children.at(-1))[1], '응답 기다리는 중 · 0:31 / 최대 5:00');
  view.release();
  await view.running;
});

test('5분이 지나도 화면은 끊지 않고 늦게 받으면 받음과 저장 줄이 된다', async () => {
  const view = await pendingSummary();
  view.clock.advance(303_000);
  view.tickActivity();
  assert.equal(texts(waitRow(view.ui['activity-log']))[1], '응답 기다리는 중 · 5:03 · 제한 시간이 지나면 서버가 실패로 알려 줌');
  view.release();
  await view.running;
  assert.deepEqual(activityLines(view.state).slice(-2), ['회의록 정리 받음 · 구간 1/1', '회의록 저장함']);
});

const openedMeeting = recordingId => ({ meeting: { id: 'result-2', location: 'main', recordingId, title: '시험 회의', date: '2026-11-19', participants: '', transcript: spoken,
  minutes: { overview: '요약', topics: [], decisions: [], actions: [], openQuestions: [] }, dailySequence: 1, audio: [], expectedParts: 0 }, versions: [] });
async function analyzedThenOpen(loadedRecordingId) {
  const view = fixture(null, { '/api/meetings/main/result-2': openedMeeting(loadedRecordingId) });
  view.state.keyConfigured = true;
  view.ui.transcript.value = spoken;
  await view.summarize(true);
  Object.assign(view.state, { location: 'main', recordingId: 'rec-a', meetingId: null });
  const before = view.state.activity;
  assert.ok(before);
  await view.openMeeting('main', 'result-2');
  return { ...view, before };
}

test('다른 회의를 열면 일지를 지운다', async () => {
  const view = await analyzedThenOpen('rec-other');
  assert.equal(view.state.activity, null);
  assert.equal(view.ui['activity-log'].hidden, true);
  assert.equal(view.ui['detail-activity'].hidden, true);
});

test('같은 회의의 다른 결과 버전을 열면 일지가 남는다', async () => {
  const view = await analyzedThenOpen('rec-a');
  assert.equal(view.state.activity, view.before);
  assert.equal(view.ui['activity-log'].hidden, false);
});

test('새 회의를 시작하면 일지를 지운다', async () => {
  const view = fixture();
  view.state.keyConfigured = true;
  view.ui.transcript.value = spoken;
  await view.summarize(true);
  assert.ok(view.state.activity);
  view.resetMeetingForm();
  assert.equal(view.state.activity, null);
  assert.equal(view.ui['activity-log'].hidden, true);
  assert.equal(view.ui['detail-activity'].hidden, true);
});

// ── 끝 검토 반영: 취소가 먼저면 늦은 실패도 취소로, 새 회의로 바뀌면 일지를 지우고, 저장 줄은 실제 저장 결과를 따른다.
const heldTimeout = holder => () => new Promise(resolve => { holder.release = () => resolve(Response.json({ error: { code: 'AI_TIMEOUT', message: 'AI 응답 시간이 초과됐습니다. 다시 시도하면 비용이 발생할 수 있습니다.' } }, { status: 503 })); });

test('취소 뒤에 늦게 온 실패 응답도 실패 줄 없이 분석 취소함으로 끝난다', async () => {
  const held = {};
  const { state, ui, summarize } = fixture(heldTimeout(held));
  state.keyConfigured = true;
  ui.transcript.value = spoken;
  const running = summarize(true);
  await waitFor(() => held.release && state.aiController);
  state.aiController.abort();
  held.release();
  await running;
  const lines = activityLines(state);
  assert.deepEqual(lines.slice(-2), ['회의록 정리 요청 보냄 · 구간 1/1', '분석 취소함'], lines.join(' | '));
  assert.equal(failureCount(state), 1, lines.join(' | '));
  assert.match(ui['workflow-status'].textContent, /분석을 취소했습니다/);
});

test('전사 중 취소 뒤에 늦게 온 실패 응답도 분석 취소함으로 끝난다', async () => {
  const held = {};
  const { state, finishMeeting } = fixture(null, { '/api/transcribe': heldTimeout(held) });
  state.keyConfigured = true;
  state.parts = [recorded()];
  const running = finishMeeting();
  await waitFor(() => held.release && state.aiController);
  state.aiController.abort();
  held.release();
  await running;
  const lines = activityLines(state);
  assert.equal(lines.at(-1), '분석 취소함', lines.join(' | '));
  assert.equal(failureCount(state), 1, lines.join(' | '));
});

test('새 음성을 불러오면 앞선 회의의 일지를 지운다', async () => {
  const view = fixture();
  view.state.keyConfigured = true;
  view.ui.transcript.value = spoken;
  await view.summarize(true);
  assert.ok(view.state.activity);
  await view.importAudio(picked(['새 회의.wav', 'audio/wav', wavHead()]));
  assert.equal(view.state.parts.length, 1);
  assert.equal(view.state.activity, null);
  assert.equal(view.ui['activity-log'].hidden, true);
});

test('회의 준비를 누르면 앞선 회의의 일지를 지운다', async () => {
  const view = fixture();
  view.state.keyConfigured = true;
  view.ui.transcript.value = spoken;
  await view.summarize(true);
  assert.ok(view.state.activity);
  view.bind();
  view.ui.prepare.click();
  assert.equal(view.state.activity, null);
  assert.equal(view.ui['activity-log'].hidden, true);
});

test('새 녹음을 시작하면 앞선 회의의 일지를 지운다', async () => {
  class Recorder { static isTypeSupported() { return true; } constructor() { throw new Error('시험용 녹음기'); } }
  const view = fixture(() => failed('요약 실패'), {}, { navigator: { mediaDevices: { getUserMedia: async () => ({ getTracks: () => [] }) } }, MediaRecorder: Recorder, window: { MediaRecorder: Recorder } });
  view.state.keyConfigured = true;
  view.ui.transcript.value = spoken;
  await view.summarize(true);
  assert.ok(view.state.activity);
  view.ui.transcript.value = '';
  const before = view.state.recordingId;
  await view.startRecording();
  assert.notEqual(view.state.recordingId, before, '새 녹음 번호를 정하는 지점까지 갔다');
  assert.equal(view.state.activity, null);
});

test('저장 실패 뒤 저장 단추로 다시 저장하면 일지 끝이 회의록 저장함이 된다', async () => {
  let archiveCalls = 0;
  const { state, ui, summarize, archiveResult } = fixture(null, { '/api/meetings/main': () => (++archiveCalls === 1 ? failed('저장 실패') : Response.json({ meeting: {} })) });
  state.keyConfigured = true;
  ui.transcript.value = spoken;
  await summarize(true);
  assert.equal(activityLines(state).at(-1), '실패 · 저장하지 못함');
  await archiveResult();
  assert.equal(state.resultStored, true);
  assert.equal(activityLines(state).at(-1), '회의록 저장함');
  assert.equal(activityLines(state).filter(line => line === '회의록 저장함').length, 1);
});

test('회의록 전에 전사 원문 저장에 실패하면 저장 실패 줄로 끝난다', async () => {
  const { state, ui, summarize } = fixture(null, { '/api/recordings/main/rec-saved/transcript': () => failed('전사 저장 실패') });
  state.keyConfigured = true;
  Object.assign(state, { location: 'main', recordingId: 'rec-saved', audioStored: true });
  ui.transcript.value = spoken;
  await summarize(true);
  assert.equal(activityLines(state).at(-1), '실패 · 저장하지 못함', activityLines(state).join(' | '));
  assert.equal(failureCount(state), 1);
});

test('녹음 등록에 실패하면 저장 실패 줄로 끝난다', async () => {
  const { state, finishMeeting } = fixture(null, { '/api/recordings/main/rec-register': () => failed('녹음 등록 실패') });
  state.keyConfigured = true;
  state.location = 'main';
  state.recordingId = 'rec-register';
  state.parts = [recorded()];
  await finishMeeting();
  assert.equal(activityLines(state).at(-1), '실패 · 저장하지 못함', activityLines(state).join(' | '));
  assert.equal(failureCount(state), 1);
});

test('저장 확인 응답 본문이 깨지면 성공 줄 없이 저장 실패 줄로 끝난다', async () => {
  const { state, ui, summarize } = fixture(null, { '/api/meetings/main': () => new Response('저장 응답이 깨졌습니다', { status: 200, headers: { 'Content-Type': 'text/plain' } }) });
  state.keyConfigured = true;
  ui.transcript.value = spoken;
  await summarize(true);
  const lines = activityLines(state);
  assert.equal(state.resultStored, false);
  assert.ok(!lines.includes('회의록 저장함'), lines.join(' | '));
  assert.equal(lines.at(-1), '실패 · 저장하지 못함', lines.join(' | '));
  assert.equal(failureCount(state), 1, lines.join(' | '));
});
