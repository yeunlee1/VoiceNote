// 결과 창의 요약 평가 저장, 의견 반영 다시 정리, 결과 버전 보기, 고른 폴더 사본 상태가 요청과 화면에 맞게 이어지는지 검증한다.
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const crypto = require('node:crypto');
const { test } = require('node:test');
const assert = require('node:assert/strict');

function fixture({ routes = {}, confirmAnswer = true } = {}) {
  const element = (tag = 'div') => {
    const listeners = {};
    const node = { tag, value: '', checked: false, style: {}, hidden: false, disabled: false, open: false, textContent: '', dataset: {}, children: [], attributes: {},
      classList: { add() {}, remove() {} }, removeAttribute(name) { delete this.attributes[name]; }, setAttribute(name, value) { this.attributes[name] = value; },
      addEventListener(type, fn) { (listeners[type] ||= []).push(fn); }, dispatch(type, event = {}) { for (const fn of listeners[type] || []) fn({ target: node, ...event }); },
      querySelectorAll() { return []; }, querySelector() { return null; }, append(...items) { this.children.push(...items); }, replaceChildren(...items) { this.children = items; },
      remove() {}, focus() {}, click() { this.dispatch('click'); }, showModal() { this.open = true; }, close() { this.open = false; this.dispatch('close'); } };
    return node;
  };
  const nodes = new Map(), calls = [];
  const json = (body, status = 200) => Response.json(body, { status });
  const sandbox = { crypto, Blob, AbortController, DOMException, TextDecoder, setTimeout, clearTimeout, setInterval, clearInterval,
    confirm: () => confirmAnswer, window: { addEventListener() {}, MeetingFormats: require('./출력형식.js') },
    URL: { createObjectURL: () => 'blob:test', revokeObjectURL() {} },
    document: { body: element('body'), getElementById(id) { if (!nodes.has(id)) nodes.set(id, element()); return nodes.get(id); }, createElement: element },
    async fetch(url, options = {}) {
      calls.push({ url, options, body: typeof options.body === 'string' ? JSON.parse(options.body) : options.body });
      // 정확한 주소가 없으면 ^로 시작하는 정규식 주소를 찾는다.
      const route = routes[url] || Object.entries(routes).find(([key]) => key.startsWith('^') && new RegExp(key).test(url))?.[1];
      if (route) return route(calls.at(-1));
      if (url === '/api/summary') return json({ minutes: refinedMinutes });
      if (url.startsWith('/api/trial/')) return json({ accessMode: 'trial', trialLimit: 3, trialRemaining: 2, mustRegister: false });
      if (url === '/api/meetings') return json({ meetings: [], skipped: 0 });
      return json({});
    } };
  const original = fs.readFileSync(path.join(__dirname, '화면/app.js'), 'utf8');
  const source = original.replace(/  init\(\);\s*\}\)\(\);\s*$/,
    '  globalThis.review = { state, ui, bind, refresh, resetMeetingForm, openMeeting, summarize, saveReview, refineSummary, copyAgain };\n})();');
  assert.notEqual(source, original);
  vm.runInNewContext(source, sandbox);
  const review = sandbox.review;
  review.bind();
  const status = nodes.get('status');
  review.resetMeetingForm();
  return { ...review, calls, announce: () => status.textContent };
}
const texts = (node) => [node.textContent, ...(node.children || []).flatMap(texts)].filter(Boolean);
const settle = async () => { for (let i = 0; i < 20; i++) await new Promise((resolve) => setTimeout(resolve, 0)); };

const firstMinutes = { overview: '첫 정리 요약', topics: [{ title: '일정', points: ['금요일까지 시안을 확정합니다.'] }], decisions: ['시안 A 채택'], actions: [{ task: '견적 검토', owner: '김과장', due: null }], openQuestions: [] };
const refinedMinutes = { overview: '의견 반영 요약', topics: [], decisions: [], actions: [{ task: '견적 검토', owner: '이대리', due: null }], openQuestions: [] };
const recordingId = crypto.randomUUID();
const first = { id: crypto.randomUUID(), recordingId, location: 'main', title: '주간 점검', date: '2026-10-22', dailySequence: 1, participants: '김과장, 이대리',
  transcript: '김과장: 견적 검토는 이대리가 맡아 주세요.', minutes: firstMinutes, outputFormat: 'meeting', audio: [], savedAt: '2026-10-22T05:00:00.000Z' };
const second = { ...first, id: crypto.randomUUID(), minutes: refinedMinutes, outputFormat: 'summary', feedback: '담당자가 틀렸어요.', savedAt: '2026-10-22T06:00:00.000Z' };
const versions = [{ id: first.id, savedAt: first.savedAt, outputFormat: 'meeting', refined: false, stars: 2 }, { id: second.id, savedAt: second.savedAt, outputFormat: 'summary', refined: true }];
const opening = (meeting, review = null, list = [versions[0]]) => ({ [`/api/meetings/main/${meeting.id}`]: () => Response.json({ meeting, versions: list, review }) });
const reviewRoute = { '^/api/meetings/main/[0-9a-f-]{36}/review$': (call) => Response.json({ review: { version: 1, stars: call.body.stars, comment: call.body.comment.trim(), savedAt: '2026-10-22T06:30:00.000Z' } }) };
const savedRoute = (copies = { ok: true, written: [], skipped: [], failed: [] }) => ({ '/api/meetings/main': (call) => Response.json({ meeting: { ...call.body, location: 'main', savedAt: '2026-10-22T07:00:00.000Z', dailySequence: 1 }, copies }) });
const typeComment = (review, value) => { review.ui['review-comment'].value = value; review.ui['review-comment'].dispatch('input'); };
const summaryCalls = (review) => review.calls.filter((call) => call.url === '/api/summary');

test('별점만·의견만·둘 다 저장할 수 있고 둘 다 비면 저장 버튼이 꺼진다', async () => {
  const review = fixture({ routes: { ...opening(first), ...reviewRoute } });
  await review.openMeeting('main', first.id);
  assert.equal(review.ui.review.hidden, false);
  assert.equal(review.ui['save-review'].disabled, true);
  review.ui['review-star-3'].click();
  assert.equal(review.ui['review-star-3'].attributes['aria-pressed'], 'true');
  assert.equal(review.ui['save-review'].disabled, false);
  await review.saveReview();
  review.ui['review-star-3'].click();
  assert.equal(review.ui['review-star-3'].attributes['aria-pressed'], 'false', '같은 별을 다시 누르면 별점을 지운다');
  assert.equal(review.ui['save-review'].disabled, true);
  typeComment(review, '담당자가 틀렸어요.');
  assert.equal(review.ui['save-review'].disabled, false);
  await review.saveReview();
  review.ui['review-star-4'].click();
  await review.saveReview();
  const posts = review.calls.filter((call) => call.url === `/api/meetings/main/${first.id}/review`).map((call) => call.body);
  assert.deepEqual(posts, [{ stars: 3, comment: '' }, { stars: null, comment: '담당자가 틀렸어요.' }, { stars: 4, comment: '담당자가 틀렸어요.' }]);
  assert.equal(review.ui['review-status'].textContent, '평가를 저장했습니다.');
  review.ui['review-star-4'].click();
  typeComment(review, '   ');
  assert.equal(review.ui['save-review'].disabled, true);
});

test('의견이 있을 때만 다시 정리 버튼이 켜지고 비용 문구가 보인다', async () => {
  const html = fs.readFileSync(path.join(__dirname, '화면/index.html'), 'utf8');
  assert.match(html, /id="refine-cost"[^>]*>요약 요금이 추가로 듭니다\. 긴 회의는 여러 번 나눠 요청할 수 있습니다\.</);
  const review = fixture({ routes: { ...opening(first) } });
  await review.openMeeting('main', first.id);
  assert.equal(review.ui.refine.disabled, true);
  assert.equal(review.ui['refine-cost'].hidden, true);
  review.ui['review-star-5'].click();
  assert.equal(review.ui.refine.disabled, true, '별점만으로는 다시 정리하지 않는다');
  typeComment(review, '담당자가 틀렸어요.');
  assert.equal(review.ui.refine.disabled, false);
  assert.equal(review.ui['refine-cost'].hidden, false);
});

test('분석할 키가 없으면 다시 정리 대신 설정에서 키를 등록하라고 안내하고 설정 창을 연다', async () => {
  const review = fixture({ routes: { ...opening(first), ...reviewRoute } });
  await review.openMeeting('main', first.id);
  typeComment(review, '담당자가 틀렸어요.');
  await review.refineSummary();
  assert.ok(review.calls.some((call) => call.url === `/api/meetings/main/${first.id}/review`), '의견은 먼저 평가로 저장한다');
  assert.equal(summaryCalls(review).length, 0);
  assert.match(review.announce(), /설정에서 API 키를 등록/);
  assert.equal(review.ui.settings.open, true);
});

test('다시 정리는 전사 요청 없이 feedback이 든 요약 요청만 보낸다', async () => {
  const review = fixture({ routes: { ...opening(first), ...reviewRoute, ...savedRoute() } });
  await review.openMeeting('main', first.id);
  review.state.keyConfigured = true;
  typeComment(review, '담당자가 틀렸어요.');
  await review.refineSummary();
  const [request] = summaryCalls(review);
  assert.equal(summaryCalls(review).length, 1);
  assert.equal(request.body.feedback, '담당자가 틀렸어요.');
  assert.equal(request.body.text, first.transcript);
  assert.equal(request.body.outputFormat, 'meeting');
  assert.equal(review.calls.some((call) => call.url === '/api/transcribe' || call.url.endsWith('/transcript')), false);
  const saved = review.calls.find((call) => call.url === '/api/meetings/main' && call.options.method === 'POST').body;
  assert.equal(saved.feedback, '담당자가 틀렸어요.');
  assert.notEqual(saved.id, first.id);
  assert.equal(saved.recordingId, recordingId);
  assert.ok(texts(review.ui.minutes).includes('의견 반영 요약'));
  assert.equal(review.ui['refined-badge'].hidden, false);
  assert.deepEqual(Array.from(review.state.versions, (version) => [version.id, version.refined]), [[first.id, false], [saved.id, true]]);
  assert.equal(review.ui['review-comment'].value, '', '새 결과의 평가 칸은 비어 있다');
});

test('저장된 전사가 없으면 다시 정리하지 않고 정해진 문구로 멈춘다', async () => {
  const empty = { ...first, transcript: '' };
  const review = fixture({ routes: { ...opening(empty), ...reviewRoute } });
  await review.openMeeting('main', empty.id);
  review.state.keyConfigured = true;
  typeComment(review, '담당자가 틀렸어요.');
  await review.refineSummary();
  assert.equal(summaryCalls(review).length, 0);
  assert.equal(review.ui['review-status'].textContent, '저장된 전사가 없어 의견을 반영할 수 없습니다.');
});

test('요약이 실패해도 평가는 저장되어 있고 앞선 결과가 그대로 보인다', async () => {
  const review = fixture({ routes: { ...opening(first), ...reviewRoute,
    '/api/summary': () => Response.json({ error: { code: 'AI_UNAVAILABLE', message: 'AI 응답을 받지 못했습니다.' } }, { status: 502 }) } });
  await review.openMeeting('main', first.id);
  review.state.keyConfigured = true;
  typeComment(review, '담당자가 틀렸어요.');
  await review.refineSummary();
  assert.equal(summaryCalls(review).length, 1);
  assert.ok(review.calls.some((call) => call.url === `/api/meetings/main/${first.id}/review`));
  assert.equal(review.calls.some((call) => call.url === '/api/meetings/main' && call.options.method === 'POST'), false);
  assert.equal(review.state.resultId, first.id);
  assert.ok(texts(review.ui.minutes).includes('첫 정리 요약'));
  assert.equal(review.ui['refined-badge'].hidden, true);
  assert.equal(review.ui['review-comment'].value, '담당자가 틀렸어요.');
  assert.match(review.ui['review-status'].textContent, /평가는 저장되어 있고 앞선 결과는 그대로/);
});

test('결과 버전에서 앞선 결과를 열면 그때의 본문·형식·평가가 보인다', async () => {
  const review = fixture({ routes: { ...opening(second, null, versions), ...opening(first, { version: 1, stars: 2, comment: '담당자가 틀렸어요.', savedAt: 'x' }, versions) } });
  await review.openMeeting('main', second.id);
  assert.equal(review.ui['result-version-field'].hidden, false);
  assert.equal(review.ui['result-versions'].children.length, 2);
  assert.equal(review.ui['result-versions'].value, second.id);
  assert.ok(texts(review.ui.minutes).includes('의견 반영 요약'));
  review.ui['result-versions'].value = first.id;
  review.ui['result-versions'].dispatch('change');
  await settle();
  assert.equal(review.state.resultId, first.id);
  const shown = texts(review.ui.minutes);
  assert.ok(shown.includes('첫 정리 요약') && shown.includes('합의된 방향'), '회의록 형식으로 그때의 본문을 보여 준다');
  assert.equal(review.ui['review-star-2'].attributes['aria-pressed'], 'true');
  assert.equal(review.ui['review-comment'].value, '담당자가 틀렸어요.');
  assert.equal(review.ui['refined-badge'].hidden, true);
  assert.equal(review.ui['result-versions'].value, first.id);
});

test('의견을 반영한 결과에 의견 반영본이 표시된다', async () => {
  const review = fixture({ routes: { ...opening(second, null, versions) } });
  await review.openMeeting('main', second.id);
  assert.equal(review.ui['refined-badge'].hidden, false);
  const [older, newer] = review.ui['result-versions'].children.map((option) => option.textContent);
  assert.match(newer, /의견 반영본/);
  assert.doesNotMatch(older, /의견 반영본/);
  assert.match(older, /별 2개/);
});

test('사본 실패 응답이면 실패한 종류와 정해진 문구, 다시 저장 버튼을 보여 준다', async () => {
  const failed = { ok: false, written: [{ kind: 'transcript', path: 'D:\\전사\\a-전사.txt' }, { kind: 'summaryMd', path: 'D:\\요약\\a-요약.md' }],
    skipped: [{ kind: 'audio', reason: '설정에서 저장 위치를 고르지 않았습니다.' }], failed: [{ kind: 'summaryTxt', message: '고른 폴더에 쓸 권한이 없습니다.' }] };
  const review = fixture({ routes: { ...savedRoute(failed),
    '^/api/meetings/main/[0-9a-f-]{36}/copies$': () => Response.json({ copies: { ok: true, written: [{ kind: 'summaryTxt', path: 'D:\\요약\\a-요약.txt' }], skipped: [], failed: [] } }) } });
  review.state.settings = { summaryModel: 'gpt-6.1-sol', defaultOutputFormat: 'meeting', storage: { audio: '', transcript: 'D:\\전사', summary: 'D:\\요약' } };
  review.state.keyConfigured = true;
  review.ui.transcript.value = '김과장: 견적 검토는 이대리가 맡아 주세요.';
  await review.summarize(true);
  const message = '고른 폴더에 저장하지 못했습니다: 요약본(.txt) — 고른 폴더에 쓸 권한이 없습니다. 설정에서 폴더를 확인한 뒤 ‘고른 폴더에 다시 저장’을 누르세요.';
  assert.equal(review.ui['copy-status'].textContent, message);
  assert.ok(review.announce().includes(message), '상태 줄에도 알린다');
  assert.equal(review.ui['copy-again'].hidden, false);
  assert.equal(review.ui['copy-again'].disabled, false);
  await review.copyAgain();
  assert.ok(review.calls.some((call) => call.url === `/api/meetings/main/${review.state.resultId}/copies` && call.options.method === 'POST'));
  assert.equal(review.ui['copy-status'].textContent, '고른 폴더에 사본을 저장했습니다: 요약본(.txt).');
});

test('저장 위치를 고르지 않았으면 다시 저장 대신 안내 문구를 보여 준다', async () => {
  const review = fixture({ routes: { ...opening(first) } });
  review.state.settings = { summaryModel: 'gpt-6.1-sol', defaultOutputFormat: 'meeting', storage: { audio: '', transcript: '', summary: '' } };
  await review.openMeeting('main', first.id);
  assert.equal(review.ui['copy-block'].hidden, false);
  assert.equal(review.ui['copy-status'].textContent, '설정에서 저장 위치를 고르면 사본을 저장할 수 있습니다.');
  assert.equal(review.ui['copy-again'].hidden, true);
});
